import {
    esc, run, money, fmtDateTime, fmtDate, badge, options, LABELS, emptyState, confirmDialog, formDialog, toast, friendlyError
} from '../ui.js';
import { customerForm, customerPayload } from './customers.js';

const PAGE_SIZE = 50;

export async function render(ctx) {
    const { sb, main, isCurrent } = ctx;
    const params = new URLSearchParams(sessionStorage.getItem('mediprint-admin-quote-filter') || 'status=pendientes');
    const status = params.get('status') || 'pendientes';

    let query = sb.from('quote_requests')
        .select('id, quote_number, source, status, contact_name, company, phone, product_summary, total_amount, created_at, customer:customers(name), quote_request_items(count)')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
    if (status === 'pendientes') query = query.in('status', ['nueva', 'en_revision']);
    else if (status !== 'todas') query = query.eq('status', status);

    const rows = await run(query);
    if (!isCurrent()) return;

    const tabs = { pendientes: 'Pendientes', ...LABELS.quoteStatus, todas: 'Todas' };
    main.innerHTML = `
        <header class="adm-page-head">
            <div><p class="adm-eyebrow">Ventas</p><h1>Solicitudes de cotización</h1></div>
        </header>
        <p class="adm-hint">Llegan desde el carrito ("Finalizar por WhatsApp") y el formulario de cotización. Los montos son estimados; el pedido real se confirma aquí.</p>
        <nav class="adm-tabs" aria-label="Filtrar por estado">
            ${Object.entries(tabs).map(([key, label]) => `<button type="button" class="adm-tab${key === status ? ' is-active' : ''}" data-status="${key}" aria-pressed="${key === status}">${esc(label)}</button>`).join('')}
        </nav>
        <section class="adm-card">
            ${rows.length ? `
            <div class="adm-table-wrap"><table class="adm-table">
                <thead><tr><th scope="col">N°</th><th scope="col">Fecha</th><th scope="col">Origen</th><th scope="col">Contacto / detalle</th><th scope="col">Estimado</th><th scope="col">Estado</th></tr></thead>
                <tbody>${rows.map(q => `<tr>
                    <td data-label="N°"><a href="#/cotizaciones/${q.id}"><strong>${esc(q.quote_number)}</strong></a></td>
                    <td data-label="Fecha">${fmtDateTime(q.created_at)}</td>
                    <td data-label="Origen">${esc(LABELS.quoteSource[q.source])}</td>
                    <td data-label="Contacto">${esc(q.customer?.name || q.contact_name || 'Sin datos de contacto')}${q.company ? ` · ${esc(q.company)}` : ''}<br>
                        <small class="adm-muted">${esc(q.product_summary || `${q.quote_request_items?.[0]?.count ?? 0} producto(s) del carrito`)}</small></td>
                    <td data-label="Estimado">${q.total_amount ? money(q.total_amount) : '—'}</td>
                    <td data-label="Estado">${badge(q.status, LABELS.quoteStatus)}</td>
                </tr>`).join('')}</tbody>
            </table></div>
            ${rows.length === PAGE_SIZE ? `<p class="adm-hint">Mostrando las ${PAGE_SIZE} más recientes.</p>` : ''}`
            : emptyState('No hay solicitudes en este estado.')}
        </section>`;

    main.querySelectorAll('[data-status]').forEach(button => button.addEventListener('click', () => {
        sessionStorage.setItem('mediprint-admin-quote-filter', `status=${button.dataset.status}`);
        ctx.reload();
    }));
}

export async function renderDetail(ctx) {
    const { sb, main, param, isCurrent, reload, navigate } = ctx;
    const [quote, order] = await Promise.all([
        run(sb.from('quote_requests').select('*, customer:customers(id, name, rut, email, phone), quote_request_items(*)').eq('id', param).maybeSingle()),
        run(sb.from('orders').select('id, order_number, status').eq('quote_request_id', param).maybeSingle())
    ]);
    if (!isCurrent()) return;
    if (!quote) {
        main.innerHTML = emptyState('Solicitud no encontrada.', '<a class="adm-btn adm-btn--ghost" href="#/cotizaciones">Volver</a>');
        return;
    }

    const items = [...(quote.quote_request_items || [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const whatsappPhone = (quote.phone || '').replace(/\D/g, '');

    main.innerHTML = `
        <header class="adm-page-head">
            <div>
                <p class="adm-eyebrow"><a href="#/cotizaciones">Cotizaciones</a> / ${esc(quote.quote_number)}</p>
                <h1>${esc(quote.quote_number)} ${badge(quote.status, LABELS.quoteStatus)}</h1>
                <p class="adm-muted">${esc(LABELS.quoteSource[quote.source])} · ${fmtDateTime(quote.created_at)}</p>
            </div>
            <div class="adm-actions">
                ${order
                    ? `<a class="adm-btn adm-btn--primary" href="#/pedidos/${order.id}">Ver pedido ${esc(order.order_number)}</a>`
                    : '<button type="button" class="adm-btn adm-btn--primary" id="convertOrder">Convertir en pedido</button>'}
            </div>
        </header>

        <div class="adm-grid-2">
            <section class="adm-card">
                <div class="adm-card__head"><h2>Contacto</h2></div>
                <dl class="adm-dl">
                    <dt>Nombre</dt><dd>${esc(quote.contact_name || '—')}</dd>
                    <dt>Empresa</dt><dd>${esc(quote.company || '—')}</dd>
                    <dt>Teléfono</dt><dd>${quote.phone ? `${esc(quote.phone)}${whatsappPhone.length >= 8 ? ` · <a href="https://wa.me/${esc(whatsappPhone)}" target="_blank" rel="noopener noreferrer">WhatsApp ↗</a>` : ''}` : '—'}</dd>
                    <dt>Correo</dt><dd>${quote.email ? `<a href="mailto:${esc(quote.email)}">${esc(quote.email)}</a>` : '—'}</dd>
                    <dt>Fecha requerida</dt><dd>${fmtDate(quote.required_date)}</dd>
                </dl>
                ${quote.source === 'carrito_web' && !quote.contact_name ? '<p class="adm-hint">El carrito no pide datos: identifica al cliente en la conversación de WhatsApp recibida a esta hora.</p>' : ''}
                <div class="adm-customer-link">
                    <h3>Cliente asociado</h3>
                    ${quote.customer
                        ? `<p><a href="#/clientes/${quote.customer.id}"><strong>${esc(quote.customer.name)}</strong></a>${quote.customer.rut ? ` · ${esc(quote.customer.rut)}` : ''}</p>`
                        : '<p class="adm-muted">Sin cliente asociado.</p>'}
                    <div class="adm-actions adm-actions--start">
                        <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="linkCustomer">${quote.customer ? 'Cambiar cliente' : 'Asociar cliente existente'}</button>
                        <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="createCustomer">Crear cliente con estos datos</button>
                    </div>
                </div>
            </section>

            <section class="adm-card">
                <div class="adm-card__head"><h2>Gestión</h2></div>
                <form id="quoteManage" class="adm-form" novalidate>
                    <div class="adm-field">
                        <label for="quoteStatus">Estado</label>
                        <select id="quoteStatus" name="status">${options(LABELS.quoteStatus, quote.status)}</select>
                    </div>
                    <div class="adm-field">
                        <label for="quoteNotes">Notas internas</label>
                        <textarea id="quoteNotes" name="admin_notes" maxlength="3000" rows="5">${esc(quote.admin_notes || '')}</textarea>
                    </div>
                    <div class="adm-actions adm-actions--start">
                        <button type="submit" class="adm-btn adm-btn--primary">Guardar</button>
                        <button type="button" class="adm-btn adm-btn--danger-ghost" id="deleteQuote">Eliminar (spam)</button>
                    </div>
                </form>
            </section>
        </div>

        <section class="adm-card">
            <div class="adm-card__head"><h2>Detalle solicitado</h2></div>
            ${quote.product_summary || quote.description ? `
                <dl class="adm-dl">
                    <dt>Producto / servicio</dt><dd>${esc(quote.product_summary || '—')}</dd>
                    <dt>Cantidad</dt><dd>${esc(quote.requested_quantity ?? '—')}</dd>
                    <dt>Descripción</dt><dd class="adm-pre">${esc(quote.description || '—')}</dd>
                </dl>` : ''}
            ${items.length ? `
                <div class="adm-table-wrap"><table class="adm-table">
                    <thead><tr><th scope="col">Producto</th><th scope="col">Especificación</th><th scope="col">Pedidos</th><th scope="col">Neto c/pack</th><th scope="col">Subtotal neto</th></tr></thead>
                    <tbody>${items.map(i => `<tr>
                        <td data-label="Producto"><strong>${esc(i.product_name)}</strong>${i.product_id ? '' : ' <small class="adm-muted">(no vinculado)</small>'}</td>
                        <td data-label="Especificación">${esc(i.option_label || '—')} · ${esc(i.quantity_label || '')}${i.extras?.length ? `<br><small>Opcionales: ${esc(i.extras.join(', '))}</small>` : ''}</td>
                        <td data-label="Pedidos">${i.packs}</td>
                        <td data-label="Neto c/pack">${money(i.unit_net_price)}</td>
                        <td data-label="Subtotal neto">${money(i.subtotal_net)}</td>
                    </tr>`).join('')}</tbody>
                </table></div>
                <div class="adm-totals">
                    <div><span>Neto estimado</span><strong>${money(quote.net_amount)}</strong></div>
                    <div><span>IVA (19%)</span><strong>${money(quote.vat_amount)}</strong></div>
                    <div class="adm-totals__total"><span>Total estimado</span><strong>${money(quote.total_amount)}</strong></div>
                </div>` : (!quote.product_summary ? emptyState('Sin productos.') : '')}
        </section>`;

    /* Guardar estado y notas */
    main.querySelector('#quoteManage').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        try {
            await run(sb.from('quote_requests').update({
                status: form.status.value,
                admin_notes: form.admin_notes.value.trim() || null
            }).eq('id', quote.id));
            toast('Solicitud actualizada.');
            reload();
        } catch (error) {
            button.disabled = false;
            toast(friendlyError(error), 'error');
        }
    });

    main.querySelector('#deleteQuote').addEventListener('click', async () => {
        if (order) { toast('Tiene un pedido asociado: cámbiala a "Cancelada" en lugar de eliminarla.', 'error'); return; }
        const ok = await confirmDialog({ title: 'Eliminar solicitud', message: `¿Eliminar ${quote.quote_number}? Úsalo solo para spam o duplicados. No se puede deshacer.`, confirmLabel: 'Eliminar', danger: true });
        if (!ok) return;
        try {
            await run(sb.from('quote_requests').delete().eq('id', quote.id));
            toast('Solicitud eliminada.');
            navigate('#/cotizaciones');
        } catch (error) {
            toast(friendlyError(error), 'error');
        }
    });

    /* Asociar cliente existente */
    main.querySelector('#linkCustomer').addEventListener('click', async () => {
        const customers = await run(sb.from('customers').select('id, name, rut, email').order('name').limit(1000));
        if (!customers.length) { toast('Aún no hay clientes. Usa "Crear cliente con estos datos".', 'error'); return; }
        const saved = await formDialog({
            title: 'Asociar cliente',
            body: `<div class="adm-field adm-field--full">
                <label for="customerPick">Cliente</label>
                <input id="customerPickFilter" type="search" placeholder="Filtrar por nombre, RUT o correo" aria-label="Filtrar clientes">
                <select id="customerPick" name="customer_id" required size="8">
                    ${customers.map(c => `<option value="${c.id}"${c.id === quote.customer_id ? ' selected' : ''}>${esc(c.name)}${c.rut ? ` · ${esc(c.rut)}` : ''}${c.email ? ` · ${esc(c.email)}` : ''}</option>`).join('')}
                </select>
            </div>`,
            onMount: form => {
                const filter = form.querySelector('#customerPickFilter');
                filter.addEventListener('input', () => {
                    const q = filter.value.toLowerCase();
                    [...form.querySelector('#customerPick').options].forEach(o => { o.hidden = q && !o.textContent.toLowerCase().includes(q); });
                });
                filter.focus();
            },
            onSubmit: async data => run(sb.from('quote_requests').update({ customer_id: data.customer_id }).eq('id', quote.id))
        });
        if (saved) { toast('Cliente asociado.'); reload(); }
    });

    /* Crear cliente con los datos de la solicitud */
    main.querySelector('#createCustomer').addEventListener('click', async () => {
        const created = await formDialog({
            title: 'Nuevo cliente',
            body: customerForm({ name: quote.company || quote.contact_name, email: quote.email, phone: quote.phone, notes: quote.company && quote.contact_name ? `Contacto: ${quote.contact_name}` : '' }),
            wide: true,
            onSubmit: async data => {
                const customer = await run(sb.from('customers').insert(customerPayload(data)).select('id').single());
                await run(sb.from('quote_requests').update({ customer_id: customer.id }).eq('id', quote.id));
                return customer.id;
            }
        });
        if (created) { toast('Cliente creado y asociado.'); reload(); }
    });

    /* Convertir en pedido */
    main.querySelector('#convertOrder')?.addEventListener('click', async () => {
        if (!quote.customer_id) { toast('Primero asocia o crea el cliente de esta solicitud.', 'error'); return; }
        const created = await formDialog({
            title: `Crear pedido desde ${quote.quote_number}`,
            body: `<p>Se copiarán ${items.length} ítem(s) con sus precios estimados. Podrás ajustar precios, despacho y estado en el pedido.</p>
                <div class="adm-form-grid">
                    <div class="adm-field"><label for="convChannel">Canal</label><select id="convChannel" name="channel">${options(LABELS.channel, quote.source === 'carrito_web' ? 'whatsapp' : 'web')}</select></div>
                    <div class="adm-field"><label for="convShipping">Despacho neto (CLP)</label><input id="convShipping" name="shipping_net" type="number" min="0" step="1" value="0"></div>
                </div>`,
            submitLabel: 'Crear pedido',
            onSubmit: async data => {
                const newOrder = await run(sb.from('orders').insert({
                    customer_id: quote.customer_id,
                    quote_request_id: quote.id,
                    channel: data.channel,
                    shipping_net: data.shipping_net ?? 0,
                    notes: quote.description ? `Solicitud: ${quote.description}`.slice(0, 3000) : null
                }).select('id').single());
                if (items.length) {
                    const orderItems = items.map((i, index) => ({
                        order_id: newOrder.id,
                        product_id: i.product_id,
                        description: [i.product_name, i.option_label].filter(Boolean).join(' · ').slice(0, 300),
                        options: { cantidad: i.quantity_label || null, opcionales: i.extras || [], origen: quote.quote_number },
                        quantity: i.packs,
                        unit_net_price: i.unit_net_price,
                        sort_order: index
                    }));
                    try {
                        await run(sb.from('order_items').insert(orderItems));
                    } catch (error) {
                        toast(`Pedido creado, pero no se copiaron los ítems: ${friendlyError(error)}`, 'error');
                    }
                }
                if (['nueva', 'en_revision', 'cotizada'].includes(quote.status)) {
                    await run(sb.from('quote_requests').update({ status: 'aceptada' }).eq('id', quote.id));
                }
                return newOrder.id;
            }
        });
        if (created) { toast('Pedido creado.'); navigate(`#/pedidos/${created}`); }
    });
}
