-- Empty only an editable cart. Approved/locked orders are never changed.
create or replace function public.clear_active_cart_v1(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_removed integer;
begin
  select id, payment_status, design_status into v_order
  from public.custom_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.payment_status in ('approved','refunded','charged_back')
     or v_order.design_status = 'locked'
     or exists (
       select 1 from public.payment_attempts
       where order_id = p_order_id
         and status in ('processing','pending','awaiting_reconciliation')
     ) then
    raise exception 'order_locked';
  end if;

  -- Keep the order_item rows and all of their dependent design data. The
  -- canonical cart-revision trigger listens to this is_active update and
  -- increments cart_version while clearing cart_fingerprint/provider URLs.
  update public.order_items
  set is_active = false
  where order_id = p_order_id and is_active = true;
  get diagnostics v_removed = row_count;

  update public.custom_orders
  set subtotal_amount = 0,
      discount_amount = 0,
      shipping_amount = 0,
      total_amount = 0,
      design_status = 'draft'
  where id = p_order_id;

  return jsonb_build_object('ok', true, 'removed', v_removed);
end;
$$;

revoke all on function public.clear_active_cart_v1(uuid) from public, anon, authenticated;
grant execute on function public.clear_active_cart_v1(uuid) to service_role;
