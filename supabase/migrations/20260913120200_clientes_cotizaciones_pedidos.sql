-- =====================================================================
-- 20260913120200 · Clientes, solicitudes de cotización y pedidos
-- ---------------------------------------------------------------------
-- La web funciona como "cotizar / finalizar por WhatsApp", por eso:
--   * `quote_requests` (+ items): lo que llega desde el carrito o el
--     formulario de cotización. Montos = estimación, no venta.
--   * `orders` (+ items): pedido confirmado por MediPrint, normalmente
--     creado desde una cotización. Totales recalculados en servidor.
--   * `order_events`: historial básico (creación, cambios de estado y
--     de pago automáticos + notas manuales).
-- Todo es solo-admin. El público NO tiene acceso directo a estas tablas;
-- su única vía de escritura es la función submit_quote_request.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Validación de RUT chileno (módulo 11). Formato normalizado: 12345678-K
-- ---------------------------------------------------------------------
create or replace function private.is_valid_rut(p_rut text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_body text;
  v_dv   text;
  v_sum  integer := 0;
  v_mul  integer := 2;
  v_res  integer;
  v_exp  text;
  i      integer;
begin
  if p_rut is null or p_rut !~ '^[0-9]{7,8}-[0-9K]$' then
    return false;
  end if;
  v_body := split_part(p_rut, '-', 1);
  v_dv   := split_part(p_rut, '-', 2);
  for i in reverse length(v_body)..1 loop
    v_sum := v_sum + substr(v_body, i, 1)::integer * v_mul;
    v_mul := case when v_mul = 7 then 2 else v_mul + 1 end;
  end loop;
  v_res := 11 - (v_sum % 11);
  v_exp := case v_res when 11 then '0' when 10 then 'K' else v_res::text end;
  return v_exp = v_dv;
end;
$$;

create or replace function private.normalize_customer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- "12.345.678-k" → "12345678-K"
  new.rut   := nullif(upper(regexp_replace(coalesce(new.rut, ''), '[^0-9kK-]', '', 'g')), '');
  new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
  new.name  := trim(new.name);
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
    else
      new.created_by := old.created_by;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 160),
  rut         text unique check (rut is null or private.is_valid_rut(rut)),
  email       text check (email is null or (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254)),
  phone       text check (char_length(phone) <= 30),
  address     text check (char_length(address) <= 200),
  commune     text check (char_length(commune) <= 80),
  notes       text check (char_length(notes) <= 2000),
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists customers_name_idx  on public.customers (lower(name));
create index if not exists customers_email_idx on public.customers (email);

drop trigger if exists customers_normalize on public.customers;
create trigger customers_normalize
  before insert or update on public.customers
  for each row execute function private.normalize_customer();

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Numeración legible
-- ---------------------------------------------------------------------
create sequence if not exists public.quote_number_seq;
create sequence if not exists public.order_number_seq;

-- ---------------------------------------------------------------------
-- Solicitudes de cotización
-- ---------------------------------------------------------------------
create table if not exists public.quote_requests (
  id                  uuid primary key default gen_random_uuid(),
  quote_number        text not null unique
                        default ('COT-' || lpad(nextval('public.quote_number_seq')::text, 6, '0')),
  customer_id         uuid references public.customers (id) on delete set null,
  source              text not null check (source in ('carrito_web', 'formulario_cotizacion', 'panel')),
  status              text not null default 'nueva'
                        check (status in ('nueva', 'en_revision', 'cotizada', 'aceptada', 'rechazada', 'cancelada')),
  contact_name        text check (char_length(contact_name) <= 120),
  company             text check (char_length(company) <= 160),
  email               text check (char_length(email) <= 254),
  phone               text check (char_length(phone) <= 30),
  product_summary     text check (char_length(product_summary) <= 200),
  requested_quantity  integer check (requested_quantity > 0),
  required_date       date,
  description         text check (char_length(description) <= 3000),
  net_amount          integer not null default 0 check (net_amount >= 0),
  vat_amount          integer not null default 0 check (vat_amount >= 0),
  total_amount        integer not null default 0 check (total_amount >= 0),
  admin_notes         text check (char_length(admin_notes) <= 3000),
  client_fingerprint  text check (char_length(client_fingerprint) <= 64),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.quote_requests is 'Solicitudes desde carrito/formulario. Los montos son estimaciones recalculadas en servidor.';
comment on column public.quote_requests.client_fingerprint is 'Hash SHA-256 de la IP (no se guarda la IP). Solo para limitar abuso.';

create index if not exists quote_requests_status_idx   on public.quote_requests (status, created_at desc);
create index if not exists quote_requests_customer_idx on public.quote_requests (customer_id);
create index if not exists quote_requests_fp_idx       on public.quote_requests (client_fingerprint, created_at desc);

drop trigger if exists quote_requests_set_updated_at on public.quote_requests;
create trigger quote_requests_set_updated_at
  before update on public.quote_requests
  for each row execute function private.set_updated_at();

create table if not exists public.quote_request_items (
  id                uuid primary key default gen_random_uuid(),
  quote_request_id  uuid not null references public.quote_requests (id) on delete cascade,
  product_id        uuid references public.products (id) on delete set null,
  product_name      text not null check (char_length(product_name) between 1 and 160),
  option_label      text check (char_length(option_label) <= 200),
  quantity_label    text check (char_length(quantity_label) <= 120),
  extras            text[] not null default '{}' check (cardinality(extras) <= 10),
  packs             integer not null check (packs between 1 and 1000),
  unit_net_price    integer not null default 0 check (unit_net_price between 0 and 1000000000),
  subtotal_net      bigint generated always as (packs::bigint * unit_net_price) stored,
  created_at        timestamptz not null default now()
);

create index if not exists quote_request_items_quote_idx on public.quote_request_items (quote_request_id);

-- ---------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  order_number      text not null unique
                      default ('MP-' || lpad(nextval('public.order_number_seq')::text, 6, '0')),
  customer_id       uuid not null references public.customers (id) on delete restrict,
  quote_request_id  uuid unique references public.quote_requests (id) on delete set null,
  status            text not null default 'pendiente'
                      check (status in ('pendiente', 'confirmado', 'en_diseno', 'en_produccion',
                                        'listo', 'despachado', 'entregado', 'cancelado')),
  payment_status    text not null default 'pendiente'
                      check (payment_status in ('pendiente', 'abonado', 'pagado', 'reembolsado')),
  channel           text not null default 'whatsapp'
                      check (channel in ('whatsapp', 'web', 'presencial', 'correo', 'instagram', 'otro')),
  shipping_net      integer not null default 0 check (shipping_net >= 0),
  vat_rate          numeric(5, 2) not null default 19.00 check (vat_rate between 0 and 100),
  net_amount        bigint not null default 0 check (net_amount >= 0),
  vat_amount        bigint not null default 0 check (vat_amount >= 0),
  total_amount      bigint not null default 0 check (total_amount >= 0),
  notes             text check (char_length(notes) <= 3000),
  created_by        uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint orders_total_consistent check (total_amount = net_amount + vat_amount)
);

create index if not exists orders_status_idx   on public.orders (status, created_at desc);
create index if not exists orders_customer_idx on public.orders (customer_id);

create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  product_id      uuid references public.products (id) on delete set null,
  description     text not null check (char_length(description) between 1 and 300),
  options         jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  quantity        integer not null check (quantity between 1 and 1000000),
  unit_net_price  integer not null check (unit_net_price between 0 and 1000000000),
  subtotal_net    bigint generated always as (quantity::bigint * unit_net_price) stored,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column public.order_items.description is 'Descripción congelada del producto al momento del pedido';

create index if not exists order_items_order_idx   on public.order_items (order_id);
create index if not exists order_items_product_idx on public.order_items (product_id);

drop trigger if exists order_items_set_updated_at on public.order_items;
create trigger order_items_set_updated_at
  before update on public.order_items
  for each row execute function private.set_updated_at();

-- Totales del pedido: siempre calculados en servidor
create or replace function private.compute_order_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_items bigint;
begin
  select coalesce(sum(oi.subtotal_net), 0) into v_items
  from public.order_items oi
  where oi.order_id = new.id;

  new.net_amount   := v_items + new.shipping_net;
  new.vat_amount   := round(new.net_amount * new.vat_rate / 100);
  new.total_amount := new.net_amount + new.vat_amount;
  new.updated_at   := now();
  return new;
end;
$$;

drop trigger if exists orders_compute_totals on public.orders;
create trigger orders_compute_totals
  before insert or update on public.orders
  for each row execute function private.compute_order_totals();

create or replace function private.touch_order_from_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.orders set updated_at = now() where id = old.order_id;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.order_id is distinct from old.order_id) then
    update public.orders set updated_at = now() where id = new.order_id;
  end if;
  return null;
end;
$$;

drop trigger if exists order_items_touch_order on public.order_items;
create trigger order_items_touch_order
  after insert or update or delete on public.order_items
  for each row execute function private.touch_order_from_item();

-- ---------------------------------------------------------------------
-- Historial del pedido
-- ---------------------------------------------------------------------
create table if not exists public.order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  event_type  text not null check (event_type in ('creado', 'estado', 'pago', 'nota')),
  from_value  text check (char_length(from_value) <= 40),
  to_value    text check (char_length(to_value) <= 40),
  note        text check (char_length(note) <= 2000),
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint order_events_note_required check (event_type <> 'nota' or char_length(trim(note)) > 0)
);

create index if not exists order_events_order_idx on public.order_events (order_id, created_at desc);

create or replace function private.log_order_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_events (order_id, event_type, to_value, created_by)
    values (new.id, 'creado', new.status, auth.uid());
  else
    if new.status is distinct from old.status then
      insert into public.order_events (order_id, event_type, from_value, to_value, created_by)
      values (new.id, 'estado', old.status, new.status, auth.uid());
    end if;
    if new.payment_status is distinct from old.payment_status then
      insert into public.order_events (order_id, event_type, from_value, to_value, created_by)
      values (new.id, 'pago', old.payment_status, new.payment_status, auth.uid());
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists orders_log_changes on public.orders;
create trigger orders_log_changes
  after insert or update on public.orders
  for each row execute function private.log_order_changes();

-- Los eventos automáticos no se falsifican: el cliente solo puede crear notas
-- y el autor siempre es el usuario actual.
create or replace function private.force_order_event_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.event_type <> 'nota' then
      raise exception 'Solo se pueden registrar notas manualmente' using errcode = '42501';
    end if;
    new.created_by := auth.uid();
    new.created_at := now();
    new.from_value := null;
    new.to_value   := null;
  end if;
  return new;
end;
$$;

drop trigger if exists order_events_force_author on public.order_events;
create trigger order_events_force_author
  before insert on public.order_events
  for each row execute function private.force_order_event_author();

-- ---------------------------------------------------------------------
-- Productos con historial comercial no se eliminan físicamente:
-- se desactivan (is_active = false) para conservar la trazabilidad.
-- ---------------------------------------------------------------------
create or replace function private.prevent_product_delete_with_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.order_items oi where oi.product_id = old.id)
     or exists (select 1 from public.quote_request_items qi where qi.product_id = old.id) then
    raise exception 'El producto tiene pedidos o cotizaciones asociados: desactívalo en lugar de eliminarlo'
      using errcode = '23503';
  end if;
  return old;
end;
$$;

drop trigger if exists products_prevent_delete_with_history on public.products;
create trigger products_prevent_delete_with_history
  before delete on public.products
  for each row execute function private.prevent_product_delete_with_history();

revoke all on function private.prevent_product_delete_with_history() from public, anon, authenticated;

revoke all on function private.is_valid_rut(text)            from public;
revoke all on function private.normalize_customer()          from public, anon, authenticated;
revoke all on function private.compute_order_totals()        from public, anon, authenticated;
revoke all on function private.touch_order_from_item()       from public, anon, authenticated;
revoke all on function private.log_order_changes()           from public, anon, authenticated;
revoke all on function private.force_order_event_author()    from public, anon, authenticated;
grant execute on function private.is_valid_rut(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- RLS: solo administradores
-- ---------------------------------------------------------------------
alter table public.customers           enable row level security;
alter table public.quote_requests      enable row level security;
alter table public.quote_request_items enable row level security;
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.order_events        enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['customers', 'quote_requests', 'quote_request_items', 'orders', 'order_items', 'order_events']
  loop
    execute format('drop policy if exists %I on public.%I', t || ': admin lee', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.is_admin()))', t || ': admin lee', t);
    execute format('drop policy if exists %I on public.%I', t || ': admin inserta', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_admin()))', t || ': admin inserta', t);
    execute format('drop policy if exists %I on public.%I', t || ': admin actualiza', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', t || ': admin actualiza', t);
    execute format('drop policy if exists %I on public.%I', t || ': admin elimina', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_admin()))', t || ': admin elimina', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- GRANTS
-- ---------------------------------------------------------------------
revoke all on table public.customers, public.quote_requests, public.quote_request_items,
                    public.orders, public.order_items, public.order_events
  from anon, authenticated;
revoke all on sequence public.quote_number_seq, public.order_number_seq from anon, authenticated;

grant select, insert, update, delete on table public.customers, public.quote_request_items, public.order_items
  to authenticated;

-- quote_requests: se permite borrar (spam); la huella y montos no los edita el panel
grant select, delete on table public.quote_requests to authenticated;
grant insert (customer_id, source, status, contact_name, company, email, phone, product_summary,
              requested_quantity, required_date, description, admin_notes)
  on table public.quote_requests to authenticated;
grant update (customer_id, status, contact_name, company, email, phone, product_summary,
              requested_quantity, required_date, description, admin_notes)
  on table public.quote_requests to authenticated;

-- orders: sin DELETE (se cancelan); totales calculados por trigger
grant select on table public.orders to authenticated;
grant insert (customer_id, quote_request_id, status, payment_status, channel, shipping_net, vat_rate, notes)
  on table public.orders to authenticated;
grant update (customer_id, quote_request_id, status, payment_status, channel, shipping_net, vat_rate, notes)
  on table public.orders to authenticated;

-- order_events: inmutable (solo lectura + notas)
grant select on table public.order_events to authenticated;
grant insert (order_id, event_type, note) on table public.order_events to authenticated;

grant usage on sequence public.quote_number_seq, public.order_number_seq to authenticated;
