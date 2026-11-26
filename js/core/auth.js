/*
 * NexIA · Cuentas y sesión.
 *
 * Las cuentas se guardan en la base de datos local del navegador. La
 * contraseña nunca se almacena en claro: se guarda una huella PBKDF2
 * (SHA-256) con sal aleatoria. Al no existir un servidor, las cuentas solo
 * existen en este dispositivo y navegador.
 */
(function (root) {
  'use strict';

  const NexIA = (root.NexIA = root.NexIA || {});
  const U = NexIA.utils;
  const store = NexIA.store;

  const SESSION_KEY = 'nexia:session';
  const DEMO_EMAIL = 'demo@nexia.edu';
  const PBKDF2_ITERATIONS = 120000;
  const AVATAR_COLORS = ['#5558F5', '#0D9488', '#D97706', '#DB2777', '#2563EB', '#7C3AED'];

  class AuthError extends Error {
    constructor(code, message, field) {
      super(message);
      this.name = 'AuthError';
      this.code = code;
      this.field = field || null;
    }
  }

  /* ------------------------------ sesión ------------------------------ */

  function storageArea() {
    try {
      root.localStorage.setItem('nexia:probe', '1');
      root.localStorage.removeItem('nexia:probe');
      return root.localStorage;
    } catch (err) {
      try {
        return root.sessionStorage;
      } catch (err2) {
        return null;
      }
    }
  }

  function session() {
    const area = storageArea();
    if (!area) return null;
    try {
      const data = JSON.parse(area.getItem(SESSION_KEY) || 'null');
      return data && data.userId ? data : null;
    } catch (err) {
      return null;
    }
  }

  function writeSession(user) {
    const area = storageArea();
    if (!area) return;
    if (!user) {
      area.removeItem(SESSION_KEY);
      return;
    }
    area.setItem(
      SESSION_KEY,
      JSON.stringify({ userId: user.id, name: user.name, email: user.email, theme: (user.prefs && user.prefs.theme) || 'light', at: Date.now() })
    );
  }

  /* ---------------------------- contraseñas ---------------------------- */

  const toHex = (bytes) => Array.from(bytes).map((b) => U.pad2(b.toString(16))).join('');
  const fromHex = (hex) => new Uint8Array((hex.match(/.{2}/g) || []).map((h) => parseInt(h, 16)));

  function randomSalt() {
    const salt = new Uint8Array(16);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(salt);
    else for (let i = 0; i < salt.length; i++) salt[i] = Math.floor(Math.random() * 256);
    return salt;
  }

  function hashPassword(password, saltHex, algo) {
    const salt = saltHex ? fromHex(saltHex) : randomSalt();
    const subtle = root.crypto && root.crypto.subtle;
    const usePbkdf2 = algo ? algo === 'pbkdf2-sha256' : Boolean(subtle);

    if (usePbkdf2) {
      if (!subtle) return Promise.reject(new AuthError('unsupported', 'Este navegador no puede verificar la contraseña de esta cuenta.'));
      const encoder = new TextEncoder();
      return subtle
        .importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
        .then((key) => subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256))
        .then((bits) => ({ algo: 'pbkdf2-sha256', salt: toHex(salt), hash: toHex(new Uint8Array(bits)) }));
    }

    // Respaldo para contextos sin Web Crypto: huella encadenada (no criptográfica).
    let hash = toHex(salt) + ':' + password;
    for (let i = 0; i < 2000; i++) hash = U.hashString(hash + i).toString(16) + U.hashString(i + hash).toString(16);
    return Promise.resolve({ algo: 'basic', salt: toHex(salt), hash });
  }

  function verifyPassword(user, password) {
    if (!user.pass) return Promise.resolve(false);
    return hashPassword(password, user.pass.salt, user.pass.algo).then((result) => result.hash === user.pass.hash);
  }

  /* ----------------------------- validación ---------------------------- */

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function emailIssue(email) {
    const value = normalizeEmail(email);
    if (!value) return 'Escribe tu correo electrónico.';
    // Solo se aceptan cuentas Gmail (login y registro).
    if (!/^[^\s@]+@gmail\.com$/.test(value)) {
      return 'El correo debe ser de Gmail, por ejemplo nombre@gmail.com.';
    }
    return null;
  }

  function passwordIssue(password) {
    const value = String(password || '');
    if (!value) return 'Escribe una contraseña.';
    if (value.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (!/\p{L}/u.test(value) || !/\d/.test(value)) return 'Combina letras y números en tu contraseña.';
    return null;
  }

  function nameIssue(name) {
    const value = String(name || '').trim();
    if (!value) return 'Escribe tu nombre.';
    if (value.length < 2) return 'El nombre es demasiado corto.';
    if (value.length > 60) return 'El nombre no puede superar los 60 caracteres.';
    return null;
  }

  function defaultPrefs() {
    return {
      studyMode: 'lectura',
      theme: 'light',
      scheduleFrom: '19:00',
      scheduleTo: '21:00',
      reminders: true,
      quietHours: true,
      dailyGoal: 15
    };
  }

  function newUser(name, email) {
    return {
      id: U.uid('u'),
      name: String(name).trim(),
      email,
      pass: null,
      demo: false,
      avatarColor: AVATAR_COLORS[U.hashString(email) % AVATAR_COLORS.length],
      prefs: defaultPrefs(),
      createdAt: Date.now()
    };
  }

  /* ------------------------------ acciones ----------------------------- */

  function register(data) {
    const email = normalizeEmail(data.email);
    const issue = nameIssue(data.name);
    if (issue) return Promise.reject(new AuthError('invalid', issue, 'name'));
    const mailIssue = emailIssue(email);
    if (mailIssue) return Promise.reject(new AuthError('invalid', mailIssue, 'email'));
    const passIssue = passwordIssue(data.password);
    if (passIssue) return Promise.reject(new AuthError('invalid', passIssue, 'password'));

    return store.findUserByEmail(email).then((existing) => {
      if (existing) throw new AuthError('exists', 'Ya existe una cuenta con ese correo en este dispositivo. Inicia sesión.', 'email');
      const user = newUser(data.name, email);
      return hashPassword(data.password).then((pass) => {
        user.pass = pass;
        return store.put('users', user).then(() => {
          writeSession(user);
          return user;
        });
      });
    });
  }

  function login(data) {
    const email = normalizeEmail(data.email);
    const mailIssue = emailIssue(email);
    if (mailIssue) return Promise.reject(new AuthError('invalid', mailIssue, 'email'));
    if (!data.password) return Promise.reject(new AuthError('invalid', 'Escribe tu contraseña.', 'password'));

    return store.findUserByEmail(email).then((user) => {
      if (!user) throw new AuthError('not-found', 'No hay ninguna cuenta con ese correo en este dispositivo. Puedes crear una.', 'email');
      if (user.demo && !user.pass) {
        throw new AuthError('demo', 'Esa es la cuenta de demostración: entra con el botón «Probar con cuenta demo».', 'email');
      }
      return verifyPassword(user, data.password).then((ok) => {
        if (!ok) throw new AuthError('wrong-password', 'La contraseña no es correcta.', 'password');
        writeSession(user);
        return user;
      });
    });
  }

  /** Entra con la cuenta de demostración (se crea la primera vez). */
  function loginDemo() {
    return store.findUserByEmail(DEMO_EMAIL).then((existing) => {
      if (existing) {
        writeSession(existing);
        return existing;
      }
      const user = newUser('Estudiante demo', DEMO_EMAIL);
      user.demo = true;
      return store.put('users', user).then(() => {
        writeSession(user);
        return user;
      });
    });
  }

  function logout() {
    writeSession(null);
  }

  function currentUser() {
    const current = session();
    if (!current) return Promise.resolve(null);
    return store.get('users', current.userId).then((user) => {
      if (!user) writeSession(null);
      return user || null;
    });
  }

  function saveUser(user) {
    return store.put('users', user).then(() => {
      const current = session();
      if (current && current.userId === user.id) writeSession(user);
      return user;
    });
  }

  function updateProfile(user, patch) {
    if (patch.name !== undefined) {
      const issue = nameIssue(patch.name);
      if (issue) return Promise.reject(new AuthError('invalid', issue, 'name'));
      user.name = String(patch.name).trim();
    }
    if (patch.avatarColor) user.avatarColor = patch.avatarColor;
    if (patch.prefs) user.prefs = Object.assign(defaultPrefs(), user.prefs, patch.prefs);
    return saveUser(user);
  }

  function changePassword(user, currentPassword, nextPassword) {
    const issue = passwordIssue(nextPassword);
    if (issue) return Promise.reject(new AuthError('invalid', issue, 'next'));
    const check = user.pass ? verifyPassword(user, currentPassword) : Promise.resolve(true);
    return check.then((ok) => {
      if (!ok) throw new AuthError('wrong-password', 'La contraseña actual no es correcta.', 'current');
      return hashPassword(nextPassword).then((pass) => {
        user.pass = pass;
        return saveUser(user);
      });
    });
  }

  function deleteAccount(user) {
    return store
      .clearUserData(user.id)
      .then(() => store.remove('users', user.id))
      .then(() => writeSession(null));
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const first = parts[0].charAt(0);
    const second = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + second).toUpperCase();
  }

  NexIA.auth = {
    AuthError,
    DEMO_EMAIL,
    AVATAR_COLORS,
    session,
    currentUser,
    register,
    login,
    loginDemo,
    logout,
    updateProfile,
    changePassword,
    deleteAccount,
    emailIssue,
    passwordIssue,
    nameIssue,
    defaultPrefs,
    initials
  };
})(typeof window !== 'undefined' ? window : globalThis);
