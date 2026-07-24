// validaciones.js — Vista de tareas Finalizadas por validar
// GestiónPH v2.0
// Depende de: config.js, datos.js, ui.js, firebase.js, aprobaciones.js (devolverTarea)

function renderValidaciones() {
  const cont = document.getElementById('content-validaciones');
  if (!cont) return;
  let pendientes = DATA.tareasEve.filter(t => t.est === 'Finalizado');
  if (!esStaff()) pendientes = pendientes.filter(t => puedeVerConjunto(t.conj));
  if (CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos') {
    pendientes = pendientes.filter(t => t.conj === CONJUNTO_SELECCIONADO);
  }

  cont.innerHTML = `
    <div class="ibox">☑️ <strong>Validaciones</strong> — Tareas marcadas como Finalizadas. Revisa y valida o devuelve para corrección.</div>
    ${pendientes.length ? pendientes.map(renderCardValidacion).join('') : '<div class="card" style="text-align:center;color:var(--txs);font-size:11px">Sin tareas por validar 🎉</div>'}
  `;
}

function renderCardValidacion(t) {
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:12px;font-weight:700;color:var(--v)">${t.n}</div>
        ${badgePrioridadHtml(t.pri)}
      </div>
      <div style="font-size:10px;color:var(--txs);margin-bottom:6px">${t.id} · ${t.conj} · ${t.enc} · ${t.tipo}</div>
      <div style="font-size:10px;background:var(--b);padding:8px;border-radius:6px;margin-bottom:8px">${t.obs}</div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-v btn-sm" onclick="validarYAprobar('${t.id}')">✓ Validar y aprobar</button>
        <button class="btn btn-sm" style="background:#fce8e6;color:var(--rj)" onclick="devolverTarea('${t.id}', 'En proceso')">↩ Devolver</button>
      </div>
    </div>
  `;
}

// Igual que aprobarTarea: paso interno de staff, sin comentario obligatorio
function validarYAprobar(id) {
  const t = DATA.tareasEve.find(t => t.id === id);
  if (!t) return;
  t.est = 'Aprobado';
  t.estUpdAt = Date.now();
  if (!t.aprobadoEn) t.aprobadoEn = Date.now();
  programarAutoSave();
  renderValidaciones();
  updBadge();
  toast('✓ Tarea validada y aprobada');
}
