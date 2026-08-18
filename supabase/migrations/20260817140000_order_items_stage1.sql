-- VisualSkin multi-item orders, stage 1.
-- Additive compatibility layer only: existing checkout and legacy columns remain unchanged.

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.custom_orders(id) on delete cascade,
  position integer not null,
  quantity integer not null default 1,
  client_item_key text not null,
  request_fingerprint text not null,
  pack_id uuid references public.promo_packs(id) on delete set null,
  pack_type text not null,
  brand_id uuid references public.brands(id) on delete set null,
  brand text,
  phone_model_id uuid references public.phone_models(id) on delete set null,
  phone_model text,
  garment_id uuid references public.garments(id) on delete set null,
  garment_size text,
  garment_color text,
  secondary_garment_id uuid references public.garments(id) on delete set null,
  secondary_garment_size text,
  secondary_garment_color text,
  base_price bigint not null,
  unit_price bigint not null,
  discount_amount bigint not null default 0,
  line_total bigint not null,
  catalog_snapshot jsonb not null default '{}'::jsonb,
  design_status text not null default 'draft',
  low_resolution_warning boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tolerate a partially-created table on environments whose migration history
-- is not perfectly synchronized with this repository.
alter table public.order_items
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists order_id uuid references public.custom_orders(id) on delete cascade,
  add column if not exists position integer,
  add column if not exists quantity integer default 1,
  add column if not exists client_item_key text,
  add column if not exists request_fingerprint text,
  add column if not exists pack_id uuid references public.promo_packs(id) on delete set null,
  add column if not exists pack_type text,
  add column if not exists brand_id uuid references public.brands(id) on delete set null,
  add column if not exists brand text,
  add column if not exists phone_model_id uuid references public.phone_models(id) on delete set null,
  add column if not exists phone_model text,
  add column if not exists garment_id uuid references public.garments(id) on delete set null,
  add column if not exists garment_size text,
  add column if not exists garment_color text,
  add column if not exists secondary_garment_id uuid references public.garments(id) on delete set null,
  add column if not exists secondary_garment_size text,
  add column if not exists secondary_garment_color text,
  add column if not exists base_price bigint,
  add column if not exists unit_price bigint,
  add column if not exists discount_amount bigint default 0,
  add column if not exists line_total bigint,
  add column if not exists catalog_snapshot jsonb default '{}'::jsonb,
  add column if not exists design_status text default 'draft',
  add column if not exists low_resolution_warning boolean default false,
  add column if not exists is_active boolean default true,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_items'::regclass
      and conname = 'order_items_position_check'
  ) then
    alter table public.order_items
      add constraint order_items_position_check check (position >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_items'::regclass
      and conname = 'order_items_quantity_check'
  ) then
    alter table public.order_items
      add constraint order_items_quantity_check check (quantity >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_items'::regclass
      and conname = 'order_items_amounts_check'
  ) then
    alter table public.order_items
      add constraint order_items_amounts_check check (
        base_price >= 0 and unit_price >= 0 and discount_amount >= 0
        and line_total >= 0
        and base_price >= unit_price
        and discount_amount = (base_price - unit_price) * quantity
        and line_total = unit_price * quantity
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_items'::regclass
      and conname = 'order_items_pack_type_check'
  ) then
    alter table public.order_items
      add constraint order_items_pack_type_check check (
        pack_type in (
          'carcasa',
          'carcasa+polera',
          'carcasa+poleron',
          'carcasa+polera+poleron'
        )
      );
  end if;
end
$$;

create unique index if not exists order_items_order_position_idx
  on public.order_items(order_id, position);
create unique index if not exists order_items_order_client_key_uidx
  on public.order_items(order_id, client_item_key);
create index if not exists order_items_order_id_idx
  on public.order_items(order_id);
create index if not exists order_items_pack_type_idx
  on public.order_items(pack_type);

drop trigger if exists order_items_updated on public.order_items;
create trigger order_items_updated
  before update on public.order_items
  for each row execute function public.tg_set_updated_at();

alter table public.order_items enable row level security;
revoke all on table public.order_items from public, anon, authenticated;
grant all on table public.order_items to service_role;
grant select, insert, update, delete on table public.order_items to authenticated;

drop policy if exists "Admins manage order_items" on public.order_items;
create policy "Admins manage order_items"
  on public.order_items
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Some remote environments missed the historical secondary-garment schema
-- migration. Stage 2 persists these values in final_designs, so repair the
-- dependency additively before adding item-aware references or RPCs.
alter table public.final_designs
  add column if not exists secondary_garment_id uuid
    references public.garments(id) on delete set null,
  add column if not exists secondary_garment_size text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.final_designs'::regclass
      and c.confrelid = 'public.garments'::regclass
      and c.contype = 'f'
      and array_length(c.conkey, 1) = 1
      and a.attname = 'secondary_garment_id'
  ) then
    alter table public.final_designs
      add constraint final_designs_secondary_garment_id_fkey
      foreign key (secondary_garment_id)
      references public.garments(id)
      on delete set null;
  end if;
end
$$;

create index if not exists final_designs_secondary_garment_id_idx
  on public.final_designs(secondary_garment_id);

alter table public.final_designs
  add column if not exists order_item_id uuid references public.order_items(id) on delete cascade;
alter table public.design_assets
  add column if not exists order_item_id uuid references public.order_items(id) on delete cascade;
alter table public.order_upload_authorizations
  add column if not exists order_item_id uuid references public.order_items(id) on delete cascade;

-- Remove any UNIQUE constraint whose complete key is only final_designs.order_id.
-- The historical repository name is final_designs_order_id_uniq, but remote
-- environments are not required to use that name.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.final_designs'::regclass
      and c.contype = 'u'
      and array_length(c.conkey, 1) = 1
      and exists (
        select 1
        from unnest(c.conkey) as key(attnum)
        join pg_attribute a
          on a.attrelid = c.conrelid and a.attnum = key.attnum
        where a.attname = 'order_id'
      )
  loop
    execute format(
      'alter table public.final_designs drop constraint %I',
      constraint_row.conname
    );
  end loop;
end
$$;

create unique index if not exists final_designs_order_item_id_uidx
  on public.final_designs(order_item_id)
  where order_item_id is not null;
create index if not exists design_assets_order_item_kind_idx
  on public.design_assets(order_item_id, kind);
create index if not exists order_upload_auth_order_item_kind_path_idx
  on public.order_upload_authorizations(order_id, order_item_id, kind, storage_path);

-- Historical price strategy:
-- custom_orders.subtotal_amount is the already-discounted merchandise amount.
-- The gross item price is therefore subtotal + the order-level discount. This
-- preserves the stored economics and never consults today's promo_packs prices.
insert into public.order_items (
  order_id,
  position,
  quantity,
  client_item_key,
  request_fingerprint,
  pack_id,
  pack_type,
  brand_id,
  brand,
  phone_model_id,
  phone_model,
  garment_id,
  garment_size,
  garment_color,
  secondary_garment_id,
  secondary_garment_size,
  secondary_garment_color,
  base_price,
  unit_price,
  discount_amount,
  line_total,
  catalog_snapshot,
  design_status,
  low_resolution_warning,
  is_active,
  created_at,
  updated_at
)
select
  orders.id,
  0,
  1,
  'legacy-initial-item',
  md5(orders.id::text || ':legacy-initial-item'),
  orders.pack_id,
  orders.pack_type,
  orders.brand_id,
  orders.brand,
  orders.phone_model_id,
  orders.phone_model,
  orders.garment_id,
  orders.garment_size,
  orders.garment_color,
  orders.secondary_garment_id,
  orders.secondary_garment_size,
  orders.secondary_garment_color,
  greatest(0, coalesce(orders.subtotal_amount, 0))
    + greatest(0, coalesce(orders.discount_amount, 0)),
  greatest(0, coalesce(orders.subtotal_amount, 0)),
  greatest(0, coalesce(orders.discount_amount, 0)),
  greatest(0, coalesce(orders.subtotal_amount, 0)),
  coalesce(orders.catalog_snapshot, '{}'::jsonb),
  coalesce(nullif(orders.design_status, ''), 'pending'),
  coalesce(orders.low_resolution_warning, false),
  true,
  orders.created_at,
  orders.updated_at
from public.custom_orders orders
where not exists (
  select 1 from public.order_items item where item.order_id = orders.id
);

-- Only associate legacy children when the order has exactly one item. This
-- avoids guessing ownership for any multi-item rows created before this stage.
update public.final_designs child
set order_item_id = item.id
from public.order_items item
where child.order_item_id is null
  and child.order_id = item.order_id
  and (
    select count(*) from public.order_items siblings
    where siblings.order_id = child.order_id
  ) = 1
  and (
    select count(*) from public.final_designs siblings
    where siblings.order_id = child.order_id
  ) = 1;

update public.design_assets child
set order_item_id = item.id
from public.order_items item
where child.order_item_id is null
  and child.order_id = item.order_id
  and (
    select count(*) from public.order_items siblings
    where siblings.order_id = child.order_id
  ) = 1;

update public.order_upload_authorizations child
set order_item_id = item.id
from public.order_items item
where child.order_item_id is null
  and child.order_id = item.order_id
  and (
    select count(*) from public.order_items siblings
    where siblings.order_id = child.order_id
  ) = 1;
