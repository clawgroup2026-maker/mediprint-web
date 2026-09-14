import { esc, run, fmtDateTime, badge, LABELS, emptyState, formDialog, toast } from '../ui.js';
import { stockBadge, stockDialog } from '../stock.js';

export async function render(ctx) {
    const { sb, main, isCurrent, reload } = ctx;
    const [products, movements, profiles] = await Promise.all([
        run(sb.from('products').select('id, name, stock, track_stock, stock_status, low_stock_threshold, is_active, category:categories(name)').order('name')),
        run(sb.from('inventory_movements').select('id, product_id, product_name, movement_type, quantity, reason, stock_before, stock_after, created_by, created_at, order:orders(id, order_number), product:products(name)').order('created_at', { ascending: false }).limit(60)),
        run(sb.from('profiles').select('id, email, full_name'))
    ]);
    if (!isCurrent()) return;

    const who = Object.fromEntries(profiles.map(p => [p.id, p.full_name || p.email]));
    const tracked = products.filter(p => p.track_stock);
    const counts = {
        agotado: tracked.filter(p => p.stock_status === 'agotado').length,
        bajo: tracked.filter(p => p.stock_status === 'bajo').length,
        disponible: tracked.filter(p => p.stock_status === 'disponible').length
    };
    const onlyTracked = sessionStorage.getItem('mediprint-admin-inventory-all') !== '1';
    const list = (onlyTracked ? tracked : products)
        .sort((a, b) => ({ agotado: 0, bajo: 1, disponible: 2, sin_control: 3 }[a.stock_status] - { agotado: 0, bajo: 1, disponible: 2, sin_control: 3 }[b.stock_status]) || a.name.localeCompare(b.name));

    main.innerHTML = `
        <header class="adm-page-head">
            <div><p class="adm-eyebrow">Operación</p><h1>Inventario</h1></div>
            <button type="button" class="adm-btn adm-btn--primary" id="newMovement">+ Registrar movimiento</button>
        </header>

        <section class="adm-stats" aria-label="Estado del stock">
            <div class="adm-stat adm-stat--danger"><span>Agotados</span><strong>${counts.agotado}</strong></div>
            <div class="adm-stat adm-stat--warn"><span>Stock bajo</span><strong>${counts.bajo}</strong></div>
            <div class="adm-stat"><span>En stock</span><strong>${counts.disponible}</strong></div>
            <div class="adm-stat"><span>Con control de stock</span><strong>${tracked.length}</strong><small>de ${products.length} productos</small></div>
        </section>

        <section class="adm-card">
            <div class="adm-card__head">
                <h2>Stock actual</h2>
                <label class="adm-check"><input type="checkbox" id="showAll" ${onlyTracked ? '' : 'checked'}> <span>Mostrar también productos sin control</span></label>
            </div>
            ${list.length ? `<div class="adm-table-wrap"><table class="adm-table">
                <thead><tr><th scope="col">Producto</th><th scope="col">Categoría</th><th scope="col">Stock</th><th scope="col">Alerta en</th><th scope="col">Estado</th><th scope="col"><span class="adm-sr">Acciones</span></th></tr></thead>
                <tbody>${list.map(p => `<tr>
                    <td data-label="Producto"><a href="#/productos/${p.id}"><strong>${esc(p.name)}</strong></a>${p.is_active ? '' : ' <small class="adm-muted">(inactivo)</small>'}</td>
                    <td data-label="Categoría">${esc(p.category?.name || '—')}</td>
                    <td data-label="Stock"><strong>${p.track_stock ? Number(p.stock).toLocaleString('es-CL') : '—'}</strong></td>
                    <td data-label="Alerta en">${p.track_stock ? `≤ ${p.low_stock_threshold}` : '—'}</td>
                    <td data-label="Estado">${stockBadge(p.stock_status)}</td>
                    <td class="adm-actions"><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-adjust="${p.id}">Ajustar</button></td>
                </tr>`).join('')}</tbody></table></div>`
            : emptyState('Ningún producto controla stock todavía. Usa "Registrar movimiento" o edita un producto e indica su stock.')}
        </section>

        <section class="adm-card">
            <div class="adm-card__head"><h2>Últimos movimientos</h2></div>
            ${movements.length ? `<div class="adm-table-wrap"><table class="adm-table">
                <thead><tr><th scope="col">Fecha</th><th scope="col">Producto</th><th scope="col">Tipo</th><th scope="col">Cantidad</th><th scope="col">Stock</th><th scope="col">Motivo</th><th scope="col">Usuario</th></tr></thead>
                <tbody>${movements.map(m => {
                    const delta = m.stock_after - m.stock_before;
                    return `<tr>
                        <td data-label="Fecha">${fmtDateTime(m.created_at)}</td>
                        <td data-label="Producto">${esc(m.product?.name || (m.product_name ? `${m.product_name} (eliminado)` : '—'))}</td>
                        <td data-label="Tipo">${badge(m.movement_type, LABELS.movementType)}</td>
                        <td data-label="Cantidad"><strong class="${delta < 0 ? 'adm-text-danger' : 'adm-text-ok'}">${delta > 0 ? '+' : ''}${delta}</strong></td>
                        <td data-label="Stock">${m.stock_before} → ${m.stock_after}</td>
                        <td data-label="Motivo">${esc(m.reason)}${m.order ? `<br><a href="#/pedidos/${m.order.id}">${esc(m.order.order_number)}</a>` : ''}</td>
                        <td data-label="Usuario">${esc(who[m.created_by] || '—')}</td>
                    </tr>`;
                }).join('')}</tbody></table></div>` : emptyState('Sin movimientos registrados.')}
        </section>`;

    main.querySelector('#showAll').addEventListener('change', e => {
        sessionStorage.setItem('mediprint-admin-inventory-all', e.target.checked ? '1' : '0');
        reload();
    });

    const byId = Object.fromEntries(products.map(p => [p.id, p]));
    main.querySelectorAll('[data-adjust]').forEach(b => b.addEventListener('click', async () => {
        if (await stockDialog(sb, byId[b.dataset.adjust])) reload();
    }));

    main.querySelector('#newMovement').addEventListener('click', async () => {
        if (!products.length) { toast('No hay productos.', 'error'); return; }
        const productId = await formDialog({
            title: 'Registrar movimiento',
            body: `<div class="adm-field adm-field--full">
                <label for="mvProduct">Producto</label>
                <select id="mvProduct" name="product_id" required>
                    <option value="">Selecciona…</option>
                    ${products.map(p => `<option value="${p.id}">${esc(p.name)}${p.track_stock ? ` (stock ${p.stock})` : ''}</option>`).join('')}
                </select>
            </div>`,
            submitLabel: 'Continuar',
            onSubmit: async data => data.product_id
        });
        if (productId && await stockDialog(sb, byId[productId])) reload();
    });
}
