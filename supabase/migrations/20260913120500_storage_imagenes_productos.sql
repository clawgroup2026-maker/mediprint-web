-- =====================================================================
-- 20260913120500 · Storage: bucket product-images
-- ---------------------------------------------------------------------
-- * Bucket público (solo contiene imágenes del catálogo): lectura por
--   URL pública, sin política SELECT para anon → no se puede listar.
-- * Tipos permitidos: JPEG, PNG, WebP, AVIF. Máximo 5 MB (validado por
--   Storage en servidor).
-- * Subir / reemplazar / borrar: solo admin, y solo con rutas
--   products/<uuid-producto>/<uuid-archivo>.<ext> (no colisionables).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product-images: admin lee" on storage.objects;
create policy "product-images: admin lee"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'product-images' and (select private.is_admin()));

drop policy if exists "product-images: admin sube" on storage.objects;
create policy "product-images: admin sube"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and (select private.is_admin())
    and name ~ '^products/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|avif)$'
  );

drop policy if exists "product-images: admin actualiza" on storage.objects;
create policy "product-images: admin actualiza"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-images' and (select private.is_admin()))
  with check (
    bucket_id = 'product-images'
    and (select private.is_admin())
    and name ~ '^products/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|avif)$'
  );

drop policy if exists "product-images: admin elimina" on storage.objects;
create policy "product-images: admin elimina"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-images' and (select private.is_admin()));
