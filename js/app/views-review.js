/*
 * NexIA · Vistas de repaso: inicio de repaso, calendario y sesión guiada.
 *
 * Cada vista devuelve una cadena HTML (todo el texto dinámico va escapado con
 * U.esc). Las acciones que ya conoce el controlador (app.js) son:
 *   start-review · cal-prev · cal-next · review-select (data-index) · review-check
 *   review-next-q · card-flip · card-know · card-again · open-submit (#openAnswer)
 * Las rutas son #/repaso, #/calendario y #/sesion[/materialId/conceptId].
 *
 * Este módulo añade por su cuenta (escucha delegada en document, una sola vez)
 * lo que el controlador no cubre:
 *   schedule-review   abre un diálogo para programar un repaso (concepto + fecha)
 *   schedule-confirm  confirma ese diálogo
 *   cal-day           muestra los repasos de un día del calendario
 *   review-skip-step  salta un paso de la sesión que no tiene contenido
 *   [data-review-reset]  reinicia la sesión antes de abrir #/sesion/mid/cid
 * y, tras cambiar datos, vuelve a pintar lanzando un evento "hashchange".
 *
 * Forma de la sesión (NexIA.appSession.review):
 *   { active, empty, step:'quiz'|'cards'|'open'|'done', materialId, conceptIds,
 *     questions, qIndex, qSelected, qChecked, cards, cardIndex, flipped,
 *     open:{prompt,terms,reference}, openResult:{score 0-100, matched, ...},
 *     score, total, answers:[{conceptId, correct, skill}] }
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

  function endOfDay(date) {
    const d = new Date(date || Date.now());
    d.setHours(23, 59, 59, 999);
    return d;
  }

  function pendingReviews(r) {
    return (r.reviews || []).filter((rev) => rev.status !== 'done').sort((a, b) => a.dueAt - b.dueAt);
  }

  function reviewKey(item) {
    return item.materialId + ':' + item.conceptId;
  }

  function userPrefs(r) {
    const defaults = NexIA.auth && NexIA.auth.defaultPrefs ? NexIA.auth.defaultPrefs() : {};
    return Object.assign(defaults, (r.user && r.user.prefs) || {});
  }

  function materialOf(r, id) {
    return (r.materials || []).find((m) => m.id === id) || null;
  }

  function materialTitle(r, id) {
    const m = materialOf(r, id);
    return m ? m.title : 'Material';
  }

  function conceptTitleMap(material) {
    const map = {};
    if (material && material.topics) material.topics.forEach((t) => t.concepts.forEach((c) => (map[c.id] = c.title)));
    return map;
  }

  /** Enlace a una sesión centrada en un concepto. */
  function sessionHref(item) {
    return '#/sesion/' + esc(item.materialId) + '/' + esc(item.conceptId);
  }

  function dueChip(rev) {
    const days = U.daysBetween(U.dateKey(rev.dueAt), U.dateKey());
    if (days > 0) return ui.chip('Atrasado ' + U.plural(days, 'día', 'días'), 'amber');
    if (days === 0) return ui.chip('Hoy', 'mint');
    return ui.chip(U.formatShortDate(rev.dueAt), 'purple');
  }

  function agendaItem(rev) {
    return (
      '<p class="upcoming-agenda-item">' + ui.icon('calendar', 16) +
      '<span>' + esc(U.formatShortDate(rev.dueAt)) + ' · ' + esc(rev.conceptTitle || 'Concepto') + '</span></p>'
    );
  }

  /* ----------------------------- inicio de repaso ----------------------------- */

  function weakCard(item) {
    const text = 'Fallaste ' + item.wrong + ' de ' + U.plural(item.total, 'respuesta', 'respuestas') + ' sobre este concepto.';
    return (
      '<article class="repaso-concept-card">' +
      '<div class="repaso-concept-card__head">' +
      '<div class="repaso-concept-card__title-wrap">' +
      '<span class="icon-box icon-box--amber">' + ui.icon('target', 18) + '</span>' +
      '<div><h3 class="repaso-concept-card__title">' + esc(item.conceptTitle || 'Concepto') + '</h3>' +
      '<p class="repaso-concept-card__course">' + esc(item.materialTitle) + (item.topicTitle ? ' · ' + esc(item.topicTitle) : '') + '</p></div>' +
      '</div>' +
      ui.chip(item.rate + ' % de acierto', item.rate >= 60 ? 'purple' : 'amber') +
      '</div>' +
      '<p class="repaso-concept-card__desc">' + esc(text) + '</p>' +
      ui.progressBar(item.rate, 'mint') +
      '<div><a class="app-btn app-btn--outline app-btn--sm" href="' + sessionHref(item) + '" data-review-reset>' +
      ui.icon('refresh', 16) + '<span>Repasar este concepto</span></a></div>' +
      '</article>'
    );
  }

  function dueCard(rev, r) {
    return (
      '<article class="repaso-concept-card">' +
      '<div class="repaso-concept-card__head">' +
      '<div class="repaso-concept-card__title-wrap">' +
      '<span class="icon-box icon-box--purple">' + ui.icon('clock', 18) + '</span>' +
      '<div><h3 class="repaso-concept-card__title">' + esc(rev.conceptTitle || 'Concepto') + '</h3>' +
      '<p class="repaso-concept-card__course">' + esc(materialTitle(r, rev.materialId)) + (rev.topicTitle ? ' · ' + esc(rev.topicTitle) : '') + '</p></div>' +
      '</div>' +
      dueChip(rev) +
      '</div>' +
      '<p class="repaso-concept-card__desc">Es buen momento para repasarlo y afianzarlo en tu memoria (etapa ' + ((rev.stage || 0) + 1) + ' de 5).</p>' +
      '<div><a class="app-btn app-btn--primary app-btn--sm" href="' + sessionHref(rev) + '" data-review-reset>' +
      ui.icon('play', 14) + '<span>Repasar ahora</span></a></div>' +
      '</article>'
    );
  }

  function reviewHome(state) {
    const r = raw(state);
    const weakAll = typeof state.weakConcepts === 'function' ? state.weakConcepts(6) : [];
    const due = typeof state.dueReviews === 'function' ? state.dueReviews() : pendingReviews(r).filter((x) => x.dueAt <= endOfDay().getTime());
    const dueKeys = new Set(due.map(reviewKey));
    const weak = weakAll.filter((w) => !dueKeys.has(reviewKey(w)));
    const todayEnd = endOfDay().getTime();
    const upcoming = pendingReviews(r).filter((rev) => rev.dueAt > todayEnd);
    const toPractice = due.length + weak.length;

    let title;
    if (due.length) title = 'Tienes ' + U.plural(due.length, 'repaso pendiente', 'repasos pendientes') + ' para hoy';
    else if (weak.length) title = 'Refuerza ' + U.plural(weak.length, 'concepto débil', 'conceptos débiles');
    else title = 'Estás al día con tus repasos';

    let meta;
    if (toPractice) meta = 'Una sesión corta combina preguntas, tarjetas y una respuesta abierta.';
    else if (upcoming.length) meta = 'Tu próximo repaso es el ' + U.formatLongDate(upcoming[0].dueAt) + '.';
    else meta = 'Practica un tema con preguntas: lo que falles aparecerá aquí para repasarlo.';

    const hero =
      '<section class="repaso-hero" aria-labelledby="repasoHeroTitle">' +
      '<div class="repaso-hero__body">' +
      '<span class="repaso-hero__eyebrow">' + ui.icon('sparkle', 14) + 'REPASO ESPACIADO</span>' +
      '<h2 class="repaso-hero__title" id="repasoHeroTitle">' + esc(title) + '</h2>' +
      '<p class="repaso-hero__meta">' + esc(meta) + '</p>' +
      '</div>' +
      '<div class="repaso-hero__right">' +
      (toPractice
        ? '<button type="button" class="app-btn app-btn--white" data-action="start-review">' + ui.icon('play', 14) + '<span>Empezar repaso</span></button>'
        : '<a class="app-btn app-btn--white" href="#/temas">Estudiar un tema</a>') +
      '<a class="app-btn app-btn--white" href="#/calendario">' + ui.icon('calendar', 16) + '<span>Ver calendario</span></a>' +
      '</div>' +
      '</section>';

    let body = '';
    if (due.length) {
      body +=
        '<h2 class="subsection-title">Para repasar hoy</h2>' +
        '<div class="repaso-cards-grid">' + due.map((rev) => dueCard(rev, r)).join('') + '</div>';
    }
    if (weak.length) {
      body +=
        '<h2 class="subsection-title" style="margin-top:28px">Conceptos que conviene reforzar</h2>' +
        '<p class="subsection-sub">Los detectamos por tus respuestas falladas en las preguntas de práctica.</p>' +
        '<div class="repaso-cards-grid" style="margin-top:14px">' + weak.map(weakCard).join('') + '</div>';
    }
    if (!toPractice) {
      body += ui.emptyState({
        icon: 'check-circle',
        title: 'No hay nada pendiente',
        text: 'Cuando falles una pregunta, el concepto se programará solo para repasarlo (a 1, 3, 7, 14 y 30 días). Practica un tema para empezar.',
        action: { href: '#/temas', label: 'Ir a mis temas' }
      });
    }
    if (upcoming.length) {
      body +=
        '<section class="scheduled-card" style="margin-top:28px" aria-labelledby="proxRepasosTitle">' +
        '<h2 class="scheduled-card__title" id="proxRepasosTitle">Próximos repasos</h2>' +
        '<div style="width:100%">' + upcoming.slice(0, 5).map(agendaItem).join('') + '</div>' +
        '<a class="app-btn app-btn--outline app-btn--sm" href="#/calendario">Abrir calendario completo</a>' +
        '</section>';
    }

    const tip =
      '<aside class="memory-tip-banner">' +
      '<span class="icon-box icon-box--mint">' + ui.icon('bulb', 18) + '</span>' +
      '<div><h2 class="memory-tip-banner__title">Repasar justo antes de olvidar funciona mejor</h2>' +
      '<p class="memory-tip-banner__text">Por eso espaciamos tus repasos: si aciertas, el siguiente se aleja; si fallas, vuelve mañana. Sesiones cortas y frecuentes valen más que una larga.</p></div>' +
      '</aside>';

    return (
      '<header class="view-header"><h1 class="view-title">Repaso</h1>' +
      '<p class="view-subtitle">Refuerza lo que más te cuesta con preguntas, tarjetas y una respuesta propia.</p></header>' +
      hero +
      '<div style="margin-top:24px">' + body + '</div>' +
      tip
    );
  }

  /* -------------------------------- calendario -------------------------------- */

  function dayPanelHtml(r, key) {
    const date = U.parseDateKey(key);
    const list = pendingReviews(r).filter((rev) => U.dateKey(rev.dueAt) === key);
    const heading = '<p class="saved-preview__note" style="margin-bottom:6px"><strong>' + esc(U.WEEKDAYS[date.getDay()] + ' ' + U.formatLongDate(date)) + '</strong></p>';
    if (!list.length) return heading + '<p class="saved-preview__quote">No hay repasos programados este día.</p>';
    return (
      heading +
      list
        .map(
          (rev) =>
            '<p class="saved-preview__quote">' + esc(rev.conceptTitle || 'Concepto') +
            ' <span class="saved-preview__note">· ' + esc(materialTitle(r, rev.materialId)) + '</span></p>'
        )
        .join('')
    );
  }

  function calendar(state, year, month) {
    const r = raw(state);
    const now = new Date();
    const hasYear = typeof year === 'number' && isFinite(year);
    const hasMonth = typeof month === 'number' && isFinite(month);
    const first = new Date(hasYear ? year : now.getFullYear(), hasMonth ? month : now.getMonth(), 1); // normaliza desbordes
    const y = first.getFullYear();
    const m = first.getMonth();
    const todayKey = U.dateKey();
    const prefs = userPrefs(r);

    const pending = pendingReviews(r);
    const byDay = new Map();
    pending.forEach((rev) => {
      const key = U.dateKey(rev.dueAt);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(rev);
    });

    const offset = (first.getDay() + 6) % 7; // lunes = 0
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;

    const weekdays = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
      .map((d, i) => '<span title="' + esc(U.WEEKDAYS[(i + 1) % 7]) + '">' + d + '</span>')
      .join('');

    let monthCount = 0;
    let cells = '';
    for (let i = 0; i < totalCells; i++) {
      const date = new Date(y, m, 1 - offset + i);
      const key = U.dateKey(date);
      const inMonth = date.getMonth() === m;
      const list = byDay.get(key) || [];
      const dow = (date.getDay() + 6) % 7;
      const classes = ['cal-cell'];
      if (dow >= 5) classes.push('cal-cell--weekend');
      if (!inMonth) classes.push('cal-cell--muted');
      if (key === todayKey) classes.push('cal-cell--today');
      if (list.length) classes.push(inMonth ? 'cal-cell--scheduled' : 'cal-cell--tag');
      if (inMonth) monthCount += list.length;
      const label =
        date.getDate() + ' de ' + U.MONTHS[date.getMonth()] +
        (key === todayKey ? ', hoy' : '') +
        (list.length ? ', ' + U.plural(list.length, 'repaso programado', 'repasos programados') : '');
      cells +=
        '<div class="' + classes.join(' ') + '" data-action="cal-day" data-date="' + key + '" aria-label="' + esc(label) + '"' +
        (list.length ? ' role="button" tabindex="0"' : '') + '>' +
        '<span>' + date.getDate() + '</span>' +
        (list.length ? '<small aria-hidden="true">' + list.length + ' rep.</small>' : '') +
        '</div>';
    }

    const prev = new Date(y, m - 1, 1);
    const next = new Date(y, m + 1, 1);

    const calendarCard =
      '<section class="calendar-card" aria-labelledby="calMonthTitle">' +
      '<div class="calendar-card__header">' +
      '<h2 class="calendar-month-title" id="calMonthTitle" aria-live="polite">' + esc(U.monthTitle(first)) + '</h2>' +
      '<div class="calendar-nav-btns">' +
      '<button type="button" class="calendar-nav-btn" data-action="cal-prev" data-year="' + prev.getFullYear() + '" data-month="' + prev.getMonth() + '" aria-label="Mes anterior">‹</button>' +
      '<button type="button" class="calendar-nav-btn" data-action="cal-next" data-year="' + next.getFullYear() + '" data-month="' + next.getMonth() + '" aria-label="Mes siguiente">›</button>' +
      '</div></div>' +
      '<div class="calendar-weekdays" aria-hidden="true">' + weekdays + '</div>' +
      '<div class="calendar-grid">' + cells + '</div>' +
      '<div class="calendar-legend">' +
      '<span class="calendar-legend__item"><span class="legend-dot legend-dot--today"></span>Hoy</span>' +
      '<span class="calendar-legend__item"><span class="legend-dot" style="background-color:var(--color-primary)"></span>Repaso programado</span>' +
      '</div>' +
      '<div class="saved-preview" id="calDayPanel" style="margin-top:16px;flex-direction:column;align-items:flex-start" aria-live="polite">' +
      '<p class="saved-preview__note">Toca un día para ver sus repasos.</p></div>' +
      '</section>';

    const nextRev = pending[0];
    const dueNow = pending.filter((rev) => rev.dueAt <= endOfDay().getTime());
    let nextBlock;
    if (nextRev) {
      const d = new Date(nextRev.dueAt);
      nextBlock =
        '<p class="scheduled-card__label">' + (nextRev.dueAt <= endOfDay().getTime() ? 'Pendiente ahora' : 'Próximo repaso') + '</p>' +
        '<div class="next-session-badge">' +
        '<div class="next-session-date"><span class="next-session-date__day">' + d.getDate() + '</span><span class="next-session-date__month">' + esc(U.MONTHS_SHORT[d.getMonth()]) + '</span></div>' +
        '<div><p class="next-session-date__weekday">' + esc(U.WEEKDAYS[d.getDay()]) + '</p>' +
        '<p class="next-session-date__time">' + esc(prefs.scheduleFrom || '19:00') + ' · tu hora de estudio</p></div>' +
        '</div>' +
        '<h3 class="scheduled-topic-title">' + esc(nextRev.conceptTitle || 'Concepto') + '</h3>' +
        '<p class="scheduled-topic-desc">' + esc(materialTitle(r, nextRev.materialId)) + (nextRev.topicTitle ? ' · ' + esc(nextRev.topicTitle) : '') + '</p>' +
        '<hr class="scheduled-divider">' +
        '<div style="width:100%">' +
        (pending.length > 1 ? pending.slice(1, 5).map(agendaItem).join('') : '<p class="scheduled-topic-desc">No hay más repasos en la agenda.</p>') +
        '</div>';
    } else {
      nextBlock =
        '<p class="scheduled-card__label">Agenda</p>' +
        '<h3 class="scheduled-topic-title">Sin repasos programados</h3>' +
        '<p class="scheduled-topic-desc">Se programan solos cuando fallas una pregunta, o puedes agendar uno tú.</p>';
    }

    const side =
      '<aside class="scheduled-card" aria-labelledby="calSideTitle">' +
      '<h2 class="scheduled-card__title" id="calSideTitle">Tu agenda de repaso</h2>' +
      nextBlock +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;width:100%">' +
      (dueNow.length
        ? '<button type="button" class="app-btn app-btn--primary app-btn--sm" data-action="start-review">' + ui.icon('play', 14) + '<span>Repasar ahora</span></button>'
        : '') +
      '<button type="button" class="app-btn app-btn--outline app-btn--sm" data-action="schedule-review" data-date="' + esc(todayKey) + '">' +
      ui.icon('plus', 16) + '<span>Programar repaso</span></button>' +
      '</div>' +
      '</aside>';

    return (
      '<header class="view-header"><h1 class="view-title">Calendario de repaso</h1>' +
      '<p class="view-subtitle">' +
      (monthCount ? esc(U.plural(monthCount, 'repaso programado', 'repasos programados') + ' en ' + U.MONTHS[m] + '.') : 'No hay repasos programados en ' + esc(U.MONTHS[m]) + '.') +
      '</p></header>' +
      '<div class="calendar-layout">' + calendarCard + side + '</div>' +
      '<p class="view-footnote"><a href="#/repaso" class="status-chip status-chip--purple">‹ Volver a repaso</a></p>'
    );
  }

  /* --------------------------------- sesión --------------------------------- */

  const STEPS = [
    { id: 'quiz', label: 'Preguntas' },
    { id: 'cards', label: 'Tarjetas' },
    { id: 'open', label: 'Respuesta abierta' },
    { id: 'done', label: 'Resumen' }
  ];

  function stepper(step) {
    const current = Math.max(0, STEPS.findIndex((s) => s.id === step));
    return (
      '<div class="quiz-progress__top" style="flex-wrap:wrap;gap:10px">' +
      '<span class="quiz-progress__pill">Paso ' + (current + 1) + ' de ' + STEPS.length + ' · ' + esc(STEPS[current].label) + '</span>' +
      (step === 'done' ? '' : '<a class="app-btn app-btn--outline app-btn--sm" href="#/repaso">' + ui.icon('x', 14) + '<span>Salir</span></a>') +
      '</div>' +
      '<ol class="sim-chips" style="list-style:none;padding:0" aria-label="Pasos del repaso">' +
      STEPS.map((s, i) => {
        const type = i < current ? 'mint' : i === current ? 'purple' : 'white';
        return '<li' + (i === current ? ' aria-current="step"' : '') + '>' + ui.chip((i < current ? '✓ ' : i + 1 + '. ') + s.label, type) + '</li>';
      }).join('') +
      '</ol>'
    );
  }

  function skipStepCard(title, text, label) {
    return (
      '<section class="quiz-card">' +
      '<h2 class="quiz-card__question">' + esc(title) + '</h2>' +
      '<p class="quiz-card__hint">' + esc(text) + '</p>' +
      '<div class="quiz-card__actions"><button type="button" class="app-btn app-btn--primary" data-action="review-skip-step">' + esc(label) + '</button></div>' +
      '</section>'
    );
  }

  function quizStep(session, titles) {
    const questions = session.questions || [];
    if (!questions.length) {
      return skipStepCard('No hay preguntas para estos conceptos', 'Pasemos a las tarjetas de estudio.', 'Continuar con las tarjetas');
    }
    const index = U.clamp(session.qIndex || 0, 0, questions.length - 1);
    const q = questions[index];
    const picked = typeof session.qSelected === 'number' ? session.qSelected : null;
    const checked = Boolean(session.qChecked);
    const correct = checked && picked === q.answer;
    const isLast = index === questions.length - 1;

    const bars =
      '<div class="quiz-progress__bars" style="grid-template-columns:repeat(' + questions.length + ',1fr)" aria-hidden="true">' +
      questions.map((_, i) => '<span' + (i <= index ? ' class="is-filled"' : '') + '></span>').join('') +
      '</div>';

    const options = (q.options || [])
      .map((opt, i) => {
        const cls = ['quiz-option'];
        let mark = '';
        if (checked) {
          if (i === q.answer) {
            cls.push('is-correct');
            mark = '✓';
          } else if (i === picked) {
            cls.push('is-wrong');
            mark = '✕';
          }
        } else if (i === picked) cls.push('is-selected');
        return (
          '<button type="button" class="' + cls.join(' ') + '" role="radio" aria-checked="' + (i === picked) + '"' +
          (checked ? ' aria-disabled="true"' : '') +
          ' data-action="review-select" data-index="' + i + '">' +
          '<span class="quiz-option__letter">' + String.fromCharCode(65 + i) + '</span>' +
          '<span class="quiz-option__text">' + esc(opt) + '</span>' +
          '<span class="quiz-option__mark" aria-hidden="true">' + mark + '</span>' +
          '</button>'
        );
      })
      .join('');

    let feedback = '';
    if (checked) {
      const answerText = (q.options || [])[q.answer];
      feedback =
        '<div class="quiz-feedback quiz-feedback--' + (correct ? 'success' : 'error') + '" role="status">' +
        '<p class="quiz-feedback__title">' + (correct ? '✓ ¡Correcto!' : 'Respuesta incorrecta') + '</p>' +
        (correct ? '' : '<p>La respuesta correcta es <strong>' + esc(String.fromCharCode(65 + q.answer) + '. ' + (answerText || '')) + '</strong>.</p>') +
        (q.explanation ? '<p>' + esc(q.explanation) + '</p>' : '') +
        '</div>';
    }

    const conceptName = titles[q.conceptId];
    return (
      '<div class="quiz-layout"><section class="quiz-card" aria-labelledby="reviewQuestion">' +
      bars +
      '<p class="quiz-card__hint">Pregunta ' + (index + 1) + ' de ' + questions.length + (conceptName ? ' · ' + esc(conceptName) : '') + '</p>' +
      '<h2 class="quiz-card__question" id="reviewQuestion">' + esc(q.stem) + '</h2>' +
      (q.quote ? '<div class="saved-preview"><p class="saved-preview__quote">' + esc(q.quote) + '</p></div>' : '') +
      '<div class="quiz-options" role="radiogroup" aria-labelledby="reviewQuestion">' + options + '</div>' +
      feedback +
      '<div class="quiz-card__actions">' +
      (checked
        ? '<button type="button" class="app-btn app-btn--primary" data-action="review-next-q">' + esc(isLast ? 'Continuar con las tarjetas' : 'Siguiente pregunta') + '</button>'
        : '<button type="button" class="app-btn app-btn--primary" data-action="review-check"' + (picked === null ? ' disabled' : '') + '>Comprobar</button>') +
      '</div></section></div>'
    );
  }

  function cardsStep(session) {
    const cards = session.cards || [];
    if (!cards.length) {
      return skipStepCard('No hay tarjetas para estos conceptos', 'Sigamos con la respuesta abierta.', 'Continuar');
    }
    const index = U.clamp(session.cardIndex || 0, 0, cards.length - 1);
    const card = cards[index];
    const flipped = Boolean(session.flipped);

    return (
      '<div class="flashcard-column">' +
      '<div class="flashcard' + (flipped ? ' is-flipped' : '') + '" role="button" tabindex="0" data-action="card-flip" aria-label="Tarjeta ' + (index + 1) + ' de ' + cards.length + ': ' + (flipped ? 'respuesta' : 'pregunta') + '. Actívala para voltearla.">' +
      '<p class="flashcard__text">' + esc(flipped ? card.back : card.front) + '</p>' +
      '<p class="flashcard__hint">' + esc(flipped ? 'Respuesta según tu material.' : card.hint || 'Intenta recordar la respuesta antes de voltearla.') + '</p>' +
      '<p class="flashcard__caption">' + (flipped ? 'Haz clic para volver a la pregunta' : 'Haz clic para ver la respuesta') + '</p>' +
      '</div>' +
      '<div class="flashcard-nav">' +
      '<span class="flashcard-counter" aria-live="polite">Tarjeta ' + (index + 1) + ' de ' + cards.length + '</span>' +
      (flipped
        ? '<span style="display:flex;gap:10px;flex-wrap:wrap">' +
          '<button type="button" class="app-btn app-btn--outline app-btn--sm" data-action="card-again">Repasar de nuevo</button>' +
          '<button type="button" class="app-btn app-btn--primary app-btn--sm" data-action="card-know">Ya lo sabía</button></span>'
        : '<button type="button" class="app-btn app-btn--primary app-btn--sm" data-action="card-flip">Ver respuesta</button>') +
      '</div></div>'
    );
  }

  function pctOf(res) {
    const s = Number(res && res.score);
    return isFinite(s) ? Math.round(U.clamp(s, 0, 100)) : 0;
  }

  function termChips(list, type) {
    return (list || []).map((t) => ui.chip(t, type)).join(' ');
  }

  function openStep(session) {
    const open = session.open || {};
    const prompt = open.prompt || 'Explica con tus palabras lo que acabas de repasar.';
    const terms = open.terms || [];
    return (
      '<div class="quiz-layout"><section class="quiz-card" aria-labelledby="reviewOpenPrompt">' +
      '<p class="view-eyebrow">Respuesta abierta</p>' +
      '<h2 class="quiz-card__question" id="reviewOpenPrompt">' + esc(prompt) + '</h2>' +
      (terms.length ? '<p class="quiz-card__hint">Intenta incluir: ' + termChips(terms, 'purple') + '</p>' : '') +
      '<div class="proposal-box">' +
      '<label class="form-label" for="openAnswer">Tu respuesta</label>' +
      '<textarea class="proposal-textarea" id="openAnswer" rows="6" maxlength="1500" placeholder="Escribe con tus propias palabras…"></textarea>' +
      '<p class="proposal-box__helper">Escribir con tus palabras (sin copiar) ayuda a fijar lo aprendido. Se evalúa en tu dispositivo; se recomiendan unas 25 palabras o más.</p>' +
      '</div>' +
      '<div class="proposal-footer"><span class="quiz-card__hint">Al enviar verás tu resumen del repaso.</span>' +
      '<button type="button" class="app-btn app-btn--primary" data-action="open-submit">Evaluar mi respuesta</button></div>' +
      '</section></div>'
    );
  }

  function doneStep(session, titles) {
    const total = session.total || 0;
    const score = session.score || 0;
    const pct = U.percent(score, total);
    const answers = session.answers || [];
    const quizCorrect = answers.filter((a) => a.correct).length;
    const res = session.openResult || null;
    const open = session.open || {};
    const wrong = new Set(answers.filter((a) => !a.correct).map((a) => a.conceptId));
    const ids = session.conceptIds || [];

    let heading;
    let text;
    if (pct >= 80) {
      heading = '¡Excelente repaso!';
      text = 'Dominas estos conceptos. Los espaciaremos para que sigan frescos.';
    } else if (pct >= 50) {
      heading = 'Vas por buen camino';
      text = 'Aún hay conceptos por afianzar; los repasaremos de nuevo pronto.';
    } else {
      heading = 'Sigue practicando';
      text = 'Fallar es parte de aprender: volverás a ver estos conceptos pronto.';
    }

    const openCard = res
      ? '<p class="stat-card__value">' + pctOf(res) + ' %</p><p class="stat-card__label">de ideas clave cubiertas</p>' +
        ((res.matched || []).length ? '<p>' + termChips(res.matched, 'mint') + '</p>' : '') +
        ((res.missing || []).length ? '<p>Te faltó: ' + termChips(res.missing, 'amber') + '</p>' : '') +
        (res.feedback ? '<p class="stat-card__label">' + esc(res.feedback) + '</p>' : '')
      : '<p class="stat-card__value">—</p><p class="stat-card__label">Sin evaluar</p>';

    return (
      '<section class="result-hero" aria-labelledby="reviewDoneTitle">' +
      '<div class="result-hero__body">' +
      ui.chip('Repaso terminado', 'mint') +
      '<h2 class="result-hero__title" id="reviewDoneTitle">' + esc(heading) + '</h2>' +
      '<p class="result-hero__text">' + esc(text) + ' Obtuviste ' + score + ' de ' + total + ' puntos.</p>' +
      '</div>' +
      ui.donut(pct) +
      '</section>' +
      '<div class="result-cards">' +
      '<article class="result-card"><div class="result-card__head"><span class="icon-box icon-box--purple">' + ui.icon('check-circle', 18) + '</span>' +
      '<h3 class="result-card__title">Preguntas</h3></div>' +
      '<p class="stat-card__value">' + quizCorrect + ' / ' + (session.questions || []).length + '</p>' +
      '<p class="stat-card__label">respuestas correctas</p></article>' +
      '<article class="result-card"><div class="result-card__head"><span class="icon-box icon-box--mint">' + ui.icon('layers', 18) + '</span>' +
      '<h3 class="result-card__title">Tarjetas</h3></div>' +
      '<p class="stat-card__value">' + (session.cards || []).length + '</p>' +
      '<p class="stat-card__label">tarjetas repasadas</p></article>' +
      '<article class="result-card"><div class="result-card__head"><span class="icon-box icon-box--amber">' + ui.icon('edit', 18) + '</span>' +
      '<h3 class="result-card__title">Respuesta abierta</h3></div>' + openCard +
      (res && open.reference && open.reference.length
        ? '<div class="saved-preview" style="flex-direction:column;align-items:flex-start;gap:6px"><p class="saved-preview__note">Así lo explica tu material:</p>' +
          open.reference.map((ref) => '<p class="saved-preview__quote">' + esc(ref) + '</p>').join('') + '</div>'
        : '') +
      '</article>' +
      '<article class="result-card"><div class="result-card__head"><span class="icon-box icon-box--purple">' + ui.icon('brain', 18) + '</span>' +
      '<h3 class="result-card__title">Conceptos repasados</h3></div>' +
      (ids.length
        ? ids
            .map(
              (id) =>
                '<p class="reinforce-row"><span>' + esc(titles[id] || 'Concepto') + '</span>' +
                (answers.some((a) => a.conceptId === id) ? (wrong.has(id) ? ui.chip('Reforzar', 'amber') : ui.chip('Bien', 'mint')) : '') +
                '</p>'
            )
            .join('')
        : '<p class="stat-card__label">Sin conceptos asociados.</p>') +
      '</article>' +
      '</div>' +
      '<div class="view-action-footer">' +
      '<p class="view-action-footer__hint">Los conceptos que repasaste quedan programados en tu calendario.</p>' +
      '<div class="view-action-footer__buttons">' +
      '<a class="app-btn app-btn--outline" href="#/calendario">Ver calendario</a>' +
      '<button type="button" class="app-btn app-btn--outline" data-action="start-review">Repetir sesión</button>' +
      '<a class="app-btn app-btn--primary" href="#/repaso">Volver a repaso</a>' +
      '</div></div>'
    );
  }

  function reviewSession(state, session) {
    if (!session || session.empty) {
      return (
        '<header class="view-header"><h1 class="view-title">Sesión de repaso</h1></header>' +
        ui.emptyState({
          icon: 'book',
          title: 'Aún no hay nada que repasar',
          text: 'Sube un material y resuelve una autoevaluación: así sabremos qué conceptos reforzar.',
          action: { href: '#/explorar', label: 'Subir un material' }
        })
      );
    }
    const r = raw(state);
    const material = materialOf(r, session.materialId);
    const titles = conceptTitleMap(material);
    const ids = session.conceptIds || [];
    const sub = (material ? material.title + ' · ' : '') + (ids.length ? U.plural(ids.length, 'concepto', 'conceptos') : 'Repaso general');

    let body;
    if (session.step === 'cards') body = cardsStep(session);
    else if (session.step === 'open') body = openStep(session);
    else if (session.step === 'done') body = doneStep(session, titles);
    else body = quizStep(session, titles);

    return (
      '<header class="view-header"><h1 class="view-title">Sesión de repaso</h1>' +
      '<p class="view-subtitle">' + esc(sub) + '</p></header>' +
      '<div class="quiz-progress">' + stepper(session.step || 'quiz') + '</div>' +
      body
    );
  }

  views.reviewHome = reviewHome;
  views.calendar = calendar;
  views.reviewSession = reviewSession;

  /* --------------------- acciones propias de estas vistas --------------------- */

  function rerender() {
    root.dispatchEvent(new root.Event('hashchange'));
  }

  function currentState() {
    return NexIA.state;
  }

  function scheduleDialog(dateKey) {
    const st = currentState();
    const r = st ? st.raw : { materials: [] };
    const concepts = [];
    (r.materials || []).forEach((m) =>
      m.topics.forEach((t) => t.concepts.forEach((c) => concepts.push({ m, t, c })))
    );
    if (!concepts.length) {
      ui.toast('Primero sube un material para poder programar repasos.', 'error');
      return;
    }
    const options = concepts
      .map((x) => '<option value="' + esc(x.m.id + '|' + x.c.id) + '">' + esc(x.m.title + ' · ' + x.c.title) + '</option>')
      .join('');
    const min = U.dateKey();
    const value = dateKey && dateKey >= min ? dateKey : U.dateKey(U.addDays(new Date(), 1));
    const body =
      '<div class="form-group" style="margin-bottom:14px"><label class="form-label" for="schedConcept">Concepto a repasar</label>' +
      '<div class="select-wrapper"><select class="form-select" id="schedConcept">' + options + '</select><span class="select-chevron" aria-hidden="true">▾</span></div></div>' +
      '<div class="form-group"><label class="form-label" for="schedDate">Fecha</label>' +
      '<input class="form-input" type="date" id="schedDate" min="' + esc(min) + '" value="' + esc(value) + '"></div>';
    ui.openDialog({
      title: 'Programar un repaso',
      body,
      footer:
        '<button type="button" class="app-btn app-btn--outline" data-dialog-close>Cancelar</button>' +
        '<button type="button" class="app-btn app-btn--primary" data-action="schedule-confirm">Programar</button>'
    });
  }

  async function confirmSchedule(dialog) {
    const st = currentState();
    const sel = dialog.querySelector('#schedConcept');
    const dateInput = dialog.querySelector('#schedDate');
    if (!st || !sel || !dateInput || !dateInput.value) {
      ui.toast('Elige un concepto y una fecha.', 'error');
      return;
    }
    const parts = sel.value.split('|');
    const material = st.getMaterial(parts[0]);
    let found = null;
    if (material) material.topics.forEach((t) => t.concepts.forEach((c) => { if (c.id === parts[1]) found = { t, c }; }));
    if (!found) {
      ui.toast('No se encontró ese concepto.', 'error');
      return;
    }
    const row = await st.scheduleReview({
      materialId: material.id,
      conceptId: found.c.id,
      topicTitle: found.t.title,
      conceptTitle: found.c.title,
      success: false
    });
    const prefs = userPrefs(st.raw);
    const hour = parseInt(String(prefs.scheduleFrom || '19:00').split(':')[0], 10);
    const due = U.parseDateKey(dateInput.value);
    due.setHours(isNaN(hour) ? 19 : hour, 0, 0, 0);
    row.dueAt = due.getTime();
    await NexIA.store.put('reviews', row);
    st.raw.reviews.sort((a, b) => a.dueAt - b.dueAt);
    const closer = dialog.querySelector('[data-dialog-close]');
    if (closer) closer.click();
    ui.toast('Repaso programado para el ' + U.formatLongDate(due) + '.', 'success');
    rerender();
  }

  function selectDay(cell) {
    const st = currentState();
    const panel = document.getElementById('calDayPanel');
    if (!st || !panel) return;
    const grid = cell.closest('.calendar-grid');
    if (grid) grid.querySelectorAll('.cal-cell.is-selected').forEach((c) => c.classList.remove('is-selected'));
    cell.classList.add('is-selected');
    panel.innerHTML = dayPanelHtml(st.raw, cell.getAttribute('data-date'));
  }

  function skipStep() {
    const app = NexIA.appSession;
    const rev = app && app.review;
    if (!rev) return;
    if (rev.step === 'quiz') {
      rev.step = 'cards';
      rev.cardIndex = 0;
      rev.flipped = false;
    } else if (rev.step === 'cards') rev.step = 'open';
    rerender();
  }

  if (typeof document !== 'undefined' && !NexIA._reviewActionsBound) {
    NexIA._reviewActionsBound = true;

    document.addEventListener('click', (event) => {
      const reset = event.target.closest('[data-review-reset]');
      if (reset && NexIA.appSession) NexIA.appSession.review = null;

      const target = event.target.closest('[data-action]');
      if (!target) return;
      const action = target.getAttribute('data-action');
      if (action === 'schedule-review') scheduleDialog(target.getAttribute('data-date'));
      else if (action === 'schedule-confirm') confirmSchedule(target.closest('dialog') || document);
      else if (action === 'cal-day') selectDay(target);
      else if (action === 'review-skip-step') skipStep();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const cell = event.target.closest && event.target.closest('[data-action="cal-day"]');
      if (cell) {
        event.preventDefault();
        selectDay(cell);
        return;
      }
      const card = event.target.closest && event.target.closest('.flashcard[data-action="card-flip"]');
      if (card) {
        event.preventDefault();
        card.click();
      }
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
