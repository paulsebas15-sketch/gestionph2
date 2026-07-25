// supabase.js — Cliente Supabase y autenticación por cédula
// GestiónPH v2.0
// Depende de: config.js
// Reemplaza gradualmente a firebase.js — mientras dura la migración, ambos pueden coexistir.

const SB = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

// ─── PROVISIÓN ÚNICA: crear las cuentas de Auth para los 11 usuarios ya migrados ──
// Se ejecuta UNA sola vez desde Admin. Después de correrla, hay que vincular auth_id en
// Supabase (ver la consulta SQL que se genera al final) para que las reglas de seguridad
// sepan qué conjuntos administra cada cuenta.
async function provisionarUsuariosSupabase() {
  const { data: usuarios, error } = await SB.from('usuarios').select('cedula, nombre');
  if (error) { toast('Error leyendo usuarios: ' + error.message); return; }

  let creadas = 0;
  let yaExistian = 0;
  let fallidas = [];

  for (const u of usuarios) {
    const email = emailDeCedula(u.cedula);
    const password = claveDeCedula(u.cedula);
    const { error: signUpError } = await SB.auth.signUp({ email, password });
    if (!signUpError) {
      creadas++;
    } else if (signUpError.message && signUpError.message.toLowerCase().includes('already registered')) {
      yaExistian++;
    } else {
      fallidas.push(`${u.nombre} (${u.cedula}): ${signUpError.message}`);
    }
    await SB.auth.signOut(); // signUp deja sesión iniciada como ese usuario — cerrar antes del siguiente
  }

  const sqlVinculo = `update usuarios u set auth_id = a.id from auth.users a where a.email = u.cedula || '@${AUTH_EMAIL_DOMINIO}' and u.auth_id is null;`;

  alert(
    `Provisión terminada.\nCreadas: ${creadas}\nYa existían: ${yaExistian}\nFallidas: ${fallidas.length}${fallidas.length ? '\n\n' + fallidas.join('\n') : ''}\n\n` +
    `AHORA corre esto UNA vez en el SQL Editor de Supabase para vincular las cuentas:\n\n${sqlVinculo}`
  );
  console.log('SQL para vincular auth_id:', sqlVinculo);
}

// ═══════════════════════════════════════════════════════════════
// CARGA: trae todo lo que la sesión actual tiene permitido ver (RLS ya filtra por conjunto)
// y arma exactamente el mismo "snapshot" que antes armaba Firebase — así el resto de la app
// (eventuales.js, recurrentes.js, admin.js, etc.) no necesita cambiar NADA, sigue leyendo
// DATA/ESTADO/REC_COMS/EVAL_MANUAL/FECHAS_LIMITE_REC como siempre.
// ═══════════════════════════════════════════════════════════════
function tsMs(iso) { return iso ? new Date(iso).getTime() : undefined; }

async function cargarTodoDesdeSupabase() {
  const [
    conjuntosRes, usuariosRes, delegadoConjRes, catalogoRes,
    eventualesRes, archivoRes, estadoRes, comsRes, evalRes,
    fechasRes, fechasGlobalRes, avRes, eventosRes
  ] = await Promise.all([
    SB.from('conjuntos').select('*'),
    SB.from('usuarios').select('*'),
    SB.from('delegado_conjuntos').select('*'),
    SB.from('tareas_recurrentes_catalogo').select('*').order('id'),
    SB.from('tareas_eventuales').select('*'),
    SB.from('tareas_archivo').select('*'),
    SB.from('recurrentes_estado').select('*'),
    SB.from('recurrentes_comentarios').select('*'),
    SB.from('evaluacion_manual').select('*'),
    SB.from('fechas_limite').select('*'),
    SB.from('fechas_limite_global').select('*'),
    SB.from('tareas_av').select('*'),
    SB.from('eventos_calendario').select('*')
  ]);

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
    conjuntos: conjPorUsuario[u.id] || [], activo: u.activo, _supabaseId: u.id
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

  const tareasAV = (avRes.data || []).map(t => ({ id: t.id, n: t.nombre, est: t.estado, vence: t.vence }));

  const eventosCalendario = (eventosRes.data || []).map(e => ({
    id: e.id, tipo: e.tipo, conjunto: e.conjunto, titulo: e.titulo, fecha: e.fecha, hora: e.hora,
    descripcion: e.descripcion, participantes: e.participantes || [], creadoPor: e.creado_por
  }));

  const snap = {
    conjuntos, usuarios, cedulas, cedActivos, tareasRec, tareasEve,
    deletedEveIds: [], tareasArchivo, tareasAV, eventosCalendario,
    estado, recComs, evalManual, fechasLimiteRec, fechasLimiteRecGlobal
  };
  aplicarSnapshotDesdeLocal(snap);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════
// GUARDADO: empuja lo que hay en memoria de vuelta a Supabase, tabla por tabla. RLS rechaza
// solo cualquier fila fuera del alcance del usuario actual (protección real, no solo de la app).
// ═══════════════════════════════════════════════════════════════
function isoODefecto(ms) { return ms ? new Date(ms).toISOString() : null; }

async function guardarTodoEnSupabase() {
  const snap = buildSnapshot();
  const tareas = [];

  const tareasEveRows = snap.tareasEve.map(t => ({
    id: t.id, conjunto: t.conj, nombre: t.n, obs: t.obs, tipo: t.tipo, encargado: t.enc,
    registrado_por: t.ra, aprobador: t.apr, prioridad: t.pri, estado: t.est,
    est_upd_at: isoODefecto(t.estUpdAt), registrada: t.reg, vence: t.vence,
    creado_en: isoODefecto(t.creadoEn), en_proceso_en: isoODefecto(t.enProcesoEn),
    finalizado_en: isoODefecto(t.finalizadoEn), aprobado_en: isoODefecto(t.aprobadoEn),
    comentarios: t.coms || []
  }));
  if (tareasEveRows.length) tareas.push(SB.from('tareas_eventuales').upsert(tareasEveRows));

  const tareasArchivoRows = snap.tareasArchivo.map(t => ({
    id: t.id, conjunto: t.conj, nombre: t.n, obs: t.obs, tipo: t.tipo, estado: t.est,
    creado_en: isoODefecto(t.creadoEn), finalizado_en: isoODefecto(t.finalizadoEn),
    aprobado_en: isoODefecto(t.aprobadoEn), comentarios: t.coms || [], archivado_en: t.archivedAt
  }));
  if (tareasArchivoRows.length) tareas.push(SB.from('tareas_archivo').upsert(tareasArchivoRows));

  const estadoRows = [];
  Object.entries(snap.estado).forEach(([conjunto, meses]) => {
    Object.entries(meses).forEach(([mes, tareasObj]) => {
      Object.entries(tareasObj).forEach(([tareaIdx, slots]) => {
        Object.entries(slots).forEach(([slotIdx, slot]) => {
          estadoRows.push({
            conjunto, mes, tarea_idx: parseInt(tareaIdx, 10), slot_idx: parseInt(slotIdx, 10),
            done: !!slot.done, ts: slot.ts || null, ts_manual: slot.tsManual || null,
            has_foto: !!slot.hasFoto, foto_count: slot.fotoCount || null, undone_at: isoODefecto(slot.undoneAt)
          });
        });
      });
    });
  });
  if (estadoRows.length) tareas.push(SB.from('recurrentes_estado').upsert(estadoRows, { onConflict: 'conjunto,mes,tarea_idx,slot_idx' }));

  const comsRows = [];
  Object.entries(snap.recComs).forEach(([conjunto, tareasObj]) => {
    Object.entries(tareasObj).forEach(([tareaIdx, coms]) => {
      if (coms && coms.length) comsRows.push({ conjunto, tarea_idx: parseInt(tareaIdx, 10), comentarios: coms });
    });
  });
  if (comsRows.length) tareas.push(SB.from('recurrentes_comentarios').upsert(comsRows, { onConflict: 'conjunto,tarea_idx' }));

  const evalRows = [];
  Object.entries(snap.evalManual).forEach(([conjunto, meses]) => {
    Object.entries(meses).forEach(([mes, ev]) => {
      evalRows.push({ conjunto, mes, tareas: ev.tareas || {}, cartera: ev.cartera || null, asistencia: ev.asistencia || null });
    });
  });
  if (evalRows.length) tareas.push(SB.from('evaluacion_manual').upsert(evalRows, { onConflict: 'conjunto,mes' }));

  const fechasRows = [];
  Object.entries(snap.fechasLimiteRec).forEach(([conjunto, meses]) => {
    Object.entries(meses).forEach(([mes, tareasObj]) => {
      Object.entries(tareasObj).forEach(([tareaIdx, fecha]) => {
        if (fecha) fechasRows.push({ conjunto, mes, tarea_idx: parseInt(tareaIdx, 10), fecha });
      });
    });
  });
  if (fechasRows.length) tareas.push(SB.from('fechas_limite').upsert(fechasRows, { onConflict: 'conjunto,mes,tarea_idx' }));

  const fechasGlobalRows = [];
  Object.entries(snap.fechasLimiteRecGlobal).forEach(([mes, tareasObj]) => {
    Object.entries(tareasObj).forEach(([tareaNombre, fecha]) => {
      if (fecha) fechasGlobalRows.push({ mes, tarea_nombre: tareaNombre, fecha });
    });
  });
  if (fechasGlobalRows.length) tareas.push(SB.from('fechas_limite_global').upsert(fechasGlobalRows, { onConflict: 'mes,tarea_nombre' }));

  const avRows = snap.tareasAV.map(t => ({ id: t.id, nombre: t.n, estado: t.est, vence: t.vence }));
  if (avRows.length) tareas.push(SB.from('tareas_av').upsert(avRows));

  const eventosRows = snap.eventosCalendario.map(e => ({
    id: e.id, tipo: e.tipo, conjunto: e.conjunto, titulo: e.titulo, fecha: e.fecha, hora: e.hora,
    descripcion: e.descripcion, participantes: e.participantes || [], creado_por: e.creadoPor
  }));
  if (eventosRows.length) tareas.push(SB.from('eventos_calendario').upsert(eventosRows));

  // Catálogo/conjuntos: cambian rara vez y solo Staff puede escribirlos (RLS) — se omiten para
  // delegados, evita llamadas que sabemos de antemano que la base va a rechazar
  if (esStaff()) {
    const conjuntosRows = todosLosConjuntos().map(c => ({
      nombre: c.n,
      tipo: (DATA.conjuntos.def || []).includes(c) ? 'Definitivos' : 'Provisional (A&V)',
      delegado: c.del, color: c.c, eval: c.eval || {}, cartera: c.cartera || {}, deleted: !!c.deleted
    }));
    if (conjuntosRows.length) tareas.push(SB.from('conjuntos').upsert(conjuntosRows, { onConflict: 'nombre' }));

    // Solo se actualizan las tareas del catálogo que ya existen en Supabase (traen _supabaseId).
    // Las creadas nuevas desde Admin en esta sesión aún no tienen ese id — quedan pendientes de
    // un ajuste futuro para insertarlas correctamente con su id nuevo.
    const catalogoRows = DATA.tareasRec.filter(t => t._supabaseId).map(t => ({
      id: t._supabaseId, nombre: t.n, descripcion: t.desc, aplica: t.aplica, frecuencia: t.frec,
      veces: t.veces, cuando: t.cuando, limite: t.limite, bimestral: !!t.bimestral, foto: !!t.foto,
      fecha_variable: !!t.fechaVariable, fecha_individual: !!t.fechaIndividual,
      auto_eval: !!t.autoEval, eval_pts: t.evalPts, deleted: !!t.deleted
    }));
    if (catalogoRows.length) tareas.push(SB.from('tareas_recurrentes_catalogo').upsert(catalogoRows, { onConflict: 'id' }));
  }

  const resultados = await Promise.all(tareas);
  const errores = resultados.filter(r => r && r.error);
  if (errores.length) {
    console.error('Errores guardando en Supabase:', errores.map(e => e.error.message));
    if (typeof actualizarIndicadorSync === 'function') actualizarIndicadorSync('offline');
    return { ok: false, errores };
  }
  if (typeof actualizarIndicadorSync === 'function') actualizarIndicadorSync('synced');
  return { ok: true };
}

// Reemplaza el autoguardado de Firebase: guarda local al instante (para que no se pierda nada
// si se cierra el navegador), y sube a Supabase con el mismo debounce de siempre.
let _supabaseSaveTimer = null;
function programarAutoSave() {
  guardarLocal();
  clearTimeout(_supabaseSaveTimer);
  _supabaseSaveTimer = setTimeout(guardarTodoEnSupabase, SAVE_DELAY);
}
