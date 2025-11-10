// PAGOS MENSUALES — PBZ-FS (v1.17) — Frin + Noah
// - Usa 'dia' real para clasificar y mostrar fechas.
// - Quincenas: 1–14 → II; 15–fin → I.
// - Subtablas por quincena: Usuario | Salario quincena | Pagos quincena | Balance.

import { sb } from './supabase.js';
import { getCurrentPeriod } from './period.js';
import { formatCurrency, formatDate } from './utils.js';

const PAGOS_TABLE = 'pagos_mensuales';
console.info('pagos.js v1.17 — tabla =', PAGOS_TABLE);

let session = null;
let period = normalizePeriod(getCurrentPeriod());
let users = [];
let pagos = [];
// salarios: { usuario_id, salario_neto, q1, q2 }
let salarios = [];

bootstrap().catch(console.error);

async function bootstrap() {
  const { data: sess } = await sb.auth.getSession();
  session = sess?.session || null;
  if (!session?.user) return;

  setDynamicTitle();
  hookPeriodChange();

  await reloadAll();

  const form = qs('#pay-form');
  qs('#btn-clone-prev')?.addEventListener('click', openCloneModal);
  qs('#btn-clear')?.addEventListener('click', clearForm);
  form?.addEventListener('submit', onSubmitForm);
}

function hookPeriodChange() {
  const cb = async () => {
    period = normalizePeriod(getCurrentPeriod());
    setDynamicTitle();
    await reloadAll();
  };
  window.addEventListener('period:changed', cb);
}

function setDynamicTitle() {
  qs('#page-title').textContent = `Control de pagos de ${monthNameEs(period.month)} ${period.year}`;
  qs('#period-badge').textContent = `${pad2(period.month)}/${period.year}`;
}

async function reloadAll() {
  period = normalizePeriod(period);
  await Promise.all([loadUsers(), loadSalarios(), loadPagos()]);
  fillUserSelects();
  renderTables();
}

/* ============================ DATA LOADERS ============================ */
async function loadUsers() {
  users = [];
  try {
    let r2 = await sb.from('usuarios_presupuesto').select('*').eq('user_id', session.user.id);
    if (r2?.data?.length) users = r2.data.map(normalizeUser).filter(Boolean);

    if (!users.length) {
      const r = await sb.from('usuarios').select('*');
      if (r?.data?.length) users = r.data.map(normalizeUser).filter(Boolean);
    }
  } catch (e) {
    console.warn('loadUsers() error:', e?.message, e?.hint, e?.details);
  }

  users = users
    .filter(u => u.nombre && (u.activo !== false))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

function normalizeUser(row) {
  if (!row) return null;
  const nombre = (row.nombre ?? row.nombre_completo ?? row.alias ?? row.apodo ?? '').trim();
  return { id: row.id, nombre, activo: (row.activo === undefined ? true : !!row.activo) };
}

async function loadSalarios() {
  salarios = [];
  try {
    // 1) Leemos salarios del período, por usuario y sección (igual que salario.js)
    const { data: sal, error: e1 } = await sb
      .from('salarios')
      .select('id, usuario_id, anio, mes, seccion, ingreso_bruto')
      .eq('user_id', session.user.id)
      .eq('mes', period.month)
      .eq('anio', period.year);

    if (e1) throw e1;
    const salariosRows = sal || [];
    if (!salariosRows.length) {
      salarios = [];
      return;
    }

    // 2) Leemos deducciones asociadas a esos salarios
    const salarioIds = salariosRows.map(s => s.id);
    const { data: deds, error: e2 } = await sb
      .from('salarios_deducciones')
      .select('salario_id, monto')
      .in('salario_id', salarioIds);

    if (e2) throw e2;

    const dedBySal = new Map();
    (deds || []).forEach(d => {
      const acc = dedBySal.get(d.salario_id) || 0;
      dedBySal.set(d.salario_id, acc + Number(d.monto || 0));
    });

    // 3) Calculamos neto por usuario y por sección
    const perUser = new Map();
    salariosRows.forEach(s => {
      const bruto = Number(s.ingreso_bruto || 0);
      const dedsSal = Number(dedBySal.get(s.id) || 0);
      const neto = bruto - dedsSal;

      const uid = s.usuario_id;
      const sec = Number(s.seccion || 1);

      if (!perUser.has(uid)) {
        perUser.set(uid, { total: 0, q1: 0, q2: 0 });
      }
      const rec = perUser.get(uid);
      rec.total += neto;

      // Mapeo simple: sección 1 → I quincena, sección 2 → II quincena
      if (sec === 1) rec.q1 += neto;
      else if (sec === 2) rec.q2 += neto;
      // Si hubiera más secciones (semanal, etc.), quedan sumadas solo en total
    });

    salarios = Array.from(perUser.entries()).map(([usuario_id, rec]) => ({
      usuario_id,
      salario_neto: rec.total,
      q1: rec.q1,
      q2: rec.q2,
    }));
  } catch (e) {
    console.warn('loadSalarios() error:', e?.message, e?.hint, e?.details);
    salarios = [];
  }
}

async function loadPagos() {
  pagos = [];
  if (!period.month || !period.year) return;
  try {
    const { data, error } = await sb
      .from(PAGOS_TABLE)
      .select('*')
      .eq('user_id', session.user.id)
      .eq('mes', period.month)
      .eq('anio', period.year)
      .order('dia', { ascending: true });
    if (error) throw error;
    pagos = data || [];
  } catch (e) {
    pagos = [];
    console.warn('loadPagos() error:', e?.message, e?.hint, e?.details);
    toast('No se pudieron leer los pagos', 'error');
  }
}

/* ============================== SELECTS =============================== */
function fillUserSelects() {
  const selDed = qs('select[name="usuario_deducido_id"]');
  const selRes = qs('select[name="usuario_responsable_id"]');
  if (!selDed || !selRes) return;

  const prevDed = selDed.value;
  const prevRes = selRes.value;
  const opts = users.map(u => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('');
  selDed.innerHTML = `<option value="">— Seleccionar —</option>${opts}`;
  selRes.innerHTML = `<option value="">— Seleccionar —</option>${opts}`;

  if (prevDed && users.some(u => String(u.id) === String(prevDed))) selDed.value = prevDed;
  if (prevRes && users.some(u => String(u.id) === String(prevRes))) selRes.value = prevRes;

  const form = qs('#pay-form');
  if (!users.length) {
    selDed.disabled = selRes.disabled = true;
    form?.querySelectorAll('input,select,button,textarea').forEach(el => {
      if (el.name !== undefined && el.type !== 'button') el.disabled = true;
    });
    toast('No hay usuarios activos. Ve a Configuraciones → Usuarios.', 'warning');
  } else {
    selDed.disabled = selRes.disabled = false;
    form?.querySelectorAll('input,select,button,textarea').forEach(el => (el.disabled = false));
  }
}

/* ============================= RENDER UI ============================== */
function renderTables() {
  const [q1, q2] = splitByQuincena(pagos);

  // Subtablas — por usuario
  renderSubs('q1-subs', q1, 'I');
  renderSubs('q2-subs', q2, 'II');

  // NUEVO: resúmenes de "pases de plata"
  renderTransfers('q1-transfers', q1, 'I');
  renderTransfers('q2-transfers', q2, 'II');

  // Tablas principales
  renderTable('tbl-q1', q1, 'q1-empty', 'q1-total', 'I');
  renderTable('tbl-q2', q2, 'q2-empty', 'q2-total', 'II');
}


function renderSubs(tableId, rows, quinLabel) {
  const tbody = qs(`#${tableId} tbody`);
  if (!tbody) return;
  tbody.innerHTML = '';

  // Pagos por usuario en esta quincena
  const pagosPorUsuario = new Map(); // usuario_id -> total pagos en quincena
  for (const p of rows) {
    const uid = p.usuario_deducido_id ?? p.usuario_responsable_id; // criterio principal: deducido
    const key = String(uid ?? '');
    const prev = pagosPorUsuario.get(key) || 0;
    pagosPorUsuario.set(key, prev + Number(p.monto || 0));
  }

  // Usuarios conocidos (para ordenar estable)
  const usuariosOrden = users.map(u => String(u.id));

  // Render por cada usuario visible (que tenga salario o pagos)
  const allUserKeys = new Set([
    ...usuariosOrden,
    ...pagosPorUsuario.keys(),
    ...salarios.map(s => String(s.usuario_id)),
  ]);

  // Totales
  let tSal = 0;
  let tPag = 0;

  for (const key of allUserKeys) {
    const user = users.find(u => String(u.id) === key);
    const nombre = user ? user.nombre : '—';

    const salarioMes = salarioUsuario(key);
    const salarioQuin = salarioQuincenaUsuario(key, quinLabel);
    const pagosQuin = pagosPorUsuario.get(key) || 0;
    const balance = salarioQuin - pagosQuin;

    // No mostrar filas totalmente vacías (sin salario y sin pagos)
    if (!salarioMes && !pagosQuin) continue;

    tSal += salarioQuin;
    tPag += pagosQuin;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(nombre)}</td>
      <td class="num">${formatCurrency(salarioQuin)}</td>
      <td class="num">${formatCurrency(pagosQuin)}</td>
      <td class="num ${balance >= 0 ? 'pos' : 'neg'}">${formatCurrency(balance)}</td>
    `;
    tbody.appendChild(tr);
  }

  // Footer de totales de la subtabla
  const trTot = document.createElement('tr');
  trTot.innerHTML = `
    <td style="font-weight:700">Total ${quinLabel}</td>
    <td class="num" style="font-weight:700">${formatCurrency(tSal)}</td>
    <td class="num" style="font-weight:700">${formatCurrency(tPag)}</td>
    <td class="num ${tSal - tPag >= 0 ? 'pos' : 'neg'}" style="font-weight:700">${formatCurrency(
    tSal - tPag
  )}</td>
  `;
  tbody.appendChild(trTot);
}
function computeTransfers(rows) {
  // key = "fromId__toId"  (from = deducido, to = responsable)
  const map = new Map();

  for (const p of rows) {
    const from = p.usuario_deducido_id;
    const to = p.usuario_responsable_id;
    if (!from || !to) continue;
    if (String(from) === String(to)) continue; // si es el mismo usuario, no hay pase

    const key = `${from}__${to}`;
    const prev = map.get(key) || 0;
    map.set(key, prev + Number(p.monto || 0));
  }

  return map;
}

function renderTransfers(boxId, rows, quinLabel) {
  const box = qs(`#${boxId}`);
  if (!box) return;

  const transfers = computeTransfers(rows);

  if (!transfers.size) {
    box.innerHTML = `
      <h4>Saldos entre usuarios — ${quinLabel} Quincena</h4>
      <p class="muted" style="font-size:.8rem">
        No hay pagos donde el responsable y el usuario al que se le deduce sean distintos.
      </p>
    `;
    return;
  }

  let totalMov = 0;
  const itemsHtml = Array.from(transfers.entries()).map(([key, monto]) => {
    const [fromId, toId] = key.split('__');
    totalMov += monto;
    const fromName = esc(findUserName(fromId));
    const toName = esc(findUserName(toId));
    return `
      <li>
        <strong>${fromName}</strong> le debe pasar
        <strong>${formatCurrency(monto)}</strong>
        a <strong>${toName}</strong>
      </li>
    `;
  }).join('');

  box.innerHTML = `
    <h4>Saldos entre usuarios — ${quinLabel} Quincena</h4>
    <p style="font-size:.78rem;color:var(--muted);margin-bottom:.2rem">
      Basado en pagos donde una persona es responsable pero el dinero se descuenta a otra.
    </p>
    <ul class="transfers-list">
      ${itemsHtml}
    </ul>
    <p class="transfers-total">
      Total de movimientos: ${formatCurrency(totalMov)}
    </p>
  `;
}


function renderTable(tblId, rows, emptyId, totalId, quinLabel) {
  const tbody = qs(`#${tblId} tbody`);
  if (!tbody) return;
  tbody.innerHTML = '';
  let total = 0;

  // Pendientes primero, luego realizados; dentro de cada grupo, por día
  rows.sort((a, b) => {
    if (a.estado !== b.estado) {
      return a.estado === 'pendiente' ? -1 : 1;
    }
    return Number(a.dia || 1) - Number(b.dia || 1);
  });

  for (const p of rows) {
    total += Number(p.monto || 0);
    const tr = document.createElement('tr');
    const fecha = makeDate(period.year, period.month, Number(p.dia || 1));

    tr.dataset.id = p.id;

    const dedName = findUserName(p.usuario_deducido_id);
    const resName = findUserName(p.usuario_responsable_id);

    let transferNote = '';
    if (
      p.usuario_deducido_id &&
      p.usuario_responsable_id &&
      String(p.usuario_deducido_id) !== String(p.usuario_responsable_id)
    ) {
      // Interpretación: al usuario al que se le deduce (dedName) le debe pasar la plata
      // al responsable (resName)
      transferNote = `${esc(dedName)} le debe pasar ${formatCurrency(p.monto)} a ${esc(resName)}`;
    }

    tr.innerHTML = `
      <td>${formatDate(fecha)}</td>
      <td title="${esc(p.nombre_pago)}">${esc(p.nombre_pago)}</td>
      <td>${esc(dedName)}</td>
      <td>${esc(resName)}</td>
      <td class="monto">${formatCurrency(p.monto)}</td>
      <td class="estado">
        <div class="estado-main">
          <span class="check ${p.estado === 'realizado' ? 'realizado' : ''}" title="Cambiar estado" role="button" tabindex="0">
            <span class="material-symbols-rounded">${p.estado === 'realizado' ? 'done' : ''}</span>
          </span>
          <span class="tag ${p.estado}">${p.estado}</span>
        </div>
        ${transferNote ? `<div class="estado-extra">${transferNote}</div>` : ''}
      </td>
      <td class="acciones">
        <div class="row-actions">
          <button class="btn-icon" data-act="edit">
            <span class="material-symbols-rounded">edit</span>
          </button>
          <button class="btn-icon" data-act="del">
            <span class="material-symbols-rounded">delete</span>
          </button>
        </div>
      </td>`;


    tbody.appendChild(tr);

    tr.querySelector('[data-act="edit"]').addEventListener('click', () => openEditModal(p));
    tr.querySelector('[data-act="del"]').addEventListener('click', () => openDeleteModal(p));
    const chk = tr.querySelector('.check');
    chk.addEventListener('click', () => toggleEstado(p, tr));
    chk.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        chk.click();
      }
    });
  }

  const emptyEl = qs(`#${emptyId}`);
  if (emptyEl) emptyEl.hidden = rows.length > 0;
  const totalEl = qs(`#${totalId}`);
  if (totalEl) totalEl.textContent = `Total: ${formatCurrency(total)}`;
}

/* ============================ BUSINESS RULES =========================== */
// 1–14 → II quincena; 15–fin → I quincena
function splitByQuincena(list) {
  const q1 = [];
  const q2 = [];
  for (const p of list) {
    const dia = Number(p.dia || 1);
    if (dia >= 15) q1.push(p); // I (se paga con el 15)
    else q2.push(p);           // II (se paga al final de mes)
  }
  return [q1, q2];
}

// Devuelve "I" o "II" según el día del mes
function quincenaFromDia(dia) {
  dia = Number(dia || 1);
  return dia >= 15 ? 'I' : 'II'; // 15–fin → I, 1–14 → II
}

function salarioUsuario(usuarioIdStr) {
  const row = salarios.find(s => String(s.usuario_id) === String(usuarioIdStr));
  return Number(row?.salario_neto || 0);
}

// Salario disponible por quincena para un usuario.
// Aquí usamos los mismos "Pago 1 / Pago 2" que en análisis de salario:
//   - seccion 1 → I Quincena
//   - seccion 2 → II Quincena
// Si en tu lógica es al revés, solo intercambia q1 y q2 aquí.
function salarioQuincenaUsuario(usuarioIdStr, quinLabel) {
  const row = salarios.find(s => String(s.usuario_id) === String(usuarioIdStr));
  if (!row) return 0;
  if (quinLabel === 'I') return Number(row.q1 || 0);
  if (quinLabel === 'II') return Number(row.q2 || 0);
  return 0;
}

/* ================================ CRUD ================================ */
async function onSubmitForm(ev) {
  ev.preventDefault();
  const f = ev.currentTarget;
  const fd = new FormData(f);
  const fechaSel = new Date(fd.get('fecha'));
  if (isNaN(fechaSel.getTime())) {
    toast('Fecha inválida', 'error');
    return;
  }

  const payload = {
    id: fd.get('id') || null,
    dia: fechaSel.getDate(),
    nombre_pago: (fd.get('nombre_pago') || '').trim(),
    usuario_deducido_id: fd.get('usuario_deducido_id') || null,
    usuario_responsable_id: fd.get('usuario_responsable_id') || null,
    monto: Number(fd.get('monto') || 0),
    estado: 'pendiente',
  };

  if (!payload.nombre_pago || !payload.usuario_deducido_id || !payload.usuario_responsable_id) {
    toast('Completa los campos requeridos', 'error');
    return;
  }
  // Aviso por diferencia de período (solo visual)
  if (!isDateInPeriod(fd.get('fecha'))) {
    toast('La fecha no pertenece al período activo (se permitirá).', 'warning');
  }
  // ---- Regla: no se puede deducir más de lo que hay como salario neto ----
  const quinLabel = quincenaFromDia(payload.dia); // "I" o "II"
  const salarioQuin = salarioQuincenaUsuario(payload.usuario_deducido_id, quinLabel);

  // Si no hay salario configurado para esa quincena, no permitimos deducciones
  if (salarioQuin <= 0) {
    const nombreDed = findUserName(payload.usuario_deducido_id);
    toast(
      `No hay salario neto registrado para ${nombreDed} en la quincena ${quinLabel}. ` +
      `Configura primero el salario en "Análisis de salario".`,
      'error'
    );
    return;
  }

  // Sumamos lo que ya tiene deducido en esa quincena ese usuario (excluyendo este pago si es edición)
  const [q1Pagos, q2Pagos] = splitByQuincena(pagos);
  const listaQuin = quinLabel === 'I' ? q1Pagos : q2Pagos;

  const yaDeducido = listaQuin.reduce((acc, p) => {
    const mismoUsuario = String(p.usuario_deducido_id || '') === String(payload.usuario_deducido_id || '');
    const mismoRegistro = payload.id && p.id === payload.id; // para cuando estamos editando
    if (!mismoUsuario || mismoRegistro) return acc;
    return acc + Number(p.monto || 0);
  }, 0);

  const totalConEste = yaDeducido + payload.monto;

  if (totalConEste > salarioQuin + 0.001) {
    const nombreDed = findUserName(payload.usuario_deducido_id);
    toast(
      `${nombreDed} no puede tener deducciones por ${formatCurrency(totalConEste)} ` +
      `en la quincena ${quinLabel} porque su salario neto disponible es ` +
      `${formatCurrency(salarioQuin)}.`,
      'error'
    );
    return;
  }
  // ---- Fin regla salario neto ----

  if (payload.id) {
    const { error } = await sb
      .from(PAGOS_TABLE)
      .update({
        mes: period.month,
        anio: period.year,
        dia: payload.dia,
        nombre_pago: payload.nombre_pago,
        usuario_deducido_id: payload.usuario_deducido_id,
        usuario_responsable_id: payload.usuario_responsable_id,
        monto: payload.monto,
      })
      .eq('id', payload.id)
      .eq('user_id', session.user.id);
    if (error) {
      console.warn('update error', error);
      toast('No se pudo actualizar', 'error');
      return;
    }
    toast('Pago actualizado', 'success');
  } else {
    const { error } = await sb.from(PAGOS_TABLE).insert({
      user_id: session.user.id,
      mes: period.month,
      anio: period.year,
      dia: payload.dia,
      nombre_pago: payload.nombre_pago,
      usuario_deducido_id: payload.usuario_deducido_id,
      usuario_responsable_id: payload.usuario_responsable_id,
      monto: payload.monto,
      estado: 'pendiente',
      fecha_realizacion: null,
    });
    if (error) {
      console.warn('insert error', error);
      toast('No se pudo guardar', 'error');
      return;
    }
    toast('Pago creado', 'success');
  }

  await loadPagos();
  renderTables();
  clearForm();
}

function clearForm() {
  const f = qs('#pay-form');
  if (!f) return;
  f.reset();
  const idInp = f.querySelector('input[name="id"]');
  if (idInp) idInp.value = '';
  qs('#form-title') && (qs('#form-title').textContent = 'Nuevo pago');
}

function openEditModal(pago) {
  const f = qs('#pay-form');
  if (!f) return;
  f.querySelector('input[name="id"]').value = pago.id;
  const d = Number(pago.dia || 1);
  const dateForInput = formatForInput(makeDate(period.year, period.month, d));
  f.querySelector('input[name="fecha"]').value = dateForInput;
  f.querySelector('input[name="nombre_pago"]').value = pago.nombre_pago;
  f.querySelector('select[name="usuario_deducido_id"]').value = pago.usuario_deducido_id || '';
  f.querySelector('select[name="usuario_responsable_id"]').value = pago.usuario_responsable_id || '';
  f.querySelector('input[name="monto"]').value = Number(pago.monto || 0);
  qs('#form-title') && (qs('#form-title').textContent = 'Editar pago');
  f.querySelector('input[name="nombre_pago"]').focus();
}

function openDeleteModal(pago) {
  const body = document.createElement('div');
  const fecha = makeDate(period.year, period.month, Number(pago.dia || 1));
  body.innerHTML = `<p>¿Eliminar el pago <strong>${esc(
    pago.nombre_pago
  )}</strong> del ${formatDate(fecha)} por ${formatCurrency(pago.monto)}?</p>`;
  showModal({
    title: 'Eliminar pago',
    bodyNode: body,
    actions: [
      {
        text: 'Eliminar',
        variant: 'warn',
        handler: async close => {
          const { error } = await sb
            .from(PAGOS_TABLE)
            .delete()
            .eq('id', pago.id)
            .eq('user_id', session.user.id);
          if (error) {
            console.warn('delete error', error);
            toast('No se pudo eliminar', 'error');
            return;
          }
          toast('Pago eliminado', 'success');
          close();
          await loadPagos();
          renderTables();
        },
      },
      { text: 'Cancelar', variant: 'ghost' },
    ],
  });
}

async function toggleEstado(pago, trEl) {
  const nuevo = pago.estado === 'realizado' ? 'pendiente' : 'realizado';
  const { error } = await sb
    .from(PAGOS_TABLE)
    .update({
      estado: nuevo,
      fecha_realizacion: nuevo === 'realizado' ? new Date().toISOString() : null,
    })
    .eq('id', pago.id)
    .eq('user_id', session.user.id);
  if (error) {
    console.warn('estado error', error);
    toast('No se pudo cambiar estado', 'error');
    return;
  }

  pago.estado = nuevo;
  const chk = trEl.querySelector('.check');
  const icon = trEl.querySelector('.check .material-symbols-rounded');
  const tag = trEl.querySelector('.tag');
  chk.classList.toggle('realizado', nuevo === 'realizado');
  icon.textContent = nuevo === 'realizado' ? 'done' : '';
  tag.textContent = nuevo;
  tag.className = `tag ${nuevo}`;

  // Releer y reordenar según estado + fecha
  await loadPagos();
  renderTables();
}

/* =============================== CLONAR ================================ */
async function openCloneModal() {
  const prev = prevPeriod(period);
  const { data, error } = await sb
    .from(PAGOS_TABLE)
    .select('*')
    .eq('user_id', session.user.id)
    .eq('mes', prev.month)
    .eq('anio', prev.year)
    .order('dia', { ascending: true });

  if (error) {
    console.warn('clone read error', error);
    toast('No se pudieron leer pagos del mes anterior', 'error');
    return;
  }

  const items = data || [];
  if (!items.length) {
    toast('No hay pagos en el mes anterior', 'warning');
    return;
  }

  // Previsualización con fecha reconstruida usando 'dia'
  const preview = items.map(x => {
    const d = Number(x.dia || 1);
    const newDate = makeDate(
      period.year,
      period.month,
      Math.min(d, lastDayOfMonth(period.year, period.month))
    );
    return { ...x, fecha_nueva: formatDate(newDate), dia: d, monto: Number(x.monto || 0) };
  });
  const total = preview.reduce((a, b) => a + b.monto, 0);

  const body = document.createElement('div');
  body.innerHTML = `
    <p>Se clonarán <strong>${preview.length}</strong> pagos hacia <strong>${monthNameEs(
    period.month
  )} ${period.year}</strong>.</p>
    <div class="table-wrap" style="max-height:40vh;overflow:auto;margin:.5rem 0">
      <table class="table">
        <thead>
          <tr><th>Fecha nueva</th><th>Pago</th><th>Deducido a</th><th>Responsable</th><th style="text-align:right">Monto</th></tr>
        </thead>
        <tbody>
          ${preview
      .map(
        p => `
            <tr>
              <td>${p.fecha_nueva}</td>
              <td>${esc(p.nombre_pago)}</td>
              <td>${esc(findUserName(p.usuario_deducido_id))}</td>
              <td>${esc(findUserName(p.usuario_responsable_id))}</td>
              <td style="text-align:right">${formatCurrency(p.monto)}</td>
            </tr>
          `
      )
      .join('')}
        </tbody>
        <tfoot>
          <tr><td colspan="4" style="text-align:right;font-weight:700">Total</td><td style="text-align:right;font-weight:700">${formatCurrency(
        total
      )}</td></tr>
        </tfoot>
      </table>
    </div>
    <p class="note">Todos quedarán como <em>pendiente</em>.</p>
  `;

  showModal({
    title: 'Cargar pagos del mes anterior',
    bodyNode: body,
    actions: [
      {
        text: 'Clonar',
        variant: 'primary',
        handler: async close => {
          const rows = preview.map(p => ({
            user_id: session.user.id,
            mes: period.month,
            anio: period.year,
            dia: p.dia,
            nombre_pago: p.nombre_pago,
            usuario_deducido_id: p.usuario_deducido_id,
            usuario_responsable_id: p.usuario_responsable_id,
            monto: p.monto,
            estado: 'pendiente',
            fecha_realizacion: null,
          }));
          const { error: e2 } = await sb.from(PAGOS_TABLE).insert(rows);
          if (e2) {
            console.warn('clone insert error', e2);
            toast('No se pudo clonar', 'error');
            return;
          }
          toast('Pagos clonados', 'success');
          close();
          await loadPagos();
          renderTables();
        },
      },
      { text: 'Cancelar', variant: 'ghost' },
    ],
  });
}

/* =============================== MODALS ================================ */
function showModal({ title, bodyNode, actions }) {
  const dlg = qs('#fallbackModal');
  if (!dlg) return;
  qs('#fallbackTitle').textContent = title;
  const body = qs('#fallbackBody');
  body.innerHTML = '';
  body.appendChild(bodyNode);
  const foot = qs('#fallbackFoot');
  foot.innerHTML = '';
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.className =
      'btn' + (a.variant === 'ghost' ? ' ghost' : a.variant === 'warn' ? ' warn' : '');
    btn.textContent = a.text;
    btn.addEventListener('click', async () => {
      if (a.handler) await a.handler(() => dlg.close());
      else dlg.close();
    });
    foot.appendChild(btn);
  });
  qs('#fallbackClose').onclick = () => dlg.close();
  dlg.addEventListener(
    'cancel',
    e => {
      e.preventDefault();
      dlg.close();
    },
    { once: true }
  );
  dlg.showModal();
}

/* ================================ UTIL ================================ */
function qs(q) { return document.querySelector(q); }
function normalizePeriod(p = {}) {
  const now = new Date();
  const month = Number(p.month ?? p.mes ?? p.monthNumber ?? (now.getMonth() + 1));
  const year = Number(p.year ?? p.anio ?? p.y ?? now.getFullYear());
  return { month, year };
}
function findUserName(id) { return users.find(u => String(u.id) === String(id))?.nombre || '—'; }
function makeDate(y, m, d) { return new Date(y, m - 1, d); }
function monthNameEs(m) { return new Date(2000, m - 1, 1).toLocaleDateString('es-CR', { month: 'long' }).replace(/^\w/, c => c.toUpperCase()); }
function prevPeriod(p) { return { month: p.month === 1 ? 12 : p.month - 1, year: p.month === 1 ? p.year - 1 : p.year }; }
function lastDayOfMonth(y, m) { return new Date(y, m, 0).getDate(); }
function pad2(n) { return String(n).padStart(2, '0'); }
function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function formatForInput(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function isDateInPeriod(s) { if (!s) return false; const d = new Date(s); return d.getFullYear() === period.year && (d.getMonth() + 1) === period.month; }
function toast(msg, type = 'info') {
  const host = qs('#toasts'); if (!host) return;
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = msg;
  host.appendChild(item);
  setTimeout(() => item.remove(), 3200);
}
