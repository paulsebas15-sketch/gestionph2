// auth.js — Login por cédula, sesión, control de acceso por rol
// GestiónPH v2.0
// Depende de: config.js, datos.js

let SESION_ACTUAL = null; // { cedula, idx, rol, nombre }

function iniciarSesion(cedula) {
  const registro = DATA.cedulas[cedula];
  if (!registro) {
    return { ok: false, error: 'Cédula no registrada. Contacta al administrador.' };
  }
  if (registro.activo === false) {
    return { ok: false, error: 'Acceso desactivado. Contacta al administrador.' };
  }
  const usuario = DATA.usuarios[registro.idx];
  if (!usuario) {
    return { ok: false, error: 'Usuario no encontrado. Contacta al administrador.' };
  }
  SESION_ACTUAL = {
    cedula,
    idx: registro.idx,
    rol: registro.rol,
    nombre: usuario.n
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(SESION_ACTUAL));
  autenticarEnSupabase(cedula);
  return { ok: true, sesion: SESION_ACTUAL };
}

// Autentica también en Supabase (en paralelo, sin bloquear el login actual sobre Firebase) —
// deja lista la sesión con permisos (RLS) para cuando la app lea/escriba de Supabase.
// Mientras dura la migración, un fallo aquí no impide entrar a la app (sigue funcionando con
// Firebase); solo se avisa en consola para poder revisarlo.
function autenticarEnSupabase(cedula) {
  if (typeof iniciarSesionSupabase !== 'function') return;
  iniciarSesionSupabase(cedula).then(r => {
    if (!r.ok) console.error('No se pudo autenticar en Supabase:', r.error);
  });
}

function cerrarSesion() {
  SESION_ACTUAL = null;
  localStorage.removeItem(SESSION_KEY);
  if (typeof SB !== 'undefined') SB.auth.signOut();
}

// Intenta recuperar una sesión válida guardada localmente (al recargar la app)
function recuperarSesion() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const sesion = JSON.parse(raw);
    // Revalidar contra el estado actual de datos (por si el usuario fue desactivado entretanto)
    const registro = DATA.cedulas[sesion.cedula];
    if (!registro || registro.activo === false) {
      cerrarSesion();
      return null;
    }
    SESION_ACTUAL = { ...sesion, rol: registro.rol, idx: registro.idx };
    // El cliente de Supabase ya persiste su propia sesión en localStorage y la recupera solo,
    // pero por si acaso expiró o nunca se estableció (versión vieja de la app), se reintenta.
    autenticarEnSupabase(sesion.cedula);
    return SESION_ACTUAL;
  } catch (e) {
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
