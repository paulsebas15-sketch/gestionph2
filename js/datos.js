// datos.js — Estructuras de datos en memoria y construcción del snapshot
// GestiónPH v2.0
// Depende de: config.js

// ─── ESTADO EN MEMORIA (fuente única de verdad en runtime) ──
const DATA = {
  conjuntos: { def: [], pro: [] },
  usuarios: [],
  cedulas: {},
  cedActivos: {},
  tareasRec: [],
  tareasEve: [],
  deletedEveIds: [],
  tareasArchivo: [],
  tareasAV: [],
  eventosCalendario: [],
  horariosDelegados: [],
  sabadosLibres: [],
  festivos: [],
  vacaciones: []
};

let ESTADO = {};       // ESTADO[conjunto][mes][tareaIdx][slotIdx] = { done, ts, tsManual, foto, undoneAt }
let REC_COMS = {};     // REC_COMS[conjunto][tareaIdx] = [comentarios...]
let EVAL_MANUAL = {};  // EVAL_MANUAL[conjunto][mes] = { tareas, cartera, asistencia }
// FECHAS_LIMITE_REC[conjunto][mes][tareaIdx] = "DD/MM" — fecha real por conjunto (usada solo
// por "Reunión de consejo de adm.", sincronizada automáticamente desde Calendario, ya que esa
// sí varía de un conjunto a otro).
let FECHAS_LIMITE_REC = {};
// FECHAS_LIMITE_REC_GLOBAL[mes][tareaNombre] = "DD/MM" — fecha ÚNICA compartida por TODOS los
// conjuntos (las 6 tareas con fechaVariable:true tienen la misma fecha límite sin importar el
// conjunto, ej. "día 10 de cada mes" aplica igual a los 11 — se fija una sola vez en Admin en
// vez de repetirlo conjunto por conjunto).
let FECHAS_LIMITE_REC_GLOBAL = {};

function getFechaLimiteRecGlobal(mes, tareaNombre) {
  return (FECHAS_LIMITE_REC_GLOBAL[mes] && FECHAS_LIMITE_REC_GLOBAL[mes][tareaNombre]) || null;
}

function setFechaLimiteRecGlobal(mes, tareaNombre, fechaCorta) {
  FECHAS_LIMITE_REC_GLOBAL[mes] = FECHAS_LIMITE_REC_GLOBAL[mes] || {};
  FECHAS_LIMITE_REC_GLOBAL[mes][tareaNombre] = fechaCorta;
}

// Fecha efectiva de una tarea recurrente para mostrar/comparar: global compartida si tiene
// fechaVariable:true (las 6 confirmadas), o la fecha por-conjunto sincronizada desde Calendario
// en caso contrario (hoy solo aplica a "Reunión de consejo de adm.").
function obtenerFechaTareaRec(conjunto, mes, tarea) {
  if (tarea.fechaVariable) return getFechaLimiteRecGlobal(mes, tarea.n);
  return getFechaLimiteRec(conjunto, mes, tarea._idx);
}

// ─── HELPERS DE ACCESO ───────────────────────────────────────

// Lista de todos los conjuntos activos (def + pro) como array plano de objetos.
// Los "eliminados" (soft-delete, ver admin.js eliminarConjunto) se excluyen para no
// perder su historial de evaluaciones/tareas, pero ya no aparecen en la app activa.
function todosLosConjuntos() {
  return [...(DATA.conjuntos.def || []), ...(DATA.conjuntos.pro || [])].filter(c => !c.deleted);
}

function conjuntoPorNombre(nombre) {
  return todosLosConjuntos().find(c => c.n === nombre);
}

// Conjuntos visibles para un usuario según su rol
function conjuntosVisibles(usuario) {
  if (!usuario) return [];
  if (usuario.rol === 'staff') return todosLosConjuntos().map(c => c.n);
  return usuario.conjuntos || [];
}

function usuarioPorNombre(nombre) {
  return DATA.usuarios.find(u => u.n === nombre);
}

function esMedioTiempo(nombreDelegado) {
  const u = usuarioPorNombre(nombreDelegado);
  return !!(u && u.medioTiempo);
}

// Años completos cumplidos desde la fecha de ingreso hasta hoy — cada uno otorga 15 días
// hábiles de vacaciones de una sola vez (regla elegida: "bloques al cumplir año", no proporcional)
function aniosCumplidos(fechaIngresoIso, hasta = new Date()) {
  if (!fechaIngresoIso) return 0;
  const ingreso = fechaIsoADate(fechaIngresoIso);
  if (!ingreso) return 0;
  let anios = hasta.getFullYear() - ingreso.getFullYear();
  const aniversarioEsteAnio = new Date(hasta.getFullYear(), ingreso.getMonth(), ingreso.getDate());
  if (hasta < aniversarioEsteAnio) anios--;
  return Math.max(0, anios);
}

// Días hábiles (lunes-viernes) dentro de un rango de fechas, ambos extremos incluidos
function diasHabilesEntre(fechaInicioIso, fechaFinIso) {
  const inicio = fechaIsoADate(fechaInicioIso);
  const fin = fechaIsoADate(fechaFinIso);
  if (!inicio || !fin || fin < inicio) return 0;
  let dias = 0;
  const d = new Date(inicio);
  while (d <= fin) {
    if (!esFinDeSemana(d)) dias++;
    d.setDate(d.getDate() + 1);
  }
  return dias;
}

// Saldo de vacaciones de un delegado: 15 días por cada año cumplido desde su ingreso, menos los
// días hábiles ya aprobados (sin tope de acumulación, por decisión del usuario)
function saldoVacaciones(nombreDelegado) {
  const u = usuarioPorNombre(nombreDelegado);
  const ganados = 15 * aniosCumplidos(u && u.fechaIngreso);
  const tomados = DATA.vacaciones
    .filter(v => v.delegado === nombreDelegado && v.estado === 'aprobado')
    .reduce((sum, v) => sum + (v.diasHabiles || 0), 0);
  return { ganados, tomados, disponible: ganados - tomados };
}

// Horarios (turnos semanales) de un delegado, sin contar "Oficina A&V" — usado para ubicarlo
// en un conjunto puntual un día/hora dado
function horariosDeDelegado(nombreDelegado) {
  return DATA.horariosDelegados.filter(h => !h.deleted && h.delegado === nombreDelegado);
}

// Un festivo colombiano cargado en Admin para ESE año — busca por fecha exacta "YYYY-MM-DD"
function festivoDeFecha(iso) {
  if (!iso) return null;
  return DATA.festivos.find(f => f.fecha === iso) || null;
}

function esFestivo(iso) {
  return !!festivoDeFecha(iso);
}

// Todos los turnos (conjunto u oficina) de un delegado que aplican un día de semana dado.
// Regla dura del negocio: domingo SIEMPRE vacío, sábado en la tarde SIEMPRE vacío, y cualquier
// festivo colombiano cargado en Admin también vacío para TODOS — sin importar lo que diga
// "dias_atencion" cargado en Admin (por error o dato viejo), nunca se muestra ni se cuenta un
// turno ahí. El parámetro iso es opcional (solo hace falta para chequear festivos).
function turnosDelDelegadoEnDia(nombreDelegado, nombreDia, iso) {
  if (nombreDia === 'domingo') return [];
  if (iso && esFestivo(iso)) return [];
  let turnos = horariosDeDelegado(nombreDelegado).filter(h => diasAtencionIncluye(h.dias_atencion, nombreDia));
  if (nombreDia === 'sabado') turnos = turnos.filter(h => horaSalidaPermiteSabado(h.hora_salida));
  return turnos;
}

// Sábados libres de un delegado, opcionalmente filtrados por mes ("Julio") y/o estado
function sabadosDeDelegado(nombreDelegado, mes, estado) {
  return DATA.sabadosLibres.filter(s =>
    s.delegado === nombreDelegado &&
    (!mes || mesDeFechaIso(s.fecha) === mes) &&
    (!estado || s.estado === estado)
  );
}

function tareaRecActiva(tarea, mes) {
  if (tarea.deleted) return false;
  if (tarea.bimestral && !esMesImpar(mes)) return false;
  return true;
}

// Tareas recurrentes aplicables a un conjunto (por tipo def/pro) y mes (por regla bimestral)
function tareasRecPara(conjuntoNombre, mes) {
  const c = conjuntoPorNombre(conjuntoNombre);
  if (!c) return [];
  const tipo = (DATA.conjuntos.def || []).includes(c) ? 'Definitivos' : 'Provisional (A&V)';
  return DATA.tareasRec
    .map((t, idx) => ({ ...t, _idx: idx }))
    .filter(t => tareaRecActiva(t, mes))
    .filter(t => t.aplica === 'Todos' || t.aplica === tipo);
}

function ensureEstadoSlot(conjunto, mes, tareaIdx, slotIdx = 0) {
  ESTADO[conjunto] = ESTADO[conjunto] || {};
  ESTADO[conjunto][mes] = ESTADO[conjunto][mes] || {};
  ESTADO[conjunto][mes][tareaIdx] = ESTADO[conjunto][mes][tareaIdx] || {};
  ESTADO[conjunto][mes][tareaIdx][slotIdx] = ESTADO[conjunto][mes][tareaIdx][slotIdx] || { done: false, ts: null, tsManual: null, foto: null };
  return ESTADO[conjunto][mes][tareaIdx][slotIdx];
}

function ensureRecComs(conjunto, tareaIdx) {
  REC_COMS[conjunto] = REC_COMS[conjunto] || {};
  REC_COMS[conjunto][tareaIdx] = REC_COMS[conjunto][tareaIdx] || [];
  return REC_COMS[conjunto][tareaIdx];
}

function getFechaLimiteRec(conjunto, mes, tareaIdx) {
  return (FECHAS_LIMITE_REC[conjunto] && FECHAS_LIMITE_REC[conjunto][mes] && FECHAS_LIMITE_REC[conjunto][mes][tareaIdx]) || null;
}

function setFechaLimiteRec(conjunto, mes, tareaIdx, fechaCorta) {
  FECHAS_LIMITE_REC[conjunto] = FECHAS_LIMITE_REC[conjunto] || {};
  FECHAS_LIMITE_REC[conjunto][mes] = FECHAS_LIMITE_REC[conjunto][mes] || {};
  FECHAS_LIMITE_REC[conjunto][mes][tareaIdx] = fechaCorta;
}

// Al crear una nueva tarea recurrente: inicializar slots vacíos para todos los conjuntos existentes.
// Crea un slot por cada repetición mensual (tarea.veces, por defecto 1).
function inicializarSlotsNuevaTareaRec(tareaIdx) {
  const tarea = DATA.tareasRec[tareaIdx];
  const veces = (tarea && tarea.veces) || 1;
  todosLosConjuntos().forEach(c => {
    MESES.forEach(mes => {
      for (let s = 0; s < veces; s++) ensureEstadoSlot(c.n, mes, tareaIdx, s);
    });
    ensureRecComs(c.n, tareaIdx);
  });
}

// ─── IDs DE TAREAS EVENTUALES ─────────────────────────────────
function siguienteIdEventual() {
  const nums = DATA.tareasEve
    .map(t => parseInt((t.id || '').replace('T-', ''), 10))
    .filter(n => !isNaN(n));
  const archivadas = DATA.tareasArchivo
    .map(t => parseInt((t.id || '').replace('T-', ''), 10))
    .filter(n => !isNaN(n));
  const max = Math.max(0, ...nums, ...archivadas);
  return `T-${String(max + 1).padStart(3, '0')}`;
}

function siguienteIdAV() {
  const nums = DATA.tareasAV
    .map(t => parseInt((t.id || '').replace('AV-', ''), 10))
    .filter(n => !isNaN(n));
  const max = Math.max(0, ...nums);
  return `AV-${String(max + 1).padStart(3, '0')}`;
}

function siguienteIdEvento() {
  const nums = DATA.eventosCalendario
    .map(e => parseInt((e.id || '').replace('EV-', ''), 10))
    .filter(n => !isNaN(n));
  const max = Math.max(0, ...nums);
  return `EV-${String(max + 1).padStart(3, '0')}`;
}

// ─── SNAPSHOT (para exportar/restaurar backup) ───────────────
function buildSnapshot() {
  return {
    ts: Date.now(),
    dataVersion: DATA_VERSION,
    conjuntos: DATA.conjuntos,
    usuarios: DATA.usuarios,
    cedulas: DATA.cedulas,
    cedActivos: DATA.cedActivos,
    tareasRec: DATA.tareasRec,
    estado: ESTADO,
    recComs: REC_COMS,
    tareasEve: DATA.tareasEve,
    deletedEveIds: DATA.deletedEveIds,
    tareasArchivo: DATA.tareasArchivo,
    tareasAV: DATA.tareasAV,
    evalManual: EVAL_MANUAL,
    fechasLimiteRec: FECHAS_LIMITE_REC,
    fechasLimiteRecGlobal: FECHAS_LIMITE_REC_GLOBAL,
    eventosCalendario: DATA.eventosCalendario,
    horariosDelegados: DATA.horariosDelegados,
    sabadosLibres: DATA.sabadosLibres,
    festivos: DATA.festivos,
    vacaciones: DATA.vacaciones
  };
}

// Aplica un snapshot completo al estado en memoria (usado por restore de backup, sección 6.4)
function aplicarSnapshotDirecto(snap) {
  DATA.conjuntos = snap.conjuntos || { def: [], pro: [] };
  DATA.usuarios = snap.usuarios || [];
  DATA.cedulas = snap.cedulas || {};
  DATA.cedActivos = snap.cedActivos || {};
  DATA.tareasRec = snap.tareasRec || [];
  DATA.tareasEve = snap.tareasEve || [];
  DATA.deletedEveIds = snap.deletedEveIds || [];
  DATA.tareasArchivo = snap.tareasArchivo || [];
  DATA.tareasAV = snap.tareasAV || [];
  DATA.eventosCalendario = snap.eventosCalendario || [];
  DATA.horariosDelegados = snap.horariosDelegados || [];
  DATA.sabadosLibres = snap.sabadosLibres || [];
  DATA.festivos = snap.festivos || [];
  DATA.vacaciones = snap.vacaciones || [];
  REC_COMS = snap.recComs || {};
  EVAL_MANUAL = snap.evalManual || {};
  FECHAS_LIMITE_REC = snap.fechasLimiteRec || {};
  FECHAS_LIMITE_REC_GLOBAL = snap.fechasLimiteRecGlobal || {};
  // ESTADO deliberadamente NO se restaura desde backup (regla 6.4.4) — se mantiene el ESTADO actual
}

// ─── PERSISTENCIA LOCAL ───────────────────────────────────────
// Si esto falla (ej. localStorage lleno) el progreso NO queda guardado — antes fallaba en
// silencio (solo console.error); ahora se avisa explícitamente para no perder trabajo sin
// que el usuario se entere.
function guardarLocal() {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(buildSnapshot()));
  } catch (e) {
    console.error('Error guardando en localStorage', e);
    if (typeof toast === 'function') toast('⚠️ No se pudo guardar localmente — revisa el espacio disponible del navegador', 6000);
  }
}

function cargarLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    aplicarSnapshotDesdeLocal(snap);
    return true;
  } catch (e) {
    console.error('Error leyendo localStorage', e);
    return false;
  }
}

// Igual que aplicarSnapshotDirecto pero SÍ carga ESTADO (arranque desde cero local, no es un "restore")
function aplicarSnapshotDesdeLocal(snap) {
  aplicarSnapshotDirecto(snap);
  ESTADO = snap.estado || {};
}
