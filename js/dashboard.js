// dashboard.js — Métricas globales, vencidas, y rendimiento por delegado ("Resumen")
// GestiónPH v2.0
// Depende de: config.js, datos.js, ui.js, recurrentes.js (calcularAvanceRecurrente), rendimiento.js

function renderDashboard() {
  const cont = document.getElementById('content-dashboard');
  if (!cont) return;
  const mes = getMes();
  const conjuntos = todosLosConjuntos().filter(c => esStaff() || puedeVerConjunto(c.n));

  const eventualesVisibles = DATA.tareasEve.filter(t => esStaff() || puedeVerConjunto(t.conj));
  const vencidas = eventualesVisibles.filter(t => semaforo(t.vence, t.pri).icono === '🔴' && !ESTADOS_FINALES.includes(t.est));
  const vencenPronto = eventualesVisibles.filter(t => semaforo(t.vence, t.pri).icono === '🟠' && !ESTADOS_FINALES.includes(t.est));

  const cumplimientos = conjuntos.map(c => ({ conjunto: c.n, pct: calcularAvanceRecurrente(c.n, mes).pct }));
  const promedioCumplimiento = cumplimientos.length
    ? Math.round(cumplimientos.reduce((s, c) => s + c.pct, 0) / cumplimientos.length)
    : 0;
  const conjuntosBuenos = cumplimientos.filter(c => c.pct >= 85).length;

  const evalProm = calcularEvalPromedioMes(mes);

  cont.innerHTML = `
    ${!esStaff() ? renderPendientesDelegado(mes) : ''}
    <div class="stats">
      <div class="stat"><div class="stat-num">${eventualesVisibles.length}</div><div class="stat-lbl">Eventuales totales</div></div>
      <div class="stat"><div class="stat-num red">${vencidas.length}</div><div class="stat-lbl">Vencidas sin cerrar</div></div>
      <div class="stat"><div class="stat-num ora">${vencenPronto.length}</div><div class="stat-lbl">Vencen pronto</div></div>
      <div class="stat"><div class="stat-num grn">${promedioCumplimiento}%</div><div class="stat-lbl">Cumpl. Recurrentes ${mes}</div></div>
      <div class="stat"><div class="stat-num">${evalProm}%</div><div class="stat-lbl">Eval. prom. ${mes}</div></div>
      <div class="stat"><div class="stat-num grn">${conjuntosBuenos}/${cumplimientos.length}</div><div class="stat-lbl">Conjuntos ≥85%</div></div>
    </div>
    <div class="card">
      <div class="card-title">🔴 Tareas vencidas sin cerrar (${vencidas.length})</div>
      ${renderListaVencidas(vencidas)}
    </div>
    ${renderSeccionRendimiento(mes)}
  `;
}

// Tarjeta destacada solo para Delegados: sus tareas recurrentes por vencer (las que tienen
// fecha manual fijada este mes) + sus tareas eventuales vencidas/próximas a vencer.
function renderPendientesDelegado(mes) {
  const usuario = usuarioActual();
  const conjs = (usuario && usuario.conjuntos) || [];
  if (!conjs.length) return '';

  const recPendientes = [];
  conjs.forEach(conjNombre => {
    tareasRecPara(conjNombre, mes).forEach(t => {
      const fecha = obtenerFechaTareaRec(conjNombre, mes, t);
      if (!fecha) return;
      const sem = semaforo(fecha, 'Media');
      if (sem.icono !== '🟠' && sem.icono !== '🔴') return;
      const veces = t.veces || 1;
      const todasHechas = Array.from({ length: veces }, (_, s) => ensureEstadoSlot(conjNombre, mes, t._idx, s)).every(sl => sl.done);
      if (todasHechas) return;
      recPendientes.push({ nombre: t.n, conjunto: conjNombre, fecha, sem });
    });
  });

  const eveDelegado = DATA.tareasEve.filter(t => conjs.includes(t.conj) && !ESTADOS_FINALES.includes(t.est));
  const evePendientes = eveDelegado
    .map(t => ({ ...t, sem: semaforo(t.vence, t.pri) }))
    .filter(t => t.sem.icono === '🟠' || t.sem.icono === '🔴');

  const eventosProximos = eventosProximosParaAviso(usuario, conjs);

  if (!recPendientes.length && !evePendientes.length && !eventosProximos.length) {
    return `<div class="card" style="background:#e8f4ec;border-color:#b8d8c0"><div style="font-size:12px;color:var(--v)">✓ Sin pendientes urgentes por ahora. ¡Buen trabajo!</div></div>`;
  }

  const LIMITE_PENDIENTES = 6;
  const eveOrdenadas = [...evePendientes].sort((a, b) => (parseFechaCorta(a.vence) || 0) - (parseFechaCorta(b.vence) || 0));
  const eveVisibles = eveOrdenadas.slice(0, LIMITE_PENDIENTES);
  const eveResto = eveOrdenadas.length - eveVisibles.length;

  return `
    <div class="card" style="background:#fff8e8;border-color:#f0d896">
      <div class="card-title" style="color:#8a6d1a">⚠️ Debes atender esto</div>
      ${recPendientes.length ? `
        <div style="font-size:10px;font-weight:600;color:var(--txs);margin:6px 0 4px">Tareas recurrentes por vencer:</div>
        ${recPendientes.map(r => `
          <div style="font-size:11px;padding:4px 0;display:flex;justify-content:space-between">
            <span>${r.sem.icono} ${r.nombre} <span style="color:var(--txs);font-size:9px">(${r.conjunto})</span></span>
            <span style="color:var(--txs);font-size:10px">Vence ${r.fecha}</span>
          </div>`).join('')}
      ` : ''}
      ${evePendientes.length ? `
        <div style="font-size:10px;font-weight:600;color:var(--txs);margin:8px 0 4px">Tareas eventuales vencidas o por vencer (${evePendientes.length}):</div>
        ${eveVisibles.map(t => `
          <div style="font-size:11px;padding:4px 0;display:flex;justify-content:space-between;cursor:pointer" onclick="cambiarPestana('eventuales');setTimeout(()=>abrirDetalleEventual('${t.id}'),50)">
            <span>${t.sem.icono} ${t.n} <span style="color:var(--txs);font-size:9px">(${t.conj})</span></span>
            <span style="color:var(--txs);font-size:10px">Vence ${t.vence}</span>
          </div>`).join('')}
        ${eveResto > 0 ? `<div style="text-align:center;padding:6px 0 2px;font-size:10px;color:var(--txs);cursor:pointer" onclick="cambiarPestana('eventuales')">+ ${eveResto} más… ver todas en Eventuales</div>` : ''}
      ` : ''}
      ${eventosProximos.length ? `
        <div style="font-size:10px;font-weight:600;color:var(--txs);margin:8px 0 4px">Reuniones y eventos de este mes (${eventosProximos.length}):</div>
        ${eventosProximos.map(e => `
          <div style="font-size:11px;padding:4px 0;display:flex;justify-content:space-between;cursor:pointer" onclick="cambiarPestana('calendario')">
            <span>${e.esManana ? '🔴' : '📅'} ${ICONO_TIPO_EVENTO[e.tipo] || '📌'} ${e.titulo || e.tipo}${e.conjunto ? ` <span style="color:var(--txs);font-size:9px">(${e.conjunto})</span>` : ''}</span>
            <span style="color:var(--txs);font-size:10px">${e.esManana ? 'Mañana' : fechaCortaDesdeIso(e.fecha)}${e.hora ? ' · ' + horaAMPM(e.hora) : ''}</span>
          </div>`).join('')}
      ` : ''}
    </div>
  `;
}

// Eventos del Calendario (todos los tipos) que aún no pasan y caen dentro de lo que resta del
// mes actual (por fecha real de hoy, no el mes elegido en el header) — mismo criterio de
// visibilidad para delegado que usa Calendario: sus conjuntos + capacitaciones donde participe
function eventosProximosParaAviso(usuario, conjs) {
  const eventos = DATA.eventosCalendario.filter(e =>
    (e.conjunto && conjs.includes(e.conjunto)) ||
    (e.tipo === 'Capacitación' && (e.participantes || []).includes(usuario.n))
  );
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const manana = new Date(hoy); manana.setDate(hoy.getDate() + 1);
  const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  return eventos
    .map(e => ({ ...e, _fechaObj: fechaIsoADate(e.fecha) }))
    .filter(e => e._fechaObj && e._fechaObj >= hoy && e._fechaObj <= finMes)
    .sort((a, b) => a._fechaObj - b._fechaObj)
    .map(e => ({ ...e, esManana: e._fechaObj.getTime() === manana.getTime() }));
}

function renderListaVencidas(vencidas, limite = 5) {
  if (!vencidas.length) return '<div style="font-size:11px;color:var(--txs);text-align:center;padding:12px">Sin tareas vencidas 🎉</div>';
  const ordenadas = [...vencidas].sort((a, b) => (parseFechaCorta(a.vence) || 0) - (parseFechaCorta(b.vence) || 0));
  const visibles = ordenadas.slice(0, limite);
  const resto = ordenadas.length - visibles.length;
  let html = visibles.map(t => `
    <div class="venc-row">
      <span class="venc-date">${t.vence}</span>
      <span class="venc-name">${t.n}</span>
      <span class="venc-conj">${t.conj}</span>
    </div>`).join('');
  if (resto > 0) {
    html += `<div style="text-align:center;padding:8px;font-size:10px;color:var(--txs)">+ ${resto} tareas más…</div>`;
  }
  return html;
}

function calcularEvalPromedioMes(mes) {
  const conjuntos = todosLosConjuntos().filter(c => esStaff() || puedeVerConjunto(c.n));
  const notas = conjuntos.map(c => calcularNotaEvaluacion(c.n, mes).nota);
  if (!notas.length) return 0;
  return Math.round(notas.reduce((s, n) => s + n, 0) / notas.length);
}
