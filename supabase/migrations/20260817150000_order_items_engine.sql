-- VisualSkin multi-item orders, stage 2.
-- Transactional cart engine and item-aware design persistence.
-- Legacy checkout/RPCs remain installed and unchanged.

-- Canonical webhook-delivery reservation repair. Some remote environments
-- have payment_events but missed the historical RPC migration. Keep the
-- original lease/retry contract used by mercadopago-webhook and make its
-- table prerequisites additive and idempotent.
alter table public.payment_events
  add column if not exists delivery_id text,
  add column if not exists request_id text,
  add column if not exists event_action text,
  add column if not exists provider_payment_id text,
  add column if not exists provider_event_id text,
  add column if not exists status text not null default 'processing',
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();

-- A non-partial unique index is intentionally used so the canonical
-- ON CONFLICT(provider, delivery_id) target can be inferred by PostgreSQL.
-- NULL delivery ids remain distinct under the default PostgreSQL semantics.
create unique index if not exists payment_events_provider_delivery_uidx
  on public.payment_events(provider, delivery_id);

drop trigger if exists payment_events_set_updated_at on public.payment_events;
create trigger payment_events_set_updated_at
  before update on public.payment_events
  for each row execute function public.tg_set_updated_at();

create or replace function public.reserve_webhook_delivery(
  p_provider text,
  p_delivery_id text,
  p_request_id text,
  p_type text,
  p_action text,
  p_payment_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_id uuid;
begin
  insert into public.payment_events (
    provider, delivery_id, request_id, event_type, event_action,
    provider_payment_id, provider_event_id, status, attempt_count
  ) values (
    p_provider, p_delivery_id, p_request_id, p_type, p_action,
    p_payment_id, p_delivery_id, 'processing', 1
  )
  on conflict (provider, delivery_id) do nothing
  returning id into v_id;

  if v_id is not null then
    return jsonb_build_object('ok', true, 'code', 'reserved', 'event_id', v_id);
  end if;

  select id, status, updated_at, attempt_count
    into v_event
  from public.payment_events
  where provider = p_provider and delivery_id = p_delivery_id
  for update;

  if v_event.status = 'processed' then
    return jsonb_build_object('ok', false, 'code', 'duplicate', 'event_id', v_event.id);
  end if;

  if v_event.status = 'processing'
     and v_event.updated_at > now() - interval '2 minutes' then
    return jsonb_build_object('ok', false, 'code', 'in_progress', 'event_id', v_event.id);
  end if;

  update public.payment_events
     set status = 'processing',
         attempt_count = coalesce(attempt_count, 0) + 1
   where id = v_event.id;

  return jsonb_build_object(
    'ok', true, 'code', 'reserved', 'event_id', v_event.id, 'retry', true
  );
end;
$$;

revoke all on function public.reserve_webhook_delivery(text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.reserve_webhook_delivery(text,text,text,text,text,text)
  to service_role;

create or replace function public.recalculate_order_from_items_v1(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_first record;
  v_cfg jsonb := '{}'::jsonb;
  v_subtotal bigint := 0;
  v_discount bigint := 0;
  v_shipping bigint := 0;
  v_total bigint := 0;
  v_cases bigint := 0;
  v_poleras bigint := 0;
  v_polerones bigint := 0;
  v_units bigint := 0;
  v_free_from integer := 2;
  v_design_status text := 'draft';
begin
  select * into v_order
  from public.custom_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'order_not_found'; end if;

  select
    coalesce(sum(line_total) filter (where is_active), 0),
    coalesce(sum(discount_amount) filter (where is_active), 0),
    coalesce(sum(quantity) filter (where is_active), 0),
    coalesce(sum(quantity) filter (where is_active), 0),
    coalesce(sum(quantity) filter (
      where is_active and pack_type in ('carcasa+polera','carcasa+polera+poleron')
    ), 0),
    coalesce(sum(quantity) filter (
      where is_active and pack_type in ('carcasa+poleron','carcasa+polera+poleron')
    ), 0)
  into v_subtotal, v_discount, v_units, v_cases, v_poleras, v_polerones
  from public.order_items
  where order_id = p_order_id;

  if v_units < 1 then raise exception 'last_active_item_required'; end if;
  if v_subtotal < 0 or v_discount < 0 then raise exception 'invalid_order_amounts'; end if;

  select * into v_first
  from public.order_items
  where order_id = p_order_id and is_active
  order by position, created_at, id
  limit 1;

  select coalesce(value, '{}'::jsonb) into v_cfg
  from public.site_content
  where key = 'shipping_config';

  v_free_from := greatest(1, coalesce(nullif(v_cfg->>'freeShippingFromQuantity', '')::integer, 2));
  if coalesce(v_order.shipping_address->>'delivery_method', 'shipping') = 'pickup'
     or coalesce((v_cfg->>'enabled')::boolean, true) = false then
    v_shipping := 0;
  elsif v_cases = 1 and (v_poleras + v_polerones) = 0 then
    v_shipping := greatest(0, coalesce(nullif(v_cfg->>'singleCaseAmount', '')::bigint, 1990));
  elsif v_cases = 0 and (v_poleras + v_polerones) = 1 then
    v_shipping := greatest(0, coalesce(nullif(v_cfg->>'singleGarmentAmount', '')::bigint, 2490));
  elsif coalesce((v_cfg->>'casePlusTshirtExceptionEnabled')::boolean, true)
        and v_cases = 1 and v_poleras = 1 and v_polerones = 0 then
    v_shipping := greatest(0, coalesce(nullif(v_cfg->>'casePlusTshirtAmount', '')::bigint, 2490));
  elsif (v_cases + v_poleras + v_polerones) >= v_free_from then
    v_shipping := 0;
  else
    v_shipping := 0;
  end if;

  v_total := v_subtotal + v_shipping;
  if v_total <= 0 then raise exception 'invalid_order_total'; end if;

  select case
    when bool_or(design_status = 'failed') then 'failed'
    when bool_or(design_status = 'locked') then 'locked'
    when bool_or(design_status = 'uploading') then 'uploading'
    when bool_and(design_status = 'ready') then 'ready'
    when bool_or(design_status = 'pending') then 'pending'
    else 'draft'
  end into v_design_status
  from public.order_items
  where order_id = p_order_id and is_active;

  -- Transitional rule: product-shaped legacy columns mirror the first active
  -- item only. Monetary columns always aggregate every active item.
  update public.custom_orders
  set
    pack_id = v_first.pack_id,
    pack_type = v_first.pack_type,
    brand_id = v_first.brand_id,
    brand = v_first.brand,
    phone_model_id = v_first.phone_model_id,
    phone_model = v_first.phone_model,
    garment_id = v_first.garment_id,
    garment_size = v_first.garment_size,
    garment_color = v_first.garment_color,
    secondary_garment_id = v_first.secondary_garment_id,
    secondary_garment_size = v_first.secondary_garment_size,
    secondary_garment_color = v_first.secondary_garment_color,
    catalog_snapshot = v_first.catalog_snapshot,
    case_file_path = (
      select file_path from public.design_assets
      where order_item_id = v_first.id and kind = 'case'
      order by created_at desc limit 1
    ),
    garment_file_path = (
      select file_path from public.design_assets
      where order_item_id = v_first.id and kind = 'garment'
      order by created_at desc limit 1
    ),
    secondary_garment_file_path = (
      select file_path from public.design_assets
      where order_item_id = v_first.id and kind = 'secondary_garment'
      order by created_at desc limit 1
    ),
    subtotal_amount = v_subtotal,
    discount_amount = v_discount,
    shipping_amount = v_shipping,
    total_amount = v_total,
    design_status = v_design_status,
    low_resolution_warning = exists (
      select 1 from public.order_items
      where order_id = p_order_id and is_active and low_resolution_warning
    )
  where id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'subtotal_amount', v_subtotal,
    'discount_amount', v_discount,
    'shipping_amount', v_shipping,
    'total_amount', v_total,
    'design_status', v_design_status
  );
end;
$$;

create or replace function public.add_order_item_v1(
  p_order_id uuid,
  p_client_item_key text,
  p_request_fingerprint text,
  p_item jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_existing record;
  v_item public.order_items%rowtype;
  v_position integer;
  v_totals jsonb;
begin
  select id, payment_status, design_status into v_order
  from public.custom_orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  select * into v_existing from public.order_items
  where order_id = p_order_id and client_item_key = p_client_item_key;
  if found then
    if v_existing.request_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency_key_reused_with_different_payload';
    end if;
    return jsonb_build_object('ok', true, 'created', false, 'item', to_jsonb(v_existing));
  end if;

  if v_order.payment_status in ('approved','refunded','charged_back')
     or v_order.design_status = 'locked'
     or exists (
       select 1 from public.payment_attempts
       where order_id = p_order_id
         and status in ('processing','pending','awaiting_reconciliation')
     ) then
    raise exception 'order_locked';
  end if;
  if p_client_item_key is null or length(p_client_item_key) < 8 or length(p_client_item_key) > 100
     or p_request_fingerprint is null or length(p_request_fingerprint) <> 64 then
    raise exception 'invalid_idempotency_data';
  end if;

  select coalesce(max(position), -1) + 1 into v_position
  from public.order_items where order_id = p_order_id;

  insert into public.order_items (
    order_id, position, quantity, client_item_key, request_fingerprint,
    pack_id, pack_type, brand_id, brand, phone_model_id, phone_model,
    garment_id, garment_size, garment_color,
    secondary_garment_id, secondary_garment_size, secondary_garment_color,
    base_price, unit_price, discount_amount, line_total, catalog_snapshot,
    design_status, low_resolution_warning, is_active
  ) values (
    p_order_id, v_position, 1, p_client_item_key, p_request_fingerprint,
    nullif(p_item->>'pack_id', '')::uuid, p_item->>'pack_type',
    nullif(p_item->>'brand_id', '')::uuid, nullif(p_item->>'brand', ''),
    nullif(p_item->>'phone_model_id', '')::uuid, nullif(p_item->>'phone_model', ''),
    nullif(p_item->>'garment_id', '')::uuid, nullif(p_item->>'garment_size', ''),
    nullif(p_item->>'garment_color', ''),
    nullif(p_item->>'secondary_garment_id', '')::uuid,
    nullif(p_item->>'secondary_garment_size', ''),
    nullif(p_item->>'secondary_garment_color', ''),
    (p_item->>'base_price')::bigint, (p_item->>'unit_price')::bigint,
    (p_item->>'discount_amount')::bigint, (p_item->>'line_total')::bigint,
    coalesce(p_item->'catalog_snapshot', '{}'::jsonb), 'draft', false, true
  ) returning * into v_item;

  v_totals := public.recalculate_order_from_items_v1(p_order_id);
  return jsonb_build_object('ok', true, 'created', true, 'item', to_jsonb(v_item), 'totals', v_totals);
end;
$$;

-- Atomic initial dual-write. The trusted server supplies an already validated,
-- canonical order/item payload plus opaque session hashes. Any failure rolls
-- back the order, first item and payment session together.
create or replace function public.create_order_with_first_item_v1(
  p_order jsonb,
  p_client_item_key text,
  p_request_fingerprint text,
  p_item jsonb,
  p_session_token_hash text,
  p_csrf_token_hash text,
  p_session_expires_at timestamptz,
  p_session_absolute_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.custom_orders%rowtype;
  v_session public.payment_sessions%rowtype;
  v_item_result jsonb;
begin
  if p_session_token_hash is null or length(p_session_token_hash) < 32
     or p_csrf_token_hash is null or length(p_csrf_token_hash) < 32
     or p_session_expires_at <= now()
     or p_session_absolute_expires_at < p_session_expires_at then
    raise exception 'invalid_order_session_data';
  end if;

  insert into public.custom_orders (
    order_number, public_access_token_hash,
    pack_id, pack_type, brand, brand_id, phone_model, phone_model_id,
    garment_id, garment_size, garment_color,
    secondary_garment_id, secondary_garment_size, secondary_garment_color,
    customer_name, customer_email, customer_phone, shipping_address, notes,
    subtotal_amount, discount_amount, shipping_amount, total_amount, currency,
    status, payment_status, fulfillment_status, payment_provider, design_status,
    catalog_snapshot, payment_environment, is_live_mode
  ) values (
    nullif(p_order->>'order_number',''), nullif(p_order->>'public_access_token_hash',''),
    nullif(p_order->>'pack_id','')::uuid, p_order->>'pack_type',
    nullif(p_order->>'brand',''), nullif(p_order->>'brand_id','')::uuid,
    nullif(p_order->>'phone_model',''), nullif(p_order->>'phone_model_id','')::uuid,
    nullif(p_order->>'garment_id','')::uuid, nullif(p_order->>'garment_size',''),
    nullif(p_order->>'garment_color',''),
    nullif(p_order->>'secondary_garment_id','')::uuid,
    nullif(p_order->>'secondary_garment_size',''),
    nullif(p_order->>'secondary_garment_color',''),
    nullif(p_order->>'customer_name',''), p_order->>'customer_email',
    nullif(p_order->>'customer_phone',''), coalesce(p_order->'shipping_address','{}'::jsonb),
    nullif(p_order->>'notes',''),
    (p_order->>'subtotal_amount')::bigint, (p_order->>'discount_amount')::bigint,
    (p_order->>'shipping_amount')::bigint, (p_order->>'total_amount')::bigint,
    coalesce(nullif(p_order->>'currency',''),'CLP'),
    coalesce(nullif(p_order->>'status',''),'pendiente_pago'),
    coalesce(nullif(p_order->>'payment_status',''),'pending'),
    coalesce(nullif(p_order->>'fulfillment_status',''),'new'),
    nullif(p_order->>'payment_provider',''),
    coalesce(nullif(p_order->>'design_status',''),'pending'),
    coalesce(p_order->'catalog_snapshot','{}'::jsonb),
    nullif(p_order->>'payment_environment',''),
    coalesce((p_order->>'is_live_mode')::boolean, false)
  ) returning * into v_order;

  v_item_result := public.add_order_item_v1(
    v_order.id, p_client_item_key, p_request_fingerprint, p_item
  );

  insert into public.payment_sessions (
    order_id, session_token_hash, csrf_token_hash, expires_at, absolute_expires_at
  ) values (
    v_order.id, p_session_token_hash, p_csrf_token_hash,
    p_session_expires_at, p_session_absolute_expires_at
  ) returning * into v_session;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'session_id', v_session.id,
    'item', v_item_result->'item'
  );
end;
$$;

create or replace function public.update_order_item_v1(
  p_order_id uuid,
  p_order_item_id uuid,
  p_request_fingerprint text,
  p_item jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_old public.order_items%rowtype;
  v_item public.order_items%rowtype;
  v_invalidates_design boolean;
  v_totals jsonb;
begin
  select id, payment_status, design_status into v_order
  from public.custom_orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.payment_status in ('approved','refunded','charged_back')
     or v_order.design_status = 'locked'
     or exists (
       select 1 from public.payment_attempts where order_id = p_order_id
       and status in ('processing','pending','awaiting_reconciliation')
     ) then raise exception 'order_locked'; end if;

  select * into v_old from public.order_items
  where id = p_order_item_id and order_id = p_order_id for update;
  if not found then raise exception 'order_item_not_found'; end if;

  v_invalidates_design :=
    v_old.pack_id is distinct from nullif(p_item->>'pack_id', '')::uuid
    or v_old.pack_type is distinct from p_item->>'pack_type'
    or v_old.phone_model_id is distinct from nullif(p_item->>'phone_model_id', '')::uuid
    or v_old.garment_id is distinct from nullif(p_item->>'garment_id', '')::uuid
    or v_old.garment_size is distinct from nullif(p_item->>'garment_size', '')
    or v_old.secondary_garment_id is distinct from nullif(p_item->>'secondary_garment_id', '')::uuid
    or v_old.secondary_garment_size is distinct from nullif(p_item->>'secondary_garment_size', '');

  update public.order_items set
    request_fingerprint = p_request_fingerprint,
    pack_id = nullif(p_item->>'pack_id', '')::uuid,
    pack_type = p_item->>'pack_type',
    brand_id = nullif(p_item->>'brand_id', '')::uuid,
    brand = nullif(p_item->>'brand', ''),
    phone_model_id = nullif(p_item->>'phone_model_id', '')::uuid,
    phone_model = nullif(p_item->>'phone_model', ''),
    garment_id = nullif(p_item->>'garment_id', '')::uuid,
    garment_size = nullif(p_item->>'garment_size', ''),
    garment_color = nullif(p_item->>'garment_color', ''),
    secondary_garment_id = nullif(p_item->>'secondary_garment_id', '')::uuid,
    secondary_garment_size = nullif(p_item->>'secondary_garment_size', ''),
    secondary_garment_color = nullif(p_item->>'secondary_garment_color', ''),
    base_price = (p_item->>'base_price')::bigint,
    unit_price = (p_item->>'unit_price')::bigint,
    discount_amount = (p_item->>'discount_amount')::bigint,
    line_total = (p_item->>'line_total')::bigint,
    catalog_snapshot = coalesce(p_item->'catalog_snapshot', '{}'::jsonb),
    design_status = case when v_invalidates_design then 'draft' else design_status end,
    low_resolution_warning = case when v_invalidates_design then false else low_resolution_warning end
  where id = p_order_item_id and order_id = p_order_id
  returning * into v_item;

  v_totals := public.recalculate_order_from_items_v1(p_order_id);
  return jsonb_build_object(
    'ok', true, 'item', to_jsonb(v_item),
    'design_invalidated', v_invalidates_design, 'totals', v_totals
  );
end;
$$;

create or replace function public.remove_order_item_v1(
  p_order_id uuid,
  p_order_item_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_count integer;
  v_totals jsonb;
begin
  select id, payment_status, design_status into v_order
  from public.custom_orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.payment_status in ('approved','refunded','charged_back')
     or v_order.design_status = 'locked'
     or exists (
       select 1 from public.payment_attempts where order_id = p_order_id
       and status in ('processing','pending','awaiting_reconciliation')
     ) then raise exception 'order_locked'; end if;

  select count(*) into v_count from public.order_items
  where order_id = p_order_id and is_active;
  if v_count <= 1 then raise exception 'last_active_item_required'; end if;

  delete from public.order_items
  where id = p_order_item_id and order_id = p_order_id and is_active;
  if not found then raise exception 'order_item_not_found'; end if;

  -- Positions are stable identifiers for ordering. Gaps are intentional after
  -- deletion; avoiding compaction also avoids unique-index update collisions.

  v_totals := public.recalculate_order_from_items_v1(p_order_id);
  return jsonb_build_object('ok', true, 'removed', true, 'totals', v_totals);
end;
$$;

create or replace function public.issue_order_item_upload_authorization_v1(
  p_order_id uuid,
  p_order_item_id uuid,
  p_session_id uuid,
  p_kind text,
  p_storage_path text,
  p_declared_mime text,
  p_declared_size bigint,
  p_ttl_seconds integer
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform 1 from public.custom_orders
  where id = p_order_id
    and payment_status not in ('approved','refunded','charged_back')
    and design_status <> 'locked'
  for update;
  if not found or exists (
    select 1 from public.payment_attempts where order_id = p_order_id
    and status in ('processing','pending','awaiting_reconciliation')
  ) then raise exception 'order_locked'; end if;
  if not exists (
    select 1 from public.payment_sessions
    where id = p_session_id and order_id = p_order_id
      and revoked_at is null and expires_at > now() and absolute_expires_at > now()
  ) then raise exception 'invalid_order_session'; end if;
  if not exists (
    select 1 from public.order_items
    where id = p_order_item_id and order_id = p_order_id and is_active
  ) then raise exception 'order_item_not_found'; end if;
  if p_kind not in ('case','garment','secondary_garment') then raise exception 'invalid_kind'; end if;
  if p_storage_path not like p_order_id::text || '/' || p_order_item_id::text || '/%' then
    raise exception 'invalid_storage_path';
  end if;
  insert into public.order_upload_authorizations (
    order_id, order_item_id, session_id, kind, storage_path,
    declared_mime, declared_size, expires_at
  ) values (
    p_order_id, p_order_item_id, p_session_id, p_kind, p_storage_path,
    p_declared_mime, p_declared_size, now() + make_interval(secs => p_ttl_seconds)
  ) returning id into v_id;
  update public.order_items set design_status = 'uploading'
  where id = p_order_item_id and order_id = p_order_id;
  perform public.recalculate_order_from_items_v1(p_order_id);
  return v_id;
end;
$$;

create or replace function public.consume_order_item_upload_authorization_v1(
  p_order_id uuid,
  p_order_item_id uuid,
  p_session_id uuid,
  p_kind text,
  p_storage_path text,
  p_detected_format text,
  p_detected_width integer,
  p_detected_height integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_auth record;
begin
  perform 1 from public.custom_orders
  where id = p_order_id
    and payment_status not in ('approved','refunded','charged_back')
    and design_status <> 'locked'
  for update;
  if not found or exists (
    select 1 from public.payment_attempts where order_id = p_order_id
    and status in ('processing','pending','awaiting_reconciliation')
  ) then raise exception 'order_locked'; end if;
  select * into v_auth from public.order_upload_authorizations
  where order_id = p_order_id and order_item_id = p_order_item_id
    and session_id = p_session_id and kind = p_kind and storage_path = p_storage_path
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not exists (
    select 1 from public.payment_sessions
    where id = p_session_id and order_id = p_order_id
      and revoked_at is null and expires_at > now() and absolute_expires_at > now()
  ) then return jsonb_build_object('ok', false, 'code', 'invalid_session'); end if;
  if v_auth.status not in ('issued','uploaded') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;
  if v_auth.expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;
  update public.order_upload_authorizations set
    status = 'uploaded', detected_format = p_detected_format,
    detected_width = p_detected_width, detected_height = p_detected_height,
    detected_pixels = p_detected_width::bigint * p_detected_height::bigint,
    uploaded_at = coalesce(uploaded_at, now())
  where id = v_auth.id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.finalize_order_item_designs_v1(
  p_order_id uuid,
  p_order_item_id uuid,
  p_session_id uuid,
  p_case_path text,
  p_garment_path text,
  p_secondary_garment_path text,
  p_case_design jsonb,
  p_garment_design jsonb,
  p_secondary_garment_design jsonb,
  p_bucket text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item record;
  v_auth record;
  v_low_res boolean := coalesce((p_metadata->>'low_resolution_warning')::boolean, false);
  v_dims jsonb;
begin
  select id, payment_status, design_status into v_order
  from public.custom_orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.payment_status in ('approved','refunded','charged_back')
     or v_order.design_status = 'locked'
     or exists (
       select 1 from public.payment_attempts where order_id = p_order_id
       and status in ('processing','pending','awaiting_reconciliation')
     ) then raise exception 'order_locked'; end if;
  if not exists (
    select 1 from public.payment_sessions
    where id = p_session_id and order_id = p_order_id
      and revoked_at is null and expires_at > now() and absolute_expires_at > now()
  ) then raise exception 'invalid_order_session'; end if;
  select * into v_item from public.order_items
  where id = p_order_item_id and order_id = p_order_id and is_active for update;
  if not found then raise exception 'order_item_not_found'; end if;

  if p_case_path is null then raise exception 'case_path_required'; end if;
  if v_item.pack_type = 'carcasa' and (p_garment_path is not null or p_secondary_garment_path is not null) then
    raise exception 'garment_path_not_allowed';
  elsif v_item.pack_type in ('carcasa+polera','carcasa+poleron')
        and (p_garment_path is null or p_secondary_garment_path is not null) then
    raise exception 'invalid_garment_paths';
  elsif v_item.pack_type = 'carcasa+polera+poleron'
        and (p_garment_path is null or p_secondary_garment_path is null) then
    raise exception 'complete_pack_paths_required';
  end if;
  if p_case_path = p_garment_path or p_case_path = p_secondary_garment_path
     or (p_garment_path is not null and p_garment_path = p_secondary_garment_path) then
    raise exception 'duplicate_design_path';
  end if;

  for v_auth in
    select * from public.order_upload_authorizations
    where order_id = p_order_id and order_item_id = p_order_item_id
      and session_id = p_session_id
      and storage_path in (p_case_path, p_garment_path, p_secondary_garment_path)
    for update
  loop
    if v_auth.status <> 'uploaded' or v_auth.expires_at < now() then
      raise exception 'upload_authorization_not_ready';
    end if;
  end loop;
  if not exists (select 1 from public.order_upload_authorizations where order_id = p_order_id and order_item_id = p_order_item_id and session_id = p_session_id and kind = 'case' and storage_path = p_case_path and status = 'uploaded') then
    raise exception 'case_authorization_missing';
  end if;
  if p_garment_path is not null and not exists (select 1 from public.order_upload_authorizations where order_id = p_order_id and order_item_id = p_order_item_id and session_id = p_session_id and kind = 'garment' and storage_path = p_garment_path and status = 'uploaded') then
    raise exception 'garment_authorization_missing';
  end if;
  if p_secondary_garment_path is not null and not exists (select 1 from public.order_upload_authorizations where order_id = p_order_id and order_item_id = p_order_item_id and session_id = p_session_id and kind = 'secondary_garment' and storage_path = p_secondary_garment_path and status = 'uploaded') then
    raise exception 'secondary_authorization_missing';
  end if;

  delete from public.final_designs where order_item_id = p_order_item_id;
  insert into public.final_designs (
    order_id, order_item_id, phone_model_id, garment_id, garment_size,
    secondary_garment_id, secondary_garment_size,
    case_design, garment_design, secondary_garment_design,
    editor_schema_version, template_version, mold_version,
    validated_at, low_resolution_warning
  ) values (
    p_order_id, p_order_item_id, v_item.phone_model_id, v_item.garment_id, v_item.garment_size,
    v_item.secondary_garment_id, v_item.secondary_garment_size,
    p_case_design, p_garment_design, p_secondary_garment_design,
    p_metadata->>'editor_schema_version', p_metadata->>'template_version',
    p_metadata->>'mold_version', now(), v_low_res
  );

  delete from public.design_assets where order_item_id = p_order_item_id;
  v_dims := coalesce(p_metadata->'case_dimensions', '{}'::jsonb);
  insert into public.design_assets (order_id, order_item_id, file_path, kind, file_type, metadata, width, height, detected_format)
  values (p_order_id, p_order_item_id, p_case_path, 'case', 'image', jsonb_build_object('bucket', p_bucket) || v_dims,
    nullif((v_dims->>'width')::integer, 0), nullif((v_dims->>'height')::integer, 0), v_dims->>'format');
  if p_garment_path is not null then
    v_dims := coalesce(p_metadata->'garment_dimensions', '{}'::jsonb);
    insert into public.design_assets (order_id, order_item_id, file_path, kind, file_type, metadata, width, height, detected_format)
    values (p_order_id, p_order_item_id, p_garment_path, 'garment', 'image', jsonb_build_object('bucket', p_bucket) || v_dims,
      nullif((v_dims->>'width')::integer, 0), nullif((v_dims->>'height')::integer, 0), v_dims->>'format');
  end if;
  if p_secondary_garment_path is not null then
    v_dims := coalesce(p_metadata->'secondary_garment_dimensions', '{}'::jsonb);
    insert into public.design_assets (order_id, order_item_id, file_path, kind, file_type, metadata, width, height, detected_format)
    values (p_order_id, p_order_item_id, p_secondary_garment_path, 'secondary_garment', 'image', jsonb_build_object('bucket', p_bucket) || v_dims,
      nullif((v_dims->>'width')::integer, 0), nullif((v_dims->>'height')::integer, 0), v_dims->>'format');
  end if;

  update public.order_upload_authorizations set status = 'finalized', finalized_at = now()
  where order_id = p_order_id and order_item_id = p_order_item_id
    and session_id = p_session_id
    and storage_path in (p_case_path, p_garment_path, p_secondary_garment_path);
  update public.order_items set design_status = 'ready', low_resolution_warning = v_low_res
  where id = p_order_item_id and order_id = p_order_id;
  perform public.recalculate_order_from_items_v1(p_order_id);
  return jsonb_build_object('ok', true, 'low_resolution_warning', v_low_res);
end;
$$;

create or replace function public.mark_order_item_design_failed_v1(
  p_order_id uuid,
  p_order_item_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.custom_orders
  where id = p_order_id
    and payment_status not in ('approved','refunded','charged_back')
    and design_status <> 'locked'
  for update;
  if not found or exists (
    select 1 from public.payment_attempts where order_id = p_order_id
    and status in ('processing','pending','awaiting_reconciliation')
  ) then raise exception 'order_locked'; end if;

  update public.order_items set design_status = 'failed'
  where id = p_order_item_id and order_id = p_order_id and is_active;
  if not found then raise exception 'order_item_not_found'; end if;
  perform public.recalculate_order_from_items_v1(p_order_id);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.recalculate_order_from_items_v1(uuid) from public, anon, authenticated;
revoke all on function public.add_order_item_v1(uuid,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.create_order_with_first_item_v1(jsonb,text,text,jsonb,text,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.update_order_item_v1(uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.remove_order_item_v1(uuid,uuid) from public, anon, authenticated;
revoke all on function public.issue_order_item_upload_authorization_v1(uuid,uuid,uuid,text,text,text,bigint,integer) from public, anon, authenticated;
revoke all on function public.consume_order_item_upload_authorization_v1(uuid,uuid,uuid,text,text,text,integer,integer) from public, anon, authenticated;
revoke all on function public.finalize_order_item_designs_v1(uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,text,jsonb) from public, anon, authenticated;
revoke all on function public.mark_order_item_design_failed_v1(uuid,uuid) from public, anon, authenticated;

grant execute on function public.recalculate_order_from_items_v1(uuid) to service_role;
grant execute on function public.add_order_item_v1(uuid,text,text,jsonb) to service_role;
grant execute on function public.create_order_with_first_item_v1(jsonb,text,text,jsonb,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.update_order_item_v1(uuid,uuid,text,jsonb) to service_role;
grant execute on function public.remove_order_item_v1(uuid,uuid) to service_role;
grant execute on function public.issue_order_item_upload_authorization_v1(uuid,uuid,uuid,text,text,text,bigint,integer) to service_role;
grant execute on function public.consume_order_item_upload_authorization_v1(uuid,uuid,uuid,text,text,text,integer,integer) to service_role;
grant execute on function public.finalize_order_item_designs_v1(uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,text,jsonb) to service_role;
grant execute on function public.mark_order_item_design_failed_v1(uuid,uuid) to service_role;
