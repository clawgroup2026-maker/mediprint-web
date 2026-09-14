/* ========================================
   CONFIGURACIÓN PÚBLICA DE SUPABASE — MEDIPRINT
   ----------------------------------------
   Solo valores PÚBLICOS:
     - url: https://<project-ref>.supabase.co
     - publishableKey: clave "publishable" (sb_publishable_…) o "anon"
   NUNCA pongas aquí service_role, secret keys ni contraseñas.
   La seguridad real está en RLS dentro de la base de datos.

   Si `url` o `publishableKey` están vacíos, la web funciona igual que
   antes (catálogo local + WhatsApp) y el panel muestra un aviso.
   ======================================== */

window.MEDIPRINT_SUPABASE = Object.freeze({
    projectName: 'mediprint-produccion',
    url: '',
    publishableKey: ''
});
