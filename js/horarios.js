// horarios.js — Horarios de delegados, sábados libres y compensatorio por reunión de consejo
// GestiónPH v2.0
// Depende de: config.js, datos.js, auth.js, ui.js, calendario.js (tipoConjunto, eventosVisibles)

// ─── COMPENSATORIO POR REUNIÓN DE CONSEJO ───────────────────────
// Solo Definitivos tienen reunión de consejo. El día siguiente a la reunión, el delegado no
// trabaja el turno que le correspondía ese conjunto — se corre al próximo día de atención real
// si el día siguiente no era uno de sus días en ese conjunto (fin de semana, día sin turno, etc.)
function proximoDiaAtencionDespues(delegado, conjuntoNombre, fechaIso, maxDias = 14) {
  let d = fechaIsoADate(fechaIso);
  if (!d) return null;
  for (let i = 0; i < maxDias; i++) {
    d = new Date(d);
    d.setDate(d.getDate() + 1);
    const dia = nombreDiaSemana(d);
    const iso = fechaDateAIso(d);
    const turnos = turnosDelDelegadoEnDia(delegado, dia, iso).filter(h => h.conjunto === conjuntoNombre);
    if (turnos.length) return { fecha: iso, turnos };
  }
  return null;
}

// Compensatorio derivado de UN evento "Reunión de consejo" puntual (o null si no aplica).
// Si el turno del delegado ahí es "Día completo" no hay medio turno obvio que copiar — en ese
// caso el delegado elige mañana o tarde una sola vez (guardado en compensatorio_elecciones);
// hasta que elija, queda "pendiente" y no se le bloquea ningún turno todavía.
function compensatorioDeEvento(evento) {
  if (evento.tipo !== 'Reunión de consejo' || !evento.conjunto) return null;
  if (tipoConjunto(evento.conjunto) !== 'Definitivos') return null;
  const c = conjuntoPorNombre(evento.conjunto);
  const delegado = c && c.del;
  if (!delegado || delegado === '—' || esMedioTiempo(delegado)) return null;
  const prox = proximoDiaAtencionDespues(delegado, evento.conjunto, evento.fecha);
  if (!prox) return null;
  const esDiaCompleto = prox.turnos.some(t => t.hora_entrada === '8:00' && t.hora_salida === '17:00');
  let pendienteEleccion = false;
  let medioDia = null;
  if (esDiaCompleto) {
    const elegido = DATA.compensatorioElecciones.find(e => e.eventoId === evento.id && e.delegado === delegado);
    if (elegido) medioDia = elegido.eleccion; else pendienteEleccion = true;
  }
  return {
    delegado, conjunto: evento.conjunto, fecha: prox.fecha, turnos: prox.turnos, origenFecha: evento.fecha,
    eventoId: evento.id, esDiaCompleto, pendienteEleccion, medioDia
  };
}

function elegirJornadaLibre(eventoId, eleccion) {
  const usuario = usuarioActual();
  if (!usuario) return;
  let e = DATA.compensatorioElecciones.find(x => x.eventoId === eventoId && x.delegado === usuario.n);
  if (!e) { e = { eventoId, delegado: usuario.n, eleccion }; DATA.compensatorioElecciones.push(e); }
  else e.eleccion = eleccion;
  const idx = DATA.compensatorioElecciones.indexOf(e);
  guardarLocal();
  guardarCompensatorioEleccionEnSupabase(idx);
  closeOv('modal-dia-detalle');
  toast(`✓ Elegiste tomar tu jornada libre en la ${eleccion === 'manana' ? 'mañana' : 'tarde'}`);
  renderCalendario();
}

// Todos los compensatorios calculados a partir de TODAS las reuniones de consejo registradas
// (sin importar el mes de la reunión — el compensatorio puede caer en el mes siguiente)
function todosLosCompensatorios() {
  return DATA.eventosCalendario
    .filter(e => e.tipo === 'Reunión de consejo')
    .map(compensatorioDeEvento)
    .filter(Boolean);
}

// ─── AUSENCIAS ────────────────────────────────────────────────
// Sábados aprobados + compensatorios cuya fecha cae en el mes dado
function ausenciasDelMes(mes) {
  const ausencias = [];
  DATA.sabadosLibres.filter(s => s.estado === 'aprobado' && mesDeFechaIso(s.fecha) === mes).forEach(s => {
    ausencias.push({ fecha: s.fecha, delegado: s.delegado, tipo: 'sabado', detalle: 'Sábado libre' });
  });
  todosLosCompensatorios().filter(c => mesDeFechaIso(c.fecha) === mes).forEach(c => {
    const etiquetaMedio = c.medioDia ? ` (${c.medioDia === 'manana' ? 'mañana' : 'tarde'})` : '';
    ausencias.push({
      fecha: c.fecha, delegado: c.delegado, conjunto: c.conjunto, tipo: 'compensatorio',
      eventoId: c.eventoId, pendienteEleccion: c.pendienteEleccion, medioDia: c.medioDia,
      detalle: c.pendienteEleccion
        ? `Jornada libre pendiente de elegir (mañana o tarde) — reunión de consejo ${fechaCortaDesdeIso(c.origenFecha)} en ${c.conjunto}`
        : `Jornada libre${etiquetaMedio} (reunión de consejo ${fechaCortaDesdeIso(c.origenFecha)}) — ${c.turnos.map(t => t.turno).join('/')} en ${c.conjunto}`
    });
  });
  DATA.vacaciones.filter(v => v.estado === 'aprobado').forEach(v => {
    const d = fechaIsoADate(v.fechaInicio);
    const fin = fechaIsoADate(v.fechaFin);
    if (!d || !fin) return;
    for (let cursor = new Date(d); cursor <= fin; cursor.setDate(cursor.getDate() + 1)) {
      const fecha = fechaDateAIso(cursor);
      if (mesDeFechaIso(fecha) === mes) {
        ausencias.push({ fecha, delegado: v.delegado, tipo: 'vacaciones', rangoInicio: v.fechaInicio, rangoFin: v.fechaFin, detalle: `Vacaciones (${fechaCortaDesdeIso(v.fechaInicio)} - ${fechaCortaDesdeIso(v.fechaFin)})` });
      }
    }
  });
  return ausencias;
}

// La ausencia de UN delegado en UNA fecha puntual, respetando el filtro de conjunto del header
// (un sábado libre aplica a todos sus conjuntos; un compensatorio solo aplica al conjunto de esa reunión)
function ausenciaDeDelegadoEnFecha(delegado, iso) {
  const mes = mesDeFechaIso(iso);
  return ausenciasDelMes(mes).find(a => a.delegado === delegado && a.fecha === iso &&
    (!CONJUNTO_SELECCIONADO || CONJUNTO_SELECCIONADO === 'Todos' || !a.conjunto || a.conjunto === CONJUNTO_SELECCIONADO));
}

// ─── VISTA SEMANAL/MENSUAL — toggle y navegación ────────────────
let VISTA_CALENDARIO = 'semana';
let SEMANA_OFFSET = 0;

function cambiarVistaCalendario(v) {
  VISTA_CALENDARIO = v;
  renderCalendario();
}

function inicioSemana(offset) {
  const hoy = new Date();
  const diaSemana = (hoy.getDay() + 6) % 7; // lunes=0
  const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - diaSemana);
  lunes.setDate(lunes.getDate() + offset * 7);
  return lunes;
}

function cambiarSemana(delta, irAHoy) {
  SEMANA_OFFSET = irAHoy ? 0 : SEMANA_OFFSET + delta;
  renderCalendario();
}

function etiquetaSemana(lunes) {
  const domingo = new Date(lunes);
  domingo.setDate(domingo.getDate() + 6);
  const mesL = MESES[lunes.getMonth()].slice(0, 3);
  const mesD = MESES[domingo.getMonth()].slice(0, 3);
  return mesL === mesD
    ? `${lunes.getDate()} – ${domingo.getDate()} ${mesL}`
    : `${lunes.getDate()} ${mesL} – ${domingo.getDate()} ${mesD}`;
}

function capitalizar(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// Conjuntos a considerar en la vista de horarios, respetando el selector del header. Con
// "Todos" seleccionado, Staff ve el sistema completo — un delegado (que ahora también puede
// elegir "Todos" en el header) sigue viendo solo SUS PROPIOS conjuntos, nunca los de otros.
function conjuntosParaVistaHorarios() {
  if (CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos') {
    const c = conjuntoPorNombre(CONJUNTO_SELECCIONADO);
    return c ? [c] : [];
  }
  if (!esStaff()) {
    const usuario = usuarioActual();
    const nombres = (usuario && usuario.conjuntos) || [];
    return todosLosConjuntos().filter(c => nombres.includes(c.n));
  }
  return todosLosConjuntos();
}

// Delegados a mostrar como filas de la semana: si hay conjunto filtrado, solo su delegado. Con
// "Todos", un delegado ve solo su propia fila (nunca la de otros delegados del sistema).
function delegadosParaVistaSemana() {
  if (CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos') {
    const c = conjuntoPorNombre(CONJUNTO_SELECCIONADO);
    return (c && c.del && c.del !== '—') ? [c.del] : [];
  }
  if (!esStaff()) {
    const usuario = usuarioActual();
    return usuario ? [usuario.n] : [];
  }
  return [...new Set(DATA.horariosDelegados.filter(h => !h.deleted).map(h => h.delegado))].sort();
}

// Eventos de Calendario que aplican a ESTE delegado en ESTA fecha: los tipos con conjunto
// propio (Reunión de consejo, Recorrido, Reunión con proveedores) si es delegado de ese
// conjunto, o los tipos masivos (Capacitación/Reuniones masivas) si figura en participantes.
function eventosDelDelegadoEnFecha(delegado, iso) {
  return DATA.eventosCalendario.filter(e => {
    if (e.fecha !== iso) return false;
    if (TIPOS_EVENTO_MASIVO.includes(e.tipo)) return (e.participantes || []).includes(delegado);
    return e.conjunto && horariosDeDelegado(delegado).some(h => h.conjunto === e.conjunto);
  });
}

function renderChipTurno(t) {
  const esOficina = t.conjunto === NOMBRE_OFICINA;
  if (esOficina) return `<div class="horw-chip horw-chip-trabajo">🏢 Oficina</div>`;
  const c = conjuntoPorNombre(t.conjunto);
  const color = (c && c.c) || PALETA_CONJUNTOS[0];
  return `<div class="horw-chip" style="background:${color};color:${colorTextoContraste(color)}">🏘 ${t.conjunto}</div>`;
}

// Contenido de la viñeta de un delegado en un día puntual — con conjunto filtrado, solo se
// muestran sus turnos EN ESE conjunto (no en sus otros conjuntos/oficina)
function celdaSemana(delegado, iso, dia) {
  const festivo = festivoDeFecha(iso);
  if (festivo) return `<div class="horw-chip horw-chip-festivo">🎉 ${festivo.nombre}</div>`;
  const ausencia = ausenciaDeDelegadoEnFecha(delegado, iso);
  // Sábado libre y vacaciones bloquean el día completo. La jornada libre por reunión de consejo
  // (compensatorio) solo bloquea el turno puntual del conjunto de esa reunión — el resto del
  // día sigue viéndose normal en la misma celda.
  if (ausencia && ausencia.tipo !== 'compensatorio') {
    const cls = ausencia.tipo === 'sabado' ? 'horw-chip-sabado' : 'horw-chip-vacaciones';
    const emoji = ausencia.tipo === 'sabado' ? '🌞' : '🏖️';
    const texto = ausencia.tipo === 'sabado' ? 'Libre' : 'Vacaciones';
    return `<div class="horw-chip ${cls}">${emoji} ${texto}</div>`;
  }

  let turnos = turnosDelDelegadoEnDia(delegado, dia, iso);
  if (CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos') {
    turnos = turnos.filter(t => t.conjunto === CONJUNTO_SELECCIONADO);
  }

  const eventos = eventosDelDelegadoEnFecha(delegado, iso);
  const turnosReemplazados = new Set();
  const piezas = [];

  eventos.forEach(e => {
    const esMasivo = TIPOS_EVENTO_MASIVO.includes(e.tipo);
    const esVirtual = e.modalidad === 'virtual';
    const modalidadTxt = e.modalidad ? (esVirtual ? ' · Virtual' : ' · Presencial') : '';
    const esOficinaEv = e.conjunto === NOMBRE_OFICINA;
    const cEv = e.conjunto && !esOficinaEv ? conjuntoPorNombre(e.conjunto) : null;

    // Reuniones masivas/Capacitación cuyo horario se cruza con un turno normal del delegado en
    // ESE conjunto/oficina: reemplaza visualmente ese turno (mismo color, nueva etiqueta) — el
    // resto de turnos del día no se toca. Si no se cruza con nada, se agrega aparte.
    const turnoCruzado = esMasivo
      ? turnos.find(t => t.conjunto === e.conjunto && !turnosReemplazados.has(t) && e.hora < t.hora_salida && (e.horaFin || e.hora) > t.hora_entrada)
      : null;

    if (turnoCruzado) {
      turnosReemplazados.add(turnoCruzado);
      const etiqueta = `Reunión general ${esOficinaEv ? 'Oficina' : e.conjunto}`;
      let html;
      if (esOficinaEv) {
        html = `<div class="horw-chip horw-chip-trabajo" onclick="event.stopPropagation();abrirEditarEvento('${e.id}')">🏢 ${etiqueta}${modalidadTxt}</div>`;
      } else {
        const color = esVirtual ? colorClaro(cEv.c) : cEv.c;
        html = `<div class="horw-chip" style="background:${color};color:${colorTextoContraste(color)}" onclick="event.stopPropagation();abrirEditarEvento('${e.id}')">🏘 ${etiqueta}${modalidadTxt}</div>`;
      }
      piezas.push({ hora: turnoCruzado.hora_entrada, html });
    } else {
      const etiquetaTipo = `${ICONO_TIPO_EVENTO[e.tipo] || '📌'} ${e.tipo}`;
      let html;
      if (cEv) {
        const color = esVirtual ? colorClaro(cEv.c) : cEv.c;
        html = `<div class="horw-chip" style="background:${color};color:${colorTextoContraste(color)}" onclick="event.stopPropagation();abrirEditarEvento('${e.id}')">${etiquetaTipo}${modalidadTxt}</div>`;
      } else if (esOficinaEv) {
        html = `<div class="horw-chip horw-chip-trabajo" onclick="event.stopPropagation();abrirEditarEvento('${e.id}')">${etiquetaTipo}${modalidadTxt}</div>`;
      } else {
        html = `<div class="horw-chip" style="background:#e2e2e2;color:#444" onclick="event.stopPropagation();abrirEditarEvento('${e.id}')">${etiquetaTipo}${modalidadTxt}</div>`;
      }
      piezas.push({ hora: e.hora || '00:00', html });
    }
  });

  turnos.forEach(t => {
    if (turnosReemplazados.has(t)) return;
    if (ausencia && ausencia.tipo === 'compensatorio' && ausencia.conjunto === t.conjunto) {
      if (ausencia.pendienteEleccion) { piezas.push({ hora: t.hora_entrada, html: `<div class="horw-chip horw-chip-compensatorio">⏳ Elegir jornada libre</div>` }); return; }
      const etiquetaMedio = ausencia.medioDia ? ` (${ausencia.medioDia === 'manana' ? 'mañana' : 'tarde'})` : '';
      piezas.push({ hora: t.hora_entrada, html: `<div class="horw-chip horw-chip-compensatorio">🔄 Jornada libre${etiquetaMedio}</div>` });
      return;
    }
    piezas.push({ hora: t.hora_entrada, html: renderChipTurno(t) });
  });

  if (!piezas.length) return `<div class="horw-cell-vacia">—</div>`;
  // De más temprano a más tarde (8am arriba, 5pm abajo)
  piezas.sort((a, b) => (parseInt((a.hora || '0').split(':')[0], 10) || 0) - (parseInt((b.hora || '0').split(':')[0], 10) || 0));
  return piezas.map(p => p.html).join('');
}

function renderVistaSemana() {
  const lunes = inicioSemana(SEMANA_OFFSET);
  const dias = [];
  for (let i = 0; i < 7; i++) { const d = new Date(lunes); d.setDate(d.getDate() + i); dias.push(d); }
  const delegados = delegadosParaVistaSemana();
  const hoyIso = fechaDateAIso(new Date());

  const cabecera = dias.map(d => {
    const iso = fechaDateAIso(d);
    return `<div class="horw-head ${iso === hoyIso ? 'horw-head-hoy' : ''}">${DIAS_SEMANA[(d.getDay() + 6) % 7]} ${d.getDate()}</div>`;
  }).join('');

  const filas = delegados.map(delegado => {
    const celdas = dias.map(d => {
      const iso = fechaDateAIso(d);
      const dia = nombreDiaSemana(d);
      return `<div class="horw-cell ${iso === hoyIso ? 'horw-cell-hoy' : ''}" onclick="abrirDetalleDia('${iso}','${delegado.replace(/'/g, "\\'")}')">${celdaSemana(delegado, iso, dia)}</div>`;
    }).join('');
    return `<div class="horw-delegado">${delegado}</div>${celdas}`;
  }).join('');

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div class="horw-nav">
          <button class="horw-nav-btn" onclick="cambiarSemana(-1)">‹</button>
          <div style="font-size:11px;font-weight:700">${etiquetaSemana(lunes)}${CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos' ? ` · ${CONJUNTO_SELECCIONADO}` : ''}</div>
          <button class="horw-nav-btn" onclick="cambiarSemana(1)">›</button>
        </div>
        <button class="btn btn-g btn-sm" onclick="cambiarSemana(0,true)">Hoy</button>
      </div>
      <div class="horw-grid">
        <div></div>${cabecera}
        ${filas}
      </div>
      ${!delegados.length ? `<div style="font-size:10px;color:var(--txs);text-align:center;padding:16px">Sin delegados con horario cargado${CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos' ? ' para este conjunto' : ''}</div>` : ''}
    </div>`;
}

// ─── DETALLE DE DÍA (modal) ───────────────────────────────────
// delegadoFiltro: al hacer clic en la celda de UN delegado específico en la vista Semana, el
// detalle muestra solo su información — abierto desde el número de día (Mes) o sin ese contexto,
// sigue mostrando la tabla completa de todos como antes.
function abrirDetalleDia(iso, delegadoFiltro) {
  const dia = nombreDiaSemana(fechaIsoADate(iso));
  const festivo = festivoDeFecha(iso);
  document.getElementById('dia-detalle-titulo').textContent = `📅 ${capitalizar(dia)} ${fechaCortaDesdeIso(iso)}${delegadoFiltro ? ` — ${delegadoFiltro}` : ''}${festivo ? ` — 🎉 ${festivo.nombre}` : ''}`;

  const filasHorario = conjuntosParaVistaHorarios().filter(c => !delegadoFiltro || c.del === delegadoFiltro).map(c => {
    const delegado = c.del;
    if (!delegado || delegado === '—') return '';
    const ausencia = ausenciaDeDelegadoEnFecha(delegado, iso);
    const turnos = turnosDelDelegadoEnDia(delegado, dia, iso).filter(h => h.conjunto === c.n);
    let estado;
    if (festivo) {
      estado = `🎉 Festivo (${festivo.nombre})`;
    } else if (ausencia && (!ausencia.conjunto || ausencia.conjunto === c.n)) {
      estado = ausencia.tipo === 'sabado' ? '🌞 Libre (sábado libre)' : ausencia.tipo === 'vacaciones' ? `🏖️ ${ausencia.detalle}` : `🔄 ${ausencia.detalle}`;
    } else if (turnos.length) {
      estado = turnos.map(t => `${t.turno} ${t.hora_entrada ? horaAMPM(t.hora_entrada) : '?'} - ${t.hora_salida ? horaAMPM(t.hora_salida) : '?'}`).join(', ');
    } else {
      estado = '— sin turno';
    }
    return `<tr><td style="font-size:10px">${c.n}</td><td style="font-size:10px">${delegado}</td><td style="font-size:10px">${estado}</td></tr>`;
  }).filter(Boolean).join('');

  // Al filtrar a un delegado específico, si ese día tiene horas de oficina también se muestran
  // (Oficina A&V no es un "conjunto" real, por eso queda afuera de conjuntosParaVistaHorarios())
  let filaOficina = '';
  if (delegadoFiltro) {
    const turnosOficina = turnosDelDelegadoEnDia(delegadoFiltro, dia, iso).filter(h => h.conjunto === NOMBRE_OFICINA);
    if (turnosOficina.length) {
      const ausencia = ausenciaDeDelegadoEnFecha(delegadoFiltro, iso);
      // El compensatorio (jornada libre) es específico de UN conjunto — solo se aplica a la fila
      // de Oficina si esa fue la fecha/conjunto puntual afectado, no a cualquier compensatorio
      // que tenga el delegado ese día en otro conjunto (sábado/vacaciones sí bloquean todo el día)
      const ausenciaAplica = ausencia && (ausencia.tipo !== 'compensatorio' || ausencia.conjunto === NOMBRE_OFICINA);
      let estadoOficina;
      if (festivo) estadoOficina = `🎉 Festivo (${festivo.nombre})`;
      else if (ausenciaAplica) estadoOficina = ausencia.tipo === 'sabado' ? '🌞 Libre (sábado libre)' : ausencia.tipo === 'vacaciones' ? `🏖️ ${ausencia.detalle}` : `🔄 ${ausencia.detalle}`;
      else estadoOficina = turnosOficina.map(t => `${t.turno} ${t.hora_entrada ? horaAMPM(t.hora_entrada) : '?'} - ${t.hora_salida ? horaAMPM(t.hora_salida) : '?'}`).join(', ');
      filaOficina = `<tr><td style="font-size:10px">🏢 Oficina A&V</td><td style="font-size:10px">${delegadoFiltro}</td><td style="font-size:10px">${estadoOficina}</td></tr>`;
    }
  }

  const eventosDia = eventosVisibles().filter(e => e.fecha === iso);
  const eventosHtml = eventosDia.length ? eventosDia.map(e => {
    const horario = e.hora ? `${horaAMPM(e.hora)}${e.horaFin ? ' - ' + horaAMPM(e.horaFin) : ''} ` : '';
    const modalidadTxt = e.modalidad ? (e.modalidad === 'virtual' ? ' · Virtual' : ' · Presencial') : '';
    const lugar = e.lugarTipo === 'externo' && e.lugarTexto ? ` · ${e.lugarTexto}` : (e.conjunto ? ` · ${e.conjunto}` : '');
    return `
    <div class="cal-evento" style="font-size:10px;padding:5px 8px;margin-bottom:4px" onclick="closeOv('modal-dia-detalle');abrirEditarEvento('${e.id}')">
      ${ICONO_TIPO_EVENTO[e.tipo] || '📌'} ${horario}${e.titulo || e.tipo}${lugar}${modalidadTxt}
    </div>`;
  }).join('') : '<div style="font-size:10px;color:var(--txs)">Sin eventos este día</div>';

  const usuario = usuarioActual();
  const esSabado = dia === 'sabado';
  const puedeSolicitarSabado = esSabado && usuario && !esStaff() && !esMedioTiempo(usuario.n);

  // Si es su propia jornada libre por reunión de consejo y todavía no eligió mañana/tarde
  // (turno "Día completo", sin medio turno obvio), se le ofrece elegir acá mismo
  const ausenciaPropia = usuario && !esStaff() ? ausenciaDeDelegadoEnFecha(usuario.n, iso) : null;
  const necesitaElegirJornada = ausenciaPropia && ausenciaPropia.tipo === 'compensatorio' && ausenciaPropia.pendienteEleccion;
  const elegirJornadaHtml = necesitaElegirJornada ? `
    <div style="background:#eaf3fb;border:1px solid #bcdaf0;border-radius:8px;padding:10px;margin-top:10px">
      <div style="font-size:11px;font-weight:600;margin-bottom:6px">🔄 Tienes una jornada libre por reunión de consejo en ${ausenciaPropia.conjunto} — ¿la tomas en la mañana o en la tarde?</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-v btn-sm" style="flex:1" onclick="elegirJornadaLibre('${ausenciaPropia.eventoId}','manana')">🌅 Mañana</button>
        <button class="btn btn-v btn-sm" style="flex:1" onclick="elegirJornadaLibre('${ausenciaPropia.eventoId}','tarde')">🌇 Tarde</button>
      </div>
    </div>` : '';

  document.getElementById('dia-detalle-contenido').innerHTML = `
    <table class="tbl">
      <thead><tr><th>Conjunto</th><th>Delegado</th><th>Estado</th></tr></thead>
      <tbody>${filasHorario || filaOficina ? filasHorario + filaOficina : '<tr><td colspan="3" style="font-size:10px;color:var(--txs);text-align:center;padding:8px">Sin conjuntos con delegado asignado</td></tr>'}</tbody>
    </table>
    ${elegirJornadaHtml}
    <div class="section-title" style="margin-top:12px">Eventos del día</div>
    ${eventosHtml}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn btn-v btn-sm" onclick="closeOv('modal-dia-detalle');abrirNuevoEvento('${iso}')">➕ Nuevo evento este día</button>
      ${puedeSolicitarSabado ? `<button class="btn btn-v btn-sm" onclick="closeOv('modal-dia-detalle');abrirSolicitarSabado('${iso}')">🌞 Solicitar este sábado libre</button>` : ''}
    </div>
  `;
  openOv('modal-dia-detalle');
}

// ─── SÁBADOS LIBRES — solicitud (delegado) y aprobación (Staff) ─
// Reglas duras: nunca se puede solicitar un sábado que caiga en estas fechas
// - Provisionales: el último sábado del mes
// - Definitivos: el sábado justo antes del envío del informe de gestión (5 días hábiles antes
//   de la reunión de consejo) de CUALQUIERA de sus conjuntos
function esUltimoSabadoDelMes(iso) {
  const d = fechaIsoADate(iso);
  if (!d || d.getDay() !== 6) return false;
  const semanaSiguiente = new Date(d);
  semanaSiguiente.setDate(d.getDate() + 7);
  return semanaSiguiente.getMonth() !== d.getMonth();
}

function sabadoAntesDeFecha(fechaIso) {
  const d = fechaIsoADate(fechaIso);
  if (!d) return null;
  const cursor = new Date(d);
  cursor.setDate(cursor.getDate() - 1);
  while (cursor.getDay() !== 6) cursor.setDate(cursor.getDate() - 1);
  return fechaDateAIso(cursor);
}

function sabadoBloqueadoParaDelegado(delegado, fechaIso) {
  const conjuntosDelegado = todosLosConjuntos().filter(c => c.del === delegado);
  const esProvisional = conjuntosDelegado.some(c => tipoConjunto(c.n) === 'Provisional (A&V)');
  if (esProvisional && esUltimoSabadoDelMes(fechaIso)) {
    return 'Los delegados de conjuntos provisionales no pueden solicitar el último sábado del mes';
  }
  const conjuntosDefinitivos = conjuntosDelegado.filter(c => tipoConjunto(c.n) === 'Definitivos').map(c => c.n);
  for (const conjunto of conjuntosDefinitivos) {
    const reuniones = DATA.eventosCalendario.filter(e => e.tipo === 'Reunión de consejo' && e.conjunto === conjunto);
    for (const r of reuniones) {
      const fechaInforme = restarDiasHabiles(fechaIsoADate(r.fecha), 5);
      if (sabadoAntesDeFecha(fechaDateAIso(fechaInforme)) === fechaIso) {
        return `Es el sábado previo al envío del informe de gestión de ${conjunto} (reunión de consejo del ${fechaCortaDesdeIso(r.fecha)})`;
      }
    }
  }
  return null;
}

function crearSolicitudSabado(fechaIso) {
  const usuario = usuarioActual();
  if (!usuario || esMedioTiempo(usuario.n)) return;
  const d = fechaIsoADate(fechaIso);
  if (!d || d.getDay() !== 6) { toast('Debes elegir un sábado'); return; }
  const razonBloqueo = sabadoBloqueadoParaDelegado(usuario.n, fechaIso);
  if (razonBloqueo) { toast(`⛔ No puedes solicitar este sábado: ${razonBloqueo}`, 6000); return; }
  if (DATA.sabadosLibres.some(s => s.delegado === usuario.n && s.fecha === fechaIso && s.estado !== 'rechazado')) {
    toast('Ya tienes una solicitud para ese sábado'); return;
  }
  const mes = mesDeFechaIso(fechaIso);
  const yaAprobados = sabadosDeDelegado(usuario.n, mes, 'aprobado').length;
  const yaPendientes = sabadosDeDelegado(usuario.n, mes, 'pendiente').length;
  if (yaAprobados + yaPendientes >= SABADOS_LIBRES_POR_MES) {
    if (!confirm(`Ya tienes ${yaAprobados + yaPendientes} sábado(s) solicitados/aprobados en ${mes} (guía: ${SABADOS_LIBRES_POR_MES}/mes). ¿Solicitar igual?`)) return;
  }
  const nuevo = { delegado: usuario.n, fecha: fechaIso, estado: 'pendiente', solicitadoEn: new Date().toISOString() };
  DATA.sabadosLibres.push(nuevo);
  const idx = DATA.sabadosLibres.length - 1;
  guardarLocal();
  solicitarSabadoLibreEnSupabase(idx);
  toast('✓ Sábado libre solicitado — queda pendiente de aprobación');
  renderCalendario();
}

function abrirSolicitarSabado(fechaPrefill) {
  const usuario = usuarioActual();
  if (!usuario || esMedioTiempo(usuario.n)) return;
  document.getElementById('sabado-fecha-input').value = fechaPrefill || '';
  const mes = fechaPrefill ? mesDeFechaIso(fechaPrefill) : getMes();
  const aprobados = sabadosDeDelegado(usuario.n, mes, 'aprobado').length;
  const pendientes = sabadosDeDelegado(usuario.n, mes, 'pendiente').length;
  document.getElementById('sabado-saldo-info').textContent =
    `Guía: ${SABADOS_LIBRES_POR_MES} sábados libres al mes. Llevas ${aprobados + pendientes} solicitados/aprobados en ${mes}.`;
  openOv('modal-solicitar-sabado');
}

function confirmarSolicitudSabado() {
  const fecha = document.getElementById('sabado-fecha-input').value;
  if (!fecha) { toast('Elige una fecha'); return; }
  closeOv('modal-solicitar-sabado');
  crearSolicitudSabado(fecha);
}

function resolverSabado(idx, nuevoEstado) {
  if (!esStaff()) return;
  const s = DATA.sabadosLibres[idx];
  if (!s) return;
  const usuario = usuarioActual();
  s.estado = nuevoEstado;
  s.resueltoPor = usuario ? usuario.n : '';
  guardarLocal();
  resolverSabadoLibreEnSupabase(idx);
  toast(nuevoEstado === 'aprobado' ? '✓ Sábado aprobado' : 'Sábado rechazado');
  renderCalendario();
}

function renderColaAprobacionSabados() {
  if (!esStaff()) return '';
  const pendientes = DATA.sabadosLibres
    .map((s, idx) => ({ ...s, idx }))
    .filter(s => s.estado === 'pendiente')
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!pendientes.length) return '';
  return `
    <div class="card">
      <div class="section-title">🙋 Sábados libres pendientes de aprobar (${pendientes.length})</div>
      <table class="tbl">
        <thead><tr><th>Delegado</th><th>Sábado</th><th></th></tr></thead>
        <tbody>
          ${pendientes.map(s => `
            <tr>
              <td style="font-size:10px">${s.delegado}</td>
              <td style="font-size:10px">${fechaCortaDesdeIso(s.fecha)}</td>
              <td>
                <button class="btn btn-sm btn-v" style="font-size:9px;padding:2px 6px" onclick="resolverSabado(${s.idx},'aprobado')">✓ Aprobar</button>
                <button class="btn btn-sm btn-r" style="font-size:9px;padding:2px 6px" onclick="resolverSabado(${s.idx},'rechazado')">✕ Rechazar</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// Botón para que Staff asigne sábados libres a varios delegados de una sola vez, ya aprobados
// (sin pasar por la cola de solicitudes) — para cuando la decisión ya la tomó la administración.
function renderBotonSabadosMasivos() {
  if (!esStaff()) return '';
  return `
    <div class="card">
      <div class="section-title">📋 Sábados libres masivos</div>
      <div style="font-size:9px;color:var(--txs);margin-bottom:8px">Asigna un sábado libre ya aprobado a varios delegados de tiempo completo a la vez, sin pasar por la solicitud individual.</div>
      <button class="btn btn-v btn-sm" onclick="abrirSabadosMasivos()">➕ Programar sábados masivos</button>
    </div>`;
}

function abrirSabadosMasivos() {
  if (!esStaff()) return;
  document.getElementById('sabmas-fecha').value = '';
  const delegadosTC = DATA.usuarios.filter(u => u.rol === 'delegado' && !esMedioTiempo(u.n));
  document.getElementById('sabmas-delegados').innerHTML = delegadosTC.map(u => `
    <label style="font-size:10px;background:white;padding:4px 8px;border-radius:6px;border:1px solid var(--brd);cursor:pointer">
      <input type="checkbox" value="${u.n}"> ${u.n}
    </label>`).join('') || '<div style="font-size:10px;color:var(--txs)">Sin delegados de tiempo completo</div>';
  openOv('modal-sabados-masivos');
}

// Bloqueo con aviso (no impide guardar) — Staff decide con la información completa delante,
// igual que la validación de "presencial" en eventos.
function confirmarSabadosMasivos() {
  if (!esStaff()) return;
  const fecha = document.getElementById('sabmas-fecha').value;
  if (!fecha) { toast('Elige la fecha del sábado'); return; }
  const d = fechaIsoADate(fecha);
  if (!d || d.getDay() !== 6) { toast('Debes elegir un sábado'); return; }
  const marcados = [...document.querySelectorAll('#sabmas-delegados input:checked')].map(i => i.value);
  if (!marcados.length) { toast('Selecciona al menos un delegado'); return; }

  const avisos = marcados.map(delegado => sabadoBloqueadoParaDelegado(delegado, fecha)).filter(Boolean);
  if (avisos.length && !confirm(`⚠️ Este sábado está bloqueado para algún(os) delegado(s) por sus reglas normales:\n${avisos.join('\n')}\n\n¿Asignarlo igual?`)) return;

  const usuario = usuarioActual();
  marcados.forEach(delegado => {
    let s = DATA.sabadosLibres.find(x => x.delegado === delegado && x.fecha === fecha && x.estado !== 'rechazado');
    if (!s) {
      s = { delegado, fecha, estado: 'aprobado', solicitadoEn: new Date().toISOString(), resueltoPor: usuario ? usuario.n : '' };
      DATA.sabadosLibres.push(s);
      const idx = DATA.sabadosLibres.length - 1;
      solicitarSabadoLibreEnSupabase(idx); // guardado individual: solo esta fila nueva
    } else {
      s.estado = 'aprobado';
      s.resueltoPor = usuario ? usuario.n : '';
      const idx = DATA.sabadosLibres.indexOf(s);
      resolverSabadoLibreEnSupabase(idx); // guardado individual: solo esta fila
    }
  });
  guardarLocal();
  closeOv('modal-sabados-masivos');
  toast(`✓ Sábado libre asignado a ${marcados.length} delegado(s)`);
  renderCalendario();
}

function renderMisSabados() {
  const usuario = usuarioActual();
  if (!usuario || esStaff() || esMedioTiempo(usuario.n)) return '';
  const mes = getMes();
  const mios = DATA.sabadosLibres
    .map((s, idx) => ({ ...s, idx }))
    .filter(s => s.delegado === usuario.n)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const ETIQUETA = { pendiente: '🕓 Pendiente', aprobado: '✓ Aprobado', rechazado: '✕ Rechazado' };
  return `
    <div class="card">
      <div class="section-title">🌞 Mis sábados libres</div>
      <div style="font-size:9px;color:var(--txs);margin-bottom:8px">Guía: ${SABADOS_LIBRES_POR_MES} sábados libres al mes. Solicítalos y quedan pendientes hasta que Staff los apruebe.</div>
      <button class="btn btn-v btn-sm" onclick="abrirSolicitarSabado()">➕ Solicitar sábado libre</button>
      <table class="tbl" style="margin-top:8px">
        <thead><tr><th>Sábado</th><th>Estado</th></tr></thead>
        <tbody>${mios.map(s => `<tr><td style="font-size:10px">${fechaCortaDesdeIso(s.fecha)}</td><td style="font-size:10px">${ETIQUETA[s.estado] || s.estado}</td></tr>`).join('') || '<tr><td colspan="2" style="font-size:10px;color:var(--txs);text-align:center;padding:8px">Sin solicitudes aún</td></tr>'}</tbody>
      </table>
    </div>`;
}

// ─── VACACIONES — solicitud (delegado, todos por igual) y aprobación (Staff) ─
function crearSolicitudVacacion(fechaInicio, fechaFin) {
  const usuario = usuarioActual();
  if (!usuario) return;
  const dias = diasHabilesEntre(fechaInicio, fechaFin);
  if (dias <= 0) { toast('Rango de fechas inválido'); return; }
  const saldo = saldoVacaciones(usuario.n);
  const nuevo = { delegado: usuario.n, fechaInicio, fechaFin, diasHabiles: dias, estado: 'pendiente', solicitadoEn: new Date().toISOString() };
  DATA.vacaciones.push(nuevo);
  const idx = DATA.vacaciones.length - 1;
  guardarLocal();
  solicitarVacacionEnSupabase(idx);
  toast(dias > saldo.disponible
    ? `⚠️ Solicitada (${dias} días hábiles) — supera tu saldo disponible (${saldo.disponible}), Staff lo revisa al aprobar`
    : `✓ Vacación solicitada (${dias} día(s) hábiles) — pendiente de aprobación`, 6000);
  renderCalendario();
}

// ─── Calendario tipo "buscador de vuelos" para elegir el rango ─
let VACA_MES_OFFSET = 0;
let VACA_SELECCION_INICIO = null;
let VACA_SELECCION_FIN = null;

function abrirSolicitarVacacion() {
  VACA_MES_OFFSET = 0;
  VACA_SELECCION_INICIO = null;
  VACA_SELECCION_FIN = null;
  renderModalVacaciones();
  openOv('modal-solicitar-vacacion');
}

function cambiarMesVacaciones(delta) {
  VACA_MES_OFFSET += delta;
  renderModalVacaciones();
}

function mesVacacionesActual() {
  const base = new Date();
  return new Date(base.getFullYear(), base.getMonth() + VACA_MES_OFFSET, 1);
}

function clickDiaVacaciones(iso) {
  if (!VACA_SELECCION_INICIO || VACA_SELECCION_FIN) {
    VACA_SELECCION_INICIO = iso;
    VACA_SELECCION_FIN = null;
  } else if (iso < VACA_SELECCION_INICIO) {
    VACA_SELECCION_FIN = VACA_SELECCION_INICIO;
    VACA_SELECCION_INICIO = iso;
  } else {
    VACA_SELECCION_FIN = iso;
  }
  renderModalVacaciones();
}

// Cuenta días hábiles hacia adelante desde fechaInicioIso hasta agotar diasDisponibles, y
// devuelve esa fecha — usado para el aviso "puedes tomar hasta el DD/MM"
function calcularFechaFinMaxima(fechaInicioIso, diasDisponibles) {
  if (!diasDisponibles || diasDisponibles <= 0) return null;
  let contados = 0;
  let d = fechaIsoADate(fechaInicioIso);
  while (contados < diasDisponibles) {
    if (!esFinDeSemana(d)) contados++;
    if (contados === diasDisponibles) return fechaDateAIso(d);
    d = new Date(d);
    d.setDate(d.getDate() + 1);
  }
}

function renderModalVacaciones() {
  const usuario = usuarioActual();
  if (!usuario) return;
  const mesDate = mesVacacionesActual();
  const anio = mesDate.getFullYear();
  const mesIdx = mesDate.getMonth();
  const primerDia = new Date(anio, mesIdx, 1);
  const totalDias = new Date(anio, mesIdx + 1, 0).getDate();
  const offsetInicio = (primerDia.getDay() + 6) % 7;
  const hoyIso = fechaDateAIso(new Date());

  const celdas = [];
  for (let i = 0; i < offsetInicio; i++) celdas.push(null);
  for (let d = 1; d <= totalDias; d++) celdas.push(d);
  while (celdas.length % 7 !== 0) celdas.push(null);

  const grid = celdas.map(d => {
    if (!d) return `<div class="vaca-day vaca-day-vacio"></div>`;
    const iso = `${anio}-${String(mesIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const pasado = iso < hoyIso;
    let cls = 'vaca-day';
    if (pasado) cls += ' vaca-day-deshabilitado';
    if (iso === VACA_SELECCION_INICIO || iso === VACA_SELECCION_FIN) cls += ' vaca-day-extremo';
    else if (VACA_SELECCION_INICIO && VACA_SELECCION_FIN && iso > VACA_SELECCION_INICIO && iso < VACA_SELECCION_FIN) cls += ' vaca-day-rango';
    return `<div class="${cls}" ${pasado ? '' : `onclick="clickDiaVacaciones('${iso}')"`}>${d}</div>`;
  }).join('');

  const saldo = saldoVacaciones(usuario.n);
  let infoSaldo = `Disponibles: <strong>${saldo.disponible}</strong> día(s) hábiles.`;
  if (VACA_SELECCION_INICIO && !VACA_SELECCION_FIN) {
    const finMaximo = calcularFechaFinMaxima(VACA_SELECCION_INICIO, saldo.disponible);
    infoSaldo += finMaximo ? ` Con tu saldo, puedes tomar hasta el <strong>${fechaCortaDesdeIso(finMaximo)}</strong> (podés elegir menos días sin problema).` : ' No te quedan días disponibles.';
  }
  const resumenRango = (VACA_SELECCION_INICIO && VACA_SELECCION_FIN)
    ? `<div style="font-size:11px;font-weight:700;margin-top:8px">${fechaCortaDesdeIso(VACA_SELECCION_INICIO)} → ${fechaCortaDesdeIso(VACA_SELECCION_FIN)} · ${diasHabilesEntre(VACA_SELECCION_INICIO, VACA_SELECCION_FIN)} día(s) hábiles</div>`
    : '<div style="font-size:10px;color:var(--txs);margin-top:8px">Elige el día de inicio y luego el de fin</div>';

  document.getElementById('vaca-modal-contenido').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <button class="horw-nav-btn" onclick="cambiarMesVacaciones(-1)">‹</button>
      <div style="font-size:12px;font-weight:700">${MESES[mesIdx]} ${anio}</div>
      <button class="horw-nav-btn" onclick="cambiarMesVacaciones(1)">›</button>
    </div>
    <div class="vaca-grid">
      ${DIAS_SEMANA.map(d => `<div class="vaca-dow">${d}</div>`).join('')}
      ${grid}
    </div>
    <div style="font-size:10px;margin-top:8px">${infoSaldo}</div>
    ${resumenRango}
  `;
}

function confirmarSolicitudVacacion() {
  if (!VACA_SELECCION_INICIO || !VACA_SELECCION_FIN) { toast('Elige el día de inicio y el de fin'); return; }
  closeOv('modal-solicitar-vacacion');
  crearSolicitudVacacion(VACA_SELECCION_INICIO, VACA_SELECCION_FIN);
}

function resolverVacacion(idx, nuevoEstado) {
  if (!esStaff()) return;
  const v = DATA.vacaciones[idx];
  if (!v) return;
  const usuario = usuarioActual();
  v.estado = nuevoEstado;
  v.resueltoPor = usuario ? usuario.n : '';
  guardarLocal();
  resolverVacacionEnSupabase(idx);
  toast(nuevoEstado === 'aprobado' ? '✓ Vacación aprobada' : 'Vacación rechazada');
  renderCalendario();
}

function renderColaAprobacionVacaciones() {
  if (!esStaff()) return '';
  const pendientes = DATA.vacaciones
    .map((v, idx) => ({ ...v, idx }))
    .filter(v => v.estado === 'pendiente')
    .sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio));
  if (!pendientes.length) return '';
  return `
    <div class="card">
      <div class="section-title">🏖️ Vacaciones pendientes de aprobar (${pendientes.length})</div>
      <table class="tbl">
        <thead><tr><th>Delegado</th><th>Rango</th><th>Días hábiles</th><th></th></tr></thead>
        <tbody>
          ${pendientes.map(v => `
            <tr>
              <td style="font-size:10px">${v.delegado}</td>
              <td style="font-size:10px">${fechaCortaDesdeIso(v.fechaInicio)} - ${fechaCortaDesdeIso(v.fechaFin)}</td>
              <td style="font-size:10px">${v.diasHabiles}</td>
              <td>
                <button class="btn btn-sm btn-v" style="font-size:9px;padding:2px 6px" onclick="resolverVacacion(${v.idx},'aprobado')">✓ Aprobar</button>
                <button class="btn btn-sm btn-r" style="font-size:9px;padding:2px 6px" onclick="resolverVacacion(${v.idx},'rechazado')">✕ Rechazar</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// Aplica a TODOS los delegados por igual (tiempo completo y medio tiempo) — para medio tiempo
// (contratados por prestación de servicios) no es una obligación legal, pero se ofrece igual.
function renderMisVacaciones() {
  const usuario = usuarioActual();
  if (!usuario || esStaff()) return '';
  const saldo = saldoVacaciones(usuario.n);
  const mias = DATA.vacaciones
    .map((v, idx) => ({ ...v, idx }))
    .filter(v => v.delegado === usuario.n)
    .sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio));
  const ETIQUETA = { pendiente: '🕓 Pendiente', aprobado: '✓ Aprobado', rechazado: '✕ Rechazado' };
  return `
    <div class="card">
      <div class="section-title">🏖️ Mis vacaciones</div>
      <div style="font-size:10px;margin-bottom:8px">Ganados: <strong>${saldo.ganados}</strong> · Tomados: <strong>${saldo.tomados}</strong> · Disponibles: <strong style="color:var(--vm)">${saldo.disponible}</strong></div>
      <button class="btn btn-v btn-sm" onclick="abrirSolicitarVacacion()">➕ Solicitar vacaciones</button>
      <table class="tbl" style="margin-top:8px">
        <thead><tr><th>Rango</th><th>Días</th><th>Estado</th></tr></thead>
        <tbody>${mias.map(v => `<tr><td style="font-size:10px">${fechaCortaDesdeIso(v.fechaInicio)} - ${fechaCortaDesdeIso(v.fechaFin)}</td><td style="font-size:10px">${v.diasHabiles}</td><td style="font-size:10px">${ETIQUETA[v.estado] || v.estado}</td></tr>`).join('') || '<tr><td colspan="3" style="font-size:10px;color:var(--txs);text-align:center;padding:8px">Sin solicitudes aún</td></tr>'}</tbody>
      </table>
    </div>`;
}

// ─── ADMIN: medio tiempo (por delegado, no por fila de horario) ─
// Un delegado de medio tiempo no trabaja sábados de ningún tipo (a diferencia de tiempo completo,
// que tiene los 2 sábados libres al mes) y no recibe el compensatorio del día siguiente a una
// reunión de consejo.
function renderMedioTiempoAdmin() {
  const delegados = DATA.usuarios.filter(u => u.rol === 'delegado');
  return `
    <div class="card">
      <div class="section-title">🕓 Delegados de medio tiempo</div>
      <div style="font-size:9px;color:var(--txs);margin-bottom:8px">No aplican sábados libres (no trabajan ningún sábado) ni el compensatorio de reunión de consejo.</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${delegados.map((u, idx) => {
          const idxReal = DATA.usuarios.indexOf(u);
          return `
          <label style="font-size:10px;background:var(--b);padding:5px 10px;border-radius:6px;border:1px solid var(--brd);cursor:pointer;display:flex;align-items:center;gap:6px">
            <input type="checkbox" ${u.medioTiempo ? 'checked' : ''} onchange="toggleMedioTiempo(${idxReal},this.checked)"> ${u.n}
          </label>`;
        }).join('') || '<div style="font-size:10px;color:var(--txs)">Sin delegados</div>'}
      </div>
    </div>`;
}

function toggleMedioTiempo(idx, checked) {
  const u = DATA.usuarios[idx];
  if (!u) return;
  u.medioTiempo = checked;
  guardarLocal();
  programarGuardadoUsuario(idx);
  renderAdmin();
}

// ─── ADMIN: horarios_delegados (editable) ────────────────────
const DIAS_CHECKBOX = [
  { key: 'lunes', label: 'L' }, { key: 'martes', label: 'M' }, { key: 'miercoles', label: 'X' },
  { key: 'jueves', label: 'J' }, { key: 'viernes', label: 'V' }, { key: 'sabado', label: 'S' }
];

function conjuntosDisponiblesHorario() {
  return [...todosLosConjuntos().map(c => c.n), NOMBRE_OFICINA];
}

// Encuentra el turno preestablecido cuyas horas coincidan EXACTO con las guardadas — el
// desplegable se calcula así, no comparando contra el texto de "turno" guardado (que en filas
// viejas usaba etiquetas cortas como "Mañana"/"Tarde" que ya no existen en TURNOS_PRESET).
function presetPorHoras(entrada, salida) {
  return TURNOS_PRESET.find(t => t.entrada === entrada && t.salida === salida) || null;
}

function renderFilasHorarios() {
  return DATA.horariosDelegados.map((h, idx) => {
    if (h.deleted) return '';
    const presetActual = presetPorHoras(h.hora_entrada, h.hora_salida);
    const esPersonalizado = !presetActual;
    const permiteSabado = horaSalidaPermiteSabado(h.hora_salida);
    return `
      <tr>
        <td>
          <select class="form-input" style="font-size:9px;padding:3px 5px" onchange="cambiarConjuntoHorario(${idx},this.value)">
            ${conjuntosDisponiblesHorario().map(n => `<option ${n === h.conjunto ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </td>
        <td>
          <select class="form-input" style="font-size:9px;padding:3px 5px" onchange="editarCampoHorarioSelect(${idx},'delegado',this.value)">
            ${DATA.usuarios.filter(u => u.rol === 'delegado').map(u => `<option ${u.n === h.delegado ? 'selected' : ''}>${u.n}</option>`).join('')}
          </select>
        </td>
        <td>
          <select class="form-input" style="font-size:9px;padding:3px 5px;width:150px" onchange="cambiarTurnoHorario(${idx},this.value)">
            ${TURNOS_PRESET.map(t => `<option ${(esPersonalizado ? t.label === 'Personalizado' : t.label === presetActual.label) ? 'selected' : ''}>${t.label}</option>`).join('')}
          </select>
        </td>
        <td><input class="form-input" style="font-size:9px;padding:3px 5px;width:70px" value="${esPersonalizado ? (h.hora_entrada || '') : horaAMPM(h.hora_entrada)}" ${esPersonalizado ? '' : 'readonly'} ${esPersonalizado ? 'placeholder="H:MM 24h"' : ''} onchange="editarCampoHorarioTexto(${idx},'hora_entrada',this.value)"></td>
        <td><input class="form-input" style="font-size:9px;padding:3px 5px;width:70px" value="${esPersonalizado ? (h.hora_salida || '') : horaAMPM(h.hora_salida)}" ${esPersonalizado ? '' : 'readonly'} ${esPersonalizado ? 'placeholder="H:MM 24h"' : ''} onchange="editarCampoHorarioTexto(${idx},'hora_salida',this.value)"></td>
        <td>
          <div style="display:flex;gap:3px">
            ${DIAS_CHECKBOX.map(d => `
              <label style="font-size:8px;text-align:center;color:${(d.key === 'sabado' && !permiteSabado) ? 'var(--txs)' : 'var(--tx)'}">
                ${d.label}<br>
                <input type="checkbox" ${diasAtencionIncluye(h.dias_atencion, d.key) ? 'checked' : ''} ${(d.key === 'sabado' && !permiteSabado) ? 'disabled' : ''} onchange="toggleDiaHorario(${idx},'${d.key}',this.checked)">
              </label>`).join('')}
          </div>
        </td>
        <td><button class="btn btn-sm btn-r" style="font-size:9px;padding:2px 6px" onclick="eliminarFilaHorario(${idx})">🗑</button></td>
      </tr>`;
  }).join('') || '<tr><td colspan="7" style="font-size:10px;color:var(--txs);text-align:center;padding:10px">Sin horarios cargados</td></tr>';
}

function guardarYRefrescarHorario(idx) {
  guardarLocal();
  guardarHorarioEnSupabase(idx);
  renderAdmin();
}

function cambiarConjuntoHorario(idx, conjuntoNombre) {
  const h = DATA.horariosDelegados[idx];
  if (!h) return;
  h.conjunto = conjuntoNombre;
  // Autocompleta el delegado con el de ESE conjunto (si tiene uno asignado) — sigue siendo
  // editable después con el select de Delegado, por si hace falta poner otro (ej. Oficina A&V,
  // que no tiene delegado fijo propio)
  if (conjuntoNombre !== NOMBRE_OFICINA) {
    const c = conjuntoPorNombre(conjuntoNombre);
    if (c && c.del && c.del !== '—') h.delegado = c.del;
  }
  guardarYRefrescarHorario(idx);
}

function editarCampoHorarioSelect(idx, campo, valor) {
  const h = DATA.horariosDelegados[idx];
  if (!h) return;
  h[campo] = valor;
  guardarYRefrescarHorario(idx);
}

function cambiarTurnoHorario(idx, turnoLabel) {
  const h = DATA.horariosDelegados[idx];
  if (!h) return;
  h.turno = turnoLabel;
  const preset = TURNOS_PRESET.find(t => t.label === turnoLabel);
  if (preset && preset.entrada) { h.hora_entrada = preset.entrada; h.hora_salida = preset.salida; }
  // Si el nuevo turno ya no permite sábado (se mete en la tarde), destildar sábado si estaba marcado
  if (!horaSalidaPermiteSabado(h.hora_salida)) {
    h.dias_atencion = (h.dias_atencion || '').replace(/s[aá]bado/gi, '').replace(/,\s*,/g, ',').replace(/^,|,$/g, '').trim();
  }
  guardarYRefrescarHorario(idx);
}

function editarCampoHorarioTexto(idx, campo, valor) {
  const h = DATA.horariosDelegados[idx];
  if (!h) return;
  h[campo] = valor.trim();
  guardarYRefrescarHorario(idx);
}

function toggleDiaHorario(idx, diaKey, checked) {
  const h = DATA.horariosDelegados[idx];
  if (!h) return;
  if (diaKey === 'sabado' && checked && !horaSalidaPermiteSabado(h.hora_salida)) return; // regla dura, ni por llamada directa
  const dias = new Set(normalizarTexto(h.dias_atencion).split(',').map(s => s.trim()).filter(Boolean));
  if (checked) dias.add(diaKey); else dias.delete(diaKey);
  h.dias_atencion = [...dias].join(',');
  guardarYRefrescarHorario(idx);
}

function agregarFilaHorario() {
  const conjuntoInicial = conjuntosDisponiblesHorario()[0] || '';
  const c = conjuntoPorNombre(conjuntoInicial);
  const delegadoInicial = (c && c.del && c.del !== '—') ? c.del : ((DATA.usuarios.find(u => u.rol === 'delegado') || {}).n || '');
  DATA.horariosDelegados.push({ conjunto: conjuntoInicial, delegado: delegadoInicial, turno: TURNOS_PRESET[2].label, hora_entrada: TURNOS_PRESET[2].entrada, hora_salida: TURNOS_PRESET[2].salida, dias_atencion: '' });
  guardarLocal();
  renderAdmin();
}

function eliminarFilaHorario(idx) {
  const h = DATA.horariosDelegados[idx];
  if (!h) return;
  if (!confirm(`¿Eliminar el horario de ${h.delegado || '(sin nombre)'} en ${h.conjunto || '(sin conjunto)'}?`)) return;
  eliminarHorarioEnSupabase(idx);
  DATA.horariosDelegados.splice(idx, 1);
  guardarLocal();
  renderAdmin();
}

// ─── ADMIN: festivos (nombre fijo, año+fecha se cargan a mano) ─
let ANIO_FESTIVOS_ADMIN = new Date().getFullYear();

function cambiarAnioFestivosAdmin(anio) {
  ANIO_FESTIVOS_ADMIN = parseInt(anio, 10);
  renderAdmin();
}

// Encuentra la fila real en DATA.festivos para (año, nombre), o null si todavía no se cargó
// (el panel igual muestra la fila vacía lista para llenar — no hace falta "crear" nada antes)
function festivoPorAnioNombre(anio, nombre) {
  return DATA.festivos.find(f => f.anio === anio && f.nombre === nombre) || null;
}

function renderFilasFestivosAdmin() {
  const fijos = FESTIVOS_NOMBRES.map(nombre => {
    const f = festivoPorAnioNombre(ANIO_FESTIVOS_ADMIN, nombre);
    const fecha = f ? f.fecha : '';
    return `
      <tr>
        <td style="font-size:10px">${nombre}</td>
        <td><input class="form-input" type="date" style="font-size:9px;padding:3px 5px" value="${fecha || ''}" onchange="editarFechaFestivo('${nombre.replace(/'/g, "\\'")}',this.value)"></td>
        <td></td>
      </tr>`;
  }).join('');

  // Festivos personalizados (ej. uno autorizado a último momento) — nombre Y fecha editables,
  // se pueden agregar cuantos hagan falta ese año con "+ Agregar festivo"
  const personalizados = DATA.festivos
    .map((f, idx) => ({ ...f, idx }))
    .filter(f => f.anio === ANIO_FESTIVOS_ADMIN && !FESTIVOS_NOMBRES.includes(f.nombre))
    .map(f => `
      <tr>
        <td><input class="form-input" style="font-size:9px;padding:3px 5px" placeholder="Nombre del festivo" value="${f.nombre || ''}" onchange="editarNombreFestivoCustom(${f.idx},this.value)"></td>
        <td><input class="form-input" type="date" style="font-size:9px;padding:3px 5px" value="${f.fecha || ''}" onchange="editarFechaFestivoCustom(${f.idx},this.value)"></td>
        <td><button class="btn btn-sm btn-r" style="font-size:9px;padding:2px 6px" onclick="eliminarFestivoCustom(${f.idx})">🗑</button></td>
      </tr>`).join('');

  return fijos + personalizados;
}

function editarFechaFestivo(nombre, fechaIso) {
  let f = festivoPorAnioNombre(ANIO_FESTIVOS_ADMIN, nombre);
  if (!f) {
    f = { anio: ANIO_FESTIVOS_ADMIN, nombre, fecha: fechaIso || null };
    DATA.festivos.push(f);
  } else {
    f.fecha = fechaIso || null;
  }
  const idx = DATA.festivos.indexOf(f);
  guardarLocal();
  guardarFestivoEnSupabase(idx);
}

function agregarFestivoCustom() {
  DATA.festivos.push({ anio: ANIO_FESTIVOS_ADMIN, nombre: '', fecha: null });
  guardarLocal();
  renderAdmin();
}

function editarNombreFestivoCustom(idx, valor) {
  const f = DATA.festivos[idx];
  if (!f) return;
  f.nombre = valor.trim();
  guardarLocal();
  if (f.nombre && f.fecha) guardarFestivoEnSupabase(idx); // solo se guarda en Supabase cuando ya tiene nombre Y fecha
}

function editarFechaFestivoCustom(idx, valor) {
  const f = DATA.festivos[idx];
  if (!f) return;
  f.fecha = valor || null;
  guardarLocal();
  if (f.nombre && f.fecha) guardarFestivoEnSupabase(idx);
}

function eliminarFestivoCustom(idx) {
  const f = DATA.festivos[idx];
  if (!f) return;
  if (!confirm(`¿Eliminar el festivo "${f.nombre || '(sin nombre)'}"?`)) return;
  if (f._supabaseId) eliminarFestivoEnSupabase(idx);
  DATA.festivos.splice(idx, 1);
  guardarLocal();
  renderAdmin();
}

// Aviso solo en diciembre, y solo si el año próximo todavía no tiene NINGÚN festivo con fecha
// cargada — para que Staff no se olvide de cargarlos antes de que empiece el año nuevo
function renderAvisoFestivosDiciembre() {
  const hoy = new Date();
  if (hoy.getMonth() !== 11) return ''; // 11 = diciembre
  const anioProximo = hoy.getFullYear() + 1;
  const yaCargados = DATA.festivos.some(f => f.anio === anioProximo && f.fecha);
  if (yaCargados) return '';
  return `<div class="ibox" style="background:#fdf1d9;border-color:#e8c069">🌞 Es diciembre — recuerda cargar los festivos de ${anioProximo} en la sección de abajo antes de que empiece el año.</div>`;
}
