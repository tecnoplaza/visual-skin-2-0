-- VisualSkin notification system. Notification failures must never abort the
-- canonical order/payment transition that caused them.

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  recipient_type text not null check (recipient_type in ('customer','admin')),
  recipient_email text,
  order_id uuid references public.custom_orders(id) on delete cascade,
  payment_attempt_id uuid references public.payment_attempts(id) on delete set null,
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint notification_outbox_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint notification_outbox_email_length check (recipient_email is null or length(recipient_email) <= 320),
  constraint notification_outbox_error_length check (last_error is null or length(last_error) <= 500)
);

create index if not exists notification_outbox_dispatch_idx
  on public.notification_outbox(status, next_attempt_at, created_at)
  where status in ('pending','failed');

create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  severity text not null check (severity in ('info','success','warning','critical')),
  title text not null check (length(title) between 1 and 160),
  message text not null check (length(message) between 1 and 500),
  order_id uuid references public.custom_orders(id) on delete set null,
  payment_attempt_id uuid references public.payment_attempts(id) on delete set null,
  dedupe_key text not null unique,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint admin_notifications_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists admin_notifications_unread_idx
  on public.admin_notifications(is_read, created_at desc);

alter table public.notification_outbox enable row level security;
alter table public.admin_notifications enable row level security;

revoke all on public.notification_outbox from public, anon, authenticated;
revoke all on public.admin_notifications from public, anon, authenticated;
grant all on public.notification_outbox to service_role;
grant select on public.admin_notifications to authenticated;
grant all on public.admin_notifications to service_role;

drop policy if exists "Admins read notifications" on public.admin_notifications;
create policy "Admins read notifications" on public.admin_notifications
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
drop policy if exists "Admins update notifications" on public.admin_notifications;
create policy "Admins update notifications" on public.admin_notifications
  for update to authenticated using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create or replace function public.admin_list_notifications(p_limit integer default 20)
returns setof public.admin_notifications
language sql security invoker set search_path=public stable as $$
  select * from public.admin_notifications
  order by created_at desc limit least(greatest(coalesce(p_limit,20),1),100)
$$;

create or replace function public.admin_unread_notification_count()
returns bigint language sql security invoker set search_path=public stable as $$
  select count(*) from public.admin_notifications where not is_read
$$;

create or replace function public.admin_mark_notification_read(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'forbidden'; end if;
  update public.admin_notifications set is_read=true, read_at=coalesce(read_at,now())
  where id=p_notification_id and not is_read;
  return found;
end $$;

create or replace function public.admin_mark_all_notifications_read()
returns bigint language plpgsql security definer set search_path=public as $$
declare v_count bigint;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'forbidden'; end if;
  update public.admin_notifications set is_read=true, read_at=coalesce(read_at,now()) where not is_read;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.admin_list_notifications(integer) from public,anon;
revoke all on function public.admin_unread_notification_count() from public,anon;
revoke all on function public.admin_mark_notification_read(uuid) from public,anon;
revoke all on function public.admin_mark_all_notifications_read() from public,anon;
grant execute on function public.admin_list_notifications(integer) to authenticated,service_role;
grant execute on function public.admin_unread_notification_count() to authenticated,service_role;
grant execute on function public.admin_mark_notification_read(uuid) to authenticated,service_role;
grant execute on function public.admin_mark_all_notifications_read() to authenticated,service_role;

create or replace function public.claim_notification_outbox_v1(p_limit integer default 20)
returns setof public.notification_outbox language plpgsql security definer set search_path=public as $$
begin
  return query
  with candidates as (
    select id from public.notification_outbox
    where (status='pending' or (status='failed' and attempt_count < 8)
      or (status='sending' and next_attempt_at <= now() and attempt_count < 8))
      and coalesce(next_attempt_at,created_at) <= now()
    order by created_at for update skip locked limit least(greatest(coalesce(p_limit,20),1),50)
  )
  update public.notification_outbox o set status='sending',attempt_count=attempt_count+1,
    next_attempt_at=now()+interval '15 minutes',last_error=null
  from candidates c where o.id=c.id returning o.*;
end $$;

create or replace function public.complete_notification_outbox_v1(p_id uuid)
returns void language sql security definer set search_path=public as $$
  update public.notification_outbox set status='sent',sent_at=now(),next_attempt_at=null,last_error=null
  where id=p_id and status='sending'
$$;

create or replace function public.fail_notification_outbox_v1(p_id uuid,p_error text)
returns void language sql security definer set search_path=public as $$
  update public.notification_outbox set status='failed',last_error=left(coalesce(p_error,'provider_error'),500),
    next_attempt_at=now()+(least(3600,power(2,least(attempt_count,10))::integer*30)||' seconds')::interval
  where id=p_id and status='sending'
$$;

revoke all on function public.claim_notification_outbox_v1(integer) from public,anon,authenticated;
revoke all on function public.complete_notification_outbox_v1(uuid) from public,anon,authenticated;
revoke all on function public.fail_notification_outbox_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_notification_outbox_v1(integer) to service_role;
grant execute on function public.complete_notification_outbox_v1(uuid) to service_role;
grant execute on function public.fail_notification_outbox_v1(uuid,text) to service_role;

-- Only allow an explicit, non-sensitive payload shape. No provider payloads,
-- tokens, signatures, raw status_detail or card/customer documents are copied.
create or replace function public.enqueue_order_notification_v1(
  p_event_type text, p_recipient_type text, p_order_id uuid,
  p_attempt_id uuid, p_dedupe_key text, p_payload jsonb,
  p_admin_severity text default null, p_admin_title text default null,
  p_admin_message text default null
) returns void language plpgsql security definer set search_path=public as $$
declare v_email text;
begin
  select case when p_recipient_type='customer' then customer_email else null end
    into v_email from public.custom_orders where id=p_order_id;
  insert into public.notification_outbox(event_type,recipient_type,recipient_email,order_id,
    payment_attempt_id,dedupe_key,payload)
  values(p_event_type,p_recipient_type,v_email,p_order_id,p_attempt_id,p_dedupe_key,p_payload)
  on conflict(dedupe_key) do nothing;
  if p_admin_title is not null then
    insert into public.admin_notifications(type,severity,title,message,order_id,payment_attempt_id,
      dedupe_key,metadata)
    values(p_event_type,coalesce(p_admin_severity,'info'),left(p_admin_title,160),
      left(coalesce(p_admin_message,''),500),p_order_id,p_attempt_id,p_dedupe_key,
      jsonb_build_object('event_type',p_event_type))
    on conflict(dedupe_key) do nothing;
  end if;
exception when others then
  raise warning 'notification enqueue ignored for %: %', p_dedupe_key, sqlerrm;
end $$;

revoke all on function public.enqueue_order_notification_v1(text,text,uuid,uuid,text,jsonb,text,text,text)
  from public,anon,authenticated;
grant execute on function public.enqueue_order_notification_v1(text,text,uuid,uuid,text,jsonb,text,text,text)
  to service_role;

create or replace function public.notify_order_received_from_snapshot_v1()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_items integer; v_order record; v_products jsonb;
begin
  -- Initial order creation only contains the first item. The immutable checkout
  -- snapshot is the first existing boundary where the complete active cart and
  -- every economic total have already been validated together.
  select * into v_order from public.custom_orders where id=new.order_id;
  select coalesce(sum((item->>'quantity')::integer),0)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'pack_type',item->>'pack_type','quantity',(item->>'quantity')::integer)
      order by (item->>'position')::integer,item->>'id'),'[]'::jsonb)
    into v_items,v_products
  from jsonb_array_elements(coalesce(new.canonical_cart->'items','[]'::jsonb)) item;
  if v_items <= 0 or v_order.id is null then return new; end if;
  perform public.enqueue_order_notification_v1('order_received','customer',new.order_id,null,
    'customer:order_received:'||new.order_id,
    jsonb_build_object('order_number',v_order.order_number,'customer_name',v_order.customer_name,
      'subtotal_amount',new.subtotal_amount,'shipping_amount',new.shipping_amount,
      'total_amount',new.total_amount,'currency',new.currency,'item_count',v_items,
      'products',v_products),null,null,null);
  return new;
exception when others then raise warning 'order notification ignored: %',sqlerrm; return new;
end $$;

drop trigger if exists notify_order_received_from_snapshot_v1 on public.payment_checkout_snapshots;
create trigger notify_order_received_from_snapshot_v1
after insert on public.payment_checkout_snapshots
for each row execute function public.notify_order_received_from_snapshot_v1();

create or replace function public.notify_payment_transition_v1()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_attempt uuid; v_payment_ref text; v_items integer; v_payload jsonb;
begin
  if new.payment_status is not distinct from old.payment_status then return new; end if;
  select id,coalesce(mercado_pago_payment_id,id::text) into v_attempt,v_payment_ref
    from public.payment_attempts where order_id=new.id
    order by updated_at desc nulls last,created_at desc limit 1;
  select coalesce(sum(quantity),0)::integer into v_items from public.order_items
    where order_id=new.id and is_active;
  v_payload:=jsonb_build_object('order_number',new.order_number,'customer_name',new.customer_name,
    'total_amount',new.total_amount,'currency',new.currency,'item_count',v_items);
  if new.payment_status='approved' then
    perform public.enqueue_order_notification_v1('payment_approved','customer',new.id,v_attempt,
      'customer:payment_approved:'||new.id||':'||coalesce(v_payment_ref,'order'),v_payload,null,null,null);
    perform public.enqueue_order_notification_v1('admin_new_paid_order','admin',new.id,v_attempt,
      'admin:new_paid_order:'||new.id||':'||coalesce(v_payment_ref,'order'),v_payload,'success',
      'Nuevo pedido pagado - '||coalesce(new.order_number,new.id::text),
      coalesce(new.customer_name,'Cliente')||' - '||v_items||' producto(s)');
  elsif new.payment_status in ('rejected','cancelled','refunded') then
    perform public.enqueue_order_notification_v1(
      case when new.payment_status='refunded' then 'refunded' else 'payment_'||new.payment_status end,
      'customer',new.id,v_attempt,
      'customer:'||case when new.payment_status='refunded' then 'refunded' else 'payment_'||new.payment_status end||':'||new.id||':'||coalesce(v_payment_ref,'order'),
      v_payload,null,null,null);
    if new.payment_status='refunded' then
      perform public.enqueue_order_notification_v1('admin_refund','admin',new.id,v_attempt,
        'admin:refund:'||new.id||':'||coalesce(v_payment_ref,'order'),v_payload,'warning',
        'Reembolso - '||coalesce(new.order_number,new.id::text),'Se proceso un reembolso del pedido.');
    end if;
  elsif new.payment_status='charged_back' then
    perform public.enqueue_order_notification_v1('admin_chargeback','admin',new.id,v_attempt,
      'admin:chargeback:'||new.id||':'||coalesce(v_payment_ref,'order'),v_payload,'critical',
      'Contracargo - '||coalesce(new.order_number,new.id::text),'Pago revertido: requiere atencion inmediata.');
  end if;
  return new;
exception when others then raise warning 'payment notification ignored: %',sqlerrm; return new;
end $$;

drop trigger if exists notify_payment_transition_v1 on public.custom_orders;
create trigger notify_payment_transition_v1 after update of payment_status on public.custom_orders
for each row execute function public.notify_payment_transition_v1();

create or replace function public.notify_fulfillment_transition_v1()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_event text; v_payload jsonb;
begin
  if new.fulfillment_status is not distinct from old.fulfillment_status then return new; end if;
  v_event:=case new.fulfillment_status when 'in_production' then 'production_started'
    when 'ready' then 'ready_for_shipping' when 'shipped' then 'shipped'
    when 'completed' then 'completed' else null end;
  if v_event is null then return new; end if;
  v_payload:=jsonb_build_object('order_number',new.order_number,'customer_name',new.customer_name,
    'total_amount',new.total_amount,'currency',new.currency,
    'fulfillment_status',new.fulfillment_status);
  perform public.enqueue_order_notification_v1(v_event,'customer',new.id,null,
    'customer:'||v_event||':'||new.id,v_payload,null,null,null);
  return new;
exception when others then raise warning 'fulfillment notification ignored: %',sqlerrm; return new;
end $$;

drop trigger if exists notify_fulfillment_transition_v1 on public.custom_orders;
create trigger notify_fulfillment_transition_v1 after update of fulfillment_status on public.custom_orders
for each row execute function public.notify_fulfillment_transition_v1();

create or replace function public.notify_review_transition_v1()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_order record; v_event text; v_severity text; v_reason text;
begin
  if new.status is not distinct from old.status then return new; end if;
  select order_number,customer_name,total_amount,currency into v_order
    from public.custom_orders where id=new.order_id;
  if new.status='awaiting_reconciliation' then
    v_event:='admin_payment_reconciliation'; v_severity:='warning';
    v_reason:='El intento de pago quedo pendiente de conciliacion.';
    perform public.enqueue_order_notification_v1(v_event,'admin',new.order_id,new.id,
      'admin:reconciliation:'||new.id,
      jsonb_build_object('order_number',v_order.order_number,'attempt_id',new.id,'reason',v_reason,
        'total_amount',v_order.total_amount,'currency',v_order.currency),v_severity,
      'conciliacion requerida - '||coalesce(v_order.order_number,new.order_id::text),v_reason);
  end if;
  return new;
exception when others then raise warning 'attempt notification ignored: %',sqlerrm; return new;
end $$;

drop trigger if exists notify_review_transition_v1 on public.payment_attempts;
create trigger notify_review_transition_v1 after update of status on public.payment_attempts
for each row execute function public.notify_review_transition_v1();

create or replace function public.notify_manual_review_v1()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_attempt uuid;
begin
  if not new.manual_review_required or old.manual_review_required then return new; end if;
  select id into v_attempt from public.payment_attempts where order_id=new.id
    order by updated_at desc nulls last,created_at desc limit 1;
  perform public.enqueue_order_notification_v1('admin_manual_review','admin',new.id,v_attempt,
    'admin:manual_review:'||new.id||':'||coalesce(v_attempt::text,'order'),
    jsonb_build_object('order_number',new.order_number,'attempt_id',v_attempt,
      'reason','Revision manual requerida'),'warning',
    'Revision manual - '||coalesce(new.order_number,new.id::text),'El pedido requiere Revision manual.');
  return new;
exception when others then raise warning 'manual review notification ignored: %',sqlerrm; return new;
end $$;

drop trigger if exists notify_manual_review_v1 on public.custom_orders;
create trigger notify_manual_review_v1 after update of manual_review_required on public.custom_orders
for each row execute function public.notify_manual_review_v1();

revoke all on function public.notify_order_received_from_snapshot_v1() from public,anon,authenticated;
revoke all on function public.notify_payment_transition_v1() from public,anon,authenticated;
revoke all on function public.notify_fulfillment_transition_v1() from public,anon,authenticated;
revoke all on function public.notify_review_transition_v1() from public,anon,authenticated;
revoke all on function public.notify_manual_review_v1() from public,anon,authenticated;
