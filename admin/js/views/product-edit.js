import {
    esc, run, money, grossPrice, field, options, formDialog, confirmDialog, toast, friendlyError, LABELS, emptyState
} from '../ui.js';
import { imageUrl, IMAGE_BUCKET, IMAGE_TYPES, MAX_IMAGE_BYTES } from '../supabase.js';
import { bindSlug } from './categories.js';
import { stockBadge, stockDialog } from '../stock.js';

const PRODUCT_SELECT = '*, category:categories(id, name, kind), product_variants(id, name, is_active, sort_order, product_price_tiers(id, quantity, net_price)), product_extras(id, name, surcharge_percent, is_active, sort_order)';

function unitRuleRows(rules) {
    const rows = rules?.unit_prices?.length ? rules.unit_prices : [{ up_to: null, net_price: '' }];
    return rows.map(row => unitRuleRow(row)).join('');
}

function unitRuleRow(row = { up_to: '', net_price: '' }) {
    return `<div class="adm-rule-row">
        <div class="adm-field"><label>Hasta (unidades)</label><input type="number" min="1" step="1" data-rule="up_to" value="${esc(row.up_to ?? '')}" placeholder="Sin límite"></div>
        <div class="adm-field"><label>Precio neto c/u</label><input type="number" min="0" step="1" data-rule="net_price" value="${esc(row.net_price ?? '')}"></div>
        <button type="button" class="adm-icon-btn" data-remove-rule aria-label="Quitar tramo">×</button>
    </div>`;
}

function readUnitRules(form) {
    const rows = [...form.querySelectorAll('.adm-rule-row')]
        .filter(row => row.querySelector('[data-rule="net_price"]').value !== '')
        .map(row => ({
            up_to: row.querySelector('[data-rule="up_to"]').value === '' ? null : Number(row.querySelector('[data-rule="up_to"]').value),
            net_price: Number(row.querySelector('[data-rule="net_price"]').value)
        }));
    const designFee = Number(form.querySelector('[name="design_fee"]').value) || 0;
    const designFreeFrom = Number(form.querySelector('[name="design_free_from"]').value) || 0;
    // Sin tramos: precio simple por unidad = precio neto base
    if (!rows.length) {
        if (form.elements.base_net_price.value === '') throw new Error('Indica el precio neto base o al menos un tramo de precio unitario.');
        return designFee ? { unit_prices: [], design_fee: designFee, design_free_from: designFreeFrom } : null;
    }
    rows.sort((a, b) => (a.up_to ?? Infinity) - (b.up_to ?? Infinity));
    if (rows.filter(r => r.up_to == null).length !== 1) throw new Error('Debe existir exactamente un tramo "sin límite" (el último).');
    if (rows.some(r => !Number.isInteger(r.net_price) || r.net_price < 0)) throw new Error('Los precios unitarios deben ser enteros positivos.');
    return { unit_prices: rows, design_fee: designFee, design_free_from: designFreeFrom };
}

function generalForm(product, categories) {
    const p = product || { is_active: true, pricing_mode: 'tiers', unit_label: 'unidades', vat_rate: 19, sort_order: 0 };
    return `
    <form id="productForm" class="adm-form" novalidate>
        <div class="adm-form__error" role="alert" hidden></div>
        <fieldset class="adm-fieldset">
            <legend>Información general</legend>
            <div class="adm-form-grid">
                ${field({ name: 'name', label: 'Nombre', value: p.name, required: true, attrs: 'maxlength="120" data-slug-source' })}
                ${field({ name: 'slug', label: 'Slug', value: p.slug, required: true, hint: 'Identificador único: minúsculas y guiones.', attrs: 'maxlength="120" pattern="[a-z0-9]+(-[a-z0-9]+)*" data-slug-target' })}
                ${field({ name: 'category_id', label: 'Categoría', type: 'select', required: true, value: `<option value="">Selecciona…</option>${categories.map(c => `<option value="${c.id}"${c.id === p.category_id ? ' selected' : ''}>${esc(c.name)}${c.is_active ? '' : ' (inactiva)'}</option>`).join('')}` })}
                ${field({ name: 'sku', label: 'SKU (opcional)', value: p.sku, attrs: 'maxlength="40" pattern="[A-Za-z0-9._\\-]{1,40}"' })}
                ${field({ name: 'description', label: 'Descripción', type: 'textarea', value: p.description, full: true, attrs: 'maxlength="1000"' })}
                ${field({ name: 'specs', label: 'Especificaciones técnicas', type: 'textarea', value: p.specs, full: true, attrs: 'maxlength="2000"' })}
                ${field({ name: 'sort_order', label: 'Orden en el catálogo', type: 'number', value: p.sort_order ?? 0, attrs: 'step="1"' })}
                <div class="adm-checks adm-field--full">
                    ${field({ name: 'is_active', label: 'Activo (visible en la web)', type: 'checkbox', value: p.is_active })}
                    ${field({ name: 'is_featured', label: 'Destacado', type: 'checkbox', value: p.is_featured })}
                    ${field({ name: 'track_stock', label: 'Controlar stock', type: 'checkbox', value: p.track_stock })}
                </div>
            </div>
        </fieldset>

        <fieldset class="adm-fieldset">
            <legend>Precios e IVA</legend>
            <div class="adm-form-grid">
                ${field({ name: 'pricing_mode', label: 'Modo de precio', type: 'select', value: options(LABELS.pricingMode, p.pricing_mode) })}
                ${field({ name: 'vat_rate', label: 'IVA aplicable (%)', type: 'number', value: p.vat_rate ?? 19, required: true, attrs: 'min="0" max="100" step="0.01"' })}
                ${field({ name: 'base_net_price', label: 'Precio neto base (opcional)', type: 'number', value: p.base_net_price ?? '', hint: 'Referencia simple. Los tramos definen el precio real.', attrs: 'min="0" step="1" data-net' })}
                <div class="adm-field"><span class="adm-label">Precio final con IVA</span><output class="adm-output" data-gross>${p.base_net_price != null ? money(grossPrice(p.base_net_price, p.vat_rate)) : '—'}</output></div>
            </div>

            <div data-mode="tiers unit" class="adm-form-grid">
                ${field({ name: 'unit_label', label: 'Unidad de venta', type: 'select', value: options({ unidades: 'Unidades', talonarios: 'Talonarios' }, p.unit_label) })}
                <div class="adm-checks">
                    ${field({ name: 'pack_pricing', label: 'Mostrar como "Pack"', type: 'checkbox', value: p.pack_pricing })}
                    ${field({ name: 'extras_exclusive', label: 'Opcionales excluyentes (solo uno)', type: 'checkbox', value: p.extras_exclusive })}
                </div>
            </div>

            <div data-mode="unit">
                <p class="adm-hint">Opcional: precio unitario por tramos (ej.: hasta 20 → $3.500; sin límite → $3.000). Si no hay tramos se usa el precio neto base por unidad.</p>
                <div id="unitRules">${unitRuleRows(p.pricing_rules)}</div>
                <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="addRule">+ Agregar tramo unitario</button>
                <div class="adm-form-grid adm-mt">
                    ${field({ name: 'design_fee', label: 'Costo diseño base (neto)', type: 'number', value: p.pricing_rules?.design_fee ?? 0, attrs: 'min="0" step="1"' })}
                    ${field({ name: 'design_free_from', label: 'Diseño gratis desde (unidades)', type: 'number', value: p.pricing_rules?.design_free_from ?? 0, hint: '0 = nunca gratis', attrs: 'min="0" step="1"' })}
                </div>
            </div>

            <div data-mode="quote" class="adm-form-grid">
                ${field({ name: 'price_label', label: 'Texto de precio', value: p.price_label, hint: 'Ej.: "Desde $149.990" o "A cotizar"', attrs: 'maxlength="60"' })}
                ${field({ name: 'external_url', label: 'Enlace externo (https)', type: 'url', value: p.external_url, attrs: 'maxlength="300" pattern="https://.+"' })}
                ${field({ name: 'whatsapp_number', label: 'WhatsApp de contacto', value: p.whatsapp_number, hint: 'Solo dígitos con código país, ej. 56912345678', attrs: 'pattern="[0-9]{8,15}" inputmode="numeric"' })}
                ${field({ name: 'features', label: 'Qué incluye', type: 'textarea', value: p.features, full: true, attrs: 'maxlength="2000"' })}
            </div>
        </fieldset>

        <div class="adm-form__footer">
            <a href="#/productos" class="adm-btn adm-btn--ghost">Volver</a>
            <button type="submit" class="adm-btn adm-btn--primary">${product ? 'Guardar cambios' : 'Crear producto'}</button>
        </div>
    </form>`;
}

function variantsSection(product) {
    const variants = [...(product.product_variants || [])].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    return `
    <section class="adm-card" aria-labelledby="variantsTitle">
        <div class="adm-card__head">
            <h2 id="variantsTitle">Formatos y tramos de precio</h2>
            <button type="button" class="adm-btn adm-btn--primary adm-btn--sm" data-add-variant>+ Formato</button>
        </div>
        <p class="adm-hint">Cada formato tiene tramos: cantidad del pack → precio neto total. La web muestra "precio + IVA".</p>
        ${variants.length ? variants.map(v => {
            const tiers = [...(v.product_price_tiers || [])].sort((a, b) => a.quantity - b.quantity);
            return `<article class="adm-variant">
                <header class="adm-variant__head">
                    <h3>${esc(v.name)} ${v.is_active ? '' : '<span class="adm-badge adm-badge--muted">Inactivo</span>'}</h3>
                    <div class="adm-actions">
                        <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-edit-variant="${v.id}">Editar</button>
                        <button type="button" class="adm-btn adm-btn--danger-ghost adm-btn--sm" data-delete-variant="${v.id}">Eliminar</button>
                    </div>
                </header>
                ${tiers.length ? `<div class="adm-table-wrap"><table class="adm-table adm-table--compact">
                    <thead><tr><th scope="col">Cantidad</th><th scope="col">Neto total</th><th scope="col">Con IVA</th><th scope="col">Neto c/u</th><th scope="col"><span class="adm-sr">Acciones</span></th></tr></thead>
                    <tbody>${tiers.map(t => `<tr>
                        <td data-label="Cantidad">${t.quantity.toLocaleString('es-CL')} ${esc(product.unit_label)}</td>
                        <td data-label="Neto total">${money(t.net_price)}</td>
                        <td data-label="Con IVA">${money(grossPrice(t.net_price, product.vat_rate))}</td>
                        <td data-label="Neto c/u">${money(t.net_price / t.quantity)}</td>
                        <td class="adm-actions">
                            <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-edit-tier="${t.id}" data-variant="${v.id}">Editar</button>
                            <button type="button" class="adm-btn adm-btn--danger-ghost adm-btn--sm" data-delete-tier="${t.id}">Eliminar</button>
                        </td></tr>`).join('')}
                    </tbody></table></div>` : '<p class="adm-text-danger adm-hint">Sin tramos: este formato no se mostrará en la web.</p>'}
                <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-add-tier="${v.id}">+ Tramo</button>
            </article>`;
        }).join('') : emptyState('Sin formatos. Agrega al menos uno con tramos para que el producto aparezca en la web.')}
    </section>`;
}

function extrasSection(product) {
    const extras = [...(product.product_extras || [])].sort((a, b) => a.sort_order - b.sort_order);
    return `
    <section class="adm-card" aria-labelledby="extrasTitle">
        <div class="adm-card__head">
            <h2 id="extrasTitle">Opcionales</h2>
            <button type="button" class="adm-btn adm-btn--primary adm-btn--sm" data-add-extra>+ Opcional</button>
        </div>
        ${extras.length ? `<div class="adm-table-wrap"><table class="adm-table adm-table--compact">
            <thead><tr><th scope="col">Nombre</th><th scope="col">Recargo</th><th scope="col">Estado</th><th scope="col"><span class="adm-sr">Acciones</span></th></tr></thead>
            <tbody>${extras.map(e => `<tr>
                <td data-label="Nombre">${esc(e.name)}</td>
                <td data-label="Recargo">+${Number(e.surcharge_percent)}%</td>
                <td data-label="Estado">${e.is_active ? 'Activo' : 'Inactivo'}</td>
                <td class="adm-actions">
                    <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-edit-extra="${e.id}">Editar</button>
                    <button type="button" class="adm-btn adm-btn--danger-ghost adm-btn--sm" data-delete-extra="${e.id}">Eliminar</button>
                </td></tr>`).join('')}
            </tbody></table></div>` : emptyState('Sin opcionales (prepicado, foliado, termolaminado…).')}
    </section>`;
}

function imageSection(product) {
    return `
    <section class="adm-card" aria-labelledby="imageTitle">
        <div class="adm-card__head"><h2 id="imageTitle">Imagen</h2></div>
        <div class="adm-image-editor">
            <img src="${esc(imageUrl(product.image_path))}" alt="Imagen actual de ${esc(product.name)}" class="adm-image-preview" id="imagePreview">
            <div>
                <p class="adm-hint">JPG, PNG, WebP o AVIF · máximo 5 MB.${product.image_path?.startsWith('images/') ? ' Imagen actual: archivo estático del sitio.' : ''}</p>
                <div class="adm-field">
                    <label for="imageFile">Subir nueva imagen</label>
                    <input type="file" id="imageFile" accept="image/jpeg,image/png,image/webp,image/avif">
                </div>
                <div class="adm-actions adm-actions--start">
                    <button type="button" class="adm-btn adm-btn--primary adm-btn--sm" id="uploadImage" disabled>Subir imagen</button>
                    ${product.image_path ? '<button type="button" class="adm-btn adm-btn--danger-ghost adm-btn--sm" id="removeImage">Quitar imagen</button>' : ''}
                </div>
                <p class="adm-hint" id="imageStatus" role="status" aria-live="polite"></p>
            </div>
        </div>
    </section>`;
}

export async function render(ctx) {
    const { sb, main, param, isCurrent, navigate, reload } = ctx;
    const isNew = param === 'nuevo';
    const [categories, product] = await Promise.all([
        run(sb.from('categories').select('id, name, kind, is_active').order('sort_order')),
        isNew ? null : run(sb.from('products').select(PRODUCT_SELECT).eq('id', param).maybeSingle())
    ]);
    if (!isCurrent()) return;
    if (!isNew && !product) {
        main.innerHTML = emptyState('Producto no encontrado.', '<a class="adm-btn adm-btn--ghost" href="#/productos">Volver a productos</a>');
        return;
    }

    main.innerHTML = `
        <header class="adm-page-head">
            <div>
                <p class="adm-eyebrow"><a href="#/productos">Productos</a> / ${isNew ? 'Nuevo' : esc(product.name)}</p>
                <h1>${isNew ? 'Nuevo producto' : esc(product.name)}</h1>
            </div>
            ${!isNew ? `<div class="adm-actions">${product.track_stock ? `<span class="adm-pill">Stock: <strong>${product.stock}</strong></span>` : ''} ${stockBadge(product.stock_status)}<button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-stock-dialog>Ajustar stock</button></div>` : ''}
        </header>
        <div class="adm-edit-layout">
            <section class="adm-card">${generalForm(product, categories)}</section>
            ${!isNew ? `
                <div class="adm-stack">
                    ${product.pricing_mode === 'tiers' ? variantsSection(product) : ''}
                    ${product.pricing_mode !== 'quote' ? extrasSection(product) : ''}
                    ${imageSection(product)}
                    <section class="adm-card adm-card--danger">
                        <h2>Eliminar producto</h2>
                        <p class="adm-hint">Si tiene pedidos o cotizaciones no podrá eliminarse; desactívalo en su lugar. El historial de stock se conserva.</p>
                        <button type="button" class="adm-btn adm-btn--danger adm-btn--sm" id="deleteProduct">Eliminar producto</button>
                    </section>
                </div>` : '<p class="adm-hint">Guarda el producto para agregar formatos, tramos, opcionales e imagen.</p>'}
        </div>`;

    const form = main.querySelector('#productForm');
    const errorBox = form.querySelector('.adm-form__error');
    bindSlug(form, !isNew);

    /* Mostrar campos según modo de precio */
    const modeSelect = form.querySelector('[name="pricing_mode"]');
    const syncMode = () => {
        form.querySelectorAll('[data-mode]').forEach(block => {
            const visible = block.dataset.mode.split(' ').includes(modeSelect.value);
            block.hidden = !visible;
            block.querySelectorAll('input, select, textarea').forEach(input => { input.disabled = !visible; });
        });
    };
    modeSelect.addEventListener('change', syncMode);
    syncMode();

    /* Vista previa del precio con IVA */
    const netInput = form.querySelector('[data-net]');
    const vatInput = form.querySelector('[name="vat_rate"]');
    const grossOut = form.querySelector('[data-gross]');
    const syncGross = () => { grossOut.textContent = netInput.value === '' ? '—' : money(grossPrice(netInput.value, vatInput.value)); };
    netInput.addEventListener('input', syncGross);
    vatInput.addEventListener('input', syncGross);

    /* Tramos unitarios dinámicos */
    const rulesHost = form.querySelector('#unitRules');
    form.querySelector('#addRule').addEventListener('click', () => rulesHost.insertAdjacentHTML('beforeend', unitRuleRow()));
    rulesHost.addEventListener('click', event => {
        const button = event.target.closest('[data-remove-rule]');
        if (button && rulesHost.children.length > 1) button.closest('.adm-rule-row').remove();
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();
        errorBox.hidden = true;
        if (!form.reportValidity()) return;
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        const f = name => form.elements[name];
        const value = name => (f(name).value.trim() === '' ? null : f(name).value.trim());
        try {
            const mode = f('pricing_mode').value;
            const payload = {
                name: value('name'), slug: value('slug'), category_id: value('category_id'), sku: value('sku'),
                description: value('description'), specs: value('specs'),
                sort_order: Number(f('sort_order').value) || 0,
                is_active: f('is_active').checked, is_featured: f('is_featured').checked, track_stock: f('track_stock').checked,
                pricing_mode: mode, vat_rate: Number(f('vat_rate').value),
                base_net_price: f('base_net_price').value === '' ? null : Number(f('base_net_price').value),
                unit_label: mode === 'quote' ? 'unidades' : f('unit_label').value,
                pack_pricing: mode !== 'quote' && f('pack_pricing').checked,
                extras_exclusive: mode !== 'quote' && f('extras_exclusive').checked,
                pricing_rules: mode === 'unit' ? readUnitRules(form) : null,
                price_label: mode === 'quote' ? value('price_label') : null,
                external_url: mode === 'quote' ? value('external_url') : null,
                whatsapp_number: mode === 'quote' ? value('whatsapp_number') : null,
                features: mode === 'quote' ? value('features') : null
            };
            if (isNew) {
                const created = await run(sb.from('products').insert(payload).select('id').single());
                toast('Producto creado. Ahora agrega formatos, precios e imagen.');
                navigate(`#/productos/${created.id}`);
            } else {
                await run(sb.from('products').update(payload).eq('id', product.id));
                toast('Producto guardado.');
                reload();
            }
        } catch (error) {
            errorBox.textContent = friendlyError(error);
            errorBox.hidden = false;
            errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
            submit.disabled = false;
        }
    });

    if (isNew) return;

    main.querySelector('[data-stock-dialog]')?.addEventListener('click', async () => { if (await stockDialog(sb, product)) reload(); });

    const variants = Object.fromEntries((product.product_variants || []).map(v => [v.id, v]));
    const tiers = Object.fromEntries((product.product_variants || []).flatMap(v => v.product_price_tiers || []).map(t => [t.id, t]));
    const extras = Object.fromEntries((product.product_extras || []).map(e => [e.id, e]));

    const on = (selector, handler) => main.querySelectorAll(selector).forEach(el => el.addEventListener('click', () => handler(el)));
    const removeWithConfirm = async (title, message, query, done) => {
        if (!await confirmDialog({ title, message, confirmLabel: 'Eliminar', danger: true })) return;
        try { await run(query()); toast(done); reload(); } catch (error) { toast(friendlyError(error), 'error'); }
    };

    /* Formatos */
    const variantDialog = variant => formDialog({
        title: variant ? 'Editar formato' : 'Nuevo formato',
        body: `<div class="adm-form-grid">
            ${field({ name: 'name', label: 'Nombre del formato', value: variant?.name, required: true, full: true, hint: 'Ej.: "Carta", "2 caras", "Estándar · 5 cm x 5,5 cm"', attrs: 'maxlength="120"' })}
            ${field({ name: 'sort_order', label: 'Orden', type: 'number', value: variant?.sort_order ?? ((product.product_variants?.length || 0) + 1) * 10 })}
            ${field({ name: 'is_active', label: 'Activo', type: 'checkbox', value: variant?.is_active ?? true })}
        </div>`,
        onSubmit: async data => {
            const payload = { name: data.name, sort_order: data.sort_order ?? 0, is_active: data.is_active };
            await run(variant
                ? sb.from('product_variants').update(payload).eq('id', variant.id)
                : sb.from('product_variants').insert({ ...payload, product_id: product.id }));
        }
    }).then(saved => { if (saved) { toast('Formato guardado.'); reload(); } });

    on('[data-add-variant]', () => variantDialog(null));
    on('[data-edit-variant]', el => variantDialog(variants[el.dataset.editVariant]));
    on('[data-delete-variant]', el => removeWithConfirm('Eliminar formato', `Se eliminará "${variants[el.dataset.deleteVariant].name}" y todos sus tramos.`, () => sb.from('product_variants').delete().eq('id', el.dataset.deleteVariant), 'Formato eliminado.'));

    /* Tramos */
    const tierDialog = (variantId, tier) => formDialog({
        title: tier ? 'Editar tramo' : `Nuevo tramo · ${variants[variantId].name}`,
        body: `<div class="adm-form-grid">
            ${field({ name: 'quantity', label: `Cantidad (${product.unit_label})`, type: 'number', value: tier?.quantity ?? '', required: true, attrs: 'min="1" step="1"' })}
            ${field({ name: 'net_price', label: 'Precio neto total', type: 'number', value: tier?.net_price ?? '', required: true, attrs: 'min="0" step="1" data-tier-net' })}
            <div class="adm-field adm-field--full"><span class="adm-label">Total con IVA (${Number(product.vat_rate)}%)</span><output class="adm-output" data-tier-gross>${tier ? money(grossPrice(tier.net_price, product.vat_rate)) : '—'}</output></div>
        </div>`,
        onMount: dialogForm => {
            const net = dialogForm.querySelector('[data-tier-net]');
            net.addEventListener('input', () => { dialogForm.querySelector('[data-tier-gross]').textContent = net.value === '' ? '—' : money(grossPrice(net.value, product.vat_rate)); });
        },
        onSubmit: async data => {
            const payload = { quantity: data.quantity, net_price: data.net_price };
            await run(tier
                ? sb.from('product_price_tiers').update(payload).eq('id', tier.id)
                : sb.from('product_price_tiers').insert({ ...payload, variant_id: variantId }));
        }
    }).then(saved => { if (saved) { toast('Tramo guardado.'); reload(); } });

    on('[data-add-tier]', el => tierDialog(el.dataset.addTier, null));
    on('[data-edit-tier]', el => tierDialog(el.dataset.variant, tiers[el.dataset.editTier]));
    on('[data-delete-tier]', el => removeWithConfirm('Eliminar tramo', `¿Eliminar el tramo de ${tiers[el.dataset.deleteTier].quantity} ${product.unit_label}?`, () => sb.from('product_price_tiers').delete().eq('id', el.dataset.deleteTier), 'Tramo eliminado.'));

    /* Opcionales */
    const extraDialog = extra => formDialog({
        title: extra ? 'Editar opcional' : 'Nuevo opcional',
        body: `<div class="adm-form-grid">
            ${field({ name: 'name', label: 'Nombre', value: extra?.name, required: true, attrs: 'maxlength="80"' })}
            ${field({ name: 'surcharge_percent', label: 'Recargo (%)', type: 'number', value: extra?.surcharge_percent ?? 0, required: true, attrs: 'min="0" max="500" step="0.01"' })}
            ${field({ name: 'sort_order', label: 'Orden', type: 'number', value: extra?.sort_order ?? ((product.product_extras?.length || 0) + 1) * 10 })}
            ${field({ name: 'is_active', label: 'Activo', type: 'checkbox', value: extra?.is_active ?? true })}
        </div>`,
        onSubmit: async data => {
            const payload = { name: data.name, surcharge_percent: data.surcharge_percent, sort_order: data.sort_order ?? 0, is_active: data.is_active };
            await run(extra
                ? sb.from('product_extras').update(payload).eq('id', extra.id)
                : sb.from('product_extras').insert({ ...payload, product_id: product.id }));
        }
    }).then(saved => { if (saved) { toast('Opcional guardado.'); reload(); } });

    on('[data-add-extra]', () => extraDialog(null));
    on('[data-edit-extra]', el => extraDialog(extras[el.dataset.editExtra]));
    on('[data-delete-extra]', el => removeWithConfirm('Eliminar opcional', `¿Eliminar "${extras[el.dataset.deleteExtra].name}"?`, () => sb.from('product_extras').delete().eq('id', el.dataset.deleteExtra), 'Opcional eliminado.'));

    /* Imagen */
    const fileInput = main.querySelector('#imageFile');
    const uploadButton = main.querySelector('#uploadImage');
    const status = main.querySelector('#imageStatus');
    const preview = main.querySelector('#imagePreview');
    let previewUrl = null;

    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        uploadButton.disabled = true;
        status.textContent = '';
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        if (!file) return;
        if (!IMAGE_TYPES[file.type]) { status.textContent = 'Formato no permitido. Usa JPG, PNG, WebP o AVIF.'; fileInput.value = ''; return; }
        if (file.size > MAX_IMAGE_BYTES) { status.textContent = `La imagen pesa ${(file.size / 1048576).toFixed(1)} MB; el máximo es 5 MB.`; fileInput.value = ''; return; }
        previewUrl = URL.createObjectURL(file);
        preview.src = previewUrl;
        status.textContent = 'Vista previa lista. Presiona "Subir imagen" para guardarla.';
        uploadButton.disabled = false;
    });

    uploadButton.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        uploadButton.disabled = true;
        status.textContent = 'Subiendo…';
        const path = `products/${product.id}/${crypto.randomUUID()}.${IMAGE_TYPES[file.type]}`;
        const { error: uploadError } = await sb.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
        if (uploadError) {
            status.textContent = '';
            uploadButton.disabled = false;
            toast(`No se pudo subir: ${friendlyError(uploadError)}`, 'error');
            return;
        }
        try {
            await run(sb.from('products').update({ image_path: path }).eq('id', product.id));
        } catch (error) {
            await sb.storage.from(IMAGE_BUCKET).remove([path]);
            status.textContent = '';
            uploadButton.disabled = false;
            toast(friendlyError(error), 'error');
            return;
        }
        if (product.image_path?.startsWith('products/')) {
            await sb.storage.from(IMAGE_BUCKET).remove([product.image_path]);
        }
        toast('Imagen actualizada.');
        reload();
    });

    main.querySelector('#removeImage')?.addEventListener('click', async () => {
        const stored = product.image_path.startsWith('products/');
        const ok = await confirmDialog({
            title: 'Quitar imagen',
            message: stored ? 'La imagen se eliminará del almacenamiento y el producto usará el logo por defecto.' : 'El producto dejará de usar la imagen estática actual (el archivo del sitio no se borra).',
            confirmLabel: 'Quitar', danger: true
        });
        if (!ok) return;
        try {
            await run(sb.from('products').update({ image_path: null }).eq('id', product.id));
            if (stored) {
                const { error } = await sb.storage.from(IMAGE_BUCKET).remove([product.image_path]);
                if (error) toast(`Imagen desvinculada, pero no se pudo borrar el archivo: ${friendlyError(error)}`, 'error');
            }
            toast('Imagen quitada.');
            reload();
        } catch (error) {
            toast(friendlyError(error), 'error');
        }
    });

    /* Eliminar producto */
    main.querySelector('#deleteProduct').addEventListener('click', async () => {
        const ok = await confirmDialog({
            title: 'Eliminar producto',
            message: `¿Eliminar definitivamente "${product.name}", sus formatos, tramos y opcionales? Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar', danger: true
        });
        if (!ok) return;
        try {
            await run(sb.from('products').delete().eq('id', product.id));
            if (product.image_path?.startsWith('products/')) await sb.storage.from(IMAGE_BUCKET).remove([product.image_path]);
            toast('Producto eliminado.');
            navigate('#/productos');
        } catch (error) {
            toast(friendlyError(error), 'error');
        }
    });
}
