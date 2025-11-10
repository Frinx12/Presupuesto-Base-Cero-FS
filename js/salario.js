// js/salario.js
import { requireAuth } from './auth.js';
import { sb } from './supabase.js';
import { toast } from './ui.js';
import { formatCurrencyDynamic, getCurrency, monthName } from './utils.js';
import { getCurrentPeriod } from './period.js';

let session = null;
let currency = getCurrency() || 'USD';

function safePeriod() {
  // Acepta {anio,mes} o {year,month} y cae a hoy si falta algo
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth() + 1;
  try {
    const p = (typeof getCurrentPeriod === 'function' ? getCurrentPeriod() : null) || {};
    y = Number.isInteger(p.anio ?? p.year) ? (p.anio ?? p.year) : y;
    m = Number.isInteger(p.mes ?? p.month) ? (p.mes ?? p.month) : m;
  } catch { }
  return { anio: y, mes: m };
}
let period = safePeriod();

const els = {
  usersGrid: document.getElementById('users-grid'),
  periodLabel: document.getElementById('period-label'),
  summary: document.getElementById('summary-container'),
};
function setTextSafe(el, text) { if (el) el.textContent = text; }

const monthText = (m) => monthName(m);
const periodText = (p) => `${monthText(p.mes)} ${p.anio}`;
const money = (n) => formatCurrencyDynamic(Number(n || 0), currency);

const modToSections = (mod) => {
  const m = String(mod || '').toLowerCase();
  if (m === 'semanal') return 4;
  if (m === 'catorcenal' || m === 'quincenal') return 2;
  return 1;
};
const sectionLabel = (mod, idx) => {
  const m = String(mod || '').toLowerCase();
  if (m === 'semanal') return `Semana ${idx}`;
  if (m === 'catorcenal' || m === 'quincenal') return `Pago ${idx}`;
  return 'Pago mensual';
};

/* Data */
async function fetchUsers() {
  const { data, error } = await sb
    .from('usuarios_presupuesto')
    .select('id, nombre, modalidad, modalidad_otro, tipo_pago, is_archived')
    .eq('is_archived', false)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}
async function fetchSalarios(usuarioIds) {
  if (!usuarioIds?.length) return [];
  const { data, error } = await sb
    .from('salarios')
    .select('id, usuario_id, anio, mes, seccion, ingreso_bruto')
    .eq('anio', period.anio)
    .eq('mes', period.mes)
    .in('usuario_id', usuarioIds);

  if (error) throw error;
  return data || [];
}
async function fetchDeduccionesBySalarios(salarioIds) {
  if (!salarioIds?.length) return [];
  const { data, error } = await sb
    .from('salarios_deducciones')
    .select('id, salario_id, nombre, monto')
    .in('salario_id', salarioIds)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/* Render resumen (panel Resumen) */
function renderSummary(users, salarios, deducs) {
  const container = els.summary;
  if (!container) return;

  // Sin usuarios configurados
  if (!users.length) {
    container.innerHTML = `
      <p class="muted">
        Configura o ajusta tus <strong>Usuarios del presupuesto</strong> en
        <a class="link" href="config.html">Configuración</a> para habilitar los cálculos por persona.
      </p>
      <a class="btn btn--ghost btn-small" href="config.html" title="Editar usuarios en Configuración">
        <span class="material-symbols-rounded" aria-hidden="true">settings</span>
        Usuarios en Configuración
      </a>
    `;
    return;
  }

  // Mapear salarios por usuario
  const resumenPorUsuario = new Map(); // userId -> { bruto, deds }

  salarios.forEach(s => {
    const current = resumenPorUsuario.get(s.usuario_id) || { bruto: 0, deds: 0 };
    current.bruto += Number(s.ingreso_bruto || 0);
    resumenPorUsuario.set(s.usuario_id, current);
  });

  const salById = new Map();
  salarios.forEach(s => salById.set(s.id, s));

  // Sumar deducciones por usuario
  deducs.forEach(d => {
    const sal = salById.get(d.salario_id);
    if (!sal) return;
    const current = resumenPorUsuario.get(sal.usuario_id) || { bruto: 0, deds: 0 };
    current.deds += Number(d.monto || 0);
    resumenPorUsuario.set(sal.usuario_id, current);
  });

  const cardsHtml = users.map(u => {
    const entry = resumenPorUsuario.get(u.id) || { bruto: 0, deds: 0 };
    const bruto = entry.bruto;
    const neto = bruto - entry.deds;

    return `
      <section class="card">
        <header class="card__header">
          <strong>${u.nombre}</strong>
        </header>
        <div class="card__body">
          <div class="row">
            <span class="muted">Salario bruto mensual:</span>
            <span class="money">${money(bruto)}</span>
          </div>
          <div class="row">
            <span class="muted">Salario neto mensual:</span>
            <span class="money">${money(neto)}</span>
          </div>
        </div>
      </section>
    `;
  }).join('');

  container.innerHTML = `
    <div class="summary-grid">
      ${cardsHtml}
    </div>
  `;
}

/* Render detalle por usuario (panel Por usuario) */
function renderUsersSkeleton() {
  if (!els.usersGrid) return;
  els.usersGrid.innerHTML = `
    <section class="card"><header class="card__header"><strong>Cargando…</strong></header><div class="card__body"><div class="skeleton"></div></div></section>
    <section class="card"><header class="card__header"><strong>Cargando…</strong></header><div class="card__body"><div class="skeleton"></div></div></section>
  `;
}
function renderAll(users, salarios, deducs) {
  if (!els.usersGrid) return;

  if (!users.length) {
    els.usersGrid.innerHTML = `
      <section class="card">
        <header class="card__header"><strong>Usuarios</strong></header>
        <div class="card__body">
          <p class="muted">No hay usuarios del presupuesto. Configúralos en <a href="config.html">Configuración</a>.</p>
        </div>
      </section>
    `;
    return;
  }

  const salMap = new Map();
  salarios.forEach(s => salMap.set(`${s.usuario_id}:${s.seccion}`, s));

  const dedBySalId = new Map();
  deducs.forEach(d => {
    if (!dedBySalId.has(d.salario_id)) dedBySalId.set(d.salario_id, []);
    dedBySalId.get(d.salario_id).push(d);
  });

  els.usersGrid.innerHTML = users.map(u => {
    const sections = modToSections(u.modalidad);
    let totalNeto = 0;

    const sectionsHtml = Array.from({ length: sections }, (_, i) => {
      const idx = i + 1;
      const key = `${u.id}:${idx}`;
      const s = salMap.get(key) || null;
      const bruto = Number(s?.ingreso_bruto || 0);
      const deds = s ? (dedBySalId.get(s.id) || []) : [];
      const subtotalD = deds.reduce((acc, d) => acc + Number(d.monto || 0), 0);
      const neto = bruto - subtotalD;
      totalNeto += neto;

      const dedsHtml = deds.length
        ? deds.map(d => `
            <div class="row" data-ded-id="${d.id}">
              <div>${d.nombre}</div>
              <div class="money">${money(d.monto)}</div>
              <div class="right">
                <button class="btn-icon" data-action="edit-ded" data-sal-id="${s?.id || ''}" data-ded-id="${d.id}" title="Editar deducción" aria-label="Editar deducción"><span class="material-symbols-rounded">edit</span></button>
                <button class="btn-icon" data-action="del-ded" data-sal-id="${s?.id || ''}" data-ded-id="${d.id}" title="Eliminar deducción" aria-label="Eliminar deducción"><span class="material-symbols-rounded">delete</span></button>
              </div>
            </div>
          `).join('')
        : `<p class="muted">Sin deducciones.</p>`;

      return `
        <div class="section" data-usuario="${u.id}" data-seccion="${idx}">
          <div class="section__header">
            <strong>${sectionLabel(u.modalidad, idx)}</strong>
            <div class="right">
              <span class="muted">Bruto:</span> <b class="money">${money(bruto)}</b>
              <button class="btn btn--ghost btn-small" data-action="edit-bruto" data-usuario="${u.id}" data-seccion="${idx}" data-sal-id="${s?.id || ''}">
                <span class="material-symbols-rounded" aria-hidden="true">payments</span> Editar bruto
              </button>
            </div>
          </div>
          <div>
            <div class="list-compact">${dedsHtml}</div>
            <div class="actions" style="margin-top:.5rem">
              <button class="btn btn--ghost btn-small" data-action="add-ded" data-usuario="${u.id}" data-seccion="${idx}" data-sal-id="${s?.id || ''}">
                <span class="material-symbols-rounded" aria-hidden="true">add</span> Agregar deducción
              </button>
            </div>
          </div>
          <div class="right">
            <span class="muted">Deducciones:</span> <b class="money">${money(subtotalD)}</b>
            &nbsp;&nbsp;|&nbsp;&nbsp;
            <span class="muted">Neto:</span> <b class="money">${money(neto)}</b>
          </div>
        </div>
      `;
    }).join('');

    return `
      <section class="card" data-user-card="${u.id}">
        <header class="card__header">
          <div>
            <h2 style="margin:0">${u.nombre}</h2>
            <span class="badge mod">${u.modalidad === 'otra' ? (u.modalidad_otro || 'otra') : u.modalidad}</span>
          </div>
          <div class="actions">
            <a class="btn btn--ghost btn-small" href="config.html" title="Editar modalidad en Configuración"><span class="material-symbols-rounded" aria-hidden="true">settings</span>Editar modalidad</a>
          </div>
        </header>
        <div class="card__body">${sectionsHtml}</div>
        <div class="card__footer">
          <span class="muted">Total neto mensual:</span>
          <b class="money">${money(totalNeto)}</b>
        </div>
      </section>
    `;
  }).join('');

  // Delegado
  els.usersGrid.removeEventListener('click', onGridClick);
  els.usersGrid.addEventListener('click', onGridClick);
}

/* Eventos delegados */
function onGridClick(e) {
  const btn = e.target.closest('button,[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  if (!action) return;

  const usuario_id = btn.dataset.usuario;
  const seccion = Number(btn.dataset.seccion);
  let salario_id = btn.dataset.salId || btn.getAttribute('data-sal-id');
  const ded_id = btn.dataset.dedId || btn.getAttribute('data-ded-id');

  if (action === 'edit-bruto') openBrutoModal({ usuario_id, seccion, salario_id });
  if (action === 'add-ded') openDedModal({ salario_id, usuario_id, seccion, mode: 'create' });
  if (action === 'edit-ded') openDedModal({ salario_id, ded_id, mode: 'edit' });
  if (action === 'del-ded') openDedDelete({ ded_id });
}

/* Modales (inline, para no depender de openModal aquí) */
function createModal(innerHTML, title = '') {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal__header" style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin-bottom:.5rem">
      <h3 style="margin:0">${title}</h3>
      <button class="btn-icon" data-close aria-label="Cerrar"><span class="material-symbols-rounded">close</span></button>
    </div>
    <div class="modal__body">${innerHTML}</div>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  const closeBtn = modal.querySelector('[data-close]');
  const api = { node: backdrop, close() { backdrop.remove(); } };
  closeBtn?.addEventListener('click', () => api.close());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) api.close(); });
  return modal;
}
function closeModal(m) { m?.parentElement?.remove(); }

/* Modales de negocio */
function openBrutoModal({ usuario_id, seccion, salario_id }) {
  const title = salario_id ? 'Editar ingreso bruto' : 'Definir ingreso bruto';
  const m = createModal(`
    <form id="bruto-form" class="form" novalidate>
      <div class="input">
        <label for="f-bruto" class="required">Ingreso bruto</label>
        <input id="f-bruto" name="ingreso_bruto" type="number" inputmode="decimal" min="0" step="0.01" required>
        <div class="input__error" data-for="ingreso_bruto" aria-live="polite"></div>
      </div>
      <p class="muted">Período: <b>${periodText(period)}</b> — Sección: <b>${seccion}</b></p>
      <div class="actions-row" style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.5rem">
        <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
        <button type="submit" class="btn">${salario_id ? 'Guardar cambios' : 'Guardar'}</button>
      </div>
    </form>
  `, title);

  const form = m.querySelector('#bruto-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = Number(form.ingreso_bruto.value);
    const errBox = form.querySelector('.input__error[data-for="ingreso_bruto"]');
    errBox.textContent = '';
    if (!(val >= 0)) { errBox.textContent = 'Ingresa un número válido (≥ 0).'; return; }

    try {
      if (salario_id) {
        const { error } = await sb.from('salarios')
          .update({ ingreso_bruto: val, updated_at: new Date().toISOString() })
          .eq('id', salario_id);
        if (error) throw error;
      } else {
        const { error } = await sb.from('salarios').insert([{
          usuario_id, anio: period.anio, mes: period.mes, seccion, ingreso_bruto: val
        }]);
        if (error) throw error;
      }
      toast.success('Ingreso bruto guardado');
      closeModal(m);
      await reloadAll();
    } catch (err) { toast.error(err.message || 'No se pudo guardar'); }
  });
}

function openDedModal({ salario_id, usuario_id, seccion, ded_id = null, mode = 'create' }) {
  const isEdit = (mode === 'edit');
  const m = createModal(`
    <form id="ded-form" class="form" novalidate>
      <div class="input">
        <label for="d-nombre" class="required">Nombre / Motivo</label>
        <input id="d-nombre" name="nombre" type="text" required>
        <div class="input__error" data-for="nombre" aria-live="polite"></div>
      </div>
      <div class="input">
        <label for="d-monto" class="required">Monto</label>
        <input id="d-monto" name="monto" type="number" inputmode="decimal" min="0" step="0.01" required>
        <div class="input__error" data-for="monto" aria-live="polite"></div>
      </div>
      <div class="actions-row" style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.5rem">
        <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
        <button type="submit" class="btn">${isEdit ? 'Guardar cambios' : 'Agregar'}</button>
      </div>
    </form>
  `, isEdit ? 'Editar deducción' : 'Agregar deducción');

  const form = m.querySelector('#ded-form');

  // Pre-carga en edición
  if (isEdit && ded_id) {
    (async () => {
      try {
        const { data, error } = await sb
          .from('salarios_deducciones')
          .select('id, nombre, monto')
          .eq('id', ded_id)
          .maybeSingle();
        if (error) throw error;
        if (data) {
          form.nombre.value = data.nombre || '';
          form.monto.value = Number(data.monto || 0);
        }
      } catch { toast.error('No se pudo cargar la deducción'); }
    })();
  } else if (!salario_id && usuario_id && seccion) {
    // Asegura que exista la fila de salarios para colgar la deducción
    (async () => {
      try {
        const { data: existing } = await sb.from('salarios')
          .select('id')
          .eq('usuario_id', usuario_id)
          .eq('anio', period.anio)
          .eq('mes', period.mes)
          .eq('seccion', seccion)
          .maybeSingle();
        if (existing?.id) salario_id = existing.id;
        else {
          const { data: inserted, error } = await sb.from('salarios')
            .insert([{ usuario_id, anio: period.anio, mes: period.mes, seccion, ingreso_bruto: 0 }])
            .select()
            .maybeSingle();
          if (error) throw error;
          salario_id = inserted.id;
        }
      } catch { toast.error('No se pudo preparar la sección para deducciones'); }
    })();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = form.nombre.value.trim();
    const monto = Number(form.monto.value);
    form.querySelector('.input__error[data-for="nombre"]').textContent = '';
    form.querySelector('.input__error[data-for="monto"]').textContent = '';
    if (!nombre) { form.querySelector('.input__error[data-for="nombre"]').textContent = 'Requerido.'; return; }
    if (!(monto >= 0)) { form.querySelector('.input__error[data-for="monto"]').textContent = 'Ingresa un número válido (≥ 0).'; return; }

    try {
      if (isEdit && ded_id) {
        const { error } = await sb.from('salarios_deducciones')
          .update({ nombre, monto, updated_at: new Date().toISOString() })
          .eq('id', ded_id);
        if (error) throw error;
      } else {
        if (!salario_id) { toast.error('No se pudo asociar la deducción a la sección.'); return; }
        const { error } = await sb.from('salarios_deducciones')
          .insert([{ salario_id, nombre, monto }]);
        if (error) throw error;
      }
      toast.success(isEdit ? 'Deducción actualizada' : 'Deducción agregada');
      closeModal(m);
      await reloadAll();
    } catch (err) { toast.error(err.message || 'No se pudo guardar la deducción'); }
  });
}

function openDedDelete({ ded_id }) {
  const m = createModal(`
    <div class="vstack" style="padding:.5rem 0">
      <p>¿Deseas eliminar esta deducción?</p>
      <div class="actions-row" style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.5rem">
        <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
        <button type="button" class="btn" id="btn-del-ok">Sí, eliminar</button>
      </div>
    </div>
  `, 'Eliminar deducción');

  m.querySelector('#btn-del-ok')?.addEventListener('click', async () => {
    try {
      const { error } = await sb.from('salarios_deducciones')
        .delete().eq('id', ded_id);
      if (error) throw error;
      toast.success('Deducción eliminada');
      closeModal(m);
      await reloadAll();
    } catch (err) { toast.error(err.message || 'No se pudo eliminar'); }
  });
}

/* Carga */
async function reloadAll() {
  try {
    setTextSafe(els.periodLabel, periodText(period));

    if (els.summary) {
      els.summary.innerHTML = `<p class="muted">Cargando resumen…</p>`;
    }
    renderUsersSkeleton();

    const users = await fetchUsers();
    const salarios = await fetchSalarios(users.map(u => u.id));
    const deducs = await fetchDeduccionesBySalarios(salarios.map(s => s.id));

    renderSummary(users, salarios, deducs);
    renderAll(users, salarios, deducs);
  } catch (err) {
    console.error(err);
    if (els.usersGrid) {
      els.usersGrid.innerHTML = `
        <section class="card">
          <header class="card__header"><strong>Error</strong></header>
          <div class="card__body"><p class="muted">${err.message || 'No se pudo cargar.'}</p></div>
        </section>`;
    }
    if (els.summary) {
      els.summary.innerHTML = `<p class="muted">${err.message || 'No se pudo cargar el resumen.'}</p>`;
    }
    toast.error(err.message || 'Error al cargar datos');
  }
}

/* Init */
async function init() {
  ({ session } = await requireAuth());

  // Periodo/Moneda inicial
  setTextSafe(els.periodLabel, periodText(period));

  await reloadAll();

  // Cambios de período (acepta dos eventos)
  addEventListener('bpz:month-changed', async (e) => {
    const { year, month } = e.detail || {};
    if (!year || !month) return;
    period = { anio: year, mes: month };
    await reloadAll();
  });
  addEventListener('bpz:period-changed', async (e) => {
    const { year, month } = e.detail || {};
    if (!year || !month) return;
    period = { anio: year, mes: month };
    await reloadAll();
  });

  // Cambio de moneda
  addEventListener('bpz:currency-changed', () => {
    currency = getCurrency() || 'USD';
    reloadAll();
  });
}

// Por si el script se cargara antes del DOM (módulos suelen ser defer, pero prevenimos)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init().catch(handleInitError));
} else {
  init().catch(handleInitError);
}
function handleInitError(err) {
  console.error(err);
  toast.error('No se pudo iniciar Análisis de salario');
}
