// /js/topbar.js
// Topbar unificado PBZ-FS (tema, menú usuario, nav activo, badge de período + hamburguesa)

import { getCurrentPeriod } from './period.js';

export function mountTopbar({ active = '', title = '' } = {}) {
  const host = document.getElementById('topbar') || document.querySelector('.header');
  if (!host) return;

  host.innerHTML = `
    <div class="brand">
      <!-- Logo monograma F + S -->
      <div class="logo-fs" aria-label="PBZ-FS">
        <span class="logo-fs__letter logo-fs__f">F</span>
        <span class="logo-fs__letter logo-fs__s">S</span>
      </div>
      <span class="brand__name">PBZ-FS</span>
    </div>

    <!-- Botón hamburguesa (solo visible en mobile) -->
    <button class="btn-icon nav-toggle" id="nav-toggle"
      aria-label="Abrir menú principal"
      aria-expanded="false"
      aria-controls="mainnav">
      <span class="material-symbols-rounded">menu</span>
    </button>

    <nav class="mainnav" id="mainnav" aria-label="Navegación principal">
      ${nav('inicio.html', 'home', 'Inicio')}
      ${nav('salario.html', 'payments', 'Análisis de salario')}
      ${nav('presupuesto.html', 'table', 'Presupuesto')}
      ${nav('control.html', 'list_alt', 'Control mensual')}
      ${nav('ahorros.html', 'savings', 'Ahorros y provisiones')}
      ${nav('prestamos.html', 'account_balance', 'Préstamos')}
      ${nav('pagos.html', 'event', 'Pagos mensuales')}
      ${nav('config.html', 'settings', 'Configuraciones')}
    </nav>

    <div class="header__spacer"></div>

    <div class="topbar__right">
      <span class="pill" title="Período activo">
        <span class="material-symbols-rounded" aria-hidden="true">calendar_month</span>
        <b id="period-badge">—</b>
      </span>

      <button id="theme-toggle" class="btn-icon" aria-label="Cambiar tema">
        <span class="material-symbols-rounded">dark_mode</span>
      </button>

      <div class="avatar">
        <button id="user-menu-btn" class="avatar__btn" aria-haspopup="menu" aria-expanded="false" type="button">
          <span class="material-symbols-rounded" aria-hidden="true">account_circle</span>
          <span class="avatar__name" id="avatar-name">Usuario</span>
          <span class="material-symbols-rounded avatar__caret" aria-hidden="true">expand_more</span>
        </button>
        <div id="user-menu" class="menu" role="menu" aria-label="Menú de usuario">
          <a role="menuitem" href="config.html">
            <span class="material-symbols-rounded" aria-hidden="true">settings</span>
            <span>Configuraciones</span>
          </a>
          <div class="sep" aria-hidden="true"></div>
          <button role="menuitem" id="logout-btn" type="button">
            <span class="material-symbols-rounded" aria-hidden="true">logout</span>
            <span>Cerrar sesión</span>
          </button>
        </div>
      </div>
    </div>
  `;

  /* ========== Nav activo ========== */
  host.querySelectorAll('.mainnav a').forEach(a => {
    const href = a.getAttribute('href');
    if (active && href.includes(active)) a.classList.add('is-active');
    else if (location.pathname.endsWith(href)) a.classList.add('is-active');
  });

  /* ========== Tema persistente ========== */
  const saved = localStorage.getItem('bpz_theme');
  if (saved) document.documentElement.dataset.theme = saved;
  host.querySelector('#theme-toggle')?.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    localStorage.setItem('bpz_theme', next);
  });

  /* ========== Menú usuario ========== */
  const btnUser = host.querySelector('#user-menu-btn');
  const menuUser = host.querySelector('#user-menu');

  const closeUserMenu = () => {
    if (!menuUser) return;
    menuUser.classList.remove('is-open');
    btnUser?.setAttribute('aria-expanded', 'false');
  };

  btnUser?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menuUser.classList.toggle('is-open');
    btnUser.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  document.addEventListener('click', (e) => {
    if (!host.contains(e.target)) {
      closeUserMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeUserMenu();
    }
  });

  // Logout robusto
  host.querySelector('#logout-btn')?.addEventListener('click', async () => {
    try {
      const { signOut } = await import('./auth.js');
      await signOut();
    } catch (err) {
      console.error(err);
      location.href = 'login.html';
    }
  });

  /* ========== Menú hamburguesa ========== */
  const navEl = host.querySelector('#mainnav');
  const navToggle = host.querySelector('#nav-toggle');

  const closeNav = () => {
    if (!navEl || !navToggle) return;
    navEl.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
  };

  navToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!navEl) return;
    const isOpen = navEl.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  document.addEventListener('click', (e) => {
    if (!host.contains(e.target)) {
      closeNav();
    }
  });

  window.addEventListener('resize', () => {
    // Si volvemos a escritorio, nos aseguramos de que el nav no quede "cerrado"
    if (window.innerWidth >= 768) {
      navEl?.classList.remove('is-open');
      navToggle?.setAttribute('aria-expanded', 'false');
    }
  });

  /* ========== Badge de período ========== */
  const badge = host.querySelector('#period-badge');
  const setBadge = (p) => {
    if (!badge || !p) return;
    badge.textContent = `${monthLabel(p.mes)} ${p.anio}`;
  };

  try {
    setBadge(getCurrentPeriod());
  } catch (_) { /* ignora si aún no existe */ }

  window.addEventListener('bpz:period-changed', (e) => {
    const { anio, mes } = e.detail || {};
    if (anio && mes) setBadge({ anio, mes });
  });
  // alias legado
  window.addEventListener('bpz:month-changed', (e) => {
    const { year, month } = e.detail || {};
    if (year && month) setBadge({ anio: year, mes: month });
  });

  /* ========== Título opcional ========== */
  if (title) document.title = title;

  /* ========== Nombre de usuario (event bus) ========== */
  window.addEventListener('bpz:user', (e) => {
    const name = e.detail?.name;
    if (name) {
      const el = host.querySelector('#avatar-name');
      if (el) el.textContent = name;
    }
  });
}

function nav(href, icon, label) {
  return `<a class="mainnav__link" href="${href}" title="${label}">
    <span class="material-symbols-rounded" aria-hidden="true">${icon}</span>
    <span class="mainnav__label">${label}</span>
  </a>`;
}

function monthLabel(m) {
  const L = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return L[(m - 1 + 12) % 12] || '—';
}
