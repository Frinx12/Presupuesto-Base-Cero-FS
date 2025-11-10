// js/auth.js
// Funciones de autenticación para PBZ-FS (Supabase v2)
import { sb } from './supabase.js';

/** Crea cuenta con email/contraseña */
export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password });
  return { data, error };
}

/** Inicia sesión con email/contraseña */
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  return { data, error };
}

/** Envía enlace de recuperación de contraseña */
export async function resetPassword(email) {
  const { data, error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: `${location.origin}/login.html`,
  });
  return { data, error };
}

/** Obtener sesión actual (firma estable) */
export async function getSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return { data }; // { session }
}

/** Cierra sesión + limpia caché local y redirige */
export async function signOut() {
  try {
    const { error } = await sb.auth.signOut();
    if (error) throw error;

    // Limpieza de claves locales del proyecto
    Object.keys(localStorage)
      .filter(k => k.startsWith('bpz_') || k.startsWith('pbz_'))
      .forEach(k => localStorage.removeItem(k));

    location.href = 'login.html';
  } catch (err) {
    console.error('Error al cerrar sesión:', err);
    // Como fallback, fuerza redirección
    location.href = 'login.html';
  }
}

/**
 * Requiere sesión en páginas internas.
 * - redirectFirstLogin: si true (default), y el perfil tiene first_login=true, redirige a config.html
 *   (en config.html pásalo como false para permitir entrar al primer inicio).
 */
export async function requireAuth({ redirectFirstLogin = true } = {}) {
  const { data } = await getSession();
  const session = data?.session || null;

  if (!session?.user?.id) {
    location.href = 'login.html';
    throw new Error('No session');
  }

  // Intentar cargar perfil
  let profile = null;
  try {
    const { data: prof } = await sb
      .from('profiles')
      .select('id, first_login, full_name')
      .eq('id', session.user.id)
      .maybeSingle();
    profile = prof || null;
  } catch (e) {
    // Si falla por RLS, deja seguir; la app podrá crear perfil luego
    console.warn('profiles load error', e);
  }

  // Redirección automática a config si es primer inicio y así se desea
  if (redirectFirstLogin && profile?.first_login === true && !location.pathname.endsWith('/config.html')) {
    location.href = 'config.html';
    throw new Error('First login redirect');
  }

  return { session, profile };
}

/** Crea perfil si no existe (útil tras signUp si no hay trigger) */
export async function ensureProfile(userId) {
  if (!userId) return;
  const { data, error } = await sb
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error; // 116 = not found
  if (!data) {
    const { error: e2 } = await sb.from('profiles').insert([{ id: userId, first_login: true }]);
    if (e2) throw e2;
  }
}

/**
 * Obtiene (o crea) el perfil en `profiles` y devuelve el flag `first_login`.
 * - Si no existe el perfil, lo crea con { first_login: true }.
 * - Devuelve siempre { first_login: boolean }.
 */
export async function getOrCreateFirstLoginProfile(userId) {
  if (!userId) return { first_login: true };

  // 1) intentar leer el perfil
  const { data, error } = await sb
    .from('profiles')
    .select('id, first_login')
    .eq('id', userId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    // Error distinto a "not found"
    throw error;
  }

  // 2) si existe, devolver su estado
  if (data && typeof data.first_login === 'boolean') {
    return { first_login: data.first_login };
  }

  // 3) si no existe, crearlo como primer inicio
  const { error: insertErr } = await sb
    .from('profiles')
    .insert([{ id: userId, first_login: true }]);

  if (insertErr) throw insertErr;
  return { first_login: true };
}
