-- =====================================================================
-- Asignar (o quitar) el rol administrador — procedimiento manual
-- ---------------------------------------------------------------------
-- NO es una migración. Ejecutar solo en el SQL Editor del proyecto
-- MediPrint (nunca en BridgeClaw azybyvgjkvinrjjcpjit).
--
-- Pasos:
--   1. Supabase Dashboard → Authentication → Users → "Add user"
--      (correo + contraseña, marcar "Auto Confirm User").
--   2. Copiar el UUID del usuario creado.
--   3. Reemplazar el UUID de abajo y ejecutar SOLO el bloque que corresponda.
--
-- La función private.set_admin_role no es accesible desde la API ni
-- desde el navegador: solo desde SQL como dueño de la base de datos.
-- =====================================================================

-- 0) Verificar el usuario antes de promoverlo
select u.id, u.email, u.created_at, p.role, p.status
from auth.users u
left join public.profiles p on p.id = u.id
where u.id = '00000000-0000-0000-0000-000000000000';   -- ← UUID del usuario

-- 1) Asignar rol admin
select * from private.set_admin_role('00000000-0000-0000-0000-000000000000', true);

-- 2) (Opcional) Quitar rol admin
-- select * from private.set_admin_role('00000000-0000-0000-0000-000000000000', false);

-- 3) (Opcional) Deshabilitar el acceso de un administrador sin borrarlo
-- update public.profiles set status = 'disabled' where id = '00000000-0000-0000-0000-000000000000';

-- 4) Listar administradores actuales
select id, email, full_name, status, updated_at
from public.profiles
where role = 'admin'
order by email;
