import { esc, run, money, emptyState, confirmDialog, toast, friendlyError } from '../ui.js';
import { imageUrl } from '../supabase.js';
import { productDialog } from '../product-modal.js';
import { stockBadge, stockDialog } from '../stock.js';

const PRODUCT_LIST_SELECT = 'id, name, slug, description, image_path, pricing_mode, price_label, base_net_price, pricing_rules, vat_rate, is_active, is_featured, track_stock, stock, low_stock_threshold, stock_status, sort_order, category_id, category:categories(name), product_variants(id, product_price_tiers(net_price))';

function priceCell(p) {
    if (p.pricing_mode === 'quote') return esc(p.price_label || 'A cotizar');
    if (p.pricing_mode === 'unit') {
        const rules = p.pricing_rules?.unit_prices;
        const price = rules?.length ? Math.min(...rules.map(r => r.net_price)) : p.base_net_price;
        if (price == null) return '<span class="adm-text-danger">Sin precio</span>';
        return `<strong>${money(price)}</strong>${rules?.length > 1 ? ' <small class="adm-muted">desde</small>' : ''}<br><small class="adm-muted">+ IVA · c/u</small>`;
    }
    const prices = (p.product_variants || []).flatMap(v => (v.product_price_tiers || []).map(t => t.net_price));
    if (!prices.length) return '<span class="adm-text-danger">Sin tramos</span>';
    return `<small class="adm-muted">desde</small> <strong>${money(Math.min(...prices))}</strong><br><small class="adm-muted">+ IVA · por pack</small>`;
}

export async function render(ctx) {
    const { sb, main, isCurrent, reload } = ctx;
    const [rows, categories] = await Promise.all([
        run(sb.from('products').select(PRODUCT_LIST_SELECT).order('sort_order').order('name')),
        run(sb.from('categories').select('id, name, is_active').order('sort_order'))
    ]);
    if (!isCurrent()) return;

    const saved = JSON.parse(sessionStorage.getItem('mediprint-admin-product-filters') || '{}');
    const state = { q: '', category: '', status: '', stock: '', ...saved };

    const outOfStock = rows.filter(p => p.stock_status === 'agotado').length;
    const lowStock = rows.filter(p => p.stock_status === 'bajo').length;

    main.innerHTML = `
        <header class="adm-page-head">
            <div><p class="adm-eyebrow">Catálogo</p><h1>Productos</h1></div>
            <button type="button" class="adm-btn adm-btn--primary" id="newProduct">+ NUEVO PRODUCTO</button>
        </header>

        ${outOfStock || lowStock ? `<div class="adm-alert-strip" role="note">
            ${outOfStock ? `<button type="button" class="adm-chip adm-chip--danger" data-quick-stock="agotado">${outOfStock} agotado(s)</button>` : ''}
            ${lowStock ? `<button type="button" class="adm-chip adm-chip--warn" data-quick-stock="bajo">${lowStock} con stock bajo</button>` : ''}
        </div>` : ''}

        <section class="adm-card">
            <form class="adm-filters" role="search" id="productFilters">
                <div class="adm-field"><label for="pq">Buscar producto</label><input id="pq" type="search" placeholder="Nombre…" value="${esc(state.q)}"></div>
                <div class="adm-field"><label for="pc">Categoría</label><select id="pc"><option value="">Todas</option>${categories.map(c => `<option value="${c.id}"${state.category === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
                <div class="adm-field"><label for="ps">Estado</label><select id="ps">
                    <option value="">Todos</option><option value="active"${state.status === 'active' ? ' selected' : ''}>Activos</option><option value="inactive"${state.status === 'inactive' ? ' selected' : ''}>Inactivos</option>
                </select></div>
                <div class="adm-field"><label for="pk">Stock</label><select id="pk">
                    <option value="">Todos</option>
                    <option value="agotado"${state.stock === 'agotado' ? ' selected' : ''}>Agotados</option>
                    <option value="bajo"${state.stock === 'bajo' ? ' selected' : ''}>Stock bajo</option>
                    <option value="disponible"${state.stock === 'disponible' ? ' selected' : ''}>En stock</option>
                    <option value="sin_control"${state.stock === 'sin_control' ? ' selected' : ''}>Sin control de stock</option>
                </select></div>
            </form>
            <div id="productTable"></div>
        </section>`;

    const tableHost = main.querySelector('#productTable');
    const persist = () => sessionStorage.setItem('mediprint-admin-product-filters', JSON.stringify(state));

    function draw() {
        const q = state.q.toLowerCase();
        const list = rows.filter(p =>
            (!q || p.name.toLowerCase().includes(q)) &&
            (!state.category || p.category_id === state.category) &&
            (!state.status || (state.status === 'active') === p.is_active) &&
            (!state.stock || p.stock_status === state.stock));

        tableHost.innerHTML = list.length ? `
            <p class="adm-muted adm-count" aria-live="polite">${list.length} de ${rows.length} productos</p>
            <div class="adm-table-wrap">
                <table class="adm-table adm-table--products">
                    <thead><tr>
                        <th scope="col">Producto</th><th scope="col">Categoría</th><th scope="col">Precio</th>
                        <th scope="col">Stock</th><th scope="col">Estado</th><th scope="col">Acciones</th>
                    </tr></thead>
                    <tbody>${list.map(p => `
                        <tr class="${p.is_active ? '' : 'is-inactive'}">
                            <td data-label="Producto">
                                <div class="adm-product-cell">
                                    <img class="adm-thumb" src="${esc(imageUrl(p.image_path))}" alt="" loading="lazy">
                                    <div><strong>${esc(p.name)}</strong>${p.is_featured ? ' <span class="adm-badge adm-badge--info">Destacado</span>' : ''}</div>
                                </div>
                            </td>
                            <td data-label="Categoría">${esc(p.category?.name || '—')}</td>
                            <td data-label="Precio">${priceCell(p)}</td>
                            <td data-label="Stock">${p.track_stock ? `<strong class="adm-stock-num">${Number(p.stock).toLocaleString('es-CL')}</strong> ` : ''}${stockBadge(p.stock_status)}</td>
                            <td data-label="Estado">${p.is_active ? '<span class="adm-badge adm-badge--ok">ACTIVO</span>' : '<span class="adm-badge adm-badge--muted">INACTIVO</span>'}</td>
                            <td class="adm-actions">
                                <button type="button" class="adm-btn adm-btn--primary adm-btn--sm" data-edit="${p.id}">Editar</button>
                                <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-stock="${p.id}">Stock</button>
                                <button type="button" class="adm-btn ${p.is_active ? 'adm-btn--danger-ghost' : 'adm-btn--ghost'} adm-btn--sm" data-toggle="${p.id}">${p.is_active ? 'Desactivar' : 'Activar'}</button>
                            </td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>` : emptyState(rows.length ? 'Ningún producto coincide con los filtros.' : 'Aún no hay productos.', rows.length ? '<button type="button" class="adm-btn adm-btn--ghost" data-clear>Limpiar filtros</button>' : '');

        tableHost.querySelector('[data-clear]')?.addEventListener('click', () => {
            Object.assign(state, { q: '', category: '', status: '', stock: '' });
            persist();
            reload();
        });
    }

    const byId = id => rows.find(p => p.id === id);

    tableHost.addEventListener('click', async event => {
        const edit = event.target.closest('[data-edit]');
        const stock = event.target.closest('[data-stock]');
        const toggle = event.target.closest('[data-toggle]');
        if (edit) {
            if (await productDialog(sb, byId(edit.dataset.edit), categories)) reload();
        } else if (stock) {
            if (await stockDialog(sb, byId(stock.dataset.stock))) reload();
        } else if (toggle) {
            const product = byId(toggle.dataset.toggle);
            const activate = !product.is_active;
            const ok = await confirmDialog({
                title: activate ? 'Activar producto' : 'Desactivar producto',
                message: activate
                    ? `"${product.name}" volverá a mostrarse en la tienda.`
                    : `"${product.name}" dejará de mostrarse en la tienda. Sus pedidos anteriores se conservan.`,
                confirmLabel: activate ? 'Activar' : 'Desactivar',
                danger: !activate
            });
            if (!ok) return;
            toggle.disabled = true;
            try {
                await run(sb.from('products').update({ is_active: activate }).eq('id', product.id));
                toast(activate ? 'Producto activado.' : 'Producto desactivado.');
                reload();
            } catch (error) {
                toggle.disabled = false;
                toast(friendlyError(error), 'error');
            }
        }
    });

    main.querySelector('#newProduct').addEventListener('click', async () => {
        if (!categories.length) { toast('Primero crea una categoría.', 'error'); return; }
        if (await productDialog(sb, null, categories)) reload();
    });

    if (sessionStorage.getItem('mediprint-admin-new-product')) {
        sessionStorage.removeItem('mediprint-admin-new-product');
        main.querySelector('#newProduct').click();
    }

    main.querySelectorAll('[data-quick-stock]').forEach(button => button.addEventListener('click', () => {
        state.stock = button.dataset.quickStock;
        main.querySelector('#pk').value = state.stock;
        persist();
        draw();
    }));

    const bind = (id, key, eventName = 'change') => main.querySelector(id).addEventListener(eventName, e => {
        state[key] = e.target.value.trim();
        persist();
        draw();
    });
    bind('#pq', 'q', 'input');
    bind('#pc', 'category');
    bind('#ps', 'status');
    bind('#pk', 'stock');
    main.querySelector('#productFilters').addEventListener('submit', e => e.preventDefault());
    draw();
}
