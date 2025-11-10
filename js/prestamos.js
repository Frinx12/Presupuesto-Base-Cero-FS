// js/prestamos.js
import { requireAuth } from './auth.js';
import { sb } from './supabase.js';
import { openModal, closeModal, toast } from './ui.js';
import { getCurrentPeriod } from './period.js';
import { formatCurrencyDynamic as money, getCurrency } from './utils.js';

let session;
let period = getCurrentPeriod();
let currency = getCurrency() || 'CRC';

const cards = document.getElementById('cards');
const empty = document.getElementById('empty');

function monthName(m) {
  return ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'][m - 1] || '—';
}
function periodText(p) { return `${monthName(p.mes)} ${p.anio}`; }

/* =========================
   Config flexible (sin probes)
========================= */
const TABLE_PRESTAMOS = 'prestamos';
let TABLE_PAGOS = 'pagos_prestamo';
let PAGOS_DATE_COL = 'fecha_pago'; // se resolverá en init()

function toDateOnlyISO(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/* =========================
   Cálculos (solo lectura)
========================= */
function cuotaEstimada({ saldo_actual, tasa_anual, plazo_meses, interes_mensual, meses_totales }) {
  const P = Number(saldo_actual || 0);
  let rMes = null;
  if (interes_mensual != null) rMes = Number(interes_mensual) / 100;
  if (rMes == null && tasa_anual != null) rMes = (Number(tasa_anual) / 100) / 12;
  if (!rMes) rMes = 0;
  const n = Number(meses_totales ?? plazo_meses ?? 0);
  if (!P || !n) return 0;
  if (rMes === 0) return P / n;
  const a = rMes * Math.pow(1 + rMes, n);
  const b = Math.pow(1 + rMes, n) - 1;
  return P * (a / b);
}

/* Helpers tolerantes al esquema */
function getMesesFromRow(p) {
  return Number(p.meses_totales ?? p.plazo_meses ?? p.cuotas_totales ?? 0);
}
function getInteresMensualFromRow(p) {
  if (p.interes_mensual != null && p.interes_mensual !== '') return Number(p.interes_mensual);
  if (p.tasa_anual != null && p.tasa_anual !== '') return Number(p.tasa_anual) / 12;
  return null;
}
function getSaldoBaseFromRow(p) {
  const sa = (p.saldo_actual === null || p.saldo_actual === undefined) ? null : Number(p.saldo_actual);
  if (sa && sa > 0) return sa;          // usa saldo_actual solo si es > 0
  return Number(p.monto_inicial ?? 0);   // si no, cae a monto_inicial
}

/* =========================
   Probes de esquema (fecha en pagos)
========================= */
async function resolvePagosDateColumn() {
  try {
    const { data, error } = await sb.from(TABLE_PAGOS).select('*').limit(1);
    if (error) throw error;
    const row = (data && data[0]) || {};
    if ('fecha_pago' in row) { PAGOS_DATE_COL = 'fecha_pago'; return; }
    if ('fecha' in row) { PAGOS_DATE_COL = 'fecha'; return; }
    // si no hay filas, asumimos 'fecha_pago' por convención
    PAGOS_DATE_COL = 'fecha_pago';
  } catch {
    // ante error de lectura, mantener default
    PAGOS_DATE_COL = 'fecha_pago';
  }
}

/* =========================
   FETCH
========================= */
async function fetchPrestamos() {
  const { data, error } = await sb.from(TABLE_PRESTAMOS).select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchPrestamoOne(id) {
  const { data, error } = await sb.from(TABLE_PRESTAMOS).select('*').eq('id', id).limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

async function fetchPagosMes(prestamoId) {
  const first = new Date(period.anio, period.mes - 1, 1).toISOString().slice(0, 10);
  const lastD = new Date(period.anio, period.mes, 0);
  const last = new Date(lastD.getFullYear(), lastD.getMonth(), lastD.getDate(), 23, 59, 59).toISOString().slice(0, 10);

  const { data, error } = await sb.from(TABLE_PAGOS).select('*')
    .eq('prestamo_id', prestamoId)
    .gte(PAGOS_DATE_COL, first).lte(PAGOS_DATE_COL, last)
    .order(PAGOS_DATE_COL, { ascending: true });
  if (error) return [];
  return data || [];
}

async function fetchPagosAll(prestamoId) {
  const { data, error } = await sb.from(TABLE_PAGOS).select('*')
    .eq('prestamo_id', prestamoId)
    .order(PAGOS_DATE_COL, { ascending: true });
  if (error) return [];
  return data || [];
}

/* =========================
   RENDER
========================= */
async function renderCards(list) {
  if (!list.length) { cards.innerHTML = ''; empty.hidden = false; return; }
  empty.hidden = true;

  const htmls = await Promise.all(list.map(async p => {
    // Pagos
    const pagosMes = await fetchPagosMes(p.id);
    const pagosAll = await fetchPagosAll(p.id);
    const pagadoMes = pagosMes.reduce((a, b) => a + Number(b.monto || 0), 0);
    const pagadoTot = pagosAll.reduce((a, b) => a + Number(b.monto || 0), 0);

    // Datos de préstamo
    const saldoBase = getSaldoBaseFromRow(p);
    const meses = getMesesFromRow(p);
    const im = getInteresMensualFromRow(p);
    const tieneIM = im != null;
    const tieneTA = (p.tasa_anual != null && p.tasa_anual !== '');
    const interesLabel = tieneIM ? `${im}% (mensual)` : (tieneTA ? `${Number(p.tasa_anual)}% (anual)` : '—');

    // Cálculos
    const cuota = cuotaEstimada({
      saldo_actual: saldoBase,
      interes_mensual: tieneIM ? im : null,
      tasa_anual: (!tieneIM && tieneTA) ? Number(p.tasa_anual) : null,
      meses_totales: meses
    });

    const cuotaLabel = (meses > 0) ? money(cuota, currency) : '—';
    const mesesLabel = (meses > 0) ? meses : '—';
    const totalPagar = (meses > 0) ? (cuota * meses) : saldoBase; // con r=0 total = P
    const totalLabel = money(totalPagar, currency);

    // Cuotas pagadas / restantes (estimación por monto)
    let cuotasPagadas = '—', cuotasRestantes = '—';
    if (meses > 0 && cuota > 0) {
      const est = Math.floor(pagadoTot / cuota);
      cuotasPagadas = Math.min(est, meses);
      cuotasRestantes = Math.max(0, meses - cuotasPagadas);
    }

    // Saldos
    const saldoRest = Math.max(0, saldoBase - pagadoTot); // aprox con pagos acumulados

    return `
      <section class="loan-card" data-id="${p.id}">
        <header>
          <div class="loan-title">
            <span class="material-symbols-rounded" aria-hidden="true">request_quote</span>
            <h3>${p.nombre || '(sin nombre)'}</h3>
          </div>
          <div><span class="badge">${p.entidad || 'N/A'}</span></div>
        </header>

        <div class="loan-body">
          <div class="meta">
            <div><span class="material-symbols-rounded">account_balance</span> Monto: <b>${money(p.monto_inicial || 0, currency)}</b></div>
            <div><span class="material-symbols-rounded">percent</span> Interés: <b>${interesLabel}</b></div>
            <div><span class="material-symbols-rounded">calendar_month</span> Meses: <b>${mesesLabel}</b></div>
            <div><span class="material-symbols-rounded">schedule</span> Cuota estimada: <b>${cuotaLabel}</b></div>
            <div><span class="material-symbols-rounded">receipt_long</span> Total a pagar: <b>${totalLabel}</b></div>
            <div><span class="material-symbols-rounded">counter_1</span> Cuotas: <b>${cuotasPagadas}</b>/<b>${cuotasRestantes}</b></div>
          </div>

          <div class="kpis">
            <div class="kpi"><div class="k">Pagado este mes</div><div class="v">${money(pagadoMes, currency)}</div></div>
            <div class="kpi"><div class="k">Saldo (aprox)</div><div class="v">${money(saldoRest, currency)}</div></div>
          </div>
        </div>

        <div class="loan-footer">
          <span class="note">Período: ${periodText(period)}</span>
          <div class="actions">
            <button class="btn btn--ghost btn-small" data-action="add-pago" data-id="${p.id}">
              <span class="material-symbols-rounded">payments</span> Registrar pago
            </button>
            <button class="btn btn--ghost btn-small" data-action="edit-prestamo" data-id="${p.id}">
              <span class="material-symbols-rounded">edit</span> Editar
            </button>
            <button class="btn btn--ghost btn-small" data-action="del-prestamo" data-id="${p.id}">
              <span class="material-symbols-rounded">delete</span>
            </button>
          </div>
        </div>
      </section>
    `;
  }));
  cards.innerHTML = htmls.join('');
}

/* =========================
   CRUD — Préstamo
========================= */
function buildPrestamoFormHTML(title, data = {}) {
  const d = data || {};
  const fecha = d.fecha_inicio ? String(d.fecha_inicio).slice(0, 10) : '';
  const interesMensual = (d.interes_mensual != null) ? Number(d.interes_mensual) : '';
  const tasaAnual = (d.tasa_anual != null) ? Number(d.tasa_anual) : '';
  const meses = Number(d.meses_totales ?? d.plazo_meses ?? d.cuotas_totales ?? 0) || '';

  return `
    <form id="f-prestamo" class="form" novalidate>
      <div class="row">
        <div class="input"><label class="required">Nombre</label><input name="nombre" required value="${d.nombre || ''}"></div>
        <div class="input"><label>Entidad</label><input name="entidad" value="${d.entidad || ''}"></div>
        <div class="input"><label class="required">Monto inicial</label>
          <input name="monto_inicial" type="number" min="0" step="0.01" required value="${Number(d.monto_inicial || 0)}">
        </div>
        <div class="input"><label>Saldo actual</label>
          <input name="saldo_actual" type="number" min="0" step="0.01" value="${Number(d.saldo_actual ?? d.monto_inicial ?? 0)}">
        </div>
        <div class="input"><label>Interés mensual (%)</label>
          <input name="interes_mensual" type="number" min="0" step="0.01" value="${interesMensual}">
          <small class="muted">Si usas mensual, deja anual vacío.</small>
        </div>
        <div class="input"><label>Tasa anual (%)</label>
          <input name="tasa_anual" type="number" min="0" step="0.01" value="${tasaAnual}">
          <small class="muted">Compatibilidad con esquema anterior.</small>
        </div>
        <div class="input"><label>Meses (totales)</label>
          <input name="meses_totales" type="number" min="1" step="1" value="${meses}">
        </div>
        <div class="input"><label>Fecha inicio</label>
          <input name="fecha_inicio" type="date" value="${fecha}">
        </div>
      </div>
      <div class="actions-row" style="display:flex;gap:.5rem;margin-top:.75rem">
        <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
        <button type="submit" class="btn">Guardar</button>
      </div>
    </form>
  `;
}

const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

async function tryUpdateOptional(id, obj) {
  try {
    const payload = clean(obj);
    if (Object.keys(payload).length === 0) return;
    await sb.from(TABLE_PRESTAMOS).update(payload).eq('id', id);
  } catch { /* ignorar */ }
}

async function upsertPrestamo({ isEdit, id, form }) {
  const nombre = form.nombre.value.trim();
  const entidad = form.entidad.value.trim() || null;
  const monto_inicial = Number(form.monto_inicial.value || 0);
  const saldo_actual = form.saldo_actual.value ? Number(form.saldo_actual.value) : monto_inicial;
  const fecha_inicio = form.fecha_inicio.value ? toDateOnlyISO(form.fecha_inicio.value) : null;
  const interes_mensual = form.interes_mensual.value ? Number(form.interes_mensual.value) : null;
  const meses_totales = form.meses_totales.value ? Number(form.meses_totales.value) : null;
  const tasa_anual = form.tasa_anual.value ? Number(form.tasa_anual.value) : null;

  if (!nombre || !(monto_inicial >= 0)) throw new Error('Completa nombre y monto inicial');
  if (!meses_totales && !tasa_anual) throw new Error('Indica los meses totales (o la tasa anual como compatibilidad)');
  if (!fecha_inicio) throw new Error('Indica la fecha de inicio');

  const userId = session?.user?.id || null;
  const base = clean({ user_id: userId, nombre, entidad, monto_inicial, saldo_actual, fecha_inicio });

  let newId = id || null;

  if (isEdit) {
    const { error } = await sb.from(TABLE_PRESTAMOS).update(base).eq('id', id);
    if (error) throw error;
    newId = id;
  } else {
    const { data, error } = await sb.from(TABLE_PRESTAMOS).insert([base]).select('id').single();
    if (error) throw error;
    newId = data?.id;
  }

  await tryUpdateOptional(newId, { interes_mensual, meses_totales });
  await tryUpdateOptional(newId, {
    tasa_anual: (tasa_anual ?? (interes_mensual != null ? interes_mensual * 12 : null)),
    plazo_meses: (meses_totales ?? null)
  });
  await tryUpdateOptional(newId, {
    cuotas_totales: (meses_totales ?? null),
    cuotas_restantes: (meses_totales ?? null)
  });
}

function openPrestamoModal({ id = null, data = null } = {}) {
  const isEdit = !!id;
  const title = isEdit ? 'Editar préstamo' : 'Nuevo préstamo';
  const m = openModal({ id: 'modal-prestamo', title, content: buildPrestamoFormHTML(title, data || {}) });
  m.addEventListener('cancel', ev => ev.preventDefault());
  m.addEventListener('click', ev => { if (ev.target === m) ev.stopPropagation(); });

  const form = m.querySelector('#f-prestamo');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await upsertPrestamo({ isEdit, id, form });
      toast.success(isEdit ? 'Préstamo actualizado' : 'Préstamo creado');
      closeModal(m);
      await reload();
    } catch (err) {
      toast.error(err?.message || 'No se pudo guardar');
    }
  });
}

async function deletePrestamo(id) {
  try {
    const { error } = await sb.from(TABLE_PRESTAMOS).delete().eq('id', id);
    if (error) throw error;
    toast.success('Préstamo eliminado');
    await reload();
  } catch (err) { toast.error(err.message || 'No se pudo eliminar'); }
}

/* =========================
   CRUD — Pagos
========================= */
function openPagoModal({ prestamo_id }) {
  const m = openModal({
    id: 'modal-pago',
    title: 'Registrar pago',
    content: `
      <form id="f-pago" class="form" novalidate>
        <div class="input"><label class="required">Fecha</label><input name="fecha" type="date" required></div>
        <div class="input"><label class="required">Monto</label><input name="monto" type="number" min="0" step="0.01" required></div>
        <div class="input"><label>Nota</label><input name="nota" maxlength="140"></div>
        <div class="actions-row" style="display:flex;gap:.5rem;margin-top:.75rem">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn">Guardar</button>
        </div>
      </form>
    `
  });
  m.addEventListener('cancel', ev => ev.preventDefault());
  m.addEventListener('click', ev => { if (ev.target === m) ev.stopPropagation(); });

  const form = m.querySelector('#f-pago');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fecha = form.fecha.value;
    const monto = Number(form.monto.value);
    const nota = form.nota.value.trim() || null;
    if (!fecha || !(monto >= 0)) { toast.error('Fecha y monto requeridos'); return; }

    try {
      const fechaISO = toDateOnlyISO(fecha);
      const payload = { prestamo_id, [PAGOS_DATE_COL]: fechaISO, monto, nota };

      const { error } = await sb.from(TABLE_PAGOS).insert([payload]);
      if (error) throw error;

      toast.success('Pago registrado');
      closeModal(m);
      await reload();
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
    }
  });
}

/* =========================
   EVENTS
========================= */
document.getElementById('btn-new')?.addEventListener('click', () => openPrestamoModal({}));
document.getElementById('btn-new-empty')?.addEventListener('click', () => openPrestamoModal({}));

cards?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]'); if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'edit-prestamo') {
    try {
      const row = await fetchPrestamoOne(id);
      openPrestamoModal({ id, data: row || {} });
    } catch {
      openPrestamoModal({ id, data: {} });
    }
  }
  if (btn.dataset.action === 'del-prestamo') deletePrestamo(id);
  if (btn.dataset.action === 'add-pago') openPagoModal({ prestamo_id: Number(id) });
});

/* =========================
   LOAD / INIT
========================= */
async function reload() {
  try {
    const list = await fetchPrestamos();
    await renderCards(list);
  } catch (err) {
    console.error('fetchPrestamos error:', err);
    cards.innerHTML = '';
    empty.hidden = false;
    toast.error(err.message || 'No se pudo cargar préstamos');
  }
}

(async function init() {
  ({ session } = await requireAuth());
  await resolvePagosDateColumn(); // fija 'fecha_pago' o 'fecha' y evita PGRST204

  const headTitle = document.querySelector('#page-title');
  if (headTitle) headTitle.textContent = `Préstamos — ${periodText(period)}`;

  await reload();

  addEventListener('bpz:month-changed', async (e) => {
    const { year, month } = e.detail || {};
    if (!year || !month) return;
    period = { anio: year, mes: month };
    if (headTitle) headTitle.textContent = `Préstamos — ${periodText(period)}`;
    await reload();
  });

  addEventListener('bpz:currency-changed', () => {
    currency = getCurrency() || 'CRC';
    reload();
  });
})();
