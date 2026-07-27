# GestiónPH v2.0 — Contexto del proyecto

**A&V Victoria Pineda Administraciones · Cali, Colombia**
Última actualización: 26 julio 2026 — **app en producción, con datos reales, Supabase conectado (datos y fotos). Firebase ya NO se usa para nada.**

## Por qué existe esto

La v1.0 era un solo archivo HTML de ~450KB — cualquier cambio puntual rompía otras funcionalidades. GestiónPH v2.0 se reconstruyó **desde cero** con arquitectura multi-archivo para que cada módulo se edite y pruebe de forma aislada.

## Estado actual (resumen ejecutivo)

- ✅ App **desplegada en GitHub Pages**, repo `https://github.com/paulsebas15-sketch/gestionph2`.
- ✅ **663 tareas eventuales reales, 39 tareas recurrentes, 11 conjuntos, 11 usuarios** en uso.
- ✅ Backend **único**: **Supabase** (Postgres + Row Level Security + Storage) — datos Y fotos. Firebase se eliminó por completo el 26 de julio de 2026 (SDK, `firebase.js`, credenciales) — ya no hay ninguna dependencia de Firebase en la app.
- ✅ Autenticación: cada cédula tiene una cuenta real de Supabase Auth por detrás (correo sintético `cedula@usuarios-gestionph.com`), invisible para el usuario. Un **trigger automático** en Supabase vincula `auth_id` en el primer login real de cualquier usuario, nuevo o viejo — ya no requiere ningún paso manual.
- ✅ **Guardado quirúrgico**: cada acción individual del usuario (marcar una casilla, cambiar un estado, editar un conjunto, etc.) guarda **solo la fila puntual que cambió** en Supabase — nunca "todo junto". No queda ningún guardado genérico tipo snapshot completo en la app.

## Stack y arquitectura de datos

**Todo vive en Supabase**: 14 tablas relacionales (Postgres + RLS) para datos, más 1 bucket privado de Storage para fotos.

### Guardado quirúrgico — cómo funciona

Cada tabla tiene su propia función de guardado individual en `js/supabase.js` (ej. `guardarTareaEventualEnSupabase(id)`, `guardarEstadoSlotEnSupabase(conjunto, mes, tareaIdx, slotIdx)`, `guardarConjuntoEnSupabase(...)`), llamada directamente desde el archivo de UI correspondiente (`eventuales.js`, `recurrentes.js`, `admin.js`, etc.) apenas ocurre la acción. Cada una:
1. Llama `guardarLocal()` de inmediato (para no perder nada si se cierra el navegador).
2. Espera un debounce corto (`SAVE_DELAY`, 600ms) — para que varias ediciones seguidas a LA MISMA fila no disparen guardados sueltos.
3. Hace `upsert`/`insert`/`delete`/`update` puntual contra Supabase — nunca reenvía ni toca ninguna otra fila de la tabla.

Las tablas cuyo id lo genera el cliente (`tareas_eventuales` con formato `T-XXX`, `tareas_av` con `AV-XXX`, `eventos_calendario` con `EV-XXX`) usan `upsert()` simple, sirve para crear y editar por igual. Las que dependen de un id autogenerado por Supabase (`usuarios`, `tareas_recurrentes_catalogo`) hacen `insert()` la primera vez y guardan el id real devuelto (`_supabaseId`) para que las próximas ediciones usen `update()`.

**Excepciones intencionales** (donde SÍ se toca "todo junto" a propósito, porque la acción en sí es reemplazar/borrar todo):
- Restaurar backup (`restaurarBackupEnSupabase`) — el usuario ya confirmó que quiere reemplazar todos los datos.
- Vaciar archivo interno (`vaciarArchivoEnSupabase`) — borrado total intencional, tras confirmar que ya se descargó el PDF de respaldo.

### Auth por cédula

Cada usuario = 1 cuenta de Supabase Auth con correo `{cedula}@usuarios-gestionph.com` y clave derivada (`gph_{cedula}_2026`). "Confirm email" desactivado en Supabase. El trigger `vincular_usuario_auth()` (ver `supabase_trigger_vincular_auth.sql`) vincula `usuarios.auth_id` automáticamente cada vez que se crea una cuenta de Auth nueva — reemplaza el paso manual que existía antes.

### Fotos (Supabase Storage)

Bucket privado `recurrentes-fotos`, con políticas RLS por conjunto (mismo criterio `puede_ver_conjunto()` que protege el resto de los datos — el primer segmento de la ruta del archivo es el nombre del conjunto). Ruta de cada foto: `{conjunto}/{mes}/{tareaIdx}_{slotIdx}_{fotoCount}.jpg`.

- **Sin "tiempo real"**: a diferencia de Firebase, no hay listener — la lista de fotos se trae fresca de Supabase cada vez que se abre el visor (`listarFotosSupabase()`), con una URL firmada válida por 1 hora (el bucket es privado, no hay links directos permanentes).
- **Contador de capacidad**: tabla `contadores` (fila `fotos_bytes`), incrementada/decrementada de forma atómica vía la función SQL `ajustar_contador()` (evita que 2 subidas simultáneas se pisen). Límite mostrado en Admin: 1GB (plan Free de Supabase Storage).
- **Fotos de v1.0 recuperadas**: se encontraron 12 fotos antiguas (base64 en un proyecto de Firebase previo, `gestionph-ayv`, distinto al usado por v2.0) — 11 se restauraron con éxito a conjuntos que siguen activos (Essenza, Macadamia, Moka); la de Brissea no se pudo restaurar porque ese conjunto ya no existe (excluido en la migración original). Persisten ~50 casillas más con `hasFoto:true` sin imagen real detrás — su rastro se dio por perdido, no se encontró ningún otro proyecto de Firebase con esos datos.

## Supabase — credenciales y estructura

- Proyecto: `gestion-ph-ayv-2` equivalente en Supabase, URL `https://lioabowqrqkwwmpbnhbc.supabase.co` (en `config.js` → `SUPABASE_URL`).
- Clave en el código: **solo la `sb_publishable_...`** (segura, es pública a propósito). **La clave `sb_secret_...` NUNCA debe entrar al código ni a GitHub**.
- **14 tablas**: `conjuntos`, `usuarios`, `delegado_conjuntos`, `tareas_recurrentes_catalogo`, `tareas_eventuales`, `tareas_archivo`, `recurrentes_estado`, `recurrentes_comentarios`, `evaluacion_manual`, `fechas_limite`, `fechas_limite_global`, `tareas_av`, `eventos_calendario`, `contadores`. Más 1 bucket de Storage (`recurrentes-fotos`).
- **RLS activo en todas** (tablas y bucket) — funciones de ayuda: `es_staff()`, `mis_conjuntos()`, `puede_ver_conjunto()`. Catálogo = lectura pública, escritura solo Staff. Datos operativos = solo lectura/escritura si `puede_ver_conjunto()`.
- **`conjuntos` tiene `ON UPDATE CASCADE`** en las 7 tablas que lo referencian (ver `supabase_cascade_conjuntos.sql`) — renombrar un conjunto ya no crea una fila huérfana, se propaga solo.
- Scripts SQL en la carpeta (todos ya ejecutados, quedan como referencia histórica): `supabase_schema.sql`, `supabase_grants.sql`, `supabase_migracion_datos.sql`, `supabase_vincular_auth.sql` (obsoleto, reemplazado por el trigger), `verificar_migracion.sql`, `supabase_trigger_vincular_auth.sql`, `supabase_cascade_conjuntos.sql`, `supabase_policy_borrar_eventos.sql`, `supabase_storage_fotos.sql`.

## Estructura de archivos

```
GestionPH_v2/
├── index.html              ← estructura + todos los modales + SDK de Supabase (sin Firebase)
├── assets/logo.png
├── css/estilos.css
├── supabase_*.sql, generar_migracion_sql.ps1   ← scripts de migración, solo referencia
└── js/
    ├── config.js           ← constantes, SUPABASE_URL/ANON_KEY, SUPABASE_FOTOS_BUCKET, límites de capacidad
    ├── datos.js             ← DATA, ESTADO, buildSnapshot()/aplicarSnapshotDesdeLocal()
    ├── supabase.js          ← ÚNICO backend: cliente Supabase, auth por cédula, carga inicial + TODAS las funciones de guardado individual por tabla, protección offline
    ├── auth.js              ← login por cédula + autenticarEnSupabase()
    ├── ui.js                ← toast, modales, semáforo, filtros, badges, etiquetaTipo() (display "Provisional")
    ├── calendario.js        ← grilla mensual + auto-cálculo de fechas de Informe/Acta
    ├── recurrentes.js       ← checklist mensual, fotos (Supabase Storage, compresión antes de subir)
    ├── dashboard.js         ← pestaña "Resumen" — Rendimiento fusionado aquí
    ├── eventuales.js        ← CRUD, comentario obligatorio al cambiar estado
    ├── aprobaciones.js      ← Aprobar sin comentario (staff); Devolver SÍ exige comentario
    ├── validaciones.js      ← Validar y aprobar sin comentario (staff)
    ├── evaluacion.js        ← plantillas Definitivos(34pts)/Provisional(35pts), autoguardado por campo
    ├── rendimiento.js       ← funciones reusadas por dashboard.js
    ├── informes.js          ← PDF con jsPDF + logo, período Mes/Hoy/Semana
    ├── analitica.js         ← eventuales por estado, ranking gestión, evaluación (sin sección "Fortalezas/oportunidades", quitada por poco útil)
    ├── tareasAV.js
    ├── admin.js             ← conjuntos, usuarios, tareas recurrentes, backup, barras de capacidad, purga de fotos por mes
    └── main.js               ← bootstrap async, login, navegación, backup automático semanal
```

**`js/firebase.js` ya NO existe** — se borró por completo el 26 de julio de 2026.

## Roles y permisos

- **Staff** (Paul, Victoria, Tania): ve todo — Resumen, Calendario, Recurrentes, Eventuales, Aprobaciones, Validaciones, Evaluación, Informes, Analítica, Tareas A&V, Admin.
- **Delegado**: Resumen, Calendario, Recurrentes, Eventuales, Informes, Analítica. No ve Aprobaciones/Validaciones/Evaluación/Admin.
- Supabase RLS bloquea a nivel de base de datos cualquier lectura/escritura fuera del conjunto del delegado, aunque hubiera un bug en el código de la app.

## El selector de conjunto del header

Filtra: Calendario, Recurrentes, Eventuales, Aprobaciones, Validaciones, Evaluación, y los 4 badges de navegación.
NO filtra: Resumen, Analítica (rankings comparativos entre conjuntos).

## Modelo de datos clave

- `DATA.tareasRec`: entradas duplicadas por nombre (Definitivos/Provisional). `_idx` se usa como llave foránea (`tarea_idx`) en `recurrentes_estado`, `recurrentes_comentarios`, `fechas_limite`.
- `ESTADO[conjunto][mes][tareaIdx][slotIdx] = {done, ts, tsManual, hasFoto, fotoCount, undoneAt}`.
- `FECHAS_LIMITE_REC_GLOBAL[mes][tareaNombre]` = fecha compartida (checkbox "📅 Fecha variable cada mes").
- `FECHAS_LIMITE_REC[conjunto][mes][tareaIdx]` = fecha individual por conjunto (checkbox "📍 Fecha individual por conjunto"). 3 tareas la usan automáticamente vía Calendario.
- `EVAL_MANUAL[conjunto][mes] = {tareas, cartera, asistencia}`.
- `tareaEve` tiene fechas de gestión: `creadoEn`, `enProcesoEn`, `finalizadoEn`, `aprobadoEn` (timestamps ms).
- Fotos de recurrentes: se comprimen (1600px, JPEG 70%) antes de subir a Supabase Storage; solo la casilla de la app trae la lista fresca al abrir el visor (sin listener en tiempo real).

## "Provisional (A&V)" — visual vs. valor real

Desde el 26 de julio de 2026, la interfaz muestra **"Provisional"** en vez de "Provisional (A&V)" (tabla de tareas recurrentes, detalle de evaluación, dropdowns de Admin) — **cambio puramente cosmético**. El valor real guardado en Supabase (columna `tipo`/`aplica`, con la regla `check` que solo acepta exactamente `'Definitivos'` o `'Provisional (A&V)'`) sigue intacto. La función `etiquetaTipo()` en `ui.js` hace la conversión solo para mostrar.

## Backup

- **Manual**: botón "Exportar backup" en Admin — descarga un JSON con los datos (tareas, estado de recurrentes, evaluaciones, etc.). **No incluye las fotos** (viven aparte en Supabase Storage).
- **Automático semanal**: desde el 26 de julio de 2026, solo se dispara para la cédula configurada en `CEDULA_BACKUP_AUTOMATICO` (`config.js`), y solo al iniciar sesión (no al abrir la página sin loguearse). Pide confirmación antes de descargar — si se cancela, se vuelve a preguntar la próxima vez que esa misma cédula entre esa semana.
- **Restaurar backup**: reemplaza todos los datos actuales excepto el estado de recurrentes (`ESTADO` se preserva siempre). Es la única acción que hace un guardado "todo junto" intencional en Supabase.
- **Migrar backup v1.0**: botón que queda en Admin para casos excepcionales (ej. reconstruir desde cero) — importa TODO un backup exportado desde la v1.0 original, incluyendo `ESTADO`. Usar con extremo cuidado, reemplaza absolutamente todo.

## Reglas de negocio importantes

1. Bimestral: `esMesImpar()`, sin duplicar lógica.
2. Recurrentes: desmarcar pide confirmación.
3. Multi-conjunto: al crear tarea eventual, si el header tiene un conjunto específico elegido, solo ese queda pre-marcado.
4. Eventuales: comentario obligatorio al cambiar de estado (delegado). Aprobar/Validar (staff) NO piden comentario. Devolver SÍ pide motivo.
5. Evaluación: Definitivos = 34 pts, Provisional = 35 pts (verificado que la suma sigue cuadrando). Autoguardan al salir del campo.
6. Fotos: comprimidas, subidas a Supabase Storage, visor con URL firmada. Purga por mes disponible en Admin (descarga PDF con las fotos incrustadas antes de borrar).
7. Conjuntos: soft-delete. Renombrar ya no genera filas huérfanas (`ON UPDATE CASCADE`).
8. Usuarios: "eliminar" desactiva.
9. Calendario: al crear/editar "Reunión de consejo" para un conjunto Definitivos, se recalculan automáticamente "Envío informe gestión" y "Envío acta".
10. Colores de estado: Finalizado=verde, Aprobado=verde bosque oscuro, En proceso=ámbar, Pausado=café/tostado, Suspendido=rojo.
11. Eliminar un evento de calendario ahora sí funciona de verdad (antes le faltaba la política RLS de `delete`, nunca borraba nada en Supabase).
12. Eliminar una tarea eventual (función existente pero sin botón conectado en la UI) también borra de verdad ahora, por si se conecta en el futuro.

## Diagnóstico de código (26 julio 2026)

Se hizo una revisión completa de los 18 archivos `.js` + `index.html`, con pruebas en vivo de las 11 pestañas (Staff y Delegado), generación de PDF, exportación de backup, y validación numérica de las plantillas de evaluación. Resultado: sin bugs bloqueantes. Se limpiaron 2 hallazgos menores (sección "Fortalezas y oportunidades" de Analítica, poco útil según el usuario — eliminada; código muerto del indicador de sync — eliminado).

## Pendiente / próximos pasos

1. Documento de progreso por conjunto (mencionado, no iniciado).
2. Considerar borrado/archivado automático de tareas Aprobadas (hoy es manual desde Admin).
3. Revisar visualmente la plantilla de evaluación Provisional con un caso real adicional (pendiente desde hace tiempo, nunca bloqueante).
4. ~50 casillas con `hasFoto:true` sin imagen real recuperable (ver sección Fotos arriba) — aceptado como pérdida, salvo que aparezca otra fuente.
5. **Login con clave real por usuario (diseñado, no implementado — ver detalle abajo).**

### 5. Login con clave real — diseño acordado, pendiente de construir

**Problema que resuelve**: hoy el login es SOLO con número de cédula (sin clave real — por detrás la app usa una clave derivada automática e invisible, `gph_{cedula}_2026`, para autenticar contra Supabase). Cualquiera que conozca la cédula de otra persona (ej. de alguien de Staff) puede entrar como esa persona y aprobar/validar tareas o modificar cosas en Admin que no le corresponden.

**Decisiones ya tomadas con el usuario** (no volver a preguntar, solo implementar):
- Aplica a **todos** — Staff y Delegados, sin excepción, todos configuran clave la próxima vez que entren.
- Si alguien olvida su clave, **la resetea un Staff manualmente desde Admin** (sin depender de correos — el "Confirm email" está desactivado a propósito en Supabase y los correos de los usuarios son sintéticos, no reciben nada real).
- Requisito de clave: **mínimo 6 caracteres, sin más reglas** (simple, suficiente dado que ya hay un segundo factor real: solo el dueño de la cédula sabe cuál es la suya para arrancar el proceso).

**Diseño técnico** (no toca nada de la autenticación Supabase que ya funciona hoy — se agrega como una capa propia, encima, cero riesgo sobre RLS/sync):

1. Nueva columna `usuarios.clave_hash text` — clave cifrada con `pgcrypto` (extensión estándar de Postgres), nunca en texto plano.
2. 3 funciones SQL (`security definer`, para no exponer el hash ni requerir sesión previa):
   - `verificar_clave(p_cedula text, p_clave text)` → compara con `crypt()`, retorna si es correcta Y si esa cédula ya tiene clave configurada. Debe poder llamarse SIN sesión previa (rol `anon`), porque se usa antes de autenticar contra Supabase Auth.
   - `establecer_clave_inicial(p_cedula text, p_clave text)` → solo funciona si `clave_hash` está vacío (primera vez). Guarda el hash.
   - `resetear_clave(p_usuario_id uuid)` → **solo Staff** (`es_staff()` adentro de la función) — pone `clave_hash = null` de nuevo, para que esa persona vuelva a pasar por "crear clave" en su próximo ingreso.
3. **Flujo de login nuevo** (reemplaza `intentarLogin()` en `main.js` y el formulario de `index.html` — agregar campo de clave):
   - Usuario escribe cédula + clave.
   - App llama `verificar_clave(cedula, clave)` ANTES de tocar Supabase Auth.
   - Si `clave_hash` está vacío → mostrar pantalla "Crea tu clave" (nueva + confirmar, mínimo 6 caracteres) → al confirmar, llama `establecer_clave_inicial(cedula, claveNueva)` → sigue con el login normal de siempre (`autenticarEnSupabase(cedula)`, que sigue usando la clave derivada invisible por detrás, sin cambios).
   - Si ya tiene clave configurada → `verificar_clave` valida; si es incorrecta, mensaje genérico "Cédula o clave incorrecta" (no decir cuál de los 2 campos falló, por seguridad) y no continúa. Si es correcta, sigue con el login normal de siempre.
   - `recuperarSesion()` (sesión persistida en localStorage al recargar la página) **no cambia** — sigue sin pedir clave de nuevo en cada recarga, solo la primera vez que se entra desde la pantalla de login.
4. **Botón "🔑 Restablecer clave"** en Admin → tabla de usuarios, junto a cada fila (o dentro del modal de editar usuario) — llama `resetear_clave(usuario_id)`. Solo visible/usable por Staff (ya protegido porque Admin es staff-only).
5. Opcional (el usuario dijo que sí, decidir en el momento): mostrar en la tabla de usuarios de Admin si cada quien ya configuró su clave o no (útil para seguimiento la primera semana del cambio).

**Próxima sesión**: implementar en este orden — (a) SQL de la columna + 3 funciones + grants a `anon`/`authenticated`, usuario lo corre en Supabase; (b) UI de login nuevo; (c) botón de reset en Admin; (d) probar en vivo con un usuario de prueba antes de que el equipo real lo use.

## Cómo probar localmente

Abrir `index.html` directamente en el navegador. Si se edita un `.js` y los cambios no se reflejan, es caché — agregar temporalmente `?cb=NUMERO` a los `<script src="js/...">` en `index.html`, recargar, y **quitarlo después** (no dejar cache-bust en el código que se sube a GitHub).

## GitHub

Repo: `https://github.com/paulsebas15-sketch/gestionph2` — **debe quedar SIEMPRE público**. Subida manual por el usuario vía "Add file → Upload files" en la web de GitHub (arrastrando carpetas completas) — no usa `git push`. El `.gitignore` excluye todos los `.json` (backups con datos reales nunca deben quedar públicos).

⚠️ **Incidente del 26 julio 2026 — no volver a intentar poner el repo en privado**: se probó cambiarlo a privado por seguridad, pero GitHub Pages **se desactiva por completo** en el plan Free cuando un repo es privado (no es un asunto de permisos, deja de servir la página, error 404 para todo el mundo). Esto tumbó la app en producción para todos los delegados durante el cambio. Se revirtió a público de inmediato y se tuvo que reconfigurar manualmente el origen de Pages (rama `main`, carpeta raíz) porque esa configuración se pierde al desactivarse. **Si en el futuro se quiere privacidad real, las opciones son**: mudar el hosting a Netlify/Vercel (gratis, si soportan repo privado conectado), o pagar GitHub Pro (~$4 USD/mes, sí permite Pages con repo privado). No cambiar la visibilidad del repo sin hacer esto primero.

**Importante**: cuando se borra un archivo localmente (ej. `js/firebase.js`), GitHub no lo borra solo al subir la carpeta — hay que borrarlo manualmente también ahí.
