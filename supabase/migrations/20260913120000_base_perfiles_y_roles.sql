-- =====================================================================
-- 20260913120000 · Base: esquema privado, helpers, perfiles y rol admin
-- ---------------------------------------------------------------------
-- Propósito:
--   * Esquema `private` (no expuesto por la API) para funciones internas.
--   * Tabla `profiles` 1:1 con auth.users, creada automáticamente al
--     registrarse un usuario, siempre con rol `user`.
--   * `private.is_admin()`: única fuente de verdad del rol admin,
--     evaluada en el servidor con auth.uid().
--   * Nadie puede cambiar `role` / `status` desde la API (grants por
--     columna + trigger). La promoción a admin se hace solo por SQL
--     (ver supabase/sql/asignar_primer_admin.sql).
-- Idempotente: puede re-ejecutarse sin duplicar objetos.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;
-- Las políticas RLS llaman a funciones de este esquema, por eso los
-- roles de la API necesitan USAGE. El esquema NO está en `api.schemas`,
-- así que sus funciones no son invocables vía PostgREST.
grant usage on schema private to anon, authenticated;

-- ---------------------------------------------------------------------
-- Helper genérico: mantener updated_at
-- ---------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Perfiles
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (char_length(full_name) <= 120),
  email       text check (char_length(email) <= 254),
  role        text not null default 'user'   check (role in ('user', 'admin')),
  status      text not null default 'active' check (status in ('active', 'disabled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is 'Perfil de cada usuario de Auth. El rol solo se modifica por SQL.';

create index if not exists profiles_role_idx on public.profiles (role) where role = 'admin';

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- ¿El usuario actual es admin activo?  (SECURITY DEFINER para evitar
-- recursión con la RLS de profiles; solo lee el perfil propio)
-- ---------------------------------------------------------------------
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
      and p.status = 'active'
  );
$$;

revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Crear perfil al registrarse (rol siempre 'user'; se ignora cualquier
-- rol enviado en metadata)
-- ---------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    left(nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''), 120)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Perfiles para usuarios que ya existieran antes de esta migración
insert into public.profiles (id, email)
select u.id, u.email
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Bloqueo de autoascenso: role/status no se pueden cambiar desde la API
-- (anon/authenticated), aunque alguien obtuviera un grant por error.
-- ---------------------------------------------------------------------
create or replace function private.protect_profile_privileges()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
     and (new.role is distinct from old.role
          or new.status is distinct from old.status
          or new.id is distinct from old.id) then
    raise exception 'No autorizado: el rol y el estado solo se modifican por SQL administrativo'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_privileges on public.profiles;
create trigger profiles_protect_privileges
  before update on public.profiles
  for each row execute function private.protect_profile_privileges();

-- ---------------------------------------------------------------------
-- Procedimiento explícito para asignar/quitar admin.
-- Solo ejecutable por el dueño de la BD (SQL Editor / CLI), nunca por la API.
-- ---------------------------------------------------------------------
create or replace function private.set_admin_role(p_user_id uuid, p_is_admin boolean)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'No existe un usuario de Auth con id %', p_user_id;
  end if;

  insert into public.profiles (id, email)
  select u.id, u.email from auth.users u where u.id = p_user_id
  on conflict (id) do nothing;

  update public.profiles
     set role = case when p_is_admin then 'admin' else 'user' end,
         status = 'active'
   where id = p_user_id
  returning * into v_profile;

  return v_profile;
end;
$$;

revoke all on function private.set_admin_role(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- RLS y permisos de profiles
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;

drop policy if exists "profiles: leer propio o admin" on public.profiles;
create policy "profiles: leer propio o admin"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists "profiles: editar nombre propio" on public.profiles;
create policy "profiles: editar nombre propio"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
