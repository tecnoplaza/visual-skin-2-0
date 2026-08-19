-- VisualSkin first-party analytics and public pixel configuration.
-- Local migration only. No advertising API secrets belong in these tables.

create table if not exists public.analytics_settings (
  provider text primary key check (provider in ('meta','ga4','google_ads','tiktok')),
  enabled boolean not null default false,
  public_id text,
  conversion_id text,
  conversion_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analytics_settings_fields check (
    (provider = 'meta' and (public_id is null or public_id ~ '^[0-9]{5,30}$') and conversion_id is null and conversion_label is null)
    or (provider = 'ga4' and (public_id is null or public_id ~ '^G-[A-Z0-9]{4,20}$') and conversion_id is null and conversion_label is null)
    or (provider = 'google_ads' and public_id is null and (conversion_id is null or conversion_id ~ '^AW-[0-9]{5,20}$') and (conversion_label is null or conversion_label ~ '^[A-Za-z0-9_-]{1,100}$'))
    or (provider = 'tiktok' and (public_id is null or public_id ~ '^[A-Z0-9]{10,30}$') and conversion_id is null and conversion_label is null)
  ),
  constraint analytics_enabled_requires_id check (
    not enabled or (case when provider = 'google_ads' then conversion_id is not null and conversion_label is not null else public_id is not null end)
  )
);

insert into public.analytics_settings(provider) values
  ('meta'), ('ga4'), ('google_ads'), ('tiktok')
on conflict (provider) do nothing;

drop trigger if exists analytics_settings_updated on public.analytics_settings;
create trigger analytics_settings_updated before update on public.analytics_settings
for each row execute function public.tg_set_updated_at();

alter table public.analytics_settings enable row level security;
revoke all on public.analytics_settings from public, anon, authenticated;
grant select(provider,enabled,public_id,conversion_id,conversion_label) on public.analytics_settings to anon, authenticated;
grant insert, update, delete on public.analytics_settings to authenticated;
grant all on public.analytics_settings to service_role;
drop policy if exists "Public reads pixel configuration" on public.analytics_settings;
create policy "Public reads pixel configuration" on public.analytics_settings for select
using (enabled or public.has_role(auth.uid(),'admin'));
drop policy if exists "Admins manage pixel configuration" on public.analytics_settings;
create policy "Admins manage pixel configuration" on public.analytics_settings for all to authenticated
using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (event_name in ('page_view','view_item','customizer_started','customizer_completed','add_to_cart','remove_from_cart','begin_checkout','add_payment_info','purchase','checkout_shipping_completed','payment_rejected')),
  session_id text not null check (session_id ~ '^vs_s_[A-Za-z0-9_-]{16,80}$'),
  anonymous_id text check (anonymous_id is null or anonymous_id ~ '^vs_a_[A-Za-z0-9_-]{16,80}$'),
  order_id uuid references public.custom_orders(id) on delete set null,
  order_item_id uuid references public.order_items(id) on delete set null,
  pack_type text,
  phone_brand text,
  phone_model text,
  value numeric,
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  path text check (path is null or (length(path) <= 300 and path like '/%')),
  referrer_host text check (referrer_host is null or length(referrer_host) <= 253),
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint analytics_events_text_limits check (
    length(coalesce(pack_type,'')) <= 80 and length(coalesce(phone_brand,'')) <= 120 and
    length(coalesce(phone_model,'')) <= 120 and length(coalesce(utm_source,'')) <= 120 and
    length(coalesce(utm_medium,'')) <= 120 and length(coalesce(utm_campaign,'')) <= 160 and
    length(coalesce(utm_content,'')) <= 160 and length(coalesce(utm_term,'')) <= 160
  ),
  constraint analytics_events_metadata_shape check (
    jsonb_typeof(metadata) = 'object' and
    metadata - array['quantity','item_count','step','source','item_ids']::text[] = '{}'::jsonb and
    pg_column_size(metadata) <= 2048
  )
);
create index if not exists analytics_events_created_at_idx on public.analytics_events(created_at desc);
create index if not exists analytics_events_event_created_idx on public.analytics_events(event_name, created_at desc);
create index if not exists analytics_events_order_id_idx on public.analytics_events(order_id) where order_id is not null;
create index if not exists analytics_events_session_id_idx on public.analytics_events(session_id, created_at desc);
create index if not exists analytics_events_utm_source_idx on public.analytics_events(utm_source, created_at desc) where utm_source is not null;
alter table public.analytics_events enable row level security;
revoke all on public.analytics_events from public, anon, authenticated;
grant select on public.analytics_events to authenticated;
grant all on public.analytics_events to service_role;
drop policy if exists "Admins read analytics events" on public.analytics_events;
create policy "Admins read analytics events" on public.analytics_events for select to authenticated
using (public.has_role(auth.uid(),'admin'));

create table if not exists public.analytics_conversion_events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  order_id uuid not null references public.custom_orders(id) on delete restrict,
  payment_id text not null,
  analytics_event_id uuid not null references public.analytics_events(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists analytics_conversion_order_idx on public.analytics_conversion_events(order_id);
alter table public.analytics_conversion_events enable row level security;
revoke all on public.analytics_conversion_events from public, anon, authenticated;
grant select on public.analytics_conversion_events to authenticated;
grant all on public.analytics_conversion_events to service_role;
drop policy if exists "Admins read conversion dedupe" on public.analytics_conversion_events;
create policy "Admins read conversion dedupe" on public.analytics_conversion_events for select to authenticated
using (public.has_role(auth.uid(),'admin'));

create or replace function public.track_visualskin_event(
  p_event_name text, p_session_id text, p_anonymous_id text default null,
  p_order_id uuid default null, p_order_item_id uuid default null,
  p_pack_type text default null, p_phone_brand text default null, p_phone_model text default null,
  p_path text default null, p_referrer_host text default null,
  p_utm_source text default null, p_utm_medium text default null, p_utm_campaign text default null,
  p_utm_content text default null, p_utm_term text default null, p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_event_name = 'purchase' then raise exception 'purchase_requires_backend_claim'; end if;
  insert into public.analytics_events(event_name,session_id,anonymous_id,order_id,order_item_id,pack_type,phone_brand,phone_model,path,referrer_host,utm_source,utm_medium,utm_campaign,utm_content,utm_term,metadata)
  values(p_event_name,left(p_session_id,85),nullif(left(coalesce(p_anonymous_id,''),85),''),p_order_id,p_order_item_id,left(p_pack_type,80),left(p_phone_brand,120),left(p_phone_model,120),left(p_path,300),left(p_referrer_host,253),left(p_utm_source,120),left(p_utm_medium,120),left(p_utm_campaign,160),left(p_utm_content,160),left(p_utm_term,160),coalesce(p_metadata,'{}'::jsonb)) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.track_visualskin_event(text,text,text,uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb) from public;
grant execute on function public.track_visualskin_event(text,text,text,uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb) to service_role;

create or replace function public.claim_approved_purchase_event(p_order_id uuid,p_session_id text,p_anonymous_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.custom_orders%rowtype; v_payment text; v_key text; v_event uuid; v_existing uuid;
begin
  select * into v_order from public.custom_orders where id=p_order_id and payment_status='approved';
  if not found then return jsonb_build_object('ok',false,'code','not_approved'); end if;
  select mercado_pago_payment_id into v_payment
  from public.payment_attempts
  where order_id=v_order.id and status='approved'
    and mercado_pago_payment_id=nullif(v_order.mp_payment_id,'')
  order by updated_at desc limit 1;
  if v_payment is null then return jsonb_build_object('ok',false,'code','missing_approved_payment_id'); end if;
  v_key := 'purchase:'||v_order.id::text||':'||v_payment;
  select analytics_event_id into v_existing from public.analytics_conversion_events where dedupe_key=v_key;
  if v_existing is not null then return jsonb_build_object('ok',true,'deduplicated',true,'event_id',v_existing); end if;
  insert into public.analytics_events(event_name,session_id,anonymous_id,order_id,value,currency,metadata)
  values('purchase',p_session_id,p_anonymous_id,v_order.id,v_order.total_amount,v_order.currency,jsonb_build_object('item_count',(select coalesce(sum(quantity),0) from public.order_items where order_id=v_order.id and is_active))) returning id into v_event;
  insert into public.analytics_conversion_events(dedupe_key,order_id,payment_id,analytics_event_id)
  values(v_key,v_order.id,v_payment,v_event) on conflict (dedupe_key) do nothing;
  if not found then delete from public.analytics_events where id=v_event; select analytics_event_id into v_event from public.analytics_conversion_events where dedupe_key=v_key; return jsonb_build_object('ok',true,'deduplicated',true,'event_id',v_event); end if;
  return jsonb_build_object('ok',true,'deduplicated',false,'event_id',v_event,'order_id',v_order.id,'order_number',v_order.order_number,'value',v_order.total_amount,'currency',v_order.currency,'items',(select coalesce(jsonb_agg(jsonb_build_object('item_id',id,'pack_type',pack_type,'brand',brand,'model',phone_model,'quantity',quantity,'unit_price',unit_price) order by position),'[]'::jsonb) from public.order_items where order_id=v_order.id and is_active));
end $$;
revoke all on function public.claim_approved_purchase_event(uuid,text,text) from public, anon, authenticated;
grant execute on function public.claim_approved_purchase_event(uuid,text,text) to service_role;

create or replace function public.admin_analytics_dashboard(p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'forbidden'; end if;
  if p_to <= p_from or p_to-p_from > interval '366 days' then raise exception 'invalid_range'; end if;
  select jsonb_build_object(
    'visitors',(select count(distinct anonymous_id) from analytics_events where created_at>=p_from and created_at<p_to),
    'sessions',(select count(distinct session_id) from analytics_events where created_at>=p_from and created_at<p_to),
    'views',(select count(*) from analytics_events where event_name='page_view' and created_at>=p_from and created_at<p_to),
    'events',(select coalesce(jsonb_object_agg(event_name,n),'{}'::jsonb) from (select event_name,count(*) n from analytics_events where created_at>=p_from and created_at<p_to group by event_name) x),
    'sales',(select jsonb_build_object('orders',count(*),'revenue',coalesce(sum(total_amount),0),'average_order_value',coalesce(avg(total_amount),0)) from custom_orders where payment_status='approved' and coalesce(payment_status_updated_at,created_at)>=p_from and coalesce(payment_status_updated_at,created_at)<p_to),
    'products',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select oi.pack_type,oi.brand,oi.phone_model,sum(oi.quantity) quantity,sum(oi.line_total) revenue from order_items oi join custom_orders o on o.id=oi.order_id where o.payment_status='approved' and coalesce(o.payment_status_updated_at,o.created_at)>=p_from and coalesce(o.payment_status_updated_at,o.created_at)<p_to and oi.is_active group by oi.pack_type,oi.brand,oi.phone_model order by quantity desc limit 50) x),
    'sources',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select coalesce(utm_source,'Directo') source,coalesce(utm_medium,'') medium,utm_campaign,count(distinct session_id) sessions from analytics_events where created_at>=p_from and created_at<p_to group by utm_source,utm_medium,utm_campaign order by sessions desc limit 50) x)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.admin_analytics_dashboard(timestamptz,timestamptz) from public,anon;
grant execute on function public.admin_analytics_dashboard(timestamptz,timestamptz) to authenticated,service_role;
