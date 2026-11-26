/*
 * NexIA · Inicio de sesión y registro (cuentas locales en este dispositivo).
 */
(function () {
  'use strict';

  const auth = window.NexIA.auth;
  const store = window.NexIA.store;

  const form = document.getElementById('authForm');
  const modeLoginBtn = document.getElementById('modeLogin');
  const modeRegisterBtn = document.getElementById('modeRegister');
  const nameGroup = document.getElementById('nameGroup');
  const nameInput = document.getElementById('name');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const errorBox = document.getElementById('authError');
  const submitBtn = document.getElementById('authSubmit');
  const helpBtn = document.getElementById('authHelpBtn');
  const helpPanel = document.getElementById('authHelp');
  const demoBtn = document.getElementById('demoBtn');
  const togglePassword = document.getElementById('togglePassword');
  const title = document.getElementById('authTitle');
  const subtitle = document.getElementById('authSubtitle');

  let mode = 'login';

  function showError(message, field) {
    if (!errorBox) return;
    errorBox.hidden = !message;
    errorBox.textContent = message || '';
    [nameInput, emailInput, passwordInput].forEach((input) => {
      if (!input) return;
      input.classList.toggle('is-invalid', field && input.id === field);
      input.setAttribute('aria-invalid', field && input.id === field ? 'true' : 'false');
    });
  }

  function setMode(next) {
    mode = next;
    const isLogin = mode === 'login';
    modeLoginBtn.classList.toggle('is-active', isLogin);
    modeRegisterBtn.classList.toggle('is-active', !isLogin);
    nameGroup.hidden = isLogin;
    nameInput.required = !isLogin;
    title.textContent = isLogin ? 'Inicia sesión' : 'Crea tu cuenta';
    subtitle.textContent = isLogin
      ? 'Accede a tu espacio de estudio en este dispositivo.'
      : 'Tus datos se guardan solo en este navegador.';
    submitBtn.textContent = isLogin ? 'Iniciar sesión' : 'Crear cuenta';
    showError('');
  }

  modeLoginBtn.addEventListener('click', () => setMode('login'));
  modeRegisterBtn.addEventListener('click', () => setMode('register'));

  if (togglePassword) {
    togglePassword.addEventListener('click', () => {
      const show = passwordInput.type === 'password';
      passwordInput.type = show ? 'text' : 'password';
      togglePassword.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
      togglePassword.textContent = show ? 'Ocultar' : 'Mostrar';
    });
  }

  if (helpBtn && helpPanel) {
    helpBtn.addEventListener('click', () => {
      helpPanel.hidden = !helpPanel.hidden;
    });
  }

  async function goApp() {
    location.href = 'app.html';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    submitBtn.disabled = true;
    submitBtn.textContent = mode === 'login' ? 'Entrando…' : 'Creando…';
    try {
      if (mode === 'login') {
        await auth.login({ email: emailInput.value, password: passwordInput.value });
      } else {
        await auth.register({ name: nameInput.value, email: emailInput.value, password: passwordInput.value });
      }
      await goApp();
    } catch (err) {
      showError(err.message || 'No se pudo completar la operación.', err.field);
      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta';
    }
  });

  if (demoBtn) {
    demoBtn.addEventListener('click', async () => {
      demoBtn.disabled = true;
      try {
        await auth.loginDemo();
        await goApp();
      } catch (err) {
        showError(err.message || 'No se pudo abrir la cuenta demo.');
        demoBtn.disabled = false;
      }
    });
  }

  store.ready().then(() => auth.currentUser()).then((user) => {
    if (user) location.replace('app.html');
  });
})();
