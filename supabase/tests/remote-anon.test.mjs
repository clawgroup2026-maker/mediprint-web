// Verificación remota de permisos para visitantes anónimos (PostgREST + Storage).
// Usa SOLO la clave pública de js/supabase-config.js. No crea ni modifica datos:
// la única escritura probada es la RPC pública con el campo trampa activo,
// que responde OK sin guardar nada.
// Uso: node supabase/tests/remote-anon.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BRIDGECLAW_REF = 'azybyvgjkvinrjjcpjit';
const configText = fs.readFileSync(path.join(ROOT, 'js', 'supabase-config.js'), 'utf8');
const url = (configText.match(/url:\s*'([^']*)'/) || [])[1]?.replace(/\/+$/, '');
const key = (configText.match(/publishableKey:\s*'([^']*)'/) || [])[1];

if (!url || !key) { console.error('Configura url y publishableKey en js/supabase-config.js'); process.exit(1); }
if (url.includes(BRIDGECLAW_REF)) { console.error('ALTO: la URL apunta al proyecto de BridgeClaw.'); process.exit(1); }
if (/service_role|sb_secret_/.test(key) || (key.startsWith('eyJ') && JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role !== 'anon')) {
    console.error('ALTO: la clave configurada no es pública.'); process.exit(1);
}

const headers = { apikey: key, 'Content-Type': 'application/json', ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) };
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`); };
const req = async (method, p, body) => {
    const res = await fetch(`${url}${p}`, { method, headers: { ...headers, Prefer: 'return=minimal' }, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch { /* sin cuerpo */ }
    return { status: res.status, json };
};
const denied = r => r.status === 401 || r.status === 403 || r.json?.code === '42501';

console.log(`Proyecto: ${url}\n`);

const catalog = await req('GET', '/rest/v1/products?select=id,name,stock_status,category:categories(kind)&is_active=eq.true');
check('anon lee productos activos', catalog.status === 200 && Array.isArray(catalog.json) && catalog.json.length > 0, `${catalog.json?.length ?? 0} productos`);
check('anon lee categorías', (await req('GET', '/rest/v1/categories?select=slug')).status === 200);
check('anon NO ve cantidad de stock', denied(await req('GET', '/rest/v1/products?select=stock&limit=1')));
check('anon NO ve productos inactivos', (await req('GET', '/rest/v1/products?select=id&is_active=eq.false')).json?.length === 0);

for (const table of ['customers', 'orders', 'order_items', 'order_events', 'quote_requests', 'quote_request_items', 'inventory_movements', 'profiles']) {
    const r = await req('GET', `/rest/v1/${table}?select=*&limit=1`);
    check(`anon NO lee ${table}`, denied(r), `HTTP ${r.status}`);
}

check('anon NO crea productos', denied(await req('POST', '/rest/v1/products', { name: 'x', slug: 'x-anon-test', category_id: '00000000-0000-0000-0000-000000000000' })));
check('anon NO cambia precios', denied(await req('PATCH', '/rest/v1/product_price_tiers?id=eq.00000000-0000-0000-0000-000000000000', { net_price: 1 })));
check('anon NO borra categorías', denied(await req('DELETE', '/rest/v1/categories?slug=eq.productos-impresos')));
check('anon NO crea clientes', denied(await req('POST', '/rest/v1/customers', { name: 'x' })));
check('anon NO registra inventario', denied(await req('POST', '/rest/v1/inventory_movements', { product_id: '00000000-0000-0000-0000-000000000000', movement_type: 'entrada', quantity: 1, reason: 'test' })));
check('anon NO se asigna admin', denied(await req('PATCH', '/rest/v1/profiles?id=eq.00000000-0000-0000-0000-000000000000', { role: 'admin' })));

const privateRpc = await req('POST', '/rest/v1/rpc/set_admin_role', { p_user_id: '00000000-0000-0000-0000-000000000000', p_is_admin: true });
check('funciones privadas no expuestas (set_admin_role)', privateRpc.status === 404 || denied(privateRpc), `HTTP ${privateRpc.status}`);

const honeypot = await req('POST', '/rest/v1/rpc/submit_quote_request', { p_payload: { source: 'carrito_web', website: 'verificacion-automatica', items: [] } });
check('RPC pública responde (campo trampa: no guarda)', honeypot.status === 200 && honeypot.json?.ok === true && !honeypot.json?.quote_number);
const invalid = await req('POST', '/rest/v1/rpc/submit_quote_request', { p_payload: { source: 'panel' } });
check('RPC pública valida el origen', invalid.status >= 400, `HTTP ${invalid.status}`);

const upload = await fetch(`${url}/storage/v1/object/product-images/products/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000.png`, {
    method: 'POST', headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'image/png' }, body: new Uint8Array([137, 80, 78, 71])
});
check('anon NO sube imágenes', upload.status >= 400, `HTTP ${upload.status}`);
const list = await fetch(`${url}/storage/v1/object/list/product-images`, { method: 'POST', headers, body: JSON.stringify({ prefix: 'products/', limit: 5 }) });
const listed = await list.json().catch(() => null);
check('anon NO lista archivos del bucket', !Array.isArray(listed) || listed.length === 0, `HTTP ${list.status}`);

console.log(`\nResultado: ${pass} OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
