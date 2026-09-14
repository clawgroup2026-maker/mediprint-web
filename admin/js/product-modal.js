/* ========================================
   MEDIPRINT ADMIN · Modal de producto (crear / editar rápido)
   Campos comerciales habituales: nombre, descripción, precio, stock,
   categoría, imagen y estado. Lo avanzado (formatos, tramos por
   cantidad y opcionales) está en la ficha completa.
   ======================================== */

import { esc, run, money, grossPrice, field, formDialog, slugify, toast, friendlyError } from './ui.js';
import { imageUrl, IMAGE_BUCKET, IMAGE_TYPES, MAX_IMAGE_BYTES } from './supabase.js';
import { setStock, stockBadge } from './stock.js';

function validateImage(file) {
    if (!file) return null;
    if (!IMAGE_TYPES[file.type]) throw new Error('Formato de imagen no permitido. Usa JPG, PNG, WebP o AVIF.');
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`La imagen pesa ${(file.size / 1048576).toFixed(1)} MB; el máximo es 5 MB.`);
    return file;
}

async function uploadImage(sb, productId, file) {
    const path = `products/${productId}/${crypto.randomUUID()}.${IMAGE_TYPES[file.type]}`;
    const { error } = await sb.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
    if (error) throw error;
    return path;
}

async function removeStoredImage(sb, path) {
    if (!path?.startsWith('products/')) return;
    const { error } = await sb.storage.from(IMAGE_BUCKET).remove([path]);
    if (error) toast(`No se pudo borrar el archivo anterior: ${friendlyError(error)}`, 'error');
}

/** Inserta con slug único (agrega sufijo si ya existe) */
async function insertProduct(sb, payload) {
    const base = slugify(payload.name) || 'producto';
    for (let attempt = 0; attempt < 4; attempt++) {
        const slug = attempt === 0 ? base : `${base.slice(0, 110)}-${Math.random().toString(36).slice(2, 6)}`;
        const { data, error } = await sb.from('products').insert({ ...payload, slug }).select('id').single();
        if (!error) return data;
        if (error.code !== '23505' || !/slug/.test(error.message)) throw error;
    }
    throw new Error('No se pudo generar un identificador único para el producto.');
}

/**
 * Abre el modal. `product` null = nuevo. Devuelve el id guardado o null.
 */
export async function productDialog(sb, product, categories) {
    const isNew = !product;
    const usesTiers = product?.pricing_mode === 'tiers';
    const isQuote = product?.pricing_mode === 'quote';
    const vat = Number(product?.vat_rate ?? 19);
    let savedId = product?.id || null;

    const priceHint = usesTiers
        ? 'Este producto usa tramos por cantidad (edítalos en "Opciones avanzadas"). Este valor es solo referencial.'
        : isQuote ? 'Producto "a cotizar": el precio es referencial.' : 'Precio neto por unidad en CLP, sin puntos. La web muestra "+ IVA".';

    const categoryOptions = `<option value="">Selecciona…</option>${categories
        .map(c => `<option value="${c.id}"${c.id === product?.category_id ? ' selected' : ''}>${esc(c.name)}${c.is_active === false ? ' (inactiva)' : ''}</option>`).join('')}`;

    const body = `
        <div class="adm-form-grid">
            ${field({ name: 'name', label: 'Nombre', value: product?.name, required: true, full: true, attrs: 'maxlength="120" autocomplete="off"' })}
            ${field({ name: 'category_id', label: 'Categoría', type: 'select', value: categoryOptions, required: true })}
            <div class="adm-field">
                <label for="pmActive">Estado</label>
                <select id="pmActive" name="is_active">
                    <option value="true"${product?.is_active !== false ? ' selected' : ''}>Activo (visible en la tienda)</option>
                    <option value="false"${product?.is_active === false ? ' selected' : ''}>Inactivo (oculto)</option>
                </select>
            </div>
            ${field({ name: 'description', label: 'Descripción', type: 'textarea', value: product?.description, full: true, attrs: 'maxlength="1000" rows="3"' })}

            <div class="adm-field">
                <label for="pmPrice">Precio neto (CLP)${usesTiers || isQuote ? '' : ' <span aria-hidden="true">*</span>'}</label>
                <small id="pmPriceHint" class="adm-hint">${esc(priceHint)}</small>
                <input id="pmPrice" name="base_net_price" type="number" min="0" max="1000000000" step="1" inputmode="numeric"
                    value="${esc(product?.base_net_price ?? '')}" aria-describedby="pmPriceHint" ${usesTiers || isQuote ? '' : 'required'}>
            </div>
            <div class="adm-field">
                <span class="adm-label">Vista en la tienda</span>
                <output class="adm-output" data-price-preview>—</output>
            </div>

            <div class="adm-field">
                <label for="pmStock">Stock ${product?.track_stock ? `<span class="adm-inline-badge">${stockBadge(product.stock_status)}</span>` : ''}</label>
                <small id="pmStockHint" class="adm-hint">Dejar vacío = no controlar stock (productos a pedido).</small>
                <input id="pmStock" name="stock" type="number" min="0" step="1" inputmode="numeric"
                    value="${product?.track_stock ? esc(product.stock) : ''}" aria-describedby="pmStockHint">
            </div>
            ${field({ name: 'low_stock_threshold', label: 'Alerta de stock bajo en', type: 'number', value: product?.low_stock_threshold ?? 5, hint: 'Se marca STOCK BAJO con esta cantidad o menos.', attrs: 'min="0" step="1"' })}
            <div class="adm-field adm-field--full" data-stock-reason hidden>
                <label for="pmStockReason">Motivo del cambio de stock</label>
                <input id="pmStockReason" name="stock_reason" type="text" maxlength="500" minlength="3" value="Ajuste manual desde el panel">
            </div>

            <div class="adm-field adm-field--full">
                <span class="adm-label">Imagen</span>
                <div class="adm-image-editor adm-image-editor--compact">
                    <img src="${esc(imageUrl(product?.image_path))}" alt="" class="adm-image-preview" data-image-preview>
                    <div>
                        <label for="pmImage" class="adm-sr">${product?.image_path ? 'Reemplazar imagen' : 'Subir imagen'}</label>
                        <input id="pmImage" type="file" accept="image/jpeg,image/png,image/webp,image/avif" aria-describedby="pmImageHint">
                        <small id="pmImageHint" class="adm-hint">JPG, PNG, WebP o AVIF · máx. 5 MB. ${product?.image_path ? 'Seleccionar un archivo reemplaza la imagen actual.' : ''}</small>
                        ${product?.image_path ? '<label class="adm-check"><input type="checkbox" name="remove_image"> <span>Eliminar imagen actual</span></label>' : ''}
                    </div>
                </div>
            </div>
        </div>
        ${!isNew ? `<p class="adm-hint"><a href="#/productos/${product.id}" data-advanced>Opciones avanzadas: formatos, tramos por cantidad, opcionales, IVA y SKU →</a></p>` : ''}`;

    const result = await formDialog({
        title: isNew ? 'Nuevo producto' : `Editar · ${product.name}`,
        body,
        wide: true,
        submitLabel: isNew ? 'Crear producto' : 'Guardar cambios',
        onMount: (form, dialog) => {
            const price = form.elements.base_net_price;
            const preview = form.querySelector('[data-price-preview]');
            const syncPrice = () => {
                preview.textContent = price.value === ''
                    ? (usesTiers ? 'Según tramos' : isQuote ? (product.price_label || 'A cotizar') : '—')
                    : `${money(price.value)} + IVA (${money(grossPrice(price.value, vat))} con IVA)`;
            };
            price.addEventListener('input', syncPrice);
            syncPrice();

            const stock = form.elements.stock;
            const reasonBox = form.querySelector('[data-stock-reason]');
            stock.addEventListener('input', () => {
                reasonBox.hidden = isNew || !product.track_stock || stock.value === '' || Number(stock.value) === Number(product.stock);
            });

            const file = form.querySelector('#pmImage');
            const img = form.querySelector('[data-image-preview]');
            let objectUrl = null;
            file.addEventListener('change', () => {
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                try {
                    const selected = validateImage(file.files[0]);
                    file.setCustomValidity('');
                    img.src = selected ? (objectUrl = URL.createObjectURL(selected)) : imageUrl(product?.image_path);
                } catch (error) {
                    file.setCustomValidity(error.message);
                    file.reportValidity();
                    file.value = '';
                    img.src = imageUrl(product?.image_path);
                }
            });
            dialog.querySelector('[data-advanced]')?.addEventListener('click', () => dialog.close());
            if (isNew) form.elements.name.focus();
        },
        onSubmit: async (data, form) => {
            const file = validateImage(form.querySelector('#pmImage').files[0]);
            const stockValue = data.stock;
            if (stockValue !== null && (!Number.isInteger(stockValue) || stockValue < 0)) throw new Error('El stock debe ser un entero mayor o igual a 0.');

            const payload = {
                name: data.name,
                category_id: data.category_id,
                description: data.description,
                base_net_price: data.base_net_price,
                is_active: data.is_active === 'true',
                low_stock_threshold: data.low_stock_threshold ?? 5,
                track_stock: stockValue !== null
            };

            // 1) Crear o actualizar el producto (si un paso posterior falla y se
            //    reintenta, ya no se vuelve a crear: se actualiza)
            let current = product;
            const previousImage = product?.image_path || null;
            if (!savedId) {
                const created = await insertProduct(sb, { ...payload, pricing_mode: 'unit', unit_label: 'unidades' });
                savedId = created.id;
                current = { id: savedId, stock: 0, track_stock: payload.track_stock, image_path: null, name: payload.name };
                product = current;
            } else {
                await run(sb.from('products').update(payload).eq('id', savedId));
            }

            // 2) Stock (siempre como movimiento de inventario)
            if (stockValue !== null) {
                const reason = isNew ? 'Stock inicial' : (data.stock_reason || 'Ajuste manual desde el panel');
                await setStock(sb, savedId, stockValue, reason);
                product = { ...product, stock: stockValue, track_stock: true };
            }

            // 3) Imagen
            if (file) {
                const path = await uploadImage(sb, savedId, file);
                try {
                    await run(sb.from('products').update({ image_path: path }).eq('id', savedId));
                } catch (error) {
                    await sb.storage.from(IMAGE_BUCKET).remove([path]);
                    throw error;
                }
                await removeStoredImage(sb, previousImage);
                product = { ...product, image_path: path };
            } else if (data.remove_image && previousImage) {
                await run(sb.from('products').update({ image_path: null }).eq('id', savedId));
                await removeStoredImage(sb, previousImage);
                product = { ...product, image_path: null };
            }
            return savedId;
        }
    });

    if (result) toast(isNew ? 'Producto creado.' : 'Producto actualizado.');
    else if (isNew && savedId) toast('El producto se creó, pero no se completaron todos los pasos. Revísalo en el listado.', 'error');
    return result;
}

