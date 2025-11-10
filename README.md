# Presupuesto base cero FS
Sitio estático con 9 páginas, tema oscuro/claro, modales accesibles y toasts. Integra Supabase (auth + CRUD).

## Configurar Supabase
Ya está configurado en `/js/config.js` con tu URL/Key. Asegúrate de activar Email/Password y permitir tu origen local en Auth.

## Ejecutar local
Usa un servidor estático (Live Server, `python -m http.server 5500`, etc.) y abre `login.html`.

## Accesibilidad
- Modales `role="dialog"` con ESC para cerrar y `aria-live="polite"` en toasts.
- Navegación por teclado y `:focus-visible`.

## Notas
- Ajusta nombres de tablas/columnas si difieren.
- `profiles.first_login` te envía a `config.html` la primera vez.
