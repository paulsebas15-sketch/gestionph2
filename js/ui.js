// ui.js — Toast, modales/overlays, badges, semáforo, navegación
// GestiónPH v2.0
// Depende de: config.js, datos.js, auth.js

// ─── ESTADO DE NAVEGACIÓN ─────────────────────────────────────
let PESTANA_ACTUAL = 'dashboard';
let MES_SELECCIONADO = null;   // se inicializa en initApp según getMes()
let CONJUNTO_SELECCIONADO = 'Todos';
// estados/vigencias: arrays vacíos = "sin filtro" (mostrar todo). Multi-selección tipo chip.
let FILTROS_EVENTUALES = { estados: [], vigencias: [], busqueda: '' };

function getMes() {
  return MES_SELECCIONADO;
}

function setMes(mes) {
  MES_SELECCIONADO = mes;
  localStorage.setItem('gph_mesSel', mes);
  if (typeof renderPestanaActual === 'function') renderPestanaActual();
  if (typeof updBadge === 'function') updBadge();
}

function setConjuntoSeleccionado(nombre) {
  CONJUNTO_SELECCIONADO = nombre;
  localStorage.setItem('gph_conjSel', nombre);
  // Cambiar el conjunto del header cuenta como cambiar un filtro: retoma la foto de Eventuales
  // para que la tabla se actualice de inmediato (si no, seguiría mostrando el snapshot viejo)
  if (typeof tomarSnapshotEventuales === 'function') tomarSnapshotEventuales();
  if (typeof renderPestanaActual === 'function') renderPestanaActual();
  // Los badges de navegación ahora respetan el conjunto elegido — hay que refrescarlos también
  if (typeof updBadge === 'function') updBadge();
}

function cambiarPestana(pestana) {
  if (!tienePermiso(pestana)) return;
  PESTANA_ACTUAL = pestana;
  // Entrar (de nuevo) a Eventuales toma una foto fresca de la lista filtrada. Los refrescos
  // internos (ej. cambiar el estado de una tarea desde el detalle) llaman a renderEventuales()
  // directamente, sin pasar por aquí, así que no retoman la foto — la tarea no "desaparece"
  // de la lista visible hasta que el usuario vuelva a aplicar el filtro o reabra la pestaña.
  if (pestana === 'eventuales' && typeof tomarSnapshotEventuales === 'function') tomarSnapshotEventuales();
  if (typeof renderPestanaActual === 'function') renderPestanaActual();
  // renderPestanaActual() reconstruye el nav (renderTabsNav) y deja los badges en blanco —
  // hay que rellenarlos de nuevo después
  if (typeof updBadge === 'function') updBadge();
}

// ─── TOAST ────────────────────────────────────────────────────
function toast(mensaje, duracion = 3000) {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = mensaje;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), duracion);
}

// ─── MODAL / OVERLAY ──────────────────────────────────────────
function openOv(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('oculto');
}

function closeOv(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('oculto');
}

function closeAllOverlays() {
  document.querySelectorAll('.modal-overlay').forEach(el => el.classList.add('oculto'));
}

// ─── SEMÁFORO ─────────────────────────────────────────────────
// Retorna { icono, clase, texto } según fecha de vencimiento y prioridad
function semaforo(vence, prioridad) {
  if (!plazosActivos(getMes())) return { icono: '⚪', texto: 'Sin plazo (mes de prueba)' };
  const fechaVence = parseFechaCorta(vence);
  if (!fechaVence) return { icono: '⚪', texto: 'Sin fecha' };
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const diffDias = Math.round((fechaVence - hoy) / 86400000);
  const umbral = SEMAFORO_UMBRAL[prioridad] ?? 5;
  if (diffDias < 0) return { icono: '🔴', texto: 'Vencida' };
  if (diffDias <= umbral) return { icono: '🟠', texto: `Vence en ${diffDias}d` };
  return { icono: '🟢', texto: 'A tiempo' };
}

function semaforoHtml(vence, prioridad) {
  const s = semaforo(vence, prioridad);
  return `<span class="sem" title="${s.texto}">${s.icono}</span>`;
}

// ─── BADGES DE PESTAÑA ────────────────────────────────────────
// Los 4 badges (Recurrentes, Eventuales, Aprobaciones, Validaciones) siempre muestran el total
// real (incluido 0, ya no se ocultan) y respetan el conjunto elegido en el header — con "Todos"
// muestran el total de todo lo que el rol puede ver.
function setBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = count;
  el.classList.remove('oculto');
}

function updBadge() {
  if (!SESION_ACTUAL) return;
  const nombresVisibles = esStaff() ? todosLosConjuntos().map(c => c.n) : conjuntosVisibles(usuarioActual());
  const conjuntosEnAlcance = (CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos')
    ? nombresVisibles.filter(n => n === CONJUNTO_SELECCIONADO)
    : nombresVisibles;

  const tareasVisibles = DATA.tareasEve.filter(t => conjuntosEnAlcance.includes(t.conj));
  setBadge('badge-aprobaciones', tareasVisibles.filter(t => t.est === 'Pendiente aprobación').length);
  setBadge('badge-validaciones', tareasVisibles.filter(t => t.est === 'Finalizado').length);
  setBadge('badge-eventuales', tareasVisibles.filter(t => t.est === 'Nuevo' || t.est === 'En proceso').length);

  if (typeof tareasRecPara === 'function' && typeof ensureEstadoSlot === 'function') {
    const mes = getMes();
    let recSinMarcar = 0;
    conjuntosEnAlcance.forEach(conj => {
      tareasRecPara(conj, mes).forEach(t => {
        const veces = t.veces || 1;
        for (let s = 0; s < veces; s++) {
          if (!ensureEstadoSlot(conj, mes, t._idx, s).done) recSinMarcar++;
        }
      });
    });
    setBadge('badge-recurrentes', recSinMarcar);
  }
}

// ─── BADGE DE ESTADO EVENTUAL (clase CSS por estado) ─────────
const CLASE_ESTADO = {
  'Nuevo': 'b-nuevo',
  'En proceso': 'b-proceso',
  'Pausado': 'b-pausado',
  'Pendiente aprobación': 'b-pend',
  'Finalizado': 'b-fin',
  'Aprobado': 'b-apr',
  'Suspendido': 'b-sus'
};

function badgeEstadoHtml(estado) {
  const clase = CLASE_ESTADO[estado] || 'b-nuevo';
  return `<span class="badge-est ${clase}">${estado}</span>`;
}

const CLASE_PRIORIDAD = { 'Alta': 'pri-a', 'Media': 'pri-m', 'Baja': 'pri-b' };
function badgePrioridadHtml(prioridad) {
  return `<span class="${CLASE_PRIORIDAD[prioridad] || 'pri-m'}">${prioridad}</span>`;
}

// ─── INDICADOR DE SYNC ────────────────────────────────────────
function renderSyncIndicator(estado) {
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  const hora = tsCol().split(' ')[1];
  const estados = {
    synced: `☁️ Sincronizado ${hora}`,
    local: `💾 Local ${hora} ⏳`,
    syncing: `↻ Sincronizando…`,
    offline: `📵 Sin conexión — guardando local`
  };
  el.textContent = estados[estado] || estados.local;
}

// ─── SUGERIR FECHA DE VENCIMIENTO SEGÚN PRIORIDAD ─────────────
function sugerirFechaVencimiento(prioridad) {
  const dias = PLAZO_SUGERIDO_DIAS[prioridad] ?? 15;
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toISOString().split('T')[0]; // yyyy-mm-dd para <input type="date">
}

// Convierte yyyy-mm-dd (input date) a "DD/MM" usado internamente
function isoAFechaCorta(iso) {
  if (!iso) return null;
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

// Convierte "DD/MM" a "YYYY-MM-DD" (para prellenar <input type="date">)
function fechaCortaAIso(ddmm, anio = new Date().getFullYear()) {
  if (!ddmm) return '';
  const [d, m] = ddmm.split('/');
  return `${anio}-${m}-${d}`;
}

// ─── LIMPIAR FORMULARIO (un único helper, evita el bug de la v1.0) ────
function clearForm(formId) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.querySelectorAll('input[type="text"], input[type="date"], textarea').forEach(el => { el.value = ''; });
  form.querySelectorAll('select').forEach(el => { el.selectedIndex = 0; });
  form.querySelectorAll('input[type="checkbox"]').forEach(el => { el.checked = false; });
}

// ─── FILTROS PERSISTENTES ─────────────────────────────────────
function cargarFiltrosPersistentes() {
  try {
    const raw = localStorage.getItem('gph_filtrosEve');
    if (raw) {
      const guardado = JSON.parse(raw);
      // Migración de formato viejo ({estado,prioridad} de una versión anterior) — sin esto,
      // un valor viejo en localStorage rompe renderChip (espera arrays estados/vigencias) y
      // deja la pestaña Eventuales completamente en blanco.
      FILTROS_EVENTUALES = {
        estados: Array.isArray(guardado.estados) ? guardado.estados : [],
        vigencias: Array.isArray(guardado.vigencias) ? guardado.vigencias : [],
        busqueda: typeof guardado.busqueda === 'string' ? guardado.busqueda : ''
      };
    }
  } catch (e) { /* usar default */ }
}

function guardarFiltrosPersistentes() {
  localStorage.setItem('gph_filtrosEve', JSON.stringify(FILTROS_EVENTUALES));
}
