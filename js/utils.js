// js/utils.js

// --- Monedas ---
const ISO_4217 = ['USD', 'CRC', 'EUR', 'GBP', 'MXN', 'ARS', 'BRL', 'CLP', 'COP', 'PEN', 'UYU', 'CAD', 'AUD', 'JPY', 'CNY', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'INR', 'KRW', 'TWD', 'HKD', 'SGD', 'ZAR', 'AED', 'SAR', 'TRY'];

export function validateISO4217(code) { return !!code && ISO_4217.includes(String(code).toUpperCase()); }
export function getCurrency() { return localStorage.getItem('bpz_moneda_iso') || 'CRC'; }
export function setCurrency(code) {
    const iso = String(code || '').toUpperCase() || 'CRC';
    if (!validateISO4217(iso)) throw new Error('Moneda ISO inválida');
    localStorage.setItem('bpz_moneda_iso', iso);
    dispatchEvent(new CustomEvent('bpz:currency-changed', { detail: { iso } }));
    return iso;
}

// Formateo monetario dinámico
export function formatCurrencyDynamic(value = 0, currency = null) {
    const iso = (currency || getCurrency()).toUpperCase();
    const locales = { CRC: 'es-CR', USD: 'en-US', EUR: 'de-DE' };
    const locale = locales[iso] || 'es-CR';
    try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: iso, minimumFractionDigits: 0 }).format(value || 0);
    } catch {
        return `${iso} ${Number(value || 0).toFixed(0)}`;
    }
}
// Alias usado por otras páginas
export const formatCurrency = formatCurrencyDynamic;

// --- Fechas y helpers ---
export function monthName(m) {
    return ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'][((Number(m) || 1) - 1 + 12) % 12] || '—';
}

// Convierte 'YYYY-MM-DD' (o ISO) a fecha local corta
export function formatDate(input) {
    if (!input) return '—';
    const d = new Date(input);
    if (isNaN(d)) return String(input);
    return d.toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Convierte textos "₡12.345,67" o "12,345.67" a número
export function toNumber(x) {
    if (typeof x === 'number') return x;
    if (!x) return 0;
    const s = String(x).trim();
    // Si viene en formato latino con coma decimal, quitamos puntos de miles
    const latin = /,\d{1,2}$/.test(s);
    const clean = s.replace(/[^\d,.-]/g, '');
    if (latin) {
        return Number(clean.replace(/\./g, '').replace(',', '.')) || 0;
    }
    return Number(clean.replace(/,/g, '')) || 0;
}

// Suma de arreglo por campo
export function sum(arr = [], field) {
    if (!Array.isArray(arr)) return 0;
    if (!field) return arr.reduce((a, b) => a + (Number(b) || 0), 0);
    return arr.reduce((a, b) => a + Number(b?.[field] || 0), 0);
}
