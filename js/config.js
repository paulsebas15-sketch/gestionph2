// config.js — Constantes globales, configuración Supabase, helpers de fecha
// GestiónPH v2.0 · A&V Victoria Pineda Administraciones

// ─── SUPABASE (único backend — datos y fotos) ──────────────────
// Solo la URL y la clave "publishable" (pública) — NUNCA la clave secreta, que da acceso total
// sin pasar por las reglas de seguridad (RLS). Esta clave pública sí es segura de tener aquí:
// su único poder es lo que las reglas RLS le permitan a cada usuario autenticado.
const SUPABASE_URL = 'https://lioabowqrqkwwmpbnhbc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zWJGwbGwyCkZAYF5iLYheg_JziQlXAt';
// Dominio ficticio usado para generar un correo por cédula (Supabase Auth requiere email) —
// invisible para el usuario, que sigue iniciando sesión solo con su cédula
const AUTH_EMAIL_DOMINIO = 'usuarios-gestionph.com';

const SUPABASE_FOTOS_BUCKET = 'recurrentes-fotos'; // bucket privado en Supabase Storage (RLS por conjunto)
const LIMITE_DATOS_MB = 500;    // 500MB — límite gratis de la base de datos de Supabase (plan Free)
const LIMITE_FOTOS_MB = 1024;   // 1GB — límite gratis de Storage en Supabase (plan Free)
const FOTO_MAX_ANCHO = 1600;    // px — ancho máximo al comprimir fotos antes de subir
const FOTO_CALIDAD = 0.7;       // calidad JPEG al comprimir (0-1)
const DATA_VERSION = 20260721;
const SAVE_DELAY = 600;                // ms debounce de guardado individual
const LOCAL_STORAGE_KEY = 'gestionph_v3';
const SESSION_KEY = 'gph_session';
const BACKUP_KEY = 'gph_lastBackup';

// ─── ESTADOS Y CLASIFICACIONES ──────────────────────────────
const ESTADOS_FINALES = ['Aprobado', 'Suspendido'];
// Incluye 'Pausado', confirmado en los datos reales de v1.0 (no documentado originalmente en el PRD)
const ESTADOS_EVENTUAL = ['Nuevo', 'En proceso', 'Pausado', 'Pendiente aprobación', 'Finalizado', 'Aprobado', 'Suspendido'];
const PRIORIDADES = ['Alta', 'Media', 'Baja'];
// Taxonomía real de v1.0 (normalizada: se unificaron variantes de tildes/plural detectadas en el backup,
// p.ej. "Cotizacion"/"Cotización" → "Cotización"). Las tareas ya migradas conservan su valor original
// aunque no esté en esta lista — esta lista solo aplica al crear tareas nuevas.
const TIPOS_EVENTUAL = [
  'Mantenimiento', 'Reparación', 'Insumo o mueble', 'Cotización', 'Trámite',
  'Arreglos internos', 'Asamblea/presupuesto', 'Cargador eléctrico', 'Charla',
  'Comunicado', 'Daño de ZC a propietario', 'Daño entre propietarios', 'Documento',
  'Email', 'Humedad cubiertas', 'Información', 'Llamada', 'Llamado de atención',
  'Pago', 'Proyecto/Asamblea', 'Reporte/PQR', 'Sugerencia', 'Trabajo'
];

// Días de plazo sugerido al crear tarea, según prioridad
const PLAZO_SUGERIDO_DIAS = { 'Alta': 7, 'Media': 15, 'Baja': 30 };

// Umbrales del semáforo (días hasta vencimiento)
const SEMAFORO_UMBRAL = { 'Alta': 7, 'Media': 5, 'Baja': 5 };

// Clasificación de evaluación
const EVAL_RANGOS = [
  { min: 90, label: 'Excelente', clase: 'nota-ex' },
  { min: 75, label: 'Bueno', clase: 'nota-bu' },
  { min: 60, label: 'Regular', clase: 'nota-re' },
  { min: 0, label: 'Deficiente', clase: 'nota-de' }
];

// ─── MESES ───────────────────────────────────────────────────
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
               'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_IMPARES = ['Enero', 'Marzo', 'Mayo', 'Julio', 'Septiembre', 'Noviembre'];

// Fecha desde la cual los plazos de vencimiento aplican (regla 6.3)
const PLAZOS_ACTIVOS_DESDE = { mes: 'Julio', anio: 2026 };
const MES_PRUEBA = 'Junio'; // sin penalización por fechas

// ─── HELPERS DE FECHA ────────────────────────────────────────

// Único helper para la regla bimestral (evita duplicar lógica en 4 lugares — ver PRD sección 6.6/9)
function esMesImpar(mes) {
  return MESES_IMPARES.includes(mes);
}

// Retorna true si el mes/año dado ya tiene plazos de vencimiento activos
function plazosActivos(mes) {
  if (mes === MES_PRUEBA) return false;
  const idxActual = MESES.indexOf(mes);
  const idxInicio = MESES.indexOf(PLAZOS_ACTIVOS_DESDE.mes);
  return idxActual >= idxInicio;
}

// Timestamp en formato "DD/MM/YYYY HH:MM" zona América/Bogotá
function tsCol() {
  const fmt = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: 'numeric', month: 'numeric', year: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false
  });
  const parts = fmt.formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value.padStart(2, '0');
  const anio = parts.find(p => p.type === 'year').value;
  return `${get('day')}/${get('month')}/${anio} ${get('hour')}:${get('minute')}`;
}

// Fecha corta "DD/MM" zona América/Bogotá
function fechaCortaCol(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', day: 'numeric', month: 'numeric'
  });
  const parts = fmt.formatToParts(date);
  const get = t => parts.find(p => p.type === t).value.padStart(2, '0');
  return `${get('day')}/${get('month')}`;
}

// Convierte "DD/MM" (año actual asumido) a objeto Date para comparaciones
function parseFechaCorta(ddmm, anio = new Date().getFullYear()) {
  if (!ddmm || ddmm === '–') return null;
  const [d, m] = ddmm.split('/').map(Number);
  return new Date(anio, m - 1, d);
}

// Convierte "YYYY-MM-DD" a Date local a medianoche (evita el corrimiento de un día que da
// `new Date(iso)` al interpretarlo como UTC) — usado para comparar fechas de eventos de Calendario
function fechaIsoADate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// "DD/MM" a partir de un ISO "YYYY-MM-DD", sin pasar por Date/timeZone (evita corrimientos)
function fechaCortaDesdeIso(iso) {
  if (!iso) return '–';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

// Nombre del mes (según MESES) a partir de una fecha ISO "YYYY-MM-DD" — usado por Calendario
function mesDeFechaIso(iso) {
  if (!iso) return null;
  const mesIdx = parseInt(iso.split('-')[1], 10) - 1;
  return MESES[mesIdx] || null;
}

// Convierte un timestamp "DD/MM/YYYY HH:MM" (formato de tsCol) de vuelta a Date — usado para
// comparar cuándo ocurrió un cambio/registro contra un rango de fechas (informes por día/semana)
function parseTsCol(ts) {
  if (!ts) return null;
  const [fecha, hora] = ts.split(' ');
  const [d, m, y] = (fecha || '').split('/').map(Number);
  const [hh, mm] = (hora || '0:0').split(':').map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

// Convierte "HH:MM" (24h, valor nativo de <input type="time">) a "H:MM AM/PM" para mostrar
function horaAMPM(hora24) {
  if (!hora24) return '';
  const [h, m] = hora24.split(':').map(Number);
  if (isNaN(h)) return hora24;
  const periodo = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m || 0).padStart(2, '0')} ${periodo}`;
}

// Date local -> "YYYY-MM-DD" / "DD/MM", sin pasar por timeZone (evita corrimientos de día)
function fechaDateAIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fechaCortaDesdeDate(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}`;
}

// Días hábiles = todo excepto sábado y domingo (sin calendario de festivos colombianos, por
// decisión del usuario — más simple de mantener, aunque ocasionalmente caiga en un festivo)
function esFinDeSemana(date) {
  const dia = date.getDay();
  return dia === 0 || dia === 6;
}

function sumarDiasHabiles(date, n) {
  const d = new Date(date);
  let restantes = n;
  while (restantes > 0) {
    d.setDate(d.getDate() + 1);
    if (!esFinDeSemana(d)) restantes--;
  }
  return d;
}

function restarDiasHabiles(date, n) {
  const d = new Date(date);
  let restantes = n;
  while (restantes > 0) {
    d.setDate(d.getDate() - 1);
    if (!esFinDeSemana(d)) restantes--;
  }
  return d;
}

// Semana ISO "YYYY-WNN" — usado para control de backup automático semanal
function semanaISO(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
