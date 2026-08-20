-- Canonical, extensible preview persistence. Customer originals remain in
-- design_assets and are deliberately not referenced by this table.
create table if not exists public.order_item_previews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.custom_orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  slot text not null check (slot ~ '^[a-z][a-z0-9_]{0,79}$'),
  storage_path text not null check (
    length(storage_path) between 1 and 300
    and storage_path not like '%..%'
    and storage_path not like '%//%'
    and storage_path like order_id::text || '/' || order_item_id::text || '/%'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_item_id, slot)
);

create index if not exists order_item_previews_order_idx
  on public.order_item_previews(order_id, order_item_id);

alter table public.order_item_previews enable row level security;
revoke all on public.order_item_previews from public, anon, authenticated;
grant all on public.order_item_previews to service_role;

create or replace function public.assert_order_item_preview_ownership()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.order_items oi
    where oi.id = new.order_item_id
      and oi.order_id = new.order_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'order_item_previews_order_item_mismatch';
  end if;
  return new;
end
$$;

revoke all on function public.assert_order_item_preview_ownership() from public;

drop trigger if exists order_item_previews_ownership on public.order_item_previews;
create trigger order_item_previews_ownership
before insert or update of order_id, order_item_id on public.order_item_previews
for each row execute function public.assert_order_item_preview_ownership();

drop trigger if exists order_item_previews_updated on public.order_item_previews;
create trigger order_item_previews_updated before update on public.order_item_previews
for each row execute function public.tg_set_updated_at();

-- Safe backfill for previews persisted by the fixed-column implementation.
insert into public.order_item_previews (order_id, order_item_id, slot, storage_path)
select fd.order_id, fd.order_item_id, preview.slot, preview.storage_path
from public.final_designs fd
join public.order_items oi
  on oi.id = fd.order_item_id
 and oi.order_id = fd.order_id
cross join lateral (values
  ('case'::text, to_jsonb(fd)->>'case_preview_url'),
  ('garment', to_jsonb(fd)->>'garment_preview_url'),
  ('secondary_garment', to_jsonb(fd)->>'secondary_garment_preview_url')
) preview(slot, storage_path)
where fd.order_item_id is not null
  and preview.storage_path is not null
  and preview.storage_path <> ''
  and length(preview.storage_path) between 1 and 300
  and preview.storage_path not like '%..%'
  and preview.storage_path not like '%//%'
  and preview.storage_path like fd.order_id::text || '/' || fd.order_item_id::text || '/%'
on conflict (order_item_id, slot) do update set storage_path = excluded.storage_path;
