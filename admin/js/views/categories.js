import { esc, run, emptyState, formDialog, confirmDialog, field, options, slugify, toast, friendlyError, LABELS } from '../ui.js';

function categoryForm(category = {}) {
    return `<div class="adm-form-grid">
        ${field({ name: 'name', label: 'Nombre', value: category.name, required: true, attrs: 'maxlength="80" data-slug-source' })}
        ${field({ name: 'slug', label: 'Slug (URL)', value: category.slug, required: true, hint: 'Minúsculas, números y guiones.', attrs: 'maxlength="80" pattern="[a-z0-9]+(-[a-z0-9]+)*" data-slug-target' })}
        ${field({ name: 'kind', label: 'Tipo', type: 'select', value: options(LABELS.categoryKind, category.kind || 'printed') })}
        ${field({ name: 'sort_order', label: 'Orden', type: 'number', value: category.sort_order ?? 0, attrs: 'step="1"' })}
        ${field({ name: 'description', label: 'Descripción', type: 'textarea', value: category.description, full: true, attrs: 'maxlength="500"' })}
        ${field({ name: 'is_active', label: 'Activa (visible en la web)', type: 'checkbox', value: category.is_active ?? true, full: true })}
    </div>`;
}

export function bindSlug(form, locked) {
    const source = form.querySelector('[data-slug-source]');
    const target = form.querySelector('[data-slug-target]');
    if (!source || !target) return;
    let touched = locked;
    target.addEventListener('input', () => { touched = true; });
    source.addEventListener('input', () => { if (!touched) target.value = slugify(source.value); });
}

async function openEditor(sb, category, onDone) {
    const saved = await formDialog({
        title: category ? 'Editar categoría' : 'Nueva categoría',
        body: categoryForm(category || {}),
        onMount: form => bindSlug(form, Boolean(category)),
        onSubmit: async data => {
            const payload = { ...data, sort_order: data.sort_order ?? 0 };
            const query = category
                ? sb.from('categories').update(payload).eq('id', category.id)
                : sb.from('categories').insert(payload);
            await run(query);
        }
    });
    if (saved) { toast(category ? 'Categoría actualizada.' : 'Categoría creada.'); onDone(); }
}

export async function render(ctx) {
    const { sb, main, isCurrent, reload } = ctx;
    const rows = await run(sb.from('categories').select('*, products(count)').order('sort_order').order('name'));
    if (!isCurrent()) return;

    main.innerHTML = `
        <header class="adm-page-head">
            <div><p class="adm-eyebrow">Catálogo</p><h1>Categorías</h1></div>
            <button type="button" class="adm-btn adm-btn--primary" id="newCategory">+ Nueva categoría</button>
        </header>
        <section class="adm-card">
            ${rows.length ? `
            <div class="adm-table-wrap">
                <table class="adm-table">
                    <thead><tr><th scope="col">Nombre</th><th scope="col">Tipo</th><th scope="col">Productos</th><th scope="col">Orden</th><th scope="col">Estado</th><th scope="col"><span class="adm-sr">Acciones</span></th></tr></thead>
                    <tbody>
                        ${rows.map(c => `<tr>
                            <td data-label="Nombre"><strong>${esc(c.name)}</strong><br><small class="adm-muted">/${esc(c.slug)}</small></td>
                            <td data-label="Tipo">${esc(LABELS.categoryKind[c.kind])}</td>
                            <td data-label="Productos">${c.products?.[0]?.count ?? 0}</td>
                            <td data-label="Orden">${c.sort_order}</td>
                            <td data-label="Estado">
                                <label class="adm-switch"><input type="checkbox" data-toggle="${c.id}" ${c.is_active ? 'checked' : ''}><span>${c.is_active ? 'Activa' : 'Inactiva'}</span></label>
                            </td>
                            <td class="adm-actions">
                                <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-edit="${c.id}">Editar</button>
                                <button type="button" class="adm-btn adm-btn--danger-ghost adm-btn--sm" data-delete="${c.id}">Eliminar</button>
                            </td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>` : emptyState('No hay categorías.')}
        </section>`;

    const byId = Object.fromEntries(rows.map(c => [c.id, c]));
    main.querySelector('#newCategory').addEventListener('click', () => openEditor(sb, null, reload));
    main.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditor(sb, byId[b.dataset.edit], reload)));

    main.querySelectorAll('[data-toggle]').forEach(input => input.addEventListener('change', async () => {
        const category = byId[input.dataset.toggle];
        if (!input.checked) {
            const ok = await confirmDialog({
                title: 'Desactivar categoría',
                message: `Todos los productos de "${category.name}" dejarán de mostrarse en la web.`,
                confirmLabel: 'Desactivar', danger: true
            });
            if (!ok) { input.checked = true; return; }
        }
        input.disabled = true;
        try {
            await run(sb.from('categories').update({ is_active: input.checked }).eq('id', category.id));
            toast(input.checked ? 'Categoría activada.' : 'Categoría desactivada.');
            reload();
        } catch (error) {
            input.checked = !input.checked;
            input.disabled = false;
            toast(friendlyError(error), 'error');
        }
    }));

    main.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', async () => {
        const category = byId[b.dataset.delete];
        const count = category.products?.[0]?.count ?? 0;
        if (count > 0) {
            toast(`No se puede eliminar: tiene ${count} producto(s). Muévelos o desactiva la categoría.`, 'error');
            return;
        }
        const ok = await confirmDialog({ title: 'Eliminar categoría', message: `¿Eliminar "${category.name}"? Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar', danger: true });
        if (!ok) return;
        try {
            await run(sb.from('categories').delete().eq('id', category.id));
            toast('Categoría eliminada.');
            reload();
        } catch (error) {
            toast(friendlyError(error), 'error');
        }
    }));
}
