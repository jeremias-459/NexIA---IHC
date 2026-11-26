/*
 * NexIA · Vistas de guardados, progreso y perfil (incluye ajustes de IA).
 *
 * Cada vista devuelve una cadena HTML (todo el texto dinámico va escapado con
 * U.esc). Acciones que ya conoce el controlador (app.js):
 *   Guardados: remove-saved (data-id) · chips [data-saved-filter] · #savedSearch
 *   Progreso:  period (data-days)
 *   Perfil:    save-profile (#profileName, input[name="studyPref"], #scheduleFrom,
 *              #scheduleTo, #prefReminders, #prefQuiet) · pick-avatar (data-color)
 *              toggle-theme · save-ai (#aiEnabled #aiProvider #aiBaseUrl #aiModel
 *              #aiApiKey) · test-ai · clear-ai · change-password (#currentPassword,
 *              #nextPassword) · logout · delete-account
 *
 * Este módulo añade por su cuenta (escucha delegada en document, una sola vez)
 * lo que el controlador no cubre:
 *   view-saved     abre un diálogo con el contenido guardado completo
 *   clear-data     borra los datos de estudio (conserva la cuenta)
 *   #confirmPassword  se valida antes de que el controlador cambie la contraseña
 *   #savedSearch   recupera el foco tras el repintado por la búsqueda
 * y, tras cambiar datos, vuelve a pintar lanzando un evento "hashchange".
 */
(function (root) {
  'use strict';

  const NexIA = (root.NexIA = root.NexIA || {});
  const U = NexIA.utils;
  const ui = NexIA.ui;
  const views = (NexIA.views = NexIA.views || {});
  const esc = U.esc;

  /* ------------------------------ utilidades ------------------------------ */

  function raw(state) {
    return (state && state.raw) || state || {};
  }

  /** Minúsculas y sin acentos, para búsquedas tolerantes. */
  function fold(text) {
    return String(text == null ? '' : text)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function materialOf(r, id) {
    return (r.materials || []).find((m) => m.id === id) || null;
  }

  /* --------------------------------- guardados --------------------------------- */

  const SAVED_TYPES = {
    conceptos: { label: 'Concepto', plural: 'Conceptos', icon: 'bookmark', box: 'purple' },
    fragmentos: { label: 'Fragmento', plural: 'Fragmentos', icon: 'highlight', box: 'mint' },
    ia: { label: 'Explicación de IA', plural: 'Explicaciones con IA', icon: 'sparkle', box: 'amber' }
  };

  function savedMeta(item) {
    return SAVED_TYPES[item.type] || SAVED_TYPES.conceptos;
  }

  function savedTitle(item) {
    if (item.title) return item.title;
    if (item.conceptTitle) return item.conceptTitle;
    if (item.type === 'ia' && item.question) return item.question;
    if (item.type === 'fragmentos') return 'Fragmento destacado';
    return 'Contenido guardado';
  }

  function savedText(item) {
    return item.preview || item.text || item.content || item.quote || item.answer || item.lead || item.summary || '';
  }

  function savedSource(r, item) {
    const m = materialOf(r, item.materialId);
    return item.course || item.materialTitle || (m ? m.title : '');
  }

  function savedHaystack(r, item) {
    return fold([savedTitle(item), savedText(item), item.question, savedSource(r, item), item.topicTitle].join(' '));
  }

  function chipType(meta) {
    return meta.box === 'amber' ? 'amber' : meta.box === 'mint' ? 'mint' : 'purple';
  }

  function savedCard(r, item) {
    const meta = savedMeta(item);
    const text = savedText(item);
    const where = [savedSource(r, item), item.topicTitle, U.relativeTime(item.createdAt)].filter(Boolean).join(' · ');
    const preview =
      item.type === 'ia' && item.question
        ? '<div class="saved-preview" style="flex-direction:column;align-items:flex-start;gap:6px">' +
          '<p class="saved-preview__note">Pregunta: ' + esc(U.truncate(item.question, 120)) + '</p>' +
          '<p class="saved-preview__quote">' + esc(U.truncate(text, 220)) + '</p></div>'
        : '<div class="saved-preview"><p class="saved-preview__quote">' +
          (text ? esc(U.truncate(text, 240)) : '<span class="saved-preview__note">Sin vista previa.</span>') +
          '</p></div>';

    return (
      '<article class="saved-card" data-saved-type="' + esc(item.type) + '" data-id="' + esc(item.id) + '">' +
      '<div class="saved-card__head">' +
      '<span style="display:inline-flex;align-items:center;gap:10px">' +
      '<span class="icon-box icon-box--' + meta.box + '">' + ui.icon(meta.icon, 18) + '</span>' +
      ui.chip(meta.label, chipType(meta)) +
      '</span>' +
      '<button type="button" class="icon-btn" data-action="remove-saved" data-id="' + esc(item.id) + '" aria-label="Quitar «' + esc(savedTitle(item)) + '» de guardados" title="Quitar de guardados">' +
      ui.icon('trash', 18) + '</button>' +
      '</div>' +
      '<h3 class="saved-card__title">' + esc(U.truncate(savedTitle(item), 90)) + '</h3>' +
      '<p class="saved-card__course">' + esc(where) + '</p>' +
      preview +
      '<div><button type="button" class="app-btn app-btn--outline app-btn--sm" data-action="view-saved" data-id="' + esc(item.id) + '">' +
      ui.icon('search', 16) + '<span>Ver completo</span></button></div>' +
      '</article>'
    );
  }

  function saved(state, filter, query) {
    const r = raw(state);
    const all = r.saved || [];
    const active = SAVED_TYPES[filter] ? filter : 'todos';
    const q = fold(query).trim();

    const counts = { todos: all.length, conceptos: 0, fragmentos: 0, ia: 0 };
    all.forEach((s) => {
      if (counts[s.type] !== undefined) counts[s.type]++;
    });

    const items = all.filter((s) => (active === 'todos' || s.type === active) && (!q || savedHaystack(r, s).indexOf(q) >= 0));

    const chips = [['todos', 'Todos']]
      .concat(Object.keys(SAVED_TYPES).map((k) => [k, SAVED_TYPES[k].plural]))
      .map(
        (c) =>
          '<button type="button" class="saved-filter-chip' + (c[0] === active ? ' is-active' : '') + '" data-saved-filter="' + c[0] + '" aria-pressed="' + (c[0] === active) + '">' +
          esc(c[1]) + ' (' + counts[c[0]] + ')</button>'
      )
      .join('');

    let content;
    if (!all.length) {
      content = ui.emptyState({
        icon: 'bookmark',
        title: 'Aún no has guardado nada',
        text: 'Guarda conceptos, fragmentos destacados o explicaciones del tutor mientras estudias y los tendrás todos aquí.',
        action: { href: '#/temas', label: 'Ir a mis temas' }
      });
    } else if (!items.length) {
      content = ui.emptyState({
        icon: 'search',
        title: 'Sin resultados',
        text: q ? 'No encontramos guardados que coincidan con «' + String(query).trim() + '». Prueba con otra palabra.' : 'No tienes guardados de este tipo todavía.'
      });
    } else {
      content = '<div class="saved-grid">' + items.map((s) => savedCard(r, s)).join('') + '</div>';
    }

    return (
      '<header class="view-header"><h1 class="view-title">Mis guardados</h1>' +
      '<p class="view-subtitle">Conceptos, fragmentos y explicaciones que quisiste conservar.</p></header>' +
      '<div class="library-toolbar">' +
      '<label class="search-field" for="savedSearch">' + ui.icon('search', 18) +
      '<input type="search" id="savedSearch" class="search-field__input" placeholder="Buscar en tus guardados…" value="' + esc(query || '') + '" autocomplete="off" aria-label="Buscar en tus guardados">' +
      '</label></div>' +
      '<div class="filter-chips" role="group" aria-label="Filtrar por tipo">' + chips + '</div>' +
      '<div class="saved-header-row">' +
      '<h2 class="subsection-title subsection-title--inline">' + esc(active === 'todos' ? 'Todo lo guardado' : SAVED_TYPES[active].plural) + '</h2>' +
      '<span class="saved-count" id="savedCount" aria-live="polite">' + esc(U.plural(items.length, 'contenido', 'contenidos')) + '</span>' +
      '</div>' +
      content
    );
  }

  /** HTML del cuerpo del diálogo "Ver completo". */
  function savedDetail(state, id) {
    const r = raw(state);
    const item = (r.saved || []).find((s) => s.id === id);
    if (!item) return '<p>Este contenido ya no está guardado.</p>';
    const meta = savedMeta(item);
    const text = savedText(item);
    return (
      '<div style="display:flex;flex-direction:column;gap:12px">' +
      '<p>' + ui.chip(meta.label, chipType(meta)) + '</p>' +
      '<h3 class="saved-card__title">' + esc(savedTitle(item)) + '</h3>' +
      '<p class="saved-card__course">' + esc([savedSource(r, item), item.topicTitle, U.formatLongDate(item.createdAt)].filter(Boolean).join(' · ')) + '</p>' +
      (item.type === 'ia' && item.question
        ? '<div class="saved-preview"><p class="saved-preview__note"><strong>Pregunta:</strong> ' + esc(item.question) + '</p></div>'
        : '') +
      '<div class="saved-preview" style="white-space:pre-wrap"><p class="saved-preview__quote">' + (text ? esc(text) : 'Sin contenido.') + '</p></div>' +
      '</div>'
    );
  }

  /* ---------------------------------- progreso ---------------------------------- */

  const PERIODS = [
    { days: 7, label: '7 días' },
    { days: 30, label: '30 días' },
    { days: 90, label: '90 días' }
  ];

  function statCard(iconName, box, value, label, foot) {
    return (
      '<article class="stat-card"><span class="icon-box icon-box--' + box + '">' + ui.icon(iconName, 20) + '</span>' +
      '<div><p class="stat-card__value">' + esc(value) + '</p><p class="stat-card__label">' + esc(label) + '</p>' +
      (foot ? '<p class="stat-card__foot">' + esc(foot) + '</p>' : '') + '</div></article>'
    );
  }

  function progress(state, periodDays) {
    const r = raw(state);
    const days = PERIODS.some((p) => p.days === Number(periodDays)) ? Number(periodDays) : 30;
    const stats = state.progressStats(days);
    const since = U.addDays(new Date(), -days);
    const sinceKey = U.dateKey(since);
    const reviewsDone = (r.activity || []).filter((a) => a.day >= sinceKey).reduce((n, a) => n + (a.review || 0), 0);
    const attemptsInPeriod = (r.attempts || []).filter((a) => a.createdAt >= since.getTime()).length;
    const hasData = (r.attempts || []).length > 0;

    const pills = PERIODS.map((p) => {
      const on = p.days === days;
      return (
        '<button type="button" class="period-pill' + (on ? ' is-active' : '') + '" data-action="period" data-days="' + p.days + '" aria-pressed="' + on + '">' +
        '<span>' + esc(p.label) + '</span></button>'
      );
    }).join('');

    const radar = stats.radar || [];
    const ranked = radar.slice().sort((a, b) => a.value - b.value);
    const weakest = ranked[0];
    const strongest = ranked[ranked.length - 1];
    const weakList = typeof state.weakConcepts === 'function' ? state.weakConcepts(3) : [];

    let recText;
    if (!hasData) {
      recText = 'Cuando resuelvas preguntas de práctica verás aquí tus puntos fuertes y lo que conviene reforzar.';
    } else if (weakest && weakest.value < 100) {
      recText =
        'Tu habilidad más baja es «' + weakest.label + '» (' + weakest.value + ' %)' +
        (strongest && strongest !== weakest ? ', y tu punto fuerte es «' + strongest.label + '» (' + strongest.value + ' %)' : '') +
        '. Un repaso corto esta semana puede subirla.';
    } else {
      recText = '¡Gran trabajo! Mantén el ritmo con repasos espaciados para no olvidar lo aprendido.';
    }

    const recommend =
      '<aside class="progress-recommend-card" aria-labelledby="progRecTitle">' +
      '<div class="progress-recommend-card__head">' +
      '<h2 class="progress-recommend-card__title" id="progRecTitle">Qué hacer ahora</h2>' +
      '<span class="icon-box icon-box--white">' + ui.icon('target', 20) + '</span>' +
      '</div>' +
      '<p class="progress-recommend-card__text">' + esc(recText) + '</p>' +
      (weakList.length
        ? '<ul class="progress-recommend-card__list">' +
          weakList
            .map((w) => '<li><span class="check-circle check-circle--white" aria-hidden="true">!</span><span>' + esc(w.conceptTitle || 'Concepto') + ' · ' + w.rate + ' % de acierto</span></li>')
            .join('') +
          '</ul>'
        : '') +
      '<a class="app-btn app-btn--white" href="#/repaso">' + (weakList.length ? 'Reforzar ahora' : 'Ir a repaso') + '</a>' +
      '</aside>';

    const line = stats.line || { points: [], labels: [] };

    return (
      '<header class="view-header"><h1 class="view-title">Mi progreso</h1>' +
      '<p class="view-subtitle">Mira cómo avanzas y en qué habilidades vas mejor.</p></header>' +
      '<div class="progress-toolbar">' +
      '<div class="sim-chips" role="group" aria-label="Periodo">' + pills + '</div>' +
      '<p class="progress-toolbar__note">Últimos ' + days + ' días</p>' +
      '</div>' +
      (hasData
        ? ''
        : '<aside class="memory-tip-banner" style="margin:0 0 20px"><span class="icon-box icon-box--mint">' + ui.icon('info', 18) + '</span>' +
          '<div><h2 class="memory-tip-banner__title">Todavía no hay datos de práctica</h2>' +
          '<p class="memory-tip-banner__text">Resuelve las preguntas de un tema y tu progreso aparecerá aquí.</p></div></aside>') +
      '<div class="stats-row">' +
      statCard('book', 'purple', String(stats.completedTopics || 0), 'Temas completados') +
      statCard('target', 'mint', (stats.accuracy || 0) + ' %', 'Precisión en preguntas', U.plural(attemptsInPeriod, 'intento', 'intentos') + ' en el periodo') +
      statCard('flame', 'amber', String(stats.streakDays || 0), 'Días de racha') +
      statCard('refresh', 'purple', String(reviewsDone), 'Repasos realizados') +
      '</div>' +
      '<section class="chart-card" aria-labelledby="progLineTitle">' +
      '<h2 class="chart-card__title" id="progLineTitle">Temas completados</h2>' +
      '<p class="chart-card__sub">Acumulado en las últimas 5 semanas</p>' +
      '<div class="line-chart-wrap">' + ui.lineChart(line.points || [], line.labels || []) + '</div>' +
      '</section>' +
      '<div class="progress-bottom-grid">' +
      '<section class="chart-card" aria-labelledby="progRadarTitle">' +
      '<h2 class="chart-card__title" id="progRadarTitle">Tus habilidades</h2>' +
      '<p class="chart-card__sub">Porcentaje de acierto por tipo de pregunta</p>' +
      '<div class="radar-chart-container">' + ui.radarChart(radar) + '</div>' +
      '</section>' +
      recommend +
      '</div>'
    );
  }

  /* ----------------------------------- perfil ----------------------------------- */

  const STUDY_MODES = [
    { value: 'lectura', label: 'Lectura', desc: 'Textos, resúmenes y puntos clave.' },
    { value: 'audio', label: 'Audio', desc: 'Prefiero escuchar el contenido.' },
    { value: 'visual', label: 'Visual', desc: 'Esquemas, ejemplos y código.' }
  ];

  function profileHead(iconName, box, title, sub, id) {
    return (
      '<div class="profile-card__head"><span class="icon-box icon-box--' + box + '">' + ui.icon(iconName, 18) + '</span>' +
      '<h2 class="profile-card__title" id="' + id + '">' + esc(title) + '</h2></div>' +
      (sub ? '<p class="profile-card__sub">' + esc(sub) + '</p>' : '')
    );
  }

  function field(id, label, control, hint) {
    return (
      '<div class="form-group"><label class="form-label" for="' + id + '">' + esc(label) + '</label>' + control +
      (hint ? '<p class="form-hint">' + esc(hint) + '</p>' : '') + '</div>'
    );
  }

  function toggleRow(labelId, title, desc, inputAttrs, checked) {
    return (
      '<div class="setting-toggle-row">' +
      '<span id="' + labelId + '"><strong>' + esc(title) + '</strong>' +
      (desc ? '<br><span class="profile-card__sub">' + esc(desc) + '</span>' : '') + '</span>' +
      '<label class="switch"><input type="checkbox" role="switch" aria-labelledby="' + labelId + '" ' + inputAttrs + (checked ? ' checked' : '') + '>' +
      '<span class="switch__slider"></span></label>' +
      '</div>'
    );
  }

  function swatches(user) {
    const colors = (NexIA.auth && NexIA.auth.AVATAR_COLORS) || ['#5558F5'];
    const current = String(user.avatarColor || colors[0]).toLowerCase();
    return colors
      .map((color) => {
        const on = color.toLowerCase() === current;
        return (
          '<button type="button" class="color-swatch' + (on ? ' is-selected' : '') + '" style="background:' + esc(color) + '" data-action="pick-avatar" data-color="' + esc(color) + '" ' +
          'aria-pressed="' + on + '" aria-label="Color de avatar ' + esc(color) + (on ? ' (seleccionado)' : '') + '"></button>'
        );
      })
      .join('');
  }

  function aiPanel() {
    const ai = NexIA.ai;
    if (!ai) {
      return (
        '<section class="ai-settings-card" aria-labelledby="aiTitle"><h2 class="profile-card__title" id="aiTitle">Asistente con IA (opcional)</h2>' +
        '<p class="form-hint">El módulo de IA no está disponible en esta página.</p></section>'
      );
    }
    const cfg = ai.readConfig();
    const presets = ai.PRESETS || {};
    const ready = ai.isReady(cfg);
    const keyHint = cfg.apiKey ? 'Clave guardada (termina en ' + String(cfg.apiKey).slice(-4) + '). Escribe otra para reemplazarla.' : 'Pega aquí tu clave de API';

    const options = Object.keys(presets)
      .map((key) => '<option value="' + esc(key) + '"' + (cfg.provider === key ? ' selected' : '') + '>' + esc(presets[key].label) + '</option>')
      .join('');

    return (
      '<section class="ai-settings-card" aria-labelledby="aiTitle">' +
      '<div class="profile-card__head"><span class="icon-box icon-box--mint">' + ui.icon('sparkle', 18) + '</span>' +
      '<h2 class="profile-card__title" id="aiTitle">Asistente con IA (opcional)</h2>' +
      ui.chip(ready ? 'IA activa' : 'Usando tutor local', ready ? 'mint' : 'purple') + '</div>' +
      '<p class="profile-card__sub" style="margin-top:8px">Conecta tu propio proveedor compatible con la API de OpenAI para que el tutor responda con un modelo de lenguaje. Sin IA, NexIA usa su tutor local basado en tu material.</p>' +
      '<div class="mint-tip-card" style="margin:14px 0">' +
      '<h3 class="mint-tip-card__title">Cómo funciona, con honestidad</h3>' +
      '<p class="mint-tip-card__text">Tu clave se guarda solo en este navegador (almacenamiento local) y nunca pasa por un servidor de NexIA: no tenemos uno. ' +
      'Cuando haces una pregunta, tu navegador envía directamente al proveedor que elijas esa pregunta junto con un fragmento de tu material, y se aplican sus condiciones y costos. ' +
      'Cualquiera con acceso a este navegador podría ver la clave: no la uses en equipos compartidos.</p>' +
      '</div>' +
      toggleRow('aiEnabledLabel', 'Usar IA en el tutor', 'Si falla, se usa el tutor local.', 'id="aiEnabled"', cfg.enabled) +
      '<div class="ai-settings-card__grid" style="margin-top:14px">' +
      field('aiProvider', 'Proveedor', '<div class="select-wrapper"><select class="form-select" id="aiProvider">' + options + '</select><span class="select-chevron" aria-hidden="true">▾</span></div>') +
      field('aiModel', 'Modelo', '<input class="form-input" type="text" id="aiModel" value="' + esc(cfg.model) + '" placeholder="gpt-4o-mini" autocomplete="off" spellcheck="false">') +
      '<div style="grid-column:1/-1">' +
      field('aiBaseUrl', 'URL base', '<input class="form-input" type="url" id="aiBaseUrl" value="' + esc(cfg.baseUrl) + '" placeholder="https://api.openai.com/v1" autocomplete="off" spellcheck="false">') +
      '</div>' +
      '<div style="grid-column:1/-1">' +
      field(
        'aiApiKey',
        'Clave de API',
        '<input class="form-input" type="password" id="aiApiKey" value="" placeholder="' + esc(keyHint) + '" autocomplete="off" spellcheck="false">',
        'Se crea en el sitio de tu proveedor. Déjala vacía para conservar la que ya tienes.'
      ) +
      '</div></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">' +
      '<button type="button" class="app-btn app-btn--primary app-btn--sm" data-action="save-ai">Guardar ajustes de IA</button>' +
      '<button type="button" class="app-btn app-btn--outline app-btn--sm" data-action="test-ai">' + ui.icon('refresh', 16) + '<span>Probar conexión</span></button>' +
      '<button type="button" class="app-btn app-btn--muted app-btn--sm" data-action="clear-ai">' + ui.icon('trash', 16) + '<span>Borrar clave</span></button>' +
      '</div>' +
      '</section>'
    );
  }

  function profile(state) {
    const r = raw(state);
    const user = r.user || {};
    const defaults = NexIA.auth && NexIA.auth.defaultPrefs ? NexIA.auth.defaultPrefs() : {};
    const prefs = Object.assign(defaults, user.prefs || {});
    const studyMode = prefs.studyMode === 'video' ? 'visual' : prefs.studyMode;
    const hasPassword = Boolean(user.pass);
    const dangerOutline = 'color:var(--color-danger);border-color:var(--color-danger)';

    const hero =
      '<section class="profile-hero-card" aria-labelledby="profileHeroName">' +
      '<div class="profile-hero-card__user">' +
      ui.avatarHtml(user, 'avatar--lg') +
      '<div><h2 class="profile-hero-card__name" id="profileHeroName">' + esc(user.name || 'Estudiante') + '</h2>' +
      '<p class="profile-hero-card__role">' + esc(user.email || '') + (user.createdAt ? ' · Desde ' + esc(U.formatLongDate(user.createdAt)) : '') + '</p></div>' +
      '</div>' +
      '<div>' + ui.chip(user.demo ? 'Cuenta de demostración' : 'Cuenta local', user.demo ? 'amber' : 'purple') + '</div>' +
      '</section>';

    const personal =
      '<section class="profile-card" aria-labelledby="pcPersonal">' +
      profileHead('user', 'purple', 'Datos personales', 'Tu nombre y el color de tu avatar.', 'pcPersonal') +
      field('profileName', 'Nombre', '<input class="form-input" type="text" id="profileName" value="' + esc(user.name || '') + '" maxlength="60" autocomplete="name">') +
      field('profileEmail', 'Correo electrónico', '<input class="form-input" type="email" id="profileEmail" value="' + esc(user.email || '') + '" disabled>', 'El correo identifica tu cuenta y no se puede cambiar.') +
      '<div class="form-group"><span class="form-label" id="avatarColorLabel">Color del avatar</span>' +
      '<div class="color-swatches" role="group" aria-labelledby="avatarColorLabel">' + swatches(user) + '</div>' +
      '<p class="form-hint">El color se guarda al elegirlo.</p></div>' +
      '</section>';

    const study =
      '<section class="profile-card" aria-labelledby="pcStudy">' +
      profileHead('book', 'mint', 'Cómo prefieres estudiar', 'Abriremos primero el formato que más te sirve.', 'pcStudy') +
      '<div class="pref-radios" role="radiogroup" aria-labelledby="pcStudy">' +
      STUDY_MODES.map(
        (m) =>
          '<label class="pref-radio"><input type="radio" name="studyPref" value="' + m.value + '"' + (studyMode === m.value ? ' checked' : '') + '>' +
          '<span><strong>' + esc(m.label) + '</strong><br><span class="profile-card__sub">' + esc(m.desc) + '</span></span></label>'
      ).join('') +
      '</div></section>';

    const schedule =
      '<section class="profile-card" aria-labelledby="pcSchedule">' +
      profileHead('clock', 'purple', 'Horario de estudio', 'Lo usamos para tus recordatorios y para el calendario de repaso.', 'pcSchedule') +
      '<p class="schedule-pill">' + ui.icon('clock', 18) + '<span>' + esc(prefs.scheduleFrom) + ' – ' + esc(prefs.scheduleTo) + '</span></p>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      field('scheduleFrom', 'Desde', '<input class="form-input" type="time" id="scheduleFrom" value="' + esc(prefs.scheduleFrom) + '">') +
      field('scheduleTo', 'Hasta', '<input class="form-input" type="time" id="scheduleTo" value="' + esc(prefs.scheduleTo) + '">') +
      '</div></section>';

    const reminders =
      '<section class="profile-card" aria-labelledby="pcRemind">' +
      profileHead('settings', 'amber', 'Recordatorios y apariencia', '', 'pcRemind') +
      toggleRow('remRemindersLabel', 'Recordatorios de repaso', 'Te avisamos cuando tengas repasos pendientes.', 'id="prefReminders"', prefs.reminders) +
      toggleRow('remQuietLabel', 'Silenciar fuera de mi horario', 'No te avisamos fuera de tu horario de estudio.', 'id="prefQuiet"', prefs.quietHours) +
      toggleRow('remThemeLabel', 'Modo oscuro', 'Descansa la vista en ambientes con poca luz. Se aplica al instante.', 'id="prefDark" data-action="toggle-theme"', prefs.theme === 'dark') +
      '</section>';

    const password =
      '<section class="profile-card" aria-labelledby="pcPass">' +
      profileHead(
        'lock',
        'purple',
        'Cambiar contraseña',
        hasPassword ? 'Usa al menos 8 caracteres con letras y números.' : 'Esta cuenta aún no tiene contraseña. Crea una para iniciar sesión con tu correo.',
        'pcPass'
      ) +
      field(
        'currentPassword',
        'Contraseña actual',
        '<input class="form-input" type="password" id="currentPassword" autocomplete="current-password"' + (hasPassword ? '' : ' disabled placeholder="No tienes contraseña todavía"') + '>'
      ) +
      field('nextPassword', 'Nueva contraseña', '<input class="form-input" type="password" id="nextPassword" autocomplete="new-password" minlength="8">') +
      field('confirmPassword', 'Repite la nueva contraseña', '<input class="form-input" type="password" id="confirmPassword" autocomplete="new-password">') +
      '<div><button type="button" class="app-btn app-btn--primary app-btn--sm" data-action="change-password">Actualizar contraseña</button></div>' +
      '</section>';

    const data =
      '<section class="profile-card" aria-labelledby="pcData">' +
      profileHead('shield', 'mint', 'Tus datos', 'Todo se guarda solo en este navegador. Estas acciones no se pueden deshacer.', 'pcData') +
      '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start">' +
      '<button type="button" class="app-btn app-btn--outline app-btn--sm" style="' + dangerOutline + '" data-action="clear-data">' + ui.icon('trash', 16) + '<span>Borrar mis datos de estudio</span></button>' +
      '<p class="form-hint" style="margin:0 0 10px">Elimina materiales, intentos, guardados y repasos, pero conserva tu cuenta.</p>' +
      '<button type="button" class="app-btn app-btn--danger app-btn--sm" data-action="delete-account">' + ui.icon('trash', 16) + '<span>Eliminar mi cuenta</span></button>' +
      '<p class="form-hint" style="margin:0">Borra tu cuenta y todos sus datos de este dispositivo.</p>' +
      '</div></section>';

    return (
      '<header class="view-header"><h1 class="view-title">Mi perfil</h1>' +
      '<p class="view-subtitle">Ajusta tu cuenta, tus preferencias de estudio y el asistente con IA.</p></header>' +
      hero +
      '<div class="profile-grid">' + personal + study + schedule + reminders + '</div>' +
      '<div class="view-action-footer"><p class="view-action-footer__hint">Guarda tu nombre, preferencia de estudio, horario y recordatorios.</p>' +
      '<div class="view-action-footer__buttons"><button type="button" class="app-btn app-btn--primary" data-action="save-profile">Guardar cambios</button></div></div>' +
      aiPanel() +
      '<div class="profile-grid">' + password + data + '</div>' +
      '<div class="profile-logout-row">' +
      '<button type="button" class="app-btn app-btn--outline" data-action="logout">' + ui.icon('logout', 18) + '<span>Cerrar sesión</span></button>' +
      '<span class="profile-protected">' + ui.icon('shield', 16) + 'Tus datos se guardan solo en este dispositivo.</span>' +
      '</div>'
    );
  }

  views.saved = saved;
  views.savedDetail = savedDetail;
  views.progress = progress;
  views.profile = profile;

  /* --------------------- acciones propias de estas vistas --------------------- */

  function rerender() {
    root.dispatchEvent(new root.Event('hashchange'));
  }

  function openSavedDialog(id) {
    const st = NexIA.state;
    if (!st) return;
    const item = st.raw.saved.find((s) => s.id === id);
    if (!item) {
      ui.toast('Ese contenido ya no está guardado.', 'error');
      return;
    }
    let link = '';
    const material = materialOf(st.raw, item.materialId);
    if (material && item.conceptId) {
      material.topics.forEach((t, ti) =>
        t.concepts.forEach((c, ci) => {
          if (c.id === item.conceptId && !link) link = '#/leccion/' + material.id + '/' + ti + '/' + ci;
        })
      );
    }
    ui.openDialog({
      title: 'Contenido guardado',
      body: savedDetail(st, id),
      footer:
        '<button type="button" class="app-btn app-btn--outline" data-dialog-close>Cerrar</button>' +
        (link ? '<a class="app-btn app-btn--primary" href="' + esc(link) + '" data-dialog-close>Ir a la lección</a>' : '')
    });
  }

  async function clearStudyData() {
    const st = NexIA.state;
    if (!st || !st.raw.user) return;
    const ok = await ui.confirmDialog({
      title: 'Borrar datos de estudio',
      text: 'Se eliminarán tus materiales, evaluaciones, guardados, repasos y actividad. Tu cuenta se conserva. Esta acción no se puede deshacer.',
      confirm: 'Borrar datos',
      danger: true
    });
    if (!ok) return;
    try {
      await NexIA.store.clearUserData(st.raw.user.id);
      await st.loadAll(st.raw.user);
      if (NexIA.appSession) {
        NexIA.appSession.quiz = null;
        NexIA.appSession.review = null;
      }
      ui.toast('Tus datos de estudio se borraron.', 'success');
      rerender();
    } catch (err) {
      ui.toast((err && err.message) || 'No se pudieron borrar los datos.', 'error');
    }
  }

  if (typeof document !== 'undefined' && !NexIA._moreActionsBound) {
    NexIA._moreActionsBound = true;

    // En fase de captura: bloquea el cambio de contraseña si la confirmación no coincide.
    document.addEventListener(
      'click',
      (event) => {
        const btn = event.target.closest && event.target.closest('[data-action="change-password"]');
        if (!btn) return;
        const next = document.getElementById('nextPassword');
        const confirm = document.getElementById('confirmPassword');
        if (next && confirm && next.value !== confirm.value) {
          event.preventDefault();
          event.stopPropagation();
          ui.toast('La confirmación no coincide con la nueva contraseña.', 'error');
        } else if (confirm) {
          setTimeout(() => {
            if (next && !next.value) confirm.value = '';
          }, 400);
        }
      },
      true
    );

    document.addEventListener('click', (event) => {
      const target = event.target.closest('[data-action]');
      if (!target) return;
      const action = target.getAttribute('data-action');
      if (action === 'view-saved') openSavedDialog(target.getAttribute('data-id'));
      else if (action === 'clear-data') clearStudyData();
    });

    // La búsqueda repinta la vista: devolvemos el foco y el cursor al campo.
    let focusTimer = null;
    document.addEventListener('input', (event) => {
      const input = event.target;
      if (!input || input.id !== 'savedSearch') return;
      const pos = input.selectionStart;
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        const el = document.getElementById('savedSearch');
        if (el && document.activeElement !== el) {
          el.focus();
          try {
            el.setSelectionRange(pos, pos);
          } catch (err) {
            /* tipo search: sin selección */
          }
        }
      }, 320);
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
