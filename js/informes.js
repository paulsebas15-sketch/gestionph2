// informes.js — Exportar informes PDF (eventuales + recurrentes) con jsPDF
// GestiónPH v2.0
// Depende de: config.js, datos.js, recurrentes.js
// Requiere librería externa jsPDF cargada en index.html

function renderInformes() {
  const cont = document.getElementById('content-informes');
  if (!cont) return;
  const conjuntos = todosLosConjuntos().filter(c => esStaff() || puedeVerConjunto(c.n));
  const conjuntoDefault = CONJUNTO_SELECCIONADO !== 'Todos' ? CONJUNTO_SELECCIONADO : (conjuntos[0] && conjuntos[0].n);

  cont.innerHTML = `
    <div class="card">
      <div class="card-title">Generar informe PDF</div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Conjunto</label>
          <select class="form-input" id="informe-conjunto">
            ${esStaff() ? '<option value="__todos__">Todos</option>' : ''}
            ${conjuntos.map(c => `<option value="${c.n}" ${c.n === conjuntoDefault ? 'selected' : ''}>${c.n}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label class="form-label">Periodo</label>
          <select class="form-input" id="informe-periodo" onchange="actualizarVisibilidadMesInforme()">
            <option value="mes">Mes completo</option>
            <option value="hoy">Hoy</option>
            <option value="semana">Esta semana (últimos 7 días)</option>
          </select>
        </div>
        <div class="form-group" id="informe-mes-wrap"><label class="form-label">Mes</label>
          <select class="form-input" id="informe-mes">${MESES.map(m => `<option ${m === getMes() ? 'selected' : ''}>${m}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Contenido del informe</label>
        <div style="display:flex;gap:8px">
          <label style="font-size:11px;display:flex;align-items:center;gap:4px"><input type="checkbox" id="informe-eve" checked> Tareas eventuales</label>
          <label style="font-size:11px;display:flex;align-items:center;gap:4px"><input type="checkbox" id="informe-rec" checked> Tareas recurrentes</label>
        </div>
        <div style="font-size:9px;color:var(--txs);margin-top:4px">Informe de gestión para consejo: solo tareas con avance real en el periodo elegido (Nuevo→En proceso, En proceso→Finalizado, Finalizado→Aprobado) y recurrentes completadas. Pausadas y Suspendidas no se incluyen.</div>
      </div>
      <button class="btn btn-v" onclick="generarInformePDF()">📄 Generar y descargar PDF</button>
    </div>
  `;
}

function actualizarVisibilidadMesInforme() {
  const periodo = document.getElementById('informe-periodo').value;
  document.getElementById('informe-mes-wrap').style.display = periodo === 'mes' ? '' : 'none';
}

// Estados que representan avance de gestión reportable al consejo — Pausado y Suspendido quedan
// siempre fuera del informe (regla del usuario, no son "gestión" para mostrar)
const ESTADOS_GESTION_INFORME = ['En proceso', 'Finalizado', 'Aprobado'];

// El único dato que se conserva del cambio de estado es el último (t.estUpdAt), no hay historial
// completo de transiciones — se usa para saber si el avance ocurrió DENTRO del periodo del informe
function estadoCambioEnPeriodo(t, periodo, mes) {
  if (!t.estUpdAt) return false;
  return fechaEnPeriodoInforme(new Date(t.estUpdAt), periodo, mes);
}

// "Hoy" y "Semana" se calculan contra la fecha real del sistema (no contra el mes elegido en el
// header) — igual que el semáforo de vencimientos. "Semana" = últimos 7 días rodantes desde hoy.
function fechaEnPeriodoInforme(date, periodo, mes) {
  if (!date) return false;
  if (periodo === 'mes') return MESES[date.getMonth()] === mes;
  const hoy = new Date();
  if (periodo === 'hoy') {
    return date.getFullYear() === hoy.getFullYear() && date.getMonth() === hoy.getMonth() && date.getDate() === hoy.getDate();
  }
  // semana: últimos 7 días (hoy y los 6 anteriores), rango completo de día
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 6, 0, 0, 0);
  const fin = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59, 999);
  return date >= inicio && date <= fin;
}

// Meses cuyo checklist de recurrentes (ESTADO[conjunto][mes]) hay que revisar para cubrir el
// periodo pedido — "hoy" y "semana" casi siempre caen en el mes actual, pero la semana puede
// cruzar al mes anterior cerca de fin de mes
function mesesACubrirInforme(periodo, mesSeleccionado) {
  if (periodo === 'mes') return [mesSeleccionado];
  const hoy = new Date();
  const mesActual = MESES[hoy.getMonth()];
  if (periodo === 'hoy') return [mesActual];
  const hace6dias = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 6);
  const mesAnterior = MESES[hace6dias.getMonth()];
  return mesAnterior === mesActual ? [mesActual] : [mesAnterior, mesActual];
}

// Etiqueta legible del periodo para el encabezado y el nombre del PDF
function etiquetaPeriodoInforme(periodo, mes) {
  if (periodo === 'mes') return mes;
  const hoy = new Date();
  if (periodo === 'hoy') return `Hoy (${fechaCortaCol(hoy)})`;
  const hace6dias = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 6);
  return `Última semana (${fechaCortaCol(hace6dias)} - ${fechaCortaCol(hoy)})`;
}

function generarInformePDF() {
  if (typeof window.jspdf === 'undefined') {
    toast('Librería jsPDF no cargada');
    return;
  }
  const conjunto = document.getElementById('informe-conjunto').value;
  const periodo = document.getElementById('informe-periodo').value;
  const mes = document.getElementById('informe-mes').value;
  const incluirEve = document.getElementById('informe-eve').checked;
  const incluirRec = document.getElementById('informe-rec').checked;
  const etiquetaPeriodo = etiquetaPeriodoInforme(periodo, mes);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 20;

  // Logo en el encabezado — si aún no cargó (raro, es casi instantáneo), se omite sin romper el PDF
  if (LOGO_BASE64) {
    try {
      doc.addImage(LOGO_BASE64, 'PNG', 150, 10, 45, 27);
    } catch (e) {
      console.error('Error insertando logo en PDF', e);
    }
  }

  doc.setFontSize(16);
  doc.setTextColor(26, 58, 42);
  doc.text('A&V Victoria Pineda Administraciones', 14, y);
  y += 6;
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text(`Informe GestiónPH — ${conjunto === '__todos__' ? 'Todos los conjuntos' : conjunto} · ${etiquetaPeriodo}`, 14, y);
  y += 10;

  const conjuntosAIncluir = conjunto === '__todos__' ? todosLosConjuntos().map(c => c.n) : [conjunto];

  if (incluirEve) {
    y = agregarSeccionEventualesPDF(doc, y, conjuntosAIncluir, periodo, mes);
  }
  if (incluirRec) {
    y = agregarSeccionRecurrentesPDF(doc, y, conjuntosAIncluir, periodo, mes);
  }

  const totalPaginas = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Generado: ${tsCol()}`, 14, doc.internal.pageSize.height - 10);
  }

  doc.save(`GestionPH_${conjunto === '__todos__' ? 'Todos' : conjunto}_${etiquetaPeriodo.replace(/[^\w-]+/g, '_')}.pdf`);
  toast('📄 PDF generado');
}

function agregarSeccionEventualesPDF(doc, y, conjuntos, periodo, mes) {
  const tareas = DATA.tareasEve.filter(t =>
    conjuntos.includes(t.conj) &&
    ESTADOS_GESTION_INFORME.includes(t.est) &&
    estadoCambioEnPeriodo(t, periodo, mes)
  );
  if (!tareas.length) return y;

  doc.setFontSize(12);
  doc.setTextColor(26, 58, 42);
  doc.text('Tareas eventuales', 14, y);
  y += 6;

  doc.autoTable({
    startY: y,
    head: [['ID', 'Nombre', 'Creada', 'Vence', 'Tipo', 'Estado']],
    body: tareas.map(t => [t.id, t.n, t.reg, t.vence, t.tipo, t.est]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [45, 90, 61] },
    margin: { left: 14, right: 14 }
  });
  return doc.lastAutoTable.finalY + 10;
}

function agregarSeccionRecurrentesPDF(doc, y, conjuntos, periodo, mes) {
  doc.setFontSize(12);
  doc.setTextColor(26, 58, 42);
  doc.text('Tareas recurrentes', 14, y);
  y += 6;

  const meses = mesesACubrirInforme(periodo, mes);
  const filas = [];
  conjuntos.forEach(conj => {
    meses.forEach(mesIter => {
      const tareas = tareasRecPara(conj, mesIter);
      tareas.forEach(t => {
        for (let slotIdx = 0; slotIdx < (t.veces || 1); slotIdx++) {
          const slot = ensureEstadoSlot(conj, mesIter, t._idx, slotIdx);
          if (slot.done && fechaEnPeriodoInforme(parseTsCol(slot.ts), periodo, mes)) {
            filas.push([conj, t.n, 'Completado', slot.ts || '–']);
          }
        }
      });
    });
  });

  if (!filas.length) return y;

  doc.autoTable({
    startY: y,
    head: [['Conjunto', 'Tarea', 'Estado', 'Fecha']],
    body: filas,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [45, 90, 61] },
    margin: { left: 14, right: 14 }
  });
  return doc.lastAutoTable.finalY + 10;
}
