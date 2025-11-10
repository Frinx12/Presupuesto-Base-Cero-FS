// js/period.js
export function getCurrentPeriod() {
  const today = new Date();
  const mes = Number(localStorage.getItem('bpz_period_mes')) || (today.getMonth() + 1);
  const anio = Number(localStorage.getItem('bpz_period_anio')) || today.getFullYear();
  return { mes, anio };
}
export function setCurrentPeriod({ mes, anio }) {
  if (mes) localStorage.setItem('bpz_period_mes', Number(mes));
  if (anio) localStorage.setItem('bpz_period_anio', Number(anio));
  dispatchEvent(new CustomEvent('bpz:month-changed', { detail: { month: Number(mes), year: Number(anio) } }));
}
