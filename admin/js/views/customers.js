import {
    esc, run, money, fmtDateTime, badge, LABELS, emptyState, field, formDialog, confirmDialog, toast, friendlyError
} from '../ui.js';

/* Validación de RUT (módulo 11) también en el cliente, para feedback inmediato.
   La base de datos vuelve a validarlo. */
export function normalizeRut(value) {
    const clean = String(value || '').replace(/[^0-9kK]/g, '').toUpperCase();
    return clean ? `${clean.slice(0, -1)}-${clean.slice(-1)}` : '';
}

export function isValidRut(rut) {
    if (!/^[0-9]{7,8}-[0-9K]$/.test(rut)) return false;
    const [body, dv] = rut.split('-');
    let sum = 0;
    let mul = 2;
    for (let i = body.length - 1; i >= 0; i--) {
        sum += Number(body[i]) * mul;
        mul = mul === 7 ? 2 : mul + 1;
    }
    const res = 11 - (sum % 11);
    return (res === 11 ? '0' : res === 10 ? 'K' : String(res)) === dv;
}

export function customerForm(c = {}) {
    return `<div class="adm-form-grid">
        ${field({ name: 'name', label: 'Nombre o razón social', value: c.name, required: true, full: true, attrs: 'maxlength="160"' })}
        ${field({ name: 'rut', label: 'RUT', value: c.rut, hint: 'Ej.: 12.345.678-5', attrs: 'maxlength="12" data-rut autocomplete="off"' })}
        ${field({ name: 'email', label: 'Correo', type: 'email', value: c.email, attrs: 'maxlength="254"' })}
        ${field({ name: 'phone', label: 'Teléfono', type: 'tel', value: c.phone, attrs: 'maxlength="30"' })}
        ${field({ name: 'commune', label: 'Comuna', value: c.commune, attrs: 'maxlength="80"' })}
        ${field({ name: 'address', label: 'Dirección', value: c.address, full: true, attrs: 'maxlength="200"' })}
        ${field({ name: 'notes', label: 'Notas', type: 'textarea', value: c.notes, full: true, attrs: 'maxlength="2000"' })}
    </div>`;
}

export function customerPayload(data) {
    const rut = data.rut ? normalizeRut(data.rut) : null;
    if (rut && !isValidRut(rut)) throw new Error('El RUT no es válido (revisa el dígito verificador).');
    return {
        name: data.name, rut, email: data.email, phone: data.phone,
        commune: data.commune, address: data.address, notes: data.notes
    };
}

async function openCustomerDialog(sb, customer) {
    return formDialog({
        title: customer ? 'Editar cliente' : 'Nuevo cliente',
        body: customerForm(customer || {}),
        wide: true,
        onSubmit: async data => {
            const payload = customerPayload(data);
            if (customer) {
                await run(sb.from('customers').update(payload).eq('id', customer.id));
                return customer.id;
            }
            const created = await run(sb.from('customers').insert(payload).select('id').single());
            return created.id;
        }
    });
}

export async function render(ctx) {
    const { sb, main, isCurrent, navigate } = ctx;
    const rows = await run(sb.from('customers').select('id, name, rut, email, phone, commune, created_at, orders(count)').order('name').limit(2000));
    if (!isCurrent()) return;

    main.innerHTML = `
        <header class="adm-page-head">
            <div><p class="adm-eyebrow">Ventas</p><h1>Clientes</h1></div>
            <button type="button" class="adm-btn adm-btn--primary" id="newCustomer">+ Nuevo cliente</button>
        </header>
        <section class="adm-card">
            <div class="adm-filters">
                <div class="adm-field"><label for="cq">Buscar</label><input id="cq" type="search" placeholder="Nombre, RUT, correo o teléfono"></div>
            </div>
            <div id="customerTable"></div>
        </section>`;

    const host = main.querySelector('#customerTable');
    const draw = (q = '') => {
        const needle = q.toLowerCase().replace(/\./g, '');
        const list = rows.filter(c => !needle || [c.name, c.rut, c.email, c.phone].some(v => String(v || '').toLowerCase().replace(/\./g, '').includes(needle)));
        host.innerHTML = list.length ? `
            <p class="adm-muted adm-count" aria-live="polite">${list.length} cliente(s)</p>
            <div class="adm-table-wrap"><table class="adm-table">
                <thead><tr><th scope="col">Cliente</th><th scope="col">RUT</th><th scope="col">Contacto</th><th scope="col">Comuna</th><th scope="col">Pedidos</th><th scope="col"><span class="adm-sr">Acciones</span></th></tr></thead>
                <tbody>${list.map(c => `<tr>
                    <td data-label="Cliente"><a href="#/clientes/${c.id}"><strong>${esc(c.name)}</strong></a></td>
                    <td data-label="RUT">${esc(c.rut || '—')}</td>
                    <td data-label="Contacto">${esc(c.email || '')}${c.email && c.phone ? '<br>' : ''}${esc(c.phone || '')}${!c.email && !c.phone ? '—' : ''}</td>
                    <td data-label="Comuna">${esc(c.commune || '—')}</td>
                    <td data-label="Pedidos">${c.orders?.[0]?.count ?? 0}</td>
                    <td class="adm-actions"><a class="adm-btn adm-btn--ghost adm-btn--sm" href="#/clientes/${c.id}">Ver</a></td>
                </tr>`).join('')}</tbody>
            </table></div>` : emptyState(rows.length ? 'Sin coincidencias.' : 'Aún no hay clientes registrados.');
    };
    main.querySelector('#cq').addEventListener('input', e => draw(e.target.value.trim()));
    main.querySelector('#newCustomer').addEventListener('click', async () => {
        const id = await openCustomerDialog(sb, null);
        if (id) { toast('Cliente creado.'); navigate(`#/clientes/${id}`); }
    });
    draw();

    if (sessionStorage.getItem('mediprint-admin-new-customer')) {
        sessionStorage.removeItem('mediprint-admin-new-customer');
        main.querySelector('#newCustomer').click();
    }
}

export async function renderDetail(ctx) {
    const { sb, main, param, isCurrent, reload, navigate } = ctx;
    const [customer, orders, quotes] = await Promise.all([
        run(sb.from('customers').select('*').eq('id', param).maybeSingle()),
        run(sb.from('orders').select('id, order_number, status, payment_status, total_amount, created_at').eq('customer_id', param).order('created_at', { ascending: false })),
        run(sb.from('quote_requests').select('id, quote_number, status, total_amount, created_at').eq('customer_id', param).order('created_at', { ascending: false }))
    ]);
    if (!isCurrent()) return;
    if (!customer) {
        main.innerHTML = emptyState('Cliente no encontrado.', '<a class="adm-btn adm-btn--ghost" href="#/clientes">Volver</a>');
        return;
    }
    const totalBought = orders.filter(o => o.status !== 'cancelado').reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const phone = (customer.phone || '').replace(/\D/g, '');

    main.innerHTML = `
        <header class="adm-page-head">
            <div><p class="adm-eyebrow"><a href="#/clientes">Clientes</a> / Ficha</p><h1>${esc(customer.name)}</h1></div>
            <div class="adm-actions">
                <button type="button" class="adm-btn adm-btn--primary" id="newOrderForCustomer">+ Nuevo pedido</button>
                <button type="button" class="adm-btn adm-btn--ghost" id="editCustomer">Editar</button>
                <button type="button" class="adm-btn adm-btn--danger-ghost" id="deleteCustomer">Eliminar</button>
            </div>
        </header>
        <div class="adm-grid-2">
            <section class="adm-card">
                <div class="adm-card__head"><h2>Datos de contacto</h2></div>
                <dl class="adm-dl">
                    <dt>RUT</dt><dd>${esc(customer.rut || '—')}</dd>
                    <dt>Correo</dt><dd>${customer.email ? `<a href="mailto:${esc(customer.email)}">${esc(customer.email)}</a>` : '—'}</dd>
                    <dt>Teléfono</dt><dd>${customer.phone ? `${esc(customer.phone)}${phone.length >= 8 ? ` · <a href="https://wa.me/${esc(phone)}" target="_blank" rel="noopener noreferrer">WhatsApp ↗</a>` : ''}` : '—'}</dd>
                    <dt>Dirección</dt><dd>${esc([customer.address, customer.commune].filter(Boolean).join(', ') || '—')}</dd>
                    <dt>Notas</dt><dd class="adm-pre">${esc(customer.notes || '—')}</dd>
                    <dt>Registrado</dt><dd>${fmtDateTime(customer.created_at)}</dd>
                </dl>
            </section>
            <section class="adm-card">
                <div class="adm-card__head"><h2>Resumen</h2></div>
                <div class="adm-stats adm-stats--compact">
                    <div class="adm-stat"><span>Pedidos</span><strong>${orders.length}</strong></div>
                    <div class="adm-stat"><span>Total comprado</span><strong>${money(totalBought)}</strong><small>Sin cancelados, con IVA</small></div>
                    <div class="adm-stat"><span>Cotizaciones</span><strong>${quotes.length}</strong></div>
                </div>
            </section>
        </div>
        <section class="adm-card">
            <div class="adm-card__head"><h2>Pedidos</h2></div>
            ${orders.length ? `<div class="adm-table-wrap"><table class="adm-table">
                <thead><tr><th scope="col">N°</th><th scope="col">Fecha</th><th scope="col">Estado</th><th scope="col">Pago</th><th scope="col">Total</th></tr></thead>
                <tbody>${orders.map(o => `<tr>
                    <td data-label="N°"><a href="#/pedidos/${o.id}"><strong>${esc(o.order_number)}</strong></a></td>
                    <td data-label="Fecha">${fmtDateTime(o.created_at)}</td>
                    <td data-label="Estado">${badge(o.status, LABELS.orderStatus)}</td>
                    <td data-label="Pago">${badge(o.payment_status, LABELS.paymentStatus)}</td>
                    <td data-label="Total">${money(o.total_amount)}</td>
                </tr>`).join('')}</tbody></table></div>` : emptyState('Sin pedidos.')}
        </section>
        ${quotes.length ? `<section class="adm-card">
            <div class="adm-card__head"><h2>Cotizaciones</h2></div>
            <ul class="adm-list">${quotes.map(q => `<li><a href="#/cotizaciones/${q.id}"><span><strong>${esc(q.quote_number)}</strong> · ${fmtDateTime(q.created_at)}</span>${badge(q.status, LABELS.quoteStatus)}</a></li>`).join('')}</ul>
        </section>` : ''}`;

    main.querySelector('#editCustomer').addEventListener('click', async () => {
        if (await openCustomerDialog(sb, customer)) { toast('Cliente actualizado.'); reload(); }
    });
    main.querySelector('#newOrderForCustomer').addEventListener('click', () => {
        sessionStorage.setItem('mediprint-admin-new-order', customer.id);
        navigate('#/pedidos');
    });
    main.querySelector('#deleteCustomer').addEventListener('click', async () => {
        if (orders.length) { toast('No se puede eliminar un cliente con pedidos.', 'error'); return; }
        const ok = await confirmDialog({ title: 'Eliminar cliente', message: `¿Eliminar a "${customer.name}"? Sus cotizaciones quedarán sin cliente asociado.`, confirmLabel: 'Eliminar', danger: true });
        if (!ok) return;
        try {
            await run(sb.from('customers').delete().eq('id', customer.id));
            toast('Cliente eliminado.');
            navigate('#/clientes');
        } catch (error) {
            toast(friendlyError(error), 'error');
        }
    });
}
