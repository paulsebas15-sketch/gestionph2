// analitica.js — Panel de métricas: eventuales por estado, cumplimiento recurrentes,
// ranking de gestión por conjunto, evaluación del mes, fortalezas/oportunidades.
// GestiónPH v2.0
// Depende de: config.js, datos.js, ui.js, recurrentes.js, evaluacion.js
// Visible para Staff (todos los conjuntos) y Delegado (solo los suyos)

function conjuntosParaAnalitica() {
  let conjuntos = todosLosConjuntos().filter(c => esStaff() || puedeVerConjunto(c.n));
  if (CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos') {
    conjuntos = conjuntos.filter(c => c.n === CONJUNTO_SELECCIONADO);
  }
  return conjuntos;
}

function renderAnalitica() {
  const cont = document.getElementById('content-analitica');
  if (!cont) return;
  const mes = getMes();
  const conjuntos = conjuntosParaAnalitica();
  const nombresConj = conjuntos.map(c => c.n);

  const eventualesVisibles = DATA.tareasEve.filter(t => nombresConj.includes(t.conj));

  const porEstado = ESTADOS_EVENTUAL.map(est => ({
    est,
    count: eventualesVisibles.filter(t => t.est === est).length
  }));

  const cumplimientos = conjuntos.map(c => ({ conjunto: c.n, pct: calcularAvanceRecurrente(c.n, mes).pct }));

  const ranking = conjuntos.map(c => {
    const tareasConj = DATA.tareasEve.filter(t => t.conj === c.n);
    const finalizadasPct = tareasConj.length
      ? Math.round((tareasConj.filter(t => ESTADOS_FINALES.includes(t.est)).length / tareasConj.length) * 100)
      : 0;
    const cambiosMes = tareasConj.filter(t => t.estUpdAt && MESES[new Date(t.estUpdAt).getMonth()] === mes).length;
    return {
      conjunto: c.n, finalizadasPct, cambiosMes,
      cumplRecPct: calcularAvanceRecurrente(c.n, mes).pct,
      diasProm: diasPromedioFinalizar(c.n)
    };
  }).sort((a, b) => b.finalizadasPct - a.finalizadasPct);

  const evaluaciones = conjuntos.map(c => {
    const r = calcularNotaEvaluacion(c.n, mes);
    const rango = EVAL_RANGOS.find(rg => r.nota >= rg.min) || EVAL_RANGOS[EVAL_RANGOS.length - 1];
    return { conjunto: c.n, nota: r.nota, label: rango.label, clase: rango.clase };
  }).sort((a, b) => b.nota - a.nota);

  cont.innerHTML = `
    <div class="card">
      <div class="card-title">📌 Eventuales por estado</div>
      ${renderBarrasEventualesEstado(porEstado, eventualesVisibles.length)}
    </div>
    <div class="card">
      <div class="card-title">% Cumplimiento por conjunto (recurrentes) — ${mes}</div>
      <div class="bar-wrap">${renderBarrasCumplimiento(cumplimientos)}</div>
      <div style="display:flex;gap:10px;margin-top:8px;font-size:9px">
        <span style="color:#27ae60">■ ≥85% Excelente</span>
        <span style="color:var(--nr)">■ 60-84% Regular</span>
        <span style="color:var(--rj)">■ &lt;60% Deficiente</span>
      </div>
    </div>
    <div class="card">
      <div class="card-title">🏆 Ranking de gestión por conjunto</div>
      <div style="font-size:9px;color:var(--txs);margin-bottom:8px">% finalizadas+aprobadas = sobre el total histórico de eventuales del conjunto. Cambios de estado = movimiento registrado en ${mes}. Días prom. = tiempo entre creación y finalización de sus tareas (solo cuenta tareas con ambas fechas registradas).</div>
      <table class="tbl">
        <thead><tr><th>Conjunto</th><th>% Eventuales cerradas</th><th>Cambios de estado (${mes})</th><th>% Cumpl. recurrentes</th><th>Días prom. para finalizar</th></tr></thead>
        <tbody>${renderFilasRanking(ranking)}</tbody>
      </table>
    </div>
    <div class="card">
      <div class="card-title">📝 Evaluación — ${mes}</div>
      <table class="tbl">
        <thead><tr><th>Conjunto</th><th>Nota</th><th>Clasificación</th></tr></thead>
        <tbody>${renderFilasEvaluacion(evaluaciones)}</tbody>
      </table>
    </div>
  `;
}

function renderBarrasEventualesEstado(porEstado, total) {
  const max = Math.max(...porEstado.map(e => e.count), 1);
  const colores = {
    'Nuevo': '#1a6080', 'En proceso': '#b8860b', 'Pendiente aprobación': '#a83232',
    'Finalizado': '#2d6a4f', 'Aprobado': '#0d5c2e', 'Pausado': '#6c7a70', 'Suspendido': '#6a2d8c'
  };
  return porEstado.map(e => `
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
        <span>${e.est}</span>
        <span style="color:var(--txs)">${e.count} / ${total}</span>
      </div>
      <div style="background:var(--brd);border-radius:4px;height:8px;overflow:hidden">
        <div style="width:${Math.max((e.count / max) * 100, e.count > 0 ? 2 : 0)}%;height:100%;background:${colores[e.est] || '#888'}"></div>
      </div>
    </div>`).join('');
}

function renderFilasRanking(ranking) {
  if (!ranking.length) return '<tr><td colspan="5" style="text-align:center;color:var(--txs);font-size:10px;padding:10px">Sin conjuntos para mostrar</td></tr>';
  return ranking.map(r => `
    <tr>
      <td>${r.conjunto}</td>
      <td>${r.finalizadasPct}%</td>
      <td>${r.cambiosMes}</td>
      <td>${r.cumplRecPct}%</td>
      <td>${r.diasProm !== null ? r.diasProm + ' días' : '—'}</td>
    </tr>`).join('');
}

// Promedio de días entre creación (creadoEn) y finalización (finalizadoEn) — solo cuenta
// tareas que tengan ambas fechas capturadas (las migradas antes de este cambio no las tienen
// todas, y las nuevas de aquí en adelante sí las irán acumulando)
function diasPromedioFinalizar(conjuntoNombre) {
  const todas = [...DATA.tareasEve, ...DATA.tareasArchivo].filter(t => t.conj === conjuntoNombre && t.creadoEn && t.finalizadoEn);
  if (!todas.length) return null;
  const dias = todas.map(t => (t.finalizadoEn - t.creadoEn) / 86400000);
  return Math.round((dias.reduce((s, d) => s + d, 0) / dias.length) * 10) / 10;
}

function renderFilasEvaluacion(evaluaciones) {
  if (!evaluaciones.length) return '<tr><td colspan="3" style="text-align:center;color:var(--txs);font-size:10px;padding:10px">Sin conjuntos para mostrar</td></tr>';
  return evaluaciones.map(e => `
    <tr>
      <td>${e.conjunto}</td>
      <td>${e.nota}%</td>
      <td><span class="${e.clase}">${e.label}</span></td>
    </tr>`).join('');
}

function renderBarrasCumplimiento(cumplimientos) {
  if (!cumplimientos.length) return '<div style="font-size:11px;color:var(--txs)">Sin conjuntos para mostrar</div>';
  return cumplimientos.map(c => {
    const color = c.pct >= 85 ? '#27ae60' : (c.pct >= 60 ? 'var(--nr)' : 'var(--rj)');
    return `
      <div class="bar-col" title="${c.conjunto}">
        <div class="bar-track"><div class="bar" style="height:${Math.max(c.pct, 2)}%;background:${color}"></div></div>
        <div class="bar-val" style="color:${color}">${c.pct}%</div>
        <div class="bar-lbl">${c.conjunto}</div>
      </div>`;
  }).join('');
}
