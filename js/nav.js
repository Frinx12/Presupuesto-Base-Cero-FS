// js/nav.js
import { signOut } from './auth.js';

export function mountTopNav({ active = '', title = 'PBZ-FS' } = {}) {
  const header = document.querySelector('header') || document.createElement('header');
  header.className = 'header';
  header.innerHTML = `
    <div class="brand">
      <div class="logo">₿pz</div>
      <span class="brand__name">${title}</span>
    </div>
    <nav class="mainnav" aria-label="Navegación principal">
      ${link('inicio.html', 'home', 'Inicio / Dashboard', active === 'inicio')}
      ${link('salario.html', 'payments', 'Análisis de salario', active === 'salario')}
      ${link('presupuesto.html', 'table', 'Presupuesto', active === 'presupuesto')}
      ${link('control.html', 'list_alt', 'Control mensual', active === 'control')}
      ${link('ahorros.html', 'savings', 'Ahorros y provisiones', active === 'ahorros')}
      ${link('prestamos.html', 'account_balance', 'Préstamos', active === 'prestamos')}
      ${link('pagos.html', 'event', 'Pagos mensuales', active === 'pagos')}
      ${link('config.html', 'settings', 'Configuraciones', active === 'config')}
    </nav>
    <div class="header__spacer"></div>
    <button id="theme-toggle" class="btn-icon" aria-label="Cambiar tema">
      <span class="material-symbols-rounded">dark_mode</span>
    </button>
    <div class="avatar">
      <button id="logout-btn" class="btn-icon" title="Cerrar sesión">
        <span class="material-symbols-rounded">logout</span>
      </button>
    </div>
  `;
  if (!header.isConnected) document.body.prepend(header);

  const root = document.documentElement;
  const savedTheme = localStorage.getItem('bpz_theme');
  if (savedTheme) root.dataset.theme = savedTheme;
  header.querySelector('#theme-toggle').addEventListener('click', () => {
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.dataset.theme = next; localStorage.setItem('bpz_theme', next);
  });

  header.querySelector('#logout-btn').addEventListener('click', signOut);
}
function link(href, icon, label, active) {
  return `<a class="mainnav__link ${active ? 'is-active' : ''}" href="${href}">
    <span class="material-symbols-rounded" aria-hidden="true">${icon}</span><span>${label}</span></a>`;
}
