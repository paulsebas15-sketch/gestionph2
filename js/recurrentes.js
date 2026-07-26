// recurrentes.js — Checkboxes por conjunto/mes, % avance, comentarios, fotos
// GestiónPH v2.0
// Depende de: config.js, datos.js, ui.js

// Único cálculo de % de avance — reutilizado también por dashboard.js y evaluacion.js
// (evita el bug conocido "Dashboard % no coincide con Recurrentes", PRD sección 9)
// Cuenta cada repetición mensual (tarea.veces) como una unidad independiente.
function calcularAvanceRecurrente(conjuntoNombre, mes) {
  const tareas = tareasRecPara(conjuntoNombre, mes);
  if (!tareas.length) return { done: 0, total: 0, pct: 0 };
  let done = 0;
  let total = 0;
  tareas.forEach(t => {
    const veces = t.veces || 1;
    for (let s = 0; s < veces; s++) {
      const slot = ensureEstadoSlot(conjuntoNombre, mes, t._idx, s);
      total++;
      if (slot.done) done++;
    }
  });
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

function renderRecurrentes() {
  const cont = document.getElementById('content-recurrentes');
  if (!cont) return;
  const mes = getMes();
  if (esStaff() && CONJUNTO_SELECCIONADO === 'Todos') {
    cont.innerHTML = '<div class="card" style="text-align:center;padding:24px;color:var(--txs);font-size:12px">📌 Selecciona un conjunto específico arriba para ver sus tareas recurrentes.</div>';
    return;
  }
  const conjunto = conjuntoActivoParaVista();
  if (!conjunto) {
    cont.innerHTML = '<div class="card">No tienes conjuntos asignados.</div>';
    return;
  }
  const c = conjuntoPorNombre(conjunto);
  const tareas = tareasRecPara(conjunto, mes);
  const avance = calcularAvanceRecurrente(conjunto, mes);

  cont.innerHTML = `
    <div class="ibox">✅ <strong>${conjunto}</strong> · ${c && (DATA.conjuntos.def || []).includes(c) ? 'Definitivo' : 'Provisional'} · Delegado: ${c ? c.del : '–'} · ${mes} · Toca ℹ️ para descripción · 📷 requiere foto</div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div class="card-title" style="margin:0">Avance ${mes} — ${avance.done} / ${avance.total} tareas</div>
        <span style="font-size:13px;font-weight:700;color:var(--vm)">${avance.pct}%</span>
      </div>
      <div class="prog-wrap"><div class="prog-fill" style="width:${avance.pct}%"></div></div>
      ${tareas.map(t => renderTareaRow(conjunto, mes, t)).join('')}
      ${!tareas.length ? '<div style="font-size:11px;color:var(--txs);text-align:center;padding:12px">Sin tareas recurrentes para este mes</div>' : ''}
    </div>
  `;
}

// Determina el conjunto activo en la vista: selección de header, o el único conjunto del delegado
function conjuntoActivoParaVista() {
  if (esStaff()) {
    if (CONJUNTO_SELECCIONADO && CONJUNTO_SELECCIONADO !== 'Todos') return CONJUNTO_SELECCIONADO;
    const primero = todosLosConjuntos()[0];
    return primero ? primero.n : null;
  }
  const usuario = usuarioActual();
  return usuario && usuario.conjuntos && usuario.conjuntos[0];
}

// Tareas cuya fecha se calcula sola desde el evento "Reunión de consejo" de Calendario — se
// muestran de solo lectura en Recurrentes aunque tengan fechaIndividual:true, porque tocarlas
// a mano se perdería en cuanto alguien vuelva a editar la reunión (ver sincronizarFechaConsejo)
const TAREAS_FECHA_AUTO_CALENDARIO = [
  'Reunión de consejo de adm.',
  'Envío informe gestión + convocatoria consejo',
  'Envío acta de reunión de consejo'
];

function guardarFechaIndividualRec(conjunto, mes, idx, iso) {
  setFechaLimiteRec(conjunto, mes, idx, isoAFechaCorta(iso));
  programarGuardadoFechaLimite(conjunto, mes, idx); // guardado individual: solo esta fecha, ninguna otra se toca
  renderRecurrentes();
}

// Una fila por tarea. Si veces > 1, se muestran N casillas compactas en línea
// (S1..SN si es semanal, 1..N si no) en vez de una fila completa por repetición.
function renderTareaRow(conjunto, mes, tarea) {
  const veces = tarea.veces || 1;
  const esSemanal = tarea.frec === 'semanal';
  const slots = [];
  for (let s = 0; s < veces; s++) slots.push(ensureEstadoSlot(conjunto, mes, tarea._idx, s));
  const doneCount = slots.filter(s => s.done).length;
  const comentarios = ensureRecComs(conjunto, tarea._idx);
  const numComentarios = comentarios.length;
  const hayFoto = tarea.foto && slots.some(s => s.hasFoto);

  // Fechas compartidas (fechaVariable) se fijan una sola vez en Admin para todos los conjuntos.
  // Fechas "auto-calculadas" (Reunión de consejo y las 2 que dependen de ella) se sincronizan
  // solas desde Calendario, de solo lectura aquí. El resto de tareas con fechaIndividual sí se
  // puede editar directamente aquí, por conjunto — para cualquier caso futuro que lo necesite.
  const fechaMostrada = obtenerFechaTareaRec(conjunto, mes, tarea);
  const esAutoCalculada = TAREAS_FECHA_AUTO_CALENDARIO.includes(tarea.n);
  const origenFecha = tarea.fechaVariable ? '' : (esAutoCalculada ? ' (desde Calendario)' : '');
  let subtitulo;
  if (tarea.fechaIndividual && !tarea.fechaVariable && !esAutoCalculada) {
    subtitulo = `<input type="date" class="form-input" style="padding:2px 4px;font-size:9px;width:118px" value="${fechaCortaAIso(fechaMostrada)}" onchange="guardarFechaIndividualRec('${conjunto}','${mes}',${tarea._idx},this.value)">`;
  } else if (tarea.fechaVariable || fechaMostrada) {
    subtitulo = fechaMostrada ? `Vence: ${fechaMostrada}${origenFecha}` : 'Sin fecha fijada este mes (definir en Admin)';
  } else {
    subtitulo = tarea.limite
      ? `Límite: ${tarea.limite}`
      : (tarea.bimestral ? 'Bimestral · Aplica este mes' : (veces > 1 ? `${veces} veces al mes${esSemanal ? ' (semanal)' : ''}` : 'Pendiente'));
  }

  const slotsHtml = slots.map((slot, s) => {
    const lbl = veces > 1 ? (esSemanal ? `S${s + 1}` : `${s + 1}`) : '';
    const fecha = slot.done && slot.ts ? slot.ts.split(' ')[0] : '';
    return `
      <div class="rec-slot-col">
        ${lbl ? `<div class="rec-slot-lbl">${lbl}</div>` : ''}
        <div class="rec-slot ${slot.done ? 'done' : ''}" onclick="toggleRecurrente('${conjunto}','${mes}',${tarea._idx},${s})">${slot.done ? '✓' : ''}</div>
        ${fecha ? `<div class="rec-slot-date">${fecha}</div>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="rec-row">
      <div class="rec-slots">${slotsHtml}</div>
      <div class="check-info">
        <div class="check-n">${tarea.n}${tarea.foto ? ' 📷' : ''}</div>
        <div class="check-sub">${subtitulo}</div>
      </div>
      ${veces > 1 ? `<div class="rec-count">${doneCount}/${veces}</div>` : ''}
      ${fechaMostrada ? `<div style="flex-shrink:0">${semaforoHtml(fechaMostrada, 'Media')}</div>` : ''}
      <div class="check-actions">
        <button class="icon-btn" title="${tarea.desc || ''}" onclick="alert('${(tarea.desc || 'Sin descripción').replace(/'/g, "\\'")}')">ℹ️</button>
        <button class="icon-btn" onclick="abrirComentariosRecurrente('${conjunto}',${tarea._idx})">💬${numComentarios ? ` <span style="font-size:8px;background:var(--rj);color:white;border-radius:8px;padding:0 3px">${numComentarios}</span>` : ''}</button>
        ${tarea.foto ? `<button class="icon-btn" title="Adjuntar foto" onclick="adjuntarFotoRecurrente('${conjunto}','${mes}',${tarea._idx})">📷</button>` : ''}
        ${hayFoto ? `<button class="icon-btn" title="Ver foto" onclick="verFotoRecurrente('${conjunto}','${mes}',${tarea._idx})">👁️</button>` : ''}
      </div>
    </div>
  `;
}

function toggleRecurrente(conjunto, mes, tareaIdx, slotIdx = 0) {
  const slot = ensureEstadoSlot(conjunto, mes, tareaIdx, slotIdx);
  const tarea = DATA.tareasRec[tareaIdx];
  if (!slot.done && tarea.foto && !slot.hasFoto) {
    toast('Esta tarea requiere una foto antes de marcarla');
    return;
  }
  if (slot.done) {
    // Confirmación explícita para evitar desmarcar por error un toque accidental
    if (!confirm('¿Seguro que quieres desmarcar esta tarea como pendiente?')) return;
    // Desmarcado intencional — nunca se re-marca automáticamente por merge Firebase (regla 6.1)
    slot.done = false;
    slot.ts = null;
    slot.undoneAt = Date.now();
  } else {
    slot.done = true;
    slot.ts = tsCol();
    slot.tsManual = null;
    delete slot.undoneAt;
  }
  programarGuardadoEstadoSlot(conjunto, mes, tareaIdx, slotIdx); // guardado individual: solo esta casilla, ninguna otra se toca
  renderRecurrentes();
  if (typeof updBadge === 'function') updBadge();
}

// ─── FOTOS (Supabase Storage) ────────────────────────────────────
// Las fotos viven en un bucket privado de Supabase Storage, con RLS por conjunto (mismo
// criterio que el resto de los datos). No hay "escuchar en tiempo real" como tenía Firebase —
// se trae la lista fresca de fotos cada vez que se abre el visor (recarga simple, decisión del
// usuario: más simple y menos piezas que puedan fallar que mantener un listener).
const FOTOS_LOCAL_KEY = 'gestionph_fotos_local';
let FOTOS_LOCAL = {}; // vista previa optimista mientras sube (localStorage, clave = claveFoto())
// Suma de bytes de todas las fotos en Storage — se trae de la tabla `contadores` de Supabase,
// usado para la barra de uso en Admin
let CONTADOR_FOTOS_BYTES = 0;

function cargarFotosLocal() {
  try {
    FOTOS_LOCAL = JSON.parse(localStorage.getItem(FOTOS_LOCAL_KEY) || '{}');
  } catch (e) {
    FOTOS_LOCAL = {};
  }
}

function guardarFotosLocal() {
  try {
    localStorage.setItem(FOTOS_LOCAL_KEY, JSON.stringify(FOTOS_LOCAL));
  } catch (e) {
    console.error('Error guardando fotos localmente (¿localStorage lleno?)', e);
    toast('⚠️ No se pudo guardar la foto localmente (espacio lleno)');
  }
}

function claveFoto(conjunto, mes, tareaIdx, slotIdx) {
  return `${conjunto}|${mes}|${tareaIdx}|${slotIdx}`;
}

function adjuntarFotoRecurrente(conjunto, mes, tareaIdx) {
  const tarea = DATA.tareasRec[tareaIdx];
  const veces = tarea.veces || 1;
  // Elige el primer slot sin foto; si todos ya tienen, usa el último (permite reemplazar/agregar evidencia)
  let slotIdx = 0;
  for (let s = 0; s < veces; s++) {
    const slot = ensureEstadoSlot(conjunto, mes, tareaIdx, s);
    if (!slot.hasFoto) { slotIdx = s; break; }
    slotIdx = s;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    comprimirImagen(file).then(blob => {
      const reader = new FileReader();
      reader.onload = () => {
        const slot = ensureEstadoSlot(conjunto, mes, tareaIdx, slotIdx);
        slot.hasFoto = true;
        slot.fotoCount = (slot.fotoCount || 0) + 1;
        const fotoCount = slot.fotoCount;

        const key = claveFoto(conjunto, mes, tareaIdx, slotIdx);
        FOTOS_LOCAL[key] = FOTOS_LOCAL[key] || [];
        // Vista previa optimista con el base64 mientras sube — listarFotosSupabase() ya no
        // necesita "reemplazar" esta entrada como antes con Firebase; conviven mostrando ambas
        // fuentes (ver verFotoRecurrente), y la local se limpia sola al cerrar el modal.
        FOTOS_LOCAL[key].push({ data: reader.result, nombre: file.name, ts: tsCol() });
        guardarFotosLocal();

        subirFotoASupabase(conjunto, mes, tareaIdx, slotIdx, fotoCount, blob);

        toast('📷 Foto adjuntada');
        programarGuardadoEstadoSlot(conjunto, mes, tareaIdx, slotIdx); // guardado individual: solo esta casilla, ninguna otra se toca
        renderRecurrentes();
      };
      reader.readAsDataURL(blob);
    });
  };
  input.click();
}

// Redimensiona y comprime una foto ANTES de subirla — reduce el consumo de Storage hasta ~85%
// sin pérdida visible para evidencia fotográfica (regla del usuario, ver análisis de capacidad).
// Si algo falla (formato raro, navegador viejo), se sube el archivo original sin comprimir.
function comprimirImagen(file, maxAncho = FOTO_MAX_ANCHO, calidad = FOTO_CALIDAD) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxAncho) { h = Math.round(h * maxAncho / w); w = maxAncho; }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        URL.revokeObjectURL(url);
        resolve(blob || file);
      }, 'image/jpeg', calidad);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// Ruta del archivo en el bucket privado de Supabase Storage. El primer segmento (conjunto) es
// lo que las políticas RLS de storage.objects usan para decidir quién puede ver/subir/borrar.
function rutaFotoSupabase(conjunto, mes, tareaIdx, slotIdx, fotoCount) {
  return `${conjunto}/${mes}/${tareaIdx}_${slotIdx}_${fotoCount}.jpg`;
}

async function subirFotoASupabase(conjunto, mes, tareaIdx, slotIdx, fotoCount, blob) {
  const ruta = rutaFotoSupabase(conjunto, mes, tareaIdx, slotIdx, fotoCount);
  const { error } = await SB.storage.from(SUPABASE_FOTOS_BUCKET).upload(ruta, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) {
    console.error('Error subiendo foto a Supabase Storage', error.message);
    toast('⚠️ No se pudo subir la foto — revisa tu conexión');
    return;
  }
  await SB.rpc('ajustar_contador', { p_clave: 'fotos_bytes', p_delta: blob.size });
  await cargarContadorFotos();
}

// Trae la lista de fotos de UNA casilla puntual (conjunto+mes+tarea+repetición) desde Supabase,
// con una URL firmada válida por 1 hora (el bucket es privado, no hay links directos permanentes).
async function listarFotosSupabase(conjunto, mes, tareaIdx, slotIdx) {
  const carpeta = `${conjunto}/${mes}`;
  const prefijoArchivo = `${tareaIdx}_${slotIdx}_`;
  const { data, error } = await SB.storage.from(SUPABASE_FOTOS_BUCKET).list(carpeta, { search: prefijoArchivo });
  if (error || !data) return [];
  const propias = data.filter(f => f.name.startsWith(prefijoArchivo));
  const conUrl = await Promise.all(propias.map(async f => {
    const { data: firmada } = await SB.storage.from(SUPABASE_FOTOS_BUCKET).createSignedUrl(`${carpeta}/${f.name}`, 3600);
    return { nombre: f.name, ts: f.created_at ? new Date(f.created_at).toLocaleString('es-CO') : '', src: firmada ? firmada.signedUrl : null };
  }));
  return conUrl.filter(f => f.src);
}

// Cualquiera que vea la tarea puede abrir y revisar la(s) foto(s) adjuntas. Sin "tiempo real":
// se trae la lista fresca de Supabase cada vez que se abre el visor (recarga simple).
async function verFotoRecurrente(conjunto, mes, tareaIdx) {
  const tarea = DATA.tareasRec[tareaIdx];
  const veces = tarea.veces || 1;
  document.getElementById('ver-foto-titulo').textContent = tarea.n;
  document.getElementById('ver-foto-lista').innerHTML = '<div style="font-size:11px;color:var(--txs);text-align:center;padding:16px">Cargando fotos…</div>';
  openOv('modal-ver-foto');

  let fotos = [];
  for (let s = 0; s < veces; s++) {
    const key = claveFoto(conjunto, mes, tareaIdx, s);
    const remotas = (await listarFotosSupabase(conjunto, mes, tareaIdx, s)).map(f => ({ ...f, slot: s + 1 }));
    // Locales de este navegador que aún no confirman subida — se deduplica por nombre+ts para
    // no mostrar la misma foto 2 veces apenas termina de subir.
    const locales = (FOTOS_LOCAL[key] || [])
      .filter(f => !remotas.some(r => r.ts && f.ts && r.ts === f.ts))
      .map(f => ({ ...f, slot: s + 1, src: f.data }));
    fotos.push(...remotas, ...locales);
  }
  fotos.sort((a, b) => (a.ts < b.ts ? 1 : -1));

  document.getElementById('ver-foto-lista').innerHTML = fotos.length
    ? fotos.map(f => `
        <div style="margin-bottom:12px">
          <img src="${f.src}" style="width:100%;border-radius:8px;border:1px solid var(--brd)">
          <div style="font-size:9px;color:var(--txs);margin-top:4px">${f.nombre} · ${f.ts}${(tarea.veces || 1) > 1 ? ` · Repetición ${f.slot}` : ''}${f.data ? ' · ⏳ subiendo…' : ''}</div>
        </div>`).join('')
    : '<div style="font-size:11px;color:var(--txs);text-align:center;padding:16px">Sin fotos para esta tarea.</div>';
}

function abrirComentariosRecurrente(conjunto, tareaIdx) {
  const tarea = DATA.tareasRec[tareaIdx];
  const comentarios = ensureRecComs(conjunto, tareaIdx);
  const modal = document.getElementById('modal-com-recurrente');
  if (!modal) return;
  modal.dataset.conjunto = conjunto;
  modal.dataset.tareaIdx = tareaIdx;
  document.getElementById('com-rec-titulo').textContent = tarea.n;
  document.getElementById('com-rec-lista').innerHTML = comentarios.length
    ? comentarios.map(c => `<div style="font-size:10px;padding:5px 0;border-bottom:.5px solid var(--brd)">${c}</div>`).join('')
    : '<div style="font-size:10px;color:var(--txs)">Sin comentarios aún</div>';
  document.getElementById('com-rec-input').value = '';
  openOv('modal-com-recurrente');
}

function enviarComentarioRecurrente() {
  const modal = document.getElementById('modal-com-recurrente');
  const conjunto = modal.dataset.conjunto;
  const tareaIdx = parseInt(modal.dataset.tareaIdx, 10);
  const texto = document.getElementById('com-rec-input').value.trim();
  if (!texto) return;
  const usuario = usuarioActual();
  const comentarios = ensureRecComs(conjunto, tareaIdx);
  comentarios.push(`${texto} - ${usuario ? usuario.n : '—'} ${fechaCortaCol()}`);
  programarGuardadoComentariosRecurrente(conjunto, tareaIdx); // guardado individual: solo esta tarea, ninguna otra se toca
  abrirComentariosRecurrente(conjunto, tareaIdx);
  renderRecurrentes();
}
