// /js/supabase.js
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Interceptor usado SOLO por el cliente de Supabase.
// Quita ?columns=... pero CONSERVA método, headers y body.
function cleanColumnsFetch(input, init) {
    const req = (input instanceof Request) ? input : new Request(input, init);
    try {
        const url = new URL(req.url);
        if (url.pathname.includes('/rest/v1/') && url.searchParams.has('columns')) {
            url.searchParams.delete('columns');
            // Clonado correcto: conserva Authorization y apikey
            return fetch(new Request(url.toString(), req));
        }
    } catch { }
    return fetch(req);
}

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: cleanColumnsFetch },
    db: { schema: 'public' }, // aseguramos schema público
});

// 🔧 Mapeo lógico → recurso real (ya NO apuntamos al view)
const MAP = {
    provisiones: 'provisiones',
    metas_ahorro: 'metas_ahorro',
    pagos_mensuales: 'pagos_mensuales', // ✅ tabla base
};
// Si no quieres ningún alias, puedes borrar MAP y el wrapper de abajo.
const _from = sb.from.bind(sb);
sb.from = (name) => _from(MAP[name] || name);

// Debug opcional en consola
if (typeof window !== 'undefined') window.sb = sb;
