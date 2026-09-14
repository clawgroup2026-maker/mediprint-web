-- =====================================================================
-- 20260913120100 · Catálogo: categorías, productos, variantes, tramos
--                  de precio por cantidad y opcionales con recargo
-- ---------------------------------------------------------------------
-- Refleja el catálogo real de la web:
--   * Productos impresos con "Formato" (variante) y tramos
--     cantidad → precio neto total del pack.
--   * Opcionales con recargo porcentual (algunos excluyentes).
--   * Credenciales PVC con precio unitario por tramos (pricing_mode 'unit'
--     + reglas en `pricing_rules`).
--   * Servicios web (BridgeClaw) con precio "Desde / A cotizar".
-- Lectura pública solo de lo activo; escritura solo admin.
-- El stock NO se edita directamente: se mueve con inventory_movements.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Categorías
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 80),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  description text check (char_length(description) <= 500),
  kind        text not null default 'printed' check (kind in ('printed', 'web')),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.categories.kind is 'printed = productos impresos (carrito); web = servicios web (cotizar por WhatsApp)';

create index if not exists categories_active_sort_idx on public.categories (is_active, sort_order);

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Productos
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id                uuid primary key default gen_random_uuid(),
  category_id       uuid not null references public.categories (id) on delete restrict,
  name              text not null check (char_length(trim(name)) between 1 and 120),
  slug              text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  description       text check (char_length(description) <= 1000),
  specs             text check (char_length(specs) <= 2000),
  features          text check (char_length(features) <= 2000),
  image_path        text check (char_length(image_path) <= 300),
  sku               text unique check (sku ~ '^[A-Za-z0-9._-]{1,40}$'),
  pricing_mode      text not null default 'tiers' check (pricing_mode in ('tiers', 'unit', 'quote')),
  unit_label        text not null default 'unidades' check (unit_label in ('unidades', 'talonarios')),
  pack_pricing      boolean not null default false,
  extras_exclusive  boolean not null default false,
  base_net_price    integer check (base_net_price >= 0),
  pricing_rules     jsonb check (pricing_rules is null or jsonb_typeof(pricing_rules) = 'object'),
  price_label       text check (char_length(price_label) <= 60),
  vat_rate          numeric(5, 2) not null default 19.00 check (vat_rate between 0 and 100),
  base_gross_price  integer generated always as (round(base_net_price * (1 + vat_rate / 100))::integer) stored,
  external_url      text check (external_url ~ '^https://[^\s]+$' and char_length(external_url) <= 300),
  whatsapp_number   text check (whatsapp_number ~ '^[0-9]{8,15}$'),
  track_stock       boolean not null default false,
  stock             integer not null default 0 check (stock >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold between 0 and 1000000),
  stock_status      text generated always as (
                      case
                        when not track_stock then 'sin_control'
                        when stock = 0 then 'agotado'
                        when stock <= low_stock_threshold then 'bajo'
                        else 'disponible'
                      end) stored,
  is_active         boolean not null default true,
  is_featured       boolean not null default false,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on column public.products.pricing_mode is 'tiers = variantes con tramos de cantidad; unit = precio unitario (pricing_rules); quote = a cotizar (price_label)';
comment on column public.products.pricing_rules is 'Modo unit: {"unit_prices":[{"up_to":20,"net_price":3500},{"up_to":null,"net_price":3000}],"design_fee":5000,"design_free_from":6}';
comment on column public.products.image_path is 'Ruta en bucket product-images (products/...) o ruta estática del sitio (images/...)';
comment on column public.products.stock is 'Solo se modifica mediante inventory_movements';

create index if not exists products_category_idx on public.products (category_id);
create index if not exists products_active_sort_idx on public.products (is_active, sort_order);
create index if not exists products_stock_status_idx on public.products (stock_status) where track_stock;

comment on column public.products.base_net_price is 'Precio neto base en CLP (entero). Modo unit sin reglas: precio por unidad.';
comment on column public.products.stock_status is 'sin_control | agotado | bajo (≤ low_stock_threshold) | disponible';

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Variantes (Formato / Tipo / Tamaño…)
-- ---------------------------------------------------------------------
create table if not exists public.product_variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 120),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (product_id, name)
);

drop trigger if exists product_variants_set_updated_at on public.product_variants;
create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Tramos de precio: cantidad del pack → precio neto total
-- ---------------------------------------------------------------------
create table if not exists public.product_price_tiers (
  id          uuid primary key default gen_random_uuid(),
  variant_id  uuid not null references public.product_variants (id) on delete cascade,
  quantity    integer not null check (quantity > 0 and quantity <= 1000000),
  net_price   integer not null check (net_price >= 0 and net_price <= 1000000000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (variant_id, quantity)
);

drop trigger if exists product_price_tiers_set_updated_at on public.product_price_tiers;
create trigger product_price_tiers_set_updated_at
  before update on public.product_price_tiers
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Opcionales (Prepicado, Foliado, Termolaminado…) con recargo %
-- ---------------------------------------------------------------------
create table if not exists public.product_extras (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references public.products (id) on delete cascade,
  name               text not null check (char_length(trim(name)) between 1 and 80),
  surcharge_percent  numeric(6, 2) not null default 0 check (surcharge_percent between 0 and 500),
  is_active          boolean not null default true,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (product_id, name)
);

drop trigger if exists product_extras_set_updated_at on public.product_extras;
create trigger product_extras_set_updated_at
  before update on public.product_extras
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.categories          enable row level security;
alter table public.products            enable row level security;
alter table public.product_variants    enable row level security;
alter table public.product_price_tiers enable row level security;
alter table public.product_extras      enable row level security;

-- Lectura: público ve solo lo activo (y cuya categoría/producto padre es
-- visible, porque las subconsultas también pasan por RLS); admin ve todo.
drop policy if exists "categories: lectura pública activas" on public.categories;
create policy "categories: lectura pública activas"
  on public.categories for select
  to anon, authenticated
  using (is_active or (select private.is_admin()));

drop policy if exists "products: lectura pública activos" on public.products;
create policy "products: lectura pública activos"
  on public.products for select
  to anon, authenticated
  using (
    (is_active and exists (select 1 from public.categories c where c.id = category_id and c.is_active))
    or (select private.is_admin())
  );

drop policy if exists "product_variants: lectura pública activas" on public.product_variants;
create policy "product_variants: lectura pública activas"
  on public.product_variants for select
  to anon, authenticated
  using (
    (is_active and exists (select 1 from public.products p where p.id = product_id))
    or (select private.is_admin())
  );

drop policy if exists "product_price_tiers: lectura pública" on public.product_price_tiers;
create policy "product_price_tiers: lectura pública"
  on public.product_price_tiers for select
  to anon, authenticated
  using (
    exists (select 1 from public.product_variants v where v.id = variant_id)
    or (select private.is_admin())
  );

drop policy if exists "product_extras: lectura pública activos" on public.product_extras;
create policy "product_extras: lectura pública activos"
  on public.product_extras for select
  to anon, authenticated
  using (
    (is_active and exists (select 1 from public.products p where p.id = product_id))
    or (select private.is_admin())
  );

-- Escritura: solo admin (insert / update / delete por tabla)
do $$
declare
  t text;
begin
  foreach t in array array['categories', 'products', 'product_variants', 'product_price_tiers', 'product_extras']
  loop
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
-- GRANTS (además de RLS). Se revoca todo lo que Supabase concede por
-- defecto y se concede solo lo necesario.
-- ---------------------------------------------------------------------
revoke all on table public.categories, public.products, public.product_variants,
                    public.product_price_tiers, public.product_extras
  from anon, authenticated;

grant select on table public.categories, public.product_variants,
                      public.product_price_tiers, public.product_extras
  to anon, authenticated;

-- products: el público ve el estado de stock, no la cantidad exacta ni el SKU interno
grant select on table public.products to authenticated;
grant select (id, category_id, name, slug, description, specs, features, image_path,
              pricing_mode, unit_label, pack_pricing, extras_exclusive, base_net_price,
              pricing_rules, price_label, vat_rate, base_gross_price, external_url,
              whatsapp_number, track_stock, stock_status, is_active, is_featured, sort_order,
              created_at, updated_at)
  on table public.products to anon;

grant insert, update, delete on table public.categories, public.product_variants,
                                      public.product_price_tiers, public.product_extras
  to authenticated;

-- products: el stock queda fuera de insert/update (solo vía inventario)
grant delete on table public.products to authenticated;
grant insert (category_id, name, slug, description, specs, features, image_path, sku,
              pricing_mode, unit_label, pack_pricing, extras_exclusive, base_net_price,
              pricing_rules, price_label, vat_rate, external_url, whatsapp_number,
              track_stock, low_stock_threshold, is_active, is_featured, sort_order)
  on table public.products to authenticated;
grant update (category_id, name, slug, description, specs, features, image_path, sku,
              pricing_mode, unit_label, pack_pricing, extras_exclusive, base_net_price,
              pricing_rules, price_label, vat_rate, external_url, whatsapp_number,
              track_stock, low_stock_threshold, is_active, is_featured, sort_order)
  on table public.products to authenticated;
