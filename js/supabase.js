// supabase.js — Cliente Supabase: auth por cédula, datos y fotos (Storage)
// GestiónPH v2.0
// Depende de: config.js
// Único backend de la app — Firebase se quitó por completo (datos y fotos ya viven aquí).

const SB = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function actualizarIndicadorSync(estado) {
  if (typeof renderSyncIndicator === 'function') renderSyncIndicator(estado);
  // Protección offline: cada función de guardado individual llama aquí con 'offline' si falló
  // (sin internet) o 'synced' si un guardado posterior sí llegó — así se sabe en todo momento
  // si hay algún cambio que quedó SOLO local, sin haber llegado a Supabase todavía. Se guarda
  // también en localStorage (no solo en memoria) para que la marca sobreviva a un cierre/recarga
  // completo del navegador — así se puede avisar al reabrir, no solo en la misma sesión.
  HAY_CAMBIOS_SIN_SINCRONIZAR = estado === 'offline';
  if (estado === 'offline') {
    localStorage.setItem(PENDIENTE_OFFLINE_KEY, '1');
    // Antes esto solo quedaba en el ícono del header (fácil de no notar) y en console.error —
    // un guardado que fallara en el servidor podía pasar completamente desapercibido para quien
    // lo hizo (ver caso real: evento de calendario rechazado por Supabase, nadie se enteró hasta
    // que otro usuario no lo vio). Ahora avisa siempre con un toast visible.
    if (typeof toast === 'function') toast('⚠️ No se pudo guardar en el servidor — revisa tu conexión e inténtalo de nuevo', 5000);
  }
  else if (estado === 'synced') localStorage.removeItem(PENDIENTE_OFFLINE_KEY);
}

const PENDIENTE_OFFLINE_KEY = 'gph_pendiente_offline';
let HAY_CAMBIOS_SIN_SINCRONIZAR = false;

// Si se intenta cerrar/recargar la pestaña con un cambio que no llegó a subir, se avisa antes
// de perderlo — no hay merge al reconectar con guardado quirúrgico, así que la única protección
// real es no dejar salir sin avisar.
window.addEventListener('beforeunload', e => {
  if (!HAY_CAMBIOS_SIN_SINCRONIZAR) return;
  e.preventDefault();
  e.returnValue = 'Tienes un cambio que no se pudo guardar (sin conexión). Si sales ahora, se puede perder.';
});

// Al recuperar conexión, avisa para que la persona vuelva a intentar la última acción — no se
// reintenta sola para evitar reenviar datos con información desactualizada.
window.addEventListener('online', () => {
  if (HAY_CAMBIOS_SIN_SINCRONIZAR && typeof toast === 'function') {
    toast('🌐 Conexión recuperada — repite el último cambio si no alcanzó a guardarse', 6000);
  }
});

// Cada cédula obtiene una cuenta real de Supabase Auth por detrás — correo/clave derivados,
// invisibles para el usuario (sigue usando solo su cédula para entrar).
function emailDeCedula(cedula) {
  return `${cedula}@${AUTH_EMAIL_DOMINIO}`;
}
function claveDeCedula(cedula) {
  return `gph_${cedula}_2026`;
}

// Inicia sesión en Supabase Auth usando la cédula. Si la cuenta de Auth aún no existe (primera
// vez que esta persona entra desde que activamos Supabase), la crea sola en ese momento.
async function iniciarSesionSupabase(cedula) {
  const email = emailDeCedula(cedula);
  const password = claveDeCedula(cedula);

  const { data: loginData, error: loginError } = await SB.auth.signInWithPassword({ email, password });
  if (!loginError) return { ok: true, session: loginData.session };

  // No existía la cuenta de Auth todavía → se crea (signUp) y se intenta entrar de nuevo
  const { error: signUpError } = await SB.auth.signUp({ email, password });
  if (signUpError) return { ok: false, error: signUpError.message };

  const { data: retryData, error: retryError } = await SB.auth.signInWithPassword({ email, password });
  if (retryError) return { ok: false, error: retryError.message };
  return { ok: true, session: retryData.session, nuevaCuenta: true };
}

// ═══════════════════════════════════════════════════════════════
// CARGA: trae todo lo que la sesión actual tiene permitido ver (RLS ya filtra por conjunto)
// y arma exactamente el mismo "snapshot" que antes armaba Firebase — así el resto de la app
// (eventuales.js, recurrentes.js, admin.js, etc.) no necesita cambiar NADA, sigue leyendo
// DATA/ESTADO/REC_COMS/EVAL_MANUAL/FECHAS_LIMITE_REC como siempre.
// ═══════════════════════════════════════════════════════════════
function tsMs(iso) { return iso ? new Date(iso).getTime() : undefined; }

// Trae el contador real de bytes usados en el bucket de fotos (tabla contadores, fila
// 'fotos_bytes') — alimenta la barra de capacidad en Admin.
async function cargarContadorFotos() {
  const { data, error } = await SB.from('contadores').select('valor').eq('clave', 'fotos_bytes').single();
  if (!error && data) {
    CONTADOR_FOTOS_BYTES = data.valor || 0;
    if (PESTANA_ACTUAL === 'admin' && typeof renderAdmin === 'function') renderAdmin();
  }
}

// Supabase (PostgREST) limita cada consulta a 1000 filas por defecto, sin avisar si corta el
// resto — un .select('*') normal en una tabla que ya superó las 1000 filas devuelve datos
// incompletos EN SILENCIO (bug real detectado: recurrentes_estado ya pasó ese límite y Staff
// veía menos avance del real). Esta función trae TODO, pidiendo de a 1000 en 1000 hasta agotar.
const PAGINA_TAMANO_FETCH = 1000;
async function fetchTodasLasFilas(queryBuilder) {
  let desde = 0;
  let todas = [];
  while (true) {
    const { data, error } = await queryBuilder().range(desde, desde + PAGINA_TAMANO_FETCH - 1);
    if (error) return { data: null, error };
    todas = todas.concat(data || []);
    if (!data || data.length < PAGINA_TAMANO_FETCH) break;
    desde += PAGINA_TAMANO_FETCH;
  }
  return { data: todas, error: null };
}

async function cargarTodoDesdeSupabase() {
  const [
    conjuntosRes, usuariosRes, delegadoConjRes, catalogoRes,
    eventualesRes, archivoRes, estadoRes, comsRes, evalRes,
    fechasRes, fechasGlobalRes, avRes, eventosRes, horariosRes, sabadosRes, festivosRes, vacacionesRes
  ] = await Promise.all([
    SB.from('conjuntos').select('*'),
    SB.from('usuarios').select('*'),
    SB.from('delegado_conjuntos').select('*'),
    SB.from('tareas_recurrentes_catalogo').select('*').order('id'),
    fetchTodasLasFilas(() => SB.from('tareas_eventuales').select('*')),
    fetchTodasLasFilas(() => SB.from('tareas_archivo').select('*')),
    fetchTodasLasFilas(() => SB.from('recurrentes_estado').select('*')),
    fetchTodasLasFilas(() => SB.from('recurrentes_comentarios').select('*')),
    SB.from('evaluacion_manual').select('*'),
    fetchTodasLasFilas(() => SB.from('fechas_limite').select('*')),
    SB.from('fechas_limite_global').select('*'),
    SB.from('tareas_av').select('*'),
    fetchTodasLasFilas(() => SB.from('eventos_calendario').select('*')),
    SB.from('horarios_delegados').select('*'),
    SB.from('sabados_libres').select('*'),
    SB.from('festivos').select('*'),
    SB.from('vacaciones').select('*')
  ]);

  // horariosRes/sabadosRes/festivosRes/vacacionesRes se dejan AFUERA de esta validación a
  // propósito: si esas tablas todavía no existen en Supabase (falta correr el .sql
  // correspondiente), no debe tumbar la carga de TODO lo demás — la app sigue funcionando
  // igual, solo sin esa función.
  if (horariosRes.error) console.error('No se pudieron cargar horarios de delegados (¿falta correr supabase_horarios_ausencias.sql?):', horariosRes.error.message);
  if (sabadosRes.error) console.error('No se pudieron cargar sábados libres (¿falta correr supabase_horarios_ausencias.sql?):', sabadosRes.error.message);
  if (festivosRes.error) console.error('No se pudieron cargar festivos (¿falta correr supabase_festivos.sql?):', festivosRes.error.message);
  if (vacacionesRes.error) console.error('No se pudieron cargar vacaciones (¿falta correr supabase_vacaciones.sql?):', vacacionesRes.error.message);

  const primerError = [conjuntosRes, usuariosRes, delegadoConjRes, catalogoRes, eventualesRes,
    archivoRes, estadoRes, comsRes, evalRes, fechasRes, fechasGlobalRes, avRes, eventosRes]
    .find(r => r.error);
  if (primerError) {
    console.error('Error cargando datos de Supabase:', primerError.error);
    return { ok: false, error: primerError.error.message };
  }

  // conjuntos
  const conjuntos = { def: [], pro: [] };
  (conjuntosRes.data || []).forEach(c => {
    const obj = { n: c.nombre, del: c.delegado, c: c.color, eval: c.eval || {}, cartera: c.cartera || {}, deleted: c.deleted };
    if (c.tipo === 'Definitivos') conjuntos.def.push(obj); else conjuntos.pro.push(obj);
  });

  // usuarios + delegado_conjuntos (asignación de conjuntos por delegado)
  const conjPorUsuario = {};
  (delegadoConjRes.data || []).forEach(dc => {
    conjPorUsuario[dc.usuario_id] = conjPorUsuario[dc.usuario_id] || [];
    conjPorUsuario[dc.usuario_id].push(dc.conjunto);
  });
  const usuarios = (usuariosRes.data || []).map(u => ({
    n: u.nombre, rol: u.rol, cargo: u.cargo, equipo: u.equipo, av: u.avatar, c: u.color,
    conjuntos: conjPorUsuario[u.id] || [], activo: u.activo,
    fechaIngreso: u.fecha_ingreso || null, medioTiempo: !!u.medio_tiempo,
    fechaVencimientoContrato: u.fecha_vencimiento_contrato || null, _supabaseId: u.id
  }));
  const cedulas = {};
  const cedActivos = {};
  (usuariosRes.data || []).forEach((u, i) => {
    cedulas[u.cedula] = { idx: i, rol: u.rol, activo: u.activo };
    cedActivos[u.cedula] = u.activo;
  });

  // catálogo de recurrentes — ordenado por id (mismo orden en que se migraron originalmente)
  // para que el índice de arreglo (_idx) siga coincidiendo con tarea_idx en las demás tablas
  const tareasRec = (catalogoRes.data || []).map(t => ({
    n: t.nombre, desc: t.descripcion, aplica: t.aplica, frec: t.frecuencia, veces: t.veces,
    cuando: t.cuando, limite: t.limite, bimestral: t.bimestral, foto: t.foto,
    fechaVariable: t.fecha_variable, fechaIndividual: t.fecha_individual,
    autoEval: t.auto_eval, evalPts: t.eval_pts, deleted: t.deleted, _supabaseId: t.id
  }));

  const tareasEve = (eventualesRes.data || []).map(t => ({
    id: t.id, conj: t.conjunto, n: t.nombre, obs: t.obs, tipo: t.tipo, enc: t.encargado,
    ra: t.registrado_por, apr: t.aprobador, pri: t.prioridad, est: t.estado,
    estUpdAt: tsMs(t.est_upd_at), reg: t.registrada, vence: t.vence,
    creadoEn: tsMs(t.creado_en), enProcesoEn: tsMs(t.en_proceso_en),
    finalizadoEn: tsMs(t.finalizado_en), aprobadoEn: tsMs(t.aprobado_en), coms: t.comentarios || []
  }));

  const tareasArchivo = (archivoRes.data || []).map(t => ({
    id: t.id, conj: t.conjunto, n: t.nombre, obs: t.obs, tipo: t.tipo, est: t.estado,
    creadoEn: tsMs(t.creado_en), finalizadoEn: tsMs(t.finalizado_en), aprobadoEn: tsMs(t.aprobado_en),
    coms: t.comentarios || [], archivedAt: t.archivado_en
  }));

  const estado = {};
  (estadoRes.data || []).forEach(r => {
    estado[r.conjunto] = estado[r.conjunto] || {};
    estado[r.conjunto][r.mes] = estado[r.conjunto][r.mes] || {};
    estado[r.conjunto][r.mes][r.tarea_idx] = estado[r.conjunto][r.mes][r.tarea_idx] || {};
    estado[r.conjunto][r.mes][r.tarea_idx][r.slot_idx] = {
      done: r.done, ts: r.ts, tsManual: r.ts_manual, hasFoto: r.has_foto, fotoCount: r.foto_count,
      undoneAt: tsMs(r.undone_at)
    };
  });

  const recComs = {};
  (comsRes.data || []).forEach(r => {
    recComs[r.conjunto] = recComs[r.conjunto] || {};
    recComs[r.conjunto][r.tarea_idx] = r.comentarios || [];
  });

  const evalManual = {};
  (evalRes.data || []).forEach(r => {
    evalManual[r.conjunto] = evalManual[r.conjunto] || {};
    evalManual[r.conjunto][r.mes] = { tareas: r.tareas || {}, cartera: r.cartera, asistencia: r.asistencia };
  });

  const fechasLimiteRec = {};
  (fechasRes.data || []).forEach(r => {
    fechasLimiteRec[r.conjunto] = fechasLimiteRec[r.conjunto] || {};
    fechasLimiteRec[r.conjunto][r.mes] = fechasLimiteRec[r.conjunto][r.mes] || {};
    fechasLimiteRec[r.conjunto][r.mes][r.tarea_idx] = r.fecha;
  });

  const fechasLimiteRecGlobal = {};
  (fechasGlobalRes.data || []).forEach(r => {
    fechasLimiteRecGlobal[r.mes] = fechasLimiteRecGlobal[r.mes] || {};
    fechasLimiteRecGlobal[r.mes][r.tarea_nombre] = r.fecha;
  });

  const tareasAV = (avRes.data || []).map(t => ({
    id: t.id, n: t.nombre, obs: t.obs, tipo: t.tipo, enc: t.encargado,
    ra: t.registrado_por, pri: t.prioridad, est: t.estado,
    estUpdAt: tsMs(t.est_upd_at), vence: t.vence,
    creadoEn: tsMs(t.creado_en), enProcesoEn: tsMs(t.en_proceso_en),
    finalizadoEn: tsMs(t.finalizado_en), aprobadoEn: tsMs(t.aprobado_en), coms: t.comentarios || []
  }));

  const eventosCalendario = (eventosRes.data || []).map(e => ({
    id: e.id, tipo: e.tipo, conjunto: e.conjunto, titulo: e.titulo, fecha: e.fecha, hora: e.hora,
    horaFin: e.hora_fin, modalidad: e.modalidad, lugarTipo: e.lugar_tipo, lugarTexto: e.lugar_texto,
    descripcion: e.descripcion, participantes: e.participantes || [], creadoPor: e.creado_por
  }));

  const horariosDelegados = (horariosRes.data || []).map(h => ({
    conjunto: h.conjunto, delegado: h.delegado, turno: h.turno,
    hora_entrada: h.hora_entrada, hora_salida: h.hora_salida, dias_atencion: h.dias_atencion,
    deleted: h.deleted, _supabaseId: h.id
  }));

  const sabadosLibres = (sabadosRes.data || []).map(s => ({
    delegado: s.delegado, fecha: s.fecha, estado: s.estado,
    solicitadoEn: s.solicitado_en, resueltoPor: s.resuelto_por, _supabaseId: s.id
  }));

  const festivos = (festivosRes.data || []).map(f => ({
    anio: f.anio, nombre: f.nombre, fecha: f.fecha, _supabaseId: f.id
  }));

  const vacaciones = (vacacionesRes.data || []).map(v => ({
    delegado: v.delegado, fechaInicio: v.fecha_inicio, fechaFin: v.fecha_fin,
    diasHabiles: v.dias_habiles, estado: v.estado,
    solicitadoEn: v.solicitado_en, resueltoPor: v.resuelto_por, _supabaseId: v.id
  }));

  const snap = {
    conjuntos, usuarios, cedulas, cedActivos, tareasRec, tareasEve,
    deletedEveIds: [], tareasArchivo, tareasAV, eventosCalendario,
    estado, recComs, evalManual, fechasLimiteRec, fechasLimiteRecGlobal,
    horariosDelegados, sabadosLibres, festivos, vacaciones
  };
  aplicarSnapshotDesdeLocal(snap);
  return { ok: true };
}

function isoODefecto(ms) { return ms ? new Date(ms).toISOString() : null; }

// ═══════════════════════════════════════════════════════════════
// GUARDADO QUIRÚRGICO — catálogo de tareas recurrentes (tareas_recurrentes_catalogo)
// Cada tarea se guarda de forma individual e independiente de las demás: crear/editar/eliminar
// una tarea NUNCA toca ni reenvía las filas de las otras tareas del catálogo. Solo Staff puede
// escribir esta tabla (RLS), igual que antes.
// ═══════════════════════════════════════════════════════════════
function filaCatalogoRec(t) {
  return {
    nombre: t.n, descripcion: t.desc, aplica: t.aplica, frecuencia: t.frec,
    veces: t.veces, cuando: t.cuando, limite: t.limite, bimestral: !!t.bimestral, foto: !!t.foto,
    fecha_variable: !!t.fechaVariable, fecha_individual: !!t.fechaIndividual,
    auto_eval: !!t.autoEval, eval_pts: t.evalPts, deleted: !!t.deleted
  };
}

let _recCatTimers = {}; // debounce por tarea (índice local) — una ráfaga de ediciones a LA MISMA tarea no dispara varios guardados sueltos
async function guardarTareaRecurrenteEnSupabase(idx) {
  if (!esStaff()) return; // RLS rechazaría de todos modos, evita la llamada
  const t = DATA.tareasRec[idx];
  if (!t) return;

  if (t._supabaseId) {
    const { error } = await SB.from('tareas_recurrentes_catalogo').update(filaCatalogoRec(t)).eq('id', t._supabaseId);
    if (error) {
      console.error('Error actualizando tarea recurrente en Supabase:', error.message);
      actualizarIndicadorSync('offline');
      return;
    }
  } else {
    // Tarea nueva: se inserta y se guarda el id real que asigna Supabase, para que las
    // próximas ediciones de ESTA tarea usen update() en vez de intentar insertarla de nuevo.
    const { data, error } = await SB.from('tareas_recurrentes_catalogo').insert(filaCatalogoRec(t)).select('id').single();
    if (error) {
      console.error('Error insertando tarea recurrente nueva en Supabase:', error.message);
      actualizarIndicadorSync('offline');
      return;
    }
    t._supabaseId = data.id;
  }
  actualizarIndicadorSync('synced');
}

function programarGuardadoTareaRecurrente(idx) {
  guardarLocal();
  clearTimeout(_recCatTimers[idx]);
  _recCatTimers[idx] = setTimeout(() => guardarTareaRecurrenteEnSupabase(idx), SAVE_DELAY);
}

// ═══════════════════════════════════════════════════════════════
// GUARDADO QUIRÚRGICO — usuarios + delegado_conjuntos
// Crear/editar/(des)activar UN usuario nunca toca la fila de otro. Reasignar el delegado de
// UN conjunto solo borra/inserta las 2 filas puntuales de delegado_conjuntos que cambiaron
// (el delegado que lo pierde, el que lo gana) — el resto de asignaciones de cualquier otro
// delegado/conjunto queda intacto. auth_id NUNCA se manda desde el cliente: lo asigna solo
// el trigger de Supabase (ver supabase_trigger_vincular_auth.sql) en el primer login real.
// ═══════════════════════════════════════════════════════════════
function filaUsuario(u, cedula, activo) {
  return {
    nombre: u.n, cedula, rol: u.rol, cargo: u.cargo || null, equipo: u.equipo || null,
    avatar: u.av || null, color: u.c || null, activo: activo !== false,
    fecha_ingreso: u.fechaIngreso || null, medio_tiempo: !!u.medioTiempo,
    fecha_vencimiento_contrato: u.fechaVencimientoContrato || null
  };
}

let _usuarioTimers = {}; // debounce por índice local de usuario
async function guardarUsuarioEnSupabase(idx) {
  if (!esStaff()) return;
  const u = DATA.usuarios[idx];
  if (!u) return;
  const cedula = cedulaPorIdxUsuario(idx);
  if (!cedula) return;
  const activo = DATA.cedulas[cedula] ? DATA.cedulas[cedula].activo : true;
  const row = filaUsuario(u, cedula, activo);

  if (u._supabaseId) {
    const { error } = await SB.from('usuarios').update(row).eq('id', u._supabaseId);
    if (error) {
      console.error('Error actualizando usuario en Supabase:', error.message);
      actualizarIndicadorSync('offline');
      return;
    }
  } else {
    const { data, error } = await SB.from('usuarios').insert(row).select('id').single();
    if (error) {
      console.error('Error insertando usuario nuevo en Supabase:', error.message);
      actualizarIndicadorSync('offline');
      return;
    }
    u._supabaseId = data.id;
  }
  actualizarIndicadorSync('synced');
}

function programarGuardadoUsuario(idx) {
  guardarLocal();
  clearTimeout(_usuarioTimers[idx]);
  _usuarioTimers[idx] = setTimeout(() => guardarUsuarioEnSupabase(idx), SAVE_DELAY);
}

// Diff quirúrgico de la asignación delegado↔conjunto: solo borra la fila (delegadoAnterior,
// conjunto) y solo inserta la fila (delegadoNuevo, conjunto). Ninguna otra fila de la tabla
// se toca. Si algún delegado involucrado todavía no tiene _supabaseId (recién creado en esta
// misma sesión y aún no confirmado por Supabase), se guarda primero para poder enlazarlo.
async function sincronizarAsignacionConjunto(conjuntoNombre, delegadoAnteriorNombre, delegadoNuevoNombre) {
  if (!esStaff()) return;
  if ((delegadoAnteriorNombre || '—') === (delegadoNuevoNombre || '—')) return; // no cambió nada, no se toca la tabla

  async function idDelegado(nombre) {
    if (!nombre || nombre === '—') return null;
    const idx = DATA.usuarios.findIndex(u => u.n === nombre);
    if (idx < 0) return null;
    if (!DATA.usuarios[idx]._supabaseId) await guardarUsuarioEnSupabase(idx); // asegura que exista antes de enlazarlo
    return DATA.usuarios[idx]._supabaseId || null;
  }

  const [idAnterior, idNuevo] = await Promise.all([idDelegado(delegadoAnteriorNombre), idDelegado(delegadoNuevoNombre)]);
  const tareas = [];
  if (idAnterior) tareas.push(SB.from('delegado_conjuntos').delete().eq('usuario_id', idAnterior).eq('conjunto', conjuntoNombre));
  if (idNuevo) tareas.push(SB.from('delegado_conjuntos').upsert({ usuario_id: idNuevo, conjunto: conjuntoNombre }, { onConflict: 'usuario_id,conjunto' }));

  const resultados = await Promise.all(tareas);
  const errores = resultados.filter(r => r && r.error);
  if (errores.length) {
    console.error('Error sincronizando asignación de conjunto:', errores.map(e => e.error.message));
    actualizarIndicadorSync('offline');
    return;
  }
  actualizarIndicadorSync('synced');
}

// ═══════════════════════════════════════════════════════════════
// GUARDADO QUIRÚRGICO — conjuntos
// Crear/editar UN conjunto nunca toca la fila de otro. Renombrar usa UPDATE sobre la fila
// existente (no INSERT+huérfano): gracias a ON UPDATE CASCADE (ver
// supabase_cascade_conjuntos.sql) el nuevo nombre se propaga solo a las 7 tablas que lo
// referencian, sin que la app tenga que reenviar esos datos.
// ═══════════════════════════════════════════════════════════════
function filaConjunto(c, tipo) {
  return { tipo, delegado: c.del, color: c.c, eval: c.eval || {}, cartera: c.cartera || {}, deleted: !!c.deleted };
}

async function guardarConjuntoEnSupabase(nombreAnterior, nombreNuevo, c, tipo) {
  if (!esStaff()) return;
  const datos = filaConjunto(c, tipo);
  if (!nombreAnterior) {
    const { error } = await SB.from('conjuntos').insert({ nombre: nombreNuevo, ...datos });
    if (error) {
      console.error('Error insertando conjunto nuevo en Supabase:', error.message);
      actualizarIndicadorSync('offline');
      return;
    }
  } else {
    const { error } = await SB.from('conjuntos').update({ nombre: nombreNuevo, ...datos }).eq('nombre', nombreAnterior);
    if (error) {
      console.error('Error actualizando conjunto en Supabase:', error.message);
      actualizarIndicadorSync('offline');
      return;
    }
  }
  actualizarIndicadorSync('synced');
}

async function eliminarConjuntoEnSupabase(nombre) {
  if (!esStaff()) return;
  const { error } = await SB.from('conjuntos').update({ deleted: true }).eq('nombre', nombre);
  if (error) {
    console.error('Error eliminando conjunto en Supabase:', error.message);
    actualizarIndicadorSync('offline');
    return;
  }
  actualizarIndicadorSync('synced');
}

// ═══════════════════════════════════════════════════════════════
// GUARDADO QUIRÚRGICO — tareas eventuales (tareas_eventuales)
// Crear, cambiar estado, comentar, aprobar/devolver/validar: cada acción guarda SOLO la fila
// de esa tarea puntual — ninguna otra tarea eventual (de ese conjunto o de otro) se toca. El id
// (T-XXX) ya se genera en el cliente antes de guardar, así que upsert() sirve para crear y
// editar por igual, sin necesitar el paso extra de "esperar el id real" que sí hace falta en
// catálogo/usuarios/conjuntos (esas tablas usan id autogenerado por Supabase).
// ═══════════════════════════════════════════════════════════════
function filaEventual(t) {
  return {
    conjunto: t.conj, nombre: t.n, obs: t.obs, tipo: t.tipo, encargado: t.enc,
    registrado_por: t.ra, aprobador: t.apr, prioridad: t.pri, estado: t.est,
    est_upd_at: isoODefecto(t.estUpdAt), registrada: t.reg, vence: t.vence,
    creado_en: isoODefecto(t.creadoEn), en_proceso_en: isoODefecto(t.enProcesoEn),
    finalizado_en: isoODefecto(t.finalizadoEn), aprobado_en: isoODefecto(t.aprobadoEn),
    comentarios: t.coms || []
  };
}

let _eventualTimers = {}; // debounce por id — varios comentarios/cambios seguidos a LA MISMA tarea no disparan guardados sueltos
async function guardarTareaEventualEnSupabase(id) {
  const t = DATA.tareasEve.find(t => t.id === id);
  if (!t) return;
  const { error } = await SB.from('tareas_eventuales').upsert({ id: t.id, ...filaEventual(t) });
  if (error) {
    console.error('Error guardando tarea eventual en Supabase:', error.message);
    actualizarIndicadorSync('offline');
    return;
  }
  actualizarIndicadorSync('synced');
}

function programarGuardadoEventual(id) {
  guardarLocal();
  clearTimeout(_eventualTimers[id]);
  _eventualTimers[id] = setTimeout(() => guardarTareaEventualEnSupabase(id), SAVE_DELAY);
}

async function eliminarEventualEnSupabase(id) {
  if (!esStaff()) return; // RLS: solo Staff puede borrar de verdad (eventuales_borrar)
  const { error } = await SB.from('tareas_eventuales').delete().eq('id', id);
  if (error) {
    console.error('Error eliminando tarea eventual en Supabase:', error.message);
    actualizarIndicadorSync('offline');
    return;
  }
  actualizarIndicadorSync('synced');
}

// ═══════════════════════════════════════════════════════════════
// GUARDADO QUIRÚRGICO — archivo de tareas (tareas_archivo)
// Archivar es, por naturaleza, una acción sobre VARIAS tareas a la vez (todas las Aprobadas del
// momento) — pero cada una se guarda como su propia fila individual: insertar en archivo +
// borrar de eventuales, tarea por tarea. Ninguna tarea que NO se estaba archivando se toca.
// Vaciar el archivo interno SÍ es un borrado total intencional (el usuario ya confirmó que
// respaldó todo en PDF) — no es "tocar algo que no cambió", es la acción explícita de esa fila.
// ═══════════════════════════════════════════════════════════════
async function archivarTareaEnSupabase(t) {
  if (!esStaff()) return;
  const row = {
    id: t.id, conjunto: t.conj, nombre: t.n, obs: t.obs, tipo: t.tipo, estado: t.est,
    creado_en: isoODefecto(t.creadoEn), finalizado_en: isoODefecto(t.finalizadoEn),
    aprobado_en: isoODefecto(t.aprobadoEn), comentarios: t.coms || [], archivado_en: t.archivedAt
  };
  const { error: errorInsert } = await SB.from('tareas_archivo').insert(row);
  if (errorInsert) {
    console.error('Error archivando tarea en Supabase:', errorInsert.message);
    actualizarIndicadorSync('offline');
    return;
  }
  const { error: errorDelete } = await SB.from('tareas_eventuales').delete().eq('id', t.id);
  if (errorDelete) {
    console.error('Error borrando tarea eventual archivada en Supabase:', errorDelete.message);
    actualizarIndicadorSync('offline');
    return;
  }
  actualizarIndicadorSync('synced');
}

async function vaciarArchivoEnSupabase() {
  if (!esStaff()) return;
  const { error } = await SB.from('tareas_archivo').delete().gt('id', ''); // borra todas las filas (todos los ids empiezan con "T-")
  if (error) {
    console.error('Error vaciando archivo en Supabase:', error.message);
    actualizarIndicadorSync('offline');
    return;
  }
  actualizarIndicadorSync('synced');
}

// ═══════════════════════════════════════════════════════════════
// GUARDADO QUIRÚRGICO — recurrentes: estado (checklist/fotos) y comentarios
// Marcar/desmarcar una casilla, adjuntar una foto, o comentar una tarea SOLO guarda esa fila
// puntual (conjunto+mes+tarea+repetición, o conjunto+tarea para comentarios) — ninguna otra
// casilla del mismo conjunto, ni de ningún otro conjunto, se toca. Los "slots vacíos" de una
// tarea/conjunto recién creado YA NO se pre-insertan en Supabase — se crean solos, con su
// primer valor real, la primera vez que alguien de verdad interactúa con esa casilla
// (ensureEstadoSlot/ensureRecComs ya los arman en memoria con default local mientras tanto).
// ═══════════════════════════════════════════════════════════════
function filaEstadoSlot(conjunto, mes, tareaIdx, slotIdx, slot) {
  return {
    conjunto, mes, tarea_idx: tareaIdx, slot_idx: slotIdx,
    done: !!slot.done, ts: slot.ts || null, ts_manual: slot.tsManual || null,
    has_foto: !!slot.hasFoto, foto_count: slot.fotoCount || null, undone_at: isoODefecto(slot.undoneAt)
  };
}

let _estadoSlotTimers = {};
async function guardarEstadoSlotEnSupabase(conjunto, mes, tareaIdx, slotIdx) {
  const slot = ESTADO[conjunto] && ESTADO[conjunto][mes] && ESTADO[conjunto][mes][tareaIdx] && ESTADO[conjunto][mes][tareaIdx][slotIdx];
  if (!slot) return;
  const { error } = await SB.from('recurrentes_estado')
    .upsert(filaEstadoSlot(conjunto, mes, tareaIdx, slotIdx, slot), { onConflict: 'conjunto,mes,tarea_idx,slot_idx' });
  if (error) {
    console.error('Error guardando estado recurrente en Supabase:', error.message);
    actualizarIndicadorSync('offline');
    return;
  }
  actualizarIndicadorSync('synced');
}

function programarGuardadoEstadoSlot(conjunto, mes, tareaIdx, slotIdx) {
  guardarLocal();
  const clave = `${conjunto}|${mes}|${tareaIdx}|${slotIdx}`;
  clearTimeout(_estadoSlotTimers[clave]);
  _estadoSlotTimers[clave] = setTimeout(() => guardarEstadoSlotEnSupabase(conjunto, mes, tareaIdx, slotIdx), SAVE_DELAY);
}

let _recComsRecTimers = {};
async function guardarComentariosRecurrenteEnSupabase(conjunto, tareaIdx) {
  const coms = (REC_COMS[conjunto] && REC_COMS[conjunto][tareaIdx]) || [];
  const { error } = await SB.from('recurrentes_comentarios')
    .upsert({ conjunto, tarea_idx: tareaIdx, comentarios: coms }, { onConflict: 'conjunto,tarea_idx' });
  if (error) {
    console.error('Error guardando comentarios recurrentes en Supabase:', error.message);
    actualizarIndicadorSync('offline');
    return;
  }
  actualizarIndicadorSync('synced');
}

function programarGuardadoComentariosRecurrente(conjunto, tareaIdx) {
  guardarLocal();
  const clave = `${conjunto}|${tareaIdx}`;
  clearTimeout(_recComsRecTimers[clave]);
  _recComsRecTimers[clave] = setTimeout(() => guardarComentariosRecurrenteEnSupabase(conjunto, tareaIdx), SAVE_DELAY);
}

// ═══════════════════════════════════════════════════════════════
// GUARDADO QUIRÚRGICO — evaluación manual (evaluacion_manual)
// Guardar el puntaje de un ítem o la asistencia de UN conjunto/mes solo toca esa fila puntual
// — ninguna evaluación de otro conjunto o de otro mes se reenvía.
// ═══════════════════════════════════════════════════════════════
let _evalManualTimers = {};
async function guardarEvalManualEnSupabase(conjunto, mes) {
  const ev = (EVAL_MANUAL[conjunto] && EVAL_MANUAL[conjunto][mes]) || { tareas: {}, cartera: '', asistencia: '' };
  const { error } = await SB.from('evaluacion_manual')
    .upsert({ conjunto, mes, tareas: ev.tareas || {}, cartera: ev.cartera || null, asistencia: ev.asistencia || null }, { onConflict: 'conjunto,mes' });
  if (error) {
    console.error('Error guardando evaluación manual en Supabase:', error.message);
    actualizarIndicadorSync('offline');
    return;
  }
  actualizarIndicadorSync('synced');
}

function programarGuardadoEvalManual(conjunto, mes) {
  guardarLocal();
  const clave = `${conjunto}|${mes}`;
  clearTimeout(_evalManualTimers[clave]);
  _evalManualTimers[clave] = setTimeout(() => guardarEvalManualEnSupabase(conjunto, mes), SAVE_DELAY);
}

// ═══════════════════════════════════════════════════════════════
// GUARDADO QUIRÚRGICO — fechas límite (fechas_limite, fechas_limite_global)
// ═══════════════════════════════════════════════════════════════
let _fechaLimiteTimers = {};
async function guardarFechaLimiteEnSupabase(conjunto, mes, tareaIdx) {
  const fecha = FECHAS_LIMITE_REC[conjunto] && FECHAS_LIMITE_REC[conjunto][mes] && FECHAS_LIMITE_REC[conjunto][mes][tareaIdx];
  const { error } = await SB.from('fechas_limite')
    .upsert({ conjunto, mes, tarea_idx: tareaIdx, fecha: fecha || null }, { onConflict: 'conjunto,mes,tarea_idx' });
  if (error) {
    console.error('Error guardando fecha límite en Supabase:', error.message);
    actualizarIndicadorSync('offline');
    return;
  }
  actualizarIndicadorSync('synced');
}

function programarGuardadoFechaLimite(conjunto, mes, tareaIdx) {
  guardarLocal();
  const clave = `${conjunto}|${mes}|${tareaIdx}`;
  clearTimeout(_fechaLimiteTimers[clave]);
  _fechaLimiteTimers[clave] = setTimeout(() => guardarFechaLimiteEnSupabase(conjunto, mes, tareaIdx), SAVE_DELAY);
}

let _fechaGlobalTimers = {};
async function guardarFechaLimiteGlobalEnSupabase(mes, tareaNombre) {
  if (!esStaff()) return;
  const fecha = FECHAS_LIMITE_REC_GLOBAL[mes] && FECHAS_LIMITE_REC_GLOBAL[mes][tareaNombre];
  const { error } = await SB.from('fechas_limite_global')
    .upsert({ mes, tarea_nombre: tareaNombre, fecha: fecha || null }, { onConflict: 'mes,tarea_nombre' });
  if (error) {
    console.error('Error guardando fecha límite global en Supabase:', error.message);
    actualizarIndicadorSync('offline');
    return;
  }
  actualizarIndicadorSync('synced');
}

function programarGuardadoFechaGlobal(mes, tareaNombre) {
  guardarLocal();
  const clave = `${mes}|${tareaNombre}`;
  clearTimeout(_fechaGlobalTimers[clave]);
  _fechaGlobalTimers[clave] = setTimeout(() => guardarFechaLimiteGlobalEnSupabase(mes, tareaNombre), SAVE_DELAY);
}

// ═══════════════════════════════════════════════════════════════
// GUARDADO QUIRÚRGICO — tareas A&V (tareas_av)
// id ya se genera en el cliente (AV-XXX) antes de guardar, igual que tareas eventuales — upsert
// sirve para crear y editar por igual.
// ═══════════════════════════════════════════════════════════════
function filaTareaAV(t) {
  return {
    nombre: t.n, obs: t.obs, tipo: t.tipo, encargado: t.enc, registrado_por: t.ra,
    prioridad: t.pri, estado: t.est, est_upd_at: isoODefecto(t.estUpdAt), vence: t.vence,
    creado_en: isoODefecto(t.creadoEn), en_proceso_en: isoODefecto(t.enProcesoEn),
    finalizado_en: isoODefecto(t.finalizadoEn), aprobado_en: isoODefecto(t.aprobadoEn),
    comentarios: t.coms || []
  };
}

async function guardarTareaAVEnSupabase(id) {
  const t = DATA.tareasAV.find(t => t.id === id);
  if (!t) return;
  const { error } = await SB.from('tareas_av').upsert({ id: t.id, ...filaTareaAV(t) });
  if (error) {
    console.error('Error guardando tarea A&V en Supabase:', error.message);
    actualizarIndicadorSync('offline');
    return;
  }
  actualizarIndicadorSync('synced');
}

// ═══════════════════════════════════════════════════════════════
// GUARDADO QUIRÚRGICO — eventos de calendario (eventos_calendario)
// id ya se genera en el cliente (EV-XXX) — upsert sirve para crear y editar por igual.
// ═══════════════════════════════════════════════════════════════
async function guardarEventoEnSupabase(id) {
  const e = DATA.eventosCalendario.find(e => e.id === id);
  if (!e) return;
  const row = {
    id: e.id, tipo: e.tipo, conjunto: e.conjunto, titulo: e.titulo, fecha: e.fecha, hora: e.hora,
    hora_fin: e.horaFin || null, modalidad: e.modalidad || null, lugar_tipo: e.lugarTipo || null, lugar_texto: e.lugarTexto || null,
    descripcion: e.descripcion, participantes: e.participantes || [], creado_por: e.creadoPor
  };
  const { error } = await SB.from('eventos_calendario').upsert(row);
  if (error) {
    console.error('Error guardando evento de calendario en Supabase:', error.message);
    actualizarIndicadorSync('offline');
    return;
  }
  actualizarIndicadorSync('synced');
}

async function eliminarEventoEnSupabase(id) {
  const { error } = await SB.from('eventos_calendario').delete().eq('id', id);
  if (error) {
    console.error('Error eliminando evento de calendario en Supabase:', error.message);
    actualizarIndicadorSync('offline');
    return;
  }
  actualizarIndicadorSync('synced');
}

// ═══════════════════════════════════════════════════════════════
// GUARDADO QUIRÚRGICO — horarios_delegados (turno semanal por conjunto/oficina)
// Solo Staff edita (Admin). Igual patrón que usuarios/catálogo: id autogenerado por Supabase,
// se guarda _supabaseId tras el primer insert para que las próximas ediciones usen update().
// ═══════════════════════════════════════════════════════════════
function filaHorario(h) {
  return {
    conjunto: h.conjunto, delegado: h.delegado, turno: h.turno,
    hora_entrada: h.hora_entrada || null, hora_salida: h.hora_salida || null,
    dias_atencion: h.dias_atencion || null, deleted: !!h.deleted
  };
}

async function guardarHorarioEnSupabase(idx) {
  if (!esStaff()) return;
  const h = DATA.horariosDelegados[idx];
  if (!h) return;
  if (h._supabaseId) {
    const { error } = await SB.from('horarios_delegados').update(filaHorario(h)).eq('id', h._supabaseId);
    if (error) { console.error('Error actualizando horario en Supabase:', error.message); actualizarIndicadorSync('offline'); return; }
  } else {
    const { data, error } = await SB.from('horarios_delegados').insert(filaHorario(h)).select('id').single();
    if (error) { console.error('Error insertando horario en Supabase:', error.message); actualizarIndicadorSync('offline'); return; }
    h._supabaseId = data.id;
  }
  actualizarIndicadorSync('synced');
}

async function eliminarHorarioEnSupabase(idx) {
  if (!esStaff()) return;
  const h = DATA.horariosDelegados[idx];
  if (!h || !h._supabaseId) return;
  const { error } = await SB.from('horarios_delegados').delete().eq('id', h._supabaseId);
  if (error) { console.error('Error eliminando horario en Supabase:', error.message); actualizarIndicadorSync('offline'); return; }
  actualizarIndicadorSync('synced');
}

// ═══════════════════════════════════════════════════════════════
// GUARDADO QUIRÚRGICO — sabados_libres (solicitud/aprobación de sábado libre)
// El delegado inserta su propia solicitud (RLS lo permite); solo Staff puede aprobar/rechazar
// (update) o borrar. Cada acción toca solo la fila puntual de esa solicitud.
// ═══════════════════════════════════════════════════════════════
// El estado se toma del objeto local (normalmente 'pendiente' al solicitar uno mismo, pero
// Staff puede insertarlo directo en 'aprobado' al asignar sábados masivos desde Admin)
async function solicitarSabadoLibreEnSupabase(idx) {
  const s = DATA.sabadosLibres[idx];
  if (!s) return;
  const { data, error } = await SB.from('sabados_libres')
    .insert({ delegado: s.delegado, fecha: s.fecha, estado: s.estado || 'pendiente', resuelto_por: s.resueltoPor || null })
    .select('id').single();
  if (error) { console.error('Error solicitando sábado libre en Supabase:', error.message); actualizarIndicadorSync('offline'); return; }
  s._supabaseId = data.id;
  actualizarIndicadorSync('synced');
}

async function resolverSabadoLibreEnSupabase(idx) {
  if (!esStaff()) return;
  const s = DATA.sabadosLibres[idx];
  if (!s || !s._supabaseId) return;
  const { error } = await SB.from('sabados_libres')
    .update({ estado: s.estado, resuelto_por: s.resueltoPor || null })
    .eq('id', s._supabaseId);
  if (error) { console.error('Error resolviendo sábado libre en Supabase:', error.message); actualizarIndicadorSync('offline'); return; }
  actualizarIndicadorSync('synced');
}

async function eliminarSabadoLibreEnSupabase(idx) {
  const s = DATA.sabadosLibres[idx];
  if (!s || !s._supabaseId) return;
  const { error } = await SB.from('sabados_libres').delete().eq('id', s._supabaseId);
  if (error) { console.error('Error eliminando sábado libre en Supabase:', error.message); actualizarIndicadorSync('offline'); return; }
  actualizarIndicadorSync('synced');
}

// ═══════════════════════════════════════════════════════════════
// GUARDADO QUIRÚRGICO — festivos (nombre fijo, año+fecha se cargan a mano en Admin)
// Solo Staff edita. Cada festivo es único por (anio, nombre) — upsert simple.
// ═══════════════════════════════════════════════════════════════
async function guardarFestivoEnSupabase(idx) {
  if (!esStaff()) return;
  const f = DATA.festivos[idx];
  if (!f) return;
  const { data, error } = await SB.from('festivos')
    .upsert({ anio: f.anio, nombre: f.nombre, fecha: f.fecha || null }, { onConflict: 'anio,nombre' })
    .select('id').single();
  if (error) { console.error('Error guardando festivo en Supabase:', error.message); actualizarIndicadorSync('offline'); return; }
  f._supabaseId = data.id;
  actualizarIndicadorSync('synced');
}

async function eliminarFestivoEnSupabase(idx) {
  if (!esStaff()) return;
  const f = DATA.festivos[idx];
  if (!f || !f._supabaseId) return;
  const { error } = await SB.from('festivos').delete().eq('id', f._supabaseId);
  if (error) { console.error('Error eliminando festivo en Supabase:', error.message); actualizarIndicadorSync('offline'); return; }
  actualizarIndicadorSync('synced');
}

// ═══════════════════════════════════════════════════════════════
// GUARDADO QUIRÚRGICO — vacaciones (solicitud/aprobación de rango de fechas)
// Mismo patrón que sabados_libres: el delegado inserta su propia solicitud, solo Staff aprueba/rechaza.
// ═══════════════════════════════════════════════════════════════
async function solicitarVacacionEnSupabase(idx) {
  const v = DATA.vacaciones[idx];
  if (!v) return;
  const { data, error } = await SB.from('vacaciones')
    .insert({ delegado: v.delegado, fecha_inicio: v.fechaInicio, fecha_fin: v.fechaFin, dias_habiles: v.diasHabiles, estado: 'pendiente' })
    .select('id').single();
  if (error) { console.error('Error solicitando vacación en Supabase:', error.message); actualizarIndicadorSync('offline'); return; }
  v._supabaseId = data.id;
  actualizarIndicadorSync('synced');
}

async function resolverVacacionEnSupabase(idx) {
  if (!esStaff()) return;
  const v = DATA.vacaciones[idx];
  if (!v || !v._supabaseId) return;
  const { error } = await SB.from('vacaciones')
    .update({ estado: v.estado, resuelto_por: v.resueltoPor || null })
    .eq('id', v._supabaseId);
  if (error) { console.error('Error resolviendo vacación en Supabase:', error.message); actualizarIndicadorSync('offline'); return; }
  actualizarIndicadorSync('synced');
}

// ═══════════════════════════════════════════════════════════════
// RESTAURAR BACKUP — reemplaza el restaurarBackup() viejo que escribía a Firebase (nodo muerto,
// nadie lo leía desde que los datos se migraron a Supabase — bug real, la restauración nunca
// llegaba a ningún lado). Es la ÚNICA excepción intencional al guardado quirúrgico: restaurar
// un backup es, por definición, reemplazar TODO — el usuario ya confirmó eso en el diálogo.
// ESTADO (checklist de recurrentes) se mantiene, igual que siempre (regla 6.4.4) — no se toca
// ni localmente ni en Supabase.
// ═══════════════════════════════════════════════════════════════
async function restaurarBackupEnSupabase(snap) {
  const resultados = [];

  if (esStaff()) {
    const conjuntosRows = [...(snap.conjuntos?.def || []), ...(snap.conjuntos?.pro || [])].map(c => ({
      nombre: c.n,
      tipo: (snap.conjuntos.def || []).includes(c) ? 'Definitivos' : 'Provisional (A&V)',
      delegado: c.del, color: c.c, eval: c.eval || {}, cartera: c.cartera || {}, deleted: !!c.deleted
    }));
    if (conjuntosRows.length) resultados.push(SB.from('conjuntos').upsert(conjuntosRows, { onConflict: 'nombre' }));

    const catalogoRows = (snap.tareasRec || []).filter(t => t._supabaseId).map(t => ({
      id: t._supabaseId, nombre: t.n, descripcion: t.desc, aplica: t.aplica, frecuencia: t.frec,
      veces: t.veces, cuando: t.cuando, limite: t.limite, bimestral: !!t.bimestral, foto: !!t.foto,
      fecha_variable: !!t.fechaVariable, fecha_individual: !!t.fechaIndividual,
      auto_eval: !!t.autoEval, eval_pts: t.evalPts, deleted: !!t.deleted
    }));
    if (catalogoRows.length) resultados.push(SB.from('tareas_recurrentes_catalogo').upsert(catalogoRows, { onConflict: 'id' }));

    const usuariosRows = (snap.usuarios || []).map((u, i) => {
      const cedula = Object.keys(snap.cedulas || {}).find(c => snap.cedulas[c].idx === i);
      return u._supabaseId && cedula
        ? { id: u._supabaseId, nombre: u.n, cedula, rol: u.rol, cargo: u.cargo || null, equipo: u.equipo || null,
            avatar: u.av || null, color: u.c || null, activo: snap.cedulas[cedula].activo !== false,
            fecha_ingreso: u.fechaIngreso || null, medio_tiempo: !!u.medioTiempo,
            fecha_vencimiento_contrato: u.fechaVencimientoContrato || null }
        : null;
    }).filter(Boolean);
    if (usuariosRows.length) resultados.push(SB.from('usuarios').upsert(usuariosRows, { onConflict: 'id' }));

    const horariosRows = (snap.horariosDelegados || []).filter(h => h._supabaseId).map(h => ({
      id: h._supabaseId, conjunto: h.conjunto, delegado: h.delegado, turno: h.turno,
      hora_entrada: h.hora_entrada || null, hora_salida: h.hora_salida || null,
      dias_atencion: h.dias_atencion || null, deleted: !!h.deleted
    }));
    if (horariosRows.length) resultados.push(SB.from('horarios_delegados').upsert(horariosRows, { onConflict: 'id' }));

    const festivosRows = (snap.festivos || []).map(f => ({ anio: f.anio, nombre: f.nombre, fecha: f.fecha || null }));
    if (festivosRows.length) resultados.push(SB.from('festivos').upsert(festivosRows, { onConflict: 'anio,nombre' }));
  }

  const sabadosRows = (snap.sabadosLibres || []).filter(s => s._supabaseId).map(s => ({
    id: s._supabaseId, delegado: s.delegado, fecha: s.fecha, estado: s.estado, resuelto_por: s.resueltoPor || null
  }));
  if (sabadosRows.length) resultados.push(SB.from('sabados_libres').upsert(sabadosRows, { onConflict: 'id' }));

  const vacacionesRows = (snap.vacaciones || []).filter(v => v._supabaseId).map(v => ({
    id: v._supabaseId, delegado: v.delegado, fecha_inicio: v.fechaInicio, fecha_fin: v.fechaFin,
    dias_habiles: v.diasHabiles, estado: v.estado, resuelto_por: v.resueltoPor || null
  }));
  if (vacacionesRows.length) resultados.push(SB.from('vacaciones').upsert(vacacionesRows, { onConflict: 'id' }));

  const tareasEveRows = (snap.tareasEve || []).map(t => ({
    id: t.id, conjunto: t.conj, nombre: t.n, obs: t.obs, tipo: t.tipo, encargado: t.enc,
    registrado_por: t.ra, aprobador: t.apr, prioridad: t.pri, estado: t.est,
    est_upd_at: isoODefecto(t.estUpdAt), registrada: t.reg, vence: t.vence,
    creado_en: isoODefecto(t.creadoEn), en_proceso_en: isoODefecto(t.enProcesoEn),
    finalizado_en: isoODefecto(t.finalizadoEn), aprobado_en: isoODefecto(t.aprobadoEn),
    comentarios: t.coms || []
  }));
  if (tareasEveRows.length) resultados.push(SB.from('tareas_eventuales').upsert(tareasEveRows));

  const tareasArchivoRows = (snap.tareasArchivo || []).map(t => ({
    id: t.id, conjunto: t.conj, nombre: t.n, obs: t.obs, tipo: t.tipo, estado: t.est,
    creado_en: isoODefecto(t.creadoEn), finalizado_en: isoODefecto(t.finalizadoEn),
    aprobado_en: isoODefecto(t.aprobadoEn), comentarios: t.coms || [], archivado_en: t.archivedAt
  }));
  if (tareasArchivoRows.length) resultados.push(SB.from('tareas_archivo').upsert(tareasArchivoRows));

  const comsRows = [];
  Object.entries(snap.recComs || {}).forEach(([conjunto, tareasObj]) => {
    Object.entries(tareasObj).forEach(([tareaIdx, coms]) => {
      if (coms && coms.length) comsRows.push({ conjunto, tarea_idx: parseInt(tareaIdx, 10), comentarios: coms });
    });
  });
  if (comsRows.length) resultados.push(SB.from('recurrentes_comentarios').upsert(comsRows, { onConflict: 'conjunto,tarea_idx' }));

  const evalRows = [];
  Object.entries(snap.evalManual || {}).forEach(([conjunto, meses]) => {
    Object.entries(meses).forEach(([mes, ev]) => {
      evalRows.push({ conjunto, mes, tareas: ev.tareas || {}, cartera: ev.cartera || null, asistencia: ev.asistencia || null });
    });
  });
  if (evalRows.length) resultados.push(SB.from('evaluacion_manual').upsert(evalRows, { onConflict: 'conjunto,mes' }));

  const fechasRows = [];
  Object.entries(snap.fechasLimiteRec || {}).forEach(([conjunto, meses]) => {
    Object.entries(meses).forEach(([mes, tareasObj]) => {
      Object.entries(tareasObj).forEach(([tareaIdx, fecha]) => {
        if (fecha) fechasRows.push({ conjunto, mes, tarea_idx: parseInt(tareaIdx, 10), fecha });
      });
    });
  });
  if (fechasRows.length) resultados.push(SB.from('fechas_limite').upsert(fechasRows, { onConflict: 'conjunto,mes,tarea_idx' }));

  const fechasGlobalRows = [];
  Object.entries(snap.fechasLimiteRecGlobal || {}).forEach(([mes, tareasObj]) => {
    Object.entries(tareasObj).forEach(([tareaNombre, fecha]) => {
      if (fecha) fechasGlobalRows.push({ mes, tarea_nombre: tareaNombre, fecha });
    });
  });
  if (fechasGlobalRows.length) resultados.push(SB.from('fechas_limite_global').upsert(fechasGlobalRows, { onConflict: 'mes,tarea_nombre' }));

  const avRows = (snap.tareasAV || []).map(t => ({ id: t.id, ...filaTareaAV(t) }));
  if (avRows.length) resultados.push(SB.from('tareas_av').upsert(avRows));

  const eventosRows = (snap.eventosCalendario || []).map(e => ({
    id: e.id, tipo: e.tipo, conjunto: e.conjunto, titulo: e.titulo, fecha: e.fecha, hora: e.hora,
    hora_fin: e.horaFin || null, modalidad: e.modalidad || null, lugar_tipo: e.lugarTipo || null, lugar_texto: e.lugarTexto || null,
    descripcion: e.descripcion, participantes: e.participantes || [], creado_por: e.creadoPor
  }));
  if (eventosRows.length) resultados.push(SB.from('eventos_calendario').upsert(eventosRows));

  const respuestas = await Promise.all(resultados);
  const errores = respuestas.filter(r => r && r.error);
  if (errores.length) {
    console.error('Errores restaurando backup en Supabase:', errores.map(e => e.error.message));
    actualizarIndicadorSync('offline');
    return { ok: false, errores };
  }
  actualizarIndicadorSync('synced');
  return { ok: true };
}

// Botón "↑ Sync" del header — con guardado quirúrgico ya no hace falta "empujar cambios
// pendientes" (cada acción se guarda sola al instante), así que ahora simplemente vuelve a
// traer todo desde Supabase (útil si alguien más cambió algo y quieres verlo ya, sin esperar).
async function forceSyncMerge() {
  actualizarIndicadorSync('syncing');
  const resultado = await cargarTodoDesdeSupabase();
  if (resultado.ok) {
    actualizarIndicadorSync('synced');
    if (typeof onDataChanged === 'function') onDataChanged();
    if (typeof toast === 'function') toast('☁️ Sincronizado');
  } else {
    actualizarIndicadorSync('offline');
    if (typeof toast === 'function') toast('⚠️ No se pudo sincronizar — revisa tu conexión');
  }
}

async function restaurarBackup(snap) {
  (snap.tareasEve || []).forEach(t => { t.estUpdAt = Date.now(); });
  aplicarSnapshotDirecto(snap); // ESTADO se mantiene, no se restaura desde backup (regla 6.4.4)
  guardarLocal();
  const resultado = await restaurarBackupEnSupabase(snap);
  if (resultado.ok) {
    if (typeof toast === 'function') toast('✓ Restaurado');
    if (typeof onDataChanged === 'function') onDataChanged();
  } else if (typeof toast === 'function') {
    toast('⚠️ Error restaurando en Supabase — revisa la consola');
  }
  return resultado;
}
