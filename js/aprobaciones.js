// aprobaciones.js — Vista de tareas pendientes de aprobación (solo admin)
// GestiónPH v2.0
// Depende de: config.js, datos.js, ui.js

function renderAprobaciones() {
  const cont = document.getElementById('content-aprobaciones');
  if (!cont) return;
  let pendientes = DATA.tareasEve.filter(t => t.est === 'Pendiente aprobación');
  if (CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos') {
    pendientes = pendientes.filter(t => t.conj === CONJUNTO_SELECCIONADO);
  }

  cont.innerHTML = `
    <div class="ibox">👍 <strong>Aprobaciones</strong> — Tareas en "Pendiente aprobación". Revisa y aprueba o devuelve al delegado.</div>
    ${pendientes.length ? pendientes.map(renderCardAprobacion).join('') : '<div class="card" style="text-align:center;color:var(--txs);font-size:11px">Sin tareas pendientes de aprobación 🎉</div>'}
  `;
}

function renderCardAprobacion(t) {
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div><div style="font-size:12px;font-weight:700;color:var(--v)">${t.n}</div><div style="font-size:10px;color:var(--txs)">${t.id} · ${t.conj} · ${t.enc}</div></div>
        ${badgePrioridadHtml(t.pri)}
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px">${badgeEstadoHtml(t.est)}<span style="font-size:10px;color:var(--txs)">${t.tipo}</span><span class="sem" style="margin-left:auto">${semaforoHtml(t.vence, t.pri)}</span></div>
      <div style="font-size:10px;background:var(--b);padding:8px;border-radius:6px;margin-bottom:8px">${t.obs}</div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-v btn-sm" onclick="aprobarTarea('${t.id}')">✓ Aprobar</button>
        <button class="btn btn-sm" style="background:#fce8e6;color:var(--rj)" onclick="devolverTarea('${t.id}', 'En proceso')">↩ Devolver</button>
        <button class="btn btn-sm btn-g" onclick="abrirDetalleEventual('${t.id}')">💬 Comentar</button>
      </div>
    </div>
  `;
}

// Aprobar es un paso interno de staff (verificar que el trabajo del delegado ya quedó bien
// hecho) — no depende del delegado, así que NO pide comentario obligatorio, a diferencia de
// los cambios de estado que sí hace el delegado (ver cambiarEstadoEventual en eventuales.js)
function aprobarTarea(id) {
  const t = DATA.tareasEve.find(t => t.id === id);
  if (!t) return;
  t.est = 'Aprobado';
  t.estUpdAt = Date.now();
  if (!t.aprobadoEn) t.aprobadoEn = Date.now();
  programarGuardadoEventual(id); // guardado individual: solo esta tarea, ninguna otra se toca
  renderAprobaciones();
  updBadge();
  toast('✓ Tarea aprobada');
}

// Devolver sí exige comentario: le regresa trabajo al delegado, y queda registrado el motivo
// (ej. "falta soporte fotográfico") para que sepa qué corregir
function devolverTarea(id, estadoDestino) {
  const t = DATA.tareasEve.find(t => t.id === id);
  if (!t) return;
  const motivo = prompt(`Motivo para devolver "${t.n}" a "${estadoDestino}":`);
  if (motivo === null || !motivo.trim()) {
    toast('Devolución cancelada: se requiere un motivo');
    return;
  }
  t.est = estadoDestino;
  t.estUpdAt = Date.now();
  const usuario = usuarioActual();
  t.coms = t.coms || [];
  t.coms.push(`${motivo.trim()} - ${usuario ? usuario.n : '—'} ${fechaCortaCol()}`);
  programarGuardadoEventual(id); // guardado individual: solo esta tarea, ninguna otra se toca
  renderAprobaciones();
  if (typeof renderValidaciones === 'function') renderValidaciones();
  updBadge();
  toast('↩ Tarea devuelta');
}
