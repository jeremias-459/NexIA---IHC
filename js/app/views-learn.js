/*
 * NexIA · Vistas de aprendizaje: biblioteca (#/temas), lección (#/leccion/ID/t/T/c/C),
 * práctica (#/practica/ID/t/T) y resultados (#/resultados/ID).
 *
 * Cada vista es una función pura que recibe el estado y devuelve HTML (texto).
 * Acciones (data-action) que debe atender el controlador:
 *
 *   Biblioteca: library-search (input) · library-filter [data-filter] · delete-material [data-id]
 *   Lección:    lesson-tab [data-tab] · concept-prev · concept-next · mark-done · toggle-favorite
 *               add-highlight · tts-play · tts-pause · tts-stop · tts-speed
 *               tutor-submit (submit del formulario) · tutor-suggest [data-text] · tutor-clear
 *               start-quiz
 *   Práctica:   quiz-select [data-index] · quiz-check · quiz-next · quiz-finish · quiz-exit
 *   Resultados: retry-quiz
 *
 * Los elementos de navegación también llevan href="#/..." para funcionar sin controlador.
 */
(function (root) {
  'use strict';

  const NexIA = (root.NexIA = root.NexIA || {});
  const U = NexIA.utils;
  const ui = NexIA.ui;
  const views = (NexIA.views = NexIA.views || {});

  /* ------------------------------------------------------------------ */
  /* Rutas (compartidas con views-home.js)                               */
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

  function dataOf(state) {
    return (state && state.raw) || state || {};
  }

  function apiOf(state) {
    return state && typeof state.materialProgress === 'function' ? state : NexIA.state;
  }

  function fold(text) {
    return String(text === null || text === undefined ? '' : text)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function lastActivity(material) {
    return material.lastOpenedAt || material.createdAt || 0;
  }

  function isDone(material, concept) {
    return Boolean(material.progress && material.progress.done && material.progress.done[concept.id]);
  }

  function statusChip(status) {
    if (status === 'completado') return ui.chip('Completado', 'mint');
    if (status === 'progreso') return ui.chip('En progreso', 'purple');
    return ui.chip('Nuevo', 'amber');
  }

  /** Lista plana de conceptos con sus índices. */
  function flatConcepts(material) {
    const flat = [];
    (material.topics || []).forEach((topic, ti) =>
      (topic.concepts || []).forEach((concept, ci) => flat.push({ ti, ci, topic, concept }))
    );
    return flat;
  }

  /** Concepto al que volver: el siguiente sin completar desde el último visto. */
  function resumePoint(material) {
    const flat = flatConcepts(material);
    if (!flat.length) return null;
    const last = (material.progress && material.progress.last) || { t: 0, c: 0 };
    let start = flat.findIndex((item) => item.ti === (last.t | 0) && item.ci === (last.c | 0));
    if (start < 0) start = 0;
    for (let k = 0; k < flat.length; k++) {
      const item = flat[(start + k) % flat.length];
      if (!isDone(material, item.concept)) return item;
    }
    return flat[start];
  }

  function topicQuestionCount(topic) {
    return (topic.concepts || []).reduce((n, concept) => n + ((concept.questions || []).length), 0);
  }

  function missing(title, text) {
    return ui.emptyState({
      icon: 'file',
      title,
      text,
      action: { href: routes.library, label: 'Ir a mis temas' }
    });
  }

  function blockquote(text) {
    return (
      '<blockquote style="border-left:3px solid var(--color-primary);padding:2px 0 2px 12px;margin:6px 0;color:var(--color-text-muted)">' +
      U.esc(text) +
      '</blockquote>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* Biblioteca                                                          */
  /* ------------------------------------------------------------------ */

  const FILTERS = [
    { id: 'todos', label: 'Todos' },
    { id: 'progreso', label: 'En progreso' },
    { id: 'nuevo', label: 'Nuevos' },
    { id: 'completado', label: 'Completados' }
  ];

  function normalizeQuery(query) {
    if (typeof query === 'string') return { q: query, filter: 'todos' };
    const q = query || {};
    const filter = q.filter || q.status || 'todos';
    return { q: String(q.q || q.query || q.text || ''), filter: FILTERS.some((f) => f.id === filter) ? filter : 'todos' };
  }

  function matchesQuery(material, term) {
    if (!term) return true;
    const haystack = fold(
      [material.title, material.fileName]
        .concat((material.topics || []).map((t) => t.title))
        .concat(material.terms || [])
        .join(' ')
    );
    return fold(term)
      .split(/\s+/)
      .filter(Boolean)
      .every((word) => haystack.indexOf(word) >= 0);
  }

  function materialCard(material, A) {
    const progress = A.materialProgress(material);
    const status = A.materialStatus(material);
    const point = resumePoint(material);
    const href = point ? routes.lesson(material.id, point.ti, point.ci) : routes.document(material.id);
    const topics = (material.topics || []).length;
    const concepts = progress.total;
    const minutes = (material.topics || []).reduce((n, t) => n + (t.minutes || 0), 0) || material.minutes || 0;
    const action = status === 'completado' ? 'Repasar' : status === 'progreso' ? 'Continuar' : 'Empezar';
    const meta = [
      'Abierto: ' + U.relativeTime(lastActivity(material)).toLowerCase(),
      material.fileName,
      material.fileSize ? U.formatBytes(material.fileSize) : ''
    ]
      .filter(Boolean)
      .join(' · ');

    return (
      '<article class="material-card" data-material-id="' + U.esc(material.id) + '">' +
      '<span class="material-thumb material-thumb--' + (status === 'completado' ? 'mint' : 'purple') + '" aria-hidden="true">' +
      ui.icon('file', 24) +
      U.esc(String(material.fileType || 'TXT').toUpperCase()) +
      '</span>' +
      '<div class="material-card__body">' +
      '<h2 class="material-card__title" style="overflow-wrap:anywhere"><a href="' + U.esc(href) + '">' + U.esc(material.title) + '</a></h2>' +
      '<p class="material-card__topic">' +
      U.esc(U.plural(topics, 'tema', 'temas') + ' · ' + U.plural(concepts, 'concepto', 'conceptos') + (minutes ? ' · ≈ ' + minutes + ' min' : '')) +
      '</p>' +
      '<div class="material-card__progress" role="img" aria-label="Progreso: ' + progress.pct + ' por ciento">' +
      ui.progressBar(progress.pct, status === 'completado' ? 'mint' : '') +
      '<span class="material-card__percent">' + progress.pct + ' %</span>' +
      '</div>' +
      '<p class="material-card__meta" style="overflow-wrap:anywhere">' + U.esc(meta) + '</p>' +
      '</div>' +
      '<div class="material-card__side">' +
      statusChip(status) +
      '<div style="display:flex;gap:8px;align-items:center">' +
      '<a class="app-btn app-btn--primary app-btn--sm" href="' + U.esc(href) + '">' + action + '</a>' +
      '<button type="button" class="app-btn app-btn--outline app-btn--sm" data-action="delete-material" data-id="' + U.esc(material.id) + '"' +
      ' data-title="' + U.esc(material.title) + '" aria-label="Eliminar «' + U.esc(material.title) + '»" title="Eliminar">' +
      ui.icon('trash', 16) +
      '</button>' +
      '</div>' +
      '</div>' +
      '</article>'
    );
  }

  views.library = function library(state, query) {
    const S = dataOf(state);
    const A = apiOf(state);
    const q = normalizeQuery(query);
    const materials = (S.materials || []).slice().sort((a, b) => lastActivity(b) - lastActivity(a));

    const header =
      '<div class="view-header">' +
      '<p class="view-eyebrow">Biblioteca</p>' +
      '<h1 class="view-title">Mis temas</h1>' +
      '<p class="view-subtitle">Todos tus materiales en un solo lugar. Busca, retoma o elimina lo que ya no necesites.</p>' +
      '</div>';

    if (!materials.length) {
      return (
        header +
        ui.emptyState({
          icon: 'folder',
          title: 'Aún no tienes materiales',
          text: 'Sube un PDF, un DOCX o un texto y NexIA lo convertirá en lecciones y preguntas de práctica.',
          action: { href: routes.explore, label: 'Subir mi primer material' }
        })
      );
    }

    const counts = { todos: materials.length, progreso: 0, nuevo: 0, completado: 0 };
    let doneConcepts = 0;
    let totalConcepts = 0;
    let totalMinutes = 0;
    materials.forEach((m) => {
      counts[A.materialStatus(m)] += 1;
      const p = A.materialProgress(m);
      doneConcepts += p.done;
      totalConcepts += p.total;
      totalMinutes += (m.topics || []).reduce((n, t) => n + (t.minutes || 0), 0) || m.minutes || 0;
    });

    const stat = (icon, tone, value, label) =>
      '<div class="stat-card"><span class="icon-box icon-box--' + tone + '" aria-hidden="true">' + ui.icon(icon, 20) + '</span>' +
      '<div><p class="stat-card__value">' + U.esc(value) + '</p><p class="stat-card__label">' + U.esc(label) + '</p></div></div>';

    const stats =
      '<div class="stats-row">' +
      stat('folder', 'purple', materials.length, materials.length === 1 ? 'material' : 'materiales') +
      stat('check-circle', 'mint', doneConcepts + ' / ' + totalConcepts, 'conceptos completados') +
      stat('clock', 'amber', '≈ ' + totalMinutes + ' min', 'de lectura en total') +
      '</div>';

    const filtered = materials.filter((m) => (q.filter === 'todos' || A.materialStatus(m) === q.filter) && matchesQuery(m, q.q));

    const toolbar =
      '<div class="library-toolbar" role="search">' +
      '<label class="search-field" for="librarySearch">' +
      ui.icon('search', 18) +
      '<input type="search" class="search-field__input" id="librarySearch" name="q" data-action="library-search" autocomplete="off"' +
      ' placeholder="Buscar por título, tema o término…" aria-label="Buscar materiales" value="' + U.esc(q.q) + '">' +
      '</label>' +
      '<a class="app-btn app-btn--primary" href="' + routes.explore + '">' + ui.icon('plus', 16) + ' Subir material</a>' +
      '</div>' +
      '<div class="filter-chips" role="group" aria-label="Filtrar por estado">' +
      FILTERS.map(
        (f) =>
          '<button type="button" class="filter-chip' + (q.filter === f.id ? ' is-active' : '') + '" data-action="library-filter" data-filter="' + f.id + '"' +
          ' aria-pressed="' + (q.filter === f.id ? 'true' : 'false') + '">' + U.esc(f.label) + ' (' + counts[f.id] + ')</button>'
      ).join('') +
      '</div>';

    const list = filtered.length
      ? '<div class="material-list">' + filtered.map((m) => materialCard(m, A)).join('') + '</div>'
      : '<div class="material-list"><p class="material-empty">' +
        (q.q
          ? 'No encontramos materiales que coincidan con «' + U.esc(q.q) + '».'
          : 'No hay materiales con este estado.') +
        '</p></div>';

    return (
      header +
      stats +
      toolbar +
      list +
      '<p class="view-footnote" aria-live="polite">Mostrando ' + filtered.length + ' de ' + materials.length + '.</p>'
    );
  };

  /* ------------------------------------------------------------------ */
  /* Lección                                                             */
  /* ------------------------------------------------------------------ */

  const TABS = [
    { id: 'lectura', label: 'Lectura' },
    { id: 'audio', label: 'Audio' },
    { id: 'visual', label: 'Visual' }
  ];

  function conceptBlocks(concept) {
    const title = fold(concept.title);
    return (concept.blocks || [])
      .map((block) => {
        if (block.type === 'code') return ui.codeBlock(block.text, block.lang);
        if (block.type === 'list') {
          return (
            '<ul class="check-list">' +
            (block.items || [])
              .map((item) => '<li><span class="check-circle" aria-hidden="true">•</span><span>' + U.esc(item) + '</span></li>')
              .join('') +
            '</ul>'
          );
        }
        if (block.type === 'h') {
          if (fold(block.text) === title) return '';
          return '<h3 class="lesson-card__lead">' + U.esc(block.text) + '</h3>';
        }
        if (block.type === 'quote') return blockquote(block.text);
        return '<p class="lesson-card__text">' + U.esc(block.text) + '</p>';
      })
      .join('');
  }

  function termChips(terms) {
    if (!terms || !terms.length) return '';
    return (
      '<div style="display:flex;flex-wrap:wrap;gap:8px" aria-label="Términos clave" role="list">' +
      terms.map((t) => '<span role="listitem">' + ui.chip(t, 'purple') + '</span>').join('') +
      '</div>'
    );
  }

  function highlightNote(material, concept) {
    const all = Array.isArray(material.highlights) ? material.highlights : [];
    const mine = all.filter((h) => h && typeof h === 'object' && (h.conceptId === concept.id));
    const texts = mine.map((h) => h.text || h.quote || h.note || '').filter(Boolean);
    if (!texts.length) {
      return (
        '<div class="mint-tip-card" data-role="highlights">' +
        '<p class="mint-tip-card__title">' + ui.icon('highlight', 16) + ' Subrayados</p>' +
        '<p class="mint-tip-card__text">Selecciona un fragmento del texto y pulsa «Subrayar selección» para guardarlo aquí.</p>' +
        '</div>'
      );
    }
    return (
      '<div class="mint-tip-card" data-role="highlights">' +
      '<p class="mint-tip-card__title">' + ui.icon('highlight', 16) + ' Tus subrayados (' + texts.length + ')</p>' +
      '<ul class="check-list" style="margin-top:8px">' +
      texts
        .slice(0, 6)
        .map((t) => '<li><span class="check-circle" aria-hidden="true">✓</span><span>' + U.esc(U.truncate(t, 160)) + '</span></li>')
        .join('') +
      '</ul>' +
      '</div>'
    );
  }

  function ttsTextOf(concept) {
    const course = NexIA.course;
    let body = '';
    if (course && course.conceptText) body = course.conceptText(concept);
    if (!body) {
      body = (concept.blocks || [])
        .filter((b) => b.type === 'p' || b.type === 'list' || b.type === 'h')
        .map((b) => (b.type === 'list' ? (b.items || []).join('. ') : b.text))
        .join(' ');
    }
    const intro = [concept.title, concept.lead].filter(Boolean).join('. ');
    return U.truncate(intro + '. ' + body, 6000);
  }

  function lessonPanelRead(material, concept, where, done, saved) {
    const attrs =
      ' data-material="' + U.esc(material.id) + '" data-ti="' + where.ti + '" data-ci="' + where.ci + '" data-concept="' + U.esc(concept.id) + '"';
    const keyPoints = concept.keyPoints || [];
    return (
      '<article class="lesson-card" aria-labelledby="conceptTitle">' +
      '<div class="lesson-card__head">' +
      '<h2 class="lesson-card__title" id="conceptTitle">' + U.esc(concept.title) + '</h2>' +
      '<span style="display:flex;gap:8px;flex-wrap:wrap">' +
      ui.chip('≈ ' + (concept.minutes || 1) + ' min', 'amber') +
      (done ? ui.chip('Entendido', 'mint') : '') +
      '</span>' +
      '</div>' +
      (concept.lead ? '<p class="lesson-card__lead" style="margin-top:14px">' + U.esc(concept.lead) + '</p>' : '') +
      (keyPoints.length
        ? '<h3 class="lesson-card__lead" style="margin-top:18px;font-size:0.88rem;color:var(--color-primary)">Ideas clave</h3>' +
          '<ul class="check-list" style="margin-top:8px">' +
          keyPoints
            .map((p) => '<li style="align-items:flex-start"><span class="check-circle" aria-hidden="true" style="margin-top:2px">✓</span><span>' + U.esc(p) + '</span></li>')
            .join('') +
          '</ul>'
        : '') +
      (concept.terms && concept.terms.length
        ? '<h3 class="lesson-card__lead" style="margin-top:18px;font-size:0.88rem;color:var(--color-primary)">Términos</h3><div style="margin-top:8px">' +
          termChips(concept.terms) + '</div>'
        : '') +
      '<div data-role="concept-text" style="display:flex;flex-direction:column;gap:12px;margin-top:20px;padding-top:18px;border-top:1px solid var(--color-border)">' +
      conceptBlocks(concept) +
      '</div>' +
      '</article>' +
      highlightNote(material, concept) +
      '<div class="lesson-card__actions">' +
      '<button type="button" class="app-btn ' + (done ? 'app-btn--outline' : 'app-btn--primary') + '" data-action="mark-done"' + attrs +
      ' aria-pressed="' + (done ? 'true' : 'false') + '">' +
      ui.icon('check-circle', 16) + (done ? ' Entendido' : ' Marcar como entendido') +
      '</button>' +
      '<button type="button" class="app-btn app-btn--outline" data-action="toggle-favorite"' + attrs +
      ' aria-pressed="' + (saved ? 'true' : 'false') + '">' +
      ui.icon('star', 16) + (saved ? ' Guardado en favoritos' : ' Guardar concepto') +
      '</button>' +
      '<button type="button" class="app-btn app-btn--outline" data-action="add-highlight"' + attrs + '>' +
      ui.icon('highlight', 16) + ' Subrayar selección' +
      '</button>' +
      '</div>'
    );
  }

  function lessonPanelAudio(material, concept, where) {
    const text = ttsTextOf(concept);
    const words = U.countWords(text);
    const total = U.formatClock(words / 2.5);
    const supported = Boolean(root.speechSynthesis);
    const rnd = U.seededRandom(U.hashString(String(concept.id) + String(concept.title)));
    const bars = [];
    for (let i = 0; i < 44; i++) bars.push('<span class="wave-bar" style="height:' + Math.round(22 + rnd() * 78) + '%"></span>');
    const attrs = ' data-material="' + U.esc(material.id) + '" data-ti="' + where.ti + '" data-ci="' + where.ci + '"';
    const off = supported ? '' : ' disabled';
    return (
      '<article class="lesson-card">' +
      '<div class="audio-player is-paused" data-tts data-tts-text="' + U.esc(text) + '"' + attrs + ' data-tts-words="' + words + '">' +
      '<div class="audio-player__head">' +
      '<span class="audio-player__icon" style="color:var(--color-primary)" aria-hidden="true">' + ui.icon('headphones', 20) + '</span>' +
      '<div>' +
      '<p class="audio-player__title">Escuchar: ' + U.esc(concept.title) + '</p>' +
      '<p class="audio-player__sub">Voz del navegador · lectura de este concepto</p>' +
      '</div>' +
      '</div>' +
      '<div class="audio-waveform" aria-hidden="true">' + bars.join('') + '</div>' +
      '<div class="audio-player__times"><span data-tts-elapsed>00:00</span><span data-tts-total>≈ ' + U.esc(total) + '</span></div>' +
      '<div class="audio-player__controls" role="group" aria-label="Controles de audio">' +
      '<button type="button" class="audio-player__speed" data-action="tts-speed" data-speed="1" aria-label="Cambiar velocidad de lectura (actual 1x)"' + off +
      ' style="border:none;background:transparent;cursor:pointer">1×</button>' +
      '<div class="audio-player__center">' +
      '<button type="button" class="icon-btn" data-action="tts-stop" aria-label="Detener"' + off + '>' + ui.icon('skip-back', 20) + '</button>' +
      '<button type="button" class="play-btn" data-action="tts-play" aria-label="Reproducir"' + off + '>' + ui.icon('play', 18) + '</button>' +
      '<button type="button" class="icon-btn" data-action="tts-pause" aria-label="Pausar"' + off + '>' + ui.icon('pause', 20) + '</button>' +
      '</div>' +
      '<span aria-hidden="true" style="min-width:32px"></span>' +
      '</div>' +
      '</div>' +
      (supported
        ? ''
        : '<div class="quiz-feedback quiz-feedback--error" role="alert" style="margin-top:14px"><p class="quiz-feedback__title">Audio no disponible</p>Tu navegador no ofrece lectura en voz alta. Puedes leer el texto en la pestaña «Lectura».</div>') +
      '<details style="margin-top:14px"><summary style="cursor:pointer;font-size:0.84rem;font-weight:600;color:var(--color-primary)">Ver el texto que se leerá</summary>' +
      '<p class="lesson-card__text" style="margin-top:10px">' + U.esc(text) + '</p></details>' +
      '<p class="lesson-card__caption" style="margin-top:12px">La voz la genera tu navegador en tu dispositivo; no se crea ningún archivo de audio.</p>' +
      '</article>'
    );
  }

  function buildSlides(concept) {
    const slides = [];
    slides.push({ title: concept.title, caption: concept.lead || '', wide: true });
    (concept.keyPoints || []).forEach((point, i) => slides.push({ title: 'Idea clave ' + (i + 1), caption: point }));
    const code = (concept.blocks || []).find((b) => b.type === 'code');
    if (code) slides.push({ title: 'Ejemplo de código', code });
    if (concept.terms && concept.terms.length) slides.push({ title: 'Términos para recordar', terms: concept.terms, wide: true });
    return slides;
  }

  function lessonPanelVisual(concept) {
    const slides = buildSlides(concept);
    const total = slides.length;
    const html = slides
      .map((slide, i) => {
        const style = slide.wide || slide.code ? ' style="grid-column:1/-1"' : '';
        return (
          '<figure class="video-frame"' + style + ' aria-label="Diapositiva ' + (i + 1) + ' de ' + total + '">' +
          '<span class="video-frame__crumb">DIAPOSITIVA ' + (i + 1) + ' DE ' + total + '</span>' +
          '<h3 class="video-frame__title">' + U.esc(slide.title) + '</h3>' +
          (slide.caption ? '<figcaption class="video-frame__caption" style="font-size:0.92rem;line-height:1.55">' + U.esc(slide.caption) + '</figcaption>' : '') +
          (slide.code ? ui.codeBlock(slide.code.text, slide.code.lang) : '') +
          (slide.terms
            ? '<div style="display:flex;flex-wrap:wrap;gap:8px">' + slide.terms.map((t) => ui.chip(t, 'white')).join('') + '</div>'
            : '') +
          '</figure>'
        );
      })
      .join('');
    return (
      '<article class="lesson-card">' +
      '<div class="lesson-card__head"><h2 class="lesson-card__title">Resumen visual</h2>' + ui.chip(U.plural(total, 'diapositiva', 'diapositivas'), 'purple') + '</div>' +
      '<p class="lesson-card__caption" style="margin:6px 0 16px">Diapositivas generadas automáticamente con la idea central y los puntos clave del concepto.</p>' +
      '<div class="lesson-visuals">' + html + '</div>' +
      '</article>'
    );
  }

  /* ----- Tutor ----- */

  function renderParts(parts) {
    return (parts || [])
      .map((part) => {
        if (!part) return '';
        if (part.type === 'quote') return blockquote(part.text);
        if (part.type === 'code') return ui.codeBlock(part.text, part.lang);
        if (part.type === 'list') {
          return (
            '<ul style="list-style:disc;padding-left:18px;margin:6px 0">' +
            (part.items || []).map((item) => '<li>' + U.esc(item) + '</li>').join('') +
            '</ul>'
          );
        }
        return '<p style="margin:4px 0">' + U.esc(part.text) + '</p>';
      })
      .join('');
  }

  function chatMessage(msg, material) {
    if (!msg) return '';
    if (msg.role === 'user') {
      return '<div class="chat-bubble chat-bubble--user">' + U.esc(msg.text || msg.content || '') + '</div>';
    }
    const parts = Array.isArray(msg.parts) && msg.parts.length ? msg.parts : [{ type: 'p', text: msg.text || msg.content || '' }];
    const isAi = msg.mode === 'ai';
    let source = '';
    if (msg.source && material.topics[msg.source.ti] && material.topics[msg.source.ti].concepts[msg.source.ci]) {
      const target = material.topics[msg.source.ti].concepts[msg.source.ci];
      source =
        '<p style="margin-top:8px;font-size:0.74rem"><a href="' + U.esc(routes.lesson(material.id, msg.source.ti, msg.source.ci)) +
        '" style="color:var(--color-primary);font-weight:600">Ver en el material: ' + U.esc(target.title) + ' ›</a></p>';
    }
    return (
      '<div class="chat-bubble chat-bubble--ai' + (isAi ? ' chat-bubble--mint' : '') + '">' +
      renderParts(parts) +
      (msg.notice ? '<p style="margin-top:6px;font-size:0.74rem;color:var(--color-amber-text)">' + U.esc(msg.notice) + '</p>' : '') +
      source +
      (msg.mode ? '<p style="margin-top:6px;font-size:0.68rem;color:var(--color-text-muted)">' + (isAi ? 'Respondido con IA' : 'Tutor local') + '</p>' : '') +
      '</div>'
    );
  }

  function tutorCard(material, concept, where) {
    const ai = NexIA.ai;
    const aiOn = Boolean(ai && ai.isReady && ai.isReady());
    const chat = Array.isArray(material.chat) ? material.chat : [];
    const visible = chat.slice(-24);
    const lastAi = visible
      .slice()
      .reverse()
      .find((m) => m && m.role !== 'user' && Array.isArray(m.suggestions) && m.suggestions.length);
    let suggestions = lastAi ? lastAi.suggestions : ['Resúmelo', 'Dame un ejemplo', 'Hazme una pregunta'];
    if (!lastAi && concept.terms && concept.terms[0]) suggestions = suggestions.concat('¿Qué es ' + concept.terms[0] + '?');
    suggestions = suggestions.slice(0, 5);

    const attrs = ' data-material="' + U.esc(material.id) + '" data-ti="' + where.ti + '" data-ci="' + where.ci + '"';
    const welcome =
      '<div class="chat-bubble chat-bubble--ai">' +
      '<p style="margin:0">Hola, soy tu tutor. Pregúntame sobre «' + U.esc(concept.title) + '» o pídeme un resumen, un ejemplo o una pregunta de práctica.</p>' +
      '</div>';

    return (
      '<aside class="tutor-card" aria-label="Tutor" data-ai="' + (aiOn ? 'on' : 'off') + '">' +
      '<div class="tutor-card__head">' +
      '<span class="icon-box icon-box--mint" aria-hidden="true">' + ui.icon('message', 20) + '</span>' +
      '<div style="flex:1;min-width:0">' +
      '<p class="tutor-card__title">Tutor NexIA</p>' +
      '<p class="tutor-card__status">' + (aiOn ? 'Con IA · usa tu material como contexto' : 'Tutor local · busca en tu material') + '</p>' +
      '</div>' +
      ui.chip(aiOn ? 'IA' : 'Local', aiOn ? 'mint' : 'purple') +
      (visible.length
        ? '<button type="button" class="icon-btn" data-action="tutor-clear" data-material="' + U.esc(material.id) + '" aria-label="Borrar la conversación" title="Borrar la conversación">' + ui.icon('trash', 18) + '</button>'
        : '') +
      '</div>' +
      '<div class="chat-log" id="chatLog" role="log" aria-live="polite" aria-label="Conversación con el tutor" tabindex="0">' +
      welcome +
      visible.map((m) => chatMessage(m, material)).join('') +
      '</div>' +
      '<div class="filter-chips" style="margin-top:0" role="group" aria-label="Preguntas sugeridas">' +
      suggestions
        .map((s) => '<button type="button" class="filter-chip" data-action="tutor-suggest" data-text="' + U.esc(s) + '"' + attrs + '>' + U.esc(s) + '</button>')
        .join('') +
      '</div>' +
      '<form class="chat-input" data-action="tutor-submit"' + attrs + ' autocomplete="off">' +
      '<input class="chat-input__field" type="text" name="message" id="tutorInput" maxlength="500" required' +
      ' placeholder="Pregunta sobre este concepto…" aria-label="Escribe tu pregunta al tutor">' +
      '<button type="submit" class="chat-input__send" aria-label="Enviar pregunta">' + ui.icon('send', 18) + '</button>' +
      '</form>' +
      '<p class="lesson-card__caption">' +
      (aiOn
        ? 'Con la IA activa, tu pregunta y el texto del concepto se envían al proveedor que configuraste en tu perfil.'
        : 'El tutor local responde solo con frases de tu propio material; no inventa información.') +
      '</p>' +
      '</aside>'
    );
  }

  function practiceBanner(material, topic, concept, ti) {
    const total = topicQuestionCount(topic);
    const sample = (concept.questions || [])[0] || ((topic.concepts || []).map((c) => (c.questions || [])[0]).find(Boolean));
    const quizHref = routes.quiz(material.id, ti);
    return (
      '<section class="practice-banner" aria-label="Práctica del tema">' +
      '<span class="icon-box icon-box--white" aria-hidden="true">' + ui.icon('target', 20) + '</span>' +
      '<div class="practice-banner__body">' +
      '<p class="practice-banner__title">Practica este tema</p>' +
      (sample
        ? '<p class="practice-banner__question">' + U.esc(sample.stem) + (sample.quote ? ' ' + U.esc(U.truncate(sample.quote, 90)) : '') + '</p>'
        : '') +
      '<p class="practice-banner__text">' +
      (total
        ? U.esc(U.plural(total, 'pregunta disponible', 'preguntas disponibles') + ' en «' + topic.title + '». Se generan de tu propio material.')
        : 'Este tema es muy breve y no generó preguntas de práctica.') +
      '</p>' +
      '</div>' +
      (total
        ? '<a class="app-btn app-btn--primary" href="' + U.esc(quizHref) + '" data-action="start-quiz" data-material="' + U.esc(material.id) + '" data-ti="' + ti + '">Empezar práctica</a>'
        : '<button type="button" class="app-btn app-btn--primary" disabled>Sin preguntas</button>') +
      '</section>'
    );
  }

  views.lesson = function lesson(state, materialId, ti, ci, tab) {
    const A = apiOf(state);
    const material = A.getMaterial ? A.getMaterial(materialId) : null;
    if (!material || !(material.topics || []).length) {
      return missing('No encontramos esta lección', 'El material puede haberse eliminado. Vuelve a tus temas para elegir otro.');
    }

    const t = U.clamp(parseInt(ti, 10) || 0, 0, material.topics.length - 1);
    const topic = material.topics[t];
    const concepts = topic.concepts || [];
    if (!concepts.length) return missing('Este tema no tiene conceptos', 'Prueba con otro tema del material.');
    const c = U.clamp(parseInt(ci, 10) || 0, 0, concepts.length - 1);
    const concept = concepts[c];
    const activeTab = TABS.some((x) => x.id === tab) ? tab : 'lectura';

    const flat = flatConcepts(material);
    const index = flat.findIndex((item) => item.ti === t && item.ci === c);
    const prev = index > 0 ? flat[index - 1] : null;
    const next = index >= 0 && index < flat.length - 1 ? flat[index + 1] : null;
    const where = { ti: t, ci: c };
    const done = isDone(material, concept);
    const saved = A.isConceptSaved ? A.isConceptSaved(material.id, concept.id) : false;
    const attrs = ' data-material="' + U.esc(material.id) + '"';

    const header =
      '<div class="view-header">' +
      '<p class="view-eyebrow"><a href="' + U.esc(routes.document(material.id)) + '">' + U.esc(material.title) + '</a> · Tema ' + (t + 1) + ' de ' + material.topics.length + '</p>' +
      '<h1 class="view-title">' + U.esc(topic.title) + '</h1>' +
      '<p class="view-subtitle">' + U.esc(U.plural(concepts.length, 'concepto', 'conceptos') + ' · ≈ ' + (topic.minutes || 1) + ' min') + '</p>' +
      '</div>';

    const tabs =
      '<div class="segmented-tabs" role="tablist" aria-label="Formato de la lección">' +
      TABS.map(
        (x) =>
          '<button type="button" role="tab" class="segmented-tab' + (x.id === activeTab ? ' is-active' : '') + '" id="tab-' + x.id + '"' +
          ' aria-selected="' + (x.id === activeTab ? 'true' : 'false') + '" aria-controls="panel-' + x.id + '"' +
          ' data-action="lesson-tab" data-tab="' + x.id + '"' + attrs + ' data-ti="' + t + '" data-ci="' + c + '"' +
          ' data-href="' + U.esc(routes.lesson(material.id, t, c)) + '">' + x.label + '</button>'
      ).join('') +
      '</div>';

    const nextHref = next ? routes.lesson(material.id, next.ti, next.ci) : routes.quiz(material.id, t);
    const nav =
      '<nav class="concept-nav" aria-label="Navegación entre conceptos">' +
      (prev
        ? '<a class="concept-nav__btn" href="' + U.esc(routes.lesson(material.id, prev.ti, prev.ci)) + '" data-action="concept-prev"' + attrs + ' data-ti="' + prev.ti + '" data-ci="' + prev.ci + '">‹ Anterior</a>'
        : '<button type="button" class="concept-nav__btn" disabled style="opacity:0.5;cursor:not-allowed">‹ Anterior</button>') +
      '<span aria-live="polite">Concepto ' + (c + 1) + ' de ' + concepts.length + '</span>' +
      '<a class="concept-nav__btn" href="' + U.esc(nextHref) + '" data-action="' + (next ? 'concept-next' : 'start-quiz') + '"' + attrs +
      ' data-ti="' + (next ? next.ti : t) + '" data-ci="' + (next ? next.ci : c) + '" data-from-ti="' + t + '" data-from-ci="' + c + '">' +
      (next ? 'Siguiente ›' : 'Ir a practicar ›') +
      '</a>' +
      '</nav>';

    const panel = (id, inner) =>
      '<section class="lesson-panel' + (id === activeTab ? ' is-active' : '') + '" role="tabpanel" id="panel-' + id + '"' +
      ' aria-labelledby="tab-' + id + '" data-panel="' + id + '">' + inner + '</section>';

    return (
      header +
      '<div class="lesson-layout">' +
      '<div class="lesson-main">' +
      tabs +
      nav +
      panel('lectura', lessonPanelRead(material, concept, where, done, saved)) +
      panel('audio', lessonPanelAudio(material, concept, where)) +
      panel('visual', lessonPanelVisual(concept)) +
      '</div>' +
      tutorCard(material, concept, where) +
      '</div>' +
      practiceBanner(material, topic, concept, t)
    );
  };

  /* ------------------------------------------------------------------ */
  /* Práctica (quiz)                                                     */
  /* ------------------------------------------------------------------ */

  const TYPE_LABELS = {
    concept: 'Definición',
    cloze: 'Completar la idea',
    tf: 'Verdadero o falso',
    where: 'Ubicar la idea'
  };

  views.quiz = function quiz(state, session) {
    const A = apiOf(state);
    const questions = session && Array.isArray(session.questions) ? session.questions : [];
    if (!session || !questions.length) {
      return ui.emptyState({
        icon: 'target',
        title: 'No hay preguntas para practicar',
        text: 'Este material no generó preguntas para esta selección. Prueba con otro tema.',
        action: { href: routes.library, label: 'Ir a mis temas' }
      });
    }

    const material = A.getMaterial ? A.getMaterial(session.materialId) : null;
    const n = questions.length;
    const index = U.clamp(session.index | 0, 0, n - 1);
    const q = questions[index];
    const checked = Boolean(session.checked);
    const selected = typeof session.selected === 'number' ? session.selected : null;
    const answers = Array.isArray(session.answers) ? session.answers : [];
    const hasTopic = typeof session.topicIndex === 'number' && material && material.topics[session.topicIndex];
    const topic = hasTopic ? material.topics[session.topicIndex] : null;
    const isLast = index === n - 1;
    const correctNow = checked && selected === q.answer;

    const found = material && q.conceptId && NexIA.course && NexIA.course.findConcept ? NexIA.course.findConcept(material, q.conceptId) : null;
    const exitHref = material
      ? hasTopic
        ? routes.lesson(material.id, session.topicIndex, found ? found.ci : 0)
        : routes.document(material.id)
      : routes.library;

    const bars = [];
    for (let i = 0; i < n; i++) bars.push('<span' + (i <= index ? ' class="is-filled"' : '') + '></span>');

    const progress =
      '<div class="quiz-progress">' +
      '<div class="quiz-progress__top">' +
      '<span class="quiz-progress__pill">Pregunta ' + (index + 1) + ' de ' + n + '</span>' +
      '<span class="quiz-card__hint">' + U.esc(TYPE_LABELS[q.type] || 'Pregunta') + '</span>' +
      '</div>' +
      '<div class="quiz-progress__bars" style="grid-template-columns:repeat(' + n + ',1fr)" role="progressbar" aria-valuemin="1" aria-valuemax="' + n + '" aria-valuenow="' + (index + 1) + '" aria-label="Progreso de la práctica">' +
      bars.join('') +
      '</div>' +
      '</div>';

    const options = (q.options || [])
      .map((option, i) => {
        let cls = 'quiz-option';
        let mark = '';
        if (checked) {
          if (i === q.answer) {
            cls += ' is-correct';
            mark = '✓';
          } else if (i === selected) {
            cls += ' is-wrong';
            mark = '✕';
          }
        } else if (i === selected) {
          cls += ' is-selected';
        }
        return (
          '<button type="button" role="radio" class="' + cls + '" aria-checked="' + (i === selected ? 'true' : 'false') + '"' +
          (checked ? ' aria-disabled="true" tabindex="-1" style="cursor:default"' : ' data-action="quiz-select" data-index="' + i + '"') + '>' +
          '<span class="quiz-option__letter" aria-hidden="true">' + String.fromCharCode(65 + i) + '</span>' +
          '<span class="quiz-option__text">' + U.esc(option) + '</span>' +
          '<span class="quiz-option__mark" aria-hidden="true">' + mark + '</span>' +
          '</button>'
        );
      })
      .join('');

    let feedback = '';
    if (checked) {
      const rightText = (q.options || [])[q.answer];
      feedback =
        '<div class="quiz-feedback quiz-feedback--' + (correctNow ? 'success' : 'error') + '" role="status" aria-live="polite">' +
        '<p class="quiz-feedback__title">' + (correctNow ? '¡Correcto!' : 'Todavía no') + '</p>' +
        (correctNow ? '' : '<p>La respuesta correcta es: <strong>' + U.esc(rightText) + '</strong>.</p>') +
        (q.explanation ? '<p style="margin-top:6px">' + U.esc(q.explanation) + '</p>' : '') +
        (found
          ? '<p style="margin-top:8px"><a href="' + U.esc(routes.lesson(material.id, found.ti, found.ci)) + '" style="color:var(--color-primary);font-weight:600">Repasar «' + U.esc(found.concept.title) + '» ›</a></p>'
          : '') +
        '</div>';
    }

    const primary = !checked
      ? '<button type="button" class="app-btn app-btn--primary app-btn--wide" data-action="quiz-check"' + (selected === null ? ' disabled' : '') + '>Comprobar</button>'
      : isLast
        ? '<button type="button" class="app-btn app-btn--primary app-btn--wide" data-action="quiz-finish">Ver resultados</button>'
        : '<button type="button" class="app-btn app-btn--primary app-btn--wide" data-action="quiz-next">Siguiente ' + ui.icon('arrow-right', 16) + '</button>';

    const card =
      '<section class="quiz-card" aria-labelledby="quizQuestion">' +
      '<h2 class="quiz-card__question" id="quizQuestion">' + U.esc(q.stem) + '</h2>' +
      (q.quote ? blockquote(q.quote) : '') +
      (checked ? '' : '<p class="quiz-card__hint">' + (q.type === 'tf' ? 'Elige verdadero o falso y pulsa «Comprobar».' : 'Elige una opción y pulsa «Comprobar».') + '</p>') +
      '<div class="quiz-options" role="radiogroup" aria-labelledby="quizQuestion">' + options + '</div>' +
      feedback +
      '<div class="quiz-card__actions">' +
      '<a class="app-btn app-btn--outline" href="' + U.esc(exitHref) + '" data-action="quiz-exit">Salir de la práctica</a>' +
      primary +
      '</div>' +
      '</section>';

    const rightSoFar = answers.filter((a) => a && a.correct).length;
    const side =
      '<aside class="side-info-card" aria-label="Tu avance">' +
      '<h2 class="side-info-card__title">Tu avance</h2>' +
      '<p class="side-info-card__desc">' +
      (topic ? 'Tema: ' + U.esc(topic.title) : material ? 'Práctica general de «' + U.esc(material.title) + '»' : 'Práctica') +
      '</p>' +
      '<ul class="check-list check-list--divided">' +
      '<li><span class="check-circle" aria-hidden="true">✓</span><span>' + U.esc(U.plural(answers.length, 'pregunta respondida', 'preguntas respondidas')) + '</span></li>' +
      '<li><span class="check-circle" aria-hidden="true">✓</span><span>' + U.esc(U.plural(rightSoFar, 'acierto', 'aciertos')) + '</span></li>' +
      '</ul>' +
      '<div class="mint-tip-card"><p class="mint-tip-card__title">' + ui.icon('bulb', 16) + ' Un consejo</p>' +
      '<p class="mint-tip-card__text">Si fallas una pregunta, NexIA programa un repaso de ese concepto. Equivocarse también es aprender.</p></div>' +
      '</aside>';

    return (
      '<div class="view-header">' +
      '<p class="view-eyebrow">Práctica' + (material ? ' · ' + U.esc(material.title) : '') + '</p>' +
      '<h1 class="view-title">' + (topic ? 'Practica: ' + U.esc(topic.title) : 'Práctica general') + '</h1>' +
      '</div>' +
      progress +
      '<div class="quiz-layout">' + card + side + '</div>'
    );
  };

  /* ------------------------------------------------------------------ */
  /* Resultados                                                          */
  /* ------------------------------------------------------------------ */

  function groupByConcept(answers) {
    const map = new Map();
    answers.forEach((a, i) => {
      if (!a) return;
      const key = a.conceptId || a.conceptTitle || 'q' + i;
      const row = map.get(key) || {
        conceptId: a.conceptId || null,
        title: a.conceptTitle || 'Concepto',
        topicTitle: a.topicTitle || '',
        right: 0,
        wrong: 0
      };
      if (a.correct) row.right++;
      else row.wrong++;
      map.set(key, row);
    });
    return Array.from(map.values());
  }

  function answerReview(answers) {
    const detailed = answers.filter((a) => a && a.stem);
    if (!detailed.length) return '';
    return (
      '<details class="result-card" style="margin-top:20px"><summary style="cursor:pointer;font-weight:700;color:var(--color-text-main)">Revisar mis respuestas</summary>' +
      '<ol style="margin-top:14px;display:flex;flex-direction:column;gap:14px;padding-left:20px;list-style:decimal">' +
      detailed
        .map(
          (a) =>
            '<li style="font-size:0.88rem"><p style="font-weight:600">' + U.esc(a.stem) + ' ' + ui.chip(a.correct ? 'Acierto' : 'Por reforzar', a.correct ? 'mint' : 'amber') + '</p>' +
            (a.quote ? blockquote(a.quote) : '') +
            (!a.correct && (a.correctText || a.answerText)
              ? '<p class="quiz-card__hint">Respuesta correcta: ' + U.esc(a.correctText || a.answerText) + '</p>'
              : '') +
            (a.explanation ? '<p class="quiz-card__hint">' + U.esc(a.explanation) + '</p>' : '') +
            '</li>'
        )
        .join('') +
      '</ol></details>'
    );
  }

  views.results = function results(state, attemptId) {
    const A = apiOf(state);
    const attempt = A.getAttempt ? A.getAttempt(attemptId) : null;
    if (!attempt) {
      return ui.emptyState({
        icon: 'chart',
        title: 'No encontramos este resultado',
        text: 'Puede que se haya eliminado junto con su material. Revisa tu progreso general.',
        action: { href: '#/progreso', label: 'Ver mi progreso' }
      });
    }

    const material = A.getMaterial ? A.getMaterial(attempt.materialId) : null;
    const answers = Array.isArray(attempt.answers) ? attempt.answers : [];
    const total = attempt.total !== undefined && attempt.total !== null ? attempt.total : answers.length;
    const correct = attempt.correct !== undefined && attempt.correct !== null ? attempt.correct : answers.filter((a) => a && a.correct).length;
    const pct = U.percent(correct, total);
    const rows = groupByConcept(answers);
    const understood = rows.filter((r) => r.wrong === 0);
    const reinforce = rows.filter((r) => r.wrong > 0);
    const topicIndex = typeof attempt.topicIndex === 'number' ? attempt.topicIndex : null;
    const topic = material && topicIndex !== null ? material.topics[topicIndex] : null;
    const isReview = attempt.kind === 'review';

    const conceptHref = (row) => {
      if (!material || !row.conceptId || !NexIA.course || !NexIA.course.findConcept) return '';
      const found = NexIA.course.findConcept(material, row.conceptId);
      return found ? routes.lesson(material.id, found.ti, found.ci) : '';
    };

    let title;
    let text;
    if (pct >= 80) {
      title = '¡Muy buen resultado!';
      text = 'Dominas gran parte de lo que practicaste.';
    } else if (pct >= 50) {
      title = 'Vas por buen camino';
      text = 'Ya entiendes una buena parte; refuerza lo que falló.';
    } else {
      title = 'Aún hay que reforzar';
      text = 'No pasa nada: repasa los conceptos marcados y vuelve a intentarlo.';
    }

    const hero =
      '<section class="result-hero" aria-labelledby="resultTitle">' +
      '<div class="result-hero__body">' +
      ui.chip(isReview ? 'Repaso' : 'Práctica', 'purple') +
      '<h2 class="result-hero__title" id="resultTitle">' + U.esc(title) + '</h2>' +
      '<p class="result-hero__text">Acertaste ' + correct + ' de ' + U.esc(U.plural(total, 'pregunta', 'preguntas')) + '. ' + U.esc(text) + '</p>' +
      '<p class="result-hero__text">' + U.esc([topic ? topic.title : material ? material.title : '', U.relativeTime(attempt.createdAt)].filter(Boolean).join(' · ')) + '</p>' +
      '</div>' +
      ui.donut(pct) +
      '</section>';

    const understoodCard =
      '<article class="result-card">' +
      '<div class="result-card__head"><span class="icon-box icon-box--mint" aria-hidden="true">' + ui.icon('check-circle', 20) + '</span>' +
      '<h2 class="result-card__title">Lo que ya entiendes</h2></div>' +
      (understood.length
        ? understood
            .map((r) => '<div class="reinforce-row"><span>' + U.esc(r.title) + '</span>' + ui.chip(r.right + (r.right === 1 ? ' acierto' : ' aciertos'), 'mint') + '</div>')
            .join('')
        : '<p class="quiz-card__hint">Aún no hay conceptos con todas las respuestas correctas. Con otra práctica se verá tu avance.</p>') +
      '</article>';

    const reinforceCard =
      '<article class="result-card">' +
      '<div class="result-card__head"><span class="icon-box icon-box--amber" aria-hidden="true">' + ui.icon('target', 20) + '</span>' +
      '<h2 class="result-card__title">Para reforzar</h2></div>' +
      (reinforce.length
        ? reinforce
            .map((r) => {
              const href = conceptHref(r);
              const label = '<span>' + U.esc(r.title) + '</span>';
              return (
                '<div class="reinforce-row">' +
                (href ? '<a href="' + U.esc(href) + '" style="color:var(--color-primary);font-weight:600">' + U.esc(r.title) + ' ›</a>' : label) +
                ui.chip(U.plural(r.wrong, 'fallo', 'fallos'), 'amber') +
                '</div>'
              );
            })
            .join('')
        : '<p class="quiz-card__hint">No hay conceptos por reforzar en este intento. ¡Buen trabajo!</p>') +
      '</article>';

    const retryHref = material ? routes.quiz(material.id, topicIndex) : routes.library;
    const backHref = material
      ? topicIndex !== null && material.topics[topicIndex]
        ? routes.lesson(material.id, topicIndex)
        : routes.document(material.id)
      : routes.library;
    const recommend =
      '<section class="recommend-banner" aria-label="Siguiente paso">' +
      svgIllustrationDoc() +
      '<div class="recommend-banner__body">' +
      '<h2 class="recommend-banner__title">' + ui.icon('bulb', 20) + ' Siguiente paso</h2>' +
      '<p class="recommend-banner__text">' +
      (reinforce.length
        ? 'NexIA programó un repaso para ' + U.esc(U.plural(reinforce.length, 'concepto', 'conceptos')) + '. Léelos de nuevo y vuelve a practicar para consolidar lo aprendido.'
        : 'Sigue con el siguiente tema o programa otro repaso más adelante para no olvidar lo aprendido.') +
      '</p>' +
      '<div class="recommend-banner__actions">' +
      '<a class="app-btn app-btn--outline" href="' + U.esc(backHref) + '">Volver a la lección</a>' +
      (reinforce.length ? '<a class="app-btn app-btn--outline" href="' + routes.review + '">Ir al repaso</a>' : '') +
      '<a class="app-btn app-btn--primary" href="' + U.esc(retryHref) + '" data-action="retry-quiz"' +
      (material ? ' data-material="' + U.esc(material.id) + '"' : '') + (topicIndex !== null ? ' data-ti="' + topicIndex + '"' : '') + '>Practicar de nuevo</a>' +
      '</div>' +
      '</div>' +
      '</section>';

    return (
      '<div class="view-header">' +
      '<p class="view-eyebrow">Resultados</p>' +
      '<h1 class="view-title">Tu resultado</h1>' +
      '</div>' +
      hero +
      '<div class="result-cards">' + understoodCard + reinforceCard + '</div>' +
      answerReview(answers) +
      recommend
    );
  };

  function svgIllustrationDoc() {
    return '<svg class="recommend-banner__illus" viewBox="0 0 160 125" aria-hidden="true" focusable="false"><use href="#illus-doc"></use></svg>';
  }
})(typeof window !== 'undefined' ? window : globalThis);
