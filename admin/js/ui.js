/* ========================================
   MEDIPRINT ADMIN · Utilidades de interfaz
   ======================================== */

export function esc(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
export const money = value => clp.format(Number(value) || 0);

const dateTime = new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' });
export const fmtDateTime = value => (value ? dateTime.format(new Date(value)) : '—');
export const fmtDate = value => (value ? dateOnly.format(new Date(`${value}`.length === 10 ? `${value}T12:00:00` : value)) : '—');

export function slugify(text) {
    return String(text || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        .slice(0, 120);
}

export const grossPrice = (net, vatRate = 19) => Math.round((Number(net) || 0) * (1 + (Number(vatRate) || 0) / 100));

/* ---------- Etiquetas de estados ---------- */
export const LABELS = {
    quoteStatus: {
        nueva: 'Nueva', en_revision: 'En revisión', cotizada: 'Cotizada',
        aceptada: 'Aceptada', rechazada: 'Rechazada', cancelada: 'Cancelada'
    },
    quoteSource: { carrito_web: 'Carrito web', formulario_cotizacion: 'Formulario', panel: 'Panel' },
    orderStatus: {
        pendiente: 'Pendiente', confirmado: 'Confirmado', en_diseno: 'En diseño', en_produccion: 'En producción',
        listo: 'Listo', despachado: 'Despachado', entregado: 'Entregado', cancelado: 'Cancelado'
    },
    paymentStatus: { pendiente: 'Pendiente', abonado: 'Abonado', pagado: 'Pagado', reembolsado: 'Reembolsado' },
    channel: { whatsapp: 'WhatsApp', web: 'Web', presencial: 'Presencial', correo: 'Correo', instagram: 'Instagram', otro: 'Otro' },
    pricingMode: { tiers: 'Tramos por cantidad', unit: 'Precio unitario', quote: 'A cotizar' },
    movementType: { entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste' },
    categoryKind: { printed: 'Productos impresos', web: 'Servicios web' }
};

const TONES = {
    nueva: 'info', en_revision: 'warn', cotizada: 'info', aceptada: 'ok', rechazada: 'muted', cancelada: 'muted', cancelado: 'muted',
    pendiente: 'warn', confirmado: 'info', en_diseno: 'info', en_produccion: 'info', listo: 'ok', despachado: 'ok', entregado: 'ok',
    abonado: 'info', pagado: 'ok', reembolsado: 'muted', entrada: 'ok', salida: 'warn', ajuste: 'info'
};

export function badge(value, labels) {
    return `<span class="adm-badge adm-badge--${TONES[value] || 'muted'}">${esc(labels?.[value] ?? value)}</span>`;
}

export function options(map, selected) {
    return Object.entries(map)
        .map(([value, label]) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`)
        .join('');
}

/* ---------- Estados de vista ---------- */
export const loadingState = (text = 'Cargando…') =>
    `<div class="adm-state" role="status" aria-live="polite"><span class="adm-spinner" aria-hidden="true"></span><p>${esc(text)}</p></div>`;

export const emptyState = (text, action = '') =>
    `<div class="adm-state adm-state--empty"><p>${esc(text)}</p>${action}</div>`;

export function errorState(error, retryId = '') {
    return `<div class="adm-state adm-state--error" role="alert">
        <p><strong>No se pudo cargar la información.</strong></p>
        <p>${esc(friendlyError(error))}</p>
        ${retryId ? `<button type="button" class="adm-btn adm-btn--ghost" id="${esc(retryId)}">Reintentar</button>` : ''}
    </div>`;
}

/* ---------- Errores legibles ---------- */
export function friendlyError(error) {
    if (!error) return 'Error desconocido.';
    const code = error.code || '';
    const message = error.message || String(error);
    if (code === '23505') return 'Ya existe un registro con ese valor (nombre, slug, SKU, RUT o cantidad duplicada).';
    if (code === '23503') return 'No se puede completar: hay registros relacionados (por ejemplo pedidos o movimientos). Considera desactivarlo.';
    if (code === '23514') return /Stock insuficiente/.test(message) ? message : 'Algún dato no cumple las validaciones (formato, rango o valor permitido).';
    if (code === '42501' || /permission denied|row-level security/i.test(message)) return 'No tienes permisos para esta acción.';
    if (code === 'PGRST301' || /JWT expired/i.test(message)) return 'La sesión expiró. Vuelve a iniciar sesión.';
    if (/Failed to fetch|NetworkError/i.test(message)) return 'Sin conexión con el servidor. Revisa tu internet.';
    return message;
}

/* ---------- Toasts ---------- */
export function toast(message, type = 'ok') {
    const region = document.getElementById(type === 'error' ? 'admAlerts' : 'admToasts');
    if (!region) return;
    const item = document.createElement('div');
    item.className = `adm-toast adm-toast--${type}`;
    item.textContent = message;
    region.append(item);
    setTimeout(() => item.remove(), type === 'error' ? 7000 : 3800);
}

/* ---------- Diálogos ---------- */
export function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false }) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'adm-dialog adm-dialog--sm';
        dialog.setAttribute('aria-labelledby', 'admConfirmTitle');
        dialog.innerHTML = `
            <div class="adm-dialog__body">
                <h2 id="admConfirmTitle">${esc(title)}</h2>
                <p>${esc(message)}</p>
                <div class="adm-dialog__actions">
                    <button type="button" data-answer="cancel" class="adm-btn adm-btn--ghost" autofocus>Cancelar</button>
                    <button type="button" data-answer="ok" class="adm-btn ${danger ? 'adm-btn--danger' : 'adm-btn--primary'}">${esc(confirmLabel)}</button>
                </div>
            </div>`;
        document.body.append(dialog);
        let settled = false;
        const finish = answer => {
            if (settled) return;
            settled = true;
            resolve(answer);
            if (dialog.open) dialog.close();
            dialog.remove();
        };
        dialog.querySelectorAll('[data-answer]').forEach(button =>
            button.addEventListener('click', () => finish(button.dataset.answer === 'ok')));
        // Escape o cierre del navegador = cancelar
        dialog.addEventListener('close', () => finish(false));
        dialog.showModal();
    });
}

/**
 * Diálogo con formulario. `onSubmit(data, form)` puede lanzar un error:
 * se muestra dentro del diálogo y este permanece abierto.
 */
export function formDialog({ title, body, submitLabel = 'Guardar', onSubmit, onMount, wide = false }) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = `adm-dialog${wide ? ' adm-dialog--wide' : ''}`;
        dialog.setAttribute('aria-labelledby', 'admFormTitle');
        dialog.innerHTML = `
            <form class="adm-dialog__body adm-form" novalidate>
                <div class="adm-dialog__head">
                    <h2 id="admFormTitle">${esc(title)}</h2>
                    <button type="button" class="adm-icon-btn" data-close aria-label="Cerrar">×</button>
                </div>
                <div class="adm-form__error" role="alert" hidden></div>
                ${body}
                <div class="adm-dialog__actions">
                    <button type="button" class="adm-btn adm-btn--ghost" data-close>Cancelar</button>
                    <button type="submit" class="adm-btn adm-btn--primary">${esc(submitLabel)}</button>
                </div>
            </form>`;
        document.body.append(dialog);
        const form = dialog.querySelector('form');
        const errorBox = dialog.querySelector('.adm-form__error');
        const submit = form.querySelector('button[type="submit"]');
        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            resolve(value);
            if (dialog.open) dialog.close();
            dialog.remove();
        };

        dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => finish(null)));
        dialog.addEventListener('close', () => finish(null));

        form.addEventListener('submit', async event => {
            event.preventDefault();
            errorBox.hidden = true;
            if (!form.reportValidity()) return;
            submit.disabled = true;
            submit.setAttribute('aria-busy', 'true');
            try {
                finish((await onSubmit(formData(form), form)) ?? true);
            } catch (error) {
                errorBox.textContent = friendlyError(error);
                errorBox.hidden = false;
                errorBox.focus?.();
            } finally {
                submit.disabled = false;
                submit.removeAttribute('aria-busy');
            }
        });

        dialog.showModal();
        onMount?.(form, dialog);
    });
}

/* ---------- Formularios ---------- */
export function formData(form) {
    const data = {};
    for (const element of form.elements) {
        if (!element.name || element.disabled) continue;
        if (element.type === 'checkbox') data[element.name] = element.checked;
        else if (element.type === 'radio') { if (element.checked) data[element.name] = element.value; }
        else if (element.type === 'number') data[element.name] = element.value === '' ? null : Number(element.value);
        else if (element.type === 'file') continue;
        else data[element.name] = element.value.trim() === '' ? null : element.value.trim();
    }
    return data;
}

export function field({ name, label, type = 'text', value = '', required = false, hint = '', attrs = '', full = false }) {
    const id = `f-${name}-${Math.random().toString(36).slice(2, 7)}`;
    const hintId = hint ? `${id}-hint` : '';
    const common = `id="${id}" name="${esc(name)}" ${required ? 'required' : ''} ${hint ? `aria-describedby="${hintId}"` : ''} ${attrs}`;
    let control;
    if (type === 'textarea') control = `<textarea ${common}>${esc(value)}</textarea>`;
    else if (type === 'checkbox') {
        return `<label class="adm-check${full ? ' adm-field--full' : ''}"><input type="checkbox" ${common} ${value ? 'checked' : ''}> <span>${esc(label)}</span></label>`;
    } else if (type === 'select') control = `<select ${common}>${value}</select>`;
    else control = `<input type="${type}" ${common} value="${esc(value)}">`;
    return `<div class="adm-field${full ? ' adm-field--full' : ''}">
        <label for="${id}">${esc(label)}${required ? ' <span aria-hidden="true">*</span>' : ''}</label>
        ${hint ? `<small id="${hintId}" class="adm-hint">${esc(hint)}</small>` : ''}
        ${control}
    </div>`;
}

/* Sincroniza aria-invalid con :user-invalid (accesibilidad) */
export function initAccessibleValidation() {
    const sync = event => {
        const input = event.target;
        if (!input.matches?.('input, textarea, select')) return;
        if (input.matches(':user-invalid')) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
    };
    document.addEventListener('blur', sync, true);
    document.addEventListener('input', event => {
        if (event.target.getAttribute?.('aria-invalid') === 'true') sync(event);
    });
}

/* Ejecuta una consulta de Supabase y lanza si hay error */
export async function run(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
}

/* Cuenta filas visibles (query debe usar select con { count: 'exact', head: true }) */
export async function countRows(query) {
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
}
