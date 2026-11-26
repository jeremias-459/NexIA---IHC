/*
 * NexIA · Utilidades compartidas.
 * Funciones puras sin dependencias: escape de HTML, fechas, formato y azar con semilla.
 */
(function (root) {
  'use strict';

  const NexIA = (root.NexIA = root.NexIA || {});

  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /** Escapa texto para insertarlo de forma segura en HTML. */
  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  }

  function uid(prefix) {
    const cryptoObj = root.crypto;
    const body = cryptoObj && cryptoObj.randomUUID
      ? cryptoObj.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    return (prefix ? prefix + '_' : '') + body;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /** Clave de día en hora local: YYYY-MM-DD. */
  function dateKey(date) {
    const d = date ? new Date(date) : new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseDateKey(key) {
    const parts = String(key).split('-').map(Number);
    return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function daysBetween(fromKey, toKey) {
    const ms = parseDateKey(toKey).getTime() - parseDateKey(fromKey).getTime();
    return Math.round(ms / 86400000);
  }

  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MONTHS_SHORT = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  function formatLongDate(date) {
    const d = new Date(date);
    return d.getDate() + ' de ' + MONTHS[d.getMonth()] + ' de ' + d.getFullYear();
  }

  function formatShortDate(date) {
    const d = new Date(date);
    return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + '.';
  }

  function monthTitle(date) {
    const d = new Date(date);
    const name = MONTHS[d.getMonth()];
    return name.charAt(0).toUpperCase() + name.slice(1) + ' ' + d.getFullYear();
  }

  /** "Hace 2 horas", "Ayer", "Hace 3 días" o la fecha corta. */
  function relativeTime(timestamp) {
    if (!timestamp) return 'Sin actividad';
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Hace un momento';
    if (minutes < 60) return 'Hace ' + minutes + ' min';
    const hours = Math.floor(minutes / 60);
    const days = daysBetween(dateKey(timestamp), dateKey());
    if (days === 0) return hours === 1 ? 'Hace 1 hora' : 'Hace ' + hours + ' horas';
    if (days === 1) return 'Ayer';
    if (days < 7) return 'Hace ' + days + ' días';
    return formatShortDate(timestamp);
  }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    const kb = bytes / 1024;
    if (kb < 1024) return Math.round(kb) + ' KB';
    return (kb / 1024).toFixed(1).replace('.', ',') + ' MB';
  }

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : many);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function percent(part, total) {
    return total > 0 ? Math.round((part / total) * 100) : 0;
  }

  function capitalize(text) {
    const s = String(text || '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** Recorta en límite de palabra y añade puntos suspensivos. */
  function truncate(text, max) {
    const s = String(text || '').trim();
    if (s.length <= max) return s;
    const cut = s.slice(0, max - 1);
    const space = cut.lastIndexOf(' ');
    return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '') + '…';
  }

  function formatClock(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }

  function debounce(fn, wait) {
    let timer = null;
    return function debounced() {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(null, args), wait);
    };
  }

  /** Hash de cadena (FNV-1a de 32 bits), usado como semilla reproducible. */
  function hashString(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** Generador pseudoaleatorio con semilla (mulberry32). */
  function seededRandom(seed) {
    let a = seed >>> 0;
    return function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, random) {
    const rnd = random || Math.random;
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  function countWords(text) {
    const m = String(text || '').match(/[\p{L}\p{N}]+/gu);
    return m ? m.length : 0;
  }

  NexIA.utils = {
    esc,
    uid,
    pad2,
    dateKey,
    parseDateKey,
    addDays,
    daysBetween,
    formatLongDate,
    formatShortDate,
    monthTitle,
    relativeTime,
    formatBytes,
    formatClock,
    plural,
    clamp,
    percent,
    capitalize,
    truncate,
    debounce,
    hashString,
    seededRandom,
    shuffle,
    countWords,
    MONTHS,
    MONTHS_SHORT,
    WEEKDAYS
  };
})(typeof window !== 'undefined' ? window : globalThis);
