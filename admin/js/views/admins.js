import { esc, run, fmtDateTime, emptyState, toast, friendlyError } from '../ui.js';

export async function render(ctx) {
    const { sb, main, profile, isCurrent, reload } = ctx;
    const admins = await run(sb.from('profiles').select('id, email, full_name, status, created_at, updated_at').eq('role', 'admin').order('email'));
    if (!isCurrent()) return;

    main.innerHTML = `
        <header class="adm-page-head">
            <div><p class="adm-eyebrow">Seguridad</p><h1>Administradores</h1></div>
        </header>

        <section class="adm-card">
            ${admins.length ? `<div class="adm-table-wrap"><table class="adm-table">
                <thead><tr><th scope="col">Correo</th><th scope="col">Nombre</th><th scope="col">Estado</th><th scope="col">Alta</th></tr></thead>
                <tbody>${admins.map(a => `<tr>
                    <td data-label="Correo"><strong>${esc(a.email || '—')}</strong>${a.id === profile.id ? ' <span class="adm-badge adm-badge--info">Tú</span>' : ''}</td>
                    <td data-label="Nombre">${esc(a.full_name || '—')}</td>
                    <td data-label="Estado">${a.status === 'active' ? '<span class="adm-badge adm-badge--ok">Activo</span>' : '<span class="adm-badge adm-badge--muted">Deshabilitado</span>'}</td>
                    <td data-label="Alta">${fmtDateTime(a.created_at)}</td>
                </tr>`).join('')}</tbody></table></div>` : emptyState('No hay administradores visibles.')}
        </section>

        <div class="adm-grid-2">
            <section class="adm-card">
                <div class="adm-card__head"><h2>Tu nombre visible</h2></div>
                <form id="profileForm" class="adm-form" novalidate>
                    <div class="adm-field">
                        <label for="profileName">Nombre</label>
                        <input id="profileName" name="full_name" maxlength="120" value="${esc(profile.full_name || '')}" autocomplete="name">
                    </div>
                    <button type="submit" class="adm-btn adm-btn--primary adm-btn--sm">Guardar</button>
                </form>
            </section>

            <section class="adm-card adm-card--info">
                <div class="adm-card__head"><h2>¿Cómo agregar un administrador?</h2></div>
                <p>Por seguridad, <strong>los roles no se pueden asignar desde el panel</strong> (ni siquiera por otro admin). Se hace en Supabase:</p>
                <ol class="adm-steps">
                    <li>Authentication → Users → <em>Add user</em> (correo + contraseña, "Auto Confirm").</li>
                    <li>Copiar el UUID del usuario.</li>
                    <li>SQL Editor → ejecutar <code>select * from private.set_admin_role('UUID', true);</code></li>
                </ol>
                <p class="adm-hint">Procedimiento completo en <code>supabase/sql/asignar_primer_admin.sql</code>. Para quitar acceso usa <code>false</code>.</p>
            </section>
        </div>`;

    main.querySelector('#profileForm').addEventListener('submit', async event => {
        event.preventDefault();
        const value = event.currentTarget.full_name.value.trim() || null;
        try {
            await run(sb.from('profiles').update({ full_name: value }).eq('id', profile.id));
            profile.full_name = value;
            toast('Nombre actualizado.');
            reload();
        } catch (error) {
            toast(friendlyError(error), 'error');
        }
    });
}
