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
