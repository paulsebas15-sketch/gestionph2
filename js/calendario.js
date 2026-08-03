// calendario.js — Grilla mensual: reuniones de consejo, recorridos, proveedores, capacitaciones
// GestiónPH v2.0
// Depende de: config.js, datos.js, ui.js, auth.js

const TIPOS_EVENTO = ['Reunión de consejo', 'Recorrido', 'Reunión con proveedores', 'Capacitación', 'Reuniones masivas', 'Otro'];
// Un delegado puede crear cualquier tipo salvo Capacitación/Reuniones masivas (solo Staff las organiza)
const TIPOS_EVENTO_DELEGADO = ['Reunión de consejo', 'Recorrido', 'Reunión con proveedores', 'Otro'];
// Tipos que llevan participantes (transversal, sin un conjunto único) en vez de conjunto(s)
const TIPOS_EVENTO_MASIVO = ['Capacitación', 'Reuniones masivas'];
// Tipos que llevan modalidad presencial/virtual
const TIPOS_EVENTO_CON_MODALIDAD = ['Recorrido', 'Reunión con proveedores', 'Capacitación', 'Reuniones masivas'];

const ICONO_TIPO_EVENTO = {
  'Reunión de consejo': '🏛️',
  'Recorrido': '🚶',
  'Reunión con proveedores': '🤝',
  'Capacitación': '🎓',
  'Reuniones masivas': '👥',
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

function renderToggleVistaCalendario() {
  return `
    <div class="horw-toggle" style="margin-bottom:10px">
      <button class="horw-toggle-btn ${VISTA_CALENDARIO === 'semana' ? 'activo' : ''}" onclick="cambiarVistaCalendario('semana')">📆 Semana</button>
      <button class="horw-toggle-btn ${VISTA_CALENDARIO === 'mes' ? 'activo' : ''}" onclick="cambiarVistaCalendario('mes')">🗓 Mes</button>
    </div>`;
}

function renderCalendario() {
  const cont = document.getElementById('content-calendario');
  if (!cont) return;

  cont.innerHTML = `
    ${renderToggleVistaCalendario()}
    ${VISTA_CALENDARIO === 'semana' ? renderVistaSemana() : renderVistaMes()}
    ${renderColaAprobacionSabados()}
    ${renderBotonSabadosMasivos()}
    ${renderMisSabados()}
    ${renderColaAprobacionVacaciones()}
    ${renderMisVacaciones()}
  `;
}

function renderVistaMes() {
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

  const porFechaAusencias = {};
  ausenciasDelMes(mes).forEach(a => {
    porFechaAusencias[a.fecha] = porFechaAusencias[a.fecha] || [];
    porFechaAusencias[a.fecha].push(a);
  });

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="card-title" style="margin:0">📅 ${mes} ${anio}${CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos' ? ` · ${CONJUNTO_SELECCIONADO}` : ''}</div>
        <button class="btn btn-v btn-sm" onclick="abrirNuevoEvento()">➕ Nuevo evento</button>
      </div>
      <div class="cal-grid">
        ${DIAS_SEMANA.map(d => `<div class="cal-dow">${d}</div>`).join('')}
        ${celdas.map(d => renderCeldaDia(d, mesIdx, anio, porFecha, esHoy(d), porFechaAusencias)).join('')}
      </div>
    </div>`;
}

function renderCeldaDia(dia, mesIdx, anio, porFecha, esHoy, porFechaAusencias) {
  if (!dia) return `<div class="cal-day cal-day-vacio"></div>`;
  const iso = `${anio}-${String(mesIdx + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  const eventosDia = (porFecha[iso] || []).sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
  const ausenciasDia = (porFechaAusencias && porFechaAusencias[iso]) || [];
  const festivo = festivoDeFecha(iso);
  const LIMITE = 3;
  const visibles = eventosDia.slice(0, LIMITE);
  const resto = eventosDia.length - visibles.length;

  return `
    <div class="cal-day ${esHoy ? 'cal-day-hoy' : ''}" onclick="abrirDetalleDia('${iso}')">
      <div class="cal-daynum">${dia}</div>
      ${festivo ? `<div class="cal-evento horw-chip-festivo" title="${festivo.nombre}">🎉 ${festivo.nombre}</div>` : ''}
      ${ausenciasDia.map(a => {
        if (a.tipo === 'vacaciones') {
          // Franja continua por semana: sin texto ni redondeo en los días de en medio, para que
          // se vea como una sola barra que atraviesa la semana (se corta y sigue en la fila siguiente)
          const d = fechaIsoADate(iso);
          const esInicioTramo = iso === a.rangoInicio || d.getDay() === 1;
          const esFinTramo = iso === a.rangoFin || d.getDay() === 0;
          let cls = 'cal-evento horw-chip-vacaciones franja-vacaciones';
          if (esInicioTramo) cls += ' franja-inicio';
          if (esFinTramo) cls += ' franja-fin';
          return `<div class="${cls}" title="${a.delegado} — ${a.detalle}">${esInicioTramo ? `🏖️ ${a.delegado}` : ''}</div>`;
        }
        const emoji = a.tipo === 'sabado' ? '🌞' : '🔄';
        const etiqueta = a.tipo === 'sabado' ? 'Libre' : 'Jornada libre';
        const cls = a.tipo === 'sabado' ? 'horw-chip-sabado' : 'horw-chip-compensatorio';
        return `
        <div class="cal-evento ${cls}" title="${a.delegado} — ${a.detalle}">
          ${emoji} ${a.delegado} · ${etiqueta}
        </div>`;
      }).join('')}
      ${visibles.map(e => {
        const cEv = e.conjunto && e.conjunto !== NOMBRE_OFICINA ? conjuntoPorNombre(e.conjunto) : null;
        const colorBase = cEv ? cEv.c : (e.conjunto === NOMBRE_OFICINA ? '#2980b9' : null);
        const esVirtual = e.modalidad === 'virtual';
        const color = colorBase ? (esVirtual ? colorClaro(colorBase) : colorBase) : null;
        const estiloColor = color ? `background:${color};color:${colorTextoContraste(color)}` : '';
        const modalidadTxt = e.modalidad ? (esVirtual ? ' · Virtual' : ' · Presencial') : '';
        const etiqueta = e.tipo === 'Reunión de consejo' && e.conjunto ? `${e.tipo} · ${e.conjunto}` : (e.titulo || e.tipo);
        return `
        <div class="cal-evento" style="${estiloColor}" title="${e.titulo || e.tipo}${modalidadTxt}" onclick="event.stopPropagation(); abrirEditarEvento('${e.id}')">
          ${ICONO_TIPO_EVENTO[e.tipo] || '📌'} ${e.hora ? horaAMPM(e.hora) + ' ' : ''}${etiqueta}${modalidadTxt}
        </div>`;
      }).join('')}
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
  document.getElementById('ev-lugar-especifico').innerHTML = conjuntosDisponiblesHorario().map(n => `<option>${n}</option>`).join('');
  actualizarVisibilidadCamposEvento();
}

// Capacitación/Reuniones masivas no llevan conjunto (transversal, con participantes) — llevan
// en cambio un "lugar" (conjunto/oficina específico, o lugar externo en texto libre). El resto
// de tipos sí llevan conjunto(s) directo. La modalidad presencial/virtual solo aplica a los
// tipos definidos en TIPOS_EVENTO_CON_MODALIDAD.
function actualizarVisibilidadCamposEvento() {
  const tipo = document.getElementById('ev-tipo').value;
  const esMasivo = TIPOS_EVENTO_MASIVO.includes(tipo);
  const conMod = TIPOS_EVENTO_CON_MODALIDAD.includes(tipo);
  document.getElementById('ev-conjunto-wrap').classList.toggle('oculto', esMasivo);
  document.getElementById('ev-participantes-wrap').classList.toggle('oculto', !esMasivo);
  document.getElementById('ev-lugar-wrap').classList.toggle('oculto', !esMasivo);
  document.getElementById('ev-modalidad-wrap').classList.toggle('oculto', !conMod);
  if (esMasivo) {
    const radioLugar = document.querySelector('input[name="ev-lugar-tipo"]:checked');
    const lugarTipo = radioLugar ? radioLugar.value : 'especifico';
    document.getElementById('ev-lugar-especifico').classList.toggle('oculto', lugarTipo !== 'especifico');
    document.getElementById('ev-lugar-externo').classList.toggle('oculto', lugarTipo !== 'externo');
  }
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
  document.getElementById('ev-hora-fin').value = '';
  document.getElementById('ev-desc').value = '';
  document.querySelector('input[name="ev-modalidad"][value="presencial"]').checked = true;
  document.querySelector('input[name="ev-lugar-tipo"][value="especifico"]').checked = true;
  document.getElementById('ev-lugar-externo').value = '';
  actualizarVisibilidadCamposEvento();
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
  document.getElementById('ev-hora-fin').value = e.horaFin || '';
  document.getElementById('ev-desc').value = e.descripcion || '';
  document.querySelector(`input[name="ev-modalidad"][value="${e.modalidad || 'presencial'}"]`).checked = true;
  document.querySelector(`input[name="ev-lugar-tipo"][value="${e.lugarTipo === 'externo' ? 'externo' : 'especifico'}"]`).checked = true;
  document.getElementById('ev-lugar-externo').value = e.lugarTexto || '';
  actualizarVisibilidadCamposEvento();
  if (e.conjunto) {
    const chk = document.querySelector(`#ev-conjunto-checks input[value="${e.conjunto}"]`);
    if (chk) chk.checked = true;
    document.getElementById('ev-lugar-especifico').value = e.conjunto;
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
  const esMasivo = TIPOS_EVENTO_MASIVO.includes(tipo);
  const conMod = TIPOS_EVENTO_CON_MODALIDAD.includes(tipo);
  const conjuntosMarcados = esMasivo ? [] : [...document.querySelectorAll('#ev-conjunto-checks input:checked')].map(i => i.value);
  const titulo = document.getElementById('ev-titulo').value.trim();
  const fecha = document.getElementById('ev-fecha').value;
  const hora = document.getElementById('ev-hora').value;
  const horaFin = document.getElementById('ev-hora-fin').value;
  const descripcion = document.getElementById('ev-desc').value.trim();
  const participantes = esMasivo
    ? [...document.querySelectorAll('#ev-participantes input:checked')].map(i => i.value)
    : [];
  const modalidad = conMod ? (document.querySelector('input[name="ev-modalidad"]:checked') || {}).value : null;
  const lugarTipoRadio = esMasivo ? (document.querySelector('input[name="ev-lugar-tipo"]:checked') || {}).value : null;
  const lugarEspecifico = document.getElementById('ev-lugar-especifico').value;
  const lugarTexto = document.getElementById('ev-lugar-externo').value.trim();
  const conjuntoMasivo = esMasivo && lugarTipoRadio === 'especifico' ? lugarEspecifico : null;

  if (!fecha) { toast('La fecha es obligatoria'); return; }
  if (!hora || !horaFin) { toast('La hora de inicio y de fin son obligatorias'); return; }
  if (horaFin <= hora) { toast('La hora de fin debe ser después de la hora de inicio'); return; }
  if (!esMasivo && !conjuntosMarcados.length) { toast('Selecciona al menos un conjunto'); return; }
  if (esMasivo && !participantes.length) { toast('Selecciona al menos un participante'); return; }
  if (esMasivo && lugarTipoRadio === 'externo' && !lugarTexto) { toast('Escribe el lugar externo'); return; }
  const festivo = festivoDeFecha(fecha);
  if (festivo) { toast(`⛔ ${fecha.split('-').reverse().join('/')} es festivo (${festivo.nombre}) — no se pueden programar eventos ese día`, 5000); return; }

  // Aviso (no bloqueo) si es presencial y el horario no cae dentro de la atención real del
  // delegado en ese conjunto — igual aplica para Reuniones masivas/Capacitación en un conjunto
  if (conMod && modalidad === 'presencial') {
    const conjuntoAValidar = esMasivo ? conjuntoMasivo : conjuntosMarcados[0];
    if (conjuntoAValidar && conjuntoAValidar !== NOMBRE_OFICINA) {
      const c = conjuntoPorNombre(conjuntoAValidar);
      const delegado = c && c.del;
      if (delegado && delegado !== '—') {
        const dia = nombreDiaSemana(fechaIsoADate(fecha));
        const turnosDia = turnosDelDelegadoEnDia(delegado, dia, fecha).filter(t => t.conjunto === conjuntoAValidar);
        const cabeEnAlguno = turnosDia.some(t => hora >= t.hora_entrada && horaFin <= t.hora_salida);
        if (!cabeEnAlguno) {
          if (!confirm(`⚠️ Este horario (${horaAMPM(hora)} - ${horaAMPM(horaFin)}) no coincide con la atención real de ${delegado} en ${conjuntoAValidar} ese día. ¿Guardar de todas formas?`)) return;
        }
      }
    }
  }

  const usuario = usuarioActual();
  const editId = document.getElementById('ev-edit-id').value;

  const idsGuardados = [];
  if (editId) {
    const e = DATA.eventosCalendario.find(e => e.id === editId);
    if (!e || !puedeEditarEvento(e)) { toast('No puedes editar este evento'); return; }
    const conjunto = esMasivo ? conjuntoMasivo : (conjuntosMarcados[0] || null);
    Object.assign(e, {
      tipo, conjunto, titulo, fecha, hora, horaFin, descripcion, participantes,
      modalidad, lugarTipo: esMasivo ? lugarTipoRadio : null, lugarTexto: esMasivo && lugarTipoRadio === 'externo' ? lugarTexto : null
    });
    idsGuardados.push(editId);
    if (tipo === 'Reunión de consejo' && conjunto) sincronizarFechaConsejo(conjunto, fecha);
    toast('✓ Evento actualizado');
  } else if (esMasivo) {
    const id = siguienteIdEvento();
    DATA.eventosCalendario.push({
      id, tipo, conjunto: conjuntoMasivo, titulo, fecha, hora, horaFin, descripcion, participantes,
      modalidad, lugarTipo: lugarTipoRadio, lugarTexto: lugarTipoRadio === 'externo' ? lugarTexto : null,
      creadoPor: usuario ? usuario.n : '', createdAt: Date.now()
    });
    idsGuardados.push(id);
    toast('✓ Evento creado');
  } else {
    conjuntosMarcados.forEach(conjunto => {
      const id = siguienteIdEvento();
      DATA.eventosCalendario.push({
        id, tipo, conjunto, titulo, fecha, hora, horaFin, descripcion, participantes: [],
        modalidad, lugarTipo: null, lugarTexto: null,
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
