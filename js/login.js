// /js/login.js
import { toast, openModal, closeModal } from './ui.js';
import { sb } from './supabase.js';
import {
  signIn,
  signUp,
  resetPassword,
  getSession,
  signOut,
  getOrCreateFirstLoginProfile,
} from './auth.js';

/* ======= helpers ======= */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const tabs = [
  { tab: '#tab-login', panel: '#panel-login' },
  { tab: '#tab-register', panel: '#panel-register' },
  { tab: '#tab-recover', panel: '#panel-recover' },
];

function switchTo(idTab) {
  for (const t of tabs) {
    const tabEl = $(t.tab);
    const panelEl = $(t.panel);
    const active = t.tab === idTab;
    tabEl.setAttribute('aria-selected', active ? 'true' : 'false');
    panelEl.hidden = !active;
  }
}

function revealBind() {
  $$('button[data-toggle="reveal"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.querySelector(btn.dataset.target);
      if (!target) return;
      const isPwd = target.type === 'password';
      target.type = isPwd ? 'text' : 'password';
      btn.querySelector('.material-symbols-rounded').textContent =
        isPwd ? 'visibility_off' : 'visibility';
    });
  });
}

function setBusy(btn, busy = true) {
  if (!btn) return;
  btn.setAttribute('aria-busy', busy ? 'true' : 'false');
  btn.disabled = !!busy;
}

function setError(form, name, msg) {
  const box = form.querySelector(`.error-msg[data-for="${name}"]`);
  if (box) box.textContent = msg || '';
}

function clearErrors(form) {
  form.querySelectorAll('.error-msg').forEach((n) => (n.textContent = ''));
}

/* ======= Tema ======= */
const THEME_KEY = 'bpz_theme';
function loadTheme() {
  const root = document.documentElement;
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) root.dataset.theme = saved;
}
function toggleTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === 'light' ? 'dark' : 'light';
  root.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
}

/* ======= Validación ======= */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const validateEmail = (v) => EMAIL_RE.test(String(v || '').trim());
const validatePassword = (v) => String(v || '').length >= 8;

/* ======= Post-auth redirect (profiles.first_login) ======= */
async function handlePostAuthRedirect() {
  const { data: { session } } = await sb.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return;

  // A) Estrategia recomendada: tabla profiles
  const { first_login } = await getOrCreateFirstLoginProfile(uid);
  if (first_login) {
    location.href = 'config.html';
  } else {
    location.href = 'inicio.html';
  }
}

/* ======= Errores amigables ======= */
function friendlyError(err) {
  const msg = String(err?.message || err || '');
  if (/Invalid login credentials/i.test(msg)) return 'Credenciales inválidas. Revisa tu correo y contraseña.';
  if (/Email not confirmed/i.test(msg)) return 'Correo aún no verificado. Revisa tu bandeja de entrada.';
  if (/User already registered/i.test(msg)) return 'Ya existe una cuenta con este correo.';
  if (/Password should be at least/i.test(msg)) return 'La contraseña debe tener al menos 8 caracteres.';
  if (/rate limit/i.test(msg)) return 'Demasiados intentos. Intenta de nuevo en unos minutos.';
  return msg;
}

/* ======= Handlers ======= */
async function onRegister(e) {
  e.preventDefault();
  const form = e.currentTarget;
  clearErrors(form);

  const email = form.email.value.trim();
  const password = form.password.value;
  const confirm = form.confirm.value;
  const terms = $('#reg-terms').checked;

  let valid = true;
  if (!validateEmail(email)) { setError(form, 'email', 'Ingresa un correo válido.'); valid = false; }
  if (!validatePassword(password)) { setError(form, 'password', 'La contraseña debe tener al menos 8 caracteres.'); valid = false; }
  if (confirm !== password) { setError(form, 'confirm', 'Las contraseñas no coinciden.'); valid = false; }
  if (!terms) { toast.error('Debes aceptar los términos.'); valid = false; }
  if (!valid) return;

  const btn = $('#btn-register');
  setBusy(btn, true);
  try {
    const { error } = await signUp(email, password);
    if (error) throw error;

    const modal = openModal({
      id: 'm-verify',
      title: 'Verifica tu correo',
      content: `
        <div class="vstack" style="padding:1rem">
          <p>Hemos enviado un enlace de verificación a <strong>${email}</strong>. Revisa tu bandeja de entrada y sigue las instrucciones.</p>
          <div style="margin-top:1rem"><button class="btn" data-close>Cerrar</button></div>
        </div>
      `,
    });
    modal.node.querySelector('[data-close]')?.addEventListener('click', () => closeModal(modal));

    toast.success('Cuenta creada. Revisa tu correo para verificar.');
    setTimeout(() => handlePostAuthRedirect(), 400);
  } catch (err) {
    toast.error(friendlyError(err));
  } finally {
    setBusy(btn, false);
  }
}

async function onLogin(e) {
  e.preventDefault();
  const form = e.currentTarget;
  clearErrors(form);

  const email = form.email.value.trim();
  const password = form.password.value;

  let valid = true;
  if (!validateEmail(email)) { setError(form, 'email', 'Ingresa un correo válido.'); valid = false; }
  if (!validatePassword(password)) { setError(form, 'password', 'Mínimo 8 caracteres.'); valid = false; }
  if (!valid) return;

  const btn = $('#btn-login');
  setBusy(btn, true);
  try {
    const { error } = await signIn(email, password);
    if (error) throw error;
    toast.success('¡Bienvenido!');
    await handlePostAuthRedirect();
  } catch (err) {
    toast.error(friendlyError(err));
  } finally {
    setBusy(btn, false);
  }
}

async function onRecover(e) {
  e.preventDefault();
  const form = e.currentTarget;
  clearErrors(form);

  const email = form.email.value.trim();
  if (!validateEmail(email)) { setError(form, 'email', 'Ingresa un correo válido.'); return; }

  const btn = $('#btn-recover');
  setBusy(btn, true);
  try {
    const { error } = await resetPassword(email);
    if (error) throw error;
    toast.success('Enlace de recuperación enviado. Revisa tu correo.');
  } catch (err) {
    toast.error(friendlyError(err));
  } finally {
    setBusy(btn, false);
  }
}

/* ======= Tabs ======= */
function bindTabs() {
  $('#tab-login').addEventListener('click', () => switchTo('#tab-login'));
  $('#tab-register').addEventListener('click', () => switchTo('#tab-register'));
  $('#tab-recover').addEventListener('click', () => switchTo('#tab-recover'));
  $('#go-register').addEventListener('click', () => switchTo('#tab-register'));
  $('#go-login-1').addEventListener('click', () => switchTo('#tab-login'));
  $('#go-login-2').addEventListener('click', () => switchTo('#tab-login'));
  $('#go-recover').addEventListener('click', () => switchTo('#tab-recover'));
}

/* ======= Redirección si ya hay sesión ======= */
async function redirectIfHasSession() {
  const { data: { session } } = await getSession();
  if (!session) return;
  await handlePostAuthRedirect();
}

/* ======= Init ======= */
function init() {
  $('#year').textContent = String(new Date().getFullYear());
  loadTheme();
  $('#theme-toggle').addEventListener('click', toggleTheme);

  bindTabs();
  revealBind();

  $('#form-login').addEventListener('submit', onLogin);
  $('#form-register').addEventListener('submit', onRegister);
  $('#form-recover').addEventListener('submit', onRecover);

  // validación inmediata de confirmación
  const regPwd = $('#reg-password');
  const regCnf = $('#reg-confirm');
  const regForm = $('#form-register');
  function checkConfirm() {
    const ok = regCnf.value === regPwd.value;
    setError(regForm, 'confirm', ok ? '' : 'Las contraseñas no coinciden.');
  }
  regPwd.addEventListener('input', checkConfirm);
  regCnf.addEventListener('input', checkConfirm);

  redirectIfHasSession();
}
init();
