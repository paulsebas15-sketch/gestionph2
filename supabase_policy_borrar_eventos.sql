-- ═══════════════════════════════════════════════════════════════
-- GestiónPH v2.0 — Política RLS faltante: borrar eventos de calendario
-- A&V Victoria Pineda Administraciones
-- Ejecutar UNA sola vez en: Supabase Dashboard → SQL Editor → New query → Run
--
-- Por qué existe esto: eventos_calendario tenía políticas de lectura, creación y edición,
-- pero NUNCA tuvo una política de "delete" — sin eso, RLS bloquea cualquier borrado en
-- silencio (no da error, simplemente no borra nada). "Eliminar evento" en Calendario nunca
-- funcionó de verdad en Supabase, ni antes ni con el guardado quirúrgico nuevo. Se detectó
-- probando en vivo el guardado individual de eventos_calendario.
--
-- Mismo criterio que ya usa "eventos_editar": Staff siempre puede, o quien creó el evento.
-- ═══════════════════════════════════════════════════════════════

create policy "eventos_borrar" on eventos_calendario for delete
  using (es_staff() or creado_por = (select nombre from usuarios where auth_id = auth.uid()));
