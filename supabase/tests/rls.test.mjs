// Pruebas locales de migraciones, RLS, grants y triggers (Postgres WASM vía PGlite).
// Uso: cd supabase/tests && npm install && npm test
// No se conecta a ningún proyecto remoto.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');
const db = new PGlite();

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log('  ✓', name); };
const bad = (name, e) => { fail++; console.log('  ✗', name, '→', e?.message ?? e); };

async function expectOk(name, fn) { try { const r = await fn(); ok(name); return r; } catch (e) { bad(name, e); } }
async function expectErr(name, fn, re) {
  try { await fn(); bad(name, 'se esperaba error'); }
  catch (e) { if (re && !re.test(e.message)) bad(name, 'error inesperado: ' + e.message); else ok(`${name} (${e.message.slice(0, 70)})`); }
}
async function expectVal(name, fn, check) {
  try { const v = await fn(); if (check(v)) ok(name); else bad(name, 'valor: ' + JSON.stringify(v)); } catch (e) { bad(name, e); }
}

// Supabase-like environment stub
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
`);

const files = fs.readdirSync(MIG).filter(f => f.endsWith('.sql')).sort();
console.log('Migraciones (1ª pasada)');
for (const f of files) await expectOk(f, () => db.exec(fs.readFileSync(path.join(MIG, f), 'utf8')));
console.log('Migraciones (2ª pasada, idempotencia)');
for (const f of files) await expectOk(f, () => db.exec(fs.readFileSync(path.join(MIG, f), 'utf8')));

const ADMIN = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('${ADMIN}', 'admin@test.cl', '{"full_name":"Admin","role":"admin"}'),
  ('${USER}', 'user@test.cl', '{"role":"admin"}');`);

async function as(role, sub, sql, params) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [sub ? JSON.stringify({ sub, role }) : '']);
  await db.exec(`set role ${role}`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const pg = (sql, p) => db.query(sql, p).then(r => r.rows);

console.log('\nPerfiles y rol admin');
await expectVal('perfiles creados con rol user aunque metadata diga admin', () => pg(`select role from public.profiles order by email`), r => r.length === 2 && r.every(x => x.role === 'user'));
await expectVal('catálogo seed: 12 productos, 2 categorías', () => pg(`select (select count(*) from public.products)::int p, (select count(*) from public.categories)::int c`), r => r[0].p === 12 && r[0].c === 2);
await expectVal('seed: tramos Tarjeta de Citaciones', () => pg(`select count(*)::int n from public.product_price_tiers t join public.product_variants v on v.id=t.variant_id join public.products p on p.id=v.product_id where p.slug='tarjeta-de-citaciones'`), r => r[0].n === 15);
await expectErr('usuario no puede autoasignarse admin (UPDATE role)', () => as('authenticated', USER, `update public.profiles set role='admin' where id='${USER}'`), /permission denied/);
await expectErr('usuario no puede ejecutar private.set_admin_role', () => as('authenticated', USER, `select private.set_admin_role('${USER}', true)`), /permission denied/);
await expectErr('anon no puede ejecutar private.set_admin_role', () => as('anon', null, `select private.set_admin_role('${USER}', true)`), /permission denied/);
await expectOk('usuario puede editar su nombre', () => as('authenticated', USER, `update public.profiles set full_name='Pepe' where id='${USER}'`));
await expectVal('usuario solo ve su propio perfil', () => as('authenticated', USER, `select id from public.profiles`), r => r.length === 1 && r[0].id === USER);
await expectVal('usuario: is_admin() = false', () => as('authenticated', USER, `select private.is_admin() a`), r => r[0].a === false);
await expectOk('postgres asigna admin con set_admin_role', () => pg(`select private.set_admin_role('${ADMIN}', true)`));
await expectVal('admin: is_admin() = true', () => as('authenticated', ADMIN, `select private.is_admin() a`), r => r[0].a === true);
await expectVal('admin ve todos los perfiles', () => as('authenticated', ADMIN, `select id from public.profiles`), r => r.length === 2);
await expectErr('admin tampoco cambia roles desde la API', () => as('authenticated', ADMIN, `update public.profiles set role='admin' where id='${USER}'`), /permission denied/);

console.log('\nCatálogo: anon');
await expectVal('anon lee 12 productos activos', () => as('anon', null, `select id from public.products`), r => r.length === 12);
await expectErr('anon no inserta productos', () => as('anon', null, `insert into public.products (category_id,name,slug) select id,'X','x' from public.categories limit 1`), /permission denied/);
await expectErr('anon no actualiza precios', () => as('anon', null, `update public.product_price_tiers set net_price = 1`), /permission denied/);
await expectErr('anon no borra categorías', () => as('anon', null, `delete from public.categories`), /permission denied/);
await expectErr('anon no lee clientes', () => as('anon', null, `select * from public.customers`), /permission denied/);
await expectErr('anon no lee pedidos', () => as('anon', null, `select * from public.orders`), /permission denied/);
await expectErr('anon no lee cotizaciones', () => as('anon', null, `select * from public.quote_requests`), /permission denied/);
await expectErr('anon no lee inventario', () => as('anon', null, `select * from public.inventory_movements`), /permission denied/);
await expectErr('anon no lee perfiles', () => as('anon', null, `select * from public.profiles`), /permission denied/);

console.log('\nCatálogo: usuario autenticado sin rol admin');
await expectErr('usuario no inserta categoría', () => as('authenticated', USER, `insert into public.categories (name, slug) values ('X','x')`), /row-level security/);
await expectVal('usuario: update de precios afecta 0 filas', () => as('authenticated', USER, `update public.product_price_tiers set net_price = 1 returning id`), r => r.length === 0);
await expectVal('usuario: delete productos afecta 0 filas', () => as('authenticated', USER, `delete from public.products returning id`), r => r.length === 0);
await expectVal('usuario ve 0 clientes', () => as('authenticated', USER, `select * from public.customers`), r => r.length === 0);
await expectErr('usuario no inserta clientes', () => as('authenticated', USER, `insert into public.customers (name) values ('X')`), /row-level security/);
await expectErr('usuario no registra inventario', () => as('authenticated', USER, `insert into public.inventory_movements (product_id, movement_type, quantity, reason) select id,'entrada',5,'test' from public.products limit 1`), /No autorizado/);

console.log('\nCatálogo: admin CRUD');
const cat = await expectOk('admin crea categoría', () => as('authenticated', ADMIN, `insert into public.categories (name, slug, kind) values ('Pruebas','pruebas','printed') returning id`));
const prod = await expectOk('admin crea producto', () => as('authenticated', ADMIN, `insert into public.products (category_id, name, slug, base_net_price) values ($1,'Prod test','prod-test', 10000) returning id, base_gross_price`, [cat[0].id]));
await expectVal('precio final calculado con IVA', async () => prod, r => r[0].base_gross_price === 11900);
await expectErr('admin no puede fijar stock directo en insert', () => as('authenticated', ADMIN, `insert into public.products (category_id, name, slug, stock) values ($1,'P2','p2', 50)`, [cat[0].id]), /permission denied/);
await expectErr('admin no puede editar stock directo', () => as('authenticated', ADMIN, `update public.products set stock = 99 where id = $1`, [prod[0].id]), /permission denied/);
const variant = await expectOk('admin crea variante y tramo', async () => {
  const v = await as('authenticated', ADMIN, `insert into public.product_variants (product_id, name) values ($1,'Std') returning id`, [prod[0].id]);
  await as('authenticated', ADMIN, `insert into public.product_price_tiers (variant_id, quantity, net_price) values ($1, 100, 5000)`, [v[0].id]);
  return v;
});
await expectErr('tramo duplicado rechazado', () => as('authenticated', ADMIN, `insert into public.product_price_tiers (variant_id, quantity, net_price) values ($1, 100, 6000)`, [variant[0].id]), /duplicate/);
await expectErr('slug inválido rechazado', () => as('authenticated', ADMIN, `insert into public.categories (name, slug) values ('Mal','Mal Slug')`), /check/);
await expectOk('admin desactiva producto', () => as('authenticated', ADMIN, `update public.products set is_active = false where id = $1`, [prod[0].id]));
await expectVal('anon ya no ve producto inactivo ni sus variantes/tramos', () => as('anon', null, `select (select count(*) from public.products where slug='prod-test')::int p, (select count(*) from public.product_variants where product_id='${prod[0].id}')::int v, (select count(*) from public.product_price_tiers where variant_id='${variant[0].id}')::int t`), r => r[0].p === 0 && r[0].v === 0 && r[0].t === 0);
await expectOk('admin desactiva categoría', () => as('authenticated', ADMIN, `update public.products set is_active = true where id = $1; `, [prod[0].id]).then(() => as('authenticated', ADMIN, `update public.categories set is_active=false where id=$1`, [cat[0].id])));
await expectVal('anon no ve productos de categoría inactiva', () => as('anon', null, `select count(*)::int n from public.products where slug='prod-test'`), r => r[0].n === 0);

console.log('\nInventario');
await expectOk('entrada +10', () => as('authenticated', ADMIN, `insert into public.inventory_movements (product_id, movement_type, quantity, reason) values ($1,'entrada',10,'Compra inicial')`, [prod[0].id]));
await expectOk('salida 3', () => as('authenticated', ADMIN, `insert into public.inventory_movements (product_id, movement_type, quantity, reason) values ($1,'salida',3,'Venta mostrador')`, [prod[0].id]));
await expectErr('salida 20 rechazada (stock negativo)', () => as('authenticated', ADMIN, `insert into public.inventory_movements (product_id, movement_type, quantity, reason) values ($1,'salida',20,'Error')`, [prod[0].id]), /Stock insuficiente/);
await expectErr('salida con cantidad negativa rechazada', () => as('authenticated', ADMIN, `insert into public.inventory_movements (product_id, movement_type, quantity, reason) values ($1,'salida',-5,'Truco')`, [prod[0].id]), /check/);
await expectOk('ajuste -2', () => as('authenticated', ADMIN, `insert into public.inventory_movements (product_id, movement_type, quantity, reason) values ($1,'ajuste',-2,'Conteo físico')`, [prod[0].id]));
await expectVal('stock = 5 y movimiento con stock_after y autor', () => as('authenticated', ADMIN, `select p.stock, (select json_agg(json_build_object('a', stock_after, 'by', created_by) order by created_at) from public.inventory_movements where product_id=p.id) m from public.products p where p.id=$1`, [prod[0].id]), r => r[0].stock === 5 && r[0].m.every(x => x.by === ADMIN));
await expectErr('movimientos inmutables (update)', () => as('authenticated', ADMIN, `update public.inventory_movements set quantity = 1`), /permission denied/);
await expectErr('movimientos inmutables (delete)', () => as('authenticated', ADMIN, `delete from public.inventory_movements`), /permission denied/);

console.log('\nClientes');
await expectErr('RUT inválido rechazado', () => as('authenticated', ADMIN, `insert into public.customers (name, rut) values ('Cliente', '12.345.678-9')`), /check/);
const cust = await expectOk('cliente con RUT válido normalizado', () => as('authenticated', ADMIN, `insert into public.customers (name, rut, email, created_by) values ('Clínica Sur', '11.111.111-1', ' CONTACTO@Clinica.CL ', '${USER}') returning id, rut, email, created_by`));
await expectVal('RUT/correo normalizados y autor forzado', async () => cust, r => r[0].rut === '11111111-1' && r[0].email === 'contacto@clinica.cl' && r[0].created_by === ADMIN);
await expectOk('admin edita cliente', () => as('authenticated', ADMIN, `update public.customers set commune='Temuco' where id=$1`, [cust[0].id]));

console.log('\nSolicitud pública (RPC)');
async function rpcCall(payload, headers = { 'cf-connecting-ip': '1.2.3.4' }) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claims', '', false), set_config('request.headers', $1, false)`, [JSON.stringify(headers)]);
  await db.exec('set role anon');
  try { return (await db.query(`select public.submit_quote_request($1::jsonb) r`, [JSON.stringify(payload)])).rows[0].r; } finally { await db.exec('reset role'); }
}
const cartPayload = { source: 'carrito_web', items: [
  { product_name: 'Recetarios Médicos', option: '1/2 Carta', quantity_label: '10 talonarios', extras: ['Foliado'], packs: 2, unit_net_price: 50600, net_total: 1 },
  { product_name: 'Producto inventado', packs: 1, unit_net_price: 1000 } ] };
await expectVal('anon registra carrito, montos recalculados en servidor', async () => {
  const r = await rpcCall(cartPayload);
  const q = await pg(`select q.net_amount, q.vat_amount, q.total_amount, (select count(*) from public.quote_request_items i where i.quote_request_id=q.id and i.product_id is not null)::int linked from public.quote_requests q where quote_number=$1`, [r.quote_number]);
  return { r, q: q[0] };
}, v => v.r.ok && /^COT-\d{6}$/.test(v.r.quote_number) && Number(v.q.net_amount) === 102200 && Number(v.q.vat_amount) === 19418 && Number(v.q.total_amount) === 121618 && v.q.linked === 1);
await expectErr('formulario incompleto rechazado', () => rpcCall({ source: 'formulario_cotizacion', contact: { name: 'A' } }, { 'cf-connecting-ip': '5.5.5.5' }), /inválidos/);
await expectVal('formulario válido aceptado', () => rpcCall({ source: 'formulario_cotizacion', contact: { name: 'Ana Pérez', phone: '+56912345678', email: 'ana@test.cl', company: 'Consulta' }, product_summary: 'Recetarios', requested_quantity: '500', required_date: '2026-10-01', description: 'Logo a color' }, { 'cf-connecting-ip': '5.5.5.5' }), r => r.ok);
await expectErr('origen inválido rechazado', () => rpcCall({ source: 'panel', items: [] }, { 'cf-connecting-ip': '6.6.6.6' }), /Origen/);
await expectErr('más de 30 ítems rechazado', () => rpcCall({ source: 'carrito_web', items: Array(31).fill({ product_name: 'x', packs: 1 }) }, { 'cf-connecting-ip': '6.6.6.6' }), /Ítems/);
await expectErr('packs negativos rechazados', () => rpcCall({ source: 'carrito_web', items: [{ product_name: 'x', packs: -1 }] }, { 'cf-connecting-ip': '6.6.6.7' }), /Ítem inválido/);
await expectVal('honeypot: responde ok sin guardar', async () => {
  const before = (await pg(`select count(*)::int n from public.quote_requests`))[0].n;
  const r = await rpcCall({ ...cartPayload, website: 'http://spam' }, { 'cf-connecting-ip': '7.7.7.7' });
  const after = (await pg(`select count(*)::int n from public.quote_requests`))[0].n;
  return r.ok && !r.quote_number && before === after;
}, v => v === true);
await expectErr('límite por IP (6ª solicitud en 10 min)', async () => { for (let i = 0; i < 6; i++) await rpcCall(cartPayload, { 'cf-connecting-ip': '9.9.9.9' }); }, /Demasiadas/);
await expectVal('huella guardada como hash, no IP', () => pg(`select client_fingerprint fp from public.quote_requests where client_fingerprint is not null limit 1`), r => /^[0-9a-f]{64}$/.test(r[0].fp));
await expectErr('anon no inserta directo en quote_requests', () => as('anon', null, `insert into public.quote_requests (source) values ('carrito_web')`), /permission denied/);

console.log('\nCotizaciones y pedidos (admin)');
const quote = (await pg(`select id from public.quote_requests order by created_at limit 1`))[0];
await expectOk('admin cambia estado de cotización y agrega notas', () => as('authenticated', ADMIN, `update public.quote_requests set status='en_revision', admin_notes='Llamar', customer_id=$2 where id=$1`, [quote.id, cust[0].id]));
await expectErr('admin no altera montos de cotización', () => as('authenticated', ADMIN, `update public.quote_requests set net_amount=1 where id=$1`, [quote.id]), /permission denied/);
await expectErr('estado inválido rechazado', () => as('authenticated', ADMIN, `update public.quote_requests set status='xx' where id=$1`, [quote.id]), /check/);
const order = await expectOk('admin crea pedido desde cotización', () => as('authenticated', ADMIN, `insert into public.orders (customer_id, quote_request_id, channel, shipping_net) values ($1,$2,'whatsapp', 5000) returning id, order_number, total_amount`, [cust[0].id, quote.id]));
await expectOk('admin agrega ítems', () => as('authenticated', ADMIN, `insert into public.order_items (order_id, product_id, description, options, quantity, unit_net_price) values ($1,$2,'Recetarios Médicos 1/2 Carta','{"formato":"1/2 Carta"}',2,50600), ($1,null,'Diseño',  '{}',1,10000)`, [order[0].id, prod[0].id]));
await expectVal('totales recalculados: neto 116200, IVA 22078, total 138278', () => as('authenticated', ADMIN, `select order_number, net_amount, vat_amount, total_amount from public.orders where id=$1`, [order[0].id]), r => /^MP-\d{6}$/.test(r[0].order_number) && Number(r[0].net_amount) === 116200 && Number(r[0].vat_amount) === 22078 && Number(r[0].total_amount) === 138278);
await expectErr('admin no fija totales a mano', () => as('authenticated', ADMIN, `update public.orders set total_amount=1 where id=$1`, [order[0].id]), /permission denied/);
await expectOk('eliminar ítem recalcula', () => as('authenticated', ADMIN, `delete from public.order_items where description='Diseño' and order_id=$1`, [order[0].id]));
await expectVal('total tras borrar ítem = 126378', () => pg(`select total_amount from public.orders where id=$1`, [order[0].id]), r => Number(r[0].total_amount) === 126378);
await expectOk('cambiar estado y pago', () => as('authenticated', ADMIN, `update public.orders set status='en_produccion', payment_status='abonado' where id=$1`, [order[0].id]));
await expectOk('agregar nota', () => as('authenticated', ADMIN, `insert into public.order_events (order_id, event_type, note) values ($1,'nota','Cliente pidió cambio de color')`, [order[0].id]));
await expectErr('no se falsifican eventos de estado', () => as('authenticated', ADMIN, `insert into public.order_events (order_id, event_type, note) values ($1,'estado','x')`, [order[0].id]), /Solo se pueden registrar notas/);
await expectVal('historial: creado, estado, pago, nota', () => as('authenticated', ADMIN, `select event_type from public.order_events where order_id=$1 order by created_at, event_type`, [order[0].id]), r => ['creado', 'estado', 'nota', 'pago'].every(t => r.some(x => x.event_type === t)));
await expectErr('pedidos no se eliminan', () => as('authenticated', ADMIN, `delete from public.orders where id=$1`, [order[0].id]), /permission denied/);
await expectErr('cliente con pedidos no se elimina', () => as('authenticated', ADMIN, `delete from public.customers where id=$1`, [cust[0].id]), /foreign key/);
await expectVal('usuario no admin ve 0 pedidos', () => as('authenticated', USER, `select id from public.orders`), r => r.length === 0);

console.log('\nStorage');
const okPath = `products/${prod[0].id}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp`;
await expectOk('admin sube imagen en ruta válida', () => as('authenticated', ADMIN, `insert into storage.objects (bucket_id, name) values ('product-images', $1)`, [okPath]));
await expectErr('admin: ruta no permitida', () => as('authenticated', ADMIN, `insert into storage.objects (bucket_id, name) values ('product-images', 'otra/carpeta/x.exe')`), /row-level security/);
await expectErr('usuario no sube imágenes', () => as('authenticated', USER, `insert into storage.objects (bucket_id, name) values ('product-images', $1)`, [okPath.replace('aaaa', 'bbbb')]), /row-level security/);
await expectErr('anon no sube imágenes', () => as('anon', null, `insert into storage.objects (bucket_id, name) values ('product-images', $1)`, [okPath]), /row-level security/);
await expectVal('anon no puede listar/sobrescribir objetos', () => as('anon', null, `update storage.objects set name = name returning id`), r => r.length === 0);
await expectVal('bucket: público, 5MB, solo imágenes', () => pg(`select public, file_size_limit, allowed_mime_types from storage.buckets where id='product-images'`), r => r[0].public && Number(r[0].file_size_limit) === 5242880 && r[0].allowed_mime_types.length === 4);
await expectOk('admin elimina imagen', () => as('authenticated', ADMIN, `delete from storage.objects where name = $1`, [okPath]));

console.log('\nCatálogo simple: precio, stock y estado');
const simple = await expectOk('admin crea producto de precio simple', async () => {
    const cat2 = await as('authenticated', ADMIN, `select id from public.categories where slug='productos-impresos'`);
    return as('authenticated', ADMIN, `insert into public.products (category_id, name, slug, pricing_mode, base_net_price, track_stock, low_stock_threshold) values ($1,'Tazón personalizado','tazon-personalizado','unit', 7990, true, 3) returning id, stock_status`, [cat2[0].id]);
});
await expectVal('stock inicial 0 → AGOTADO', async () => simple, r => r[0].stock_status === 'agotado');
await expectOk('entrada de 3 unidades', () => as('authenticated', ADMIN, `insert into public.inventory_movements (product_id, movement_type, quantity, reason) values ($1,'entrada',3,'Stock inicial')`, [simple[0].id]));
await expectVal('stock 3 con umbral 3 → STOCK BAJO', () => pg(`select stock_status from public.products where id=$1`, [simple[0].id]), r => r[0].stock_status === 'bajo');
await expectOk('entrada de 10 unidades', () => as('authenticated', ADMIN, `insert into public.inventory_movements (product_id, movement_type, quantity, reason) values ($1,'entrada',10,'Reposición')`, [simple[0].id]));
await expectVal('stock 13 → EN STOCK', () => pg(`select stock_status from public.products where id=$1`, [simple[0].id]), r => r[0].stock_status === 'disponible');
await expectVal('anon ve stock_status del producto', () => as('anon', null, `select stock_status, base_net_price from public.products where id=$1`, [simple[0].id]), r => r[0].stock_status === 'disponible' && r[0].base_net_price === 7990);
await expectErr('anon no ve la cantidad exacta de stock', () => as('anon', null, `select stock from public.products limit 1`), /permission denied/);
await expectErr('anon no ve SKU interno', () => as('anon', null, `select sku from public.products limit 1`), /permission denied/);
await expectOk('admin cambia precio', () => as('authenticated', ADMIN, `update public.products set base_net_price = 8490 where id=$1`, [simple[0].id]));
await expectErr('precio negativo rechazado', () => as('authenticated', ADMIN, `update public.products set base_net_price = -1 where id=$1`, [simple[0].id]), /check/);
await expectErr('usuario no admin no cambia precio', async () => { const r = await as('authenticated', USER, `update public.products set base_net_price = 1 where id=$1 returning id`, [simple[0].id]); if (!r.length) throw new Error('0 filas (RLS)'); }, /RLS/);
await expectOk('producto sin historial se puede eliminar', async () => {
    const tmp = await as('authenticated', ADMIN, `insert into public.products (category_id, name, slug) select id,'Temporal','temporal' from public.categories limit 1 returning id`);
    await as('authenticated', ADMIN, `delete from public.products where id=$1`, [tmp[0].id]);
});
await expectErr('producto con pedidos no se elimina (se desactiva)', async () => {
    const withHistory = await pg(`select product_id from public.quote_request_items where product_id is not null limit 1`);
    await as('authenticated', ADMIN, `delete from public.products where id=$1`, [withHistory[0].product_id]);
}, /desactívalo/);

console.log('\nAuditoría de grants/RLS');
await expectVal('RLS activo en todas las tablas de public', () => pg(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`), r => r.length === 0);
await expectVal('anon sin INSERT/UPDATE/DELETE en ninguna tabla de public', () => pg(`select table_name, privilege_type from information_schema.role_table_grants where grantee='anon' and table_schema='public' and privilege_type not in ('SELECT')`), r => r.length === 0);
await expectVal('funciones SECURITY DEFINER expuestas a anon: solo submit_quote_request', () => pg(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')`), r => r.length === 1 && r[0].proname === 'submit_quote_request');

console.log(`\nResultado: ${pass} OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
