/*
 * NexIA · Base de datos local.
 *
 * Guarda los datos del estudiante en IndexedDB (la base de datos del
 * navegador). Si IndexedDB no está disponible —por ejemplo en modo privado—
 * se usa localStorage y, como último recurso, la memoria de la pestaña.
 *
 * Todas las operaciones devuelven promesas:
 *   store.get('materials', id)
 *   store.getAll('materials', userId)
 *   store.put('materials', record)       // el registro debe tener "id"
 *   store.remove('materials', id)
 *   store.removeByUser('materials', userId)
 */
(function (root) {
  'use strict';

  const NexIA = (root.NexIA = root.NexIA || {});

  const DB_NAME = 'nexia';
  const DB_VERSION = 2;
  const STORES = ['users', 'materials', 'attempts', 'saved', 'reviews', 'activity', 'spaces'];
  const LS_PREFIX = 'nexia:db:';

  let mode = 'indexeddb';
  let dbPromise = null;
  const memory = {};

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) {
        reject(new Error('IndexedDB no disponible'));
        return;
      }
      let request;
      try {
        request = root.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        STORES.forEach((name) => {
          if (db.objectStoreNames.contains(name)) return;
          const store = db.createObjectStore(name, { keyPath: 'id' });
          if (name === 'users') store.createIndex('email', 'email', { unique: true });
          else store.createIndex('userId', 'userId', { unique: false });
        });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('No se pudo abrir la base de datos'));
      request.onblocked = () => reject(new Error('La base de datos está bloqueada por otra pestaña'));
    });
  }

  function database() {
    if (!dbPromise) {
      dbPromise = openDatabase().catch((err) => {
        mode = localStorageWorks() ? 'local' : 'memory';
        if (root.console) console.warn('[NexIA] IndexedDB no disponible, se usa ' + mode + '.', err);
        return null;
      });
    }
    return dbPromise;
  }

  function localStorageWorks() {
    try {
      const key = LS_PREFIX + 'probe';
      root.localStorage.setItem(key, '1');
      root.localStorage.removeItem(key);
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ----------------------- respaldo sin IndexedDB ----------------------- */

  function readTable(name) {
    if (mode === 'local') {
      try {
        return JSON.parse(root.localStorage.getItem(LS_PREFIX + name) || '{}') || {};
      } catch (err) {
        return {};
      }
    }
    return memory[name] || (memory[name] = {});
  }

  function writeTable(name, table) {
    if (mode === 'local') {
      try {
        root.localStorage.setItem(LS_PREFIX + name, JSON.stringify(table));
        return;
      } catch (err) {
        // Sin espacio: se conserva en memoria para no perder la sesión actual.
        mode = 'memory';
        if (root.console) console.warn('[NexIA] Almacenamiento lleno; los cambios solo durarán esta sesión.');
      }
    }
    memory[name] = table;
  }

  /* ----------------------------- operaciones ---------------------------- */

  function request(storeName, access, run) {
    return database().then((db) => {
      if (!db) return null;
      return new Promise((resolve, reject) => {
        let result;
        const tx = db.transaction(storeName, access);
        const req = run(tx.objectStore(storeName));
        if (req) req.onsuccess = () => (result = req.result);
        tx.oncomplete = () => resolve({ value: result });
        tx.onerror = () => reject(tx.error || new Error('Error de base de datos'));
        tx.onabort = () => reject(tx.error || new Error('Operación cancelada'));
      });
    });
  }

  function get(storeName, id) {
    return request(storeName, 'readonly', (store) => store.get(id)).then((res) => {
      if (res) return res.value || null;
      return readTable(storeName)[id] || null;
    });
  }

  function getAll(storeName, userId) {
    return request(storeName, 'readonly', (store) => {
      if (userId && storeName !== 'users') return store.index('userId').getAll(userId);
      return store.getAll();
    }).then((res) => {
      if (res) return res.value || [];
      const rows = Object.values(readTable(storeName));
      return userId && storeName !== 'users' ? rows.filter((row) => row.userId === userId) : rows;
    });
  }

  function findUserByEmail(email) {
    return request('users', 'readonly', (store) => store.index('email').get(email)).then((res) => {
      if (res) return res.value || null;
      return Object.values(readTable('users')).find((user) => user.email === email) || null;
    });
  }

  function put(storeName, record) {
    if (!record || !record.id) return Promise.reject(new Error('El registro necesita un "id"'));
    return request(storeName, 'readwrite', (store) => store.put(record)).then((res) => {
      if (!res) {
        const table = readTable(storeName);
        table[record.id] = JSON.parse(JSON.stringify(record));
        writeTable(storeName, table);
      }
      return record;
    });
  }

  function remove(storeName, id) {
    return request(storeName, 'readwrite', (store) => store.delete(id)).then((res) => {
      if (!res) {
        const table = readTable(storeName);
        delete table[id];
        writeTable(storeName, table);
      }
    });
  }

  function removeByUser(storeName, userId) {
    return getAll(storeName, userId).then((rows) => Promise.all(rows.map((row) => remove(storeName, row.id)))).then(() => undefined);
  }

  /** Borra todos los datos de estudio de un usuario (no la cuenta). */
  function clearUserData(userId) {
    return Promise.all(STORES.filter((name) => name !== 'users').map((name) => removeByUser(name, userId))).then(() => undefined);
  }

  NexIA.store = {
    STORES,
    ready: () => database().then(() => mode),
    mode: () => mode,
    get,
    getAll,
    put,
    remove,
    removeByUser,
    clearUserData,
    findUserByEmail
  };
})(typeof window !== 'undefined' ? window : globalThis);
