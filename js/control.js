import { sb } from './supabase.js';
import { requireAuth } from './auth.js';
import { toast, openModal, closeModal } from './ui.js';
import { formatCurrency, formatDate, monthName, toNumber, sum } from './utils.js';
import { getCurrentPeriod } from './period.js';

/* =========================
   MAPEO DE COLUMNAS
========================= */
const USER_COL = 'user_id';
const YEAR_COL = 'periodo_anio';
const MONTH_COL = 'periodo_mes';
const PRESU_COL = 'monto_presupuesto';
const REAL_COL = 'monto_real';

let session;
let period;          // { anio, mes }
let rubros = [];     // presupuesto_items del período
let responsables = [];
let movimientos = [];

// Estado de orden en la tabla de movimientos
let sortCol = 'fecha';
let sortDir = 'desc';

// ===== Helpers UI =====
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const periodText = p => `${monthName(p.mes)} ${p.anio}`;
const setTextSafe = (el, txt) => { if (el) el.textContent = txt; };

/* =========================
   INIT
========================= */
async function init() {
    ({ session } = await requireAuth());

    const p = getCurrentPeriod() || {};
    const now = new Date();
    period = {
        anio: Number.isInteger(p.anio ?? p.year) ? (p.anio ?? p.year) : now.getFullYear(),
        mes: Number.isInteger(p.mes ?? p.month) ? (p.mes ?? p.month) : (now.getMonth() + 1)
    };

    setTextSafe($('#page-title'), `Control mensual — ${periodText(period)}`);
    setTextSafe($('#period-badge'), periodText(period));
    setTextSafe($('#period-label'), periodText(period));

    buildPeriodSelectors();

    await Promise.all([loadRubros(), loadResponsables(), loadMovimientos()]);
    buildRubroSelect();
    buildResponsableSelect();
    renderMovimientos();

    // Listeners
    $('#period-form')?.addEventListener('submit', onApplyPeriod);
    $('#mov-form')?.addEventListener('submit', onSaveMovimiento);
    $('#mov-table')?.addEventListener('click', onTableClick);
    $('#mov-table thead')?.addEventListener('click', onHeaderClick);

    $('#btn-cc-back')?.addEventListener('click', closeCCView);
    $('#cc-add-payment')?.addEventListener('click', openAddPaymentModal);
    $('#refresh')?.addEventListener('click', async () => {
        await loadMovimientos();
        renderMovimientos();
    });

    // Filtros
    $('#filter-text')?.addEventListener('input', renderMovimientos);
    $('#filter-medio')?.addEventListener('change', renderMovimientos);

    // Cuando se abre el panel de tarjeta desde la barra lateral, cargamos la tarjeta
    document.querySelector('.sidelink[data-section="tarjeta"]')
        ?.addEventListener('click', () => { setTimeout(openCCView, 0); });

    // Si entramos directamente a control.html#tarjeta
    if (location.hash === '#tarjeta') {
        openCCView();
    }

    // Cambio global de período
    window.addEventListener('bpz:month-changed', async (e) => {
        const { month, year } = e.detail || {};
        if (!month || !year) return;
        period = { mes: month, anio: year };
        setTextSafe($('#page-title'), `Control mensual — ${periodText(period)}`);
        setTextSafe($('#period-badge'), periodText(period));
        setTextSafe($('#period-label'), periodText(period));

        await Promise.all([loadRubros(), loadMovimientos()]);
        buildRubroSelect();
        renderMovimientos();

        const panelTarjeta = document.querySelector('#panel-tarjeta');
        if (panelTarjeta && !panelTarjeta.hasAttribute('hidden')) {
            openCCView();
        }
    });
}

/* =========================
   Período header (selector)
========================= */
function buildPeriodSelectors() {
    const msel = $('#period-month');
    const ysel = $('#period-year');
    if (!msel || !ysel) return;

    const meses = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    msel.innerHTML = meses.map((m, i) =>
        `<option value="${i + 1}" ${period.mes === i + 1 ? 'selected' : ''}>${monthName(i + 1)}</option>`
    ).join('');

    const ycur = new Date().getFullYear();
    const years = [];
    for (let y = ycur - 5; y <= ycur + 5; y++) years.push(y);
    ysel.innerHTML = years.map(y =>
        `<option value="${y}" ${period.anio === y ? 'selected' : ''}>${y}</option>`
    ).join('');
}

function onApplyPeriod(ev) {
    ev.preventDefault();
    const month = Number($('#period-month').value);
    const year = Number($('#period-year').value);
    localStorage.setItem('bpz_period_month', String(month));
    localStorage.setItem('bpz_period_year', String(year));
    window.dispatchEvent(new CustomEvent('bpz:month-changed', { detail: { month, year } }));
}

/* =========================
   Cargas Supabase
========================= */
async function loadRubros() {
    try {
        const { data, error } = await sb.from('presupuesto_items')
            .select(`id,seccion,rubro,${PRESU_COL},${REAL_COL}`)
            .eq(USER_COL, session.user.id)
            .eq(YEAR_COL, period.anio)
            .eq(MONTH_COL, period.mes)
            .order('id', { ascending: true });
        if (error) throw error;

        rubros = (data || []).map(r => ({
            id: r.id,
            seccion: r.seccion || null,
            rubro: r.rubro || '',
            objetivo: toNumber(r[PRESU_COL]),
            real: toNumber(r[REAL_COL] || 0),
        }));
    } catch (err) {
        console.error(err);
        toast.error('No se pudieron cargar rubros');
        rubros = [];
    }
}

async function loadResponsables() {
    try {
        const { data, error } = await sb.from('usuarios_presupuesto')
            .select('id,nombre')
            .eq(USER_COL, session.user.id)
            .eq('is_archived', false)
            .order('id', { ascending: true });
        if (error) throw error;
        responsables = data || [];
    } catch (err) {
        console.error(err);
        toast.error('No se pudieron cargar usuarios/responsables');
        responsables = [];
    }
}

async function loadMovimientos() {
    try {
        const { data, error } = await sb.from('movimientos')
            .select('*')
            .eq(USER_COL, session.user.id)
            .eq(YEAR_COL, period.anio)
            .eq(MONTH_COL, period.mes)
            .order('fecha', { ascending: false })
            .order('id', { ascending: false });
        if (error) throw error;
        movimientos = data || [];
    } catch (err) {
        console.error(err);
        toast.error('No se pudieron cargar movimientos');
        movimientos = [];
    }
}

/* =========================
   Selects: rubro / responsable
========================= */
function buildResponsableSelect() {
    const el = $('#mov-resp');
    if (!el) return;
    el.innerHTML = responsables.map(r => `<option value="${r.id}">${r.nombre}</option>`).join('');
}

function buildRubroSelect() {
    const el = $('#mov-rubro');
    if (!el) return;

    const group = sec => rubros.filter(r => r.seccion === sec);
    const opt = (v, t) => `<option value='${v}'>${t}</option>`;
    const optg = (lbl, body) => `<optgroup label="${lbl}">${body}</optgroup>`;

    const ingresos = group('ingresos')
        .filter(r => r.rubro && r.rubro.trim() !== 'Ingresos')
        .map(r => opt(JSON.stringify({ t: 'ingreso', id: r.id, name: r.rubro }), r.rubro))
        .join('');

    const ahorros = group('ahorros');
    const provis = group('provisiones');

    const ahorrosGroup = opt(JSON.stringify({ t: 'ahorro_group' }), 'Ahorros (distribuir proporcional)') +
        ahorros.map(r =>
            opt(JSON.stringify({ t: 'ahorro', id: r.id, name: r.rubro, objetivo: r.objetivo }), `Ahorro: ${r.rubro}`)
        ).join('');

    const provisGroup = opt(JSON.stringify({ t: 'provision_group' }), 'Provisiones (distribuir proporcional)') +
        provis.map(r =>
            opt(JSON.stringify({ t: 'provision', id: r.id, name: r.rubro, objetivo: r.objetivo }), `Provisión: ${r.rubro}`)
        ).join('');

    const gf = group('gastos_fijos').map(r =>
        opt(JSON.stringify({ t: 'gasto_fijo', id: r.id, name: r.rubro }), r.rubro)
    ).join('');
    const gv = group('gastos_variables').map(r =>
        opt(JSON.stringify({ t: 'gasto_variable', id: r.id, name: r.rubro }), r.rubro)
    ).join('');
    const imp = group('imprevistos').map(r =>
        opt(JSON.stringify({ t: 'imprevisto', id: r.id, name: r.rubro }), r.rubro)
    ).join('');

    el.innerHTML =
        `<option value="" disabled selected>Selecciona un rubro…</option>` +
        optg('Ingresos', ingresos || '<option disabled>— Sin ítems —</option>') +
        optg('Ahorros', ahorrosGroup || '<option disabled>— Sin ítems —</option>') +
        optg('Provisiones', provisGroup || '<option disabled>— Sin ítems —</option>') +
        optg('Gastos fijos', gf || '<option disabled>— Sin ítems —</option>') +
        optg('Gastos variables', gv || '<option disabled>— Sin ítems —</option>') +
        optg('Imprevistos', imp || '<option disabled>— Sin ítems —</option>');
}

/* =========================
   Guardar movimiento
========================= */
async function onSaveMovimiento(ev) {
    ev.preventDefault();
    const fecha = $('#mov-fecha').value;
    const descripcion = ($('#mov-desc').value || '').trim();

    const selVal = $('#mov-rubro').value;
    let rubroSel = null;
    try { rubroSel = selVal ? JSON.parse(selVal) : null; } catch { rubroSel = null; }
    if (!rubroSel) return showErr('rubro', 'Selecciona un rubro');

    const responsable_id = Number($('#mov-resp').value);
    const responsable_nombre = responsables.find(r => r.id === responsable_id)?.nombre || '';
    const medio_pago = $('#mov-medio').value;
    const monto = toNumber($('#mov-monto').value);

    clearErrors();
    const fDate = new Date(fecha + 'T00:00:00');
    const firstDay = new Date(period.anio, period.mes - 1, 1);
    const lastDay = new Date(period.anio, period.mes, 0);
    if (!fecha) return showErr('fecha', 'Requerida');
    if (fDate < firstDay || fDate > lastDay) return showErr('fecha', 'La fecha debe estar dentro del período activo');
    if (!descripcion) return showErr('descripcion', 'Requerida');
    if (!rubroSel) return showErr('rubro', 'Selecciona un rubro');
    if (!(monto >= 0)) return showErr('monto', 'Monto inválido');

    const tipoPreferido = (rubroSel.t === 'ingreso') ? 'Ingreso' : 'Egreso';

    const baseParcial = {
        [USER_COL]: session.user.id,
        [YEAR_COL]: period.anio,
        [MONTH_COL]: period.mes,
        fecha, descripcion,
        rubro_tipo: rubroSel.t,
        rubro_id: rubroSel.id || null,
        rubro_nombre: rubroSel.name || null,
        responsable_id, responsable_nombre,
        medio_pago, monto
    };

    try {
        let { error: e1 } = await sb.from('movimientos').insert([{ ...baseParcial, tipo: tipoPreferido }]);
        if (e1 && String(e1.message || '').includes('check constraint')) {
            const tipoFallback = (rubroSel.t === 'ingreso') ? 'ingreso' : 'egreso';
            const res2 = await sb.from('movimientos').insert([{ ...baseParcial, tipo: tipoFallback }]);
            e1 = res2.error || null;
        }
        if (e1) throw e1;

        await applyImpactToBudget(rubroSel, monto);

        toast.success('Movimiento guardado');
        $('#mov-form')?.reset();

        await loadMovimientos();
        renderMovimientos();

        window.dispatchEvent(new CustomEvent('bpz:mov-updated', { detail: { period } }));
    } catch (err) {
        console.error(err);
        toast.error(err.message || 'No se pudo guardar');
    }
}

function showErr(field, msg) {
    const box = $(`.input__error[data-for="${field}"]`);
    if (box) box.textContent = msg;
    toast.error(msg);
}
function clearErrors() { $$('.input__error').forEach(n => n.textContent = ''); }

/* =========================
   Impacto a presupuesto + ahorros/provisiones
========================= */
async function applyImpactToBudget(rubroSel, monto) {
    const updateOne = async (id, delta) => {
        const { data: cur, error: e0 } = await sb.from('presupuesto_items')
            .select(`${REAL_COL}`)
            .eq('id', id)
            .maybeSingle();
        if (e0) throw e0;
        const nuevo = toNumber(cur?.[REAL_COL]) + toNumber(delta);
        const { error: e2 } = await sb.from('presupuesto_items')
            .update({ [REAL_COL]: nuevo, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (e2) throw e2;
    };

    // Rubros simples
    if (['ingreso', 'gasto_fijo', 'gasto_variable', 'imprevisto', 'ahorro', 'provision']
        .includes(rubroSel.t) && rubroSel.id) {

        await updateOne(rubroSel.id, monto);

        // Ahorro / Provisión → actualizar saldo en tablas ahorros / provisiones
        if (rubroSel.t === 'ahorro' || rubroSel.t === 'provision') {
            await applyImpactToSavings(rubroSel, monto);
        }
        return;
    }

    // Grupos (distribución proporcional)
    if (rubroSel.t === 'ahorro_group') {
        const items = rubros.filter(r => r.seccion === 'ahorros');
        await distributeProportionally(items, monto);
        await distributeToSavingsAccounts(items, monto, 'ahorro');
    } else if (rubroSel.t === 'provision_group') {
        const items = rubros.filter(r => r.seccion === 'provisiones');
        await distributeProportionally(items, monto);
        await distributeToSavingsAccounts(items, monto, 'provision');
    }
}

async function distributeProportionally(items, total) {
    const objetivos = items.map(i => ({ id: i.id, objetivo: toNumber(i.objetivo) }));
    const sumObj = objetivos.reduce((a, b) => a + (b.objetivo || 0), 0);

    if (sumObj <= 0) {
        const eq = total / (objetivos.length || 1);
        for (let i = 0; i < objetivos.length; i++) {
            const delta = (i === objetivos.length - 1)
                ? (total - eq * (objetivos.length - 1))
                : eq;
            await addReal(objetivos[i].id, delta);
        }
        return;
    }

    let acumulado = 0;
    for (let i = 0; i < objetivos.length; i++) {
        const peso = objetivos[i].objetivo / sumObj;
        let asignado = Math.round((total * peso) * 100) / 100;
        if (i === objetivos.length - 1) asignado = Math.round((total - acumulado) * 100) / 100;
        acumulado += asignado;
        await addReal(objetivos[i].id, asignado);
    }

    async function addReal(id, delta) {
        const { data: cur, error: e0 } = await sb.from('presupuesto_items')
            .select(`${REAL_COL}`)
            .eq('id', id)
            .maybeSingle();
        if (e0) throw e0;
        const nuevo = toNumber(cur?.[REAL_COL]) + toNumber(delta);
        const { error: e2 } = await sb.from('presupuesto_items')
            .update({ [REAL_COL]: nuevo, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (e2) throw e2;
    }
}

// ---- impacto en tablas ahorros / provisiones ----
async function updateSaldoByName(table, nombre, delta) {
    if (!nombre || !delta) return;
    try {
        const { data: cur, error: e0 } = await sb.from(table)
            .select('id,saldo')
            .eq('user_id', session.user.id)
            .eq('nombre', nombre)
            .maybeSingle();
        if (e0) throw e0;
        if (!cur) return;

        const nuevo = toNumber(cur.saldo || 0) + toNumber(delta);
        const { error: e2 } = await sb.from(table)
            .update({ saldo: nuevo })
            .eq('id', cur.id);
        if (e2) throw e2;
    } catch (err) {
        console.error('No se pudo actualizar saldo en', table, err);
    }
}

async function applyImpactToSavings(rubroSel, delta) {
    if (!delta) return;
    if (rubroSel.t === 'ahorro') {
        await updateSaldoByName('ahorros', rubroSel.name || rubroSel.rubro_nombre, delta);
    } else if (rubroSel.t === 'provision') {
        await updateSaldoByName('provisiones', rubroSel.name || rubroSel.rubro_nombre, delta);
    }
}

// Distribución hacia varias cuentas de ahorro / provisión
async function distributeToSavingsAccounts(items, total, kind) {
    if (!items.length || !total) return;

    const objetivos = items.map(i => ({ nombre: i.rubro, objetivo: toNumber(i.objetivo) }));
    const sumObj = objetivos.reduce((a, b) => a + (b.objetivo || 0), 0);
    const table = (kind === 'ahorro') ? 'ahorros' : 'provisiones';

    if (sumObj <= 0) {
        const eq = total / (objetivos.length || 1);
        let acumulado = 0;
        for (let i = 0; i < objetivos.length; i++) {
            let delta = eq;
            if (i === objetivos.length - 1) {
                delta = total - acumulado;
            }
            acumulado += delta;
            await updateSaldoByName(table, objetivos[i].nombre, delta);
        }
        return;
    }

    let acumulado = 0;
    for (let i = 0; i < objetivos.length; i++) {
        const peso = objetivos[i].objetivo / sumObj;
        let asignado = Math.round((total * peso) * 100) / 100;
        if (i === objetivos.length - 1) {
            asignado = Math.round((total - acumulado) * 100) / 100;
        }
        acumulado += asignado;
        await updateSaldoByName(table, objetivos[i].nombre, asignado);
    }
}

/* =========================
   Tabla de movimientos
========================= */
function renderMovimientos() {
    const tbody = $('#mov-tbody');
    if (!tbody) return;

    let list = movimientos.slice();
    const q = ($('#filter-text')?.value || '').toLowerCase();
    const medio = $('#filter-medio')?.value || '';

    if (q) {
        list = list.filter(m =>
            (m.descripcion || '').toLowerCase().includes(q) ||
            (m.rubro_nombre || '').toLowerCase().includes(q)
        );
    }
    if (medio) {
        list = list.filter(m => m.medio_pago === medio);
    }

    list = sortMovList(list);

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="muted">Sin movimientos</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(m => `
    <tr data-id="${m.id}">
      <td>${formatDate(m.fecha)}</td>
      <td>${m.descripcion}</td>
      <td>${m.rubro_nombre || nicifyType(m.rubro_tipo)}</td>
      <td>${m.responsable_nombre || '—'}</td>
      <td>${m.medio_pago}</td>
      <td class="right">${formatCurrency(m.monto)}</td>
      <td class="right">
        <button class="btn-icon" data-action="edit" title="Editar">
          <span class="material-symbols-rounded">edit</span>
        </button>
        <button class="btn-icon" data-action="delete" title="Eliminar">
          <span class="material-symbols-rounded">delete</span>
        </button>
      </td>
    </tr>
  `).join('');
    // Al final de renderMovimientos (después de construir todas las filas)
    syncMovCardsFromTable();

}

function nicifyType(t) {
    const map = {
        ingreso: 'Ingresos',
        ahorro: 'Ahorro',
        provision: 'Provisión',
        gasto_fijo: 'Gasto fijo',
        gasto_variable: 'Gasto variable',
        imprevisto: 'Imprevisto',
        ahorro_group: 'Ahorros',
        provision_group: 'Provisiones'
    };
    return map[t] || t;
}

function onTableClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const tr = btn.closest('tr[data-id]');
    const id = Number(tr.dataset.id);
    const row = movimientos.find(m => m.id === id);
    if (!row) return;

    if (btn.dataset.action === 'edit') openEditMovModal(row);
    if (btn.dataset.action === 'delete') openDeleteMovModal(row);
}

// Click en encabezados para ordenar (requiere data-sort-key en el HTML)
function onHeaderClick(e) {
    const th = e.target.closest('th[data-sort-key]');
    if (!th) return;

    const key = th.dataset.sortKey;
    if (!key) return;

    if (sortCol === key) {
        sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
    } else {
        sortCol = key;
        sortDir = (key === 'fecha' || key === 'monto') ? 'desc' : 'asc';
    }

    renderMovimientos();
}

function sortMovList(list) {
    if (!sortCol) return list;
    const dir = sortDir === 'asc' ? 1 : -1;

    const cmpText = (a, b) => {
        a = (a || '').toString().toLowerCase();
        b = (b || '').toString().toLowerCase();
        if (a < b) return -1 * dir;
        if (a > b) return 1 * dir;
        return 0;
    };

    list.sort((a, b) => {
        switch (sortCol) {
            case 'fecha':
                return cmpText(a.fecha, b.fecha);
            case 'descripcion':
                return cmpText(a.descripcion, b.descripcion);
            case 'rubro':
                return cmpText(
                    a.rubro_nombre || nicifyType(a.rubro_tipo),
                    b.rubro_nombre || nicifyType(b.rubro_tipo)
                );
            case 'responsable':
                return cmpText(a.responsable_nombre, b.responsable_nombre);
            case 'medio':
                return cmpText(a.medio_pago, b.medio_pago);
            case 'monto': {
                const va = toNumber(a.monto);
                const vb = toNumber(b.monto);
                if (va === vb) return 0;
                return va < vb ? -1 * dir : 1 * dir;
            }
            default:
                return 0;
        }
    });

    return list;
}

/* =========================
   Editar / eliminar movimiento
========================= */
function openEditMovModal(row) {
    const m = openModal({
        title: 'Editar movimiento',
        content: `<form id="edit-form" class="vstack" novalidate>
      <div class="input"><label>Fecha</label><input name="fecha" type="date" value="${row.fecha}"></div>
      <div class="input"><label>Descripción</label><input name="descripcion" type="text" value="${row.descripcion || ''}"></div>
      <div class="input"><label>Monto</label><input name="monto" type="number" min="0" step="0.01" value="${row.monto}"></div>
      <div class="actions-row">
        <button class="btn btn--ghost" type="button" data-close>Cancelar</button>
        <button class="btn" type="submit">Guardar</button>
      </div>
    </form>`
    });
    m.querySelector('#edit-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = ev.currentTarget;
        const fecha = f.fecha.value || row.fecha;
        const descripcion = (f.descripcion.value || '').trim() || row.descripcion;
        const monto = toNumber(f.monto.value);
        try {
            if (monto !== row.monto) {
                await applyImpactToBudget(
                    { t: row.rubro_tipo, id: row.rubro_id, name: row.rubro_nombre },
                    (monto - row.monto)
                );
            }

            const { error } = await sb.from('movimientos').update({ fecha, descripcion, monto }).eq('id', row.id);
            if (error) throw error;
            Object.assign(row, { fecha, descripcion, monto });
            renderMovimientos();
            toast.success('Actualizado');
            closeModal(m);
            window.dispatchEvent(new CustomEvent('bpz:mov-updated', { detail: { period } }));
        } catch (err) { toast.error(err.message || 'No se pudo actualizar'); }
    });
}

function openDeleteMovModal(row) {
    const m = openModal({
        title: 'Eliminar movimiento',
        content: `<p>¿Eliminar el movimiento “${row.descripcion}”?</p>
      <div class="actions-row">
        <button class="btn btn--ghost" data-close>Cancelar</button>
        <button class="btn" id="confirm-del">Eliminar</button>
      </div>`
    });
    m.querySelector('#confirm-del').addEventListener('click', async () => {
        try {
            await applyImpactToBudget(
                { t: row.rubro_tipo, id: row.rubro_id, name: row.rubro_nombre },
                -row.monto
            );

            const { error } = await sb.from('movimientos').delete().eq('id', row.id);
            if (error) throw error;
            movimientos = movimientos.filter(mv => mv.id !== row.id);
            renderMovimientos();
            toast.success('Eliminado');
            closeModal(m);
            window.dispatchEvent(new CustomEvent('bpz:mov-updated', { detail: { period } }));
        } catch (err) { toast.error(err.message || 'No se pudo eliminar'); }
    });
}

/* =========================
   Tarjeta de crédito
========================= */
let ccConsumos = [];
let ccPagos = [];
let ccAplic = [];

function openCCView() {
    setTextSafe($('#cc-period'), periodText(period));
    loadCC().then(renderCC);
}

function closeCCView() {
    // reservado por si más adelante quieres hacer algo al cerrar
}

async function loadCC() {
    try {
        const { data: cons, error: e1 } = await sb.from('movimientos')
            .select('*')
            .eq(USER_COL, session.user.id)
            .eq(YEAR_COL, period.anio)
            .eq(MONTH_COL, period.mes)
            .eq('medio_pago', 'Tarjeta de crédito')
            .order('fecha', { ascending: true })
            .order('id', { ascending: true });
        if (e1) throw e1;
        ccConsumos = cons || [];

        const { data: pagos, error: e2 } = await sb.from('tarjeta_pagos')
            .select('*')
            .eq(USER_COL, session.user.id)
            .eq(YEAR_COL, period.anio)
            .eq(MONTH_COL, period.mes)
            .order('fecha', { ascending: true });
        if (e2) throw e2;
        ccPagos = pagos || [];

        const ids = ccConsumos.map(c => c.id);
        const { data: det, error: e3 } = await sb.from('tarjeta_detalle_aplicacion')
            .select('*')
            .in('consumo_mov_id', ids.length ? ids : [-1]);
        if (e3) throw e3;
        ccAplic = det || [];
    } catch (err) {
        console.error(err);
        toast.error('No se pudo cargar datos de tarjeta');
        ccConsumos = []; ccPagos = []; ccAplic = [];
    }
}

function renderCC() {
    const tbody = $('#cc-tbody');
    if (!tbody) return;

    if (!ccConsumos.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="muted">No hay consumos con tarjeta este período.</td></tr>`;
    } else {
        tbody.innerHTML = ccConsumos.map(c => {
            const aplicado = sum(ccAplic.filter(a => a.consumo_mov_id === c.id), 'monto_aplicado');
            const saldo = toNumber(c.monto) - aplicado;
            let estadoCls = 'badge--red', estadoTxt = 'pendiente';
            if (aplicado > 0 && saldo > 0) { estadoCls = 'badge--orange'; estadoTxt = 'abonado'; }
            if (saldo <= 0.0001) { estadoCls = 'badge--green'; estadoTxt = 'cancelado'; }
            return `<tr>
        <td>${formatDate(c.fecha)}</td>
        <td>${c.descripcion}</td>
        <td class="right">${formatCurrency(c.monto)}</td>
        <td><span class="badge ${estadoCls}">${estadoTxt}</span></td>
      </tr>`;
        }).join('');
    }

    const ptbody = $('#cc-payments-tbody');
    if (ptbody) {
        if (!ccPagos.length) {
            ptbody.innerHTML = `<tr><td colspan="4" class="muted">No hay pagos registrados.</td></tr>`;
        } else {
            ptbody.innerHTML = ccPagos.map(p => `
        <tr data-id="${p.id}">
          <td>${formatDate(p.fecha)}</td>
          <td>${p.nota || '—'}</td>
          <td class="right">${formatCurrency(p.monto)}</td>
          <td class="right">
            <button class="btn-icon" data-action="edit-pay">
              <span class="material-symbols-rounded">edit</span>
            </button>
            <button class="btn-icon" data-action="del-pay">
              <span class="material-symbols-rounded">delete</span>
            </button>
          </td>
        </tr>`).join('');
            $('#cc-payments-table')?.addEventListener('click', onCCPaymentsClick, { once: true });
        }
    }

    setTextSafe($('#cc-total-consumos'), formatCurrency(sum(ccConsumos, 'monto')));
    const aplicadoTotal = sum(ccAplic, 'monto_aplicado');
    setTextSafe($('#cc-total-pagado'), formatCurrency(aplicadoTotal));
    const saldo = Math.max(0, sum(ccConsumos, 'monto') - aplicadoTotal);
    setTextSafe($('#cc-total-saldo'), formatCurrency(saldo));
}

function onCCPaymentsClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const tr = btn.closest('tr[data-id]');
    const id = Number(tr.dataset.id);
    const row = ccPagos.find(p => p.id === id);
    if (!row) return;

    if (btn.dataset.action === 'edit-pay') openEditPaymentModal(row);
    if (btn.dataset.action === 'del-pay') openDeletePaymentModal(row);
}

function openAddPaymentModal() {
    const m = openModal({
        title: 'Registrar pago a tarjeta',
        content: `<form id="pay-form" class="vstack" novalidate>
      <div class="input"><label>Fecha</label><input name="fecha" type="date" required></div>
      <div class="input"><label>Monto</label><input name="monto" type="number" min="0" step="0.01" required></div>
      <div class="input"><label>Responsable</label>
        <select name="resp">${responsables.map(r => `<option value="${r.id}">${r.nombre}</option>`).join('')}</select>
      </div>
      <div class="input"><label>Nota</label><input name="nota" type="text" placeholder="Opcional"></div>
      <div class="actions-row">
        <button class="btn btn--ghost" type="button" data-close>Cancelar</button>
        <button class="btn" type="submit">Guardar</button>
      </div>
    </form>`
    });

    m.querySelector('#pay-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = ev.currentTarget;
        const fecha = f.fecha.value;
        const monto = toNumber(f.monto.value);
        const responsable_id = Number(f.resp.value);
        const nota = f.nota.value.trim() || null;
        if (!fecha || !(monto > 0)) { toast.error('Datos inválidos'); return; }

        try {
            const payload = {
                [USER_COL]: session.user.id,
                [YEAR_COL]: period.anio,
                [MONTH_COL]: period.mes,
                fecha,
                monto,
                responsable_id,
                nota
            };
            const { data: pago, error: e1 } = await sb.from('tarjeta_pagos')
                .insert([payload])
                .select()
                .maybeSingle();
            if (e1) throw e1;

            let restante = monto;
            for (const c of ccConsumos) {
                if (restante <= 0) break;
                const aplicado = sum(ccAplic.filter(a => a.consumo_mov_id === c.id), 'monto_aplicado');
                const saldo = toNumber(c.monto) - aplicado;
                if (saldo <= 0) continue;
                const aplicar = Math.min(restante, saldo);
                const { error: e2 } = await sb.from('tarjeta_detalle_aplicacion')
                    .insert([{ pago_id: pago.id, consumo_mov_id: c.id, monto_aplicado: aplicar }]);
                if (e2) throw e2;
                restante -= aplicar;
            }

            toast.success('Pago registrado');
            closeModal(m);
            await loadCC(); renderCC();
        } catch (err) { toast.error(err.message || 'No se pudo registrar el pago'); }
    });
}

function openEditPaymentModal(row) {
    const m = openModal({
        title: 'Editar pago',
        content: `<form id="pay-edit" class="vstack">
      <div class="input"><label>Fecha</label><input name="fecha" type="date" value="${row.fecha}"></div>
      <div class="input"><label>Monto</label><input name="monto" type="number" min="0" step="0.01" value="${row.monto}"></div>
      <div class="input"><label>Nota</label><input name="nota" type="text" value="${row.nota || ''}"></div>
      <div class="actions-row">
        <button class="btn btn--ghost" type="button" data-close>Cancelar</button>
        <button class="btn" type="submit">Guardar</button>
      </div>
    </form>`
    });
    m.querySelector('#pay-edit').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = ev.currentTarget;
        const fecha = f.fecha.value || row.fecha;
        const monto = toNumber(f.monto.value);
        const nota = f.nota.value.trim() || null;

        try {
            const { error: e0 } = await sb.from('tarjeta_detalle_aplicacion')
                .delete()
                .eq('pago_id', row.id);
            if (e0) throw e0;

            const { error: e1 } = await sb.from('tarjeta_pagos')
                .update({ fecha, monto, nota })
                .eq('id', row.id);
            if (e1) throw e1;

            let restante = monto;
            for (const c of ccConsumos) {
                if (restante <= 0) break;
                const aplicado = sum(
                    ccAplic.filter(a => a.pago_id !== row.id && a.consumo_mov_id === c.id),
                    'monto_aplicado'
                );
                const saldo = Math.max(0, toNumber(c.monto) - aplicado);
                if (saldo <= 0) continue;
                const aplicar = Math.min(restante, saldo);
                if (aplicar > 0) {
                    const { error: e2 } = await sb.from('tarjeta_detalle_aplicacion')
                        .insert([{ pago_id: row.id, consumo_mov_id: c.id, monto_aplicado: aplicar }]);
                    if (e2) throw e2;
                    restante -= aplicar;
                }
            }
            toast.success('Pago actualizado');
            closeModal(m);
            await loadCC(); renderCC();
        } catch (err) { toast.error(err.message || 'No se pudo actualizar el pago'); }
    });
}

function openDeletePaymentModal(row) {
    const m = openModal({
        title: 'Eliminar pago',
        content: `<p>¿Eliminar el pago del ${formatDate(row.fecha)} por ${formatCurrency(row.monto)}?</p>
      <div class="actions-row">
        <button class="btn btn--ghost" data-close>Cancelar</button>
        <button class="btn" id="confirm-del-pay">Eliminar</button>
      </div>`
    });
    m.querySelector('#confirm-del-pay').addEventListener('click', async () => {
        try {
            const { error: e1 } = await sb.from('tarjeta_detalle_aplicacion')
                .delete()
                .eq('pago_id', row.id);
            if (e1) throw e1;
            const { error: e2 } = await sb.from('tarjeta_pagos')
                .delete()
                .eq('id', row.id);
            if (e2) throw e2;
            toast.success('Pago eliminado');
            closeModal(m);
            await loadCC(); renderCC();
        } catch (err) { toast.error(err.message || 'No se pudo eliminar'); }
    });
}

function syncMovCardsFromTable() {
    const container = document.getElementById('mov-cards');
    const tbody = document.getElementById('mov-tbody');
    if (!container || !tbody) return;

    container.innerHTML = '';

    const rows = Array.from(tbody.querySelectorAll('tr'));
    // Filtramos filas "vacías" tipo "Cargando…" o "Sin movimientos"
    const dataRows = rows.filter(tr => !tr.querySelector('.muted'));

    if (!dataRows.length) {
        container.innerHTML = '<p class="muted">Sin movimientos en este período.</p>';
        return;
    }

    dataRows.forEach(tr => {
        const cells = tr.querySelectorAll('td');
        const fecha = (cells[0]?.textContent || '').trim();
        const desc = (cells[1]?.textContent || '').trim();
        const rubro = (cells[2]?.textContent || '').trim();
        const resp = (cells[3]?.textContent || '').trim();
        const medio = (cells[4]?.textContent || '').trim();
        const monto = (cells[5]?.textContent || '').trim();

        // OJO: aquí usamos data-action, igual que en la tabla
        const btnEditTable = tr.querySelector('[data-action="edit"]');
        const btnDelTable = tr.querySelector('[data-action="delete"]');

        const card = document.createElement('article');
        card.className = 'mov-card';

        card.innerHTML = `
      <header class="mov-card__head">
        <span class="mov-card__date">${fecha}</span>
        <span class="mov-card__amount">${monto}</span>
      </header>
      <div class="mov-card__desc" title="${escapeHtml(desc)}">${escapeHtml(desc)}</div>
      <div class="mov-card__meta">
        <span>${escapeHtml(rubro)}</span>
        <span class="dot">•</span>
        <span>${escapeHtml(resp)}</span>
        <span class="dot">•</span>
        <span>${escapeHtml(medio)}</span>
      </div>
      <div class="mov-card__actions">
        <button type="button" class="btn-icon" aria-label="Editar movimiento">
          <span class="material-symbols-rounded">edit</span>
        </button>
        <button type="button" class="btn-icon" aria-label="Eliminar movimiento">
          <span class="material-symbols-rounded">delete</span>
        </button>
      </div>
    `;

        const [btnEditCard, btnDelCard] = card.querySelectorAll('.mov-card__actions .btn-icon');

        // Reutilizamos los handlers existentes de la tabla
        btnEditCard.addEventListener('click', () => btnEditTable?.click());
        btnDelCard.addEventListener('click', () => btnDelTable?.click());

        container.appendChild(card);
    });
}


// Helper mínimo para escapar texto
function escapeHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* =========================
   GO!
========================= */
init().catch(err => {
    console.error(err);
    toast.error('No se pudo iniciar Control mensual');
});
