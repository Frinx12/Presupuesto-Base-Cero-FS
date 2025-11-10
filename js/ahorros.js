// js/ahorros.js
import { requireAuth } from './auth.js';
import { sb } from './supabase.js';
import { openModal, closeModal, toast } from './ui.js';
import { getCurrentPeriod } from './period.js';
import { formatCurrencyDynamic as money, getCurrency } from './utils.js';

let session;
let period = getCurrentPeriod();
let currency = getCurrency() || 'CRC';

const grid = document.getElementById('grid-ahp');
const sumMesA = document.getElementById('sum-mes-ahorros');
const sumMesP = document.getElementById('sum-mes-provisiones');

const AHORROS_TABLE = 'ahorros';
const PROV_TABLE = 'provisiones'; // ¡NO usar api_provisiones!

function monthName(m) {
  return ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'][m - 1] || '—';
}
function periodText(p) { return `${monthName(p.mes)} ${p.anio}`; }
function setPeriodUI() {
  const t = periodText(period);
  document.getElementById('period-label')?.setAttribute('aria-live', 'polite');
  document.getElementById('period-label') && (document.getElementById('period-label').textContent = t);
  document.getElementById('period-badge') && (document.getElementById('period-badge').textContent = t);
  document.title = `Ahorros y provisiones — ${t}`;
}
function periodStartISODate(p) {
  const d = new Date(p.anio, p.mes - 1, 1);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function cardSkeleton() {
  return `
  <section class="card">
    <header class="card__header"><strong>Cargando…</strong></header>
    <div class="card__body"><div class="skeleton" style="height:68px"></div></div>
  </section>`;
}
function renderEmpty() {
  grid.innerHTML = `
    <div class="empty" style="border:2px dashed var(--border);border-radius:1rem;padding:1rem;text-align:center;color:var(--muted)">
      No tienes ahorros ni provisiones todavía.
    </div>`;
}

/* =========================
   AUTH (auto refresh)
========================= */
async function withAuthRetry(op) {
  let res = await op();
  if (res?.error && isJwtExpired(res.error)) {
    try {
      await sb.auth.refreshSession();
      const s = await sb.auth.getSession();
      session = s?.data?.session || session;
      res = await op();
    } catch (e) {
      console.error('AUTH REFRESH FAILED >>', e);
      await sb.auth.signOut().catch(() => { });
      throw res.error || e;
    }
  }
  return res;
}
function isJwtExpired(error) {
  const msg = (error?.message || error?.error_description || '').toLowerCase();
  return msg.includes('jwt expired') || msg.includes('invalid jwt') || (error?.status === 401);
}

/* =========================
   FETCH
========================= */
async function fetchAhorros() {
  const { data, error } = await withAuthRetry(() =>
    sb.from(AHORROS_TABLE).select('*').order('id', { ascending: true })
  );
  if (error) throw error;

  // Normaliza nombres de campo
  return (data || []).map(r => ({
    ...r,
    aporte_mensual: r.aporte_mensual ?? r.monto ?? null
  }));
}

async function fetchProvisiones() {
  const { data, error } = await withAuthRetry(() =>
    sb.from(PROV_TABLE).select('*').order('id', { ascending: true })
  );
  if (error) throw error;
  return data || [];
}
function calcTotalMes(list) {
  return (list || []).reduce((a, x) => a + Number(x.aporte_mensual ?? x.monto ?? 0), 0);
}

/* =========================
   RENDER GRID
========================= */
function renderGrid(ahorros, provisiones) {
  const cardsA = (ahorros || []).map(a => ahorroCard(a)).join('');
  const cardsP = (provisiones || []).map(p => provisionCard(p)).join('');
  const html = cardsA + cardsP;
  if (!html) { renderEmpty(); return; }
  grid.innerHTML = html;
  grid.removeEventListener('click', onGridClick);
  grid.addEventListener('click', onGridClick);
}

function ahorroCard(a) {
  const saldo = Number(a.saldo ?? 0);
  const objetivo = Number(a.aporte_mensual ?? a.monto ?? 0);
  return `
  <section class="card card--ahorro" data-kind="ahorro" data-id="${a.id}">
    <header class="card__header">
      <div>
        <h3 style="margin:0">${a.nombre || '(sin nombre)'}</h3>
        <small class="muted">Ahorro — objetivo mensual: <b>${money(objetivo, currency)}</b></small>
      </div>
      <div class="header-actions" style="display:flex;gap:.35rem">
        <button class="btn btn--ghost btn-small" data-action="edit-ahorro" data-id="${a.id}">
          <span class="material-symbols-rounded">edit</span> Editar
        </button>
        <button class="btn btn--ghost btn-small" data-action="del-ahorro" data-id="${a.id}">
          <span class="material-symbols-rounded">delete</span>
        </button>
      </div>
    </header>
    <div class="card__body">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="muted">Saldo</div>
        <div><strong>${money(saldo, currency)}</strong></div>
      </div>
    </div>
    <div class="card__footer" style="display:flex;justify-content:flex-end;gap:.5rem">
      <button class="btn btn--ghost btn-small" data-action="mov-ahorro" data-id="${a.id}">
        <span class="material-symbols-rounded">sync_alt</span> Movimiento
      </button>
    </div>
  </section>`;
}

function provisionCard(p) {
  const meta = Number(p.meta ?? p.meta_total ?? 0);
  const saldo = Number(p.saldo ?? 0);
  const meses = Number.isFinite(Number(p.meses_establecidos)) ? Number(p.meses_establecidos) : (Number(p.meses) || null);
  const cuota = Number(p.aporte_mensual ?? (meses ? meta / meses : 0));
  // estimaciones con lo que tenemos hoy (saldo≈acumulado)
  const faltante = Math.max(0, meta - saldo);
  const mesesFalt = cuota > 0 ? Math.max(0, Math.ceil(faltante / cuota)) : 0;
  const reach = (() => {
    if (!mesesFalt) return null;
    const d = new Date(period.anio, period.mes - 1 + mesesFalt, 0);
    return `${monthName(d.getMonth() + 1)} ${d.getFullYear()}`;
  })();

  return `
  <section class="card card--provision" data-kind="provision" data-id="${p.id}">
    <header class="card__header">
      <div>
        <h3 style="margin:0">${p.nombre || '(sin nombre)'}</h3>
        <small class="muted">Provisión — cuota mensual: <b>${money(cuota, currency)}</b></small>
      </div>
      <div class="header-actions" style="display:flex;gap:.35rem">
        <button class="btn btn--ghost btn-small" data-action="edit-provision" data-id="${p.id}">
          <span class="material-symbols-rounded">edit</span> Editar
        </button>
        <button class="btn btn--ghost btn-small" data-action="del-provision" data-id="${p.id}">
          <span class="material-symbols-rounded">delete</span>
        </button>
      </div>
    </header>
    <div class="card__body">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="muted">Meta</div>
        <div><strong>${money(meta, currency)}</strong></div>
      </div>
      ${meses ? `<div class="muted" style="margin-top:.25rem">Meses establecidos: <b>${meses}</b></div>` : ''}
      <div class="muted" style="margin-top:.25rem">Acumulado actual: <b>${money(saldo, currency)}</b></div>
      <div class="muted" style="margin-top:.25rem">Faltante: <b>${money(faltante, currency)}</b></div>
      ${reach ? `<div class="muted" style="margin-top:.25rem">Fecha estimada: <b>${reach}</b></div>` : ''}
    </div>
    <div class="card__footer" style="display:flex;justify-content:flex-end;gap:.5rem">
      <button class="btn btn--ghost btn-small" data-action="mov-provision" data-id="${p.id}">
        <span class="material-symbols-rounded">sync_alt</span> Movimiento
      </button>
    </div>
  </section>`;
}

/* =========================
   Helpers payload/columns
========================= */
function scrubPayloadForMissingColumns(errMsg, payload) {
  const m = /Could not find the '([^']+)' column/i.exec(errMsg || '');
  if (m && m[1] && Object.prototype.hasOwnProperty.call(payload, m[1])) {
    const cleaned = { ...payload };
    delete cleaned[m[1]];
    return cleaned;
  }
  return null;
}
async function insertWithRetry(table, payload) {
  let res = await withAuthRetry(() => sb.from(table).insert([payload]));
  if (!res?.error) return;
  const cleaned = scrubPayloadForMissingColumns(res.error?.message, payload);
  if (cleaned) {
    const r2 = await withAuthRetry(() => sb.from(table).insert([cleaned]));
    if (!r2.error) return;
    throw r2.error;
  }
  throw res.error;
}
// Inserta en "ahorros" probando variantes de 'tipo' para sortear el CHECK
async function insertAhorroRobusto(payloadBase) {
  const variantes = ['ahorro', 'Ahorro', 'AHORRO', 'A'];
  let lastErr;
  for (const v of variantes) {
    const payload = { ...payloadBase, tipo: v };
    const res = await withAuthRetry(() => sb.from(AHORROS_TABLE).insert([payload]));
    if (!res?.error) return; // éxito
    lastErr = res.error;
    // si el error NO es del check constraint, dejamos de intentar
    const msg = (lastErr?.message || '').toLowerCase();
    if (!msg.includes('check constraint') && !msg.includes('tipo_check')) break;
  }
  throw lastErr;
}


async function updateWithRetry(table, id, payload) {
  let res = await withAuthRetry(() => sb.from(table).update(payload).eq('id', id));
  if (!res?.error) return;
  const cleaned = scrubPayloadForMissingColumns(res.error?.message, payload);
  if (cleaned) {
    const r2 = await withAuthRetry(() => sb.from(table).update(cleaned).eq('id', id));
    if (!r2.error) return;
    throw r2.error;
  }
  throw res.error;
}

/* =========================
   CRUD — Modales
========================= */
// AHORRO: solo nombre + monto mensual (guardado en "monto")
function openAhorroModal({ id = null, data = null } = {}) {
  const isEdit = !!id;
  const m = openModal({
    id: 'modal-ahorro',
    title: isEdit ? 'Editar ahorro' : 'Nuevo ahorro',
    content: `
      <form id="f-ahorro" class="form" novalidate>
        <div class="input">
          <label class="required">Nombre</label>
          <input name="nombre" required value="${data?.nombre ?? ''}">
        </div>
        <div class="input">
          <label>Monto mensual (objetivo)</label>
          <input name="aporte_mensual" type="number" min="0" step="0.01" value="${data?.aporte_mensual ?? data?.monto ?? ''}">
        </div>
        <div class="input">
          <label>Saldo inicial (opcional)</label>
          <input name="saldo" type="number" min="0" step="0.01" value="${data?.saldo ?? ''}">
        </div>
        <div class="actions-row" style="display:flex;gap:.5rem;margin-top:.75rem">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn">${isEdit ? 'Guardar cambios' : 'Crear'}</button>
        </div>
      </form>
    `,
    closeOnEsc: true, trapFocus: true
  });

  const form = m.querySelector('#f-ahorro');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const toNum = (v) => (v === '' || v == null) ? null : (Number.isFinite(Number(v)) ? Number(v) : null);

    const aporte = toNum(form.aporte_mensual.value);
    const payload = {
      nombre: (form.nombre.value || '').trim() || null,
      monto: aporte ?? 0,           // NOT NULL
      saldo: toNum(form.saldo.value) ?? 0
    };
    if (!payload.nombre) { toast.error('Nombre requerido'); return; }

    try {
      if (isEdit) {
        // actualización: si quieres conservar 'aporte_mensual' como alias
        payload.aporte_mensual = aporte ?? null;
        await updateWithRetry(AHORROS_TABLE, id, payload);
        toast.success('Ahorro actualizado');
      } else {
        payload.user_id = session.user.id;                 // RLS
        payload.vigente_desde = periodStartISODate(period); // NOT NULL (DATE)
        payload.aporte_mensual = aporte ?? null;           // alias opcional
        // Intento robusto: probar variantes de 'tipo' para satisfacer el CHECK
        await insertAhorroRobusto(payload);
        toast.success('Ahorro creado');
      }
      closeModal(m);
      await reload();
    } catch (err) {
      console.error('SUPABASE ERROR >>', err);
      toast.error(err?.message || 'No se pudo guardar');
    }
  });
}

// PROVISIÓN: Meta + Meses => cuota mensual automática (guardada en "aporte_mensual")
function openProvisionModal({ id = null, data = null } = {}) {
  const isEdit = !!id;
  const m = openModal({
    id: 'modal-provision',
    title: isEdit ? 'Editar provisión' : 'Nueva provisión',
    content: `
      <form id="f-provision" class="form" novalidate>
        <div class="input">
          <label class="required">Nombre</label>
          <input name="nombre" required value="${data?.nombre ?? ''}">
        </div>
        <div class="input">
          <label>Meta</label>
          <input name="meta" type="number" min="0" step="0.01" value="${data?.meta ?? data?.meta_total ?? ''}">
        </div>
        <div class="input">
          <label>Meses</label>
          <input name="meses" type="number" min="1" step="1" value="${data?.meses_establecidos ?? data?.meses ?? ''}">
        </div>
        <div class="input">
          <label>Cuota mensual (calculada)</label>
          <input name="aporte_mensual" type="number" min="0" step="0.01" value="${data?.aporte_mensual ?? ''}" readonly>
        </div>
        <div class="input">
          <label>Saldo inicial (opcional)</label>
          <input name="saldo" type="number" min="0" step="0.01" value="${data?.saldo ?? ''}">
        </div>
        <div class="actions-row" style="display:flex;gap:.5rem;margin-top:.75rem">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn">${isEdit ? 'Guardar cambios' : 'Crear'}</button>
        </div>
      </form>
    `
  });

  // cálculo en vivo de la cuota
  const form = m.querySelector('#f-provision');
  const recalc = () => {
    const meta = Number(form.meta.value || 0);
    const meses = Math.max(1, parseInt(form.meses.value || '1', 10));
    form.aporte_mensual.value = (meta && meses) ? (meta / meses).toFixed(2) : '';
  };
  form.meta.addEventListener('input', recalc);
  form.meses.addEventListener('input', recalc);
  recalc();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const toNum = (v) => (v === '' || v == null) ? null : (Number.isFinite(Number(v)) ? Number(v) : null);

    const payload = {
      nombre: (form.nombre.value || '').trim() || null,
      meta: toNum(form.meta.value),
      aporte_mensual: toNum(form.aporte_mensual.value),
      saldo: toNum(form.saldo.value) ?? 0
    };
    const mesesVal = parseInt(form.meses.value || '0', 10);
    if (Number.isInteger(mesesVal) && mesesVal > 0) payload.meses_establecidos = mesesVal;

    if (!payload.nombre) { toast.error('Nombre requerido'); return; }
    if (payload.meta == null) { toast.error('Meta requerida'); return; }
    if (payload.aporte_mensual == null) { toast.error('Cuota mensual inválida'); return; }

    try {
      if (isEdit) {
        await updateWithRetry(PROV_TABLE, id, payload); // insertWithRetry limpiarará columnas inexistentes si hace falta
        toast.success('Provisión actualizada');
      } else {
        payload.user_id = session.user.id; // RLS
        await insertWithRetry(PROV_TABLE, payload);
        toast.success('Provisión creada');
      }
      closeModal(m);
      await reload();
    } catch (err) {
      console.error('SUPABASE ERROR >>', err);
      toast.error(err?.message || 'No se pudo guardar');
    }
  });
}

/* =========================
   Delete + Movimiento
========================= */
async function deleteBy(kind, id) {
  try {
    const table = (kind === 'ahorro') ? AHORROS_TABLE : PROV_TABLE;
    const { error } = await withAuthRetry(() => sb.from(table).delete().eq('id', id));
    if (error) throw error;
    toast.success(kind === 'ahorro' ? 'Ahorro eliminado' : 'Provisión eliminada');
    await reload();
  } catch (err) {
    console.error('SUPABASE ERROR >>', err);
    toast.error(err?.message || 'No se pudo eliminar');
  }
}

function openMovimientoModal(kind, rec) {
  const m = openModal({
    id: 'modal-mov',
    title: `Movimiento en ${kind === 'ahorro' ? 'Ahorro' : 'Provisión'} — ${rec.nombre}`,
    content: `
      <form id="f-mov" class="form">
        <div class="input">
          <label>Tipo</label>
          <select name="sign">
            <option value="mas">Aumentar (+)</option>
            <option value="menos">Disminuir (-)</option>
          </select>
        </div>
        <div class="input">
          <label>Monto</label>
          <input name="monto" type="number" min="0" step="0.01" required>
        </div>
        <div class="actions-row" style="display:flex;gap:.5rem;margin-top:.75rem">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn">Aplicar</button>
        </div>
      </form>
    `
  });
  const form = m.querySelector('#f-mov');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const monto = Number(form.monto.value);
    if (!(monto >= 0)) { toast.error('Monto inválido'); return; }
    const delta = form.sign.value === 'mas' ? +monto : -monto;
    const table = (kind === 'ahorro') ? AHORROS_TABLE : PROV_TABLE;
    try {
      const { error } = await withAuthRetry(() =>
        sb.from(table).update({ saldo: Number(rec.saldo || 0) + delta }).eq('id', rec.id)
      );
      if (error) throw error;
      toast.success('Movimiento aplicado');
      closeModal(m);
      await reload();
    } catch (err) {
      console.error('SUPABASE ERROR >>', err);
      toast.error(err?.message || 'No se pudo aplicar');
    }
  });
}

/* =========================
   Events
========================= */
function onGridClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const card = btn.closest('.card');
  const kind = card?.dataset.kind;

  if (btn.dataset.action === 'edit-ahorro') {
    const nombre = card.querySelector('h3')?.textContent.trim();
    openAhorroModal({ id, data: { nombre } });
  }
  if (btn.dataset.action === 'del-ahorro') { deleteBy('ahorro', id); }

  if (btn.dataset.action === 'edit-provision') {
    const nombre = card.querySelector('h3')?.textContent.trim();
    openProvisionModal({ id, data: { nombre } });
  }
  if (btn.dataset.action === 'del-provision') { deleteBy('provision', id); }

  if (btn.dataset.action === 'mov-ahorro' || btn.dataset.action === 'mov-provision') {
    const list = (btn.dataset.action === 'mov-ahorro') ? state.ahorros : state.provisiones;
    const rec = list.find(x => String(x.id) === String(id));
    if (rec) openMovimientoModal(kind, rec);
  }
}

// Header buttons
document.getElementById('btn-new-ahorro')?.addEventListener('click', () => openAhorroModal({}));
document.getElementById('btn-new-provision')?.addEventListener('click', () => openProvisionModal({}));

/* =========================
   LOAD / INIT
========================= */
const state = { ahorros: [], provisiones: [] };

async function reload() {
  grid.innerHTML = cardSkeleton() + cardSkeleton();
  try {
    const [a, p] = await Promise.all([fetchAhorros(), fetchProvisiones()]);
    state.ahorros = a; state.provisiones = p;
    renderGrid(a, p);
    if (sumMesA) sumMesA.textContent = money(calcTotalMes(a), currency);
    if (sumMesP) sumMesP.textContent = money(calcTotalMes(p), currency);
  } catch (err) {
    console.error('SUPABASE ERROR >>', err);
    grid.innerHTML = ''; renderEmpty();
    toast.error(err?.message || 'No se pudo cargar ahorros/provisiones');
  }
}

(async function init() {
  ({ session } = await requireAuth());
  sb.auth.onAuthStateChange((_evt, s) => { session = s?.session || session; });
  setPeriodUI();
  await reload();

  addEventListener('bpz:month-changed', async (e) => {
    const { year, month } = e.detail || {};
    if (!year || !month) return;
    period = { anio: year, mes: month };
    setPeriodUI();
    await reload();
  });

  addEventListener('bpz:currency-changed', (e) => {
    currency = e.detail?.iso || getCurrency() || 'CRC';
    reload();
  });
})();
