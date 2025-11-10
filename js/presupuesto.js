// js/presupuesto.js
import { requireAuth } from './auth.js';
import { sb } from './supabase.js';
import { openModal, closeModal, toast } from './ui.js';
import { getCurrentPeriod } from './period.js';
import { formatCurrencyDynamic as money, getCurrency } from './utils.js';

/* =========================
   MAPEO SEGÚN TU ESQUEMA REAL
========================= */
const TBL = 'presupuesto_items';
const USER_COL = 'user_id';
const YEAR_COL = 'periodo_anio';
const MONTH_COL = 'periodo_mes';
const SECC_COL = 'seccion';
const RUBRO_COL = 'rubro';
const PRESU_COL = 'monto_presupuesto';
const REAL_COL = 'monto_real';

/* SECCIONES CANÓNICAS */
const SEC = {
    INGRESOS: 'ingresos',
    AHORROS: 'ahorros',
    PROVISIONES: 'provisiones',
    GASTOS_FIJOS: 'gastos_fijos',
    GASTOS_VARIABLES: 'gastos_variables',
    IMPREVISTOS: 'imprevistos',
};

// Solo estas secciones se pueden crear desde aquí (para ingresos extra)
const EDITABLE_SECTIONS = new Set([SEC.INGRESOS, SEC.GASTOS_VARIABLES, SEC.IMPREVISTOS]);

let session;
let currency = getCurrency() || 'CRC';

/* Período seguro */
let period = (() => {
    try {
        const p = (typeof getCurrentPeriod === 'function' ? getCurrentPeriod() : null) || {};
        const now = new Date();
        const y = Number.isInteger(p.anio ?? p.year) ? (p.anio ?? p.year) : now.getFullYear();
        const m = Number.isInteger(p.mes ?? p.month) ? (p.mes ?? p.month) : (now.getMonth() + 1);
        return { anio: y, mes: m };
    } catch {
        const now = new Date(); return { anio: now.getFullYear(), mes: now.getMonth() + 1 };
    }
})();

/* ====== DOM ====== */
const els = {
    tbody: document.getElementById('tbody-presupuesto'),
    resumenBody: document.querySelector('#tabla-resumen tbody'),
    tituloMes: document.getElementById('titulo-mes'),
    periodLabel: document.getElementById('period-label'),
    periodBadge: document.getElementById('period-badge'),
    periodChipLabel: document.getElementById('period-chip-label'),
    btnClonePrev: document.getElementById('btn-cargar-anterior'),
    btnAnalisis: document.getElementById('btn-analisis'),
    btnAdd: document.getElementById('btn-add'),
    analisisIntro: document.getElementById('analisis-intro'),
    analisisBox: document.getElementById('analisis-resumen'),
};
const setTextSafe = (el, t) => { if (el) el.textContent = t; };
const monthName = (m) => ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'][((Number(m) || 1) - 1 + 12) % 12] || '—';
const periodText = (p) => `${monthName(p.mes)} ${p.anio}`;

// cache para el panel de análisis
let lastItems = [];

/* =========================
   FETCH
========================= */
async function fetchItems() {
    const { data, error } = await sb
        .from(TBL)
        .select(`id, ${USER_COL}, ${YEAR_COL}, ${MONTH_COL}, ${SECC_COL}, ${RUBRO_COL}, ${PRESU_COL}, ${REAL_COL}`)
        .eq(USER_COL, session.user.id)
        .eq(YEAR_COL, period.anio)
        .eq(MONTH_COL, period.mes)
        .order(SECC_COL, { ascending: true })
        .order('id', { ascending: true });
    if (error) throw error;
    return data || [];
}

/* Helper: qué filas son AUTOMÁTICAS y puede tocar ensureAutoRows */
function isAutoRow(row) {
    const sec = row[SECC_COL];
    const rubro = String(row[RUBRO_COL] || '');
    if (sec === SEC.INGRESOS) {
        // solo los que vienen de salarios
        return rubro.startsWith('Ingreso neto de ');
    }
    return sec === SEC.AHORROS || sec === SEC.PROVISIONES || sec === SEC.GASTOS_FIJOS;
}

/* Helper: qué filas son editables/eliminables aquí */
function isEditableRow(row) {
    const sec = row[SECC_COL];
    const rubro = String(row[RUBRO_COL] || '');

    // INGRESOS: solo los que NO son automáticos
    if (sec === SEC.INGRESOS) {
        // Ingresos netos desde salarios -> NO editables aquí
        if (rubro.startsWith('Ingreso neto de ')) return false;
        // Otros ingresos (extra) sí
        return true;
    }

    // Gastos fijos, ahorros y provisiones: siempre en su origen
    if (sec === SEC.GASTOS_FIJOS || sec === SEC.AHORROS || sec === SEC.PROVISIONES) {
        return false;
    }

    // Variables e imprevistos sí se editan aquí
    return sec === SEC.GASTOS_VARIABLES || sec === SEC.IMPREVISTOS;
}


/* =========================
   AUTO-FILAS (ingresos netos, ahorros, provisiones, gastos fijos)
   — Idempotente y respeta ingresos manuales —
========================= */
/* =========================
   AUTO-FILAS (ingresos netos, ahorros, provisiones, gastos fijos)
   — Idempotente y respeta ingresos manuales —
========================= */
async function ensureAutoRows() {
    const desired = []; // { seccion, rubro, presupuesto }

    /* 1) Ingresos automáticos desde salarios (neto mensual por usuario del presupuesto) */
    try {
        const { data: users } = await sb
            .from('usuarios_presupuesto')
            .select('id, nombre, is_archived')
            .eq('is_archived', false);

        if (users?.length) {
            const { data: sal } = await sb
                .from('salarios')
                .select('id, usuario_id, anio, mes, ingreso_bruto')
                .eq('anio', period.anio)
                .eq('mes', period.mes)
                .in('usuario_id', users.map(u => u.id));

            const { data: deds } = await sb
                .from('salarios_deducciones')
                .select('salario_id, monto');

            const dedBySal = new Map();
            (deds || []).forEach(d => {
                const acc = dedBySal.get(d.salario_id) || 0;
                dedBySal.set(d.salario_id, acc + Number(d.monto || 0));
            });

            const netoByUser = new Map();
            (sal || []).forEach(s => {
                const neto = Number(s.ingreso_bruto || 0) - Number(dedBySal.get(s.id) || 0);
                netoByUser.set(s.usuario_id, (netoByUser.get(s.usuario_id) || 0) + neto);
            });

            for (const u of users) {
                const rubro = `Ingreso neto de ${u.nombre}`;
                const neto = Number(netoByUser.get(u.id) || 0);
                desired.push({
                    seccion: SEC.INGRESOS,
                    rubro,
                    presupuesto: neto,
                });
            }
        }
    } catch (err) {
        console.warn('Ingresos netos: no se pudieron sincronizar', err?.message || err);
    }

    /* 2) Ahorros / Provisiones */
    try {
        let ahorros = [], provis = [];

        try {
            const { data } = await sb.from('ahorros').select('*');
            ahorros = data || [];
        } catch { }

        try {
            const { data } = await sb.from('provisiones').select('*');
            provis = data || [];
        } catch { }

        if (!provis.length && ahorros.length && 'tipo' in (ahorros[0] || {})) {
            provis = ahorros.filter(x => String(x.tipo || '').toLowerCase().startsWith('p'));
            ahorros = ahorros.filter(x => String(x.tipo || '').toLowerCase().startsWith('a'));
        }

        const belongsToMe = r =>
            !('user_id' in r) && !('owner_id' in r)
                ? true
                : (r.user_id === session.user.id || r.owner_id === session.user.id);

        ahorros = ahorros.filter(belongsToMe);
        provis = provis.filter(belongsToMe);

        // Conversión robusta a número, soporta tanto valores numéricos
        // como textos en formato "26.666,67" o "26,666.67"
        const num = (v) => {
            if (v == null || v === '') return 0;

            // Si ya es un número, lo devolvemos tal cual
            if (typeof v === 'number') {
                return Number.isFinite(v) ? v : 0;
            }

            let s = String(v).trim();
            if (!s) return 0;

            // Quitamos símbolos de moneda, espacios, etc., pero dejamos . y ,
            s = s.replace(/[^\d.,-]/g, '');

            // Si tiene punto y coma: asumimos "." miles y "," decimales  ->  26.666,67
            if (s.includes('.') && s.includes(',')) {
                s = s.replace(/\./g, '').replace(',', '.');
            } else if (s.includes(',')) {
                // Sólo coma: la tratamos como separador decimal  ->  26666,67
                s = s.replace(',', '.');
            }

            const n = Number(s);
            return Number.isFinite(n) ? n : 0;
        };

        const pickMontoMensual = (row) => {
            const keys = [
                'cuota_mensual', 'monto_mensual', 'aporte_mensual', 'cuota',
                'monto', 'monto_mensual_objetivo', 'cuota_sugerida'
            ];

            for (const k of keys) {
                if (!(k in row)) continue;
                const val = num(row[k]);
                if (val > 0) return val;
            }

            const meta = num(row.meta ?? row.monto_meta ?? row.objetivo ?? row.monto_objetivo);
            const meses = num(row.meses ?? row.plazo_meses ?? row.meses_objetivo);
            if (meta > 0 && meses > 0) return Math.ceil(meta / meses);
            return 0;
        };

        for (const a of ahorros) {
            const monto = pickMontoMensual(a);
            if (!monto) continue;
            desired.push({
                seccion: SEC.AHORROS,
                rubro: a.nombre ?? a.titulo ?? '(Ahorro)',
                presupuesto: monto,
            });
        }

        for (const p of provis) {
            const monto = pickMontoMensual(p);
            if (!monto) continue;
            desired.push({
                seccion: SEC.PROVISIONES,
                rubro: p.nombre ?? p.titulo ?? '(Provisión)',
                presupuesto: monto,
            });
        }
    } catch (err) {
        console.warn('Ahorros/Provisiones: no se pudieron sincronizar', err?.message || err);
    }


    /* 3) Gastos fijos desde configuración (gastos_fijos_config o gastos_fijos) */
    try {
        let gf = [];

        // Preferimos la tabla de configuración
        try {
            const { data } = await sb
                .from('gastos_fijos_config')
                .select('*')
                .order('id', { ascending: true });
            gf = data || [];
        } catch { }

        // Si no existe / está vacía, usamos la tabla clásica
        if (!gf.length) {
            try {
                const { data } = await sb
                    .from('gastos_fijos')
                    .select('*')
                    .order('id', { ascending: true });
                gf = data || [];
            } catch { }
        }

        if (gf.length) {
            // 3.a) Filtrar por dueño si hay user_id / owner_id
            const belongsToMeGF = r =>
                !('user_id' in r) && !('owner_id' in r)
                    ? true
                    : (r.user_id === session.user.id || r.owner_id === session.user.id);
            gf = gf.filter(belongsToMeGF);

            // 3.b) Ignorar archivados / inactivos (soft delete)
            if ('is_archived' in gf[0]) {
                gf = gf.filter(g => !g.is_archived);
            } else if ('archivado' in gf[0]) {
                gf = gf.filter(g => !g.archivado);
            } else if ('activo' in gf[0]) {
                gf = gf.filter(g => g.activo !== false);
            } else if ('eliminado' in gf[0]) {
                gf = gf.filter(g => !g.eliminado);
            }

            // 3.c) Vigencia por año/mes o por fecha
            if (gf.length && ('vigente_desde_anio' in gf[0]) && ('vigente_desde_mes' in gf[0])) {
                gf = gf.filter(x => {
                    const ymIni = (Number(x.vigente_desde_anio) || 0) * 100 + (Number(x.vigente_desde_mes) || 0);
                    const ymCur = period.anio * 100 + period.mes;
                    return ymIni <= ymCur;
                });
            } else if (gf.length && ('vigente_desde' in gf[0])) {
                gf = gf.filter(x => {
                    const d = x.vigente_desde ? new Date(x.vigente_desde) : null;
                    if (!d || Number.isNaN(d.getTime())) return true; // si está raro, no filtramos
                    const ymIni = d.getFullYear() * 100 + (d.getMonth() + 1);
                    const ymCur = period.anio * 100 + period.mes;
                    return ymIni <= ymCur;
                });
            }

            // Nos quedamos solo con la última versión por rubro
            const latestByRubro = (rows) => {
                const map = new Map();
                const ym = (x) => ((+x?.vigente_desde_anio || 0) * 100) + (+x?.vigente_desde_mes || 0);
                const ts = (x) => x?.created_at ? new Date(x.created_at).getTime() : 0;

                for (const r of (rows || [])) {
                    const key = (r?.rubro || r?.nombre || r?.descripcion || r?.titulo || '').trim().toLowerCase();
                    if (!key) continue;

                    const prev = map.get(key);
                    if (!prev) {
                        map.set(key, r);
                        continue;
                    }

                    const ymR = ym(r);
                    const ymPrev = ym(prev);

                    if (ymR > ymPrev || (ymR === ymPrev && ts(r) > ts(prev))) {
                        map.set(key, r);
                    }
                }
                return Array.from(map.values());
            };

            const latestGF = latestByRubro(gf);

            const normName = (g) => (g.nombre ?? g.rubro ?? g.descripcion ?? g.titulo ?? '(sin nombre)');
            const normMonto = (g) =>
                Number(g.monto ?? g.presupuesto ?? g.monto_mensual ?? g.valor ?? 0);

            for (const g of latestGF) {
                desired.push({
                    seccion: SEC.GASTOS_FIJOS,
                    rubro: normName(g),
                    presupuesto: normMonto(g),
                });
            }

        }
    } catch (err) {
        console.warn('Gastos fijos: no se pudieron sincronizar', err?.message || err);
    }

    /* 4) Sincronizar con presupuesto_items (idempotente) */
    const autoSections = [SEC.INGRESOS, SEC.AHORROS, SEC.PROVISIONES, SEC.GASTOS_FIJOS];

    const { data: existing = [], error } = await sb
        .from(TBL)
        .select(`id, ${SECC_COL}, ${RUBRO_COL}, ${PRESU_COL}, ${REAL_COL}`)
        .eq(USER_COL, session.user.id)
        .eq(YEAR_COL, period.anio)
        .eq(MONTH_COL, period.mes)
        .in(SECC_COL, autoSections);

    if (error) throw error;

    const key = (sec, rubro) => `${sec}||${rubro}`;
    const existingMap = new Map();
    existing.forEach(row => {
        if (!isAutoRow(row)) return; // solo filas automáticas
        existingMap.set(key(row[SECC_COL], row[RUBRO_COL] || ''), row);
    });

    const desiredKeys = new Set();
    const updates = [];
    const inserts = [];

    for (const d of desired) {
        const k = key(d.seccion, d.rubro);
        desiredKeys.add(k);
        const ex = existingMap.get(k);
        const targetPresu = Number(d.presupuesto || 0);

        if (ex) {
            if (Number(ex[PRESU_COL] || 0) !== targetPresu) {
                updates.push({ id: ex.id, presupuesto: targetPresu });
            }
        } else {
            inserts.push({
                [USER_COL]: session.user.id,
                [YEAR_COL]: period.anio,
                [MONTH_COL]: period.mes,
                [SECC_COL]: d.seccion,
                [RUBRO_COL]: d.rubro,
                [PRESU_COL]: targetPresu,
                [REAL_COL]: 0,
            });
        }
    }

    // Aplicar updates
    for (const u of updates) {
        await sb.from(TBL).update({ [PRESU_COL]: u.presupuesto }).eq('id', u.id);
    }

    // Insertar nuevos
    if (inserts.length) {
        await sb.from(TBL).insert(inserts);
    }

    // Eliminar automáticos que ya no están en las fuentes
    const toDelete = existing.filter(row => {
        if (!isAutoRow(row)) return false;

        const k = key(row[SECC_COL], row[RUBRO_COL] || '');
        if (desiredKeys.has(k)) return false; // sigue existiendo en la fuente

        // Si ya no existe en la fuente:
        // - Gastos fijos: SIEMPRE se eliminan
        // - Otros automáticos: solo si nunca tuvieron REAL
        if (row[SECC_COL] === SEC.GASTOS_FIJOS) return true;
        return Number(row[REAL_COL] || 0) === 0;
    });

    if (toDelete.length) {
        await sb.from(TBL).delete().in('id', toDelete.map(r => r.id));
    }
}





/* =========================
   RENDER
========================= */
function sectionTitle(s) {
    switch (s) {
        case SEC.INGRESOS: return 'Ingresos';
        case SEC.AHORROS: return 'Ahorros';
        case SEC.PROVISIONES: return 'Provisiones';
        case SEC.GASTOS_FIJOS: return 'Gastos fijos';
        case SEC.GASTOS_VARIABLES: return 'Gastos variables';
        case SEC.IMPREVISTOS: return 'Imprevistos';
        default: return s;
    }
}

function renderTable(items) {
    if (!els.tbody) return;

    if (!items.length) {
        els.tbody.innerHTML = `<tr><td colspan="6" class="muted">No hay rubros creados para este período.</td></tr>`;
        renderResumen(items);
        renderAnalisis(items);
        syncPresuCardsFromTable();   // <- NUEVO
        return;
    }

    const bySec = items.reduce((m, r) => {
        const k = r[SECC_COL] || 'otros';
        (m[k] ||= []).push(r); return m;
    }, {});

    const order = [SEC.INGRESOS, SEC.AHORROS, SEC.PROVISIONES, SEC.GASTOS_FIJOS, SEC.GASTOS_VARIABLES, SEC.IMPREVISTOS];
    const rows = [];

    for (const sec of order) {
        const list = bySec[sec] || [];
        if (!list.length) continue;

        const secSlug =
            sec === SEC.INGRESOS ? 'ingresos' :
                sec === SEC.AHORROS ? 'ahorros' :
                    sec === SEC.PROVISIONES ? 'provisiones' :
                        sec === SEC.GASTOS_FIJOS ? 'gastos-fijos' :
                            sec === SEC.GASTOS_VARIABLES ? 'gastos-variables' :
                                sec === SEC.IMPREVISTOS ? 'imprevistos' : 'default';

        rows.push(`
  <tr class="section-head section-head--${secSlug}">
    <td class="col-rubro">
      <span class="sec-label">
        <span class="sec-dot"></span>
        <span class="sec-title">${sectionTitle(sec)}</span>
      </span>
      <span class="badge-muted">${list.length} ítem(s)</span>
    </td>
    <td colspan="5"></td>
  </tr>
`);

        for (const row of list) {
            const p = Number(row[PRESU_COL] || 0);
            const r = Number(row[REAL_COL] || 0);
            const estatus = r / (p || 1);
            const balance = p - r;
            const statusClass = estatus < 1 ? 'text-success' : (estatus === 1 ? 'text-warning' : 'text-danger');
            const statusText = `${Math.round(estatus * 100)}%`;
            const editable = isEditableRow(row);

            rows.push(`
        <tr data-id="${row.id}" data-sec="${row[SECC_COL] || ''}">
          <td class="col-rubro col-rubro--item">
            <span class="rubro-title">${row[RUBRO_COL] || '(sin rubro)'}</span>
            ${editable ? '' : '<span class="badge-muted" title="Este rubro se gestiona en su página origen">bloqueado</span>'}
          </td>
          <td class="right">${money(p, currency)}</td>
          <td class="right">${money(r, currency)}</td>
          <td class="${statusClass}">${statusText}</td>
          <td class="right">${money(balance, currency)}</td>
          <td class="right">
            <div class="row-actions">
              <button class="btn btn--ghost btn-small" data-action="edit" data-id="${row.id}" title="${editable ? 'Editar' : 'Editar en su origen'}">
                <span class="material-symbols-rounded">edit</span>
              </button>
              ${editable ? `
              <button class="btn btn--ghost btn-small" data-action="del" data-id="${row.id}" title="Eliminar">
                <span class="material-symbols-rounded">delete</span>
              </button>` : ''}
            </div>
          </td>
        </tr>
      `);
        }
    }

    els.tbody.innerHTML = rows.join('');
    renderResumen(items);
    renderAnalisis(items);
    syncPresuCardsFromTable();   // <- NUEVO
}


function renderResumen(items) {
    if (!els.resumenBody) return;

    const sumP = (sec) => items.filter(r => r[SECC_COL] === sec).reduce((a, b) => a + Number(b[PRESU_COL] || 0), 0);
    const sumR = (sec) => items.filter(r => r[SECC_COL] === sec).reduce((a, b) => a + Number(b[REAL_COL] || 0), 0);

    const pIng = sumP(SEC.INGRESOS), rIng = sumR(SEC.INGRESOS);
    const pAho = sumP(SEC.AHORROS), rAho = sumR(SEC.AHORROS);
    const pPro = sumP(SEC.PROVISIONES), rPro = sumR(SEC.PROVISIONES);
    const pG = sumP(SEC.GASTOS_FIJOS) + sumP(SEC.GASTOS_VARIABLES) + sumP(SEC.IMPREVISTOS);
    const rG = sumR(SEC.GASTOS_FIJOS) + sumR(SEC.GASTOS_VARIABLES) + sumR(SEC.IMPREVISTOS);

    const makeRow = (label, p, r) => {
        const est = r / (p || 1);
        const bal = p - r;
        const cls = est < 1 ? 'text-success' : (est === 1 ? 'text-warning' : 'text-danger');
        return `<tr>
      <td><strong>${label}</strong></td>
      <td class="right"><strong>${money(p, currency)}</strong></td>
      <td class="right"><strong>${money(r, currency)}</strong></td>
      <td class="${cls}"><strong>${Math.round(est * 100)}%</strong></td>
      <td class="right"><strong>${money(bal, currency)}</strong></td>
    </tr>`;
    };

    const neto = pIng - (pAho + pPro + pG);
    const netCls = Math.abs(neto) < 0.005 ? 'text-success' : 'text-danger';

    els.resumenBody.innerHTML = [
        makeRow('Ingresos', pIng, rIng),
        makeRow('Ahorros', pAho, rAho),
        makeRow('Provisiones', pPro, rPro),
        makeRow('Gastos', pG, rG),
        `<tr><td colspan="5" class="${netCls}">Neto esperado (base cero): ${money(neto, currency)} ${netCls === 'text-success' ? '✓' : ''}</td></tr>`
    ].join('');
}

/* =========================
   PANEL ACCIONES Y ANÁLISIS
========================= */
function renderAnalisis(items) {
    const box = els.analisisBox;
    if (!box) return;

    if (!items.length) {
        box.innerHTML = `<p class="muted">Configura primero tu presupuesto en las otras pestañas para ver el análisis.</p>`;
        return;
    }

    const sumP = (sec) => items.filter(r => r[SECC_COL] === sec).reduce((a, b) => a + Number(b[PRESU_COL] || 0), 0);
    const sumR = (sec) => items.filter(r => r[SECC_COL] === sec).reduce((a, b) => a + Number(b[REAL_COL] || 0), 0);

    const pIng = sumP(SEC.INGRESOS), rIng = sumR(SEC.INGRESOS);
    const pAho = sumP(SEC.AHORROS), rAho = sumR(SEC.AHORROS);
    const pPro = sumP(SEC.PROVISIONES), rPro = sumR(SEC.PROVISIONES);
    const pG = sumP(SEC.GASTOS_FIJOS) + sumP(SEC.GASTOS_VARIABLES) + sumP(SEC.IMPREVISTOS);
    const rG = sumR(SEC.GASTOS_FIJOS) + sumR(SEC.GASTOS_VARIABLES) + sumR(SEC.IMPREVISTOS);

    const totalPEgresos = pAho + pPro + pG;
    const totalREgresos = rAho + rPro + rG;

    const ejecGastos = totalPEgresos ? (totalREgresos / totalPEgresos) : 0;
    const ejecIngresos = pIng ? (rIng / pIng) : 0;

    const saldoPresu = pIng - totalPEgresos;
    const saldoReal = rIng - totalREgresos;

    const pct = (v) => Math.round(v * 100);
    const clampPct = (v) => Math.max(0, Math.min(pct(v), 150));

    box.innerHTML = `
    <div class="analysis-grid">
      <section class="analysis-card">
        <h3>Ingresos vs egresos (presupuesto)</h3>
        <p>Ingresos presupuestados: <b>${money(pIng, currency)}</b></p>
        <p>Egresos presupuestados (ahorros, provisiones, gastos): <b>${money(totalPEgresos, currency)}</b></p>
        <p class="${saldoPresu >= 0 ? 'text-success' : 'text-danger'}">
          Saldo esperado: <b>${money(saldoPresu, currency)}</b>
        </p>
      </section>

      <section class="analysis-card">
        <h3>Ejecución de gastos</h3>
        <p>Has ejecutado un <b>${pct(ejecGastos)}%</b> del presupuesto de egresos.</p>
        <div class="progress">
          <div class="progress__bar" style="width:${clampPct(ejecGastos)}%"></div>
        </div>
      </section>

      <section class="analysis-card">
        <h3>Ejecución de ingresos</h3>
        <p>Has recibido un <b>${pct(ejecIngresos)}%</b> de los ingresos presupuestados.</p>
        <div class="progress">
          <div class="progress__bar" style="width:${clampPct(ejecIngresos)}%"></div>
        </div>
      </section>

      <section class="analysis-card">
        <h3>Saldo real acumulado</h3>
        <p>Ingresos reales: <b>${money(rIng, currency)}</b></p>
        <p>Egresos reales (ahorros, provisiones, gastos): <b>${money(totalREgresos, currency)}</b></p>
        <p class="${saldoReal >= 0 ? 'text-success' : 'text-danger'}">
          Saldo real: <b>${money(saldoReal, currency)}</b>
        </p>
      </section>
    </div>
  `;
}

/* =========================
   Tarjetas responsive (móvil) – Presupuesto detallado
   ========================= */
function syncPresuCardsFromTable() {
    const container = document.getElementById('presu-cards');
    const tbody = document.getElementById('tbody-presupuesto');
    if (!container || !tbody) return;

    container.innerHTML = '';

    const rows = Array.from(tbody.querySelectorAll('tr'));

    // Filas "vacías" tipo "Cargando…" o "No hay rubros", llevan .muted
    const dataRows = rows.filter(tr => !tr.classList.contains('section-head') && !tr.querySelector('.muted'));

    if (!dataRows.length) {
        container.innerHTML = '<p class="muted">No hay rubros creados para este período.</p>';
        return;
    }

    dataRows.forEach(tr => {
        const cells = tr.querySelectorAll('td');
        const rubro = (cells[0]?.textContent || '').replace('bloqueado', '').trim();
        const presu = (cells[1]?.textContent || '').trim();
        const real = (cells[2]?.textContent || '').trim();
        const status = (cells[3]?.textContent || '').trim();
        const balance = (cells[4]?.textContent || '').trim();

        const secKey = tr.dataset.sec || '';
        const secLabel = sectionTitle(secKey);

        // Botones de la tabla a los que “delegamos” la acción
        const btnEditTable = tr.querySelector('[data-action="edit"]');
        const btnDelTable = tr.querySelector('[data-action="del"]');

        const card = document.createElement('article');
        card.className = 'presu-card';

        card.innerHTML = `
      <header class="presu-card__head">
        <div>
          <div class="presu-card__section">${escapeHtml(secLabel)}</div>
          <div class="presu-card__rubro">${escapeHtml(rubro)}</div>
        </div>
        <div class="presu-card__status">${escapeHtml(status)}</div>
      </header>
      <div class="presu-card__rows">
        <div class="presu-card__row">
          <span class="presu-card__row-label">Presupuesto</span>
          <span class="presu-card__row-value">${escapeHtml(presu)}</span>
        </div>
        <div class="presu-card__row">
          <span class="presu-card__row-label">Real</span>
          <span class="presu-card__row-value">${escapeHtml(real)}</span>
        </div>
        <div class="presu-card__row">
          <span class="presu-card__row-label">Balance</span>
          <span class="presu-card__row-value">${escapeHtml(balance)}</span>
        </div>
      </div>
      <div class="presu-card__actions">
        <button type="button" class="btn btn--ghost btn-small" aria-label="Editar rubro">
          <span class="material-symbols-rounded">edit</span>
        </button>
        ${btnDelTable ? `
        <button type="button" class="btn btn--ghost btn-small" aria-label="Eliminar rubro">
          <span class="material-symbols-rounded">delete</span>
        </button>` : ''}
      </div>
    `;

        const actionButtons = card.querySelectorAll('.presu-card__actions .btn');
        const btnEditCard = actionButtons[0];
        const btnDelCard = actionButtons[1];

        // Reutilizamos los handlers existentes de la tabla
        btnEditCard?.addEventListener('click', () => btnEditTable?.click());
        btnDelCard?.addEventListener('click', () => btnDelTable?.click());

        container.appendChild(card);
    });
}

/* =========================
   CRUD (solo secciones editables)
========================= */
function openItemModal({ id = null, data = null, editable = true } = {}) {
    const isEdit = !!id;
    const title = isEdit ? 'Editar rubro' : 'Agregar rubro';
    const secVal = data?.[SECC_COL] || SEC.GASTOS_VARIABLES;

    // Si estoy editando, hago caso a la bandera `editable`.
    // Si es uno nuevo, siempre es editable.
    const canEdit = isEdit ? editable : true;

    const m = openModal({
        id: 'modal-item',
        title,
        content: `
      <form id="f-item" class="form" novalidate>
        <div class="input">
          <label class="required">Sección</label>
          <select name="seccion" ${isEdit ? 'disabled' : ''} required>
            <option value="${SEC.INGRESOS}" ${secVal === SEC.INGRESOS ? 'selected' : ''}>Ingresos (extra)</option>
            <option value="${SEC.GASTOS_VARIABLES}" ${secVal === SEC.GASTOS_VARIABLES ? 'selected' : ''}>Gastos variables</option>
            <option value="${SEC.IMPREVISTOS}" ${secVal === SEC.IMPREVISTOS ? 'selected' : ''}>Imprevistos</option>
          </select>
          <small class="muted">El “Real” se carga desde Control mensual.</small>
        </div>
        <div class="input">
          <label class="required">Rubro</label>
          <input name="rubro" required value="${data?.[RUBRO_COL] || ''}" ${canEdit ? '' : 'disabled'}>
        </div>
        <div class="input">
          <label class="required">Presupuesto</label>
          <input name="presupuesto" type="number" min="0" step="0.01" required value="${Number(data?.[PRESU_COL] ?? 0)}" ${canEdit ? '' : 'disabled'}>
        </div>
        <div class="input">
          <label>Real (solo lectura)</label>
          <input name="real" type="number" min="0" step="0.01" value="${Number(data?.[REAL_COL] ?? 0)}" disabled>
          <small class="muted">Se actualiza automáticamente desde Control mensual.</small>
        </div>
        <div class="actions-row" style="display:flex;gap:.5rem;margin-top:.75rem;flex-wrap:wrap">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          ${canEdit ? `<button type="submit" class="btn">${isEdit ? 'Guardar cambios' : 'Agregar'}</button>`
                : `<a class="btn" href="${secVal === SEC.INGRESOS ? 'salario.html' : (secVal === SEC.AHORROS || secVal === SEC.PROVISIONES) ? 'ahorros.html' : 'config.html'}">Editar en su origen</a>`}
        </div>
      </form>
    `
    });

    if (!canEdit) return;

    m.querySelector('#f-item').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.currentTarget;
        const seccion = isEdit ? secVal : f.seccion.value;
        const payload = {
            [USER_COL]: session.user.id,
            [YEAR_COL]: period.anio,
            [MONTH_COL]: period.mes,
            [SECC_COL]: seccion,
            [RUBRO_COL]: f.rubro.value.trim(),
            [PRESU_COL]: Number(f.presupuesto.value || 0),
            [REAL_COL]: isEdit ? Number(data?.[REAL_COL] || 0) : 0,
        };
        if (!payload[RUBRO_COL]) { toast.error('Rubro requerido'); return; }

        try {
            if (isEdit) {
                const { error } = await sb.from(TBL).update(payload).eq('id', id).eq(USER_COL, session.user.id);
                if (error) throw error;
                toast.success('Rubro actualizado');
            } else {
                const { error } = await sb.from(TBL).insert([payload]);
                if (error) throw error;
                toast.success('Rubro agregado');
            }
            closeModal(m);
            await reload();
        } catch (err) { toast.error(err.message || 'No se pudo guardar'); }
    });
}

async function deleteItem(id) {
    try {
        const { error } = await sb.from(TBL).delete().eq('id', id).eq(USER_COL, session.user.id);
        if (error) throw error;
        toast.success('Rubro eliminado');
        await reload();
    } catch (err) { toast.error(err.message || 'No se pudo eliminar'); }
}

/* =========================
   CLONAR MES ANTERIOR (solo presupuesto)
========================= */
async function clonePrevious() {
    const prev = { anio: period.anio, mes: period.mes - 1 };
    if (prev.mes === 0) { prev.mes = 12; prev.anio -= 1; }

    try {
        const { data: prevItems, error } = await sb.from(TBL)
            .select(`${SECC_COL}, ${RUBRO_COL}, ${PRESU_COL}`)
            .eq(USER_COL, session.user.id)
            .eq(YEAR_COL, prev.anio)
            .eq(MONTH_COL, prev.mes);
        if (error) throw error;

        if (!(prevItems?.length)) { toast.info('No hay presupuesto del mes anterior.'); return; }

        const total = prevItems.reduce((a, b) => a + Number(b[PRESU_COL] || 0), 0);
        const m = openModal({
            title: 'Cargar presupuesto del mes anterior',
            content: `
        <p>Se copiarán <b>${prevItems.length}</b> rubros al período <b>${periodText(period)}</b>.</p>
        <p>Total a copiar (Presupuesto): <b>${money(total, currency)}</b>. <b>Real</b> quedará en <b>0</b>.</p>
        <div class="actions-row" style="margin-top:.75rem">
          <button class="btn btn--ghost" data-close>Cancelar</button>
          <button class="btn" id="btn-confirm-clone">Confirmar</button>
        </div>`
        });

        m.querySelector('#btn-confirm-clone').addEventListener('click', async () => {
            try {
                const rows = prevItems.map(x => ({
                    [USER_COL]: session.user.id,
                    [YEAR_COL]: period.anio,
                    [MONTH_COL]: period.mes,
                    [SECC_COL]: x[SECC_COL],
                    [RUBRO_COL]: x[RUBRO_COL],
                    [PRESU_COL]: Number(x[PRESU_COL] || 0),
                    [REAL_COL]: 0,
                }));
                const { error: insErr } = await sb.from(TBL).insert(rows);
                if (insErr) throw insErr;
                toast.success('Rubros cargados del mes anterior');
                closeModal(m);
                await reload();
            } catch (err) { toast.error(err.message || 'No se pudo clonar'); }
        });
    } catch (err) { toast.error(err.message || 'No se pudo clonar'); }
}

/* =========================
   EVENTS
========================= */
function wireEvents() {
    els.tbody?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const id = btn.dataset.id;
        const tr = btn.closest('tr');
        const sec = tr?.dataset?.sec;

        if (btn.dataset.action === 'edit') {
            const pTxt = tr.children[1].textContent;
            const rTxt = tr.children[2].textContent;
            const rubroTxt = tr.children[0].textContent.replace('bloqueado', '').trim();

            const parseNum = (txt) =>
                Number(String(txt).replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

            const data = {
                [SECC_COL]: sec,
                [RUBRO_COL]: rubroTxt,
                [PRESU_COL]: parseNum(pTxt),
                [REAL_COL]: parseNum(rTxt),
            };

            const editableRow = isEditableRow(data);

            openItemModal({ id, data, editable: editableRow });

            if (!editableRow) {
                toast.info('Este rubro se gestiona en su página origen.');
            }
        }

        if (btn.dataset.action === 'del') {
            const rubroTxt = tr.children[0].textContent.replace('bloqueado', '').trim();
            const rowInfo = { [SECC_COL]: sec, [RUBRO_COL]: rubroTxt };

            if (!isEditableRow(rowInfo)) {
                toast.info('Este rubro no se puede eliminar aquí.');
                return;
            }
            deleteItem(id);
        }
    });

    els.btnClonePrev?.addEventListener('click', clonePrevious);
    els.btnAnalisis?.addEventListener('click', () => {
        renderAnalisis(lastItems);
        toast.success('Análisis actualizado');
    });
    els.btnAdd?.addEventListener('click', () => openItemModal());
}

/* =========================
   LOAD / INIT
========================= */
// Helper mínimo para escapar texto en las tarjetas
function escapeHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}


async function reload() {
    try {
        setTextSafe(els.tituloMes, periodText(period));
        setTextSafe(els.periodLabel, periodText(period));
        setTextSafe(els.periodChipLabel, periodText(period));

        await ensureAutoRows();           // crea/actualiza filas automáticas
        const items = await fetchItems(); // carga las filas del período
        lastItems = items;
        renderTable(items);
    } catch (err) {
        console.error(err);
        if (els.tbody) els.tbody.innerHTML = `<tr><td colspan="6" class="muted">Error al cargar.</td></tr>`;
        if (els.analisisBox) els.analisisBox.innerHTML = `<p class="muted">${err.message || 'No se pudo cargar el análisis.'}</p>`;
        toast.error(err.message || 'No se pudo cargar presupuesto');
    }
}

async function init() {
    ({ session } = await requireAuth());

    setTextSafe(els.tituloMes, periodText(period));
    setTextSafe(els.periodLabel, periodText(period));
    setTextSafe(els.periodChipLabel, periodText(period));

    wireEvents();
    await reload();

    // Cambios de período (dos variantes)
    addEventListener('bpz:month-changed', async (e) => {
        const { year, month } = e.detail || {};
        if (!year || !month) return;
        period = { anio: year, mes: month };
        await reload();
    });
    addEventListener('bpz:period-changed', async (e) => {
        const { year, month } = e.detail || {};
        if (!year || !month) return;
        period = { anio: year, mes: month };
        await reload();
    });

    // Cambio de moneda
    addEventListener('bpz:currency-changed', (e) => {
        currency = e.detail?.iso || getCurrency() || 'CRC';
        reload();
    });

    // Si Control mensual impacta "Real", refrescamos
    addEventListener('bpz:mov-updated', () => reload());
}

// Asegura inicio aunque el DOM ya esté listo
function handleInitError(err) {
    console.error(err);
    toast.error('No se pudo iniciar Presupuesto');
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init().catch(handleInitError));
} else {
    init().catch(handleInitError);
}
