// eventuales.js — CRUD tareas eventuales, estados, filtros, semáforo, multi-conjunto
// GestiónPH v2.0
// Depende de: config.js, datos.js, ui.js

const PAGINA_TAMANO = 50;
let PAGINA_ACTUAL_EVE = 1;

// Vigencias posibles según semáforo, para el chip de filtro "Vigencia"
const VIGENCIAS = [
  { key: 'vigente', label: 'Vigente', icono: '🟢' },
  { key: 'proxima', label: 'Próx. a vencer', icono: '🟠' },
  { key: 'vencida', label: 'Vencida', icono: '🔴' }
];
const ICONO_A_VIGENCIA = { '🟢': 'vigente', '🟠': 'proxima', '🔴': 'vencida' };

// El selector de conjunto del header también filtra Eventuales (igual que Recurrentes/
// Evaluación): si hay un conjunto específico elegido (no "Todos"), la tabla se limita a ese
// conjunto — esto es lo que arregla que un delegado con 2+ conjuntos no pudiera aislar uno
// solo, y que el selector "no hiciera nada" en Eventuales.
function eventualesVisiblesBase() {
  let lista = DATA.tareasEve.filter(t => esStaff() || puedeVerConjunto(t.conj));
  if (CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos') {
    lista = lista.filter(t => t.conj === CONJUNTO_SELECCIONADO);
  }
  return lista;
}

function eventualesFiltradas() {
  let lista = eventualesVisiblesBase();
  const f = FILTROS_EVENTUALES;
  if (f.estados && f.estados.length) lista = lista.filter(t => f.estados.includes(t.est));
  if (f.vigencias && f.vigencias.length) {
    lista = lista.filter(t => {
      const vig = ICONO_A_VIGENCIA[semaforo(t.vence, t.pri).icono];
      return f.vigencias.includes(vig);
    });
  }
  if (f.busqueda) {
    const q = f.busqueda.toLowerCase();
    lista = lista.filter(t => t.n.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
  }
  return lista;
}

// ─── SNAPSHOT DE LA LISTA VISIBLE ──────────────────────────────
// La lista NO se recalcula en vivo cada vez que cambia el estado de una tarea (para no hacer
// que una fila "desaparezca" de golpe mientras el usuario está revisando varias). Solo se
// vuelve a tomar la foto cuando el usuario cambia un filtro/búsqueda, o reabre la pestaña.
let SNAPSHOT_EVE_IDS = null;

function tomarSnapshotEventuales() {
  SNAPSHOT_EVE_IDS = eventualesFiltradas().map(t => t.id);
}

function listaVisibleEventuales() {
  if (SNAPSHOT_EVE_IDS === null) tomarSnapshotEventuales();
  return SNAPSHOT_EVE_IDS
    .map(id => DATA.tareasEve.find(t => t.id === id))
    .filter(Boolean); // tareas archivadas/eliminadas sí desaparecen (ya no existen)
}

function renderEventuales() {
  const cont = document.getElementById('content-eventuales');
  if (!cont) return;
  cargarFiltrosPersistentes();
  const todas = listaVisibleEventuales();
  const totalPaginas = Math.max(1, Math.ceil(todas.length / PAGINA_TAMANO));
  PAGINA_ACTUAL_EVE = Math.min(PAGINA_ACTUAL_EVE, totalPaginas);
  const inicio = (PAGINA_ACTUAL_EVE - 1) * PAGINA_TAMANO;
  const pagina = todas.slice(inicio, inicio + PAGINA_TAMANO);

  cont.innerHTML = `
    <div class="card" style="margin-bottom:10px">
      <div style="font-size:9px;color:var(--txs);font-weight:600;margin-bottom:6px">Estado:</div>
      <div class="chip-row">${ESTADOS_EVENTUAL.map(e => renderChip('estados', e, badgeEstadoDotColor(e))).join('')}</div>
      <div style="font-size:9px;color:var(--txs);font-weight:600;margin:10px 0 6px">Vigencia:</div>
      <div class="chip-row">${VIGENCIAS.map(v => renderChip('vigencias', v.key, null, `${v.icono} ${v.label}`)).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
        <input class="form-input" style="width:200px;font-size:10px;padding:5px 8px" placeholder="🔍 Buscar tarea…" value="${FILTROS_EVENTUALES.busqueda || ''}" oninput="setBusquedaEve(this.value)">
        ${(FILTROS_EVENTUALES.estados.length || FILTROS_EVENTUALES.vigencias.length || FILTROS_EVENTUALES.busqueda) ? '<button class="btn btn-g btn-sm" onclick="limpiarFiltrosEve()">✕ Limpiar filtros</button>' : ''}
        <button class="btn btn-v btn-sm" style="margin-left:auto" onclick="abrirNuevaEventual()">➕ Nueva tarea</button>
      </div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <table class="tbl">
        <thead><tr><th>ID</th><th>Nombre</th><th>Tipo</th><th>Conjunto</th><th>Encargado</th><th>Prioridad</th><th>Estado</th><th>Vence</th><th></th></tr></thead>
        <tbody>${pagina.map(renderFilaEventual).join('')}</tbody>
      </table>
      ${!pagina.length ? '<div style="text-align:center;padding:16px;font-size:11px;color:var(--txs)">Sin tareas que coincidan con los filtros</div>' : ''}
    </div>
    <div class="pag-wrap">
      <button class="pag-btn" ${PAGINA_ACTUAL_EVE <= 1 ? 'disabled' : ''} onclick="cambiarPaginaEve(-1)">← Anterior</button>
      <span>Mostrando ${pagina.length} de ${todas.length} tareas (pág. ${PAGINA_ACTUAL_EVE}/${totalPaginas})</span>
      <button class="pag-btn" ${PAGINA_ACTUAL_EVE >= totalPaginas ? 'disabled' : ''} onclick="cambiarPaginaEve(1)">Siguiente →</button>
    </div>
  `;
}

function badgeEstadoDotColor(estado) {
  const colores = {
    'Nuevo': '#1a6080', 'En proceso': '#856404', 'Pausado': '#721c24',
    'Pendiente aprobación': '#4a235a', 'Finalizado': '#155724',
    'Aprobado': '#0d5c2e', 'Suspendido': '#721c24'
  };
  return colores[estado] || 'var(--txs)';
}

function renderChip(grupo, valor, colorPunto, etiqueta) {
  const activo = FILTROS_EVENTUALES[grupo].includes(valor);
  return `
    <button class="chip ${activo ? 'chip-activo' : ''}" onclick="toggleFiltroEve('${grupo}','${valor}')">
      ${colorPunto ? `<span class="chip-dot" style="background:${colorPunto}"></span>` : ''}${etiqueta || valor}
    </button>
  `;
}

function toggleFiltroEve(grupo, valor) {
  const lista = FILTROS_EVENTUALES[grupo];
  const idx = lista.indexOf(valor);
  if (idx >= 0) lista.splice(idx, 1); else lista.push(valor);
  PAGINA_ACTUAL_EVE = 1;
  guardarFiltrosPersistentes();
  tomarSnapshotEventuales(); // cambiar filtro SÍ actualiza la lista visible
  renderEventuales();
}

function setBusquedaEve(valor) {
  FILTROS_EVENTUALES.busqueda = valor;
  PAGINA_ACTUAL_EVE = 1;
  guardarFiltrosPersistentes();
  tomarSnapshotEventuales();
  renderEventuales();
}

function limpiarFiltrosEve() {
  FILTROS_EVENTUALES.estados = [];
  FILTROS_EVENTUALES.vigencias = [];
  FILTROS_EVENTUALES.busqueda = '';
  PAGINA_ACTUAL_EVE = 1;
  guardarFiltrosPersistentes();
  tomarSnapshotEventuales();
  renderEventuales();
}

function cambiarPaginaEve(delta) {
  PAGINA_ACTUAL_EVE += delta;
  renderEventuales();
}

function renderFilaEventual(t) {
  return `
    <tr onclick="abrirDetalleEventual('${t.id}')" style="cursor:pointer">
      <td style="font-size:10px;color:var(--txs)">${t.id}</td>
      <td style="font-size:11px;font-weight:500">${t.n}</td>
      <td style="font-size:9px;color:var(--txs)">${t.tipo}</td>
      <td style="font-size:10px">${t.conj}</td>
      <td style="font-size:10px">${t.enc}</td>
      <td>${badgePrioridadHtml(t.pri)}</td>
      <td>${badgeEstadoHtml(t.est)}</td>
      <td style="font-size:10px">${t.vence}</td>
      <td>${semaforoHtml(t.vence, t.pri)}</td>
    </tr>
  `;
}

// ─── CREACIÓN (multi-conjunto) ────────────────────────────────
function abrirNuevaEventual() {
  const cont = document.getElementById('multi-conjunto-checks');
  const conjuntosDisponibles = esStaff() ? todosLosConjuntos().map(c => c.n) : conjuntosVisibles(usuarioActual());
  // BUG corregido: antes, para un delegado con 2+ conjuntos, TODOS quedaban marcados y
  // deshabilitados — no podía desmarcar el que no quería, así que cualquier tarea se creaba
  // en ambos conjuntos sin querer. Ahora quedan pre-marcados (comodidad) pero editables.
  // Si solo tiene un conjunto, ese sí se deja fijo (no tiene sentido desmarcar el único).
  const soloUno = conjuntosDisponibles.length === 1;
  // Si el header tiene un conjunto específico elegido, solo ese queda pre-marcado (evita crear
  // sin querer la misma tarea en conjuntos que no tocaba) — con "Todos" se deja el comportamiento
  // de siempre (todos marcados, editables)
  const filtroEspecifico = CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos';
  if (cont) {
    cont.innerHTML = conjuntosDisponibles.map((n, i) => {
      const marcado = filtroEspecifico ? n === CONJUNTO_SELECCIONADO : true;
      return `
      <label style="font-size:10px;background:white;padding:4px 8px;border-radius:6px;border:1px solid var(--brd);cursor:pointer">
        <input type="checkbox" value="${n}" ${marcado ? 'checked' : ''} ${(!esStaff() && soloUno) ? 'disabled' : ''}> ${n}
      </label>
    `;
    }).join('');
  }
  document.getElementById('nueva-eve-fecha').value = sugerirFechaVencimiento('Media');
  document.getElementById('nueva-eve-prioridad').onchange = (e) => {
    document.getElementById('nueva-eve-fecha').value = sugerirFechaVencimiento(e.target.value);
  };
  openOv('modal-nueva-eve');
}

function crearTareaEventual() {
  const conjuntosSeleccionados = [...document.querySelectorAll('#multi-conjunto-checks input:checked')].map(i => i.value);
  const nombre = document.getElementById('nueva-eve-nombre').value.trim();
  const desc = document.getElementById('nueva-eve-desc').value.trim();
  const tipo = document.getElementById('nueva-eve-tipo').value;
  const prioridad = document.getElementById('nueva-eve-prioridad').value;
  const encargado = document.getElementById('nueva-eve-encargado').value;
  const fechaIso = document.getElementById('nueva-eve-fecha').value;

  if (!conjuntosSeleccionados.length) { toast('Selecciona al menos un conjunto'); return; }
  if (!nombre) { toast('El nombre de la tarea es obligatorio'); return; }
  if (!desc) { toast('La descripción es obligatoria'); return; }

  const vence = isoAFechaCorta(fechaIso);
  const reg = fechaCortaCol();
  const usuario = usuarioActual();

  const idsCreados = [];
  conjuntosSeleccionados.forEach(conj => {
    const id = siguienteIdEventual();
    DATA.tareasEve.push({
      id, n: nombre, obs: desc, tipo, conj,
      enc: encargado, ra: (usuario ? usuario.n : '').toLowerCase(),
      apr: usuario ? usuario.n : '',
      pri: prioridad, est: 'Nuevo', estUpdAt: Date.now(), creadoEn: Date.now(),
      reg, vence, coms: []
    });
    idsCreados.push(id);
  });

  clearForm('form-nueva-eve');
  closeOv('modal-nueva-eve');
  guardarLocal();
  idsCreados.forEach(id => guardarTareaEventualEnSupabase(id)); // guardado individual: solo estas tareas nuevas, ninguna otra se toca
  tomarSnapshotEventuales(); // tarea nueva sí debe aparecer de inmediato
  renderEventuales();
  updBadge();
  toast(`✓ Tarea creada en ${conjuntosSeleccionados.length} conjunto(s)`);
}

// ─── DETALLE / CAMBIO DE ESTADO ───────────────────────────────
function abrirDetalleEventual(id) {
  const t = DATA.tareasEve.find(t => t.id === id);
  if (!t) return;
  const modal = document.getElementById('modal-detalle-eve');
  modal.dataset.id = id;
  document.getElementById('detalle-eve-nombre').textContent = t.n;
  document.getElementById('detalle-eve-meta').textContent = `${t.id} · ${t.conj} · ${t.enc}`;
  document.getElementById('detalle-eve-prioridad').outerHTML = badgePrioridadHtml(t.pri).replace('<span', '<span id="detalle-eve-prioridad"');
  document.getElementById('detalle-eve-estado').outerHTML = badgeEstadoHtml(t.est).replace('<span', '<span id="detalle-eve-estado"');
  document.getElementById('detalle-eve-tipo').textContent = t.tipo;
  document.getElementById('detalle-eve-sem').innerHTML = semaforoHtml(t.vence, t.pri) + ` Vence ${t.vence}`;
  document.getElementById('detalle-eve-obs').textContent = t.obs;
  document.getElementById('detalle-eve-fechas').textContent = `Creada: ${t.reg} · Vence: ${t.vence} · Aprobador: ${t.apr || '–'}`;
  document.getElementById('detalle-eve-coms').innerHTML = (t.coms || []).length
    ? t.coms.map(c => `<div style="font-size:10px;padding:5px 0;border-bottom:.5px solid var(--brd)">${c}</div>`).join('')
    : '<div style="font-size:10px;color:var(--txs)">Sin comentarios</div>';
  document.getElementById('detalle-eve-com-input').value = '';
  renderBotonesEstadoDetalle(t);
  openOv('modal-detalle-eve');
}

function renderBotonesEstadoDetalle(t) {
  const cont = document.getElementById('detalle-eve-acciones');
  const puedeAdmin = esStaff();
  const esCreador = t.ra === (usuarioActual() ? usuarioActual().n.toLowerCase() : '');
  const opciones = puedeAdmin
    ? ['Nuevo', 'En proceso', 'Pausado', 'Finalizado', 'Aprobado', 'Suspendido']
    : ['Nuevo', 'En proceso', 'Pausado', 'Finalizado'];
  cont.innerHTML = opciones.map(e => `
    <button class="btn btn-sm ${e === t.est ? '' : ''}" style="background:${estiloBotonEstado(e, t.est)}" onclick="cambiarEstadoEventual('${t.id}','${e}')">${e === t.est ? '● ' : ''}${e}</button>
  `).join('');
}

function estiloBotonEstado(estado, actual) {
  const colores = {
    'Nuevo': '#e8f4f8;color:#1a6080',
    'En proceso': '#fef3cd;color:#856404',
    'Pausado': '#f8d7da;color:#721c24',
    'Finalizado': '#d4edda;color:#155724',
    'Aprobado': '#cce5d4;color:#0d5c2e',
    'Suspendido': '#f8d7da;color:#721c24'
  };
  return colores[estado] || '';
}

// El estado cambia, pero la lista visible de Eventuales NO se recalcula aquí a propósito:
// renderEventuales() usa el snapshot ya tomado, así la fila no desaparece de golpe mientras
// se sigue trabajando. Solo se re-toma la foto al cambiar un filtro o reabrir la pestaña.
// Cambiar estado exige un comentario explicando el cambio (regla del usuario) — sin comentario
// no se aplica el cambio. Se usa prompt() nativo del navegador como ventana emergente simple.
function cambiarEstadoEventual(id, nuevoEstado) {
  const t = DATA.tareasEve.find(t => t.id === id);
  if (!t) return;
  const comentario = prompt(`Comentario obligatorio para cambiar "${t.n}" a "${nuevoEstado}":`);
  if (comentario === null || !comentario.trim()) {
    toast('Cambio de estado cancelado: se requiere un comentario');
    return;
  }
  t.est = nuevoEstado;
  t.estUpdAt = Date.now();
  // Estas fechas se capturan una sola vez (la primera vez que la tarea llega a ese estado) y
  // nunca se sobreescriben, a diferencia de estUpdAt — permiten medir tiempos de gestión
  if (nuevoEstado === 'En proceso' && !t.enProcesoEn) t.enProcesoEn = Date.now();
  if (nuevoEstado === 'Finalizado' && !t.finalizadoEn) t.finalizadoEn = Date.now();
  if (nuevoEstado === 'Aprobado' && !t.aprobadoEn) t.aprobadoEn = Date.now();

  const usuario = usuarioActual();
  t.coms = t.coms || [];
  t.coms.push(`${comentario.trim()} - ${usuario ? usuario.n : '—'} ${fechaCortaCol()}`);

  programarGuardadoEventual(id); // guardado individual: solo esta tarea, ninguna otra se toca
  abrirDetalleEventual(id);
  renderEventuales();
  updBadge();
  toast(`Estado actualizado: ${nuevoEstado}`);
}

function enviarComentarioEventual() {
  const modal = document.getElementById('modal-detalle-eve');
  const id = modal.dataset.id;
  const t = DATA.tareasEve.find(t => t.id === id);
  const texto = document.getElementById('detalle-eve-com-input').value.trim();
  if (!t || !texto) return;
  const usuario = usuarioActual();
  t.coms = t.coms || [];
  t.coms.push(`${texto} - ${usuario ? usuario.n : '—'} ${fechaCortaCol()}`);
  programarGuardadoEventual(id); // guardado individual: solo esta tarea, ninguna otra se toca
  abrirDetalleEventual(id);
}

// Eliminar tarea (solo admin) — se borra de verdad en Supabase (antes solo desaparecía
// localmente para quien la borraba, ver hallazgo de sincronización: eliminarEventual no tenía
// ningún botón conectado en la interfaz todavía, no afectaba a nadie en producción)
function eliminarEventual(id) {
  DATA.tareasEve = DATA.tareasEve.filter(t => t.id !== id);
  guardarLocal();
  eliminarEventualEnSupabase(id);
  tomarSnapshotEventuales();
  renderEventuales();
  updBadge();
}
