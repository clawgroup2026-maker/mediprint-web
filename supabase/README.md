# MediPrint · Supabase y panel de administración

Proyecto Supabase **propio de MediPrint**: `mediprint-produccion`.
**Nunca** usar el proyecto de BridgeClaw (`azybyvgjkvinrjjcpjit`).

## Arquitectura

```
Web pública (HTML/JS estático, Cloudflare Pages)
 ├─ index.html   catálogo local de respaldo → reemplazado por Supabase si responde
 │               carrito + IVA + "Finalizar por WhatsApp" (sin cambios)
 ├─ cotizar.html formulario → WhatsApp (sin cambios)
 │               ambos registran la solicitud en segundo plano (RPC pública)
 └─ js/supabase-config.js  URL + clave PÚBLICA (única configuración)

Panel /admin/ (ES modules nativos, supabase-js local en admin/vendor)
 └─ Supabase Auth (correo+contraseña) → verificación de rol en profiles

Supabase
 ├─ RLS en todas las tablas · rol admin = private.is_admin() (auth.uid())
 ├─ Escritura pública SOLO vía public.submit_quote_request(jsonb)
 └─ Storage: bucket product-images (lectura pública, escritura solo admin)
```

## Migraciones (`supabase/migrations`)

| Archivo | Propósito |
|---|---|
| `…120000_base_perfiles_y_roles` | Esquema `private`, `profiles`, `is_admin()`, bloqueo de autoascenso, `set_admin_role()` |
| `…120100_catalogo` | `categories`, `products`, `product_variants`, `product_price_tiers`, `product_extras` + estado de stock |
| `…120200_clientes_cotizaciones_pedidos` | `customers` (RUT validado), `quote_requests`(+items), `orders`(+items), `order_events`, totales en servidor |
| `…120300_inventario` | `inventory_movements` inmutables; stock nunca negativo |
| `…120400_rpc_solicitud_publica` | `submit_quote_request`: validación, recálculo de montos, límite por IP, campo trampa |
| `…120500_storage_imagenes_productos` | Bucket `product-images` (5 MB, JPG/PNG/WebP/AVIF) + políticas |
| `…120600_seed_catalogo_actual` | Carga el catálogo y precios actuales de la web (no sobrescribe cambios) |

Todas son idempotentes (se pueden re-ejecutar).

## Pruebas

```bash
cd supabase/tests && npm install && npm test      # local: migraciones + RLS + triggers (116 casos)
node supabase/tests/remote-anon.test.mjs           # remoto: permisos anónimos vía API pública
```

## Despliegue (una sola vez)

```bash
npx supabase login
npx supabase projects list                          # confirmar ref de mediprint-produccion
npx supabase link --project-ref <REF_MEDIPRINT>
npx supabase db push --dry-run                      # revisar
npx supabase db push
```

Luego completar `js/supabase-config.js` con la URL y la **publishable/anon key**
(Dashboard → Project Settings → API Keys). Nunca la `service_role` / `secret`.

En Authentication → Sign In / Providers se recomienda **desactivar "Allow new users to sign up"**
(los administradores se crean desde el Dashboard). Aunque alguien se registre, no obtiene acceso.

## Primer administrador

1. Dashboard → Authentication → Users → **Add user** (correo + contraseña, *Auto Confirm User*).
2. Copiar el UUID.
3. SQL Editor → ejecutar `supabase/sql/asignar_primer_admin.sql` reemplazando el UUID
   (en resumen: `select * from private.set_admin_role('<UUID>', true);`).

Los roles no se pueden cambiar desde el panel ni desde la API.

## Equivalencia de columnas pedidas → modelo

| Pedido | Columna real |
|---|---|
| `price` | `products.base_net_price` (neto CLP entero; IVA en `vat_rate`) · precios por cantidad en `product_price_tiers` |
| `stock` | `products.stock` (solo vía `inventory_movements`) + `stock_status` calculado |
| `image_url` | `products.image_path` (ruta en Storage o imagen estática del sitio) |
| `active` | `products.is_active` |
