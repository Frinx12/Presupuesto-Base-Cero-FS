// ===============================
// PBZ-FS — Navegación lateral genérica (todas las páginas con sidebar)
// Detecta enlaces .sidelink[data-section] y paneles section.panel[data-section]
// - Guarda última sección en localStorage por página (usa location.pathname)
// - Soporta hash (#seccion)
// - Accesible con teclado (↑/↓/Enter/Espacio)
// ===============================

const KEY = `bpz_section:${location.pathname}`;

const links = Array.from(document.querySelectorAll('.sidelink[data-section]'));
const panels = Array.from(document.querySelectorAll('section.panel[data-section]'))
    .reduce((acc, el) => (acc[el.dataset.section] = el, acc), {});

function setActive(section) {
    // Oculta paneles
    Object.values(panels).forEach(p => p.hidden = true);
    // Links
    links.forEach(a => {
        a.classList.remove('is-active');
        a.removeAttribute('aria-current');
    });
    // Panel + link
    const panel = panels[section] || panels[links[0]?.dataset.section];
    const link = links.find(a => a.dataset.section === section) || links[0];
    if (panel) panel.hidden = false;
    if (link) {
        link.classList.add('is-active');
        link.setAttribute('aria-current', 'page');
    }
    // Persistir y hash limpio
    localStorage.setItem(KEY, section);
    if (location.hash.replace('#', '') !== section) {
        history.replaceState(null, '', `#${section}`);
    }
}

function initialSection() {
    const fromHash = location.hash?.replace('#', '');
    const fromStore = localStorage.getItem(KEY);
    const valid = s => s && panels[s];
    return valid(fromHash) ? fromHash : (valid(fromStore) ? fromStore : links[0]?.dataset.section);
}

links.forEach(a => {
    a.addEventListener('click', (e) => {
        e.preventDefault();
        setActive(a.dataset.section);
    });
});

// Teclado en la lista
document.querySelector('.sidelist')?.addEventListener('keydown', (e) => {
    const idx = links.findIndex(a => a.classList.contains('is-active'));
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        (links[(idx + 1) % links.length])?.focus();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        (links[(idx - 1 + links.length) % links.length])?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const el = document.activeElement;
        if (el?.classList.contains('sidelink')) setActive(el.dataset.section);
    }
});

window.addEventListener('hashchange', () => {
    const section = location.hash.replace('#', '');
    if (panels[section]) setActive(section);
});

// Init
const start = initialSection();
if (start) setActive(start);
