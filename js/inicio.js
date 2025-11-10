/**
 * Inicio (dashboard) — PBZ-FS
 * - Selector Mes/Año persistente (period.js)
 * - Indicador visible del período
 * - Solo lectura: Pagos mensuales, Ahorros, Provisiones
 */

import { requireAuth } from './auth.js';
import { sb } from './supabase.js';
import { toast } from './ui.js';
import { formatCurrencyDynamic, getCurrency } from './utils.js';
import { getCurrentPeriod, setCurrentPeriod } from './period.js';

/* ===================== Estado ===================== */
let session;
let currency = getCurrency() || 'USD';

function safePeriod() {
    const now = new Date();
    let y = now.getFullYear();
    let m = now.getMonth() + 1;
    try {
        const p = (typeof getCurrentPeriod === 'function' ? getCurrentPeriod() : null) || {};
        y = Number.isInteger(p.anio ?? p.year) ? (p.anio ?? p.year) : y;
        m = Number.isInteger(p.mes ?? p.month) ? (p.mes ?? p.month) : m;
    } catch { }
    return { anio: y, mes: m };
}

let period = safePeriod(); // { anio, mes }

/* ===================== Helpers UI ===================== */
const $ = sel => document.querySelector(sel);
const pagosList = $('#pagos-list');
const metasList = $('#metas-list');
const provList = $('#prov-list');

function monthLabel(m) {
    const L = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return L[(m - 1 + 12) % 12] || '—';
}
function periodText(p) { return `${monthLabel(p.mes)} ${p.anio}`; }
function money(n) { return formatCurrencyDynamic(Number(n || 0), currency); }
function nowLocal() { return new Date(); }
function parseISO(s) { return s ? new Date(s) : null; }

const belongsToMe = (row) => {
    if (!row) return false;
    if (!('user_id' in row) && !('owner_id' in row)) return true;
    return row.user_id === session.user.id || row.owner_id === session.user.id;
};

/** Devuelve {label, state} donde state: pending|paid|overdue */
function countdown(fechaCorteISO, pagado) {
    const now = nowLocal();
    const cut = parseISO(fechaCorteISO);
    if (!cut) return { label: '—', state: pagado ? 'paid' : 'pending' };

    const ms = cut - now;
    const days = Math.floor(ms / 86400000);
    if (pagado) return { label: 'Pagado', state: 'paid' };

    if (ms > 0) {
        if (days > 0) return { label: `Faltan ${days} día${days === 1 ? '' : 's'}`, state: 'pending' };
        const hours = Math.max(0, Math.ceil((ms % 86400000) / 3600000));
        return { label: hours > 0 ? `Faltan ${hours}h` : 'Vence hoy', state: 'pending' };
    } else if (ms === 0) {
        return { label: 'Vence hoy', state: 'pending' };
    } else {
        const late = Math.abs(days);
        return { label: `Vencido hace ${late} día${late === 1 ? '' : 's'}`, state: 'overdue' };
    }
}

/* ===================== Período: selects + badges ===================== */
function renderPeriodControls() {
    const selMes = $('#sel-mes');
    const selAnio = $('#sel-anio');
    if (!selMes || !selAnio) return;

    // Mes
    selMes.innerHTML = Array.from({ length: 12 }, (_, i) => i + 1)
        .map(m => `<option value="${m}" ${m === period.mes ? 'selected' : ''}>${monthLabel(m)}</option>`)
        .join('');

    // Año (rango actual ±5)
    const y = new Date().getFullYear();
    const years = [];
    for (let i = y - 5; i <= y + 5; i++) years.push(i);
    selAnio.innerHTML = years
        .map(a => `<option value="${a}" ${a === period.anio ? 'selected' : ''}>${a}</option>`)
        .join('');

    // Chip principal
    const labelEl = $('#period-label');
    if (labelEl) labelEl.textContent = periodText(period);

    // Badge lateral
    const sideBadge = $('#chip-periodo');
    if (sideBadge) sideBadge.textContent = periodText(period);

    // Listener Aplicar
    $('#btn-aplicar')?.addEventListener('click', () => {
        const m = Number(selMes.value);
        const a = Number(selAnio.value);
        applyPeriod(a, m);
    });
}

function applyPeriod(anio, mes) {
    period = { anio: Number(anio), mes: Number(mes) };
    setCurrentPeriod(anio, mes); // persiste y emite 'bpz:period-changed'

    // Alias de evento para compatibilidad con otras páginas
    window.dispatchEvent(
        new CustomEvent('bpz:month-changed', { detail: { month: mes, year: anio } })
    );

    const labelEl = $('#period-label');
    if (labelEl) labelEl.textContent = periodText(period);
    const sideBadge = $('#chip-periodo');
    if (sideBadge) sideBadge.textContent = periodText(period);

    loadAll();
}

/* ===================== Data: Supabase ===================== */
async function fetchPagos() {
    // pagos_mensuales: mes/anio/dia/nombre_pago/monto/estado
    const { data, error } = await sb
        .from('pagos_mensuales')
        .select('id, mes, anio, dia, nombre_pago, monto, estado')
        .eq('user_id', session.user.id)
        .eq('mes', period.mes)
        .eq('anio', period.anio)
        .order('dia', { ascending: true });

    if (error) throw error;
    return data || [];
}

async function fetchAhorros() {
    // Misma tabla que usa ahorros.js
    const { data, error } = await sb
        .from('ahorros')              // 👈 importante
        .select('*')
        .order('id', { ascending: true });

    if (error) throw error;

    // Normalizamos el campo aporte_mensual como en ahorros.js
    return (data || [])
        .filter(belongsToMe)
        .map(r => ({
            ...r,
            aporte_mensual: r.aporte_mensual ?? r.monto ?? null
        }));
}





async function fetchProvisiones() {
    const { data, error } = await sb
        .from('provisiones')
        .select('*')
        .order('nombre', { ascending: true });

    if (error) throw error;
    return (data || []).filter(belongsToMe);
}

/* ====== Helpers para Pagos en el dashboard (solo pendientes) ====== */
function prepararPagosDashboard(rows) {
    const now = nowLocal();
    return (rows || [])
        .map(r => {
            const dia = Number(r.dia || 1);
            const fecha = new Date(period.anio, period.mes - 1, dia);
            const pagado = r.estado === 'realizado';
            const ms = fecha - now; // negativo = vencido, positivo = futuro
            return { ...r, _fecha: fecha, _pagado: pagado, _ms: ms };
        })
        // Solo pagos NO realizados
        .filter(r => !r._pagado)
        // Orden: vencidos primero, luego próximos a vencer (más cercanos primero)
        .sort((a, b) => {
            const aOver = a._ms < 0;
            const bOver = b._ms < 0;
            if (aOver && !bOver) return -1;
            if (!aOver && bOver) return 1;
            // ambos vencidos o ambos futuros → de más antiguo a más cercano
            return a._ms - b._ms;
        });
}

/* ===================== Render: Pagos (solo lectura) ===================== */
function renderPagos(rows) {
    const c = $('#count-pagos');
    if (c) c.textContent = String(rows.length || 0);

    if (!rows.length) {
        pagosList.innerHTML = `<p class="muted">No hay pagos pendientes para ${periodText(period)}.</p>`;
        return;
    }

    pagosList.innerHTML = rows
        .map(r => {
            const dia = Number(r.dia || 1);
            const fecha = new Date(period.anio, period.mes - 1, dia);
            const fechaISO = fecha.toISOString();
            const pagado = r.estado === 'realizado'; // en teoría siempre false aquí
            const { label, state } = countdown(fechaISO, pagado);
            const stateClass = state === 'paid' ? 'paid' : state === 'overdue' ? 'overdue' : 'pending';
            const stateIcon = state === 'paid' ? 'check_circle' : state === 'overdue' ? 'error' : 'schedule';

            return `
        <div class="item" data-id="${r.id}">
          <div>
            <div class="name">${r.nombre_pago}</div>
            <div class="when">${fecha.toLocaleDateString('es-CR')} • ${money(r.monto || 0)}</div>
          </div>
          <span class="state ${stateClass}" title="Estado">
            <span class="material-symbols-rounded" aria-hidden="true">${stateIcon}</span>
            <span>${label}</span>
          </span>
          <div class="actions" aria-hidden="true">
            <!-- Edición solo en la página Pagos mensuales -->
          </div>
        </div>`;
        })
        .join('');
}

/* ===================== Render: Ahorros ===================== */
function renderAhorros(ahorros) {
    const getSaldo = r => Number(r.saldo ?? r.saldo_actual ?? 0);

    // Total = suma de saldos de todos los ahorros
    const total = (ahorros || []).reduce((acc, a) => acc + getSaldo(a), 0);

    const pill = $('#ahorros-total');
    if (pill) {
        pill.innerHTML = `
      <span class="material-symbols-rounded" aria-hidden="true">savings</span>
      ${money(total)}
    `;
    }

    const b = $('#badge-ahorros');
    if (b) b.textContent = money(total);

    if (!ahorros?.length) {
        metasList.innerHTML = `<p class="muted">Sin ahorros registrados.</p>`;
        return;
    }

    metasList.innerHTML = ahorros
        .map(a => {
            const saldo = getSaldo(a);
            const cuota = Number(a.aporte_mensual ?? a.monto ?? 0);

            return `
        <div class="item">
          <div>
            <div class="name">${a.nombre || '(sin nombre)'}</div>
            <div class="when">
              Saldo actual: ${money(saldo)}
              ${cuota ? ` • Cuota mensual: ${money(cuota)}` : ''}
            </div>
          </div>
          <div class="money">${money(saldo)}</div>
          <div class="actions" aria-hidden="true"></div>
        </div>`;
        })
        .join('');
}


/* ===================== Render: Provisiones ===================== */
function renderProvisiones(rows) {
    // Flexibilidad por si las columnas tienen nombres distintos
    const getSaldo = r => Number(
        r.saldo_actual ??
        r.saldo ??
        r.monto_actual ??
        r.acumulado ??
        0
    );
    const getObjetivo = r => Number(
        r.monto_objetivo ??
        r.meta ??
        r.objetivo ??
        r.monto_meta ??
        0
    );
    const getCuota = r => Number(
        r.cuota_mensual ??
        r.aporte_mensual ??
        r.cuota ??
        0
    );

    const total = (rows || []).reduce((acc, r) => acc + getSaldo(r), 0);
    const pill = $('#prov-total');
    if (pill) {
        pill.innerHTML = `<span class="material-symbols-rounded" aria-hidden="true">account_balance_wallet</span>${money(total)}`;
    }
    const b = $('#badge-provisiones');
    if (b) b.textContent = money(total);

    if (!rows?.length) {
        provList.innerHTML = `<p class="muted">Sin provisiones registradas.</p>`;
        return;
    }

    provList.innerHTML = rows
        .map(r => {
            const saldo = getSaldo(r);
            const objetivo = getObjetivo(r);
            const cuota = getCuota(r);

            let detalle;
            if (objetivo > 0) {
                const pct = Math.min(100, Math.round((saldo / objetivo) * 100));
                let cuotasRest = 0;
                if (cuota > 0 && saldo < objetivo) {
                    cuotasRest = Math.ceil((objetivo - saldo) / cuota);
                }
                detalle = `${money(saldo)} de ${money(objetivo)} (${pct}%)`;
                if (cuotasRest > 0) {
                    detalle += ` • Faltan ${cuotasRest} cuota${cuotasRest === 1 ? '' : 's'}`;
                }
            } else {
                detalle = `Saldo actual: ${money(saldo)}`;
            }

            return `
        <div class="item">
          <div>
            <div class="name">${r.nombre}</div>
            <div class="when">${detalle}</div>
          </div>
          <div class="money">${money(saldo)}</div>
          <div class="actions" aria-hidden="true"></div>
        </div>`;
        })
        .join('');
}

/* ===================== Eventos UI ===================== */
// En Inicio ya no modificamos pagos; solo botón de refrescar.
function bindPagosActions() {
    $('#refresh-pagos')?.addEventListener('click', loadPagos);
}

/* ===================== Carga de datos ===================== */
let pagosCache = [];

async function loadPagos() {
    try {
        pagosList.innerHTML = `
      <div class="skeleton" style="height:48px"></div>
      <div class="skeleton" style="height:48px"></div>`;
        const rows = await fetchPagos();
        const pendientes = prepararPagosDashboard(rows);
        pagosCache = pendientes;
        renderPagos(pendientes);
    } catch (err) {
        console.error(err);
        pagosList.innerHTML = `<p class="muted">No se pudieron cargar los pagos.</p>`;
        toast.error(err.message || 'Error al cargar pagos');
    }
}

async function loadAhorros() {
    try {
        metasList.innerHTML = `<div class="skeleton" style="height:64px"></div>`;
        const metas = await fetchAhorros();
        renderAhorros(metas);
    } catch (err) {
        console.error(err);
        metasList.innerHTML = `<p class="muted">No se pudieron cargar los ahorros.</p>`;
        toast.error(err.message || 'Error al cargar ahorros');
    }
}

async function loadProvisiones() {
    try {
        provList.innerHTML = `<div class="skeleton" style="height:48px"></div>`;
        const rows = await fetchProvisiones();
        renderProvisiones(rows);
    } catch (err) {
        console.error(err);
        provList.innerHTML = `<p class="muted">No se pudieron cargar las provisiones.</p>`;
        toast.error(err.message || 'Error al cargar provisiones');
    }
}

async function loadAll() {
    await Promise.all([loadPagos(), loadAhorros(), loadProvisiones()]);
}

/* ===================== Init ===================== */
async function init() {
    ({ session } = await requireAuth());

    renderPeriodControls();
    bindPagosActions();

    // primer render de chips
    const labelEl = $('#period-label');
    if (labelEl) labelEl.textContent = periodText(period);
    const sideBadge = $('#chip-periodo');
    if (sideBadge) sideBadge.textContent = periodText(period);

    await loadAll();

    // cambio de moneda
    window.addEventListener('bpz:currency-changed', e => {
        currency = e.detail?.code || getCurrency() || 'USD';
        renderPagos(pagosCache);
        loadAhorros();
        loadProvisiones();
    });

    // cambios de período (evento "nuevo")
    window.addEventListener('bpz:period-changed', e => {
        const { anio, mes } = e.detail || {};
        if (!anio || !mes) return;
        period = { anio, mes };
        renderPeriodControls();
        loadAll();
    });

    // alias usado por otras páginas
    window.addEventListener('bpz:month-changed', e => {
        const { year, month } = e.detail || {};
        if (!year || !month) return;
        period = { anio: year, mes: month };
        renderPeriodControls();
        loadAll();
    });
}

init().catch(err => {
    console.error(err);
    toast.error('No se pudo iniciar el dashboard');
});
