-- =====================================================================
-- 20260913120300 · Inventario
-- ---------------------------------------------------------------------
-- Cada entrada/salida/ajuste es un registro inmutable. Un trigger:
--   * bloquea la fila del producto (FOR UPDATE) para evitar carreras,
--   * calcula stock_before / stock_after,
--   * rechaza cualquier movimiento que deje stock negativo,
--   * actualiza products.stock (columna no editable desde la API).
-- =====================================================================

create table if not exists public.inventory_movements (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products (id) on delete restrict,
  movement_type  text not null check (movement_type in ('entrada', 'salida', 'ajuste')),
  quantity       integer not null check (quantity <> 0 and quantity between -1000000 and 1000000),
  reason         text not null check (char_length(trim(reason)) between 3 and 500),
  order_id       uuid references public.orders (id) on delete set null,
  stock_before   integer,
  stock_after    integer check (stock_after >= 0),
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint inventory_quantity_sign check (movement_type = 'ajuste' or quantity > 0)
);

comment on column public.inventory_movements.quantity is 'entrada/salida: cantidad positiva. ajuste: diferencia con signo (+/-).';

create index if not exists inventory_movements_product_idx on public.inventory_movements (product_id, created_at desc);
create index if not exists inventory_movements_order_idx   on public.inventory_movements (order_id);

create or replace function private.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stock integer;
  v_delta integer;
begin
  -- El trigger corre antes que la RLS: validar primero para no filtrar datos
  if auth.uid() is null or not private.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select p.stock into v_stock
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

  new.stock_before := v_stock;
  new.stock_after  := v_stock + v_delta;
  new.created_by   := auth.uid();
  new.created_at   := now();
  return new;
end;
$$;

revoke all on function private.apply_inventory_movement() from public, anon, authenticated;

drop trigger if exists inventory_movements_apply on public.inventory_movements;
create trigger inventory_movements_apply
  before insert on public.inventory_movements
  for each row execute function private.apply_inventory_movement();

-- ---------------------------------------------------------------------
-- RLS + grants: admin lee e inserta; nadie actualiza ni borra
-- ---------------------------------------------------------------------
alter table public.inventory_movements enable row level security;

drop policy if exists "inventory_movements: admin lee" on public.inventory_movements;
create policy "inventory_movements: admin lee"
  on public.inventory_movements for select
  to authenticated
  using ((select private.is_admin()));

drop policy if exists "inventory_movements: admin inserta" on public.inventory_movements;
create policy "inventory_movements: admin inserta"
  on public.inventory_movements for insert
  to authenticated
  with check ((select private.is_admin()));

revoke all on table public.inventory_movements from anon, authenticated;
grant select on table public.inventory_movements to authenticated;
grant insert (product_id, movement_type, quantity, reason, order_id)
  on table public.inventory_movements to authenticated;
