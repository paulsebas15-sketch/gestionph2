// calendario.js — Grilla mensual: reuniones de consejo, recorridos, proveedores, capacitaciones
// GestiónPH v2.0
// Depende de: config.js, datos.js, ui.js, auth.js

const TIPOS_EVENTO = ['Reunión de consejo', 'Recorrido', 'Reunión con proveedores', 'Capacitación', 'Otro'];
// Un delegado puede crear cualquier tipo salvo Capacitación (solo Staff la organiza)
const TIPOS_EVENTO_DELEGADO = ['Reunión de consejo', 'Recorrido', 'Reunión con proveedores', 'Otro'];

const ICONO_TIPO_EVENTO = {
  'Reunión de consejo': '🏛️',
  'Recorrido': '🚶',
  'Reunión con proveedores': '🤝',
  'Capacitación': '🎓',
  'Otro': '📌'
};

// ─── VISIBILIDAD ────────────────────────────────────────────────
// El selector de conjunto del header también filtra Calendario: con un conjunto específico
// elegido solo se ven sus eventos (las Capacitaciones, al ser transversales sin conjunto,
// siempre se muestran si el usuario participa, sin importar el filtro del header).
function eventosVisibles() {
  let lista;
  if (esStaff()) {
    lista = DATA.eventosCalendario;
  } else {
    const usuario = usuarioActual();
    const conjs = (usuario && usuario.conjuntos) || [];
    lista = DATA.eventosCalendario.filter(e =>
      (e.conjunto && conjs.includes(e.conjunto)) ||
      (e.tipo === 'Capacitación' && (e.participantes || []).includes(usuario.n))
    );
  }
  if (CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos') {
    lista = lista.filter(e => e.conjunto === CONJUNTO_SELECCIONADO || e.tipo === 'Capacitación');
  }
  return lista;
}

function eventosDelMes(mes) {
  return eventosVisibles().filter(e => mesDeFechaIso(e.fecha) === mes);
}

function puedeEditarEvento(evento) {
  if (esStaff()) return true;
  const usuario = usuarioActual();
  return usuario && evento.creadoPor === usuario.n;
}

// ─── RENDER: GRILLA MENSUAL ──────────────────────────────────────
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function renderCalendario() {
  const cont = document.getElementById('content-calendario');
  if (!cont) return;
  const mes = getMes();
  const anio = new Date().getFullYear();
  const mesIdx = MESES.indexOf(mes);
  const eventos = eventosDelMes(mes);

  const porFecha = {};
  eventos.forEach(e => {
    porFecha[e.fecha] = porFecha[e.fecha] || [];
    porFecha[e.fecha].push(e);
  });

  const primerDia = new Date(anio, mesIdx, 1);
  const totalDias = new Date(anio, mesIdx + 1, 0).getDate();
  // getDay(): 0=domingo..6=sábado → convertir a lunes=0..domingo=6
  const offsetInicio = (primerDia.getDay() + 6) % 7;

  const celdas = [];
  for (let i = 0; i < offsetInicio; i++) celdas.push(null);
  for (let d = 1; d <= totalDias; d++) celdas.push(d);
  while (celdas.length % 7 !== 0) celdas.push(null);

  const hoy = new Date();
  const esHoy = (d) => d && hoy.getFullYear() === anio && hoy.getMonth() === mesIdx && hoy.getDate() === d;

  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div class="card-title" style="margin:0">📅 ${mes} ${anio}${CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos' ? ` · ${CONJUNTO_SELECCIONADO}` : ''}</div>
      <button class="btn btn-v btn-sm" onclick="abrirNuevoEvento()">➕ Nuevo evento</button>
    </div>
    <div class="cal-grid">
      ${DIAS_SEMANA.map(d => `<div class="cal-dow">${d}</div>`).join('')}
      ${celdas.map(d => renderCeldaDia(d, mesIdx, anio, porFecha, esHoy(d))).join('')}
    </div>
  `;
}

function renderCeldaDia(dia, mesIdx, anio, porFecha, esHoy) {
  if (!dia) return `<div class="cal-day cal-day-vacio"></div>`;
  const iso = `${anio}-${String(mesIdx + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  const eventosDia = (porFecha[iso] || []).sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
  const LIMITE = 3;
  const visibles = eventosDia.slice(0, LIMITE);
  const resto = eventosDia.length - visibles.length;

  return `
    <div class="cal-day ${esHoy ? 'cal-day-hoy' : ''}" onclick="abrirNuevoEvento('${iso}')">
      <div class="cal-daynum">${dia}</div>
      ${visibles.map(e => `
        <div class="cal-evento" title="${e.titulo || e.tipo}" onclick="event.stopPropagation(); abrirEditarEvento('${e.id}')">
          ${ICONO_TIPO_EVENTO[e.tipo] || '📌'} ${e.hora ? horaAMPM(e.hora) + ' ' : ''}${e.titulo || e.tipo}
        </div>`).join('')}
      ${resto > 0 ? `<div class="cal-mas" onclick="event.stopPropagation()">+${resto} más</div>` : ''}
    </div>
  `;
}

// ─── CREAR / EDITAR ─────────────────────────────────────────────
function tiposDisponibles() {
  return esStaff() ? TIPOS_EVENTO : TIPOS_EVENTO_DELEGADO;
}

function conjuntosDisponiblesEvento() {
  return esStaff() ? todosLosConjuntos().map(c => c.n) : conjuntosVisibles(usuarioActual());
}

function poblarFormularioEvento() {
  document.getElementById('ev-tipo').innerHTML = tiposDisponibles().map(t => `<option>${t}</option>`).join('');
  document.getElementById('ev-conjunto-checks').innerHTML = conjuntosDisponiblesEvento().map(n => `
    <label style="font-size:10px;background:white;padding:4px 8px;border-radius:6px;border:1px solid var(--brd);cursor:pointer">
      <input type="checkbox" value="${n}"> ${n}
    </label>`).join('');
  document.getElementById('ev-participantes').innerHTML = DATA.usuarios.map(u => `
    <label style="font-size:10px;background:white;padding:4px 8px;border-radius:6px;border:1px solid var(--brd);cursor:pointer">
      <input type="checkbox" value="${u.n}"> ${u.n}
    </label>`).join('');
  actualizarVisibilidadCamposEvento();
}

// Capacitación no lleva conjunto (transversal); el resto sí. Participantes solo aplica a Capacitación.
function actualizarVisibilidadCamposEvento() {
  const tipo = document.getElementById('ev-tipo').value;
  document.getElementById('ev-conjunto-wrap').classList.toggle('oculto', tipo === 'Capacitación');
  document.getElementById('ev-participantes-wrap').classList.toggle('oculto', tipo !== 'Capacitación');
}

function abrirNuevoEvento(fechaIso) {
  document.getElementById('ev-modal-titulo').textContent = '➕ Nuevo evento';
  document.getElementById('ev-btn-guardar').textContent = '✓ Crear';
  document.getElementById('ev-btn-eliminar').classList.add('oculto');
  document.getElementById('ev-edit-id').value = '';
  document.getElementById('ev-multi-hint').classList.remove('oculto');
  poblarFormularioEvento();
  document.getElementById('ev-titulo').value = '';
  document.getElementById('ev-fecha').value = (typeof fechaIso === 'string') ? fechaIso : '';
  document.getElementById('ev-hora').value = '';
  document.getElementById('ev-desc').value = '';
  // Si hay un conjunto específico elegido en el header, marcarlo por defecto
  if (CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos') {
    const chk = document.querySelector(`#ev-conjunto-checks input[value="${CONJUNTO_SELECCIONADO}"]`);
    if (chk) chk.checked = true;
  }
  openOv('modal-evento');
}

function abrirEditarEvento(id) {
  const e = DATA.eventosCalendario.find(e => e.id === id);
  if (!e) return;
  if (!puedeEditarEvento(e)) return;
  document.getElementById('ev-modal-titulo').textContent = '✏️ Editar evento';
  document.getElementById('ev-btn-guardar').textContent = '✓ Guardar cambios';
  document.getElementById('ev-btn-eliminar').classList.remove('oculto');
  document.getElementById('ev-edit-id').value = e.id;
  document.getElementById('ev-multi-hint').classList.add('oculto');
  poblarFormularioEvento();
  document.getElementById('ev-tipo').value = e.tipo;
  document.getElementById('ev-titulo').value = e.titulo || '';
  document.getElementById('ev-fecha').value = e.fecha;
  document.getElementById('ev-hora').value = e.hora || '';
  document.getElementById('ev-desc').value = e.descripcion || '';
  actualizarVisibilidadCamposEvento();
  if (e.conjunto) {
    const chk = document.querySelector(`#ev-conjunto-checks input[value="${e.conjunto}"]`);
    if (chk) chk.checked = true;
  }
  (e.participantes || []).forEach(nombre => {
    const chk = document.querySelector(`#ev-participantes input[value="${nombre}"]`);
    if (chk) chk.checked = true;
  });
  openOv('modal-evento');
}

// Al CREAR, si se marcan varios conjuntos se crea una copia del evento por cada uno (mismo
// patrón que "Nueva tarea eventual" multi-conjunto). Al EDITAR, un evento ya existente solo
// puede tener un conjunto — si marcas varios al editar, se usa el primero.
function guardarEvento() {
  const tipo = document.getElementById('ev-tipo').value;
  const esCapacitacion = tipo === 'Capacitación';
  const conjuntosMarcados = esCapacitacion ? [] : [...document.querySelectorAll('#ev-conjunto-checks input:checked')].map(i => i.value);
  const titulo = document.getElementById('ev-titulo').value.trim();
  const fecha = document.getElementById('ev-fecha').value;
  const hora = document.getElementById('ev-hora').value;
  const descripcion = document.getElementById('ev-desc').value.trim();
  const participantes = esCapacitacion
    ? [...document.querySelectorAll('#ev-participantes input:checked')].map(i => i.value)
    : [];

  if (!fecha) { toast('La fecha es obligatoria'); return; }
  if (!esCapacitacion && !conjuntosMarcados.length) { toast('Selecciona al menos un conjunto'); return; }
  if (esCapacitacion && !participantes.length) { toast('Selecciona al menos un participante'); return; }

  const usuario = usuarioActual();
  const editId = document.getElementById('ev-edit-id').value;

  const idsGuardados = [];
  if (editId) {
    const e = DATA.eventosCalendario.find(e => e.id === editId);
    if (!e || !puedeEditarEvento(e)) { toast('No puedes editar este evento'); return; }
    const conjunto = esCapacitacion ? null : (conjuntosMarcados[0] || null);
    Object.assign(e, { tipo, conjunto, titulo, fecha, hora, descripcion, participantes });
    idsGuardados.push(editId);
    if (tipo === 'Reunión de consejo' && conjunto) sincronizarFechaConsejo(conjunto, fecha);
    toast('✓ Evento actualizado');
  } else if (esCapacitacion) {
    const id = siguienteIdEvento();
    DATA.eventosCalendario.push({
      id, tipo, conjunto: null, titulo, fecha, hora, descripcion, participantes,
      creadoPor: usuario ? usuario.n : '', createdAt: Date.now()
    });
    idsGuardados.push(id);
    toast('✓ Evento creado');
  } else {
    conjuntosMarcados.forEach(conjunto => {
      const id = siguienteIdEvento();
      DATA.eventosCalendario.push({
        id, tipo, conjunto, titulo, fecha, hora, descripcion, participantes: [],
        creadoPor: usuario ? usuario.n : '', createdAt: Date.now()
      });
      idsGuardados.push(id);
      if (tipo === 'Reunión de consejo') sincronizarFechaConsejo(conjunto, fecha);
    });
    toast(`✓ Evento creado en ${conjuntosMarcados.length} conjunto(s)`);
  }

  closeOv('modal-evento');
  guardarLocal();
  idsGuardados.forEach(id => guardarEventoEnSupabase(id)); // guardado individual: solo estos eventos, ninguno más se toca
  renderCalendario();
}

function eliminarEvento() {
  const editId = document.getElementById('ev-edit-id').value;
  const e = DATA.eventosCalendario.find(e => e.id === editId);
  if (!e || !puedeEditarEvento(e)) return;
  if (!confirm(`¿Eliminar el evento "${e.titulo || e.tipo}"?`)) return;
  DATA.eventosCalendario = DATA.eventosCalendario.filter(ev => ev.id !== editId);
  closeOv('modal-evento');
  guardarLocal();
  eliminarEventoEnSupabase(editId); // guardado individual: solo borra este evento
  renderCalendario();
  toast('Evento eliminado');
}

// Busca "Reunión de consejo de adm." del tipo correcto (Definitivos/Provisional) para ese
// conjunto y fija la fecha manual del mes correspondiente en Recurrentes. Además, SOLO para
// Definitivos (Provisional no tiene estas 2 tareas en su catálogo), calcula y sincroniza
// automáticamente "Envío informe gestión + convocatoria consejo" (5 días hábiles ANTES de la
// reunión) y "Envío acta de reunión de consejo" (3 días hábiles DESPUÉS) — se recalculan siempre
// que la fecha de la reunión cambie, sobrescribiendo cualquier ajuste manual previo (regla del
// usuario: la reunión manda).
function sincronizarFechaConsejo(conjunto, fechaIso) {
  const tipo = tipoConjunto(conjunto);
  const mes = mesDeFechaIso(fechaIso);
  const fechaReunion = fechaIsoADate(fechaIso);

  const idx = DATA.tareasRec.findIndex(t => t.n === 'Reunión de consejo de adm.' && !t.deleted && (t.aplica === tipo || t.aplica === 'Todos'));
  if (idx >= 0) {
    setFechaLimiteRec(conjunto, mes, idx, isoAFechaCorta(fechaIso));
    programarGuardadoFechaLimite(conjunto, mes, idx); // guardado individual: solo esta fecha, ninguna otra se toca
  }

  if (tipo !== 'Definitivos' || !fechaReunion) return;

  // Ambas quedan en el MISMO mes que la reunión (aunque el día calculado caiga en el mes
  // anterior/siguiente) — conceptualmente son parte de la preparación/cierre de ESA reunión,
  // no de un checklist de recurrentes distinto
  const idxInforme = DATA.tareasRec.findIndex(t => t.n === 'Envío informe gestión + convocatoria consejo' && !t.deleted && (t.aplica === tipo || t.aplica === 'Todos'));
  if (idxInforme >= 0) {
    const fechaInforme = restarDiasHabiles(fechaReunion, 5);
    setFechaLimiteRec(conjunto, mes, idxInforme, fechaCortaDesdeDate(fechaInforme));
    programarGuardadoFechaLimite(conjunto, mes, idxInforme); // guardado individual: solo esta fecha, ninguna otra se toca
  }

  const idxActa = DATA.tareasRec.findIndex(t => t.n === 'Envío acta de reunión de consejo' && !t.deleted && (t.aplica === tipo || t.aplica === 'Todos'));
  if (idxActa >= 0) {
    const fechaActa = sumarDiasHabiles(fechaReunion, 3);
    setFechaLimiteRec(conjunto, mes, idxActa, fechaCortaDesdeDate(fechaActa));
    programarGuardadoFechaLimite(conjunto, mes, idxActa); // guardado individual: solo esta fecha, ninguna otra se toca
  }
}
