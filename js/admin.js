// admin.js — Panel de administración: conjuntos, usuarios, tareas recurrentes, capacidad/backup
// GestiónPH v2.0
// Depende de: config.js, datos.js, ui.js, firebase.js

function renderAdmin() {
  const cont = document.getElementById('content-admin');
  if (!cont) return;

  const totalActivas = DATA.tareasEve.length;
  const aprobadasPendientes = DATA.tareasEve.filter(t => t.est === 'Aprobado').length;
  const archivadas = DATA.tareasArchivo.length;
  const tamanoKB = Math.round(new Blob([JSON.stringify(buildSnapshot())]).size / 1024);

  cont.innerHTML = `
    <div class="ibox">⚙️ <strong>Panel de Administración</strong> — Solo gerencia. Gestiona accesos, conjuntos, perfiles y tareas.</div>

    <div class="card">
      <div class="section-title">📦 Capacidad del sistema</div>
      <div class="cap-grid">
        <div class="cap-item"><div class="cap-num">${totalActivas}</div><div class="cap-lbl">Tareas activas</div></div>
        <div class="cap-item"><div class="cap-num ora">${aprobadasPendientes}</div><div class="cap-lbl">Aprobadas (archivar)</div></div>
        <div class="cap-item"><div class="cap-num">${archivadas}</div><div class="cap-lbl">Archivadas</div></div>
        <div class="cap-item"><div class="cap-num">${tamanoKB}KB</div><div class="cap-lbl">Tamaño datos</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button class="btn btn-v btn-sm" onclick="archivarAprobadas()">📦 Archivar ${aprobadasPendientes} aprobadas</button>
        <button class="btn btn-sm btn-g" onclick="verHistorialArchivadas()">📜 Ver historial (${archivadas})</button>
        <button class="btn btn-sm" style="background:#2d6a4f;color:white" onclick="descargarInformeArchivo()">📥 Descargar informe del archivo</button>
        <button class="btn btn-sm btn-g" onclick="limpiarCacheLocal()">🗑 Limpiar caché local</button>
        <button class="btn btn-sm" style="background:#2d6a4f;color:white" onclick="exportarBackup()">📥 Exportar backup</button>
        <button class="btn btn-r btn-sm" onclick="document.getElementById('input-restore').click()">📂 Restaurar backup</button>
        <input type="file" id="input-restore" accept="application/json" class="oculto" onchange="restaurarBackupDesdeArchivo(this.files[0])">
      </div>
      <div style="margin-top:8px;border-top:1px solid var(--brd);padding-top:8px">
        <button class="btn btn-sm" style="background:#4a3f8c;color:white" onclick="document.getElementById('input-migracion').click()">🔄 Migrar backup v1.0 (una sola vez)</button>
        <input type="file" id="input-migracion" accept="application/json" class="oculto" onchange="migrarBackupV1DesdeArchivo(this.files[0])">
        <div style="font-size:9px;color:var(--txs);margin-top:4px">Importa completo un backup exportado desde la app v1.0 (incluye ESTADO de recurrentes). Usar solo una vez, al iniciar v2.0.</div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">📅 Fechas del mes — tareas recurrentes compartidas</div>
      <div style="font-size:9px;color:var(--txs);margin-bottom:8px">Estas ${nombresTareasFechaCompartida().length} tareas tienen la MISMA fecha límite para los ${todosLosConjuntos().length} conjuntos — se fija una sola vez aquí para ${getMes()} (cambia el mes arriba en el header para editar otro mes) en vez de repetirla conjunto por conjunto en Recurrentes. Para agregar o quitar una tarea de esta zona, marca/desmarca "📅 Fecha variable cada mes" al editarla en la tabla de Tareas Recurrentes (base) más abajo.</div>
      <table class="tbl">
        <thead><tr><th>Tarea</th><th style="width:160px">Fecha — ${getMes()}</th></tr></thead>
        <tbody>${renderFilasFechaGlobal()}</tbody>
      </table>
    </div>

    <div class="admin-grid">
      <div class="card">
        <div class="section-title">🏘 Conjuntos</div>
        <table class="tbl">
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Delegado</th><th></th></tr></thead>
          <tbody>${renderFilasConjuntos()}</tbody>
        </table>
        <button class="btn btn-v btn-sm" style="margin-top:8px" onclick="abrirNuevoConjunto()">+ Nuevo conjunto</button>
      </div>

      <div class="card">
        <div class="section-title">👥 Usuarios y accesos</div>
        <table class="tbl">
          <thead><tr><th>Nombre</th><th>Cargo</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
          <tbody>${renderFilasUsuarios()}</tbody>
        </table>
        <button class="btn btn-v btn-sm" style="margin-top:8px" onclick="abrirNuevoUsuario()">+ Nuevo usuario</button>
      </div>

      <div class="card" style="grid-column:1/-1">
        <div class="section-title">🔁 Tareas Recurrentes (base)</div>
        <table class="tbl">
          <thead><tr><th>Tarea</th><th>Aplica a</th><th>Frec.</th><th>Veces/mes</th><th>Bimestral</th><th>Foto</th><th>Pts. eval.</th><th></th></tr></thead>
          <tbody>${renderFilasTareasRec()}</tbody>
        </table>
        <button class="btn btn-v btn-sm" style="margin-top:8px" onclick="abrirNuevaTareaRecurrente()">+ Nueva tarea recurrente</button>
      </div>
    </div>
  `;
}

// ─── CONJUNTOS ────────────────────────────────────────────────
function renderFilasConjuntos() {
  const filas = [];
  ['def', 'pro'].forEach(tipo => {
    (DATA.conjuntos[tipo] || []).forEach(c => {
      if (c.deleted) return;
      filas.push(`
        <tr>
          <td style="font-size:10px">${c.n}</td>
          <td style="font-size:9px;color:var(--txs)">${tipo === 'def' ? 'Def' : 'Prov'}</td>
          <td style="font-size:10px">${c.del}</td>
          <td><button class="btn btn-sm btn-g" style="font-size:9px;padding:2px 6px" onclick="abrirEditarConjunto('${tipo}','${c.n}')">✏️</button></td>
        </tr>`);
    });
  });
  return filas.join('') || '<tr><td colspan="4" style="font-size:10px;color:var(--txs);text-align:center;padding:10px">Sin conjuntos</td></tr>';
}

function poblarSelectDelegados(delegadoActual) {
  const sel = document.getElementById('conj-delegado');
  const delegados = DATA.usuarios.filter(u => u.rol === 'delegado');
  sel.innerHTML = '<option value="">— Sin asignar —</option>' +
    delegados.map(u => `<option ${u.n === delegadoActual ? 'selected' : ''}>${u.n}</option>`).join('');
}

function abrirNuevoConjunto() {
  document.getElementById('conj-modal-titulo').textContent = '➕ Nuevo conjunto';
  document.getElementById('conj-btn-guardar').textContent = '✓ Crear';
  document.getElementById('conj-btn-eliminar').classList.add('oculto');
  document.getElementById('conj-edit-nombre').value = '';
  document.getElementById('conj-nombre').value = '';
  document.getElementById('conj-tipo').value = 'def';
  poblarSelectDelegados('');
  openOv('modal-conjunto');
}

function abrirEditarConjunto(tipoActual, nombreActual) {
  const c = conjuntoPorNombre(nombreActual);
  if (!c) return;
  document.getElementById('conj-modal-titulo').textContent = '✏️ Editar conjunto';
  document.getElementById('conj-btn-guardar').textContent = '✓ Guardar cambios';
  document.getElementById('conj-btn-eliminar').classList.remove('oculto');
  document.getElementById('conj-edit-nombre').value = nombreActual;
  document.getElementById('conj-nombre').value = c.n;
  document.getElementById('conj-tipo').value = tipoActual;
  poblarSelectDelegados(c.del);
  openOv('modal-conjunto');
}

function guardarConjunto() {
  const nombreActual = document.getElementById('conj-edit-nombre').value;
  const nuevoNombre = document.getElementById('conj-nombre').value.trim();
  if (!nuevoNombre) { toast('El nombre es obligatorio'); return; }
  const tipo = document.getElementById('conj-tipo').value;
  const delegado = document.getElementById('conj-delegado').value;

  if (nombreActual) {
    // Editando uno existente
    const c = conjuntoPorNombre(nombreActual);
    const tipoAnterior = (DATA.conjuntos.def || []).includes(c) ? 'def' : 'pro';
    if (nuevoNombre !== nombreActual) {
      // Al renombrar: actualizar referencias en ESTADO, REC_COMS y tareasEve (regla sección 5.13)
      if (ESTADO[nombreActual]) { ESTADO[nuevoNombre] = ESTADO[nombreActual]; delete ESTADO[nombreActual]; }
      if (REC_COMS[nombreActual]) { REC_COMS[nuevoNombre] = REC_COMS[nombreActual]; delete REC_COMS[nombreActual]; }
      if (EVAL_MANUAL[nombreActual]) { EVAL_MANUAL[nuevoNombre] = EVAL_MANUAL[nombreActual]; delete EVAL_MANUAL[nombreActual]; }
      DATA.tareasEve.forEach(t => { if (t.conj === nombreActual) t.conj = nuevoNombre; });
      DATA.usuarios.forEach(u => {
        if (u.conjuntos) u.conjuntos = u.conjuntos.map(cn => cn === nombreActual ? nuevoNombre : cn);
      });
    }
    c.n = nuevoNombre;
    c.del = delegado || '—';
    if (tipo !== tipoAnterior) {
      DATA.conjuntos[tipoAnterior] = DATA.conjuntos[tipoAnterior].filter(x => x !== c);
      DATA.conjuntos[tipo] = DATA.conjuntos[tipo] || [];
      DATA.conjuntos[tipo].push(c);
    }
    asignarDelegadoAConjunto(nuevoNombre, delegado);
    toast('✓ Conjunto actualizado');
  } else {
    // Nuevo conjunto
    DATA.conjuntos[tipo] = DATA.conjuntos[tipo] || [];
    DATA.conjuntos[tipo].push({ n: nuevoNombre, del: delegado || '—', c: '#4a7c59', eval: {} });
    DATA.tareasRec.forEach((t, idx) => {
      const veces = t.veces || 1;
      MESES.forEach(mes => {
        for (let s = 0; s < veces; s++) ensureEstadoSlot(nuevoNombre, mes, idx, s);
      });
      ensureRecComs(nuevoNombre, idx);
    });
    asignarDelegadoAConjunto(nuevoNombre, delegado);
    toast('✓ Conjunto creado');
  }
  closeOv('modal-conjunto');
  programarAutoSave();
  renderAdmin();
  refrescarSelectsHeader();
}

// Soft-delete (regla PRD sección 5.13/9): se oculta de la app activa pero conserva su
// histórico de evaluaciones/tareas — igual que se hizo con Arbopance/Brissea al migrar.
function eliminarConjunto() {
  const nombreActual = document.getElementById('conj-edit-nombre').value;
  const c = conjuntoPorNombre(nombreActual);
  if (!c) return;
  if (!confirm(`¿Eliminar "${c.n}"? Se ocultará de la app pero su historial de tareas y evaluaciones queda guardado.`)) return;
  c.deleted = true;
  DATA.usuarios.forEach(u => {
    if (u.conjuntos) u.conjuntos = u.conjuntos.filter(cn => cn !== nombreActual);
  });
  closeOv('modal-conjunto');
  programarAutoSave();
  renderAdmin();
  refrescarSelectsHeader();
  toast('Conjunto eliminado');
}

// Fuente de verdad para permisos: usuario.conjuntos. Este helper mantiene sincronizado
// ese array cada vez que se asigna/cambia el delegado de un conjunto desde Admin,
// evitando la inconsistencia detectada en los datos reales de v1.0 (conjunto.del
// apuntando a alguien que no tenía el conjunto en su propia lista).
function asignarDelegadoAConjunto(conjuntoNombre, delegadoNombre) {
  DATA.usuarios.forEach(u => {
    if (!u.conjuntos) return;
    u.conjuntos = u.conjuntos.filter(cn => cn !== conjuntoNombre);
  });
  const delegado = usuarioPorNombre(delegadoNombre);
  if (delegado) {
    delegado.conjuntos = delegado.conjuntos || [];
    if (!delegado.conjuntos.includes(conjuntoNombre)) delegado.conjuntos.push(conjuntoNombre);
  }
}

// ─── USUARIOS ─────────────────────────────────────────────────
function renderFilasUsuarios() {
  return DATA.usuarios.map((u, idx) => {
    const cedula = Object.keys(DATA.cedulas).find(c => DATA.cedulas[c].idx === idx);
    const activo = cedula ? DATA.cedulas[cedula].activo !== false : true;
    return `
      <tr>
        <td style="font-size:10px">${u.n}</td>
        <td style="font-size:9px;color:var(--txs)">${u.cargo || '—'}</td>
        <td style="font-size:9px">${u.rol === 'staff' ? 'Staff' : 'Delegado'}</td>
        <td><span style="font-size:9px;color:${activo ? 'var(--vm)' : 'var(--rj)'}">${activo ? '✅ Activo' : '⛔ Inactivo'}</span></td>
        <td><button class="btn btn-sm btn-g" style="font-size:9px;padding:2px 6px" onclick="abrirEditarUsuario(${idx})">✏️</button></td>
      </tr>`;
  }).join('') || '<tr><td colspan="5" style="font-size:10px;color:var(--txs);text-align:center;padding:10px">Sin usuarios</td></tr>';
}

function cedulaPorIdxUsuario(idx) {
  return Object.keys(DATA.cedulas).find(c => DATA.cedulas[c].idx === idx);
}

function abrirNuevoUsuario() {
  document.getElementById('usr-modal-titulo').textContent = '➕ Nuevo usuario';
  document.getElementById('usr-btn-guardar').textContent = '✓ Crear';
  document.getElementById('usr-btn-eliminar').classList.add('oculto');
  document.getElementById('usr-edit-idx').value = '-1';
  document.getElementById('usr-nombre').value = '';
  document.getElementById('usr-cedula').value = '';
  document.getElementById('usr-cedula').disabled = false;
  document.getElementById('usr-rol').value = 'delegado';
  document.getElementById('usr-cargo').value = '';
  document.getElementById('usr-equipo').value = 'Ambos';
  document.getElementById('usr-activo').value = 'true';
  document.getElementById('usr-conjuntos-wrap').classList.add('oculto');
  openOv('modal-usuario');
}

function abrirEditarUsuario(idx) {
  const u = DATA.usuarios[idx];
  if (!u) return;
  const cedula = cedulaPorIdxUsuario(idx);
  const activo = cedula ? DATA.cedulas[cedula].activo !== false : true;
  document.getElementById('usr-modal-titulo').textContent = '✏️ Editar usuario';
  document.getElementById('usr-btn-guardar').textContent = '✓ Guardar cambios';
  document.getElementById('usr-btn-eliminar').classList.remove('oculto');
  document.getElementById('usr-edit-idx').value = String(idx);
  document.getElementById('usr-nombre').value = u.n;
  document.getElementById('usr-cedula').value = cedula || '';
  document.getElementById('usr-cedula').disabled = true; // cambiar cédula podría romper el login; se edita aparte si hace falta
  document.getElementById('usr-rol').value = u.rol;
  document.getElementById('usr-cargo').value = u.cargo || '';
  document.getElementById('usr-equipo').value = u.equipo || 'Ambos';
  document.getElementById('usr-activo').value = String(activo);
  document.getElementById('usr-conjuntos-wrap').classList.remove('oculto');
  document.getElementById('usr-conjuntos-lista').textContent = (u.conjuntos && u.conjuntos.length) ? u.conjuntos.join(', ') : 'Sin conjuntos asignados';
  openOv('modal-usuario');
}

function guardarUsuario() {
  const nombre = document.getElementById('usr-nombre').value.trim();
  if (!nombre) { toast('El nombre es obligatorio'); return; }
  const cedula = document.getElementById('usr-cedula').value.trim();
  if (!cedula) { toast('La cédula es obligatoria'); return; }
  const rol = document.getElementById('usr-rol').value;
  const cargo = document.getElementById('usr-cargo').value.trim();
  const equipo = document.getElementById('usr-equipo').value;
  const activo = document.getElementById('usr-activo').value === 'true';

  const editIdx = parseInt(document.getElementById('usr-edit-idx').value, 10);
  if (editIdx >= 0) {
    const u = DATA.usuarios[editIdx];
    Object.assign(u, { n: nombre, rol, cargo, equipo });
    const cedulaExistente = cedulaPorIdxUsuario(editIdx);
    if (cedulaExistente) DATA.cedulas[cedulaExistente].activo = activo;
    toast('✓ Usuario actualizado');
  } else {
    if (DATA.cedulas[cedula]) { toast('Esa cédula ya está registrada'); return; }
    const idx = DATA.usuarios.length;
    DATA.usuarios.push({ n: nombre, rol, conjuntos: [], cargo, equipo, av: iniciales(nombre), c: '#4a7c59', ra: nombre.split(' ')[0].toLowerCase() });
    DATA.cedulas[cedula] = { idx, rol, activo };
    toast('✓ Usuario creado');
  }
  closeOv('modal-usuario');
  programarAutoSave();
  renderAdmin();
}

// No se elimina físicamente (regla PRD sección 5.13: "no eliminar para no perder
// historial") — "Eliminar" aquí desactiva el acceso del usuario.
function eliminarUsuario() {
  const editIdx = parseInt(document.getElementById('usr-edit-idx').value, 10);
  const u = DATA.usuarios[editIdx];
  if (!u) return;
  if (!confirm(`¿Desactivar a "${u.n}"? No podrá iniciar sesión, pero su historial se conserva.`)) return;
  const cedula = cedulaPorIdxUsuario(editIdx);
  if (cedula) DATA.cedulas[cedula].activo = false;
  closeOv('modal-usuario');
  programarAutoSave();
  renderAdmin();
  toast('Usuario desactivado');
}

// ─── TAREAS RECURRENTES (base) ─────────────────────────────────
function renderFilasTareasRec() {
  return DATA.tareasRec.map((t, idx) => {
    if (t.deleted) return '';
    return `
      <tr>
        <td style="font-size:10px">${t.n}</td>
        <td style="font-size:9px;color:var(--txs)">${t.aplica}</td>
        <td style="font-size:9px;color:var(--txs)">${t.frec || 'mensual'}</td>
        <td style="font-size:10px;text-align:center">${t.veces || 1}</td>
        <td style="font-size:10px;text-align:center;${t.bimestral ? 'color:var(--vm)' : ''}">${t.bimestral ? '✓' : '—'}</td>
        <td style="font-size:10px;text-align:center;${t.foto ? 'color:var(--vm)' : ''}">${t.foto ? '📷' : '—'}</td>
        <td style="font-size:10px;text-align:center">${t.autoEval === false ? '—' : (t.evalPts ?? 1)}</td>
        <td>
          <button class="btn btn-sm btn-g" style="font-size:9px;padding:2px 6px" onclick="abrirEditarTareaRecurrente(${idx})">✏️</button>
          <button class="btn btn-sm" style="font-size:9px;padding:2px 6px;background:#fce8e6;color:var(--rj)" onclick="eliminarTareaRecurrente(${idx})">🗑</button>
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="8" style="font-size:10px;color:var(--txs);text-align:center;padding:10px">Sin tareas recurrentes</td></tr>';
}

// Frecuencia determina veces/bimestral automáticamente — evita pedirlos por separado
const FRECUENCIA_A_VECES = { mensual: 1, quincenal: 2, semanal: 4, bimestral: 1 };

function abrirNuevaTareaRecurrente() {
  document.getElementById('rec-modal-titulo').textContent = '➕ Nueva tarea recurrente';
  document.getElementById('rec-btn-guardar').textContent = '✓ Crear';
  document.getElementById('rec-edit-idx').value = '-1';
  document.getElementById('rec-nombre').value = '';
  document.getElementById('rec-desc').value = '';
  document.getElementById('rec-frecuencia').value = 'mensual';
  document.getElementById('rec-aplica').value = 'Todos';
  document.getElementById('rec-puntos').value = '1';
  document.getElementById('rec-limite').value = '';
  document.getElementById('rec-cuando').value = '';
  document.getElementById('rec-foto').checked = false;
  document.getElementById('rec-fecha-variable').checked = false;
  document.getElementById('rec-fecha-individual').checked = false;
  openOv('modal-tarea-rec');
}

function abrirEditarTareaRecurrente(idx) {
  const t = DATA.tareasRec[idx];
  if (!t) return;
  document.getElementById('rec-modal-titulo').textContent = '✏️ Editar tarea recurrente';
  document.getElementById('rec-btn-guardar').textContent = '✓ Guardar cambios';
  document.getElementById('rec-edit-idx').value = String(idx);
  document.getElementById('rec-nombre').value = t.n;
  document.getElementById('rec-desc').value = t.desc || '';
  document.getElementById('rec-frecuencia').value = t.frec || 'mensual';
  document.getElementById('rec-aplica').value = t.aplica || 'Todos';
  document.getElementById('rec-puntos').value = String(t.evalPts ?? 1);
  document.getElementById('rec-limite').value = t.limite || '';
  document.getElementById('rec-cuando').value = t.cuando || '';
  document.getElementById('rec-foto').checked = !!t.foto;
  document.getElementById('rec-fecha-variable').checked = !!t.fechaVariable;
  document.getElementById('rec-fecha-individual').checked = !!t.fechaIndividual;
  openOv('modal-tarea-rec');
}

function guardarTareaRecurrente() {
  const nombre = document.getElementById('rec-nombre').value.trim();
  if (!nombre) { toast('El nombre es obligatorio'); return; }
  const desc = document.getElementById('rec-desc').value.trim();
  const frec = document.getElementById('rec-frecuencia').value;
  const aplica = document.getElementById('rec-aplica').value;
  const evalPts = parseInt(document.getElementById('rec-puntos').value, 10) || 0;
  const limite = document.getElementById('rec-limite').value.trim();
  const cuando = document.getElementById('rec-cuando').value.trim();
  const foto = document.getElementById('rec-foto').checked;
  const fechaVariable = document.getElementById('rec-fecha-variable').checked;
  const fechaIndividual = document.getElementById('rec-fecha-individual').checked;
  const veces = FRECUENCIA_A_VECES[frec] || 1;
  const bimestral = frec === 'bimestral';
  const autoEval = evalPts > 0;

  const editIdx = parseInt(document.getElementById('rec-edit-idx').value, 10);
  if (editIdx >= 0) {
    const t = DATA.tareasRec[editIdx];
    Object.assign(t, { n: nombre, desc, frec, aplica, veces, bimestral, foto, fechaVariable, fechaIndividual, autoEval, evalPts, cuando, limite });
    toast('✓ Tarea recurrente actualizada');
  } else {
    const idx = DATA.tareasRec.length;
    DATA.tareasRec.push({ n: nombre, desc, aplica, frec, veces, cuando, limite, bimestral, foto, fechaVariable, fechaIndividual, autoEval, evalPts, deleted: false });
    inicializarSlotsNuevaTareaRec(idx);
    toast('✓ Tarea recurrente creada');
  }
  closeOv('modal-tarea-rec');
  programarAutoSave();
  renderAdmin();
}

function eliminarTareaRecurrente(idx) {
  const t = DATA.tareasRec[idx];
  if (!t) return;
  if (!confirm(`¿Eliminar "${t.n}"? Esta acción no borra su historial, solo la oculta de las tareas activas.`)) return;
  t.deleted = true; // marcar deleted, nunca eliminar físicamente (regla sección 5.13)
  programarAutoSave();
  renderAdmin();
  toast('Tarea recurrente eliminada');
}

function iniciales(nombre) {
  return nombre.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

// ─── CAPACIDAD Y BACKUP ────────────────────────────────────────
// Se copia la tarea COMPLETA (no solo id/nombre/estado) para que el conjunto, la observación,
// los comentarios y las fechas de gestión (creadoEn/enProcesoEn/finalizadoEn/aprobadoEn) queden
// disponibles después de archivar — antes se perdían, y son la base del reporte por conjunto.
function archivarAprobadas() {
  const aprobadas = DATA.tareasEve.filter(t => t.est === 'Aprobado');
  if (!aprobadas.length) { toast('No hay tareas aprobadas para archivar'); return; }
  aprobadas.forEach(t => {
    DATA.tareasArchivo.push({ ...t, archivedAt: fechaCortaCol() });
    DATA.deletedEveIds.push(t.id);
  });
  DATA.tareasEve = DATA.tareasEve.filter(t => t.est !== 'Aprobado');
  programarAutoSave();
  renderAdmin();
  toast(`📦 ${aprobadas.length} tareas archivadas`);
}

function verHistorialArchivadas() {
  const lista = DATA.tareasArchivo.map(t => `${t.id} — ${t.n} (${t.est}, ${t.archivedAt})`).join('\n');
  alert(lista || 'Sin tareas archivadas');
}

// Descarga UN PDF POR CONJUNTO con todo el archivo actual (tarea, tipo, fechas de gestión,
// comentarios completos) y ofrece vaciar el archivo interno después — así no se pierde
// información pero tampoco se acumula para siempre dentro de la app.
function descargarInformeArchivo() {
  if (!DATA.tareasArchivo.length) { toast('No hay tareas archivadas para descargar'); return; }
  if (typeof window.jspdf === 'undefined') { toast('Librería jsPDF no cargada'); return; }

  const fmt = ms => ms ? new Date(ms).toLocaleDateString('es-CO') : '–';
  const { jsPDF } = window.jspdf;

  const porConjunto = {};
  DATA.tareasArchivo.forEach(t => {
    const conj = t.conj || 'Sin conjunto';
    porConjunto[conj] = porConjunto[conj] || [];
    porConjunto[conj].push(t);
  });

  const marcaTiempo = tsCol().replace(/[/: ]/g, '_');
  Object.keys(porConjunto).sort().forEach(conj => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.setTextColor(26, 58, 42);
    doc.text(`A&V Victoria Pineda Administraciones — Archivo de aprobadas · ${conj}`, 14, 18);
    doc.autoTable({
      startY: 24,
      head: [['ID', 'Tarea', 'Tipo', 'Creada', 'Finalizada', 'Aprobada', 'Archivada', 'Comentarios']],
      body: porConjunto[conj].map(t => [
        t.id, t.n, t.tipo || '–',
        fmt(t.creadoEn), fmt(t.finalizadoEn), fmt(t.aprobadoEn), t.archivedAt || '–',
        (t.coms || []).join('\n') || '–'
      ]),
      styles: { fontSize: 7, cellWidth: 'wrap' },
      columnStyles: { 7: { cellWidth: 50 } },
      headStyles: { fillColor: [45, 90, 61] },
      margin: { left: 14, right: 14 }
    });
    doc.save(`GestionPH_Archivo_${conj.replace(/\s+/g, '_')}_${marcaTiempo}.pdf`);
  });

  toast(`📥 ${DATA.tareasArchivo.length} tareas descargadas en ${Object.keys(porConjunto).length} PDF(s), uno por conjunto`);

  if (confirm(`Se descargaron ${DATA.tareasArchivo.length} tareas archivadas (${Object.keys(porConjunto).length} PDFs, uno por conjunto).\n\n¿Vaciar el archivo interno ahora que ya quedó respaldado? Esto libera espacio en la app. No se puede deshacer dentro de GestiónPH — el respaldo queda solo en los PDFs descargados.`)) {
    DATA.tareasArchivo = [];
    programarAutoSave();
    renderAdmin();
    toast('🗑 Archivo interno vaciado');
  }
}

function limpiarCacheLocal() {
  if (!confirm('¿Limpiar caché local? Esto no afecta los datos en Firebase.')) return;
  localStorage.removeItem(LOCAL_STORAGE_KEY);
  toast('🗑 Caché local limpiado');
}

function exportarBackup() {
  const snap = buildSnapshot();
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gestionph_backup_${fechaCortaCol().replace('/', '-')}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  localStorage.setItem(BACKUP_KEY, semanaISO());
  toast('📥 Backup exportado');
}

function restaurarBackupDesdeArchivo(file) {
  if (!file) return;
  if (!confirm('¿Restaurar este backup? Esto reemplazará los datos actuales (excepto el estado de recurrentes).')) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const snap = JSON.parse(reader.result);
      restaurarBackup(snap).then(() => { renderAdmin(); refrescarSelectsHeader(); });
    } catch (e) {
      toast('Error: archivo JSON inválido');
    }
  };
  reader.readAsText(file);
}

// ─── MIGRACIÓN INICIAL DESDE v1.0 ──────────────────────────────
// A diferencia de restaurarBackup (operación normal, sección 6.4, que preserva ESTADO
// actual), esta migración es de una sola vez: importa TODO el backup de v1.0,
// incluyendo ESTADO de recurrentes, porque en v2.0 todavía no existe ningún dato propio
// que se pueda perder.
//
// Conjuntos retirados/no administrados detectados en los datos reales (confirmado con
// el usuario): "Arbopance" y "Brissea" se excluyen de la migración. "Romero" se corrige
// para apuntar a Alejandro Carmona como delegado (el campo 'del' original decía
// "Andrés Serna", quien ya no trabaja con A&V).
const CONJUNTOS_EXCLUIDOS_MIGRACION = ['Arbopance', 'Brissea'];
const CORRECCIONES_DELEGADO_MIGRACION = { 'Romero': 'Alejandro Carmona' };

function migrarBackupV1DesdeArchivo(file) {
  if (!file) return;
  if (!confirm('¿Migrar este backup de v1.0? Esto reemplaza TODOS los datos actuales de v2.0, incluyendo el estado de recurrentes. Usar solo una vez al iniciar.')) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const snap = JSON.parse(reader.result);
      migrarBackupV1(snap);
      renderAdmin();
      refrescarSelectsHeader();
      if (typeof renderPestanaActual === 'function') renderPestanaActual();
    } catch (e) {
      console.error(e);
      toast('Error: archivo JSON inválido');
    }
  };
  reader.readAsText(file);
}

function migrarBackupV1(snap) {
  const limpio = limpiarConjuntosExcluidos(snap);

  DATA.conjuntos = limpio.conjuntos || { def: [], pro: [] };
  DATA.usuarios = limpio.usuarios || [];
  DATA.cedulas = limpio.cedulas || {};
  DATA.cedActivos = limpio.cedActivos || {};
  DATA.tareasRec = (limpio.tareasRec || []).map(normalizarTareaRec);
  DATA.tareasEve = limpio.tareasEve || [];
  DATA.deletedEveIds = limpio.deletedEveIds || [];
  DATA.tareasArchivo = limpio.tareasArchivo || [];
  DATA.tareasAV = limpio.tareasAV || [];
  ESTADO = limpio.estado || {};
  REC_COMS = limpio.recComs || {};
  EVAL_MANUAL = limpio.evalManual || {};
  FECHAS_LIMITE_REC = limpio.fechasLimiteRec || {};
  FECHAS_LIMITE_REC_GLOBAL = limpio.fechasLimiteRecGlobal || {};

  // Corrección puntual confirmada: Romero pasa a Alejandro Carmona
  Object.entries(CORRECCIONES_DELEGADO_MIGRACION).forEach(([conjNombre, delegadoNombre]) => {
    const c = conjuntoPorNombre(conjNombre);
    if (c) c.del = delegadoNombre;
    asignarDelegadoAConjunto(conjNombre, delegadoNombre);
  });

  guardarLocal();
  toast(`✓ Migración completa: ${DATA.tareasEve.length} eventuales, ${DATA.usuarios.length} usuarios, ${todosLosConjuntos().length} conjuntos`);
}

// Tareas confirmadas por el usuario como las únicas que necesitan fecha fijada manualmente
// cada mes (el resto se queda con su límite descriptivo de siempre, sin campo de fecha)
const TAREAS_FECHA_VARIABLE = [
  'Envío movimientos, recaudos y extracto',
  'Facturación a copropietarios',
  'Envío movimientos y recaudos (día 10)',
  'Envío informe gestión + convocatoria consejo',
  'Envío acta de reunión de consejo',
  'Radicación cuenta cobro constructora Bolívar'
];

// Nombres únicos de tareas marcadas como "fecha variable" (checkbox en el modal de edición),
// deduplicados porque hay entradas repetidas por nombre (Definitivos / Provisional (A&V))
function nombresTareasFechaCompartida() {
  const nombres = DATA.tareasRec.filter(t => !t.deleted && t.fechaVariable).map(t => t.n);
  return [...new Set(nombres)];
}

// Una fila por tarea (por nombre, no por índice — evita repetir la Definitivos/Provisional
// duplicada) con un único campo de fecha que aplica a TODOS los conjuntos ese mes.
function renderFilasFechaGlobal() {
  const mes = getMes();
  return nombresTareasFechaCompartida().map(nombre => {
    const fecha = getFechaLimiteRecGlobal(mes, nombre);
    return `
      <tr>
        <td style="font-size:10px">${nombre}</td>
        <td>
          <input type="date" class="form-input" style="padding:4px 6px;font-size:10px"
            value="${fechaCortaAIso(fecha)}" onchange="guardarFechaGlobal('${nombre}', this.value)">
        </td>
      </tr>`;
  }).join('');
}

function guardarFechaGlobal(nombre, iso) {
  const mes = getMes();
  const fecha = isoAFechaCorta(iso);
  setFechaLimiteRecGlobal(mes, nombre, fecha);
  programarAutoSave();
  toast(fecha ? `✓ Fecha de "${nombre}" fijada: ${fecha}` : 'Fecha borrada');
}

function normalizarTareaRec(t) {
  return {
    ...t,
    veces: t.veces || 1,
    frec: t.frec || 'mensual',
    cuando: t.cuando || '',
    limite: t.limite || '',
    bimestral: !!t.bimestral,
    foto: !!t.foto,
    autoEval: t.autoEval !== false,
    evalPts: t.evalPts ?? 1,
    // Si el campo ya viene explícito (true o false) se respeta tal cual — el fallback a la
    // lista vieja TAREAS_FECHA_VARIABLE solo aplica cuando el campo nunca se definió (datos muy
    // viejos). Antes un OR aquí ignoraba cualquier "false" explícito para estas tareas.
    fechaVariable: t.fechaVariable !== undefined ? t.fechaVariable === true : TAREAS_FECHA_VARIABLE.includes(t.n),
    fechaIndividual: t.fechaIndividual === true,
    deleted: !!t.deleted
  };
}

// Elimina conjuntos no administrados (y sus referencias) del snapshot antes de aplicarlo
function limpiarConjuntosExcluidos(snap) {
  const limpio = JSON.parse(JSON.stringify(snap));
  ['def', 'pro'].forEach(tipo => {
    if (limpio.conjuntos && limpio.conjuntos[tipo]) {
      limpio.conjuntos[tipo] = limpio.conjuntos[tipo].filter(c => !CONJUNTOS_EXCLUIDOS_MIGRACION.includes(c.n));
    }
  });
  CONJUNTOS_EXCLUIDOS_MIGRACION.forEach(nombre => {
    delete limpio.estado?.[nombre];
    delete limpio.recComs?.[nombre];
    delete limpio.evalManual?.[nombre];
  });
  if (limpio.tareasEve) limpio.tareasEve = limpio.tareasEve.filter(t => !CONJUNTOS_EXCLUIDOS_MIGRACION.includes(t.conj));
  if (limpio.tareasArchivo) limpio.tareasArchivo = limpio.tareasArchivo.filter(t => !CONJUNTOS_EXCLUIDOS_MIGRACION.includes(t.conj));
  if (limpio.usuarios) {
    limpio.usuarios.forEach(u => {
      if (u.conjuntos) u.conjuntos = u.conjuntos.filter(cn => !CONJUNTOS_EXCLUIDOS_MIGRACION.includes(cn));
    });
  }
  return limpio;
}

// ─── BACKUP AUTOMÁTICO SEMANAL (regla 6.8) ────────────────────
function verificarBackupAutomatico() {
  const semanaActual = semanaISO();
  const ultimoBackup = localStorage.getItem(BACKUP_KEY);
  if (ultimoBackup !== semanaActual) {
    exportarBackup();
  }
}
