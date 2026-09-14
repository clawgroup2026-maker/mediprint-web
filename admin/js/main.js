/* ========================================
   MEDIPRINT ADMIN · Arranque, sesión y rutas
   ----------------------------------------
   Protección en dos capas:
     1. Aquí: sin sesión → login; sin rol admin activo → acceso denegado.
     2. En la base de datos: RLS con private.is_admin(). Aunque alguien
        manipule este JS, no puede leer ni escribir datos administrativos.
   ======================================== */

import { sb, isConfigured } from './supabase.js';
import { esc, toast, friendlyError, errorState, loadingState, initAccessibleValidation } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as products from './views/products.js';
import * as productEdit from './views/product-edit.js';
import * as categories from './views/categories.js';
import * as quotes from './views/quotes.js';
import * as orders from './views/orders.js';
import * as customers from './views/customers.js';
import * as inventory from './views/inventory.js';
import * as admins from './views/admins.js';

const app = document.getElementById('admApp');
let profile = null;
let renderToken = 0;

const NAV = [
    { hash: '#/panel', label: 'Resumen', icon: 'M3 12l9-8 9 8M5 10v10h14V10' },
    { hash: '#/cotizaciones', label: 'Cotizaciones', icon: 'M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6' },
    { hash: '#/pedidos', label: 'Pedidos', icon: 'M4 7h16l-1.5 12h-13zM9 7V5a3 3 0 016 0v2' },
    { hash: '#/clientes', label: 'Clientes', icon: 'M16 19v-1a4 4 0 00-8 0v1M12 11a3 3 0 100-6 3 3 0 000 6z' },
    { hash: '#/productos', label: 'Catálogo / Productos', icon: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8' },
    { hash: '#/categorias', label: 'Categorías', icon: 'M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z' },
    { hash: '#/inventario', label: 'Inventario', icon: 'M3 7h18M5 7v12h14V7M9 11h6' },
    { hash: '#/administradores', label: 'Administradores', icon: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z' }
];

const ROUTES = [
    { pattern: /^#\/panel$/, view: dashboard },
    { pattern: /^#\/productos$/, view: products },
    { pattern: /^#\/productos\/(nuevo|[0-9a-f-]{36})$/, view: productEdit },
    { pattern: /^#\/categorias$/, view: categories },
    { pattern: /^#\/cotizaciones$/, view: quotes },
    { pattern: /^#\/cotizaciones\/([0-9a-f-]{36})$/, view: quotes, detail: true },
    { pattern: /^#\/pedidos$/, view: orders },
    { pattern: /^#\/pedidos\/([0-9a-f-]{36})$/, view: orders, detail: true },
    { pattern: /^#\/clientes$/, view: customers },
    { pattern: /^#\/clientes\/([0-9a-f-]{36})$/, view: customers, detail: true },
    { pattern: /^#\/inventario$/, view: inventory },
    { pattern: /^#\/administradores$/, view: admins }
];

/* ---------------- Pantallas sin sesión ---------------- */

function renderNotConfigured() {
    app.removeAttribute('aria-busy');
    app.innerHTML = `
        <main class="adm-auth">
            <section class="adm-auth__card">
                <img src="../images/mediprint-logo.png" alt="MediPrint" class="adm-auth__logo">
                <h1>Panel no configurado</h1>
                <p>Falta la URL y la clave pública de Supabase en <code>js/supabase-config.js</code>.</p>
            </section>
        </main>`;
}

function renderLogin(message = '') {
    profile = null;
    app.removeAttribute('aria-busy');
    app.innerHTML = `
        <main class="adm-auth">
            <section class="adm-auth__card" aria-labelledby="loginTitle">
                <img src="../images/mediprint-logo.png" alt="MediPrint" class="adm-auth__logo">
                <h1 id="loginTitle">Panel de administración</h1>
                <p class="adm-muted">Ingresa con tu cuenta de administrador.</p>
                <div class="adm-form__error" role="alert" ${message ? '' : 'hidden'}>${esc(message)}</div>
                <form id="loginForm" class="adm-form" novalidate>
                    <div class="adm-field adm-field--full">
                        <label for="loginEmail">Correo electrónico</label>
                        <input id="loginEmail" name="email" type="email" autocomplete="username" required aria-errormessage="loginEmailError">
                        <small id="loginEmailError" class="adm-error-msg">Ingresa un correo válido.</small>
                    </div>
                    <div class="adm-field adm-field--full">
                        <label for="loginPassword">Contraseña</label>
                        <input id="loginPassword" name="password" type="password" autocomplete="current-password" required minlength="6" aria-errormessage="loginPasswordError">
                        <small id="loginPasswordError" class="adm-error-msg">Ingresa tu contraseña.</small>
                    </div>
                    <button type="submit" class="adm-btn adm-btn--primary adm-btn--block">Ingresar</button>
                </form>
                <a href="../index.html" class="adm-link-back">← Volver al sitio</a>
            </section>
        </main>`;

    const form = document.getElementById('loginForm');
    const errorBox = app.querySelector('.adm-form__error');
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const button = form.querySelector('button');
        button.disabled = true;
        button.textContent = 'Ingresando…';
        errorBox.hidden = true;
        const { error } = await sb.auth.signInWithPassword({
            email: form.email.value.trim(),
            password: form.password.value
        });
        if (error) {
            // Mensaje genérico: no revela si el correo existe
            errorBox.textContent = /Invalid login credentials/i.test(error.message)
                ? 'Correo o contraseña incorrectos.'
                : friendlyError(error);
            errorBox.hidden = false;
            button.disabled = false;
            button.textContent = 'Ingresar';
            form.password.value = '';
            form.password.focus();
            return;
        }
        await boot();
    });
    document.getElementById('loginEmail').focus();
}

function renderDenied(email) {
    app.removeAttribute('aria-busy');
    app.innerHTML = `
        <main class="adm-auth">
            <section class="adm-auth__card" aria-labelledby="deniedTitle">
                <img src="../images/mediprint-logo.png" alt="MediPrint" class="adm-auth__logo">
                <h1 id="deniedTitle">Acceso denegado</h1>
                <p>La cuenta <strong>${esc(email || '')}</strong> no tiene permisos de administrador activos.</p>
                <p class="adm-muted">Si necesitas acceso, solicita a un administrador que lo habilite.</p>
                <button type="button" id="deniedLogout" class="adm-btn adm-btn--primary adm-btn--block">Cerrar sesión</button>
                <a href="../index.html" class="adm-link-back">← Volver al sitio</a>
            </section>
        </main>`;
    document.getElementById('deniedLogout').addEventListener('click', () => sb.auth.signOut());
}

/* ---------------- Layout autenticado ---------------- */

function renderLayout() {
    app.removeAttribute('aria-busy');
    app.innerHTML = `
        <a class="adm-skip" href="#admMain">Saltar al contenido</a>
        <header class="adm-topbar">
            <button type="button" class="adm-icon-btn adm-menu-btn" id="admMenuBtn" aria-controls="admSidebar" aria-expanded="false" aria-label="Abrir menú">
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
            <a href="#/panel" class="adm-topbar__brand"><img src="../images/mediprint-logo.png" alt="MediPrint"><span>Admin</span></a>
        </header>
        <div class="adm-shell">
            <aside class="adm-sidebar" id="admSidebar">
                <a href="#/panel" class="adm-sidebar__brand"><img src="../images/mediprint-logo.png" alt="MediPrint"><span>Panel</span></a>
                <nav aria-label="Secciones del panel">
                    <ul>
                        ${NAV.map(item => `
                            <li><a href="${item.hash}" data-nav="${item.hash}">
                                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="${item.icon}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                                <span>${item.label}</span>
                            </a></li>`).join('')}
                    </ul>
                </nav>
                <div class="adm-sidebar__user">
                    <span class="adm-sidebar__email" title="${esc(profile.email)}">${esc(profile.full_name || profile.email)}</span>
                    <a href="../index.html" target="_blank" rel="noopener" class="adm-sidebar__site">Ver sitio ↗</a>
                    <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="admLogout">Cerrar sesión</button>
                </div>
            </aside>
            <div class="adm-backdrop" id="admBackdrop" hidden></div>
            <main class="adm-main" id="admMain" tabindex="-1"></main>
        </div>`;

    const menuBtn = document.getElementById('admMenuBtn');
    const sidebar = document.getElementById('admSidebar');
    const backdrop = document.getElementById('admBackdrop');
    const setMenu = open => {
        sidebar.classList.toggle('is-open', open);
        backdrop.hidden = !open;
        menuBtn.setAttribute('aria-expanded', String(open));
        menuBtn.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    };
    menuBtn.addEventListener('click', () => setMenu(!sidebar.classList.contains('is-open')));
    backdrop.addEventListener('click', () => setMenu(false));
    sidebar.addEventListener('click', event => { if (event.target.closest('a[data-nav]')) setMenu(false); });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && sidebar.classList.contains('is-open')) { setMenu(false); menuBtn.focus(); }
    });
    document.getElementById('admLogout').addEventListener('click', async () => {
        await sb.auth.signOut();
    });
}

async function route() {
    const main = document.getElementById('admMain');
    if (!main || !profile) return;
    const hash = location.hash || '#/panel';
    const match = ROUTES.map(r => ({ r, m: hash.match(r.pattern) })).find(x => x.m);

    document.querySelectorAll('[data-nav]').forEach(link => {
        const active = hash === link.dataset.nav || hash.startsWith(`${link.dataset.nav}/`);
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });

    if (!match) {
        location.replace('#/panel');
        return;
    }

    const token = ++renderToken;
    main.innerHTML = loadingState();
    const ctx = {
        sb,
        main,
        profile,
        param: match.m[1],
        isCurrent: () => token === renderToken,
        navigate: target => { location.hash = target; },
        reload: () => route()
    };
    try {
        const render = match.r.detail ? match.r.view.renderDetail : match.r.view.render;
        await render(ctx);
        if (token === renderToken) main.focus({ preventScroll: true });
    } catch (error) {
        console.error(error);
        if (token !== renderToken) return;
        if (error?.code === 'PGRST301' || /JWT/i.test(error?.message || '')) {
            await sb.auth.signOut();
            return;
        }
        main.innerHTML = errorState(error, 'admRetry');
        document.getElementById('admRetry')?.addEventListener('click', route);
    }
}

/* ---------------- Sesión ---------------- */

async function boot() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return renderLogin();

    // Verificación del rol contra la base de datos (no contra el token local)
    const { data, error } = await sb
        .from('profiles')
        .select('id, email, full_name, role, status')
        .eq('id', session.user.id)
        .maybeSingle();

    if (error) {
        if (/JWT|expired/i.test(error.message)) { await sb.auth.signOut(); return; }
        return renderLogin(friendlyError(error));
    }
    if (!data || data.role !== 'admin' || data.status !== 'active') {
        profile = null;
        return renderDenied(session.user.email);
    }

    const firstRender = !profile;
    profile = data;
    if (firstRender || !document.getElementById('admMain')) renderLayout();
    if (!location.hash) history.replaceState(null, '', '#/panel');
    await route();
}

if (!isConfigured) {
    renderNotConfigured();
} else {
    initAccessibleValidation();
    window.addEventListener('hashchange', route);
    sb.auth.onAuthStateChange(event => {
        if (event === 'SIGNED_OUT') {
            renderLogin();
            toast('Sesión cerrada.');
        }
    });
    boot().catch(error => {
        console.error(error);
        renderLogin(friendlyError(error));
    });
}
