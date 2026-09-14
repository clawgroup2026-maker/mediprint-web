import {
    esc, run, money, fmtDateTime, badge, options, LABELS, emptyState, field, formDialog, confirmDialog, toast, friendlyError
} from '../ui.js';

const PAGE_SIZE = 100;

async function newOrderDialog(sb, preselectedCustomerId) {
    const customers = await run(sb.from('customers').select('id, name, rut').order('name').limit(2000));
    if (!customers.length) {
        toast('Primero registra un cliente.', 'error');
        return null;
    }
    return formDialog({
        title: 'Nuevo pedido',
        body: `<div class="adm-form-grid">
            <div class="adm-field adm-field--full">
                <label for="noCustomer">Cliente <span aria-hidden="true">*</span></label>
                <select id="noCustomer" name="customer_id" required>
                    <option value="">Selecciona…</option>
                    ${customers.map(c => `<option value="${c.id}"${c.id === preselectedCustomerId ? ' selected' : ''}>${esc(c.name)}${c.rut ? ` · ${esc(c.rut)}` : ''}</option>`).join('')}
                </select>
            </div>
            ${field({ name: 'channel', label: 'Canal', type: 'select', value: options(LABELS.channel, 'whatsapp') })}
            ${field({ name: 'shipping_net', label: 'Despacho neto (CLP)', type: 'number', value: 0, attrs: 'min="0" step="1"' })}
            ${field({ name: 'notes', label: 'Notas', type: 'textarea', full: true, attrs: 'maxlength="3000"' })}
        </div>`,
        submitLabel: 'Crear pedido',
        onSubmit: async data => {
            const order = await run(sb.from('orders').insert({
                customer_id: data.customer_id,
                channel: data.channel,
                shipping_net: data.shipping_net ?? 0,
                notes: data.notes
            }).select('id').single());
            return order.id;
        }
    });
}

export async function render(ctx) {
    const { sb, main, isCurrent, navigate, reload } = ctx;
    const filter = sessionStorage.getItem('mediprint-admin-order-filter') || 'abiertos';
    let query = sb.from('orders')
        .select('id, order_number, status, payment_status, channel, total_amount, created_at, customer:customers(id, name)')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
    if (filter === 'abiertos') query = query.not('status', 'in', '(entregado,cancelado)');
    else if (filter !== 'todos') query = query.eq('status', filter);

    const rows = await run(query);
    if (!isCurrent()) return;

    const tabs = { abiertos: 'En curso', ...LABELS.orderStatus, todos: 'Todos' };
    main.innerHTML = `
        <header class="adm-page-head">
            <div><p class="adm-eyebrow">Ventas</p><h1>Pedidos</h1></div>
            <button type="button" class="adm-btn adm-btn--primary" id="newOrder">+ Nuevo pedido</button>
        </header>
        <nav class="adm-tabs" aria-label="Filtrar por estado">
            ${Object.entries(tabs).map(([key, label]) => `<button type="button" class="adm-tab${key === filter ? ' is-active' : ''}" data-filter="${key}" aria-pressed="${key === filter}">${esc(label)}</button>`).join('')}
        </nav>
        <section class="adm-card">
            ${rows.length ? `<div class="adm-table-wrap"><table class="adm-table">
                <thead><tr><th scope="col">N°</th><th scope="col">Fecha</th><th scope="col">Cliente</th><th scope="col">Canal</th><th scope="col">Estado</th><th scope="col">Pago</th><th scope="col">Total</th></tr></thead>
                <tbody>${rows.map(o => `<tr>
                    <td data-label="N°"><a href="#/pedidos/${o.id}"><strong>${esc(o.order_number)}</strong></a></td>
                    <td data-label="Fecha">${fmtDateTime(o.created_at)}</td>
                    <td data-label="Cliente">${esc(o.customer?.name || '—')}</td>
                    <td data-label="Canal">${esc(LABELS.channel[o.channel])}</td>
                    <td data-label="Estado">${badge(o.status, LABELS.orderStatus)}</td>
                    <td data-label="Pago">${badge(o.payment_status, LABELS.paymentStatus)}</td>
                    <td data-label="Total"><strong>${money(o.total_amount)}</strong></td>
                </tr>`).join('')}</tbody></table></div>` : emptyState('No hay pedidos en este filtro.')}
        </section>`;

    main.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
        sessionStorage.setItem('mediprint-admin-order-filter', b.dataset.filter);
        reload();
    }));

    const openNew = async preselected => {
        const id = await newOrderDialog(sb, preselected);
        if (id) { toast('Pedido creado. Agrega los productos.'); navigate(`#/pedidos/${id}`); }
    };
    main.querySelector('#newOrder').addEventListener('click', () => openNew(null));

    // Accesos desde el resumen o la ficha de cliente
    const pending = sessionStorage.getItem('mediprint-admin-new-order');
    if (pending) {
        sessionStorage.removeItem('mediprint-admin-new-order');
        openNew(pending === '1' ? null : pending);
    }
}

function itemDialog(sb, order, products, item) {
    const productOptions = `<option value="">— Sin vincular (ítem libre) —</option>${products
        .map(p => `<option value="${p.id}" data-price="${p.base_net_price ?? ''}"${p.id === item?.product_id ? ' selected' : ''}>${esc(p.name)}${p.is_active ? '' : ' (inactivo)'}</option>`).join('')}`;
    return formDialog({
        title: item ? 'Editar ítem' : 'Agregar ítem',
        wide: true,
        body: `<div class="adm-form-grid">
            ${field({ name: 'product_id', label: 'Producto del catálogo', type: 'select', value: productOptions, full: true })}
            ${field({ name: 'description', label: 'Descripción (queda congelada en el pedido)', value: item?.description, required: true, full: true, attrs: 'maxlength="300"' })}
            ${field({ name: 'spec', label: 'Especificaciones / opciones', value: item?.options?.especificacion ?? item?.options?.cantidad ?? '', full: true, hint: 'Ej.: Carta · 500 unidades · Termolaminado', attrs: 'maxlength="300"' })}
            ${field({ name: 'quantity', label: 'Cantidad', type: 'number', value: item?.quantity ?? 1, required: true, attrs: 'min="1" step="1"' })}
            ${field({ name: 'unit_net_price', label: 'Precio neto unitario (CLP)', type: 'number', value: item?.unit_net_price ?? '', required: true, attrs: 'min="0" step="1"' })}
            <div class="adm-field adm-field--full"><span class="adm-label">Subtotal neto</span><output class="adm-output" data-subtotal>${item ? money(item.subtotal_net) : '—'}</output></div>
        </div>`,
        onMount: form => {
            const select = form.elements.product_id;
            const update = () => {
                const q = Number(form.elements.quantity.value) || 0;
                const p = form.elements.unit_net_price.value === '' ? null : Number(form.elements.unit_net_price.value);
                form.querySelector('[data-subtotal]').textContent = p === null ? '—' : money(q * p);
            };
            select.addEventListener('change', () => {
                const option = select.selectedOptions[0];
                if (select.value && !form.elements.description.value) form.elements.description.value = option.textContent.replace(/ \(inactivo\)$/, '');
                if (option?.dataset.price && form.elements.unit_net_price.value === '') form.elements.unit_net_price.value = option.dataset.price;
                update();
            });
            form.addEventListener('input', update);
        },
        onSubmit: async data => {
            const payload = {
                product_id: data.product_id,
                description: data.description,
                options: { ...(item?.options || {}), especificacion: data.spec || null },
                quantity: data.quantity,
                unit_net_price: data.unit_net_price
            };
            await run(item
                ? sb.from('order_items').update(payload).eq('id', item.id)
                : sb.from('order_items').insert({ ...payload, order_id: order.id, sort_order: (order.order_items?.length || 0) + 1 }));
        }
    });
}

function describeOptions(options) {
    if (!options || typeof options !== 'object') return '';
    const parts = [];
    if (options.especificacion) parts.push(options.especificacion);
    if (options.cantidad && options.cantidad !== options.especificacion) parts.push(options.cantidad);
    if (Array.isArray(options.opcionales) && options.opcionales.length) parts.push(`Opcionales: ${options.opcionales.join(', ')}`);
    return parts.join(' · ');
}

export async function renderDetail(ctx) {
    const { sb, main, param, isCurrent, reload } = ctx;
    const [order, products, profiles] = await Promise.all([
        run(sb.from('orders').select('*, customer:customers(id, name, rut, email, phone, address, commune), quote:quote_requests(id, quote_number), order_items(*), order_events(*)').eq('id', param).maybeSingle()),
        run(sb.from('products').select('id, name, base_net_price, is_active').order('name')),
        run(sb.from('profiles').select('id, email, full_name'))
    ]);
    if (!isCurrent()) return;
    if (!order) {
        main.innerHTML = emptyState('Pedido no encontrado.', '<a class="adm-btn adm-btn--ghost" href="#/pedidos">Volver</a>');
        return;
    }

    const who = Object.fromEntries(profiles.map(p => [p.id, p.full_name || p.email]));
    const items = [...order.order_items].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
    const events = [...order.order_events].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const eventText = e => {
        if (e.event_type === 'creado') return 'Pedido creado';
        if (e.event_type === 'estado') return `Estado: ${LABELS.orderStatus[e.from_value] || e.from_value} → ${LABELS.orderStatus[e.to_value] || e.to_value}`;
        if (e.event_type === 'pago') return `Pago: ${LABELS.paymentStatus[e.from_value] || e.from_value} → ${LABELS.paymentStatus[e.to_value] || e.to_value}`;
        return 'Nota';
    };

    main.innerHTML = `
        <header class="adm-page-head">
            <div>
                <p class="adm-eyebrow"><a href="#/pedidos">Pedidos</a> / ${esc(order.order_number)}</p>
                <h1>${esc(order.order_number)} ${badge(order.status, LABELS.orderStatus)} ${badge(order.payment_status, LABELS.paymentStatus)}</h1>
                <p class="adm-muted">Creado ${fmtDateTime(order.created_at)}${order.quote ? ` · desde <a href="#/cotizaciones/${order.quote.id}">${esc(order.quote.quote_number)}</a>` : ''}</p>
            </div>
        </header>

        <div class="adm-grid-2">
            <section class="adm-card">
                <div class="adm-card__head"><h2>Cliente</h2><a href="#/clientes/${order.customer.id}">Ver ficha →</a></div>
                <dl class="adm-dl">
                    <dt>Nombre</dt><dd><strong>${esc(order.customer.name)}</strong></dd>
                    <dt>RUT</dt><dd>${esc(order.customer.rut || '—')}</dd>
                    <dt>Contacto</dt><dd>${esc([order.customer.email, order.customer.phone].filter(Boolean).join(' · ') || '—')}</dd>
                    <dt>Despacho a</dt><dd>${esc([order.customer.address, order.customer.commune].filter(Boolean).join(', ') || '—')}</dd>
                </dl>
            </section>
            <section class="adm-card">
                <div class="adm-card__head"><h2>Gestión del pedido</h2></div>
                <form id="orderManage" class="adm-form" novalidate>
                    <div class="adm-form-grid">
                        ${field({ name: 'status', label: 'Estado', type: 'select', value: options(LABELS.orderStatus, order.status) })}
                        ${field({ name: 'payment_status', label: 'Estado de pago', type: 'select', value: options(LABELS.paymentStatus, order.payment_status) })}
                        ${field({ name: 'channel', label: 'Canal', type: 'select', value: options(LABELS.channel, order.channel) })}
                        ${field({ name: 'shipping_net', label: 'Despacho neto (CLP)', type: 'number', value: order.shipping_net, required: true, attrs: 'min="0" step="1"' })}
                        ${field({ name: 'notes', label: 'Notas del pedido', type: 'textarea', value: order.notes, full: true, attrs: 'maxlength="3000"' })}
                    </div>
                    <button type="submit" class="adm-btn adm-btn--primary">Guardar cambios</button>
                </form>
            </section>
        </div>

        <section class="adm-card">
            <div class="adm-card__head"><h2>Productos y especificaciones</h2><button type="button" class="adm-btn adm-btn--primary adm-btn--sm" id="addItem">+ Agregar ítem</button></div>
            ${items.length ? `<div class="adm-table-wrap"><table class="adm-table">
                <thead><tr><th scope="col">Descripción</th><th scope="col">Cantidad</th><th scope="col">Neto unitario</th><th scope="col">Subtotal neto</th><th scope="col"><span class="adm-sr">Acciones</span></th></tr></thead>
                <tbody>${items.map(i => `<tr>
                    <td data-label="Descripción"><strong>${esc(i.description)}</strong>${describeOptions(i.options) ? `<br><small class="adm-muted">${esc(describeOptions(i.options))}</small>` : ''}</td>
                    <td data-label="Cantidad">${i.quantity.toLocaleString('es-CL')}</td>
                    <td data-label="Neto unitario">${money(i.unit_net_price)}</td>
                    <td data-label="Subtotal neto">${money(i.subtotal_net)}</td>
                    <td class="adm-actions">
                        <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-edit-item="${i.id}">Editar</button>
                        <button type="button" class="adm-btn adm-btn--danger-ghost adm-btn--sm" data-delete-item="${i.id}">Quitar</button>
                    </td>
                </tr>`).join('')}</tbody></table></div>` : emptyState('El pedido aún no tiene productos.')}
            <div class="adm-totals">
                <div><span>Productos</span><strong>${money(Number(order.net_amount) - Number(order.shipping_net))}</strong></div>
                <div><span>Despacho</span><strong>${money(order.shipping_net)}</strong></div>
                <div><span>Neto</span><strong>${money(order.net_amount)}</strong></div>
                <div><span>IVA (${Number(order.vat_rate)}%)</span><strong>${money(order.vat_amount)}</strong></div>
                <div class="adm-totals__total"><span>Total</span><strong>${money(order.total_amount)}</strong></div>
            </div>
            <p class="adm-hint">Los totales se calculan en el servidor a partir de los ítems y el despacho.</p>
        </section>

        <section class="adm-card">
            <div class="adm-card__head"><h2>Historial y notas</h2></div>
            <form id="noteForm" class="adm-form adm-note-form" novalidate>
                <div class="adm-field adm-field--full">
                    <label for="noteText">Agregar nota</label>
                    <textarea id="noteText" name="note" required maxlength="2000" rows="2" placeholder="Ej.: cliente aprobó diseño, se envió muestra…"></textarea>
                </div>
                <button type="submit" class="adm-btn adm-btn--ghost adm-btn--sm">Guardar nota</button>
            </form>
            ${events.length ? `<ol class="adm-timeline">${events.map(e => `
                <li class="adm-timeline__item adm-timeline__item--${e.event_type}">
                    <strong>${esc(eventText(e))}</strong>
                    ${e.note ? `<p class="adm-pre">${esc(e.note)}</p>` : ''}
                    <small class="adm-muted">${fmtDateTime(e.created_at)}${e.created_by && who[e.created_by] ? ` · ${esc(who[e.created_by])}` : ''}</small>
                </li>`).join('')}</ol>` : emptyState('Sin eventos.')}
        </section>`;

    main.querySelector('#orderManage').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const next = form.elements.status.value;
        if (next === 'cancelado' && order.status !== 'cancelado') {
            const ok = await confirmDialog({ title: 'Cancelar pedido', message: `¿Marcar ${order.order_number} como cancelado? Quedará registrado en el historial.`, confirmLabel: 'Cancelar pedido', danger: true });
            if (!ok) return;
        }
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        try {
            await run(sb.from('orders').update({
                status: next,
                payment_status: form.elements.payment_status.value,
                channel: form.elements.channel.value,
                shipping_net: Number(form.elements.shipping_net.value) || 0,
                notes: form.elements.notes.value.trim() || null
            }).eq('id', order.id));
            toast('Pedido actualizado.');
            reload();
        } catch (error) {
            button.disabled = false;
            toast(friendlyError(error), 'error');
        }
    });

    main.querySelector('#noteForm').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        try {
            await run(sb.from('order_events').insert({ order_id: order.id, event_type: 'nota', note: form.elements.note.value.trim() }));
            toast('Nota agregada.');
            reload();
        } catch (error) {
            toast(friendlyError(error), 'error');
        }
    });

    const byId = Object.fromEntries(items.map(i => [i.id, i]));
    main.querySelector('#addItem').addEventListener('click', async () => {
        if (await itemDialog(sb, order, products, null)) { toast('Ítem agregado.'); reload(); }
    });
    main.querySelectorAll('[data-edit-item]').forEach(b => b.addEventListener('click', async () => {
        if (await itemDialog(sb, order, products, byId[b.dataset.editItem])) { toast('Ítem actualizado.'); reload(); }
    }));
    main.querySelectorAll('[data-delete-item]').forEach(b => b.addEventListener('click', async () => {
        const item = byId[b.dataset.deleteItem];
        const ok = await confirmDialog({ title: 'Quitar ítem', message: `¿Quitar "${item.description}" del pedido?`, confirmLabel: 'Quitar', danger: true });
        if (!ok) return;
        try {
            await run(sb.from('order_items').delete().eq('id', item.id));
            toast('Ítem quitado.');
            reload();
        } catch (error) {
            toast(friendlyError(error), 'error');
        }
    }));
}
