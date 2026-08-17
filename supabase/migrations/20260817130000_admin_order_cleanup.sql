-- VisualSkin admin order cleanup
-- Deletes ONLY unpaid orders and related DB rows atomically.
-- Returns storage paths so the application can remove objects via Supabase Storage API.
--
-- Protected forever from this function:
--   approved, refunded, charged_back
--
-- NOTE:
-- If another FK referencing custom_orders exists and is not covered below,
-- PostgreSQL will abort the whole transaction. No partial DB deletion occurs.

create or replace function public.admin_delete_unpaid_orders(p_order_ids uuid[])
returns table(storage_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_protected_count integer;
  v_existing_count integer;
  v_paths text[];
begin
  if p_order_ids is null or coalesce(array_length(p_order_ids, 1), 0) = 0 then
    raise exception 'No se recibieron pedidos para eliminar';
  end if;

  select count(*) into v_existing_count
  from public.custom_orders
  where id = any(p_order_ids);

  if v_existing_count <> coalesce(array_length(p_order_ids, 1), 0) then
    raise exception 'Uno o más pedidos no existen';
  end if;

  select count(*) into v_protected_count
  from public.custom_orders
  where id = any(p_order_ids)
    and payment_status in ('approved', 'refunded', 'charged_back');

  if v_protected_count > 0 then
    raise exception 'Hay pedidos protegidos por su estado de pago. No se eliminaron registros.';
  end if;

  select coalesce(array_agg(distinct p), array[]::text[]) into v_paths
  from (
    select da.file_path::text as p
    from public.design_assets da
    where da.order_id = any(p_order_ids) and da.file_path is not null
    union
    select oua.storage_path::text as p
    from public.order_upload_authorizations oua
    where oua.order_id = any(p_order_ids) and oua.storage_path is not null
  ) s;

  -- Known dependent tables. If a table does not exist in an older DB,
  -- the migration should be adjusted before execution.
  delete from public.payment_events where order_id = any(p_order_ids);
  delete from public.payment_attempts where order_id = any(p_order_ids);
  -- payment_sessions exists in the VisualSkin schema used by the checkout flow.
  delete from public.payment_sessions where order_id = any(p_order_ids);
  delete from public.final_designs where order_id = any(p_order_ids);
  delete from public.design_assets where order_id = any(p_order_ids);
  delete from public.order_upload_authorizations where order_id = any(p_order_ids);
  delete from public.custom_orders where id = any(p_order_ids);

  return query select unnest(v_paths);
end;
$$;

revoke all on function public.admin_delete_unpaid_orders(uuid[]) from public;
revoke all on function public.admin_delete_unpaid_orders(uuid[]) from anon;
revoke all on function public.admin_delete_unpaid_orders(uuid[]) from authenticated;
grant execute on function public.admin_delete_unpaid_orders(uuid[]) to service_role;
