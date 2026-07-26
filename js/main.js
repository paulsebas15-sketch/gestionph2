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

  // Conjuntos/usuarios/cédulas son de lectura pública (RLS los deja ver sin sesión) — se cargan
  // ya mismo para poder validar la cédula en el login. Las tablas protegidas por conjunto
  // (tareasEve, ESTADO, etc.) llegan vacías por ahora — RLS las filtra hasta que haya sesión.
  const cargaInicial = await cargarTodoDesdeSupabase();
  if (!cargaInicial.ok || !DATA.usuarios.length) {
    poblarDatosEjemploSiVacio(); // sin internet / Supabase caído — usar datos mínimos de ejemplo
  }

  const sesion = recuperarSesion();
  if (sesion) {
    await autenticarEnSupabase(sesion.cedula); // ahora sí trae los datos reales con permisos
    mostrarApp();
  } else {
    mostrarLogin();
  }
}

function poblarDatosEjemploSiVacio() {
  if (DATA.usuarios.length > 0) return;
  // Datos mínimos de ejemplo para poder operar la app antes de migrar los datos reales
  DATA.conjuntos = {
    def: [{ n: 'Arboleda Cañasgordas', del: 'Camila García', c: '#4a7c59', eval: {} }],
    pro: [{ n: 'Camelias', del: 'Juan Diego', c: '#7c4a4a', eval: {} }]
  };
  DATA.usuarios = [
    { n: 'Paul Molina', rol: 'staff', conjuntos: [], cargo: 'Director de Procesos', equipo: 'Ambos', av: 'PM', c: '#2d6a4f', ra: 'paul' },
    { n: 'Camila García', rol: 'delegado', conjuntos: ['Arboleda Cañasgordas'], cargo: 'Delegada', equipo: 'Definitivos', av: 'CG', c: '#7a5c2e', ra: 'camila' },
    { n: 'Juan Diego', rol: 'delegado', conjuntos: ['Camelias'], cargo: 'Delegado A&V', equipo: 'Provisional (A&V)', av: 'JD', c: '#5a7a6a', ra: 'juandiego' }
  ];
  DATA.cedulas = {
    '1234567890': { idx: 0, rol: 'staff', activo: true },
    '0987654321': { idx: 1, rol: 'delegado', activo: true },
    '1111111111': { idx: 2, rol: 'delegado', activo: true }
  };
  DATA.tareasRec = [
    { n: 'Revisión planta eléctrica', desc: 'Verificar nivel de aceite y batería', aplica: 'Definitivos', frec: 'mensual', veces: 1, cuando: '', limite: '', bimestral: false, foto: false, autoEval: true, evalPts: 1, deleted: false },
    { n: 'Pago reteica', desc: 'Pago bimestral impuesto', aplica: 'Todos', frec: 'mensual', veces: 1, cuando: '', limite: '', bimestral: true, foto: false, autoEval: true, evalPts: 1, deleted: false }
  ];
  DATA.tareasEve = [];
  guardarLocal();
}

function mostrarLogin() {
  document.getElementById('pantalla-login').classList.remove('oculto');
  document.getElementById('pantalla-app').classList.add('oculto');
}

async function intentarLogin() {
  const cedula = document.getElementById('input-cedula').value.trim();
  const errorEl = document.getElementById('login-error');
  const btn = document.querySelector('.login-card .btn-v');

  const resultado = iniciarSesion(cedula);
  if (!resultado.ok) {
    errorEl.textContent = resultado.error;
    errorEl.classList.remove('oculto');
    return;
  }
  errorEl.classList.add('oculto');

  if (btn) { btn.disabled = true; btn.textContent = 'Entrando…'; }
  await autenticarEnSupabase(cedula);
  if (btn) { btn.disabled = false; btn.textContent = 'Ingresar →'; }
  mostrarApp();
}

function salir() {
  cerrarSesion();
  document.getElementById('input-cedula').value = '';
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
  CONJUNTO_SELECCIONADO = conjGuardado && (disponibles.includes(conjGuardado) || conjGuardado === 'Todos') ? conjGuardado : (esStaff() ? 'Todos' : disponibles[0]);
  const opciones = esStaff() ? ['Todos', ...disponibles] : disponibles;
  sel.innerHTML = opciones.map(n => `<option ${n === CONJUNTO_SELECCIONADO ? 'selected' : ''}>${n}</option>`).join('');
}

function poblarSelectsFormularioEventual() {
  document.getElementById('nueva-eve-tipo').innerHTML = TIPOS_EVENTUAL.map(t => `<option>${t}</option>`).join('');
  document.getElementById('nueva-eve-prioridad').innerHTML = PRIORIDADES.map(p => `<option ${p === 'Media' ? 'selected' : ''}>${p}</option>`).join('');
  document.getElementById('nueva-eve-encargado').innerHTML = DATA.usuarios.map(u => `<option>${u.n}</option>`).join('');
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

// Enter en el campo de cédula también intenta login
document.addEventListener('DOMContentLoaded', () => {
  const inputCedula = document.getElementById('input-cedula');
  if (inputCedula) {
    inputCedula.addEventListener('keydown', e => { if (e.key === 'Enter') intentarLogin(); });
  }
  initApp();
  precargarLogo();
  verificarBackupAutomatico();
});
