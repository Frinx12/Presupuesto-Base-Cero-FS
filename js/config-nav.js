// ===============================
// PBZ-FS — Config: navegación lateral
// Archivo: js/config-nav.js
// ===============================

const STORAGE_KEY = 'bpz_config_section';

const links = Array.from(document.querySelectorAll('.sidelink'));
const panels = {
  usuarios: document.getElementById('panel-usuarios'),
  moneda: document.getElementById('panel-moneda'),
  gastos: document.getElementById('panel-gastos'),
  finalizar: document.getElementById('panel-finalizar'),
};

function setActive(section) {
  // Oculta todos los paneles
  Object.values(panels).forEach(p => p && (p.hidden = true));
  // Quita activo de links
  links.forEach(a => {
    a.classList.remove('is-active');
    a.removeAttribute('aria-current');
  });
  // Muestra el actual
  const panel = panels[section] || panels.usuarios;
  if (panel) panel.hidden = false;

  // Marca link activo
  const link = links.find(a => a.dataset.section === section);
  if (link) {
    link.classList.add('is-active');
    link.setAttribute('aria-current', 'page');
    link.focus({ preventScroll: true });
  }

  // Guarda estado y hash
  localStorage.setItem(STORAGE_KEY, section);
  if (location.hash.replace('#','') !== section) {
    history.replaceState(null, '', `#${section}`);
  }
}

function initFromHashOrStorage() {
  const fromHash = location.hash?.replace('#', '');
  const fromStore = localStorage.getItem(STORAGE_KEY);
  const initial = ['usuarios','moneda','gastos','finalizar'].includes(fromHash) ? fromHash :
                  (['usuarios','moneda','gastos','finalizar'].includes(fromStore) ? fromStore : 'usuarios');
  setActive(initial);
}

links.forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const section = a.dataset.section;
    setActive(section);
  });
});

// Teclado (arriba/abajo/enter)
document.querySelector('.sidelist')?.addEventListener('keydown', (e) => {
  const currentIndex = links.findIndex(a => a.classList.contains('is-active'));
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const next = links[(currentIndex + 1) % links.length];
    next?.focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prev = links[(currentIndex - 1 + links.length) % links.length];
    prev?.focus();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const focused = document.activeElement;
    if (focused?.classList.contains('sidelink')) {
      setActive(focused.dataset.section);
    }
  }
});

// Cambios del hash (si navegan con el historial)
window.addEventListener('hashchange', () => {
  const section = location.hash.replace('#','');
  if (['usuarios','moneda','gastos','finalizar'].includes(section)) {
    setActive(section);
  }
});

// Inicializa
initFromHashOrStorage();
