-- ═══════════════════════════════════════════════════════════════
-- GestiónPH v2.0 — ON UPDATE CASCADE para renombrar conjuntos sin romper referencias
-- A&V Victoria Pineda Administraciones
-- Ejecutar UNA sola vez en: Supabase Dashboard → SQL Editor → New query → Run
--
-- Por qué existe esto: la tabla "conjuntos" usa el NOMBRE como llave primaria, y otras 7
-- tablas (tareas_eventuales, recurrentes_estado, recurrentes_comentarios, evaluacion_manual,
-- fechas_limite, eventos_calendario, delegado_conjuntos) apuntan a ese nombre. Sin esta regla,
-- renombrar un conjunto desde Admin fallaba o dejaba huérfana la fila vieja. Con
-- ON UPDATE CASCADE, si el nombre cambia en "conjuntos", Postgres actualiza automáticamente
-- ese nombre en las 7 tablas — sin tocar ningún otro dato de esas tablas.
--
-- No borra ni modifica ningún dato existente — solo cambia la REGLA de qué hacer
-- si algún día se renombra un conjunto.
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  fila record;
  cname text;
begin
  for fila in
    select * from (values
      ('tareas_eventuales', 'no action'),
      ('recurrentes_estado', 'no action'),
      ('recurrentes_comentarios', 'no action'),
      ('evaluacion_manual', 'no action'),
      ('fechas_limite', 'no action'),
      ('eventos_calendario', 'no action'),
      ('delegado_conjuntos', 'cascade')
    ) as t(tabla, ondelete)
  loop
    select tc.constraint_name into cname
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    where tc.table_name = fila.tabla
      and kcu.column_name = 'conjunto'
      and tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public';

    if cname is not null then
      execute format('alter table public.%I drop constraint %I', fila.tabla, cname);
    end if;

    if fila.ondelete = 'cascade' then
      execute format(
        'alter table public.%I add constraint %I foreign key (conjunto) references public.conjuntos(nombre) on update cascade on delete cascade',
        fila.tabla, fila.tabla || '_conjunto_fkey'
      );
    else
      execute format(
        'alter table public.%I add constraint %I foreign key (conjunto) references public.conjuntos(nombre) on update cascade',
        fila.tabla, fila.tabla || '_conjunto_fkey'
      );
    end if;
  end loop;
end $$;

-- Verificación opcional después de correrlo:
-- select conrelid::regclass as tabla, conname, confupdtype from pg_constraint where confrelid = 'public.conjuntos'::regclass;
-- confupdtype debe salir 'c' (cascade) en las 7 filas.
