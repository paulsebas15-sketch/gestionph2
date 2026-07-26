-- ═══════════════════════════════════════════════════════════════
-- GestiónPH v2.0 — Fotos de recurrentes: bucket privado en Supabase Storage + RLS + contador
-- A&V Victoria Pineda Administraciones
-- Ejecutar UNA sola vez en: Supabase Dashboard → SQL Editor → New query → Run
--
-- Reemplaza a Firebase Storage. Cada foto vive en la ruta:
--   {conjunto}/{mes}/{tareaIdx}_{slotIdx}_{fotoCount}.jpg
-- El bucket es PRIVADO — solo se puede ver/subir/borrar si puede_ver_conjunto() lo permite
-- (misma regla de seguridad que ya protege el resto de los datos por conjunto).
-- ═══════════════════════════════════════════════════════════════

-- Bucket privado (public=false → siempre requiere URL firmada, nunca un link directo)
insert into storage.buckets (id, name, public)
values ('recurrentes-fotos', 'recurrentes-fotos', false)
on conflict (id) do nothing;

-- El primer segmento de la ruta ("carpeta") es el nombre del conjunto — se usa para decidir
-- quién puede ver/subir/borrar, igual que puede_ver_conjunto(conjunto) en las demás tablas.
create policy "fotos_ver" on storage.objects for select
  using (bucket_id = 'recurrentes-fotos' and puede_ver_conjunto((storage.foldername(name))[1]));

create policy "fotos_subir" on storage.objects for insert
  with check (bucket_id = 'recurrentes-fotos' and puede_ver_conjunto((storage.foldername(name))[1]));

create policy "fotos_borrar" on storage.objects for delete
  using (bucket_id = 'recurrentes-fotos' and puede_ver_conjunto((storage.foldername(name))[1]));

-- Incremento/decremento ATÓMICO del contador de bytes usados — equivalente a la transaction()
-- que usaba Firebase, para que 2 subidas simultáneas desde distintos dispositivos no se pisen
-- entre sí (si cada uno hiciera "leer valor actual → sumar → guardar" por su cuenta, podrían
-- perder el incremento del otro).
create or replace function ajustar_contador(p_clave text, p_delta bigint)
returns void as $$
  insert into contadores (clave, valor)
  values (p_clave, greatest(p_delta, 0))
  on conflict (clave) do update set valor = greatest(contadores.valor + p_delta, 0);
$$ language sql security definer;
