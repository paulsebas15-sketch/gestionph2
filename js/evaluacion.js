// evaluacion.js — Nota por conjunto y mes según la plantilla real de evaluación
// GestiónPH v2.0
// Depende de: config.js, datos.js, ui.js, recurrentes.js
//
// Transcrito de las plantillas reales de v1.0 (confirmado por el usuario a partir de
// capturas de pantalla): dos plantillas fijas de puntaje, una por tipo de conjunto.
// Cada ítem tiene un "peso" fijo (los pesos SIEMPRE suman 32 en Definitivos y 35 en
// Provisional, incluyendo los dos ítems especiales al final). Los ítems "auto" se
// calculan del cumplimiento de la tarea recurrente homónima; los "manual" los ingresa
// gerencia directamente (0 al peso máximo).
//
// ⚠️ Transcripción hecha a partir de capturas de pantalla — revisar con el usuario que
// los pesos/ítems/auto-manual coincidan exactamente antes de usarlo para evaluaciones reales.

const PLANTILLA_EVAL = {
  'Definitivos': [
    { tarea: 'Envío movimientos, recaudos y extracto', peso: 1, manual: false },
    { tarea: 'Facturación a copropietarios', peso: 1, manual: false },
    { tarea: 'Pago retefuente', peso: 1, manual: false },
    { tarea: 'Envío movimientos y recaudos para gestión de cartera', peso: 1, manual: false },
    { tarea: 'Gestión de cartera', peso: 4, manual: true },
    { tarea: 'Envío paquete contable', peso: 2, manual: false },
    { tarea: 'Gestión de pagos a proveedores', peso: 1, manual: false },
    { tarea: 'Envío recibo servicios públicos', peso: 1, manual: false },
    { tarea: 'Revisión cronograma mantenimientos', peso: 2, manual: false },
    { tarea: 'Recorrido de inspección', peso: 1, manual: false },
    { tarea: 'Envío informe gestión + convocatoria consejo', peso: 3, manual: true },
    { tarea: 'Reunión de consejo de adm.', peso: 1, manual: false },
    { tarea: 'Envío acta de reunión de consejo', peso: 2, manual: true },
    { tarea: 'Ejecución de presupuesto y proyectos', peso: 1, manual: false },
    { tarea: 'Envío boletín informativo', peso: 3, manual: true },
    { tarea: 'Comunicación convivencia semanal', peso: 2, manual: false },
    { tarea: 'Envío de listado de propietarios en proceso jurídico a abogados actualizado', peso: 1, manual: false },
    { tarea: 'Envío de propietarios para procesos jurídicos nuevos', peso: 1, manual: false }
  ],
  'Provisional (A&V)': [
    { tarea: 'Envío movimientos, recaudos y extracto', peso: 1, manual: false },
    { tarea: 'Facturación a copropietarios', peso: 1, manual: false },
    { tarea: 'Pago retefuente', peso: 1, manual: false },
    { tarea: 'Envío movimientos y recaudos para gestión de cartera', peso: 1, manual: false },
    { tarea: 'Gestión de cartera', peso: 4, manual: true },
    { tarea: 'Envío paquete contable', peso: 2, manual: false },
    { tarea: 'Gestión de pagos a proveedores', peso: 1, manual: false },
    { tarea: 'Envío recibo servicios públicos', peso: 1, manual: false },
    { tarea: 'Revisión cronograma mantenimientos', peso: 1, manual: false },
    { tarea: 'Recorrido de inspección', peso: 1, manual: false },
    { tarea: 'Actualización base de datos y app', peso: 1, manual: false },
    { tarea: 'Radicación cuenta cobro constructora', peso: 4, manual: false },
    { tarea: 'Comunicado cobro % administración', peso: 1, manual: false },
    { tarea: 'Envío informe inicial o mensual a constructora', peso: 3, manual: true },
    { tarea: 'Envío boletín informativo', peso: 3, manual: true },
    { tarea: 'Comunicación convivencia semanal', peso: 2, manual: false },
    { tarea: 'Gestión de entrega', peso: 2, manual: false }
  ]
};

// Ítems especiales — no son tareas recurrentes, se calculan aparte y se suman al total
const PESO_GESTION_EVENTUALES = 3;
const PESO_ASISTENCIA = 2;
// Umbrales de "Gestión tareas eventuales" (según % logrado con el puntaje por tarea de abajo)
const UMBRALES_GESTION_EVENTUALES = [
  { min: 85, pts: 3 },
  { min: 68, pts: 2 },
  { min: 50, pts: 1 },
  { min: 0, pts: 0 }
];

// Estados que dan 1.0 pt (cerraron su ciclo este mes): Finalizado/Aprobado = se resolvió,
// Suspendido = ya no se va a realizar, también es un cierre de ciclo (regla del usuario).
// Pausado o cualquier otro avance (ej. Nuevo→En proceso) sin llegar a esos 3 estados = 0.5 pt.
// Sin ningún cambio de estado este mes = 0 pts.
const ESTADOS_GESTION_EVE_1_0 = ['Finalizado', 'Aprobado', 'Suspendido'];

function tipoConjunto(conjuntoNombre) {
  const c = conjuntoPorNombre(conjuntoNombre);
  if (!c) return 'Definitivos';
  return (DATA.conjuntos.def || []).includes(c) ? 'Definitivos' : 'Provisional (A&V)';
}

function plantillaEvalPara(conjuntoNombre) {
  return PLANTILLA_EVAL[tipoConjunto(conjuntoNombre)] || [];
}

function clasificacionEval(nota) {
  return EVAL_RANGOS.find(r => nota >= r.min);
}

function ensureEvalManual(conjunto, mes) {
  EVAL_MANUAL[conjunto] = EVAL_MANUAL[conjunto] || {};
  EVAL_MANUAL[conjunto][mes] = EVAL_MANUAL[conjunto][mes] || { tareas: {}, cartera: '', asistencia: '' };
  EVAL_MANUAL[conjunto][mes].tareas = EVAL_MANUAL[conjunto][mes].tareas || {};
  return EVAL_MANUAL[conjunto][mes];
}

// Calcula el puntaje de un ítem de la plantilla (auto o manual) contra la tareasRec homónima.
// IMPORTANTE: la tarea recurrente base tiene entradas DUPLICADAS por tipo (una para
// Definitivos y otra para Provisional (A&V), con el mismo nombre pero distinto aplica/veces/
// evalPts) — hay que filtrar también por tipo, si no un conjunto Provisional podía leer por
// error los datos de la tarea "hermana" de Definitivos (mismo nombre, primera en el array).
function calcularItemEval(item, conjuntoNombre, mes) {
  const tipo = tipoConjunto(conjuntoNombre);
  const idx = DATA.tareasRec.findIndex(t => t.n === item.tarea && !t.deleted && (t.aplica === tipo || t.aplica === 'Todos'));
  const tareaRec = idx >= 0 ? DATA.tareasRec[idx] : null;
  const manualData = ensureEvalManual(conjuntoNombre, mes);

  if (item.manual) {
    let puntos = manualData.tareas[item.tarea];
    if (puntos === undefined) {
      // Retrocompatibilidad: si viene de datos migrados con 'cartera' (%) y este es el ítem de cartera
      if (item.tarea === 'Gestión de cartera' && manualData.cartera) {
        puntos = Math.round((parseFloat(manualData.cartera) / 100) * item.peso);
      } else {
        puntos = 0;
      }
    }
    return { ...item, ganado: Math.min(Math.max(puntos, 0), item.peso), notFound: !tareaRec, doneSlots: null, totalSlots: null };
  }

  if (!tareaRec) return { ...item, ganado: 0, notFound: true, doneSlots: 0, totalSlots: 0 };
  if (!tareaRecActiva(tareaRec, mes)) return { ...item, ganado: 0, notFound: false, excluida: true, doneSlots: 0, totalSlots: 0 };

  const veces = tareaRec.veces || 1;
  let doneSlots = 0;
  for (let s = 0; s < veces; s++) {
    const slot = ensureEstadoSlot(conjuntoNombre, mes, idx, s);
    if (slot.done) doneSlots++;
  }
  const ganado = item.peso * (doneSlots / veces);
  return { ...item, ganado, notFound: false, doneSlots, totalSlots: veces };
}

// "Gestión tareas eventuales" — mide la gestión REAL del mes evaluado, no el histórico acumulado.
// Pool del mes = tareas que seguían "en juego" al día 1 (se excluyen las que ya estaban
// Finalizadas/Aprobadas/Pausadas/Suspendidas ANTES de empezar el mes — eso ya no es gestión de
// este mes). Dentro del pool, cada tarea suma puntos según qué le pasó durante el mes:
// 1.0 si cerró su ciclo (Finalizado/Aprobado/Suspendido), 0.5 si avanzó sin cerrar o se pausó,
// 0 si no tuvo ningún cambio de estado este mes.
function calcularGestionEventuales(conjuntoNombre, mes) {
  const ESTADOS_YA_CERRADOS = ['Finalizado', 'Aprobado', 'Pausado', 'Suspendido'];
  const cambioEsteMes = t => t.estUpdAt && MESES[new Date(t.estUpdAt).getMonth()] === mes;

  const tareasConj = DATA.tareasEve.filter(t => t.conj === conjuntoNombre);
  // Ya estaba cerrada/parada ANTES de este mes = está en un estado "cerrado" y ese cierre NO
  // ocurrió este mes → se excluye del pool porque no es gestión del mes evaluado
  const pool = tareasConj.filter(t => !(ESTADOS_YA_CERRADOS.includes(t.est) && !cambioEsteMes(t)));

  let puntos = 0;
  pool.forEach(t => {
    if (!cambioEsteMes(t)) return; // sin cambios este mes = 0 pts
    puntos += ESTADOS_GESTION_EVE_1_0.includes(t.est) ? 1.0 : 0.5;
  });

  const pct = pool.length > 0 ? Math.round((puntos / pool.length) * 100) : 0;
  const nivel = UMBRALES_GESTION_EVENTUALES.find(u => pct >= u.min);
  return { peso: PESO_GESTION_EVENTUALES, ganado: nivel.pts, pct, puntos: Math.round(puntos * 10) / 10, poolSize: pool.length };
}

// "Asistencia y puntualidad" — score manual 0-100 convertido proporcionalmente a 0-peso pts
function calcularAsistencia(conjuntoNombre, mes) {
  const manualData = ensureEvalManual(conjuntoNombre, mes);
  const score = parseFloat(manualData.asistencia);
  const scoreValido = isNaN(score) ? null : Math.min(Math.max(score, 0), 100);
  const ganado = scoreValido === null ? 0 : Math.round((scoreValido / 100) * PESO_ASISTENCIA);
  return { peso: PESO_ASISTENCIA, ganado, score: scoreValido };
}

// Único cálculo de nota — reusado por dashboard.js
function calcularNotaEvaluacion(conjuntoNombre, mes) {
  const items = plantillaEvalPara(conjuntoNombre).map(item => calcularItemEval(item, conjuntoNombre, mes));
  const gestionEve = calcularGestionEventuales(conjuntoNombre, mes);
  const asistencia = calcularAsistencia(conjuntoNombre, mes);

  const pesoItems = items.reduce((s, i) => s + i.peso, 0);
  const ganadoItems = items.reduce((s, i) => s + i.ganado, 0);
  const pesoTotal = pesoItems + gestionEve.peso + asistencia.peso;
  const ganadoTotal = ganadoItems + gestionEve.ganado + asistencia.ganado;
  const nota = pesoTotal > 0 ? Math.round((ganadoTotal / pesoTotal) * 100) : 0;

  return { nota, items, gestionEve, asistencia, pesoTotal, ganadoTotal: Math.round(ganadoTotal * 10) / 10 };
}

function renderEvaluacion() {
  const cont = document.getElementById('content-evaluacion');
  if (!cont) return;
  const mes = getMes();
  // El selector de conjunto del header también filtra el resumen (igual que Calendario/
  // Recurrentes/Eventuales/Aprobaciones/Validaciones): con "Todos" se ve el panorama completo,
  // con un conjunto específico el resumen se limita a ese único conjunto.
  const conjuntos = (CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos')
    ? todosLosConjuntos().filter(c => c.n === CONJUNTO_SELECCIONADO)
    : todosLosConjuntos();
  const conjuntoDetalle = (esStaff() && CONJUNTO_SELECCIONADO !== 'Todos') ? CONJUNTO_SELECCIONADO
    : (!esStaff() ? CONJUNTO_SELECCIONADO : null);

  cont.innerHTML = `
    <div class="card">
      <div class="card-title">Resumen evaluaciones — ${mes}</div>
      ${conjuntos.map(c => renderFilaEval(c, mes)).join('')}
    </div>
    ${conjuntoDetalle
      ? renderDetalleEval(conjuntoDetalle, mes)
      : '<div class="card" style="text-align:center;padding:24px;color:var(--txs);font-size:12px">📌 Selecciona un conjunto específico arriba para ver el detalle de ítems de evaluación.</div>'}
  `;
}

function renderFilaEval(c, mes) {
  if (c.deleted) return '';
  const res = calcularNotaEvaluacion(c.n, mes);
  const clasif = clasificacionEval(res.nota);
  const color = res.nota >= 90 ? '#27ae60' : res.nota >= 75 ? '#2980b9' : res.nota >= 60 ? 'var(--nr)' : 'var(--rj)';
  return `
    <div class="eval-row" style="cursor:pointer" onclick="setConjuntoSeleccionado('${c.n}')">
      <div class="eval-n"><strong>${c.n}</strong><span style="font-size:9px;color:var(--txs);margin-left:6px">${c.del} · ${res.ganadoTotal}/${res.pesoTotal} pts</span></div>
      <div class="eval-bar-wrap"><div class="eval-bar" style="width:${res.nota}%;background:${color}"></div></div>
      <div class="eval-pct" style="color:${color}">${res.nota}%</div>
      <span class="nota-chip ${clasif.clase}">${clasif.label}</span>
    </div>
  `;
}

function renderDetalleEval(conjuntoNombre, mes) {
  const res = calcularNotaEvaluacion(conjuntoNombre, mes);
  const clasif = clasificacionEval(res.nota);

  const filasItems = res.items.map(item => renderFilaItemEval(item, conjuntoNombre, mes)).join('');
  const filaGestionEve = `
    <tr>
      <td><strong>⭐ Gestión tareas eventuales</strong><div style="font-size:8px;color:var(--txs)">Auto: ${res.gestionEve.puntos}/${res.gestionEve.poolSize} pool del mes (${res.gestionEve.pct}%) · ≥85%→3pts · 68-84%→2pts · 50-67%→1pt</div></td>
      <td style="text-align:center">${res.gestionEve.peso}/${plantillaEvalPara(conjuntoNombre).reduce((s, i) => s + i.peso, 0) + PESO_GESTION_EVENTUALES + PESO_ASISTENCIA}</td>
      <td style="text-align:center"><span style="font-size:9px;color:var(--az)">auto</span></td>
      <td style="text-align:center;font-weight:700">${res.gestionEve.ganado}/${res.gestionEve.peso}</td>
    </tr>`;
  const filaAsistencia = `
    <tr>
      <td><strong>📋 Asistencia y puntualidad</strong><div style="font-size:8px;color:var(--txs)">Manual gerencia · Score 0-100 → convertido a 0-${PESO_ASISTENCIA}pts</div></td>
      <td style="text-align:center">${PESO_ASISTENCIA}</td>
      <td style="text-align:center"><span style="font-size:9px;color:var(--nr)">manual</span></td>
      <td style="text-align:center">
        <input class="form-input" style="width:60px;padding:3px 5px;font-size:10px;text-align:center" id="eval-asistencia-score" value="${res.asistencia.score ?? ''}" placeholder="0-100" onblur="guardarAsistenciaEval('${conjuntoNombre}','${mes}',this.value)">
      </td>
    </tr>`;

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div class="card-title" style="margin:0">Ítems de evaluación — ${conjuntoNombre} · ${mes} <span style="font-size:9px;color:var(--txs);text-transform:none">(${tipoConjunto(conjuntoNombre)})</span></div>
        <span class="nota-chip ${clasif.clase}">${res.nota}% · ${clasif.label}</span>
      </div>
      <div style="font-size:9px;color:var(--txs);margin-bottom:8px">🔵 Auto = calculado por el sistema · 🟠 Manual = ingresado por gerencia</div>
      <table class="tbl">
        <thead><tr><th>Ítem</th><th style="text-align:center">Peso</th><th style="text-align:center">Tipo</th><th style="text-align:center">Puntaje</th></tr></thead>
        <tbody>${filasItems}${filaGestionEve}${filaAsistencia}</tbody>
      </table>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:8px;border-top:1px solid var(--brd)">
        <strong style="font-size:11px">TOTAL ${mes}</strong>
        <strong style="font-size:12px;color:var(--rj)">${res.ganadoTotal}/${res.pesoTotal} pts = ${res.nota}%</strong>
      </div>
      <div style="font-size:8px;color:var(--txs);margin-top:6px">Los puntajes manuales se guardan solos al salir del campo.</div>
    </div>
  `;
}

function renderFilaItemEval(item, conjuntoNombre, mes) {
  const subtitulo = item.notFound
    ? '<span style="color:var(--rj)">⚠ Tarea no encontrada en Recurrentes</span>'
    : (item.excluida ? 'No aplica este mes (bimestral)' : (item.totalSlots > 1 ? `${item.doneSlots}/${item.totalSlots} repeticiones` : ''));

  const puntajeHtml = item.manual
    ? `<input class="form-input eval-item-manual" style="width:50px;padding:3px 5px;font-size:10px;text-align:center" data-tarea="${item.tarea}" value="${item.ganado}" min="0" max="${item.peso}" onblur="guardarItemManualEval('${conjuntoNombre}','${mes}',this)">`
    : `<span style="font-weight:700">${Math.round(item.ganado * 10) / 10}/${item.peso}</span>`;

  return `
    <tr>
      <td>${item.tarea}${subtitulo ? `<div style="font-size:8px;color:var(--txs)">${subtitulo}</div>` : ''}</td>
      <td style="text-align:center">${item.peso}</td>
      <td style="text-align:center"><span style="font-size:9px;color:${item.manual ? 'var(--nr)' : 'var(--az)'}">${item.manual ? 'manual' : 'auto'}</span></td>
      <td style="text-align:center">${puntajeHtml}</td>
    </tr>
  `;
}

// Autoguardado por campo (onblur) — antes había que llenar todo y darle clic a un botón
// aparte; si alguien cambiaba de pestaña sin hacerlo, el puntaje escrito se perdía sin aviso
function guardarItemManualEval(conjunto, mes, inputEl) {
  const tarea = inputEl.dataset.tarea;
  const peso = parseFloat(inputEl.max) || 999;
  const valor = Math.min(Math.max(parseFloat(inputEl.value) || 0, 0), peso);
  const manualData = ensureEvalManual(conjunto, mes);
  manualData.tareas[tarea] = valor;
  programarGuardadoEvalManual(conjunto, mes); // guardado individual: solo este conjunto/mes, ninguna otra evaluación se toca
  renderEvaluacion();
}

function guardarAsistenciaEval(conjunto, mes, valor) {
  const manualData = ensureEvalManual(conjunto, mes);
  manualData.asistencia = valor.trim();
  programarGuardadoEvalManual(conjunto, mes); // guardado individual: solo este conjunto/mes, ninguna otra evaluación se toca
  renderEvaluacion();
}
