// firebase.js — Conexión Firebase, merge de snapshots, autoSave
// GestiónPH v2.0
// Depende de: config.js, datos.js
// Regla general (PRD 12): nunca usar FB_REF.set() para cambios puntuales — usar FB_REF.update()

let FB_APP = null;
let FB_REF = null;
let FB_STORAGE = null;
let FB_FOTOS_REF = null;
let _autoSaveTimer = null;
let _lastFbRenderAt = 0;
let _fbInitialized = false;

function initFirebase() {
  if (_fbInitialized) return;
  _fbInitialized = true;
  try {
    FB_APP = firebase.initializeApp(FIREBASE_CONFIG);
    FB_REF = firebase.database().ref(DB_PATH);
    FB_REF.on('value', onFirebaseSnapshot, onFirebaseError);
    // El archivo real de cada foto vive en Firebase Storage; aquí en Realtime Database solo se
    // guarda la URL + metadatos (liviano, y sí se puede "escuchar" en tiempo real — Storage no
    // tiene esa capacidad). Así cualquier dispositivo ve las fotos que subió cualquier otro.
    if (typeof firebase.storage === 'function') {
      FB_STORAGE = firebase.storage();
      FB_FOTOS_REF = firebase.database().ref(DB_FOTOS);
      FB_FOTOS_REF.on('value', onFotosSnapshot);
      firebase.database().ref(DB_CONTADOR_FOTOS).on('value', snap => {
        CONTADOR_FOTOS_BYTES = snap.val() || 0;
        if (PESTANA_ACTUAL === 'admin' && typeof renderAdmin === 'function') renderAdmin();
      });
    }
    window.addEventListener('online', () => {
      if (pendingSync) forceSyncMerge();
    });
  } catch (e) {
    console.error('No se pudo inicializar Firebase', e);
    actualizarIndicadorSync('offline');
  }
}

// Fusiona los metadatos remotos de fotos en FOTOS_REMOTAS, disponible globalmente para que
// verFotoRecurrente() las muestre junto a las locales de este navegador. Cada foto se guarda
// en Firebase con clave plana "tareaIdx_slotIdx_fotoCount" (ver subirFotoAFirebase en
// recurrentes.js) — aquí se reagrupan por tareaIdx_slotIdx para juntarlas.
// Suma (delta positivo) o resta (delta negativo) bytes del contador de fotos — usa transaction()
// para que subidas simultáneas desde 2 dispositivos no se pisen entre sí
function ajustarContadorFotos(deltaBytes) {
  if (!FB_STORAGE) return;
  firebase.database().ref(DB_CONTADOR_FOTOS).transaction(actual => Math.max(0, (actual || 0) + deltaBytes));
}

function onFotosSnapshot(snapshot) {
  const remoto = snapshot.val();
  if (!remoto || typeof FOTOS_REMOTAS === 'undefined') return;
  const nuevas = {};
  Object.keys(remoto).forEach(conjunto => {
    Object.keys(remoto[conjunto] || {}).forEach(mes => {
      Object.keys(remoto[conjunto][mes] || {}).forEach(claveFotoFB => {
        const [tareaIdx, slotIdx] = claveFotoFB.split('_');
        const key = claveFoto(conjunto, mes, tareaIdx, slotIdx);
        nuevas[key] = nuevas[key] || [];
        nuevas[key].push(remoto[conjunto][mes][claveFotoFB]);
      });
    });
  });
  Object.assign(FOTOS_REMOTAS, nuevas);
  if (PESTANA_ACTUAL === 'recurrentes' && typeof renderRecurrentes === 'function') renderRecurrentes();
}

function onFirebaseError(err) {
  console.error('Error de conexión Firebase', err);
  actualizarIndicadorSync('offline');
}

function onFirebaseSnapshot(snapshot) {
  const remoto = snapshot.val();
  if (!remoto) {
    // Base vacía en Firebase: no hay nada que mergear, pero ya sabemos que estamos conectados
    _fbDataReceived = true;
    actualizarIndicadorSync('synced');
    return;
  }
  // Bloqueo temporal tras un restore de backup (regla 6.4.2)
  if (Date.now() < _restoringUntil) return;

  const now = Date.now();
  if (now - _lastFbRenderAt < FB_RENDER_DELAY) {
    // Throttle: aplicamos el merge pero no forzamos múltiples re-renders seguidos
  }
  _lastFbRenderAt = now;

  applySnapshot(remoto);
  _fbDataReceived = true;
  actualizarIndicadorSync('synced');
  if (typeof onDataChanged === 'function') onDataChanged();
}

// ─── MERGE (regla 6.1) ────────────────────────────────────────
// Combina el snapshot remoto de Firebase con el estado local, respetando las reglas de conflicto.
function applySnapshot(remoto) {
  mergeEstadoRecurrentes(remoto.estado || {});
  mergeTareasEve(remoto.tareasEve || []);
  mergeRecComs(remoto.recComs || {});
  mergeEvalManual(remoto.evalManual || {});
  mergeTareasAV(remoto.tareasAV || []);
  mergeTareasArchivo(remoto.tareasArchivo || []);
  mergeDeletedEveIds(remoto.deletedEveIds || []);
  mergeConjuntos(remoto.conjuntos || { def: [], pro: [] });
  mergeTareasRec(remoto.tareasRec || []);
  mergeUsuarios(remoto.usuarios || []);
  mergeCedulas(remoto.cedulas || {});
}

// ESTADO: si el slot local tiene done:true o undoneAt (acción intencional del usuario) → local gana.
// Si no, Firebase gana. Esto evita que un snapshot remoto "desmarque" algo que el usuario acaba de marcar,
// y evita que un merge re-marque algo que el usuario desmarcó intencionalmente.
function mergeEstadoRecurrentes(remotoEstado) {
  const resultado = JSON.parse(JSON.stringify(remotoEstado)); // partimos de Firebase como base
  for (const conjunto in ESTADO) {
    resultado[conjunto] = resultado[conjunto] || {};
    for (const mes in ESTADO[conjunto]) {
      resultado[conjunto][mes] = resultado[conjunto][mes] || {};
      for (const tareaIdx in ESTADO[conjunto][mes]) {
        resultado[conjunto][mes][tareaIdx] = resultado[conjunto][mes][tareaIdx] || {};
        for (const slotIdx in ESTADO[conjunto][mes][tareaIdx]) {
          const local = ESTADO[conjunto][mes][tareaIdx][slotIdx];
          const remotoSlot = resultado[conjunto][mes][tareaIdx][slotIdx];
          const localGana = local && (local.done === true || local.undoneAt);
          resultado[conjunto][mes][tareaIdx][slotIdx] = localGana ? local : (remotoSlot || local);
        }
      }
    }
  }
  ESTADO = resultado;
}

// tareasEve: gana el mayor estUpdAt; excepción: Aprobado/Suspendido local nunca se sobreescribe.
// Comentarios: unión de ambos arrays. Tareas nuevas de cualquier lado se incluyen (nunca se eliminan por merge).
function mergeTareasEve(remotoTareas) {
  const localPorId = new Map(DATA.tareasEve.map(t => [t.id, t]));
  const remotoPorId = new Map(remotoTareas.map(t => [t.id, t]));
  const idsEliminados = new Set(DATA.deletedEveIds || []);
  const todosIds = new Set([...localPorId.keys(), ...remotoPorId.keys()]);

  const resultado = [];
  for (const id of todosIds) {
    if (idsEliminados.has(id)) continue;
    const lt = localPorId.get(id);
    const ft = remotoPorId.get(id);

    if (lt && !ft) { resultado.push(lt); continue; }
    if (ft && !lt) { resultado.push(ft); continue; }

    const localEsFinal = ESTADOS_FINALES.includes(lt.est);
    const remotoEsFinal = ESTADOS_FINALES.includes(ft.est);
    let ganador;
    if (localEsFinal && !remotoEsFinal) {
      ganador = lt; // protección de estados finales
    } else {
      const ltTime = lt.estUpdAt || 0;
      const ftTime = ft.estUpdAt || 0;
      ganador = ftTime > ltTime ? ft : lt;
    }
    // Unión de comentarios sin duplicados
    const comsLt = lt.coms || [];
    const comsFt = ft.coms || [];
    const comsUnion = [...new Set([...comsLt, ...comsFt])];
    resultado.push({ ...ganador, coms: comsUnion });
  }
  DATA.tareasEve = resultado;
}

function mergeRecComs(remotoRecComs) {
  const resultado = JSON.parse(JSON.stringify(remotoRecComs));
  for (const conjunto in REC_COMS) {
    resultado[conjunto] = resultado[conjunto] || {};
    for (const tareaIdx in REC_COMS[conjunto]) {
      const localComs = REC_COMS[conjunto][tareaIdx] || [];
      const remotoComs = resultado[conjunto][tareaIdx] || [];
      resultado[conjunto][tareaIdx] = [...new Set([...remotoComs, ...localComs])];
    }
  }
  REC_COMS = resultado;
}

// EVAL_MANUAL: local gana por conjunto/mes (evaluaciones son decisiones administrativas locales)
function mergeEvalManual(remotoEval) {
  const resultado = JSON.parse(JSON.stringify(remotoEval));
  for (const conjunto in EVAL_MANUAL) {
    resultado[conjunto] = resultado[conjunto] || {};
    for (const mes in EVAL_MANUAL[conjunto]) {
      resultado[conjunto][mes] = EVAL_MANUAL[conjunto][mes];
    }
  }
  EVAL_MANUAL = resultado;
}

// tareasAV: local gana el estado (mismo criterio simple, sin sistema de delegados)
function mergeTareasAV(remotoAV) {
  const localPorId = new Map(DATA.tareasAV.map(t => [t.id, t]));
  const remotoPorId = new Map(remotoAV.map(t => [t.id, t]));
  const todosIds = new Set([...localPorId.keys(), ...remotoPorId.keys()]);
  const resultado = [];
  for (const id of todosIds) {
    const lt = localPorId.get(id);
    const ft = remotoPorId.get(id);
    resultado.push(lt || ft);
  }
  DATA.tareasAV = resultado;
}

function mergeTareasArchivo(remotoArchivo) {
  const porId = new Map(remotoArchivo.map(t => [t.id, t]));
  DATA.tareasArchivo.forEach(t => porId.set(t.id, t));
  DATA.tareasArchivo = [...porId.values()];
}

function mergeDeletedEveIds(remotoIds) {
  DATA.deletedEveIds = [...new Set([...remotoIds, ...DATA.deletedEveIds])];
}

// conjuntos: unión por nombre; local gana campos si el conjunto existe en ambos lados
function mergeConjuntos(remotoConjuntos) {
  ['def', 'pro'].forEach(tipo => {
    const remotoLista = remotoConjuntos[tipo] || [];
    const localLista = DATA.conjuntos[tipo] || [];
    const porNombre = new Map(remotoLista.map(c => [c.n, c]));
    localLista.forEach(c => porNombre.set(c.n, c));
    DATA.conjuntos[tipo] = [...porNombre.values()];
  });
}

// tareasRec: unión por nombre; local gana campos
function mergeTareasRec(remotoTareasRec) {
  const porNombre = new Map(remotoTareasRec.map(t => [t.n, t]));
  DATA.tareasRec.forEach(t => porNombre.set(t.n, t));
  DATA.tareasRec = [...porNombre.values()];
}

// usuarios: unión por idx; local gana campos
function mergeUsuarios(remotoUsuarios) {
  const resultado = [...remotoUsuarios];
  DATA.usuarios.forEach((u, idx) => { resultado[idx] = u; });
  DATA.usuarios = resultado;
}

// cedulas: unión por cédula; local gana campos
function mergeCedulas(remotoCedulas) {
  DATA.cedulas = { ...remotoCedulas, ...DATA.cedulas };
}

// ─── FORZAR SINCRONIZACIÓN (regla 6.2) ───────────────────────
function forceSyncMerge() {
  if (!FB_REF) return Promise.reject('Firebase no inicializado');
  actualizarIndicadorSync('syncing');
  return FB_REF.once('value')
    .then(snap => {
      const remoto = snap.val() || {};
      applySnapshot(remoto);
      return FB_REF.set(buildSnapshot());
    })
    .then(() => {
      pendingSync = false;
      actualizarIndicadorSync('synced');
      if (typeof onDataChanged === 'function') onDataChanged();
      if (typeof toast === 'function') toast('☁️ Sincronizado');
    })
    .catch(err => {
      console.error('Error en forceSyncMerge', err);
      pendingSync = true;
      actualizarIndicadorSync('offline');
    });
}

// ─── AUTOGUARDADO (regla 6.7) ─────────────────────────────────
function programarAutoSave() {
  guardarLocal();
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(subirCambiosPuntuales, SAVE_DELAY);
}

// Sube solo lo necesario con update() en vez de set() completo (regla general del PRD)
function subirCambiosPuntuales() {
  if (!FB_REF) return;
  if (!_fbDataReceived) return; // evita sobreescribir Firebase con datos vacíos al arrancar
  const snap = buildSnapshot();
  FB_REF.update(snap)
    .then(() => {
      pendingSync = false;
      actualizarIndicadorSync('synced');
    })
    .catch(err => {
      console.error('Error subiendo a Firebase', err);
      pendingSync = true;
      actualizarIndicadorSync('local');
    });
}

// Actualiza solo una ruta puntual (uso recomendado para cambios de un solo campo)
function actualizarRutaFirebase(rutaRelativa, valor) {
  if (!FB_REF) return Promise.resolve();
  const update = {};
  update[rutaRelativa] = valor;
  return FB_REF.update(update).catch(err => {
    console.error('Error actualizando ruta', rutaRelativa, err);
    pendingSync = true;
  });
}

function actualizarIndicadorSync(estado) {
  if (typeof renderSyncIndicator === 'function') renderSyncIndicator(estado);
}

// ─── RESTAURAR BACKUP (regla 6.4) ─────────────────────────────
function restaurarBackup(snap) {
  const ahora = Date.now();
  // 1. Estampar estUpdAt en todas las tareasEve del backup
  (snap.tareasEve || []).forEach(t => { t.estUpdAt = ahora; });
  // 2. Bloquear listener 8 segundos
  _restoringUntil = ahora + 8000;
  // 3. Aplicar directamente (ESTADO se mantiene, no se restaura desde backup)
  aplicarSnapshotDirecto(snap);
  guardarLocal();
  // 4/5. Subir a Firebase con set() — este es el único caso permitido de set() completo,
  // porque es una restauración deliberada de la totalidad de los datos.
  const snapFinal = { ...buildSnapshot(), ts: ahora, estado: ESTADO };
  if (!FB_REF) return Promise.resolve();
  return FB_REF.set(snapFinal)
    .then(() => {
      _restoringUntil = 0;
      if (typeof toast === 'function') toast('✓ Restaurado');
      if (typeof onDataChanged === 'function') onDataChanged();
    })
    .catch(err => {
      console.error('Error restaurando backup', err);
      _restoringUntil = 0;
    });
}
