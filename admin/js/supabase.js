/* Cliente Supabase del panel: solo clave pública. La autorización real
   la hace la base de datos (RLS + private.is_admin()). */

const config = window.MEDIPRINT_SUPABASE || {};

export const isConfigured =
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(String(config.url || '').replace(/\/+$/, '')) &&
    String(config.publishableKey || '').length > 20;

export const sb = isConfigured
    ? window.supabase.createClient(config.url.replace(/\/+$/, ''), config.publishableKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
            storageKey: 'mediprint-admin-auth'
        }
    })
    : null;

export const IMAGE_BUCKET = 'product-images';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };

export function imageUrl(path) {
    if (!path) return '../images/mediprint-logo.png';
    if (/^products\//.test(path) && sb) return sb.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    if (/^https:\/\//.test(path)) return path;
    return `../${path.replace(/^\/+/, '')}`;
}
