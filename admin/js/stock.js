/* ========================================
   MEDIPRINT ADMIN · Control de stock
   Todo cambio de stock se registra como movimiento de inventario;
   la base de datos impide stock negativo y cambios directos.
   ======================================== */

import { run, field, formDialog, toast } from './ui.js';

export const STOCK_LABELS = {
    disponible: 'EN STOCK',
    bajo: 'STOCK BAJO',
    agotado: 'AGOTADO',
    sin_control: 'SIN CONTROL'
};

const STOCK_TONES = { disponible: 'ok', bajo: 'warn', agotado: 'danger', sin_control: 'muted' };

export function stockBadge(status) {
    const key = status || 'sin_control';
    return `<span class="adm-badge adm-badge--${STOCK_TONES[key]}">${STOCK_LABELS[key]}</span>`;
}

/** Registra la diferencia entre el stock actual (leído en el momento) y el deseado como ajuste. */
export async function setStock(sb, productId, newStock, reason) {
    const target = Number(newStock);
    if (!Number.isInteger(target) || target < 0) throw new Error('El stock debe ser un número entero mayor o igual a 0.');
    const { stock } = await run(sb.from('products').select('stock').eq('id', productId).single());
    const delta = target - Number(stock || 0);
    if (delta === 0) return false;
    await run(sb.from('inventory_movements').insert({
        product_id: productId,
        movement_type: 'ajuste',
        quantity: delta,
        reason: reason || 'Ajuste manual desde el panel'
    }));
    return true;
}

/**
 * Diálogo: aumentar, disminuir o fijar el stock de un producto.
 * Devuelve true si se registró un movimiento.
 */
export async function stockDialog(sb, product) {
    const saved = await formDialog({
        title: `Stock · ${product.name}`,
        body: `
            <p class="adm-stock-now">Stock actual: <strong>${Number(product.stock || 0).toLocaleString('es-CL')}</strong> ${product.track_stock ? stockBadge(product.stock_status) : stockBadge('sin_control')}</p>
            ${product.track_stock ? '' : '<p class="adm-hint">Este producto aún no controla stock. Al registrar un movimiento se activará el control.</p>'}
            <fieldset class="adm-segmented">
                <legend>Operación</legend>
                <label><input type="radio" name="operation" value="entrada" checked> Aumentar</label>
                <label><input type="radio" name="operation" value="salida"> Disminuir</label>
                <label><input type="radio" name="operation" value="fijar"> Fijar cantidad</label>
            </fieldset>
            <div class="adm-form-grid">
                ${field({ name: 'quantity', label: 'Cantidad', type: 'number', required: true, attrs: 'min="0" step="1" inputmode="numeric" data-qty' })}
                <div class="adm-field"><span class="adm-label">Stock resultante</span><output class="adm-output" data-result>—</output></div>
                ${field({ name: 'reason', label: 'Motivo', required: true, full: true, value: 'Reposición de stock', hint: 'Ej.: compra a proveedor, venta, merma, conteo físico.', attrs: 'minlength="3" maxlength="500"' })}
            </div>`,
        submitLabel: 'Registrar',
        onMount: form => {
            const qty = form.querySelector('[data-qty]');
            const out = form.querySelector('[data-result]');
            const reason = form.elements.reason;
            const defaults = { entrada: 'Reposición de stock', salida: 'Salida de stock', fijar: 'Conteo físico / ajuste manual' };
            let lastDefault = reason.value;
            const update = () => {
                const op = form.querySelector('[name="operation"]:checked').value;
                if (reason.value === lastDefault) { reason.value = defaults[op]; lastDefault = reason.value; }
                const current = Number(product.stock || 0);
                const n = qty.value === '' ? null : Number(qty.value);
                if (n === null) { out.textContent = '—'; out.classList.remove('adm-text-danger'); return; }
                const result = op === 'entrada' ? current + n : op === 'salida' ? current - n : n;
                out.textContent = result < 0 ? `${result} (no permitido)` : result.toLocaleString('es-CL');
                out.classList.toggle('adm-text-danger', result < 0);
            };
            form.addEventListener('input', update);
            form.addEventListener('change', update);
            qty.focus();
        },
        onSubmit: async (data, form) => {
            const op = form.querySelector('[name="operation"]:checked').value;
            const quantity = Number(data.quantity);
            if (!Number.isInteger(quantity) || quantity < 0) throw new Error('Ingresa una cantidad entera válida.');
            if (op === 'fijar') {
                const changed = await setStock(sb, product.id, quantity, data.reason);
                if (!changed) throw new Error('El stock ya tiene esa cantidad.');
                return true;
            }
            if (quantity === 0) throw new Error('La cantidad debe ser mayor a 0.');
            if (op === 'salida' && quantity > Number(product.stock || 0)) {
                throw new Error(`No hay stock suficiente: disponible ${product.stock}.`);
            }
            await run(sb.from('inventory_movements').insert({
                product_id: product.id,
                movement_type: op,
                quantity,
                reason: data.reason
            }));
            return true;
        }
    });
    if (saved) toast(`Stock de "${product.name}" actualizado.`);
    return Boolean(saved);
}

