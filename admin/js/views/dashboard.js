import { esc, money, fmtDateTime, badge, LABELS, countRows, run, emptyState } from '../ui.js';
import { stockBadge } from '../stock.js';

export async function render({ sb, main, profile, isCurrent }) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [activeProducts, pendingQuotes, openOrders, customerCount, monthOrders, recentQuotes, lowStock] = await Promise.all([
        countRows(sb.from('products').select('id', { count: 'exact', head: true }).eq('is_active', true)),
        countRows(sb.from('quote_requests').select('id', { count: 'exact', head: true }).in('status', ['nueva', 'en_revision'])),
        countRows(sb.from('orders').select('id', { count: 'exact', head: true }).not('status', 'in', '(entregado,cancelado)')),
        countRows(sb.from('customers').select('id', { count: 'exact', head: true })),
        run(sb.from('orders').select('total_amount, net_amount').neq('status', 'cancelado').gte('created_at', monthStart.toISOString()).limit(2000)),
        run(sb.from('quote_requests').select('id, quote_number, source, status, contact_name, product_summary, total_amount, created_at').order('created_at', { ascending: false }).limit(6)),
        run(sb.from('products').select('id, name, stock, stock_status').in('stock_status', ['agotado', 'bajo']).order('stock').limit(8))
    ]);
    if (!isCurrent()) return;

    const monthTotal = monthOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
    const monthNet = monthOrders.reduce((sum, order) => sum + Number(order.net_amount || 0), 0);
    const monthName = new Intl.DateTimeFormat('es-CL', { month: 'long' }).format(monthStart);

    main.innerHTML = `
        <header class="adm-page-head">
            <div>
                <p class="adm-eyebrow">Hola, ${esc(profile.full_name || profile.email)}</p>
                <h1>Resumen</h1>
            </div>
        </header>

        <section class="adm-stats" aria-label="Indicadores">
            <a class="adm-stat" href="#/cotizaciones"><span>Solicitudes pendientes</span><strong>${pendingQuotes}</strong><small>Nuevas o en revisión</small></a>
            <a class="adm-stat" href="#/pedidos"><span>Pedidos en curso</span><strong>${openOrders}</strong><small>Sin entregar ni cancelar</small></a>
            <a class="adm-stat" href="#/productos"><span>Productos activos</span><strong>${activeProducts}</strong><small>Visibles en la web</small></a>
            <a class="adm-stat" href="#/clientes"><span>Clientes</span><strong>${customerCount}</strong><small>Registrados</small></a>
            <div class="adm-stat adm-stat--wide"><span>Pedidos de ${esc(monthName)}</span>
                ${monthOrders.length
                    ? `<strong>${money(monthTotal)}</strong><small>${monthOrders.length} pedido(s) · Neto ${money(monthNet)} · sin cancelados</small>`
                    : '<strong>—</strong><small>Aún no hay pedidos este mes</small>'}
            </div>
        </section>

        <section class="adm-quick" aria-label="Accesos rápidos">
            <a href="#/pedidos" class="adm-btn adm-btn--primary" data-new-order>+ Nuevo pedido</a>
            <a href="#/productos" class="adm-btn adm-btn--ghost" data-open="mediprint-admin-new-product">+ Nuevo producto</a>
            <a href="#/clientes" class="adm-btn adm-btn--ghost" data-open="mediprint-admin-new-customer">+ Nuevo cliente</a>
            <a href="#/inventario" class="adm-btn adm-btn--ghost">Registrar movimiento de stock</a>
        </section>

        <div class="adm-grid-2">
            <section class="adm-card">
                <div class="adm-card__head"><h2>Últimas solicitudes</h2><a href="#/cotizaciones">Ver todas →</a></div>
                ${recentQuotes.length ? `
                    <ul class="adm-list">
                        ${recentQuotes.map(q => `
                            <li><a href="#/cotizaciones/${q.id}">
                                <span><strong>${esc(q.quote_number)}</strong> · ${esc(q.contact_name || LABELS.quoteSource[q.source])}<br>
                                <small class="adm-muted">${fmtDateTime(q.created_at)}${q.total_amount ? ` · ${money(q.total_amount)} est.` : ''}</small></span>
                                ${badge(q.status, LABELS.quoteStatus)}
                            </a></li>`).join('')}
                    </ul>` : emptyState('Todavía no llegan solicitudes desde la web.')}
            </section>
            <section class="adm-card">
                <div class="adm-card__head"><h2>Stock agotado o bajo</h2><a href="#/inventario">Inventario →</a></div>
                ${lowStock.length ? `
                    <ul class="adm-list">
                        ${lowStock.map(p => `<li><a href="#/productos/${p.id}"><span>${esc(p.name)}</span><span>${p.stock} ${stockBadge(p.stock_status)}</span></a></li>`).join('')}
                    </ul>` : emptyState('Sin alertas de stock. Solo se controlan productos con stock activado.')}
            </section>
        </div>`;

    main.querySelector('[data-new-order]')?.addEventListener('click', () => sessionStorage.setItem('mediprint-admin-new-order', '1'));
    main.querySelectorAll('[data-open]').forEach(link => link.addEventListener('click', () => sessionStorage.setItem(link.dataset.open, '1')));
}
