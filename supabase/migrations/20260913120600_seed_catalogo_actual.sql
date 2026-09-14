-- =====================================================================
-- 20260913120600 · Carga inicial del catálogo actual de la web
-- ---------------------------------------------------------------------
-- Generado desde productCatalog de index.html (precios netos vigentes).
-- Idempotente: ON CONFLICT DO NOTHING → re-ejecutar NO sobrescribe
-- cambios hechos luego desde el panel.
-- =====================================================================

insert into public.categories (name, slug, description, kind, sort_order) values
  ('Productos impresos', 'productos-impresos', 'Impresión médica, comercial y material personalizado.', 'printed', 10),
  ('Servicios web', 'servicios-web', 'Sitios web desarrollados por BridgeClaw.', 'web', 20)
on conflict (slug) do nothing;

-- Recetarios Médicos
insert into public.products (category_id, name, slug, description, specs, features, image_path, pricing_mode, unit_label, pack_pricing, extras_exclusive, base_net_price, pricing_rules, price_label, external_url, whatsapp_number, sort_order)
select c.id, 'Recetarios Médicos', 'recetarios-medicos', 'Recetarios personalizados para profesionales y centros de salud.', 'Papel bond 80 Gr. / respaldo dúplex 300 Gr. / full color.', null, 'images/recetarios.jpeg', 'tiers', 'talonarios', false, false, null, null, null, null, null, 10
from public.categories c where c.slug = 'productos-impresos'
on conflict (slug) do nothing;

insert into public.product_variants (product_id, name, sort_order)
select p.id, '1/2 Carta', 10 from public.products p where p.slug = 'recetarios-medicos'
on conflict (product_id, name) do nothing;

insert into public.product_price_tiers (variant_id, quantity, net_price)
select v.id, t.quantity, t.net_price
from public.product_variants v
join public.products p on p.id = v.product_id
cross join (values (2, 16000), (5, 30000), (10, 46000), (20, 70000), (50, 140000), (100, 220000), (200, 350000)) as t (quantity, net_price)
where p.slug = 'recetarios-medicos' and v.name = '1/2 Carta'
on conflict (variant_id, quantity) do nothing;

insert into public.product_extras (product_id, name, surcharge_percent, sort_order)
select p.id, e.name, e.pct, e.ord
from public.products p
cross join (values ('Prepicado', 10, 10), ('Foliado', 10, 20), ('Impresión 2 caras', 30, 30), ('Diseño de tapa', 10, 40)) as e (name, pct, ord)
where p.slug = 'recetarios-medicos'
on conflict (product_id, name) do nothing;

-- Talonarios
insert into public.products (category_id, name, slug, description, specs, features, image_path, pricing_mode, unit_label, pack_pricing, extras_exclusive, base_net_price, pricing_rules, price_label, external_url, whatsapp_number, sort_order)
select c.id, 'Talonarios', 'talonarios', 'Talonarios personalizados para distintos usos profesionales y comerciales.', 'Papel bond 80 Gr. / respaldo dúplex 300 Gr. / full color, tamaño carta o media carta.', null, 'images/talonario.jpeg', 'tiers', 'talonarios', false, false, null, null, null, null, null, 20
from public.categories c where c.slug = 'productos-impresos'
on conflict (slug) do nothing;

insert into public.product_variants (product_id, name, sort_order)
select p.id, '100 hojas 1/2 carta', 10 from public.products p where p.slug = 'talonarios'
on conflict (product_id, name) do nothing;

insert into public.product_price_tiers (variant_id, quantity, net_price)
select v.id, t.quantity, t.net_price
from public.product_variants v
join public.products p on p.id = v.product_id
cross join (values (2, 16000), (4, 28000), (10, 46000), (20, 70000), (50, 140000), (100, 220000), (200, 350000)) as t (quantity, net_price)
where p.slug = 'talonarios' and v.name = '100 hojas 1/2 carta'
on conflict (variant_id, quantity) do nothing;

insert into public.product_variants (product_id, name, sort_order)
select p.id, '100 hojas carta', 20 from public.products p where p.slug = 'talonarios'
on conflict (product_id, name) do nothing;

insert into public.product_price_tiers (variant_id, quantity, net_price)
select v.id, t.quantity, t.net_price
from public.product_variants v
join public.products p on p.id = v.product_id
cross join (values (1, 16000), (2, 26000), (5, 46000), (10, 70000), (25, 140000), (50, 220000), (100, 350000)) as t (quantity, net_price)
where p.slug = 'talonarios' and v.name = '100 hojas carta'
on conflict (variant_id, quantity) do nothing;

insert into public.product_extras (product_id, name, surcharge_percent, sort_order)
select p.id, e.name, e.pct, e.ord
from public.products p
cross join (values ('Prepicado', 10, 10), ('Foliado', 10, 20), ('Impresión 2 caras', 30, 30), ('Diseño de tapa', 10, 40)) as e (name, pct, ord)
where p.slug = 'talonarios'
on conflict (product_id, name) do nothing;

-- Tarjeta de Citaciones
insert into public.products (category_id, name, slug, description, specs, features, image_path, pricing_mode, unit_label, pack_pricing, extras_exclusive, base_net_price, pricing_rules, price_label, external_url, whatsapp_number, sort_order)
select c.id, 'Tarjeta de Citaciones', 'tarjeta-de-citaciones', 'Tarjetas de citaciones personalizadas para profesionales y centros de salud.', 'Opalina lisa 250 Gr., full color.', null, 'images/carnet-salud.jpeg', 'tiers', 'unidades', false, true, null, null, null, null, null, 30
from public.categories c where c.slug = 'productos-impresos'
on conflict (slug) do nothing;

insert into public.product_variants (product_id, name, sort_order)
select p.id, 'Pequeño · 20 cm x 14,5 cm', 10 from public.products p where p.slug = 'tarjeta-de-citaciones'
on conflict (product_id, name) do nothing;

insert into public.product_price_tiers (variant_id, quantity, net_price)
select v.id, t.quantity, t.net_price
from public.product_variants v
join public.products p on p.id = v.product_id
cross join (values (100, 32000), (300, 70000), (500, 90000), (1000, 150000), (2000, 240000)) as t (quantity, net_price)
where p.slug = 'tarjeta-de-citaciones' and v.name = 'Pequeño · 20 cm x 14,5 cm'
on conflict (variant_id, quantity) do nothing;

insert into public.product_variants (product_id, name, sort_order)
select p.id, 'Carta', 20 from public.products p where p.slug = 'tarjeta-de-citaciones'
on conflict (product_id, name) do nothing;

insert into public.product_price_tiers (variant_id, quantity, net_price)
select v.id, t.quantity, t.net_price
from public.product_variants v
join public.products p on p.id = v.product_id
cross join (values (100, 42000), (300, 110000), (500, 160000), (1000, 240000), (2000, 350000)) as t (quantity, net_price)
where p.slug = 'tarjeta-de-citaciones' and v.name = 'Carta'
on conflict (variant_id, quantity) do nothing;

insert into public.product_variants (product_id, name, sort_order)
select p.id, 'Tríptico', 30 from public.products p where p.slug = 'tarjeta-de-citaciones'
on conflict (product_id, name) do nothing;

insert into public.product_price_tiers (variant_id, quantity, net_price)
select v.id, t.quantity, t.net_price
from public.product_variants v
join public.products p on p.id = v.product_id
cross join (values (100, 46000), (300, 120000), (500, 180000), (1000, 260000), (2000, 370000)) as t (quantity, net_price)
where p.slug = 'tarjeta-de-citaciones' and v.name = 'Tríptico'
on conflict (variant_id, quantity) do nothing;

insert into public.product_extras (product_id, name, surcharge_percent, sort_order)
select p.id, e.name, e.pct, e.ord
from public.products p
cross join (values ('Despuntado', 15, 10), ('Termolaminado', 60, 20)) as e (name, pct, ord)
where p.slug = 'tarjeta-de-citaciones'
on conflict (product_id, name) do nothing;

-- Carnet de Control
insert into public.products (category_id, name, slug, description, specs, features, image_path, pricing_mode, unit_label, pack_pricing, extras_exclusive, base_net_price, pricing_rules, price_label, external_url, whatsapp_number, sort_order)
select c.id, 'Carnet de Control', 'carnet-de-control', 'Carnets de control personalizados para la atención y seguimiento de pacientes.', 'Opalina lisa 250 Gr., full color.', null, 'images/carnet-veterinario.jpeg', 'tiers', 'unidades', false, false, null, null, null, null, null, 40
from public.categories c where c.slug = 'productos-impresos'
on conflict (slug) do nothing;

insert into public.product_variants (product_id, name, sort_order)
select p.id, 'Opción 1 · 20 cm x 5,5 cm abierto', 10 from public.products p where p.slug = 'carnet-de-control'
on conflict (product_id, name) do nothing;

insert into public.product_price_tiers (variant_id, quantity, net_price)
select v.id, t.quantity, t.net_price
from public.product_variants v
join public.products p on p.id = v.product_id
cross join (values (200, 25000), (500, 40000), (1000, 65000)) as t (quantity, net_price)
where p.slug = 'carnet-de-control' and v.name = 'Opción 1 · 20 cm x 5,5 cm abierto'
on conflict (variant_id, quantity) do nothing;

insert into public.product_variants (product_id, name, sort_order)
select p.id, 'Opción 2 · 10 cm x 14,5 cm abierto', 20 from public.products p where p.slug = 'carnet-de-control'
on conflict (product_id, name) do nothing;

insert into public.product_price_tiers (variant_id, quantity, net_price)
select v.id, t.quantity, t.net_price
from public.product_variants v
join public.products p on p.id = v.product_id
cross join (values (200, 25000), (500, 50000), (1000, 80000)) as t (quantity, net_price)
where p.slug = 'carnet-de-control' and v.name = 'Opción 2 · 10 cm x 14,5 cm abierto'
on conflict (variant_id, quantity) do nothing;

-- Magnéticos
insert into public.products (category_id, name, slug, description, specs, features, image_path, pricing_mode, unit_label, pack_pricing, extras_exclusive, base_net_price, pricing_rules, price_label, external_url, whatsapp_number, sort_order)
select c.id, 'Magnéticos', 'magneticos', 'Piezas magnéticas personalizadas para promoción y recordación de marca.', 'Impresión en papel fotográfico adhesivo, full color, montado sobre lámina magnética de 0,4 mm.', null, 'images/magneticos.jpeg', 'tiers', 'unidades', false, false, null, null, null, null, null, 50
from public.categories c where c.slug = 'productos-impresos'
on conflict (slug) do nothing;

insert into public.product_variants (product_id, name, sort_order)
select p.id, 'Estándar · 5 cm x 5,5 cm', 10 from public.products p where p.slug = 'magneticos'
on conflict (product_id, name) do nothing;

insert into public.product_price_tiers (variant_id, quantity, net_price)
select v.id, t.quantity, t.net_price
from public.product_variants v
join public.products p on p.id = v.product_id
cross join (values (100, 16000), (300, 33000), (500, 50000), (1000, 85000), (2000, 150000), (3000, 210000)) as t (quantity, net_price)
where p.slug = 'magneticos' and v.name = 'Estándar · 5 cm x 5,5 cm'
on conflict (variant_id, quantity) do nothing;

insert into public.product_variants (product_id, name, sort_order)
select p.id, 'Grande · 10 cm x 5,5 cm', 20 from public.products p where p.slug = 'magneticos'
on conflict (product_id, name) do nothing;

insert into public.product_price_tiers (variant_id, quantity, net_price)
select v.id, t.quantity, t.net_price
from public.product_variants v
join public.products p on p.id = v.product_id
cross join (values (100, 28000), (300, 60000), (500, 85000), (1000, 150000), (2000, 250000), (3000, 360000)) as t (quantity, net_price)
where p.slug = 'magneticos' and v.name = 'Grande · 10 cm x 5,5 cm'
on conflict (variant_id, quantity) do nothing;

insert into public.product_extras (product_id, name, surcharge_percent, sort_order)
select p.id, e.name, e.pct, e.ord
from public.products p
cross join (values ('Termolaminado', 60, 10)) as e (name, pct, ord)
where p.slug = 'magneticos'
on conflict (product_id, name) do nothing;

-- Credenciales PVC
insert into public.products (category_id, name, slug, description, specs, features, image_path, pricing_mode, unit_label, pack_pricing, extras_exclusive, base_net_price, pricing_rules, price_label, external_url, whatsapp_number, sort_order)
select c.id, 'Credenciales PVC', 'credenciales-pvc', 'Credenciales plásticas con diseño personalizado.', 'Tarjeta plástica PVC, material y dimensiones exactas a una tarjeta de crédito. Full color.', null, 'images/credenciales-pvc.jpeg', 'unit', 'unidades', false, false, 3500, '{"unit_prices":[{"up_to":20,"net_price":3500},{"up_to":null,"net_price":3000}],"design_fee":5000,"design_free_from":6}'::jsonb, null, null, null, 60
from public.categories c where c.slug = 'productos-impresos'
on conflict (slug) do nothing;

-- Tarjetas de Presentación
insert into public.products (category_id, name, slug, description, specs, features, image_path, pricing_mode, unit_label, pack_pricing, extras_exclusive, base_net_price, pricing_rules, price_label, external_url, whatsapp_number, sort_order)
select c.id, 'Tarjetas de Presentación', 'tarjetas-de-presentacion', 'Tarjetas profesionales para representar tu marca e identidad.', 'Opalina lisa 250 Gr., full color. Formato 9 cm x 5 cm.', null, 'images/tarjetas-presentacion.jpeg', 'tiers', 'unidades', false, true, null, null, null, null, null, 70
from public.categories c where c.slug = 'productos-impresos'
on conflict (slug) do nothing;

insert into public.product_variants (product_id, name, sort_order)
select p.id, '1 cara', 10 from public.products p where p.slug = 'tarjetas-de-presentacion'
on conflict (product_id, name) do nothing;

insert into public.product_price_tiers (variant_id, quantity, net_price)
select v.id, t.quantity, t.net_price
from public.product_variants v
join public.products p on p.id = v.product_id
cross join (values (200, 13000), (500, 20000), (1000, 30000), (2000, 50000), (5000, 100000)) as t (quantity, net_price)
where p.slug = 'tarjetas-de-presentacion' and v.name = '1 cara'
on conflict (variant_id, quantity) do nothing;

insert into public.product_variants (product_id, name, sort_order)
select p.id, '2 caras', 20 from public.products p where p.slug = 'tarjetas-de-presentacion'
on conflict (product_id, name) do nothing;

insert into public.product_price_tiers (variant_id, quantity, net_price)
select v.id, t.quantity, t.net_price
from public.product_variants v
join public.products p on p.id = v.product_id
cross join (values (200, 16000), (500, 25000), (1000, 40000), (2000, 60000), (5000, 140000)) as t (quantity, net_price)
where p.slug = 'tarjetas-de-presentacion' and v.name = '2 caras'
on conflict (variant_id, quantity) do nothing;

insert into public.product_extras (product_id, name, surcharge_percent, sort_order)
select p.id, e.name, e.pct, e.ord
from public.products p
cross join (values ('Despuntado', 15, 10), ('Termolaminado', 60, 20)) as e (name, pct, ord)
where p.slug = 'tarjetas-de-presentacion'
on conflict (product_id, name) do nothing;

-- Volantes / Flyers
insert into public.products (category_id, name, slug, description, specs, features, image_path, pricing_mode, unit_label, pack_pricing, extras_exclusive, base_net_price, pricing_rules, price_label, external_url, whatsapp_number, sort_order)
select c.id, 'Volantes / Flyers', 'volantes-flyers', 'Material promocional para comunicar servicios, promociones e información.', 'Papel fotográfico u opalina lisa de 10 cm x 14,5 cm, impreso por un lado.', null, 'images/flyers.jpeg', 'tiers', 'unidades', false, false, null, null, null, null, null, 80
from public.categories c where c.slug = 'productos-impresos'
on conflict (slug) do nothing;

insert into public.product_variants (product_id, name, sort_order)
select p.id, 'Fotográfico / Opalina · 10 cm x 14,5 cm', 10 from public.products p where p.slug = 'volantes-flyers'
on conflict (product_id, name) do nothing;

insert into public.product_price_tiers (variant_id, quantity, net_price)
select v.id, t.quantity, t.net_price
from public.product_variants v
join public.products p on p.id = v.product_id
cross join (values (500, 25000), (1000, 35000), (2000, 60000), (4000, 100000)) as t (quantity, net_price)
where p.slug = 'volantes-flyers' and v.name = 'Fotográfico / Opalina · 10 cm x 14,5 cm'
on conflict (variant_id, quantity) do nothing;

insert into public.product_variants (product_id, name, sort_order)
select p.id, 'Mini flyer fotográfico · 10 cm x 7,2 cm', 20 from public.products p where p.slug = 'volantes-flyers'
on conflict (product_id, name) do nothing;

insert into public.product_price_tiers (variant_id, quantity, net_price)
select v.id, t.quantity, t.net_price
from public.product_variants v
join public.products p on p.id = v.product_id
cross join (values (500, 18000), (1000, 28000), (2000, 38000), (4000, 65000), (8000, 110000)) as t (quantity, net_price)
where p.slug = 'volantes-flyers' and v.name = 'Mini flyer fotográfico · 10 cm x 7,2 cm'
on conflict (variant_id, quantity) do nothing;

insert into public.product_variants (product_id, name, sort_order)
select p.id, 'Papel Bond · 10 cm x 13,5 cm', 30 from public.products p where p.slug = 'volantes-flyers'
on conflict (product_id, name) do nothing;

insert into public.product_price_tiers (variant_id, quantity, net_price)
select v.id, t.quantity, t.net_price
from public.product_variants v
join public.products p on p.id = v.product_id
cross join (values (500, 18000), (1000, 28000), (2000, 38000), (4000, 60000), (8000, 100000)) as t (quantity, net_price)
where p.slug = 'volantes-flyers' and v.name = 'Papel Bond · 10 cm x 13,5 cm'
on conflict (variant_id, quantity) do nothing;

-- Pasaporte y Diario de Salud HappyClaws
insert into public.products (category_id, name, slug, description, specs, features, image_path, pricing_mode, unit_label, pack_pricing, extras_exclusive, base_net_price, pricing_rules, price_label, external_url, whatsapp_number, sort_order)
select c.id, 'Pasaporte y Diario de Salud HappyClaws', 'pasaporte-y-diario-de-salud-happyclaws', 'Pasaporte y diario de salud HappyClaws de 24 hojas.', '24 hojas.', null, 'images/pasaporte-salud.png', 'tiers', 'unidades', true, false, null, null, null, null, null, 90
from public.categories c where c.slug = 'productos-impresos'
on conflict (slug) do nothing;

insert into public.product_variants (product_id, name, sort_order)
select p.id, '24 hojas', 10 from public.products p where p.slug = 'pasaporte-y-diario-de-salud-happyclaws'
on conflict (product_id, name) do nothing;

insert into public.product_price_tiers (variant_id, quantity, net_price)
select v.id, t.quantity, t.net_price
from public.product_variants v
join public.products p on p.id = v.product_id
cross join (values (1, 12000), (5, 55000), (12, 120000), (20, 190000)) as t (quantity, net_price)
where p.slug = 'pasaporte-y-diario-de-salud-happyclaws' and v.name = '24 hojas'
on conflict (variant_id, quantity) do nothing;

-- Landing Page
insert into public.products (category_id, name, slug, description, specs, features, image_path, pricing_mode, unit_label, pack_pricing, extras_exclusive, base_net_price, pricing_rules, price_label, external_url, whatsapp_number, sort_order)
select c.id, 'Landing Page', 'landing-page', 'Una página profesional, rápida y enfocada en convertir visitas en contactos.', null, 'Diseño personalizado, versión móvil, botón de WhatsApp y formulario de contacto.', null, 'quote', 'unidades', false, false, null, null, 'Desde $149.990', 'https://bridgeclaw.cl/', '56952361343', 100
from public.categories c where c.slug = 'servicios-web'
on conflict (slug) do nothing;

-- Web Corporativa
insert into public.products (category_id, name, slug, description, specs, features, image_path, pricing_mode, unit_label, pack_pricing, extras_exclusive, base_net_price, pricing_rules, price_label, external_url, whatsapp_number, sort_order)
select c.id, 'Web Corporativa', 'web-corporativa', 'Presencia digital completa para presentar tu empresa, servicios y propuesta de valor.', null, 'Secciones a medida, diseño adaptable, contacto directo y estructura profesional.', null, 'quote', 'unidades', false, false, null, null, 'A cotizar', 'https://bridgeclaw.cl/', '56952361343', 110
from public.categories c where c.slug = 'servicios-web'
on conflict (slug) do nothing;

-- Web Ecommerce
insert into public.products (category_id, name, slug, description, specs, features, image_path, pricing_mode, unit_label, pack_pricing, extras_exclusive, base_net_price, pricing_rules, price_label, external_url, whatsapp_number, sort_order)
select c.id, 'Web Ecommerce', 'web-ecommerce', 'E-commerce preparado para exhibir productos y recibir pedidos o ventas online.', null, 'Catálogo, carrito, integración de contacto y experiencia optimizada para móviles.', null, 'quote', 'unidades', false, false, null, null, 'A cotizar', 'https://bridgeclaw.cl/', '56952361343', 120
from public.categories c where c.slug = 'servicios-web'
on conflict (slug) do nothing;
