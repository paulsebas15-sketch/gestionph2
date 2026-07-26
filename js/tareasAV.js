// tareasAV.js — Tareas internas del equipo A&V (no de conjuntos, sin delegados)
// GestiónPH v2.0
// Depende de: config.js, datos.js, ui.js

function renderTareasAV() {
  const cont = document.getElementById('content-tareasAV');
  if (!cont) return;

  cont.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
      <button class="btn btn-v btn-sm" onclick="abrirNuevaTareaAV()">➕ Nueva tarea A&V</button>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <table class="tbl">
        <thead><tr><th>ID</th><th>Nombre</th><th>Estado</th><th>Vence</th><th></th></tr></thead>
        <tbody>${DATA.tareasAV.map(renderFilaTareaAV).join('')}</tbody>
      </table>
      ${!DATA.tareasAV.length ? '<div style="text-align:center;padding:16px;font-size:11px;color:var(--txs)">Sin tareas internas registradas</div>' : ''}
    </div>
  `;
}

function renderFilaTareaAV(t) {
  return `
    <tr>
      <td style="font-size:10px;color:var(--txs)">${t.id}</td>
      <td style="font-size:11px;font-weight:500">${t.n}</td>
      <td>${badgeEstadoHtml(t.est)}</td>
      <td style="font-size:10px">${t.vence}</td>
      <td>
        <select class="form-input" style="font-size:9px;padding:2px 4px" onchange="cambiarEstadoTareaAV('${t.id}', this.value)">
          ${ESTADOS_EVENTUAL.map(e => `<option ${e === t.est ? 'selected' : ''}>${e}</option>`).join('')}
        </select>
      </td>
    </tr>
  `;
}

function abrirNuevaTareaAV() {
  const nombre = prompt('Nombre de la tarea A&V:');
  if (!nombre) return;
  const vence = prompt('Fecha de vencimiento (DD/MM):', fechaCortaCol());
  const id = siguienteIdAV();
  DATA.tareasAV.push({ id, n: nombre, est: 'Nuevo', vence: vence || fechaCortaCol() });
  guardarLocal();
  guardarTareaAVEnSupabase(id); // guardado individual: solo esta tarea, ninguna otra se toca
  renderTareasAV();
}

function cambiarEstadoTareaAV(id, estado) {
  const t = DATA.tareasAV.find(t => t.id === id);
  if (!t) return;
  t.est = estado;
  guardarLocal();
  guardarTareaAVEnSupabase(id); // guardado individual: solo esta tarea, ninguna otra se toca
  renderTareasAV();
}
