// js/ui.js
// ===================== TOASTS =====================
export const toast = {
  success: (m) => show(m, 'success'),
  error: (m) => show(m, 'error'),
  info: (m) => show(m, 'info'),
};

function show(msg, type = 'info') {
  const wrap = document.getElementById('toasts') || (() => {
    const el = document.createElement('div');
    el.id = 'toasts';
    el.className = 'toasts';
    // estilos mínimos por si falta components.css
    el.style.position = 'fixed';
    el.style.right = '12px';
    el.style.bottom = '12px';
    el.style.display = 'grid';
    el.style.gap = '8px';
    el.style.zIndex = '9999';
    document.body.appendChild(el);
    return el;
  })();

  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  t.style.background = 'var(--card, #1e1e1e)';
  t.style.color = 'var(--fg, #fff)';
  t.style.border = '1px solid var(--border, #333)';
  t.style.padding = '10px 12px';
  t.style.borderRadius = '10px';
  t.style.boxShadow = '0 6px 20px rgba(0,0,0,.25)';
  t.style.maxWidth = 'min(360px, 92vw)';

  if (type === 'error') t.style.borderColor = 'var(--danger, #e5484d)';
  if (type === 'success') t.style.borderColor = 'var(--success, #22c55e)';

  wrap.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity .2s';
    setTimeout(() => t.remove(), 180);
  }, 3500);
}

// ===================== MODALES =====================
/**
 * Abre un modal accesible.
 * @param {{id?:string,title?:string,content?:string|Node,closable?:boolean}} opts
 * @returns {HTMLElement} el nodo del modal (backdrop)
 */
export function openModal(opts = {}) {
  const { id = `m-${Date.now()}`, title = '', content = '', closable = true } = opts;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.dataset.modalId = id;
  backdrop.style.position = 'fixed';
  backdrop.style.inset = '0';
  backdrop.style.background = 'rgba(0,0,0,.45)';
  backdrop.style.display = 'grid';
  backdrop.style.placeItems = 'center';
  backdrop.style.zIndex = '10000';

  const dialog = document.createElement('div');
  dialog.className = 'modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.style.background = 'var(--card, #1e1e1e)';
  dialog.style.color = 'var(--fg, #fff)';
  dialog.style.border = '1px solid var(--border, #333)';
  dialog.style.borderRadius = '14px';
  dialog.style.width = 'min(560px, 92vw)';
  dialog.style.maxHeight = '86vh';
  dialog.style.overflow = 'auto';
  dialog.style.boxShadow = '0 12px 40px rgba(0,0,0,.35)';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.gap = '.75rem';
  header.style.padding = '12px 14px';
  header.style.borderBottom = '1px solid var(--border, #333)';

  const h = document.createElement('h2');
  h.id = `${id}-title`;
  h.textContent = title || 'Mensaje';
  h.style.fontSize = '1rem';
  h.style.margin = '0';

  header.appendChild(h);

  if (closable) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'btn-icon';
    x.setAttribute('aria-label', 'Cerrar');
    x.textContent = '✕';
    x.style.background = 'transparent';
    x.style.border = '0';
    x.style.color = 'inherit';
    x.style.fontSize = '1.1rem';
    x.addEventListener('click', () => closeModal(backdrop));
    header.appendChild(x);
  }

  const body = document.createElement('div');
  body.className = 'modal-body';
  body.style.padding = '14px';

  if (typeof content === 'string') {
    body.innerHTML = content;
  } else if (content instanceof Node) {
    body.appendChild(content);
  }

  dialog.appendChild(header);
  dialog.appendChild(body);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  // Cerrar con click fuera
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && closable) closeModal(backdrop);
  });

  // ESC para cerrar
  const onKey = (e) => {
    if (e.key === 'Escape' && closable) {
      e.preventDefault();
      closeModal(backdrop);
    }
  };
  document.addEventListener('keydown', onKey);

  // focus trap mínimo
  const focusable = dialog.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
  const first = focusable[0] ?? dialog;
  const last = focusable[focusable.length - 1] ?? dialog;
  first.focus();
  const trap = (e) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };
  dialog.addEventListener('keydown', trap);

  // Guardar limpiadores para closeModal
  backdrop._cleanup = () => {
    document.removeEventListener('keydown', onKey);
    dialog.removeEventListener('keydown', trap);
  };

  return backdrop;
}

/**
 * Cierra y elimina un modal abierto.
 * @param {HTMLElement} modalBackdrop
 */
export function closeModal(modalBackdrop) {
  if (!modalBackdrop) return;
  try { modalBackdrop._cleanup?.(); } catch { }
  modalBackdrop.remove();
}
