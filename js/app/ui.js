/*
 * NexIA · Componentes de interfaz compartidos.
 */
(function (root) {
  'use strict';

  const NexIA = (root.NexIA = root.NexIA || {});
  const U = NexIA.utils;
  const auth = NexIA.auth;

  function icon(name, size) {
    const s = size || 18;
    return '<svg class="icon" width="' + s + '" height="' + s + '" aria-hidden="true"><use href="#i-' + U.esc(name) + '"></use></svg>';
  }

  function avatarHtml(user, extraClass) {
    const initials = auth.initials(user && user.name);
    const color = (user && user.avatarColor) || '#5558F5';
    return (
      '<span class="avatar ' + U.esc(extraClass || '') + '" style="--avatar-color:' + U.esc(color) + '" aria-hidden="true">' +
      U.esc(initials) +
      '</span>'
    );
  }

  function progressBar(pct, modifier) {
    const width = U.clamp(pct || 0, 0, 100);
    const fillClass = modifier ? ' progress-fill--' + modifier : '';
    return (
      '<span class="progress-track"><span class="progress-fill' + fillClass + '" style="width:' + width + '%"></span></span>'
    );
  }

  function chip(text, type) {
    return '<span class="status-chip status-chip--' + U.esc(type || 'purple') + '">' + U.esc(text) + '</span>';
  }

  function emptyState(opts) {
    return (
      '<div class="empty-state">' +
      (opts.icon ? '<div class="empty-state__icon">' + icon(opts.icon, 28) + '</div>' : '') +
      '<h2 class="empty-state__title">' + U.esc(opts.title) + '</h2>' +
      '<p class="empty-state__text">' + U.esc(opts.text) + '</p>' +
      (opts.action
        ? '<a class="app-btn app-btn--primary" href="' + U.esc(opts.action.href) + '">' + U.esc(opts.action.label) + '</a>'
        : '') +
      '</div>'
    );
  }

  function toast(message, type) {
    const region = document.getElementById('toastRegion');
    if (!region) return;
    const el = document.createElement('div');
    el.className = 'toast toast--' + (type || 'info');
    el.setAttribute('role', 'status');
    el.innerHTML = '<span>' + U.esc(message) + '</span><button type="button" class="toast__close" aria-label="Cerrar">' + icon('x', 16) + '</button>';
    region.appendChild(el);
    const close = () => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 220);
    };
    el.querySelector('.toast__close').addEventListener('click', close);
    setTimeout(close, 4200);
  }

  function confirmDialog(opts) {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'nexia-dialog';
      dialog.innerHTML =
        '<form method="dialog" class="nexia-dialog__card">' +
        '<h2 class="nexia-dialog__title">' + U.esc(opts.title) + '</h2>' +
        '<p class="nexia-dialog__text">' + U.esc(opts.text) + '</p>' +
        '<div class="nexia-dialog__actions">' +
        '<button value="cancel" class="app-btn app-btn--outline">' + U.esc(opts.cancel || 'Cancelar') + '</button>' +
        '<button value="ok" class="app-btn app-btn--primary' + (opts.danger ? ' app-btn--danger' : '') + '">' +
        U.esc(opts.confirm || 'Confirmar') +
        '</button>' +
        '</div></form>';
      document.body.appendChild(dialog);
      dialog.addEventListener('close', () => {
        const ok = dialog.returnValue === 'ok';
        dialog.remove();
        resolve(ok);
      });
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else {
        dialog.setAttribute('open', '');
      }
    });
  }

  function openDialog(opts) {
    const dialog = document.createElement('dialog');
    dialog.className = 'nexia-dialog';
    dialog.innerHTML =
      '<div class="nexia-dialog__card">' +
      '<div class="nexia-dialog__head">' +
      '<h2 class="nexia-dialog__title" id="dialogTitle">' + U.esc(opts.title) + '</h2>' +
      '<button type="button" class="icon-btn" data-dialog-close aria-label="Cerrar">' + icon('x', 18) + '</button>' +
      '</div>' +
      '<div class="nexia-dialog__body">' + (opts.body || '') + '</div>' +
      (opts.footer ? '<div class="nexia-dialog__actions">' + opts.footer + '</div>' : '') +
      '</div>';
    document.body.appendChild(dialog);
    const close = () => {
      if (dialog.open) dialog.close();
      dialog.remove();
    };
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) close();
    });
    dialog.querySelectorAll('[data-dialog-close]').forEach((btn) => btn.addEventListener('click', close));
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return { dialog, close };
  }

  function codeBlock(text, lang) {
    const lines = String(text || '').split('\n');
    return (
      '<div class="code-block">' +
      '<p class="code-block__lang">' + U.esc((lang || 'código').toUpperCase()) + '</p>' +
      '<pre class="code-block__pre"><code>' +
      lines
        .map((line, i) => '<span class="ln">' + (i + 1) + '</span>' + U.esc(line))
        .join('\n') +
      '</code></pre></div>'
    );
  }

  function donut(pct) {
    const value = U.clamp(pct || 0, 0, 100);
    const c = 2 * Math.PI * 50;
    const filled = (value / 100) * c;
    return (
      '<div class="donut" role="img" aria-label="Resultado ' + value + ' por ciento">' +
      '<svg viewBox="0 0 120 120" width="120" height="120">' +
      '<circle cx="60" cy="60" r="50" fill="none" stroke="var(--color-track)" stroke-width="12"></circle>' +
      '<circle cx="60" cy="60" r="50" fill="none" stroke="var(--color-primary)" stroke-width="12" stroke-dasharray="' +
      filled.toFixed(2) +
      ' ' +
      c.toFixed(2) +
      '" transform="rotate(-90 60 60)"></circle>' +
      '</svg><span class="donut__label">' +
      value +
      ' %</span></div>'
    );
  }

  function lineChart(points, labels) {
    const w = 760;
    const h = 200;
    const left = 48;
    const right = 30;
    const top = 30;
    const bottom = 30;
    const max = Math.max(1, ...points);
    const step = points.length > 1 ? (w - left - right) / (points.length - 1) : 0;
    const coords = points.map((v, i) => {
      const x = left + i * step;
      const y = top + (1 - v / max) * (h - top - bottom);
      return { x, y, v };
    });
    const poly = coords.map((c) => c.x + ',' + c.y).join(' ');
    const area = poly + ' ' + (coords[coords.length - 1] || { x: left }).x + ',' + (h - bottom) + ' ' + left + ',' + (h - bottom);
    const grid = [0, 0.25, 0.5, 0.75, 1]
      .map((t) => {
        const y = top + (1 - t) * (h - top - bottom);
        const label = Math.round(max * t);
        return (
          '<line x1="' + left + '" y1="' + y + '" x2="' + (w - right) + '" y2="' + y + '" stroke="var(--color-border)" stroke-width="1"/>' +
          '<text x="26" y="' + (y + 4) + '" class="chart-axis-text">' + label + '</text>'
        );
      })
      .join('');
    const dots = coords
      .map((c) => '<circle cx="' + c.x + '" cy="' + c.y + '" r="4" fill="var(--color-primary)"/>')
      .join('');
    const xLabels = (labels || [])
      .map((lab, i) => '<text x="' + (coords[i] ? coords[i].x : left) + '" y="' + (h - 6) + '" text-anchor="middle" class="chart-axis-text">' + U.esc(lab) + '</text>')
      .join('');
    return (
      '<svg viewBox="0 0 ' + w + ' ' + h + '" class="line-chart-svg" role="img">' +
      '<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="var(--color-primary)" stop-opacity="0.16"/>' +
      '<stop offset="100%" stop-color="var(--color-primary)" stop-opacity="0.02"/>' +
      '</linearGradient></defs>' +
      grid +
      '<polygon points="' + area + '" fill="url(#areaGrad)"/>' +
      '<polyline points="' + poly + '" fill="none" stroke="var(--color-primary)" stroke-width="2.5"/>' +
      dots +
      xLabels +
      '</svg>'
    );
  }

  function radarChart(scores) {
    // scores: [{label, value 0-100}]
    const cx = 180;
    const cy = 154;
    const R = 108;
    const n = scores.length || 1;
    const point = (i, scale) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return { x: cx + Math.cos(angle) * R * scale, y: cy + Math.sin(angle) * R * scale };
    };
    const rings = [1, 0.75, 0.5, 0.25]
      .map((scale) => {
        const pts = scores.map((_, i) => {
          const p = point(i, scale);
          return p.x + ',' + p.y;
        });
        return '<polygon points="' + pts.join(' ') + '" fill="none" stroke="var(--color-border)" stroke-width="1"/>';
      })
      .join('');
    const axes = scores
      .map((_, i) => {
        const p = point(i, 1);
        return '<line x1="' + cx + '" y1="' + cy + '" x2="' + p.x + '" y2="' + p.y + '" stroke="var(--color-border)" stroke-width="1"/>';
      })
      .join('');
    const dataPts = scores.map((s, i) => point(i, U.clamp(s.value, 0, 100) / 100));
    const dataPoly = dataPts.map((p) => p.x + ',' + p.y).join(' ');
    const dots = dataPts.map((p) => '<circle cx="' + p.x + '" cy="' + p.y + '" r="3.5" fill="var(--color-mint-text)"/>').join('');
    const labels = scores
      .map((s, i) => {
        const p = point(i, 1.18);
        const anchor = Math.abs(p.x - cx) < 8 ? 'middle' : p.x > cx ? 'start' : 'end';
        return '<text x="' + p.x + '" y="' + p.y + '" text-anchor="' + anchor + '" class="radar-label">' + U.esc(s.label) + '</text>';
      })
      .join('');
    return (
      '<svg viewBox="0 0 360 280" class="radar-svg" role="img">' +
      rings +
      axes +
      '<polygon points="' + dataPoly + '" fill="rgba(20,184,166,0.22)" stroke="var(--color-mint-text)" stroke-width="2"/>' +
      dots +
      labels +
      '</svg>'
    );
  }

  function bindActions(rootEl, handlers) {
    // Evita acumular listeners si se vuelve a enlazar tras cada render.
    if (rootEl._nexiaActionsClick) {
      rootEl.removeEventListener('click', rootEl._nexiaActionsClick);
    }
    rootEl._nexiaActionsClick = function onActionClick(event) {
      const target = event.target.closest('[data-action]');
      if (!target || !rootEl.contains(target)) return;
      const action = target.getAttribute('data-action');
      if (handlers[action]) {
        event.preventDefault();
        handlers[action](target, event);
      }
    };
    rootEl.addEventListener('click', rootEl._nexiaActionsClick);
  }

  NexIA.ui = {
    icon,
    avatarHtml,
    progressBar,
    chip,
    emptyState,
    toast,
    confirmDialog,
    openDialog,
    codeBlock,
    donut,
    lineChart,
    radarChart,
    bindActions
  };
})(typeof window !== 'undefined' ? window : globalThis);
