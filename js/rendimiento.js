// rendimiento.js — Métricas por delegado, separadas por cada conjunto que administra
// GestiónPH v2.0
// Depende de: config.js, datos.js, ui.js, recurrentes.js, analitica.js (diasPromedioFinalizar)
// Fusionado dentro de Dashboard/"Resumen" (ya no es pestaña propia) — ver dashboard.js

function renderSeccionRendimiento(mes) {
  const delegados = DATA.usuarios.filter(u => u.rol === 'delegado' && (esStaff() || u.n === (usuarioActual() && usuarioActual().n)));
  return `
    <div class="card">
      <div class="card-title">🏆 Rendimiento por delegado — ${mes}</div>
      ${delegados.length ? delegados.map(d => renderGrupoDelegado(d, mes)).join('') : '<div style="font-size:11px;color:var(--txs);text-align:center;padding:12px">Sin delegados para mostrar</div>'}
    </div>
  `;
}

// Un encabezado por delegado + una tarjeta independiente por cada conjunto que administra
// (antes se promediaban juntos, ocultando el desempeño real de cada conjunto)
function renderGrupoDelegado(delegado, mes) {
  const conjs = (delegado.conjuntos || []).filter(c => conjuntoPorNombre(c));
  if (!conjs.length) {
    return `
      <div style="margin-bottom:14px">
        <div class="rend-delegado-nombre">${delegado.n}</div>
        <div style="font-size:11px;color:var(--txs);padding:8px 0">Sin conjuntos asignados</div>
      </div>`;
  }
  return `
    <div style="margin-bottom:14px">
      <div class="rend-delegado-nombre">${delegado.n}${conjs.length > 1 ? ` <span style="font-size:9px;color:var(--txs);font-weight:400">(${conjs.length} conjuntos)</span>` : ''}</div>
      ${conjs.map(c => renderRendCardConjunto(c, mes)).join('')}
    </div>
  `;
}

function renderRendCardConjunto(conjuntoNombre, mes) {
  const avance = calcularAvanceRecurrente(conjuntoNombre, mes);
  const pctRecurrentes = avance.pct;

  const eventualesConjunto = DATA.tareasEve.filter(t => t.conj === conjuntoNombre);
  const cerradas = eventualesConjunto.filter(t => ESTADOS_FINALES.includes(t.est));
  const vencidas = eventualesConjunto.filter(t => semaforo(t.vence, t.pri).icono === '🔴' && !ESTADOS_FINALES.includes(t.est));
  // Mismo cálculo que Analítica (creadoEn/finalizadoEn) — antes usaba el campo "reg", casi
  // siempre vacío en los datos reales, así que este número nunca era confiable
  const diasProm = diasPromedioFinalizar(conjuntoNombre);
  const tiempoProm = diasProm !== null ? `${diasProm} días` : '–';

  const color = pctRecurrentes >= 85 ? 'var(--vm)' : pctRecurrentes >= 60 ? 'var(--nr)' : 'var(--rj)';

  return `
    <div class="rend-card">
      <div class="rend-name">${conjuntoNombre}</div>
      <div class="rend-stats">
        <div class="rend-stat">Recurrentes: <strong style="color:${color}">${pctRecurrentes}%</strong></div>
        <div class="rend-stat">Eventuales cerradas: <strong>${cerradas.length}</strong></div>
        <div class="rend-stat">Vencidas: <strong style="color:var(--rj)">${vencidas.length}</strong></div>
        <div class="rend-stat">T. prom. cierre: <strong>${tiempoProm}</strong></div>
      </div>
      <div class="prog-wrap" style="margin-top:6px"><div class="prog-fill" style="width:${pctRecurrentes}%;background:${color}"></div></div>
    </div>
  `;
}
