/**
 * Configuraciones — PBZ-FS
 * Gestiona: usuarios del presupuesto, moneda del sistema, y gastos fijos (con versionado por vigencia).
 * Reutiliza: requireAuth (auth.js), sb (supabase.js), utils.js (moneda), ui.js (modales/toasts), period.js (periodo actual).
 */

import { requireAuth } from './auth.js';
import { sb } from './supabase.js';
import { toast, openModal, closeModal } from './ui.js';
import { formatCurrencyDynamic, setCurrency, getCurrency, validateISO4217 } from './utils.js';
import { getCurrentPeriod } from './period.js';

/* ========== (Opcional) Defensa contra ?columns=... que algún wrapper podría inyectar ==========
   Si NO lo necesitas, elimina TODO este bloque.
   Esta versión PRESERVA headers (apikey/Authorization), método y body.
*/


/* ========== Estado ========== */
let session, profile;
let isFirstLogin = false;

let users = [];   // usuarios_presupuesto (no archivados)
let gastos = [];  // gastos_fijos_config (no archivados)
let currencyISO = 'USD';
let isoList = []; // ISO 4217 extendido

/* ========== Elementos ========== */
const els = {
  usersTbody: document.getElementById('users-tbody'),
  usersCount: document.getElementById('users-count'),
  usersSearch: document.getElementById('users-search'),
  btnAddUser: document.getElementById('btn-add-user'),

  currencyBase: document.getElementById('currency'),
  currencyExtended: document.getElementById('currency-extended'),
  btnSaveCurrency: document.getElementById('save-currency-btn'),

  gastosTbody: document.getElementById('gastos-tbody'),
  gastosCount: document.getElementById('gastos-count'),
  gastosSearch: document.getElementById('gastos-search'),
  btnAddGasto: document.getElementById('btn-add-gasto'),

  btnFinish: document.getElementById('finish-btn'),
};

function money(x) { return formatCurrencyDynamic(x, currencyISO); }
function bySearch(text, q) { return (text || '').toLowerCase().includes((q || '').trim().toLowerCase()); }
// Obtiene (anio, mes) válidos siempre. Usa period.js si está disponible;
// si no, cae a la fecha actual del navegador.
function currentYearMonth() {
  // fallback: hoy
  const now = new Date();
  let anio = now.getFullYear();
  let mes = now.getMonth() + 1; // 1..12

  try {
    if (typeof getCurrentPeriod === 'function') {
      const p = getCurrentPeriod();
      if (p && Number.isInteger(p.year) && Number.isInteger(p.month) && p.month >= 1 && p.month <= 12) {
        anio = p.year;
        mes = p.month;
      }
    }
  } catch (_) { /* ignore y usa fallback */ }

  return { anio, mes };
}


/* ========== Render: Usuarios ========== */
function renderUsers() {
  const q = els.usersSearch.value || '';
  const list = users.filter(u => bySearch(u.nombre, q));
  els.usersCount.textContent = String(list.length);

  if (!list.length) {
    els.usersTbody.innerHTML = `<tr><td colspan="4" class="muted">No hay usuarios aún.</td></tr>`;
    updateFinishEnabled();
    return;
  }

  els.usersTbody.innerHTML = list.map(u => {
    const mod = u.modalidad === 'otra' ? (u.modalidad_otro || 'otra') : u.modalidad;
    return `
      <tr data-id="${u.id}">
        <td>${u.nombre}</td>
        <td><span class="badge">${u.tipo_pago}</span></td>
        <td>${mod}</td>
        <td class="right">
          <button class="btn-icon" data-action="edit-user" aria-label="Editar usuario" title="Editar"><span class="material-symbols-rounded">edit</span></button>
          <button class="btn-icon" data-action="delete-user" aria-label="Eliminar usuario" title="Eliminar"><span class="material-symbols-rounded">delete</span></button>
        </td>
      </tr>
    `;
  }).join('');

  updateFinishEnabled();
}

/* ========== Render: Moneda ========== */
function renderCurrency() {
  els.currencyBase.value = currencyISO || 'USD';
  const baseCodes = new Set(['USD', 'CRC', 'EUR']);
  const opts = ['<option value="">— Selecciona —</option>']
    .concat(isoList.filter(m => !baseCodes.has(m.code))
      .map(m => `<option value="${m.code}">${m.code} — ${m.name}</option>`));
  els.currencyExtended.innerHTML = opts.join('');
}

// Mantiene solo la última versión por rubro (según vigente_desde_año/mes)
// Mantiene solo la última versión por rubro (según vigencia y created_at)
function latestGastosByRubro(rows) {
  const map = new Map();

  const ym = (x) => ((+x?.vigente_desde_anio || 0) * 100) + (+x?.vigente_desde_mes || 0);
  const ts = (x) => x?.created_at ? new Date(x.created_at).getTime() : 0;

  for (const r of (rows || [])) {
    const key = (r?.rubro || '').trim().toLowerCase();
    if (!key) continue;

    const prev = map.get(key);
    if (!prev) {
      map.set(key, r);
      continue;
    }

    const ymR = ym(r);
    const ymPrev = ym(prev);

    // Si la nueva tiene vigencia posterior, o misma vigencia pero created_at más reciente, la reemplazamos
    if (ymR > ymPrev || (ymR === ymPrev && ts(r) > ts(prev))) {
      map.set(key, r);
    }
  }

  return Array.from(map.values());
}



/* ========== Render: Gastos ========== */
function renderGastos() {
  const q = els.gastosSearch.value || '';
  const latest = latestGastosByRubro(gastos.filter(g => !g.is_archived));
  const list = latest.filter(g => bySearch(g.rubro, q));
  els.gastosCount.textContent = String(list.length);

  if (!list.length) {
    els.gastosTbody.innerHTML = `<tr><td colspan="4" class="muted">No hay gastos fijos aún.</td></tr>`;
    return;
  }

  els.gastosTbody.innerHTML = list.map(g => `
    <tr data-id="${g.id}">
      <td>${g.rubro}</td>
      <td class="money">${money(g.monto || 0)}</td>
      <td>${String(g.vigente_desde_mes).padStart(2, '0')}/${g.vigente_desde_anio}</td>
      <td class="right">
        <button class="btn-icon" data-action="edit-gasto" aria-label="Editar gasto fijo" title="Editar"><span class="material-symbols-rounded">edit</span></button>
        <button class="btn-icon" data-action="delete-gasto" aria-label="Eliminar gasto fijo" title="Eliminar"><span class="material-symbols-rounded">delete</span></button>
      </td>
    </tr>
  `).join('');
}

/* ========== Finalizar ========== */
function updateFinishEnabled() { els.btnFinish.disabled = users.length < 1; }

/* ========== Modales helpers ========== */
function showError(form, name, msg) {
  const box = form.querySelector(`.input__error[data-for="${name}"]`);
  if (box) box.textContent = msg || '';
  toast.error(msg);
}
function clearErrors(form) { form.querySelectorAll('.input__error').forEach(n => n.textContent = ''); }

/* ========== Modal Usuario ========== */
function openUserModal({ title, data = null } = {}) {
  const isEdit = !!data;
  const m = openModal({
    id: 'modal-user',
    title: title || (isEdit ? 'Editar usuario' : 'Agregar usuario'),
    content: `
      <form id="user-form" class="form" novalidate>
        <div class="input">
          <label for="user-nombre" class="required">Nombre</label>
          <input id="user-nombre" name="nombre" type="text" required value="${data?.nombre ?? ''}">
          <div class="input__error" data-for="nombre" aria-live="polite"></div>
        </div>

        <div class="input">
          <label for="user-tipo" class="required">Tipo de pago</label>
          <select id="user-tipo" name="tipo_pago" required>
            ${['asalariado', 'independiente'].map(t => `<option value="${t}" ${data?.tipo_pago === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <div class="input__error" data-for="tipo_pago" aria-live="polite"></div>
        </div>

        <div class="input">
          <label for="user-modalidad" class="required">Modalidad de pago</label>
          <select id="user-modalidad" name="modalidad" required>
            ${['semanal', 'catorcenal', 'quincenal', 'mensual', 'otra'].map(o => `<option value="${o}" ${data?.modalidad === o ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
          <div class="help">Para efectos de la plataforma, <strong>catorcenal</strong> y <strong>quincenal</strong> funcionan igual (dos pagos por mes). Si recibes un salario extra, agrégalo en <strong>Ingresos</strong> (Presupuesto).</div>
          <div class="input__error" data-for="modalidad" aria-live="polite"></div>
        </div>

        <div class="input" id="wrap-otra" style="display:${(data?.modalidad || '') === 'otra' ? 'block' : 'none'}">
          <label for="user-modalidad-otro" class="required">Describe la modalidad</label>
          <input id="user-modalidad-otro" name="modalidad_otro" type="text" value="${data?.modalidad_otro ?? ''}">
          <div class="input__error" data-for="modalidad_otro" aria-live="polite"></div>
        </div>

        <div class="actions-row" style="margin-top:.5rem;display:flex;gap:.5rem;flex-wrap:wrap">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn">${isEdit ? 'Guardar cambios' : 'Agregar'}</button>
        </div>
      </form>
    `,
    closeOnEsc: true, trapFocus: true
  });

  const form = m.querySelector('#user-form');
  const selMod = form.querySelector('#user-modalidad');
  const wrapOtra = form.querySelector('#wrap-otra');
  selMod.addEventListener('change', () => { wrapOtra.style.display = (selMod.value === 'otra') ? 'block' : 'none'; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const nombre = form.nombre.value.trim();
    const tipo_pago = form.tipo_pago.value;
    const modalidad = form.modalidad.value;
    const modalidad_otro = modalidad === 'otra' ? (form.modalidad_otro.value.trim() || '') : null;

    if (!nombre) return showError(form, 'nombre', 'Requerido.');
    if (!tipo_pago) return showError(form, 'tipo_pago', 'Requerido.');
    if (!modalidad) return showError(form, 'modalidad', 'Requerido.');
    if (modalidad === 'otra' && !modalidad_otro) return showError(form, 'modalidad_otro', 'Describe la modalidad.');

    try {
      if (isEdit) {
        const { error } = await sb.from('usuarios_presupuesto')
          .update({ nombre, tipo_pago, modalidad, modalidad_otro, updated_at: new Date().toISOString() })
          .eq('id', data.id)
          .eq('user_id', session.user.id);
        if (error) throw error;

        const idx = users.findIndex(u => u.id === data.id);
        if (idx >= 0) users[idx] = { ...users[idx], nombre, tipo_pago, modalidad, modalidad_otro };
        toast.success('Usuario actualizado');
      } else {
        // Obtén (anio, mes) y asegura valores válidos aunque falle period.js
        let { anio, mes } = currentYearMonth();

        // defensas: si vienen undefined/null/NaN, usar la fecha actual
        const now = new Date();
        anio = Number.isInteger(anio) ? anio : now.getFullYear();
        mes = (Number.isInteger(mes) && mes >= 1 && mes <= 12) ? mes : (now.getMonth() + 1);

        const payload = {
          user_id: session.user.id,
          nombre,
          tipo_pago,
          modalidad,
          modalidad_otro,
          vigente_desde_mes: mes,
          vigente_desde_anio: anio,
          is_archived: false
        };

        const { data: inserted, error } = await sb
          .from('usuarios_presupuesto')
          .insert([payload])
          .select('*')
          .single();

        if (error) throw error;
        users.unshift(inserted);
        toast.success('Usuario agregado');
      }

      renderUsers();
      closeModal(m);
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar el usuario');
    }
  });
}

/* ========== Confirm genérico ========== */
function openConfirm({ title = 'Confirmar', message = '¿Estás seguro?', onConfirm }) {
  const m = openModal({
    id: 'modal-confirm',
    title, content: `
      <div class="vstack" style="padding:1rem">
        <p>${message}</p>
        <div class="actions-row" style="margin-top:.75rem;display:flex;gap:.5rem;flex-wrap:wrap">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="button" class="btn" id="confirm-ok">Sí, continuar</button>
        </div>
      </div>
    `,
    closeOnEsc: true, trapFocus: true
  });
  m.querySelector('#confirm-ok')?.addEventListener('click', async () => {
    try { await onConfirm?.(); } finally { closeModal(m); }
  });
}

/* ========== Modal Gasto ========== */
function openGastoModal({ title, data = null } = {}) {
  const isEdit = !!data;
  const m = openModal({
    id: 'modal-gasto',
    title: title || (isEdit ? 'Editar gasto fijo' : 'Agregar gasto fijo'),
    content: `
      <form id="gasto-form" class="form" novalidate>
        <div class="input">
          <label for="g-rubro" class="required">Rubro</label>
          <input id="g-rubro" name="rubro" type="text" required value="${data?.rubro ?? ''}">
          <div class="input__error" data-for="rubro" aria-live="polite"></div>
        </div>
        <div class="input">
          <label for="g-monto" class="required">Presupuesto</label>
          <input id="g-monto" name="monto" type="number" inputmode="decimal" min="0" step="0.01" required value="${data?.monto ?? ''}">
          <div class="input__error" data-for="monto" aria-live="polite"></div>
        </div>
        <p class="help">Al guardar, la nueva versión quedará vigente <strong>desde el mes actual</strong>.</p>
        <div class="actions-row" style="margin-top:.5rem;display:flex;gap:.5rem;flex-wrap:wrap">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn">${isEdit ? 'Guardar cambios' : 'Agregar'}</button>
        </div>
      </form>
    `,
    closeOnEsc: true, trapFocus: true
  });

  const form = m.querySelector('#gasto-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const rubro = form.rubro.value.trim();
    const monto = Number(form.monto.value);
    if (!rubro) return showError(form, 'rubro', 'Requerido.');
    if (!(monto >= 0)) return showError(form, 'monto', 'Ingresa un número válido (≥ 0).');

    try {
      const { anio, mes } = currentYearMonth();
      if (isEdit) {
        // Versionado: insertamos nueva versión vigente desde ahora
        const { data: inserted, error: e1 } = await sb
          .from('gastos_fijos_config')
          .insert([{
            user_id: session.user.id,
            rubro, monto,
            vigente_desde_mes: mes,
            vigente_desde_anio: anio,
            is_archived: false
          }])
          .select('*')
          .single();
        if (e1) throw e1;
        gastos.unshift(inserted);
        toast.success('Gasto actualizado (nueva versión creada)');
      } else {
        const { data: inserted, error } = await sb
          .from('gastos_fijos_config')
          .insert([{
            user_id: session.user.id,
            rubro, monto,
            vigente_desde_mes: mes,
            vigente_desde_anio: anio,
            is_archived: false
          }])
          .select('*')
          .single();
        if (error) throw error;
        gastos.unshift(inserted);
        toast.success('Gasto agregado');
      }
      renderGastos();
      closeModal(m);
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar el gasto');
    }
  });
}

/* ========== Eventos tablas ========== */
function onUsersTableClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const tr = btn.closest('tr[data-id]');
  const id = tr?.dataset?.id;
  const row = users.find(u => String(u.id) === String(id));
  if (!row) return;

  const action = btn.dataset.action;
  if (action === 'edit-user') {
    openUserModal({ data: row });
  } else if (action === 'delete-user') {
    openConfirm({
      title: 'Eliminar usuario',
      message: `¿Deseas eliminar (archivar) el usuario <strong>${row.nombre}</strong>?`,
      onConfirm: async () => {
        try {
          const { error } = await sb.from('usuarios_presupuesto')
            .update({ is_archived: true, updated_at: new Date().toISOString() })
            .eq('id', row.id)
            .eq('user_id', session.user.id);
          if (error) throw error;
          users = users.filter(u => u.id !== row.id);
          toast.success('Usuario eliminado');
          renderUsers();
        } catch (err) { toast.error(err.message || 'No se pudo eliminar'); }
      }
    });
  }
}

function onGastosTableClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const tr = btn.closest('tr[data-id]');
  const id = tr?.dataset?.id;
  const row = gastos.find(g => String(g.id) === String(id));
  if (!row) return;

  const action = btn.dataset.action;
  if (action === 'edit-gasto') {
    openGastoModal({ data: row });
  } else if (action === 'delete-gasto') {
    openConfirm({
      title: 'Eliminar gasto',
      message: `¿Deseas eliminar (archivar) el rubro <strong>${row.rubro}</strong>?`,
      onConfirm: async () => {
        try {
          const { error } = await sb.from('gastos_fijos_config')
            .update({ is_archived: true, updated_at: new Date().toISOString() })
            .eq('id', row.id)
            .eq('user_id', session.user.id);
          if (error) throw error;
          gastos = gastos.filter(g => g.id !== row.id);
          toast.success('Gasto eliminado');
          renderGastos();
        } catch (err) { toast.error(err.message || 'No se pudo eliminar'); }
      }
    });
  }
}

/* ========== Moneda ========== */
function buildISOList() {
  isoList = [
    { code: 'USD', name: 'Dólar estadounidense' },
    { code: 'CRC', name: 'Colón costarricense' },
    { code: 'EUR', name: 'Euro' },
    { code: 'GBP', name: 'Libra esterlina' },
    { code: 'MXN', name: 'Peso mexicano' },
    { code: 'ARS', name: 'Peso argentino' },
    { code: 'BRL', name: 'Real brasileño' },
    { code: 'CLP', name: 'Peso chileno' },
    { code: 'COP', name: 'Peso colombiano' },
    { code: 'PEN', name: 'Sol peruano' },
    { code: 'UYU', name: 'Peso uruguayo' },
    { code: 'CAD', name: 'Dólar canadiense' },
    { code: 'AUD', name: 'Dólar australiano' },
    { code: 'JPY', name: 'Yen japonés' },
    { code: 'CNY', name: 'Renminbi chino' },
    { code: 'CHF', name: 'Franco suizo' },
    { code: 'SEK', name: 'Corona sueca' },
    { code: 'NOK', name: 'Corona noruega' },
    { code: 'DKK', name: 'Corona danesa' },
    { code: 'PLN', name: 'Złoty polaco' },
    { code: 'CZK', name: 'Corona checa' },
    { code: 'HUF', name: 'Forinto húngaro' },
    { code: 'INR', name: 'Rupia india' },
    { code: 'KRW', name: 'Won surcoreano' },
    { code: 'TWD', name: 'Nuevo Dólar taiwanés' },
    { code: 'HKD', name: 'Dólar de Hong Kong' },
    { code: 'SGD', name: 'Dólar de Singapur' },
    { code: 'ZAR', name: 'Rand sudafricano' },
    { code: 'AED', name: 'Dirham EAU' },
    { code: 'SAR', name: 'Riyal saudí' },
    { code: 'TRY', name: 'Lira turca' }
  ];
}

async function saveCurrencyChoice(selectedCode) {
  const code = (selectedCode || '').toUpperCase();
  if (!validateISO4217(code)) { toast.error('Selecciona una moneda ISO válida'); return; }
  try {
    const { error } = await sb.from('config_app').upsert({
      user_id: session.user.id,
      moneda_iso: code,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) throw error;
    setCurrency(code);
    currencyISO = code;
    toast.success('Moneda guardada');
    renderGastos(); // re-formatear valores visibles
  } catch (err) {
    toast.error(err.message || 'No se pudo guardar la moneda');
  }
}

/* ========== Carga inicial ========== */
async function loadData() {
  try {
    // Perfil / primer inicio
    const { data: prof } = await sb
      .from('profiles')
      .select('id, first_login, full_name')
      .eq('id', session.user.id)
      .maybeSingle();
    profile = prof || { id: session.user.id, first_login: true };
    isFirstLogin = !!profile.first_login;

    // Moneda (localStorage + config_app)
    const local = getCurrency();
    if (local) currencyISO = local;
    const { data: conf } = await sb
      .from('config_app')
      .select('moneda_iso')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (conf?.moneda_iso) currencyISO = conf.moneda_iso;

    // Usuarios
    const { data: u, error: eu } = await sb
      .from('usuarios_presupuesto')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('is_archived', false)
      .order('created_at', { ascending: false });
    if (eu) throw eu;
    users = u || [];

    // Gastos
    const { data: g, error: eg } = await sb
      .from('gastos_fijos_config')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('is_archived', false)
      .order('created_at', { ascending: false });
    if (eg) throw eg;
    gastos = g || [];
  } catch (err) {
    toast.error(err.message || 'Error al cargar datos');
  }
}

/* ========== Finalizar primer inicio ========== */
async function finishFirstLogin() {
  try {
    if (users.length < 1) { toast.error('Agrega al menos un usuario para finalizar.'); return; }
    const { error } = await sb
      .from('profiles')
      .update({ first_login: false })
      .eq('id', session.user.id);
    if (error) throw error;
    toast.success('¡Configuración inicial completada!');
    window.location.replace('inicio.html');
  } catch (err) {
    toast.error(err.message || 'No se pudo finalizar');
  }
}

/* ========== Init ========== */
async function init() {
  // En Configuración permitimos entrar aunque sea primer inicio
  ({ session } = await requireAuth({ redirectFirstLogin: false }));

  // Construir lista ISO y cargar datos
  buildISOList();
  await loadData();

  // Render inicial
  renderCurrency();
  renderUsers();
  renderGastos();
  updateFinishEnabled();

  // Listeners usuarios
  els.btnAddUser.addEventListener('click', () => openUserModal({}));
  els.usersSearch.addEventListener('input', renderUsers);
  els.usersTbody.addEventListener('click', onUsersTableClick);

  // Listeners gastos
  els.btnAddGasto.addEventListener('click', () => openGastoModal({}));
  els.gastosSearch.addEventListener('input', renderGastos);
  els.gastosTbody.addEventListener('click', onGastosTableClick);

  // Moneda (extendido sobrepone)
  els.currencyExtended.addEventListener('change', () => {
    if (els.currencyExtended.value) els.currencyBase.value = els.currencyExtended.value;
  });
  els.btnSaveCurrency.addEventListener('click', async () => {
    const selected = els.currencyExtended.value || els.currencyBase.value || 'USD';
    await saveCurrencyChoice(selected);
  });

  // Finalizar
  els.btnFinish.addEventListener('click', finishFirstLogin);
}

init().catch(err => {
  console.error(err);
  toast.error('No se pudo iniciar Configuraciones');
});
