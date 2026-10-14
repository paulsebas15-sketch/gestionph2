// auth.js — Login por cédula + clave, sesión, control de acceso por rol
// GestiónPH v2.0
// Depende de: config.js, datos.js, supabase.js

let SESION_ACTUAL = null; // { cedula, idx, rol, nombre }

// Con la sesión de Supabase ya abierta: trae los datos (ahora sí con permisos) y valida que la
// cédula exista y esté activa. La tabla usuarios ya no se puede leer sin sesión, así que esta
// validación solo es posible DESPUÉS de autenticar.
async function abrirSesionApp(cedula) {
  const carga = await cargarTodoDesdeSupabase();
  if (!carga.ok) console.error('No se pudieron cargar los datos de Supabase:', carga.error);
  const registro = DATA.cedulas[cedula];
  const usuario = registro ? DATA.usuarios[registro.idx] : null;
  if (!registro || !usuario || registro.activo === false) {
    await cerrarSesion();
    return { ok: false, error: 'Acceso desactivado. Contacta al administrador.' };
  }
  SESION_ACTUAL = { cedula, idx: registro.idx, rol: registro.rol, nombre: usuario.n };
  localStorage.setItem(SESSION_KEY, JSON.stringify(SESION_ACTUAL));
  return { ok: true, sesion: SESION_ACTUAL };
}

// Login normal: cédula + la clave que la persona creó con su PIN. Si falla, mensaje genérico
// (no se dice si lo incorrecto fue la cédula o la clave).
async function iniciarSesion(cedula, clave) {
  if (!cedula || !clave) return { ok: false, error: 'Escribe tu cédula y tu clave.' };
  const login = await iniciarSesionSupabase(cedula, clave);
  if (!login.ok) {
    console.error('Login fallido:', login.error);
    return { ok: false, error: 'Cédula o clave incorrecta. Si no tienes clave o la olvidaste, pide un PIN a Staff.' };
  }
  return abrirSesionApp(cedula);
}

const MENSAJES_PIN = {
  clave_corta: 'La clave debe tener al menos 6 caracteres.',
  pin_incorrecto: 'Cédula o PIN incorrecto.',
  pin_invalido: 'Ese PIN ya venció, ya se usó o se bloqueó por intentos fallidos. Pide uno nuevo a Staff.',
  error: 'No se pudo completar. Revisa tu conexión e inténtalo de nuevo.'
};

// Primer ingreso / clave olvidada: cédula + PIN temporal + clave nueva → queda logueado.
async function crearClaveConPin(cedula, pin, nuevaClave) {
  const res = await canjearPinSupabase(cedula, pin, nuevaClave);
  if (!res.ok) {
    if (res.detalle) console.error('Canje de PIN fallido:', res.detalle);
    return { ok: false, error: MENSAJES_PIN[res.codigo] || MENSAJES_PIN.error };
  }
  return iniciarSesion(cedula, nuevaClave);
}

async function cerrarSesion() {
  SESION_ACTUAL = null;
  localStorage.removeItem(SESSION_KEY);
  if (typeof SB !== 'undefined') await SB.auth.signOut();
}

// Al recargar la app: si Supabase todavía tiene una sesión válida guardada en este navegador,
// se retoma sin pedir clave de nuevo (y se revalida que el usuario siga activo).
async function recuperarSesion() {
  try {
    const { data } = await SB.auth.getSession();
    const email = data && data.session && data.session.user && data.session.user.email;
    if (!email) { localStorage.removeItem(SESSION_KEY); return null; }
    const cedula = email.split('@')[0];
    const res = await abrirSesionApp(cedula);
    return res.ok ? SESION_ACTUAL : null;
  } catch (e) {
    console.error('No se pudo recuperar la sesión:', e);
    return null;
  }
}

function usuarioActual() {
  if (!SESION_ACTUAL) return null;
  return DATA.usuarios[SESION_ACTUAL.idx];
}

function esStaff() {
  return SESION_ACTUAL && SESION_ACTUAL.rol === 'staff';
}

function esDelegado() {
  return SESION_ACTUAL && SESION_ACTUAL.rol === 'delegado';
}

// La sesión actual opera como delegado (rol Delegado, o Staff con "También es delegado") —
// para lo propio de un delegado: mis sábados, mis vacaciones, solicitar sábado.
function sesionEsDelegadoOperativo() {
  return esDelegadoOperativo(usuarioActual());
}

// Control de acceso por pestaña (tabla sección 5.3)
// Validaciones es exclusivo de Staff/Admin (el delegado ya no la ve, ni siquiera para sus
// propios conjuntos)
const PESTANAS_POR_ROL = {
  staff: ['dashboard', 'calendario', 'recurrentes', 'eventuales', 'aprobaciones', 'validaciones', 'evaluacion', 'informes', 'analitica', 'tareasAV', 'admin'],
  delegado: ['dashboard', 'calendario', 'recurrentes', 'eventuales', 'informes', 'analitica']
};

function pestanasVisibles() {
  if (!SESION_ACTUAL) return [];
  return PESTANAS_POR_ROL[SESION_ACTUAL.rol] || [];
}

function tienePermiso(pestana) {
  return pestanasVisibles().includes(pestana);
}

// Un delegado solo puede operar sobre tareas/validaciones de sus propios conjuntos
function puedeVerConjunto(nombreConjunto) {
  if (esStaff()) return true;
  const usuario = usuarioActual();
  return usuario && (usuario.conjuntos || []).includes(nombreConjunto);
}
