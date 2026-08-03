// tareasAV.js — Tareas internas del equipo A&V (no de conjuntos, sin delegados)
// GestiónPH v2.0 — misma estructura visual y de edición que Eventuales, pero sin conjunto:
// el encargado se elige del equipo de Staff en vez del delegado de un conjunto.
// Depende de: config.js, datos.js, ui.js. Solo Staff ve esta pestaña (ver PESTANAS_POR_ROL).

let FILTROS_AV = { estados: [], busqueda: '' };

function cargarFiltrosAVPersistentes() {
  try {
    const guardado = JSON.parse(localStorage.getItem('gph_filtrosAV') || 'null');
    if (guardado) FILTROS_AV = guardado;
  } catch (e) { /* ignorar */ }
}

function guardarFiltrosAVPersistentes() {
  localStorage.setItem('gph_filtrosAV', JSON.stringify(FILTROS_AV));
}

function tareasAVFiltradas() {
  let lista = [...DATA.tareasAV].sort((a, b) => {
    const diff = (b.creadoEn || 0) - (a.creadoEn || 0);
    return diff !== 0 ? diff : (b.id || '').localeCompare(a.id || '');
  });
  const f = FILTROS_AV;
  if (f.estados.length) lista = lista.filter(t => f.estados.includes(t.est));
  if (f.busqueda) {
    const q = f.busqueda.toLowerCase();
    lista = lista.filter(t => t.n.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
  }
  return lista;
}

function renderTareasAV() {
  const cont = document.getElementById('content-tareasAV');
  if (!cont) return;
  cargarFiltrosAVPersistentes();
  const lista = tareasAVFiltradas();

  cont.innerHTML = `
    <div class="card" style="margin-bottom:10px">
      <div style="font-size:9px;color:var(--txs);font-weight:600;margin-bottom:6px">Estado:</div>
      <div class="chip-row">${ESTADOS_EVENTUAL.map(e => renderChipAV(e)).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
        <input class="form-input" style="width:200px;font-size:10px;padding:5px 8px" placeholder="🔍 Buscar tarea…" value="${FILTROS_AV.busqueda || ''}" oninput="setBusquedaAV(this.value)">
        ${(FILTROS_AV.estados.length || FILTROS_AV.busqueda) ? '<button class="btn btn-g btn-sm" onclick="limpiarFiltrosAV()">✕ Limpiar filtros</button>' : ''}
        <button class="btn btn-v btn-sm" style="margin-left:auto" onclick="abrirNuevaTareaAV()">➕ Nueva tarea A&V</button>
      </div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <table class="tbl">
        <thead><tr><th>ID</th><th>Nombre</th><th>Tipo</th><th>Encargado</th><th>Prioridad</th><th>Estado</th><th>Vence</th><th></th></tr></thead>
        <tbody>${lista.map(renderFilaTareaAV).join('')}</tbody>
      </table>
      ${!lista.length ? '<div style="text-align:center;padding:16px;font-size:11px;color:var(--txs)">Sin tareas que coincidan con los filtros</div>' : ''}
    </div>
  `;
}

function renderChipAV(estado) {
  const activo = FILTROS_AV.estados.includes(estado);
  return `
    <button class="chip ${activo ? 'chip-activo' : ''}" onclick="toggleFiltroAV('${estado}')">
      <span class="chip-dot" style="background:${badgeEstadoDotColor(estado)}"></span>${estado}
    </button>`;
}

function toggleFiltroAV(estado) {
  const idx = FILTROS_AV.estados.indexOf(estado);
  if (idx >= 0) FILTROS_AV.estados.splice(idx, 1); else FILTROS_AV.estados.push(estado);
  guardarFiltrosAVPersistentes();
  renderTareasAV();
}

function setBusquedaAV(valor) {
  FILTROS_AV.busqueda = valor;
  guardarFiltrosAVPersistentes();
  renderTareasAV();
}

function limpiarFiltrosAV() {
  FILTROS_AV = { estados: [], busqueda: '' };
  guardarFiltrosAVPersistentes();
  renderTareasAV();
}

function renderFilaTareaAV(t) {
  return `
    <tr onclick="abrirDetalleTareaAV('${t.id}')" style="cursor:pointer">
      <td style="font-size:10px;color:var(--txs)">${t.id}</td>
      <td style="font-size:11px;font-weight:500">${t.n}</td>
      <td style="font-size:9px;color:var(--txs)">${t.tipo || '–'}</td>
      <td style="font-size:10px">${t.enc || '–'}</td>
      <td>${t.pri ? badgePrioridadHtml(t.pri) : '<span style="font-size:9px;color:var(--txs)">–</span>'}</td>
      <td>${badgeEstadoHtml(t.est)}</td>
      <td style="font-size:10px">${t.vence || '–'}</td>
      <td>${t.vence ? semaforoHtml(t.vence, t.pri) : ''}</td>
    </tr>`;
}

// ─── CREACIÓN ──────────────────────────────────────────────────
function abrirNuevaTareaAV() {
  document.getElementById('av-tipo').innerHTML = TIPOS_AV.map(t => `<option>${t}</option>`).join('');
  document.getElementById('av-prioridad').innerHTML = PRIORIDADES.map(p => `<option ${p === 'Media' ? 'selected' : ''}>${p}</option>`).join('');
  document.getElementById('av-encargado').innerHTML = DATA.usuarios.filter(u => u.rol === 'staff').map(u => `<option>${u.n}</option>`).join('');
  document.getElementById('av-nombre').value = '';
  document.getElementById('av-desc').value = '';
  document.getElementById('av-fecha').value = sugerirFechaVencimiento('Media');
  document.getElementById('av-prioridad').onchange = (e) => {
    document.getElementById('av-fecha').value = sugerirFechaVencimiento(e.target.value);
  };
  openOv('modal-nueva-av');
}

function crearTareaAV() {
  const nombre = document.getElementById('av-nombre').value.trim();
  const desc = document.getElementById('av-desc').value.trim();
  const tipo = document.getElementById('av-tipo').value;
  const prioridad = document.getElementById('av-prioridad').value;
  const encargado = document.getElementById('av-encargado').value;
  const fechaIso = document.getElementById('av-fecha').value;

  if (!nombre) { toast('El nombre de la tarea es obligatorio'); return; }
  if (!desc) { toast('La descripción es obligatoria'); return; }

  const usuario = usuarioActual();
  const id = siguienteIdAV();
  DATA.tareasAV.push({
    id, n: nombre, obs: desc, tipo, enc: encargado, ra: usuario ? usuario.n : '',
    pri: prioridad, est: 'Nuevo', estUpdAt: Date.now(), creadoEn: Date.now(),
    vence: isoAFechaCorta(fechaIso), coms: []
  });
  closeOv('modal-nueva-av');
  guardarLocal();
  guardarTareaAVEnSupabase(id); // guardado individual: solo esta tarea, ninguna otra se toca
  renderTareasAV();
  toast('✓ Tarea A&V creada');
}

// ─── DETALLE / CAMBIO DE ESTADO ────────────────────────────────
function abrirDetalleTareaAV(id) {
  const t = DATA.tareasAV.find(t => t.id === id);
  if (!t) return;
  const modal = document.getElementById('modal-detalle-av');
  modal.dataset.id = id;
  document.getElementById('detalle-av-nombre').textContent = t.n;
  document.getElementById('detalle-av-meta').textContent = `${t.id} · ${t.enc || 'Sin encargado'}`;
  document.getElementById('detalle-av-prioridad').outerHTML = (t.pri ? badgePrioridadHtml(t.pri) : '<span></span>').replace('<span', '<span id="detalle-av-prioridad"');
  document.getElementById('detalle-av-estado').outerHTML = badgeEstadoHtml(t.est).replace('<span', '<span id="detalle-av-estado"');
  document.getElementById('detalle-av-tipo').textContent = t.tipo || '';
  document.getElementById('detalle-av-sem').innerHTML = t.vence ? semaforoHtml(t.vence, t.pri) + ` Vence ${t.vence}` : 'Sin fecha de vencimiento';
  document.getElementById('detalle-av-obs').textContent = t.obs || '';
  document.getElementById('detalle-av-fechas').textContent = `Creada: ${t.creadoEn ? fechaCortaCol(new Date(t.creadoEn)) : '–'} · Vence: ${t.vence || '–'}`;
  document.getElementById('detalle-av-coms').innerHTML = (t.coms || []).length
    ? t.coms.map(c => `<div style="font-size:10px;padding:5px 0;border-bottom:.5px solid var(--brd)">${c}</div>`).join('')
    : '<div style="font-size:10px;color:var(--txs)">Sin comentarios</div>';
  document.getElementById('detalle-av-com-input').value = '';
  renderBotonesEstadoAV(t);
  openOv('modal-detalle-av');
}

function renderBotonesEstadoAV(t) {
  const cont = document.getElementById('detalle-av-acciones');
  cont.innerHTML = ESTADOS_EVENTUAL.map(e => `
    <button class="btn btn-sm" style="background:${estiloBotonEstado(e, t.est)}" onclick="cambiarEstadoAV('${t.id}','${e}')">${e === t.est ? '● ' : ''}${e}</button>
  `).join('');
}

function cambiarEstadoAV(id, nuevoEstado) {
  const t = DATA.tareasAV.find(t => t.id === id);
  if (!t) return;
  const comentario = prompt(`Comentario obligatorio para cambiar "${t.n}" a "${nuevoEstado}":`);
  if (comentario === null || !comentario.trim()) {
    toast('Cambio de estado cancelado: se requiere un comentario');
    return;
  }
  t.est = nuevoEstado;
  t.estUpdAt = Date.now();
  if (nuevoEstado === 'En proceso' && !t.enProcesoEn) t.enProcesoEn = Date.now();
  if (nuevoEstado === 'Finalizado' && !t.finalizadoEn) t.finalizadoEn = Date.now();
  if (nuevoEstado === 'Aprobado' && !t.aprobadoEn) t.aprobadoEn = Date.now();

  const usuario = usuarioActual();
  t.coms = t.coms || [];
  t.coms.push(`${comentario.trim()} - ${usuario ? usuario.n : '—'} ${fechaCortaCol()}`);

  guardarLocal();
  guardarTareaAVEnSupabase(id); // guardado individual: solo esta tarea, ninguna otra se toca
  abrirDetalleTareaAV(id);
  renderTareasAV();
  toast(`Estado actualizado: ${nuevoEstado}`);
}

function enviarComentarioAV() {
  const modal = document.getElementById('modal-detalle-av');
  const id = modal.dataset.id;
  const t = DATA.tareasAV.find(t => t.id === id);
  const texto = document.getElementById('detalle-av-com-input').value.trim();
  if (!t || !texto) return;
  const usuario = usuarioActual();
  t.coms = t.coms || [];
  t.coms.push(`${texto} - ${usuario ? usuario.n : '—'} ${fechaCortaCol()}`);
  guardarLocal();
  guardarTareaAVEnSupabase(id); // guardado individual: solo esta tarea, ninguna otra se toca
  abrirDetalleTareaAV(id);
}

// ─── EDICIÓN (siempre completa — solo Staff usa esta pestaña) ──
function abrirEditarAV() {
  const id = document.getElementById('modal-detalle-av').dataset.id;
  const t = DATA.tareasAV.find(t => t.id === id);
  if (!t) return;
  document.getElementById('editar-av-id').value = t.id;
  document.getElementById('editar-av-nombre').value = t.n;
  document.getElementById('editar-av-desc').value = t.obs || '';
  document.getElementById('editar-av-tipo').innerHTML = TIPOS_AV.map(tp => `<option ${tp === t.tipo ? 'selected' : ''}>${tp}</option>`).join('');
  document.getElementById('editar-av-prioridad').innerHTML = PRIORIDADES.map(p => `<option ${p === t.pri ? 'selected' : ''}>${p}</option>`).join('');
  document.getElementById('editar-av-encargado').innerHTML = DATA.usuarios.filter(u => u.rol === 'staff').map(u => `<option ${u.n === t.enc ? 'selected' : ''}>${u.n}</option>`).join('');
  document.getElementById('editar-av-fecha').value = t.vence ? fechaCortaAIso(t.vence) : '';
  closeOv('modal-detalle-av');
  openOv('modal-editar-av');
}

function guardarEdicionAV() {
  const id = document.getElementById('editar-av-id').value;
  const t = DATA.tareasAV.find(t => t.id === id);
  if (!t) return;
  const nombre = document.getElementById('editar-av-nombre').value.trim();
  const desc = document.getElementById('editar-av-desc').value.trim();
  if (!nombre) { toast('El nombre de la tarea es obligatorio'); return; }
  if (!desc) { toast('La descripción es obligatoria'); return; }

  t.n = nombre;
  t.obs = desc;
  t.tipo = document.getElementById('editar-av-tipo').value;
  t.pri = document.getElementById('editar-av-prioridad').value;
  t.enc = document.getElementById('editar-av-encargado').value;
  const fechaIso = document.getElementById('editar-av-fecha').value;
  t.vence = fechaIso ? isoAFechaCorta(fechaIso) : null;

  guardarLocal();
  guardarTareaAVEnSupabase(id); // guardado individual: solo esta tarea, ninguna otra se toca
  closeOv('modal-editar-av');
  renderTareasAV();
  toast('✓ Tarea A&V actualizada');
}
