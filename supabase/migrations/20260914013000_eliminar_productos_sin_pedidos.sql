-- =====================================================================
-- 20260914013000 · Permitir eliminar productos sin pedidos
-- ---------------------------------------------------------------------
-- Antes, un producto con movimientos de inventario no podía eliminarse.
-- Ahora:
--   * Productos con pedidos o cotizaciones: siguen protegidos (trigger
--     products_prevent_delete_with_history → se deben desactivar).
--   * Productos solo con movimientos de stock: se pueden eliminar; el
--     historial de inventario se conserva con el nombre del producto.
-- No modifica productos ni precios existentes.
-- =====================================================================

alter table public.inventory_movements
  add column if not exists product_name text check (char_length(product_name) <= 120);

update public.inventory_movements m
   set product_name = p.name
  from public.products p
 where p.id = m.product_id
   and m.product_name is null;

alter table public.inventory_movements alter column product_id drop not null;

alter table public.inventory_movements drop constraint if exists inventory_movements_product_id_fkey;
alter table public.inventory_movements
  add constraint inventory_movements_product_id_fkey
  foreign key (product_id) references public.products (id) on delete set null;

comment on column public.inventory_movements.product_name is 'Nombre del producto al registrar el movimiento (se conserva si el producto se elimina)';

-- El trigger ahora también guarda el nombre del producto
create or replace function private.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stock integer;
  v_name  text;
  v_delta integer;
begin
  -- El trigger corre antes que la RLS: validar primero para no filtrar datos
  if auth.uid() is null or not private.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if new.product_id is null then
    raise exception 'Producto requerido' using errcode = '23502';
  end if;

  select p.stock, p.name into v_stock, v_name
  from public.products p
  where p.id = new.product_id
  for update;

  if not found then
    raise exception 'Producto no encontrado' using errcode = '23503';
  end if;

  v_delta := case new.movement_type
               when 'entrada' then new.quantity
               when 'salida'  then -new.quantity
               else new.quantity
             end;

  if v_stock + v_delta < 0 then
    raise exception 'Stock insuficiente: disponible %, movimiento %', v_stock, v_delta
      using errcode = '23514';
  end if;

  update public.products
     set stock = v_stock + v_delta,
         track_stock = true
   where id = new.product_id;

  new.product_name := v_name;
  new.stock_before := v_stock;
  new.stock_after  := v_stock + v_delta;
  new.created_by   := auth.uid();
  new.created_at   := now();
  return new;
end;
$$;

revoke all on function private.apply_inventory_movement() from public, anon, authenticated;
