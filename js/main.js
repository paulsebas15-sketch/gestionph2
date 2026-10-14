// app.js — Bootstrap de la aplicación: login, navegación, datos de ejemplo
// GestiónPH v2.0
// Se carga al final, después de todos los módulos

const RENDERERS_POR_PESTANA = {
  dashboard: renderDashboard,
  calendario: renderCalendario,
  recurrentes: renderRecurrentes,
  eventuales: renderEventuales,
  aprobaciones: renderAprobaciones,
  validaciones: renderValidaciones,
  evaluacion: renderEvaluacion,
  informes: renderInformes,
  analitica: renderAnalitica,
  tareasAV: renderTareasAV,
  admin: renderAdmin
};

// "Rendimiento" se fusionó dentro de "dashboard" (ahora etiquetado "Resumen") — ya no es
// pestaña propia, ver renderSeccionRendimiento() en rendimiento.js
const TITULOS_PESTANA = {
  dashboard: '📊 Resumen', calendario: '📅 Calendario', recurrentes: '✅ Recurrentes', eventuales: '📋 Eventuales',
  aprobaciones: '👍 Aprobaciones', validaciones: '☑️ Validaciones',
  evaluacion: '📝 Evaluación', informes: '📄 Informes', analitica: '📈 Analítica', tareasAV: '🗂 Tareas A&V', admin: '⚙️ Admin'
};

async function initApp() {
  cargarLocal();
  cargarFotosLocal();

  // Protección offline (ver actualizarIndicadorSync en supabase.js): si la sesión anterior se
  // cerró con algún cambio que no alcanzó a subir por falta de internet, avisar ANTES de traer
  // los datos del servidor — que están a punto de reemplazar lo que hay en memoria/local.
  if (localStorage.getItem(PENDIENTE_OFFLINE_KEY)) {
    alert('⚠️ La última vez que usaste GestiónPH hubo un cambio que no se pudo guardar por falta de conexión.\n\nAhora se va a cargar la información más reciente del servidor. Si hiciste algún cambio justo antes de cerrar sin internet, revisa que haya quedado guardado y repítelo si hace falta.');
    localStorage.removeItem(PENDIENTE_OFFLINE_KEY);
  }

  // Sin sesión ya no se carga nada: la tabla usuarios dejó de ser pública (exponía todas las
  // cédulas). Si este navegador conserva una sesión válida de Supabase, se retoma y ahí sí se
  // traen los datos con permisos; si no, pantalla de login (cédula + clave).
  const sesion = await recuperarSesion();
  if (sesion) mostrarApp();
  else mostrarLogin();
}

function mostrarLogin() {
  document.getElementById('pantalla-login').classList.remove('oculto');
  document.getElementById('pantalla-app').classList.add('oculto');
}

// Alterna entre "Iniciar sesión" (cédula + clave) y "Crear mi clave" (cédula + PIN + clave nueva)
function mostrarModoLogin(modo) {
  document.getElementById('login-modo-clave').classList.toggle('oculto', modo !== 'clave');
  document.getElementById('login-modo-pin').classList.toggle('oculto', modo !== 'pin');
  document.getElementById('login-error').classList.add('oculto');
  if (modo === 'pin') document.getElementById('input-pin-cedula').value = document.getElementById('input-cedula').value;
}

async function ejecutarLogin(btnId, textoBtn, accion) {
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById(btnId);
  errorEl.classList.add('oculto');
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  const resultado = await accion();
  btn.disabled = false;
  btn.textContent = textoBtn;
  if (!resultado.ok) {
    errorEl.textContent = resultado.error;
    errorEl.classList.remove('oculto');
    return;
  }
  document.getElementById('input-clave').value = '';
  ['input-pin', 'input-pin-clave', 'input-pin-clave2'].forEach(id => { document.getElementById(id).value = ''; });
  mostrarModoLogin('clave');
  mostrarApp();
}

function intentarLogin() {
  const cedula = document.getElementById('input-cedula').value.trim();
  const clave = document.getElementById('input-clave').value;
  ejecutarLogin('btn-login', 'Ingresar →', () => iniciarSesion(cedula, clave));
}

function intentarCrearClave() {
  const cedula = document.getElementById('input-pin-cedula').value.trim();
  const pin = document.getElementById('input-pin').value.trim();
  const clave = document.getElementById('input-pin-clave').value;
  const clave2 = document.getElementById('input-pin-clave2').value;
  const errorEl = document.getElementById('login-error');
  const mostrarError = msg => { errorEl.textContent = msg; errorEl.classList.remove('oculto'); };
  if (!cedula || !pin) return mostrarError('Escribe tu cédula y el PIN que te dio Staff.');
  if (clave.length < 6) return mostrarError('La clave debe tener al menos 6 caracteres.');
  if (clave !== clave2) return mostrarError('Las dos claves no coinciden.');
  ejecutarLogin('btn-crear-clave', 'Crear clave e ingresar →', () => crearClaveConPin(cedula, pin, clave));
}

async function salir() {
  await cerrarSesion();
  document.getElementById('input-cedula').value = '';
  document.getElementById('input-clave').value = '';
  mostrarLogin();
}

function mostrarApp() {
  document.getElementById('pantalla-login').classList.add('oculto');
  document.getElementById('pantalla-app').classList.remove('oculto');

  const usuario = usuarioActual();
  document.getElementById('hdr-avatar').textContent = iniciales(usuario.n);
  document.getElementById('hdr-nombre').textContent = usuario.n;

  poblarSelectMeses();
  poblarSelectConjuntos();
  poblarSelectsFormularioEventual();
  renderTabsNav();

  PESTANA_ACTUAL = pestanasVisibles()[0] || 'dashboard';
  renderPestanaActual();
  updBadge();
  cargarContadorFotos(); // barra de capacidad de fotos en Admin
  verificarBackupAutomatico(); // solo dispara para CEDULA_BACKUP_AUTOMATICO, una vez por semana
}

function iniciales(nombre) {
  return nombre.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

function poblarSelectMeses() {
  const sel = document.getElementById('sel-mes');
  const mesGuardado = localStorage.getItem('gph_mesSel');
  const mesActual = MESES[new Date().getMonth()];
  MES_SELECCIONADO = mesGuardado && MESES.includes(mesGuardado) ? mesGuardado : mesActual;
  sel.innerHTML = MESES.map(m => `<option ${m === MES_SELECCIONADO ? 'selected' : ''}>${m}</option>`).join('');
}

function poblarSelectConjuntos() {
  const sel = document.getElementById('sel-conjunto');
  const conjGuardado = localStorage.getItem('gph_conjSel');
  const disponibles = conjuntosVisibles(usuarioActual());
  // Igual que Staff: un delegado con 2+ conjuntos también puede elegir "Todos" en el header
  // (antes solo Staff lo tenía) — Calendario ya sabe mostrar solo lo suyo en ese caso.
  const puedeVerTodos = esStaff() || disponibles.length > 1;
  CONJUNTO_SELECCIONADO = conjGuardado && (disponibles.includes(conjGuardado) || (conjGuardado === 'Todos' && puedeVerTodos)) ? conjGuardado : (esStaff() ? 'Todos' : disponibles[0]);
  const opciones = puedeVerTodos ? ['Todos', ...disponibles] : disponibles;
  sel.innerHTML = opciones.map(n => `<option ${n === CONJUNTO_SELECCIONADO ? 'selected' : ''}>${n}</option>`).join('');
}

function poblarSelectsFormularioEventual() {
  document.getElementById('nueva-eve-tipo').innerHTML = TIPOS_EVENTUAL.map(t => `<option>${t}</option>`).join('');
  document.getElementById('nueva-eve-prioridad').innerHTML = PRIORIDADES.map(p => `<option ${p === 'Media' ? 'selected' : ''}>${p}</option>`).join('');
}

// Repuebla los selects del header y del formulario cuando cambian los conjuntos/usuarios
// (migración de backup, restore, alta/edición de conjunto) — evita que queden con la
// lista vieja renderizada solo una vez al iniciar sesión.
function refrescarSelectsHeader() {
  if (!SESION_ACTUAL) return;
  poblarSelectConjuntos();
  poblarSelectsFormularioEventual();
  renderTabsNav();
}

function renderTabsNav() {
  const cont = document.getElementById('tabs-nav');
  const pestanas = pestanasVisibles();
  cont.innerHTML = pestanas.map(p => `
    <div class="tab ${p === PESTANA_ACTUAL ? 'active' : ''}" onclick="cambiarPestana('${p}')">
      ${TITULOS_PESTANA[p]}
      ${p === 'recurrentes' ? '<span class="badge" id="badge-recurrentes"></span>' : ''}
      ${p === 'eventuales' ? '<span class="badge" id="badge-eventuales"></span>' : ''}
      ${p === 'aprobaciones' ? '<span class="badge" id="badge-aprobaciones"></span>' : ''}
      ${p === 'validaciones' ? '<span class="badge" id="badge-validaciones"></span>' : ''}
    </div>
  `).join('');
}

function renderPestanaActual() {
  Object.keys(RENDERERS_POR_PESTANA).forEach(p => {
    const el = document.getElementById(`content-${p}`);
    if (el) el.classList.toggle('oculto', p !== PESTANA_ACTUAL);
  });
  renderTabsNav();
  const render = RENDERERS_POR_PESTANA[PESTANA_ACTUAL];
  if (render) render();
}

function onDataChanged() {
  renderPestanaActual();
  updBadge();
}

function buscarGlobal(texto) {
  FILTROS_EVENTUALES.busqueda = texto;
  if (PESTANA_ACTUAL !== 'eventuales') cambiarPestana('eventuales');
  else { tomarSnapshotEventuales(); renderEventuales(); }
}

// Logo precargado como base64 para poder incrustarlo en el PDF de informes (jsPDF necesita
// la imagen ya en base64, no puede leer el archivo directamente)
let LOGO_BASE64 = null;
function precargarLogo() {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    try {
      LOGO_BASE64 = canvas.toDataURL('image/png');
    } catch (e) {
      console.error('No se pudo convertir el logo a base64', e);
    }
  };
  img.onerror = () => console.error('No se encontró assets/logo.png');
  img.src = 'assets/logo.png';
}

// Enter en los campos de login también envía el formulario correspondiente
document.addEventListener('DOMContentLoaded', () => {
  ['input-cedula', 'input-clave'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') intentarLogin(); });
  });
  ['input-pin-cedula', 'input-pin', 'input-pin-clave', 'input-pin-clave2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') intentarCrearClave(); });
  });
  initApp();
  precargarLogo();
});
