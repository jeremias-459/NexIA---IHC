/*
 * NexIA · Vistas de inicio: panel (#/inicio), subir material (#/explorar)
 * y documento listo (#/documento/ID).
 *
 * Cada vista es una función pura que recibe el estado y devuelve HTML (texto).
 * La navegación usa href="#/..." y las acciones usan data-action="...":
 *
 *   Explorar:  pick-file · clear-file · analyze · use-sample
 *              (+ #fileInput, #pasteText y [data-dropzone] para arrastrar y soltar)
 *   Documento: sin acciones (solo enlaces)
 */
(function (root) {
  'use strict';

  const NexIA = (root.NexIA = root.NexIA || {});
  const U = NexIA.utils;
  const ui = NexIA.ui;
  const views = (NexIA.views = NexIA.views || {});

  /* ------------------------------------------------------------------ */
  /* Rutas (compartidas con views-learn.js)                              */
  /* ------------------------------------------------------------------ */

  const enc = (value) => encodeURIComponent(String(value));

  views.routes = views.routes || {
    explore: '#/explorar',
    library: '#/temas',
    review: '#/repaso',
    document: (id) => '#/documento/' + enc(id),
    lesson: (id, ti, ci) => '#/leccion/' + enc(id) + '/t/' + (ti | 0) + (ci === undefined || ci === null ? '' : '/c/' + (ci | 0)),
    quiz: (id, ti) => '#/practica/' + enc(id) + (ti === undefined || ti === null ? '' : '/t/' + (ti | 0)),
    results: (id) => '#/resultados/' + enc(id)
  };
  const routes = views.routes;

  /* ------------------------------------------------------------------ */
  /* Utilidades internas                                                 */
  /* ------------------------------------------------------------------ */

  /** Datos crudos del estado (acepta la API de NexIA.state o el objeto crudo). */
  function dataOf(state) {
    return (state && state.raw) || state || {};
  }

  /** API de consulta del estado (materialProgress, weekDots, ...). */
  function apiOf(state) {
    return state && typeof state.materialProgress === 'function' ? state : NexIA.state;
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Buenos días';
    if (hour >= 12 && hour < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }

  function firstName(user) {
    const name = String((user && user.name) || '').trim();
    return name ? name.split(/\s+/)[0] : 'estudiante';
  }

  function lastActivity(material) {
    return material.lastOpenedAt || material.createdAt || 0;
  }

  function mostRecent(materials) {
    return (
      materials.slice().sort((a, b) => lastActivity(b) - lastActivity(a))[0] || null
    );
  }

  function isDone(material, concept) {
    return Boolean(material.progress && material.progress.done && material.progress.done[concept.id]);
  }

  /** Concepto al que conviene volver: el siguiente sin completar desde el último visto. */
  function resumePoint(material) {
    const topics = material.topics || [];
    const flat = [];
    topics.forEach((topic, ti) => (topic.concepts || []).forEach((concept, ci) => flat.push({ ti, ci, topic, concept })));
    if (!flat.length) return null;
    const last = (material.progress && material.progress.last) || { t: 0, c: 0 };
    let start = flat.findIndex((item) => item.ti === (last.t | 0) && item.ci === (last.c | 0));
    if (start < 0) start = 0;
    for (let k = 0; k < flat.length; k++) {
      const item = flat[(start + k) % flat.length];
      if (!isDone(material, item.concept)) return Object.assign({ finished: false }, item);
    }
    return Object.assign({ finished: true }, flat[start]);
  }

  function statusChip(status) {
    if (status === 'completado') return ui.chip('Completado', 'mint');
    if (status === 'progreso') return ui.chip('En progreso', 'purple');
    return ui.chip('Nuevo', 'amber');
  }

  function countQuestions(material) {
    return (material.topics || []).reduce(
      (sum, topic) => sum + (topic.concepts || []).reduce((n, concept) => n + ((concept.questions || []).length), 0),
      0
    );
  }

  function countCards(material) {
    return (material.topics || []).reduce(
      (sum, topic) => sum + (topic.concepts || []).reduce((n, concept) => n + ((concept.cards || []).length), 0),
      0
    );
  }

  function svgIllustration(id, viewBox, className) {
    return '<svg class="' + className + '" viewBox="' + viewBox + '" aria-hidden="true" focusable="false"><use href="#' + id + '"></use></svg>';
  }

  /* ------------------------------------------------------------------ */
  /* Inicio                                                              */
  /* ------------------------------------------------------------------ */

  function continueCard(S, A) {
    const material = mostRecent(S.materials || []);
    if (!material) {
      return (
        '<section class="continue-card" aria-labelledby="continueTitle">' +
        '<div class="continue-card__body">' +
        '<span class="continue-card__eyebrow">EMPIEZA AQUÍ</span>' +
        '<h2 class="continue-card__title" id="continueTitle">Sube tu primer material</h2>' +
        '<p class="continue-card__course">Convierte tus apuntes en lecciones, preguntas de práctica y repasos.</p>' +
        '<a class="app-btn app-btn--white" href="' + routes.explore + '">Subir material</a>' +
        '</div>' +
        svgIllustration('illus-student', '0 0 220 150', 'continue-card__illus') +
        '</section>'
      );
    }

    const progress = A.materialProgress(material);
    const point = resumePoint(material);
    const href = point ? routes.lesson(material.id, point.ti, point.ci) : routes.document(material.id);
    const where = point
      ? 'Tema ' + (point.ti + 1) + ': ' + point.topic.title + ' · ' + point.concept.title
      : U.plural((material.topics || []).length, 'tema', 'temas');
    const action = progress.pct >= 100 ? 'Repasar material' : progress.done > 0 ? 'Continuar' : 'Empezar';
    const progressText =
      progress.done + ' de ' + U.plural(progress.total, 'concepto', 'conceptos') + ' · ' + progress.pct + ' %';

    return (
      '<section class="continue-card" aria-labelledby="continueTitle">' +
      '<div class="continue-card__body">' +
      '<span class="continue-card__eyebrow">' + (progress.done > 0 ? 'CONTINÚA DONDE LO DEJASTE' : 'LISTO PARA EMPEZAR') + '</span>' +
      '<h2 class="continue-card__title" id="continueTitle">' + U.esc(material.title) + '</h2>' +
      '<p class="continue-card__course">' + U.esc(where) + '</p>' +
      '<div class="continue-card__progress" role="img" aria-label="Progreso: ' + progress.pct + ' por ciento">' +
      '<span class="progress-track progress-track--on-primary"><span class="progress-fill" style="width:' +
      U.clamp(progress.pct, 0, 100) +
      '%;background-color:#fff"></span></span>' +
      '<span class="continue-card__percent">' + U.esc(progressText) + '</span>' +
      '</div>' +
      '<a class="app-btn app-btn--white" href="' + U.esc(href) + '">' + action + ' ' + ui.icon('arrow-right', 16) + '</a>' +
      '</div>' +
      svgIllustration('illus-student', '0 0 220 150', 'continue-card__illus') +
      '</section>'
    );
  }

  function streakCard(A) {
    const streak = A.streakDays();
    const dots = A.weekDots();
    const activeDays = dots.filter((d) => d.done).length;
    const names = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
    const dotsHtml = dots
      .map((dot, i) => {
        const label = names[i] + (dot.done ? ': día con actividad' : ': sin actividad') + (dot.today ? ' (hoy)' : '');
        return (
          '<span class="week-dot' + (dot.done ? ' week-dot--done' : '') + '"' +
          (dot.today ? ' style="box-shadow:0 0 0 2px var(--color-primary)"' : '') +
          ' role="img" aria-label="' + U.esc(label) + '">' + U.esc(dot.label) + '</span>'
        );
      })
      .join('');
    const sub =
      streak > 0
        ? 'Sigue así: estudiar un poco cada día ayuda a recordar mejor.'
        : 'Aún no tienes racha. Completa un concepto o una práctica hoy para empezarla.';
    return (
      '<section class="streak-mini-card" aria-labelledby="streakTitle">' +
      '<div class="streak-mini-card__top">' +
      '<span class="streak-mini-card__label" style="margin-top:0">Tu racha de estudio</span>' +
      '<span class="icon-box icon-box--amber" aria-hidden="true">' + ui.icon('flame', 20) + '</span>' +
      '</div>' +
      '<h2 class="streak-mini-card__title" id="streakTitle">' + U.esc(U.plural(streak, 'día', 'días')) + '</h2>' +
      '<p class="streak-mini-card__sub">' + U.esc(sub) + '</p>' +
      '<div class="week-dots" role="group" aria-label="Actividad de esta semana">' + dotsHtml + '</div>' +
      '<p class="streak-mini-card__footer">Esta semana: ' + U.esc(U.plural(activeDays, 'día activo', 'días activos')) + ' de 7</p>' +
      '</section>'
    );
  }

  function actionCards(S, A) {
    const due = typeof A.dueReviews === 'function' ? A.dueReviews().length : 0;
    const materialCount = (S.materials || []).length;

    const upload =
      '<article class="action-card">' +
      '<div class="action-card__head">' +
      '<span class="icon-box icon-box--purple" aria-hidden="true">' + ui.icon('upload', 20) + '</span>' +
      '<h2 class="action-card__title">Sube un material</h2>' +
      '</div>' +
      '<div class="action-card__content">' +
      '<p class="action-card__text">Sube un PDF, un DOCX o un texto. NexIA lo analiza en tu dispositivo y lo divide en temas, conceptos y preguntas.</p>' +
      svgIllustration('illus-doc', '0 0 160 125', 'action-card__illus') +
      '</div>' +
      '<div class="action-card__footer">' +
      '<a class="app-btn app-btn--primary" href="' + routes.explore + '">Subir material</a>' +
      '<span class="action-card__tags">PDF · DOCX · TXT · MD</span>' +
      '</div>' +
      '</article>';

    let reviewText;
    let reviewTag;
    if (!materialCount) {
      reviewText = 'Cuando tengas material y respondas preguntas, NexIA programará repasos para lo que más te cueste.';
      reviewTag = 'Aún no hay repasos';
    } else if (due > 0) {
      reviewText = 'Tienes conceptos listos para repasar hoy. Un repaso corto fortalece lo que ya estudiaste.';
      reviewTag = U.plural(due, 'repaso pendiente', 'repasos pendientes');
    } else {
      reviewText = 'No tienes repasos pendientes hoy. Cuando falles una pregunta, NexIA la programará para volver a verla.';
      reviewTag = 'Todo al día';
    }
    const review =
      '<article class="action-card">' +
      '<div class="action-card__head">' +
      '<span class="icon-box icon-box--mint" aria-hidden="true">' + ui.icon('brain', 20) + '</span>' +
      '<h2 class="action-card__title">Repasa lo que fallaste</h2>' +
      '</div>' +
      '<div class="action-card__content">' +
      '<p class="action-card__text">' + U.esc(reviewText) + '</p>' +
      '</div>' +
      '<div class="action-card__footer">' +
      '<a class="app-btn app-btn--outline" href="' + routes.review + '">Ir al repaso</a>' +
      '<span class="action-card__tags">' + U.esc(reviewTag) + '</span>' +
      '</div>' +
      '</article>';

    return '<div class="dash-actions-row">' + upload + review + '</div>';
  }

  function recentRow(material, A) {
    const progress = A.materialProgress(material);
    const point = resumePoint(material);
    const href = point ? routes.lesson(material.id, point.ti, point.ci) : routes.document(material.id);
    const topics = (material.topics || []).length;
    return (
      '<a class="recent-row" href="' + U.esc(href) + '">' +
      '<span class="icon-box icon-box--purple" aria-hidden="true">' + ui.icon('file', 20) + '</span>' +
      '<span class="recent-row__body">' +
      '<span class="recent-row__title">' + U.esc(material.title) + '</span>' +
      '<span class="recent-row__meta">' +
      U.esc(U.plural(topics, 'tema', 'temas') + ' · ' + U.relativeTime(lastActivity(material))) +
      '</span>' +
      '</span>' +
      '<span class="recent-row__progress">' +
      ui.progressBar(progress.pct) +
      '<span class="recent-row__percent">' + progress.pct + ' %</span>' +
      '</span>' +
      '<span class="recent-row__arrow" aria-hidden="true">›</span>' +
      '</a>'
    );
  }

  function recentList(S, A) {
    const materials = (S.materials || []).slice().sort((a, b) => lastActivity(b) - lastActivity(a));
    const head =
      '<div class="recent-card__head">' +
      '<div><h2 class="recent-card__title">Materiales recientes</h2>' +
      '<p class="recent-card__sub">' +
      (materials.length ? U.esc(U.plural(materials.length, 'material guardado', 'materiales guardados')) : 'Aquí aparecerán los materiales que subas') +
      '</p></div>' +
      (materials.length
        ? '<a class="app-btn app-btn--outline app-btn--sm" href="' + routes.library + '">Ver todos</a>'
        : '') +
      '</div>';
    const body = materials.length
      ? materials.slice(0, 5).map((m) => recentRow(m, A)).join('')
      : ui.emptyState({
        icon: 'folder',
        title: 'Todavía no tienes materiales',
        text: 'Sube tus apuntes o prueba con el material de ejemplo para ver cómo funciona NexIA.',
        action: { href: routes.explore, label: 'Subir mi primer material' }
      });
    return '<section class="recent-card" aria-label="Materiales recientes">' + head + body + '</section>';
  }

  views.home = function home(state) {
    const S = dataOf(state);
    const A = apiOf(state);
    const today = new Date();
    return (
      '<div class="view-header">' +
      '<p class="view-eyebrow">' + U.esc(U.WEEKDAYS[today.getDay()] + ', ' + U.formatLongDate(today)) + '</p>' +
      '<h1 class="view-title">' + U.esc(greeting() + ', ' + firstName(S.user)) + '</h1>' +
      '<p class="view-subtitle">Este es tu espacio de estudio. Retoma tu material o sube uno nuevo.</p>' +
      '</div>' +
      '<div class="dash-hero-row">' + continueCard(S, A) + streakCard(A) + '</div>' +
      actionCards(S, A) +
      recentList(S, A)
    );
  };

  /* ------------------------------------------------------------------ */
  /* Explorar (subir material)                                           */
  /* ------------------------------------------------------------------ */

  const STEPS = [
    { icon: 'file', title: '1. Leer el documento', desc: 'Extraemos el texto del archivo en tu navegador, sin enviarlo a ningún servidor.' },
    { icon: 'layers', title: '2. Detectar temas', desc: 'Buscamos títulos y secciones para dividir el material en temas y conceptos.' },
    { icon: 'bulb', title: '3. Crear práctica', desc: 'Con las ideas y términos clave armamos preguntas y tarjetas de repaso.' },
    { icon: 'check-circle', title: '4. Preparar tu curso', desc: 'Guardamos todo en este dispositivo para que estudies cuando quieras.' }
  ];

  /** Normaliza el progreso de análisis: número (0-1 o 0-100) u objeto {page, pages, pct, step, label}. */
  function progressInfo(progress) {
    let overall = null;
    let step = null;
    let label = '';
    if (typeof progress === 'number' && isFinite(progress)) {
      overall = progress > 0 && progress <= 1 ? progress * 100 : progress;
    } else if (progress && typeof progress === 'object') {
      if (progress.pct !== undefined && progress.pct !== null) overall = Number(progress.pct);
      else if (progress.page && progress.pages) {
        overall = (progress.page / progress.pages) * 40;
        label = 'Leyendo página ' + progress.page + ' de ' + progress.pages;
      }
      if (progress.step !== undefined && progress.step !== null) step = progress.step | 0;
      if (progress.label) label = String(progress.label);
    }
    if (overall !== null) overall = U.clamp(Math.round(overall), 0, 100);
    if (step === null) {
      if (overall === null || overall < 35) step = 0;
      else if (overall < 65) step = 1;
      else if (overall < 95) step = 2;
      else step = 3;
    }
    return { pct: overall, step: U.clamp(step, 0, STEPS.length - 1), label };
  }

  function stepsGrid(analyzing, info) {
    const cards = STEPS.map((step, i) => {
      let mark = '';
      let style = '';
      if (analyzing) {
        if (i < info.step) {
          mark = '<span class="status-chip status-chip--mint">Listo</span>';
        } else if (i === info.step) {
          mark = '<span class="status-chip status-chip--purple">En curso</span>';
          style = ' style="border-color:var(--color-primary)"';
        } else {
          mark = '<span class="status-chip status-chip--white" style="background-color:var(--color-bg-main);color:var(--color-text-muted)">Pendiente</span>';
        }
      }
      return (
        '<div class="process-step-card"' + style + (analyzing && i === info.step ? ' aria-current="step"' : '') + '>' +
        '<span class="icon-box icon-box--' + (analyzing && i < info.step ? 'mint' : 'purple') + '" aria-hidden="true">' +
        ui.icon(analyzing && i < info.step ? 'check' : step.icon, 20) +
        '</span>' +
        '<h3 class="process-step-card__title">' + U.esc(step.title) + '</h3>' +
        '<p class="process-step-card__desc">' + U.esc(step.desc) + '</p>' +
        mark +
        '</div>'
      );
    }).join('');
    return '<div class="process-steps-grid">' + cards + '</div>';
  }

  function errorMessage(error) {
    if (!error) return '';
    return String(typeof error === 'string' ? error : error.message || 'No se pudo analizar el material.');
  }

  function formatList(accept) {
    return String(accept || '.pdf,.docx,.txt,.md')
      .split(',')
      .map((ext) => ext.replace('.', '').trim().toUpperCase())
      .filter(Boolean);
  }

  function selectedFileCard(file, disabled) {
    const extract = NexIA.extract;
    const ext = file.name && extract && extract.extensionOf ? extract.extensionOf(file.name).toUpperCase() : '';
    return (
      '<div class="stat-card" role="group" aria-label="Archivo seleccionado">' +
      '<span class="icon-box icon-box--purple" aria-hidden="true">' + ui.icon('file', 20) + '</span>' +
      '<div style="flex:1;min-width:0">' +
      '<p class="stat-card__value" style="font-size:0.98rem;overflow-wrap:anywhere">' + U.esc(file.name || 'Archivo') + '</p>' +
      '<p class="stat-card__label">' + U.esc([ext, U.formatBytes(file.size)].filter(Boolean).join(' · ')) + '</p>' +
      '</div>' +
      '<button type="button" class="icon-btn" data-action="clear-file" aria-label="Quitar el archivo seleccionado"' +
      (disabled ? ' disabled' : '') + '>' + ui.icon('x', 18) + '</button>' +
      '</div>'
    );
  }

  views.explore = function explore(state, draft) {
    const d = draft || {};
    const extract = NexIA.extract || {};
    const sample = NexIA.sample || {};
    const ai = NexIA.ai;
    const analyzing = Boolean(d.analyzing);
    const text = String(d.text || '');
    const hasInput = Boolean(d.file) || text.trim().length > 0;
    const info = progressInfo(d.progress);
    const accept = extract.ACCEPT || '.pdf,.docx,.txt,.md';
    const maxMb = extract.MAX_FILE_SIZE ? Math.round(extract.MAX_FILE_SIZE / 1048576) : 25;
    const words = U.countWords(text);
    const error = errorMessage(d.error);
    const aiOn = Boolean(ai && ai.isReady && ai.isReady());

    const dropzone =
      '<div>' +
      '<div class="upload-dropzone" data-dropzone data-action="pick-file" role="button" tabindex="' + (analyzing ? '-1' : '0') + '"' +
      ' aria-label="Elegir un archivo o arrastrarlo aquí"' + (analyzing ? ' aria-disabled="true"' : '') + '>' +
      '<span class="upload-dropzone__icon" style="color:var(--color-primary)" aria-hidden="true">' + ui.icon('upload', 26) + '</span>' +
      '<h2 class="upload-dropzone__title">Arrastra tu archivo aquí</h2>' +
      '<p class="upload-dropzone__subtitle">o elige uno de tu dispositivo</p>' +
      '<button type="button" class="app-btn app-btn--outline app-btn--sm" data-action="pick-file"' + (analyzing ? ' disabled' : '') + '>Elegir archivo</button>' +
      '<div class="upload-formats">' +
      formatList(accept).map((f) => '<span class="format-pill">' + U.esc(f) + '</span>').join('') +
      '</div>' +
      '<p class="upload-dropzone__note">Hasta ' + maxMb + ' MB · el archivo no sale de tu dispositivo</p>' +
      '<input type="file" id="fileInput" class="visually-hidden" hidden tabindex="-1" accept="' + U.esc(accept) + '" data-role="file-input"' +
      (analyzing ? ' disabled' : '') + '>' +
      '</div>' +
      (d.file ? '<div style="margin-top:14px">' + selectedFileCard(d.file, analyzing) + '</div>' : '') +
      '</div>';

    const paste =
      '<div class="upload-info">' +
      '<h2 class="upload-info__title">¿Prefieres pegar el texto?</h2>' +
      '<p class="upload-info__desc">Copia tus apuntes y pégalos aquí. Si eliges un archivo, se usará el archivo.</p>' +
      '<div class="proposal-box">' +
      '<label for="pasteText" class="proposal-box__helper" style="font-weight:600">Texto de tus apuntes</label>' +
      '<textarea class="proposal-textarea" id="pasteText" name="pasteText" rows="7" data-role="paste-text"' +
      ' placeholder="Pega aquí el contenido de tus apuntes (mínimo unas 60 palabras)…"' +
      (analyzing ? ' disabled' : '') + '>' + U.esc(text) + '</textarea>' +
      '<p class="proposal-box__helper" data-role="paste-count" aria-live="polite">' +
      (words ? U.esc(U.plural(words, 'palabra', 'palabras')) : 'Aún no has pegado texto') +
      '</p>' +
      '</div>' +
      '<button type="button" class="app-btn app-btn--outline" data-action="use-sample"' + (analyzing ? ' disabled' : '') + '>' +
      ui.icon('sparkle', 16) + ' Probar con un material de ejemplo</button>' +
      (sample.title ? '<p class="proposal-box__helper">Ejemplo: «' + U.esc(sample.title) + '».</p>' : '') +
      '</div>';

    const errorBox = error
      ? '<div class="quiz-feedback quiz-feedback--error" role="alert" style="margin-bottom:16px">' +
      '<p class="quiz-feedback__title">No se pudo analizar el material</p>' + U.esc(error) + '</div>'
      : '';

    let progressBox = '';
    if (analyzing) {
      const pctText = info.pct === null ? '' : info.pct + ' %';
      progressBox =
        '<div class="recent-card" style="margin-top:20px" role="status" aria-live="polite">' +
        '<div class="recent-card__head" style="margin-bottom:0">' +
        '<div><h2 class="recent-card__title">Analizando tu material…</h2>' +
        '<p class="recent-card__sub">' + U.esc(info.label || STEPS[info.step].title.replace(/^\d+\.\s*/, '')) + '</p></div>' +
        (pctText ? '<span class="recent-row__percent">' + pctText + '</span>' : '') +
        '</div>' +
        ui.progressBar(info.pct === null ? 8 : info.pct) +
        '</div>';
    }

    const footer =
      '<div class="view-action-footer">' +
      '<p class="view-action-footer__hint">' +
      (hasInput
        ? analyzing
          ? 'Esto puede tardar unos segundos según el tamaño del documento.'
          : 'Todo listo. Pulsa «Analizar material» para crear tu curso.'
        : 'Elige un archivo o pega un texto para activar el análisis.') +
      '</p>' +
      '<div class="view-action-footer__buttons">' +
      '<button type="button" class="app-btn app-btn--primary app-btn--wide" data-action="analyze"' +
      (!hasInput || analyzing ? ' disabled' : '') + (analyzing ? ' aria-busy="true"' : '') + '>' +
      (analyzing ? 'Analizando…' : 'Analizar material') +
      '</button>' +
      '</div>' +
      '</div>';

    const note =
      '<div class="mint-tip-card" style="margin-top:20px">' +
      '<p class="mint-tip-card__title">' + ui.icon('shield', 16) + ' Así se analiza tu material</p>' +
      '<p class="mint-tip-card__text">' +
      'El análisis ocurre en tu navegador con reglas locales: no se sube nada a un servidor y no necesita internet. ' +
      'Los temas y preguntas se generan a partir de tu texto, así que revisa que reflejen lo que quieres estudiar. ' +
      (aiOn
        ? 'Tienes la IA opcional activada: se usa únicamente en el chat del tutor, nunca para analizar el documento.'
        : 'La IA es opcional y solo sirve para el chat del tutor (se activa en tu perfil); sin ella, el tutor responde con tu propio material.') +
      '</p>' +
      '</div>';

    return (
      '<div class="view-header">' +
      '<p class="view-eyebrow">Nuevo material</p>' +
      '<h1 class="view-title">Sube tu material</h1>' +
      '<p class="view-subtitle">Convierte tus apuntes en lecciones, práctica y repasos programados.</p>' +
      '</div>' +
      errorBox +
      '<section class="upload-card" aria-label="Elegir material">' + dropzone + paste + '</section>' +
      progressBox +
      '<h2 class="subsection-title">' + (analyzing ? 'Progreso del análisis' : 'Qué pasa cuando lo analizas') + '</h2>' +
      stepsGrid(analyzing, info) +
      note +
      footer
    );
  };

  /* ------------------------------------------------------------------ */
  /* Documento listo                                                     */
  /* ------------------------------------------------------------------ */

  views.document = function documentReady(state, materialId) {
    const A = apiOf(state);
    const material = A.getMaterial ? A.getMaterial(materialId) : null;
    if (!material) {
      return ui.emptyState({
        icon: 'file',
        title: 'No encontramos este documento',
        text: 'Puede que se haya eliminado. Vuelve a tus temas o sube un material nuevo.',
        action: { href: routes.library, label: 'Ir a mis temas' }
      });
    }

    const topics = material.topics || [];
    const conceptTotal = topics.reduce((n, t) => n + (t.concepts || []).length, 0);
    const minutes = topics.reduce((n, t) => n + (t.minutes || 0), 0) || material.minutes || 0;
    const progress = A.materialProgress(material);
    const point = resumePoint(material);
    const startHref = point && progress.done > 0 && !point.finished ? routes.lesson(material.id, point.ti, point.ci) : routes.lesson(material.id, 0);

    const metaParts = [];
    if (material.pages) metaParts.push(U.plural(material.pages, 'página', 'páginas'));
    if (material.fileSize) metaParts.push(U.formatBytes(material.fileSize));
    if (material.fileType) metaParts.push(String(material.fileType).toUpperCase());
    metaParts.push(U.plural(topics.length, 'tema', 'temas'));

    const banner =
      '<section class="doc-banner" aria-label="Documento analizado">' +
      '<span class="doc-banner__icon" style="color:var(--color-primary)" aria-hidden="true">' + ui.icon('file', 28) + '</span>' +
      '<div class="doc-banner__body">' +
      '<h2 class="doc-banner__title" style="overflow-wrap:anywhere">' + U.esc(material.fileName || material.title) + '</h2>' +
      '<p class="doc-banner__meta">' + U.esc(metaParts.join(' · ')) + '</p>' +
      '</div>' +
      '<div class="doc-banner__status">' +
      ui.chip('Análisis completado', 'mint') +
      '<span class="doc-banner__topics">' + U.esc(U.plural(topics.length, 'tema detectado', 'temas detectados')) + '</span>' +
      '</div>' +
      '</section>';

    const rows = topics
      .map((topic, ti) => {
        const concepts = topic.concepts || [];
        const done = concepts.filter((c) => isDone(material, c)).length;
        const sub = [topic.subtitle, done ? done + ' de ' + concepts.length + ' completados' : '']
          .filter(Boolean)
          .join(' · ');
        return (
          '<a class="topic-row" href="' + U.esc(routes.lesson(material.id, ti)) + '">' +
          '<span class="icon-box icon-box--' + (done === concepts.length && concepts.length ? 'mint' : 'purple') + '" aria-hidden="true">' +
          (done === concepts.length && concepts.length ? ui.icon('check', 18) : ti + 1) +
          '</span>' +
          '<span class="topic-row__body">' +
          '<span class="topic-row__title">' + U.esc(topic.title) + '</span>' +
          '<span class="topic-row__sub">' + U.esc(sub || U.plural(concepts.length, 'concepto', 'conceptos')) + '</span>' +
          '</span>' +
          '<span class="topic-row__time">' + U.esc((topic.minutes || 1) + ' min') + '</span>' +
          '<span class="topic-row__arrow" aria-hidden="true">›</span>' +
          '</a>'
        );
      })
      .join('');

    const side =
      '<aside class="side-info-card" aria-label="Resumen de tu ruta">' +
      '<h2 class="side-info-card__title side-info-card__title--lg">Tu ruta de aprendizaje</h2>' +
      '<p class="side-info-card__desc">Esto es lo que NexIA encontró en tu documento. Puedes estudiarlo en orden o elegir el tema que prefieras.</p>' +
      '<ul class="check-list check-list--divided">' +
      [
        U.plural(conceptTotal, 'concepto para estudiar', 'conceptos para estudiar'),
        U.plural(countQuestions(material), 'pregunta de práctica', 'preguntas de práctica'),
        U.plural(countCards(material), 'tarjeta de repaso', 'tarjetas de repaso')
      ]
        .map((item) => '<li><span class="check-circle" aria-hidden="true">✓</span><span>' + U.esc(item) + '</span></li>')
        .join('') +
      '</ul>' +
      '<div class="route-summary">' +
      '<span class="route-summary__topics">' + U.esc(U.plural(topics.length, 'tema', 'temas')) + '</span>' +
      '<span class="route-summary__time">≈ ' + U.esc(minutes + ' min') + '</span>' +
      '</div>' +
      '<p class="side-info-card__desc">Generado de forma automática a partir de tu texto: revisa que los temas reflejen tu material.</p>' +
      '</aside>';

    const cta =
      progress.done > 0 && !(point && point.finished) ? 'Continuar aprendiendo' : 'Empezar a aprender';

    return (
      '<div class="view-header">' +
      '<p class="view-eyebrow">Documento listo</p>' +
      '<h1 class="view-title">' + U.esc(material.title) + '</h1>' +
      '<p class="view-subtitle">Tu material ya está dividido en temas. Elige por dónde empezar.</p>' +
      '</div>' +
      banner +
      '<h2 class="subsection-title">Temas encontrados</h2>' +
      '<div class="doc-topics-layout">' +
      '<div class="topic-list">' + (rows || '<p class="material-empty">No se detectaron temas.</p>') + '</div>' +
      side +
      '</div>' +
      '<div class="view-action-footer">' +
      '<p class="view-action-footer__hint">' +
      (progress.done > 0
        ? 'Llevas ' + progress.pct + ' % de este material.'
        : 'Empieza por el primer tema; puedes volver cuando quieras.') +
      '</p>' +
      '<div class="view-action-footer__buttons">' +
      '<a class="app-btn app-btn--outline" href="' + routes.library + '">Ver mis temas</a>' +
      '<a class="app-btn app-btn--primary app-btn--wide" href="' + U.esc(startHref) + '">' + cta + ' ' + ui.icon('arrow-right', 16) + '</a>' +
      '</div>' +
      '</div>'
    );
  };
})(typeof window !== 'undefined' ? window : globalThis);
