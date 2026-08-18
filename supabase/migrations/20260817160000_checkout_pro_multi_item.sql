-- VisualSkin multi-item Checkout Pro, stage 4.
-- Additive protocol: immutable economic snapshots bind each provider
-- preference/payment to one exact cart revision.

create extension if not exists pgcrypto with schema extensions;

alter table if exists public.custom_orders
  add column if not exists cart_version bigint not null default 1,
  add column if not exists cart_fingerprint text,
  add column if not exists payment_cart_version bigint,
  add column if not exists payment_cart_fingerprint text,
  add column if not exists mercadopago_preference_id text,
  add column if not exists mercadopago_checkout_url text,
  add column if not exists mercadopago_preference_created_at timestamptz,
  add column if not exists mercadopago_preference_expires_at timestamptz,
  add column if not exists mercadopago_preference_environment text,
  add column if not exists mercadopago_preference_claim_token uuid,
  add column if not exists mercadopago_preference_claimed_at timestamptz;

alter table if exists public.payment_attempts
  add column if not exists checkout_snapshot_id uuid,
  add column if not exists mercadopago_preference_id text,
  add column if not exists cart_version bigint,
  add column if not exists cart_fingerprint text,
  add column if not exists expected_total bigint,
  add column if not exists expected_currency text,
  add column if not exists payment_flow text not null default 'card_payment';

create table if not exists public.payment_checkout_snapshots (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.custom_orders(id) on delete cascade,
  provider text not null default 'mercadopago',
  environment text not null,
  cart_version bigint not null,
  cart_fingerprint text not null,
  canonical_cart jsonb not null,
  line_items jsonb not null,
  subtotal_amount bigint not null,
  shipping_amount bigint not null,
  total_amount bigint not null,
  currency text not null default 'CLP',
  status text not null default 'claiming',
  claim_token uuid,
  preference_id text,
  checkout_url text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  stored_at timestamptz,
  constraint payment_checkout_snapshots_provider_chk check (provider = 'mercadopago'),
  constraint payment_checkout_snapshots_environment_chk check (environment in ('test','production')),
  constraint payment_checkout_snapshots_fingerprint_chk check (cart_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint payment_checkout_snapshots_amounts_chk check (
    subtotal_amount >= 0 and shipping_amount >= 0 and total_amount = subtotal_amount + shipping_amount
  ),
  constraint payment_checkout_snapshots_currency_chk check (currency = 'CLP'),
  constraint payment_checkout_snapshots_status_chk check (status in ('claiming','ready','failed','expired')),
  constraint payment_checkout_snapshots_preference_uniq unique (preference_id)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='payment_attempts_checkout_snapshot_id_fkey') then
    alter table public.payment_attempts add constraint payment_attempts_checkout_snapshot_id_fkey
      foreign key (checkout_snapshot_id) references public.payment_checkout_snapshots(id) on delete restrict;
  end if;
end $$;

create index if not exists payment_checkout_snapshots_order_idx
  on public.payment_checkout_snapshots(order_id, created_at desc);
create index if not exists payment_checkout_snapshots_fingerprint_idx
  on public.payment_checkout_snapshots(order_id, cart_fingerprint);
create unique index if not exists payment_checkout_snapshots_current_revision_uidx
  on public.payment_checkout_snapshots(order_id,cart_version,cart_fingerprint)
  where status in ('claiming','ready');
create unique index if not exists payment_attempts_checkout_snapshot_uidx
  on public.payment_attempts(checkout_snapshot_id) where checkout_snapshot_id is not null;
create index if not exists payment_attempts_checkout_fingerprint_idx
  on public.payment_attempts(order_id, cart_fingerprint);

alter table public.payment_checkout_snapshots enable row level security;
grant select on public.payment_checkout_snapshots to authenticated;
grant all on public.payment_checkout_snapshots to service_role;
drop policy if exists "Admins read checkout snapshots" on public.payment_checkout_snapshots;
create policy "Admins read checkout snapshots" on public.payment_checkout_snapshots
  for select to authenticated using (public.has_role(auth.uid(),'admin'));

-- Structural/economic item mutations invalidate the cached provider preference.
-- The trigger is also a backstop for future server-side mutation paths.
create or replace function public.bump_order_cart_revision_v1()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_order_id uuid;
begin
  v_order_id := case when tg_op='DELETE' then old.order_id else new.order_id end;
  update public.custom_orders set
    cart_version = cart_version + 1,
    cart_fingerprint = null,
    mercadopago_preference_id = null,
    mercadopago_checkout_url = null,
    mercadopago_preference_expires_at = null,
    mercadopago_preference_claim_token = null,
    mercadopago_preference_claimed_at = null
  where id=v_order_id;
  return null;
end $$;

drop trigger if exists order_items_bump_cart_revision on public.order_items;
create trigger order_items_bump_cart_revision
after insert or delete or update of is_active,position,quantity,pack_id,pack_type,brand_id,brand,phone_model_id,phone_model,
  garment_id,garment_size,garment_color,secondary_garment_id,secondary_garment_size,
  secondary_garment_color,base_price,unit_price,discount_amount,line_total
on public.order_items for each row execute function public.bump_order_cart_revision_v1();

-- Lock, validate and claim one deterministic cart revision. jsonb::text is
-- canonical in PostgreSQL (keys normalized); the item array has explicit
-- position/id ordering and objects are built from an explicit field list.
create or replace function public.claim_checkout_pro_cart_v1(
  p_order_id uuid, p_environment text, p_claim_token uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_order record; v_cart jsonb; v_lines jsonb; v_fingerprint text; v_snapshot record; v_has_snapshot boolean := false;
declare v_subtotal bigint; v_item_sum bigint; v_version bigint;
begin
  if p_environment not in ('test','production') or p_claim_token is null then
    return jsonb_build_object('ok',false,'code','invalid_claim');
  end if;
  select * into v_order from public.custom_orders where id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'code','order_not_found'); end if;
  if v_order.payment_status in ('approved','refunded','charged_back') then
    return jsonb_build_object('ok',false,'code','order_locked');
  end if;
  if v_order.legal_accepted_at is null or v_order.design_status <> 'ready'
     or v_order.currency <> 'CLP' or v_order.payment_environment <> p_environment then
    return jsonb_build_object('ok',false,'code','order_not_ready');
  end if;
  if not exists (select 1 from public.order_items where order_id=p_order_id and is_active)
     or exists (select 1 from public.order_items where order_id=p_order_id and is_active and design_status <> 'ready') then
    return jsonb_build_object('ok',false,'code','items_not_ready');
  end if;

  select coalesce(sum(line_total),0), coalesce(sum(unit_price*quantity),0)
    into v_subtotal,v_item_sum from public.order_items where order_id=p_order_id and is_active;
  if v_subtotal <> v_item_sum or v_subtotal <> v_order.subtotal_amount
     or v_order.total_amount <> v_subtotal + v_order.shipping_amount or v_order.total_amount <= 0 then
    return jsonb_build_object('ok',false,'code','economic_mismatch');
  end if;

  v_cart := jsonb_build_object(
    'schema',1,'order_id',p_order_id,'currency','CLP',
    'items',(select jsonb_agg(jsonb_build_object(
      'id',id,'position',position,'pack_id',pack_id,'pack_type',pack_type,'quantity',quantity,
      'unit_price',unit_price,'discount_amount',discount_amount,'line_total',line_total,
      'brand_id',brand_id,'brand',brand,'phone_model_id',phone_model_id,'phone_model',phone_model,
      'garment_id',garment_id,'garment_size',garment_size,
      'garment_color',garment_color,'secondary_garment_id',secondary_garment_id,
      'secondary_garment_size',secondary_garment_size,'secondary_garment_color',secondary_garment_color
    ) order by position,id) from public.order_items where order_id=p_order_id and is_active),
    'subtotal_amount',v_order.subtotal_amount,'shipping_amount',v_order.shipping_amount,
    'total_amount',v_order.total_amount
  );
  v_fingerprint := encode(extensions.digest(convert_to(v_cart::text,'UTF8'),'sha256'),'hex');
  v_version := v_order.cart_version;
  v_lines := (select jsonb_agg(line order by ordinal) from (
    select row_number() over(order by position,id) as ordinal,
      jsonb_build_object('id',id,'title',case pack_type
        when 'carcasa' then 'Carcasa personalizada VisualSkin'
        when 'carcasa+polera' then 'Pack carcasa y polera VisualSkin'
        when 'carcasa+poleron' then 'Pack carcasa y polerón VisualSkin'
        when 'carcasa+polera+poleron' then 'Pack completo VisualSkin'
        else 'Producto personalizado VisualSkin' end,
        'quantity',quantity,'currency_id','CLP','unit_price',unit_price) line
    from public.order_items where order_id=p_order_id and is_active
    union all
    select 2147483647, jsonb_build_object('id','shipping','title','Envío','quantity',1,'currency_id','CLP','unit_price',v_order.shipping_amount)
    where v_order.shipping_amount > 0
  ) q);

  select * into v_snapshot from public.payment_checkout_snapshots
   where order_id=p_order_id and cart_version=v_version and cart_fingerprint=v_fingerprint
     and status in ('claiming','ready') order by created_at desc limit 1 for update;
  v_has_snapshot := found;
  if v_has_snapshot and v_snapshot.status='ready' and v_snapshot.expires_at > now()+interval '30 seconds' then
    return jsonb_build_object('ok',true,'code','reused','snapshot_id',v_snapshot.id,
      'preference_id',v_snapshot.preference_id,'checkout_url',v_snapshot.checkout_url,
      'cart_version',v_version,'cart_fingerprint',v_fingerprint);
  end if;
  if v_has_snapshot and v_snapshot.status='ready' and coalesce(v_snapshot.expires_at,now()) <= now()+interval '30 seconds'
     and not exists(select 1 from public.payment_attempts where checkout_snapshot_id=v_snapshot.id
       and mercado_pago_payment_id is not null) then
    update public.payment_attempts set status='cancelled',status_detail='checkout_preference_expired',completed_at=now()
      where checkout_snapshot_id=v_snapshot.id and status in ('processing','pending','awaiting_reconciliation');
    update public.payment_checkout_snapshots set status='expired' where id=v_snapshot.id;
    update public.custom_orders set design_status='ready' where id=p_order_id and design_status='locked';
    v_has_snapshot := false;
  end if;
  if exists(select 1 from public.payment_attempts where order_id=p_order_id
    and status in ('processing','pending','awaiting_reconciliation')) then
    return jsonb_build_object('ok',false,'code','active_payment');
  end if;
  if v_has_snapshot and v_snapshot.status='claiming' and v_snapshot.created_at > now()-interval '2 minutes' then
    return jsonb_build_object('ok',false,'code','creation_in_progress');
  end if;
  if v_has_snapshot then
    update public.payment_checkout_snapshots set status='claiming',claim_token=p_claim_token,
      created_at=now(),preference_id=null,checkout_url=null,expires_at=null,stored_at=null
      where id=v_snapshot.id returning * into v_snapshot;
  else
    insert into public.payment_checkout_snapshots(order_id,environment,cart_version,cart_fingerprint,
      canonical_cart,line_items,subtotal_amount,shipping_amount,total_amount,currency,claim_token)
    values(p_order_id,p_environment,v_version,v_fingerprint,v_cart,v_lines,v_order.subtotal_amount,
      v_order.shipping_amount,v_order.total_amount,'CLP',p_claim_token) returning * into v_snapshot;
  end if;
  update public.custom_orders set cart_fingerprint=v_fingerprint where id=p_order_id;
  return jsonb_build_object('ok',true,'code','claimed','snapshot_id',v_snapshot.id,
    'cart_version',v_version,'cart_fingerprint',v_fingerprint,'line_items',v_lines,
    'total_amount',v_order.total_amount);
end $$;

create or replace function public.store_checkout_pro_cart_v1(
  p_order_id uuid,p_snapshot_id uuid,p_claim_token uuid,p_environment text,
  p_preference_id text,p_checkout_url text,p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_order record; v_snapshot record; v_attempt_id uuid; v_attempt_number integer;
begin
  select * into v_order from public.custom_orders where id=p_order_id for update;
  select * into v_snapshot from public.payment_checkout_snapshots
    where id=p_snapshot_id and order_id=p_order_id for update;
  if not found or v_snapshot.status<>'claiming' or v_snapshot.claim_token is distinct from p_claim_token then
    return jsonb_build_object('ok',false,'code','claim_mismatch');
  end if;
  if v_order.cart_version<>v_snapshot.cart_version or v_order.cart_fingerprint<>v_snapshot.cart_fingerprint then
    return jsonb_build_object('ok',false,'code','cart_changed');
  end if;
  if p_environment<>v_snapshot.environment or p_preference_id is null or length(btrim(p_preference_id))=0
     or p_expires_at<=now()+interval '30 seconds' then return jsonb_build_object('ok',false,'code','invalid_preference'); end if;
  if (p_environment='test' and p_checkout_url !~ '^https://sandbox\.mercadopago\.(com|cl)/')
     or (p_environment='production' and p_checkout_url !~ '^https://www\.mercadopago\.(com|cl)/') then
    return jsonb_build_object('ok',false,'code','invalid_checkout_url'); end if;
  update public.payment_checkout_snapshots set status='ready',claim_token=null,preference_id=p_preference_id,
    checkout_url=p_checkout_url,expires_at=p_expires_at,stored_at=now() where id=p_snapshot_id;
  select coalesce(max(attempt_number),0)+1 into v_attempt_number from public.payment_attempts where order_id=p_order_id;
  insert into public.payment_attempts(order_id,attempt_number,idempotency_key,request_fingerprint,status,
    previous_order_status,payment_environment,is_live_mode,payment_flow,checkout_snapshot_id,
    mercadopago_preference_id,cart_version,cart_fingerprint,expected_total,expected_currency)
  values(p_order_id,v_attempt_number,'mp-checkout:'||p_snapshot_id::text,v_snapshot.cart_fingerprint,'pending',
    v_order.payment_status,p_environment,v_order.is_live_mode,'checkout_pro',p_snapshot_id,p_preference_id,
    v_snapshot.cart_version,v_snapshot.cart_fingerprint,v_snapshot.total_amount,v_snapshot.currency)
  on conflict(idempotency_key) do update set status='pending',status_detail=null,completed_at=null,
    mercado_pago_payment_id=null,mercadopago_preference_id=excluded.mercadopago_preference_id,
    expected_total=excluded.expected_total,expected_currency=excluded.expected_currency,
    updated_at=now() returning id into v_attempt_id;
  update public.custom_orders set payment_status='pending',design_status='locked',
    payment_cart_version=v_snapshot.cart_version,payment_cart_fingerprint=v_snapshot.cart_fingerprint,
    mercadopago_preference_id=p_preference_id,mercadopago_checkout_url=p_checkout_url,
    mercadopago_preference_created_at=now(),mercadopago_preference_expires_at=p_expires_at,
    mercadopago_preference_environment=p_environment,mercadopago_preference_claim_token=null,
    mercadopago_preference_claimed_at=null where id=p_order_id;
  return jsonb_build_object('ok',true,'code','stored','attempt_id',v_attempt_id);
end $$;

create or replace function public.release_checkout_pro_cart_claim_v1(
  p_order_id uuid,p_snapshot_id uuid,p_claim_token uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  update public.payment_checkout_snapshots set status='failed',claim_token=null
   where id=p_snapshot_id and order_id=p_order_id and status='claiming' and claim_token=p_claim_token;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.attach_checkout_pro_snapshot_payment_v1(
  p_order_id uuid,p_payment_id text,p_preference_id text,p_payment_environment text,p_is_live_mode boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_order record; v_attempt record; v_snapshot record; v_other record;
begin
  if p_payment_id !~ '^[0-9]+$' or p_preference_id is null then
    return jsonb_build_object('ok',false,'code','invalid_provider_reference'); end if;
  select * into v_order from public.custom_orders where id=p_order_id for update;
  select * into v_snapshot from public.payment_checkout_snapshots
   where order_id=p_order_id and preference_id=p_preference_id and status='ready';
  if not found then return jsonb_build_object('ok',false,'code','snapshot_not_found'); end if;
  if v_snapshot.cart_version<>v_order.cart_version or v_snapshot.cart_fingerprint<>v_order.cart_fingerprint
     or v_snapshot.environment<>p_payment_environment or v_order.is_live_mode is distinct from p_is_live_mode then
    return jsonb_build_object('ok',false,'code','stale_checkout'); end if;
  select * into v_other from public.payment_attempts where mercado_pago_payment_id=p_payment_id for update;
  if found then
    if v_other.order_id<>p_order_id or v_other.checkout_snapshot_id is distinct from v_snapshot.id then
      return jsonb_build_object('ok',false,'code','payment_id_reused'); end if;
    return jsonb_build_object('ok',true,'reused',true,'attempt_id',v_other.id,'attempt_status',v_other.status);
  end if;
  select * into v_attempt from public.payment_attempts where checkout_snapshot_id=v_snapshot.id for update;
  if not found then return jsonb_build_object('ok',false,'code','attempt_not_found'); end if;
  update public.payment_attempts set mercado_pago_payment_id=p_payment_id,status='processing',updated_at=now()
   where id=v_attempt.id;
  update public.custom_orders set mp_payment_id=coalesce(mp_payment_id,p_payment_id) where id=p_order_id;
  return jsonb_build_object('ok',true,'reused',false,'attempt_id',v_attempt.id,'attempt_status','processing');
end $$;

create or replace function public.apply_checkout_pro_snapshot_payment_v1(
  p_order_id uuid,p_attempt_id uuid,p_payment_id text,p_preference_id text,
  p_payment_status text,p_status_detail text,p_live_mode boolean,p_transaction_amount numeric,
  p_currency_id text,p_external_reference text,p_metadata_order_id text,p_metadata_attempt_id text,
  p_payment_type_id text,p_collector_id text,p_expected_collector_id text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_order record; v_attempt record; v_result jsonb;
begin
  select * into v_order from public.custom_orders where id=p_order_id for update;
  select * into v_attempt from public.payment_attempts where id=p_attempt_id and order_id=p_order_id for update;
  if not found then raise exception 'attempt_not_found'; end if;
  if v_attempt.payment_flow<>'checkout_pro' or v_attempt.mercadopago_preference_id is distinct from p_preference_id
     or v_attempt.cart_version is distinct from v_order.cart_version
     or v_attempt.cart_fingerprint is distinct from v_order.cart_fingerprint
     or v_attempt.expected_total is distinct from p_transaction_amount
     or v_attempt.expected_currency is distinct from upper(p_currency_id) then
    update public.payment_attempts set status='awaiting_reconciliation',status_detail='reconcile:checkout_snapshot_mismatch' where id=p_attempt_id;
    update public.custom_orders set manual_review_required=true where id=p_order_id;
    return jsonb_build_object('ok',false,'code','requires_reconciliation','reason','checkout_snapshot_mismatch');
  end if;
  v_result := public.apply_mercado_pago_payment_response(p_order_id,p_attempt_id,p_payment_id,p_payment_status,
    p_status_detail,p_live_mode,p_transaction_amount,p_currency_id,p_external_reference,p_metadata_order_id,
    p_metadata_attempt_id,p_payment_type_id,p_collector_id,p_expected_collector_id);
  if p_payment_status in ('rejected','cancelled') and coalesce((v_result->>'ok')::boolean,false) then
    update public.custom_orders set design_status=(select case when bool_and(design_status='ready') then 'ready' else 'pending' end
      from public.order_items where order_id=p_order_id and is_active)
      where id=p_order_id and payment_status in ('rejected','cancelled');
  end if;
  return v_result;
end $$;

revoke all on function public.bump_order_cart_revision_v1() from public,anon,authenticated;
revoke all on function public.claim_checkout_pro_cart_v1(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.store_checkout_pro_cart_v1(uuid,uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.release_checkout_pro_cart_claim_v1(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.attach_checkout_pro_snapshot_payment_v1(uuid,text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.apply_checkout_pro_snapshot_payment_v1(uuid,uuid,text,text,text,text,boolean,numeric,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_checkout_pro_cart_v1(uuid,text,uuid) to service_role;
grant execute on function public.store_checkout_pro_cart_v1(uuid,uuid,uuid,text,text,text,timestamptz) to service_role;
grant execute on function public.release_checkout_pro_cart_claim_v1(uuid,uuid,uuid) to service_role;
grant execute on function public.attach_checkout_pro_snapshot_payment_v1(uuid,text,text,text,boolean) to service_role;
grant execute on function public.apply_checkout_pro_snapshot_payment_v1(uuid,uuid,text,text,text,text,boolean,numeric,text,text,text,text,text,text,text) to service_role;
