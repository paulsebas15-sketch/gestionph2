-- ═══════════════════════════════════════════════════════════════
-- GestiónPH v2.0 — Vínculo automático usuarios.auth_id ↔ auth.users
-- A&V Victoria Pineda Administraciones
-- Ejecutar UNA sola vez en: Supabase Dashboard → SQL Editor → New query → Run
--
-- Por qué existe esto: hasta ahora, cada vez que un usuario nuevo iniciaba sesión
-- por primera vez (y se le creaba su cuenta de Auth automáticamente), alguien tenía
-- que correr supabase_vincular_auth.sql A MANO para que RLS supiera qué conjuntos
-- puede ver ese usuario (función mis_conjuntos()). Sin ese vínculo, un delegado
-- nuevo podía entrar a la app pero no ver ninguno de sus conjuntos.
--
-- Este trigger reemplaza ese paso manual para siempre: cada vez que se crea una
-- cuenta de autenticación nueva (primer login de cualquier usuario, nuevo o viejo),
-- se vincula sola comparando el correo derivado de la cédula
-- ({cedula}@usuarios-gestionph.com) contra la tabla usuarios.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.vincular_usuario_auth()
returns trigger as $$
begin
  update public.usuarios
  set auth_id = new.id
  where auth_id is null
    and cedula || '@usuarios-gestionph.com' = new.email;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.vincular_usuario_auth();

-- Verificación opcional después de correrlo: debe seguir sin fallar (no hace nada si ya está vinculado)
-- select * from pg_trigger where tgname = 'on_auth_user_created';
