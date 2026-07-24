# GestiónPH v2.0 — Contexto del proyecto

**A&V Victoria Pineda Administraciones · Cali, Colombia**
Última actualización: 22 julio 2026

## Por qué existe esto

La v1.0 era un solo archivo HTML de ~450KB — cualquier cambio puntual rompía otras funcionalidades. GestiónPH v2.0 se reconstruyó **desde cero** (sin mirar el código viejo) con arquitectura multi-archivo para que cada módulo se edite y pruebe de forma aislada.

## Ubicación y stack

- Carpeta: `GestionPH_v2/` dentro de "A&V Administración"
- HTML/CSS/JS vanilla, sin build step — apto para GitHub Pages (subida manual, la hace el usuario)
- Backend: Firebase Realtime Database — **hoy con credenciales placeholder** en `js/config.js` (`FIREBASE_CONFIG`). Falta: crear proyecto Firebase real (nuevo, separado de v1.0) y pegar credenciales ahí.
- Sin backup real migrado a Firebase todavía — solo probado en localStorage del navegador durante desarrollo.

## Estructura de archivos

```
GestionPH_v2/
├── index.html              ← estructura + todos los modales
├── assets/logo.png          ← logo A&V (login, header, PDF)
├── css/estilos.css
└── js/
    ├── config.js           ← constantes, FIREBASE_CONFIG, helpers de fecha
    ├── datos.js            ← DATA, ESTADO, snapshot, persistencia local
    ├── firebase.js         ← conexión + reglas de merge (nunca conectado a Firebase real aún)
    ├── auth.js             ← login por cédula, permisos por rol/pestaña
    ├── ui.js                ← toast, modales, semáforo, filtros globales
    ├── calendario.js       ← NUEVO: grilla mensual de eventos
    ├── recurrentes.js      ← checklist mensual por conjunto
    ├── dashboard.js        ← métricas + tarjeta de pendientes (delegado)
    ├── eventuales.js       ← CRUD tareas eventuales, chips de filtro
    ├── aprobaciones.js / validaciones.js
    ├── evaluacion.js       ← plantilla de puntos Definitivos/Provisional
    ├── rendimiento.js      ← por delegado, separado por conjunto
    ├── informes.js         ← PDF con jsPDF + logo
    ├── tareasAV.js
    ├── admin.js            ← conjuntos, usuarios, tareas recurrentes, fechas globales, backup
    └── main.js             ← bootstrap, login, navegación
```

## Roles y permisos

- **Staff** (Paul, Victoria, Tania): ve todo — Dashboard, Calendario, Recurrentes, Eventuales, Aprobaciones, Validaciones, Rendimiento, Evaluación, Informes, Tareas A&V, Admin.
- **Delegado**: Dashboard, Calendario, Recurrentes, Eventuales, Rendimiento, Informes. **No ve Aprobaciones/Validaciones/Evaluación/Admin.**
- Login por cédula (`DATA.cedulas[cedula] = {idx, rol, activo}`), sesión en `localStorage`.
- `usuario.conjuntos` (array) es la fuente de verdad de qué conjuntos administra un delegado — se asigna **desde el conjunto** (Admin → Conjuntos → Delegado), no desde el usuario.

## El selector de conjunto del header

Filtra: **Calendario, Recurrentes, Eventuales, Aprobaciones, Validaciones, Evaluación**.
NO filtra (quedan generales/todos los conjuntos): **Dashboard, Rendimiento**.
Si está en "Todos" y la pestaña necesita un conjunto específico (Recurrentes/Evaluación), se pide elegir uno en vez de adivinar.

## Modelo de datos clave

- `DATA.tareasRec`: lista de tareas recurrentes. **OJO**: hay entradas duplicadas por nombre — una versión `aplica:'Definitivos'` y otra `aplica:'Provisional (A&V)'` para las tareas compartidas. Siempre filtrar por nombre **y** tipo (`tipoConjunto()`), nunca solo por nombre (bug real que se corrigió en evaluación).
- `ESTADO[conjunto][mes][tareaIdx][slotIdx] = {done, ts, undoneAt, hasFoto, fotoCount}` — `veces` define cuántos slots tiene una tarea al mes (semanal=4, quincenal=2, mensual=1).
- `FECHAS_LIMITE_REC_GLOBAL[mes][tareaNombre]` = fecha **compartida por todos los conjuntos**, para 6 tareas específicas marcadas `fechaVariable:true`. Se edita **una sola vez en Admin** (no por conjunto). Lista exacta en `admin.js` → `TAREAS_FECHA_VARIABLE`.
- `FECHAS_LIMITE_REC[conjunto][mes][tareaIdx]` = fecha **por conjunto**, usada solo por "Reunión de consejo de adm." — se sincroniza automáticamente al crear un evento de Calendario tipo "Reunión de consejo".
- `EVAL_MANUAL[conjunto][mes] = {tareas: {nombreTarea: puntos}, asistencia: score}` — ajustes manuales de evaluación.
- `DATA.eventosCalendario`: eventos del calendario — `{id, tipo, conjunto, titulo, fecha (ISO), hora, participantes, creadoPor}`.
- `FOTOS_LOCAL` (localStorage aparte, no viaja a Firebase): fotos de evidencia de tareas recurrentes.

## Reglas de negocio importantes

1. **Bimestral** (ej. Pago reteica): solo aplica en meses impares (Ene/Mar/May/Jul/Sep/Nov). Un solo helper `esMesImpar()` — nunca duplicar esta lógica.
2. **Recurrentes**: desmarcar una tarea pide confirmación (`confirm()`). Checkbox con ancho fijo (30px) para que no se corra al marcar.
3. **Multi-conjunto** (tareas eventuales y eventos de calendario): checkboxes editables incluso para delegados con 2+ conjuntos (antes estaban deshabilitados — bug corregido, causaba duplicar sin querer).
4. **Eventuales**: chips multi-selección de Estado y Vigencia (no dropdowns). La lista usa un "snapshot" — cambiar el estado de una tarea mientras se trabaja NO la hace desaparecer de la lista visible hasta que se cambie un filtro o se reabra la pestaña.
5. **Evaluación**: plantillas fijas de puntos — Definitivos = 32 pts, Provisional = 35 pts (transcritas y verificadas contra datos reales, ej. Moka dio 13/32=41% coincidiendo con v1.0). Incluye ítems especiales "Gestión tareas eventuales" (auto, por % finalizadas) y "Asistencia y puntualidad" (manual 0-100). Los puntos manuales se clampean 0–peso.
6. **Fotos**: se guardan localmente (no en el snapshot principal) para no inflar el payload. Visor "👁️ Ver foto" disponible para cualquiera que vea la tarea.
7. **Conjuntos**: eliminar es soft-delete (`c.deleted=true`) — se oculta pero conserva historial.
8. **Usuarios**: "eliminar" en realidad desactiva (`cedulas[ced].activo=false`) — nunca se borra para no perder historial.
9. **Calendario**: 5 tipos (Reunión de consejo, Recorrido, Reunión con proveedores, Capacitación, Otro). Capacitación no lleva conjunto (transversal, por participantes). Delegado solo ve/crea eventos de sus conjuntos + capacitaciones donde participe; edita solo lo que él creó, Staff edita todo. Clic en un día de la grilla crea evento con esa fecha prellenada.

## Migración de datos reales (pendiente hacerla "oficial")

Ya se probó una vez en sesión de desarrollo con el backup real de v1.0 (672 tareas eventuales, 11 usuarios, 11 conjuntos). Hallazgos de esa migración:
- **Arbopance y Brissea** se excluyen (conjuntos ya no administrados).
- **Romero** → delegado corregido a Alejandro Carmona (antes decía "Andrés Serna", ya no trabaja ahí).
- **Macadamia** → delegado Juan Diego Carrillo.
- Botón en Admin: "🔄 Migrar backup v1.0 (una sola vez)" — usar solo cuando haya Firebase real configurado, con un backup fresco desde v1.0.
- **Importante**: los datos actuales en el navegador de pruebas están "contaminados" por pruebas QA (aprobaciones, cambios de estado de prueba). Antes de usar en producción: Admin → "Limpiar caché local" y volver a migrar desde el backup original.

## Pendiente / próximos pasos

1. Crear proyecto Firebase real (nuevo, separado) y pegar credenciales en `config.js`.
2. Migrar el backup real de v1.0 "en limpio" (sin contaminar con datos de prueba).
3. Subir a GitHub Pages (lo hace el usuario manualmente).
4. Revisar visualmente la plantilla de evaluación Provisional (Romero/Macadamia) con un caso real, ya que solo Definitivos (Moka) se verificó número por número contra la v1.0.

## Cómo probar localmente

Abrir `index.html` directamente en el navegador (o vía la vista previa). Si se edita un `.js` y los cambios no se reflejan, es caché del navegador — agregar temporalmente `?cb=NUMERO` a los `<script src="js/...">` en `index.html`, recargar, y quitarlo después.
