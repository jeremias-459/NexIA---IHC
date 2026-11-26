/*
 * NexIA · Vistas de Espacios compartidos.
 *
 * Rutas:
 *   #/espacios              → hub (tabs: crear | unirse | lista)
 *   #/espacios/creado/:id   → espacio recién creado / detalle del código
 *   #/espacios/quiz/:id     → actividad de preguntas
 *   #/espacios/hecho/:id    → actividad completada
 *   #/espacios/analisis/:id → análisis del grupo
 *
 * Acciones (app.js): spaces-tab, space-pick-file, space-clear-file,
 * space-create, space-lookup, space-join, space-copy-code, space-share,
 * space-examples, space-quiz-select, space-quiz-prev, space-quiz-next,
 * space-quiz-submit.
 */
(function (root) {
  'use strict';

  const NexIA = (root.NexIA = root.NexIA || {});
  const U = NexIA.utils;
  const ui = NexIA.ui;
  const views = (NexIA.views = NexIA.views || {});

  function esc(v) {
    return U.esc(v);
  }

  function tabs(active) {
    const items = [
      { id: 'crear', label: 'Crear espacio' },
      { id: 'unirse', label: 'Unirse' },
      { id: 'lista', label: 'Mis espacios' }
    ];
    return (
      '<div class="spaces-tabs" role="tablist" aria-label="Espacios compartidos">' +
      items
        .map(
          (t) =>
            '<button type="button" role="tab" class="spaces-tab' +
            (t.id === active ? ' is-active' : '') +
            '" data-action="spaces-tab" data-tab="' +
            t.id +
            '" aria-selected="' +
            (t.id === active ? 'true' : 'false') +
            '">' +
            esc(t.label) +
            '</button>'
        )
        .join('') +
      '</div>'
    );
  }

  function header() {
    return (
      '<header class="view-header">' +
      '<p class="view-eyebrow">Aprendizaje colaborativo</p>' +
      '<h1 class="view-title">Espacios compartidos</h1>' +
      '<p class="view-subtitle">Crea experiencias de aprendizaje con IA o participa mediante un código.</p>' +
      '</header>'
    );
  }

  function promoCreate() {
    return (
      '<aside class="spaces-promo-card" aria-label="Cómo funciona">' +
      '<div>' +
      '<h2 class="spaces-promo-card__title">Una idea. Muchas formas de aprender.</h2>' +
      '<p class="spaces-promo-card__text">Sube tu material, genera preguntas y comparte el código con tu grupo.</p>' +
      '</div>' +
      '<div class="spaces-promo-card__illus-box" aria-hidden="true">' +
      '<svg viewBox="0 0 220 150" width="210" height="140"><use href="#illus-student"></use></svg>' +
      '</div>' +
      '<ol class="spaces-promo-steps">' +
      '<li><strong>1</strong><span>Sube tu material</span></li>' +
      '<li><strong>2</strong><span>Genera preguntas con IA</span></li>' +
      '<li><strong>3</strong><span>Aprende y comparte</span></li>' +
      '</ol>' +
      '</aside>'
    );
  }

  function promoJoin() {
    return (
      '<aside class="spaces-promo-card" aria-label="Cómo unirse">' +
      '<div>' +
      '<h2 class="spaces-promo-card__title">El conocimiento crece cuando se comparte.</h2>' +
      '<p class="spaces-promo-card__text">Ingresa el código, encuentra tu espacio y responde a tu ritmo.</p>' +
      '</div>' +
      '<div class="spaces-promo-card__illus-box" aria-hidden="true">' +
      '<svg viewBox="0 0 220 150" width="210" height="140"><use href="#illus-student"></use></svg>' +
      '</div>' +
      '<ol class="spaces-promo-steps">' +
      '<li><strong>1</strong><span>Ingresa el código</span></li>' +
      '<li><strong>2</strong><span>Encuentra tu espacio</span></li>' +
      '<li><strong>3</strong><span>Responde a tu ritmo</span></li>' +
      '</ol>' +
      '</aside>'
    );
  }

  function createPanel(draft) {
    const d = draft || {};
    const qty = Number(d.questionCount) === 10 ? 10 : 5;
    const file = d.file;
    return (
      '<section class="spaces-form-card" aria-labelledby="spaceCreateTitle">' +
      '<h2 class="spaces-card__title" id="spaceCreateTitle">Crear nuevo espacio</h2>' +
      '<p class="spaces-card__sub">Define el tema, adjunta material y elige cuántas preguntas generar.</p>' +
      (d.error ? '<div class="auth-error" role="alert">' + esc(d.error) + '</div>' : '') +
      '<div class="form-group" style="display:flex;flex-direction:column;gap:6px">' +
      '<label class="form-label" for="spaceTopic">Tema de aprendizaje</label>' +
      '<input class="form-input" id="spaceTopic" type="text" maxlength="120" value="' +
      esc(d.title || '') +
      '" placeholder="Ej. Herencia y polimorfismo" autocomplete="off">' +
      '</div>' +
      '<div>' +
      '<p class="form-label">Material de aprendizaje</p>' +
      '<div class="space-dropzone" data-space-dropzone>' +
      '<p class="space-dropzone__title">Arrastra un archivo o selecciónalo</p>' +
      '<p class="space-dropzone__sub">PDF o DOCX · también puedes usar un tema ya analizado</p>' +
      '<p class="space-dropzone__meta">Si no subes archivo, usaremos tu material de ejemplo o el más reciente.</p>' +
      '<button type="button" class="app-btn app-btn--outline app-btn--sm" data-action="space-pick-file">Seleccionar archivo</button>' +
      '<input type="file" id="spaceFileInput" accept=".pdf,.docx,.txt,.md,application/pdf,text/plain" hidden>' +
      (file
        ? '<div class="selected-file-card" style="margin-top:12px;width:100%">' +
          '<span class="icon-box icon-box--purple">' +
          ui.icon('file', 18) +
          '</span>' +
          '<div style="flex:1;min-width:0"><strong>' +
          esc(file.name) +
          '</strong><p class="form-hint">' +
          esc(U.formatBytes ? U.formatBytes(file.size) : '') +
          '</p></div>' +
          '<button type="button" class="icon-btn" data-action="space-clear-file" aria-label="Quitar archivo">' +
          ui.icon('x', 16) +
          '</button></div>'
        : '') +
      '</div></div>' +
      '<div>' +
      '<p class="form-label">Cantidad de preguntas</p>' +
      '<div class="space-qty-grid" role="radiogroup" aria-label="Cantidad de preguntas">' +
      [5, 10]
        .map(
          (n) =>
            '<label class="space-qty-card' +
            (qty === n ? ' is-selected' : '') +
            '"><input type="radio" name="spaceQty" value="' +
            n +
            '"' +
            (qty === n ? ' checked' : '') +
            '> ' +
            n +
            ' preguntas</label>'
        )
        .join('') +
      '</div></div>' +
      '<button type="button" class="app-btn app-btn--primary" data-action="space-create"' +
      (d.busy ? ' disabled' : '') +
      '>' +
      (d.busy ? 'Generando preguntas…' : 'Generar preguntas con IA') +
      '</button>' +
      '</section>'
    );
  }

  function joinPanel(draft) {
    const d = draft || {};
    const found = d.found;
    return (
      '<section class="spaces-form-card" aria-labelledby="spaceJoinTitle">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
      '<span class="icon-box icon-box--purple">' +
      ui.icon('key', 18) +
      '</span>' +
      '<div><h2 class="spaces-card__title" id="spaceJoinTitle">Unirse a un espacio</h2>' +
      '<p class="spaces-card__sub" style="margin:0">Escribe el código que te compartieron.</p></div></div>' +
      (d.error ? '<div class="auth-error" role="alert">' + esc(d.error) + '</div>' : '') +
      '<div class="form-group" style="display:flex;flex-direction:column;gap:6px">' +
      '<label class="form-label" for="spaceJoinCode">Código del espacio</label>' +
      '<input class="form-input" id="spaceJoinCode" type="text" maxlength="12" value="' +
      esc(d.code || '') +
      '" placeholder="NX4821" autocomplete="off" spellcheck="false" style="text-transform:uppercase;letter-spacing:0.08em;font-weight:700">' +
      '</div>' +
      '<button type="button" class="app-btn app-btn--primary" data-action="space-lookup">Continuar</button>' +
      (found
        ? '<div class="space-found-card" style="margin-top:8px">' +
          '<div><p class="view-eyebrow" style="margin:0">Espacio encontrado</p>' +
          '<p class="space-found-card__title">' +
          esc(found.title) +
          '</p>' +
          '<p class="space-found-card__course">' +
          esc(found.subject) +
          '</p>' +
          '<p class="space-found-card__meta">Código ' +
          esc(found.code) +
          ' · ' +
          esc(found.questionCount) +
          ' preguntas</p></div>' +
          '<button type="button" class="app-btn app-btn--primary" data-action="space-join" data-id="' +
          esc(found.id) +
          '">Unirse</button></div>'
        : '') +
      '</section>'
    );
  }

  function avatarStack(space) {
    const members = space.members || [];
    const show = members.slice(0, 3);
    const more = Math.max(0, (space.demoCrowd || members.length) - show.length);
    return (
      '<div class="avatar-stack" aria-label="Participantes">' +
      show
        .map(
          (m, i) =>
            '<span class="avatar-mini ' +
            (i % 2 ? 'avatar-mini--mint' : 'avatar-mini--purple') +
            '" style="background:' +
            esc(m.avatarColor || '#5558F5') +
            ';color:#fff">' +
            esc((m.name || '?').charAt(0).toUpperCase()) +
            '</span>'
        )
        .join('') +
      (more > 0 ? '<span class="avatar-stack__more">+' + more + '</span>' : '') +
      '</div>'
    );
  }

  function listCard(space) {
    const preview =
      space.preview === 'circuit'
        ? '<div class="space-list-card__preview space-list-card__preview--mint">' +
          '<span class="circuit-title">CIRCUITO</span>' +
          '<svg width="72" height="40" viewBox="0 0 72 40" aria-hidden="true"><rect x="4" y="16" width="16" height="8" rx="2" fill="#0F766E"/><line x1="20" y1="20" x2="52" y2="20" stroke="#0F766E" stroke-width="2"/><circle cx="58" cy="20" r="6" fill="none" stroke="#0F766E" stroke-width="2"/></svg>' +
          '<p class="circuit-formula">V = I × R</p></div>'
        : '<div class="space-list-card__preview space-list-card__preview--dark">' +
          '<pre style="margin:0;font-size:0.72rem;line-height:1.45;white-space:pre-wrap">class Animal {\n  hablar() {}\n}\nclass Perro extends Animal {\n  hablar() { return "Guau" }\n}</pre></div>';

    const people = Math.max((space.members || []).length, space.demoCrowd || 1);
    return (
      '<article class="space-list-card">' +
      preview +
      '<div class="space-list-card__body">' +
      ui.chip(space.subject || 'Espacio', 'purple') +
      '<h3 class="space-list-card__title">' +
      esc(space.title) +
      '</h3>' +
      '<p class="space-list-card__desc">' +
      esc(space.description || '') +
      '</p>' +
      '<div class="space-list-card__meta">' +
      '<span>Código <span class="space-code-text">' +
      esc(space.code) +
      '</span></span>' +
      '<span>' +
      people +
      ' participantes</span></div>' +
      '<div class="space-list-card__footer">' +
      avatarStack(space) +
      '<a class="app-btn app-btn--primary app-btn--sm" href="#/espacios/analisis/' +
      esc(space.id) +
      '">Ver análisis</a>' +
      '</div></div></article>'
    );
  }

  function listPanel(state) {
    const spaces = state.mySpaces ? state.mySpaces() : [];
    return (
      '<section aria-labelledby="mySpacesTitle">' +
      '<div class="spaces-list-header">' +
      '<div><h2 class="spaces-card__title" id="mySpacesTitle">Mis espacios</h2>' +
      '<p class="spaces-card__sub" style="margin:0">' +
      (spaces.length
        ? esc(U.plural(spaces.length, 'espacio para seguir aprendiendo en equipo', 'espacios para seguir aprendiendo en equipo'))
        : 'Aún no tienes espacios. Crea uno o únete con un código.') +
      '</p></div>' +
      '<button type="button" class="app-btn app-btn--outline app-btn--sm" data-action="space-examples">Ejemplos</button>' +
      '</div>' +
      (spaces.length
        ? '<div class="spaces-list">' + spaces.map(listCard).join('') + '</div>'
        : '<div class="empty-state"><div class="empty-state__icon">' +
          ui.icon('users', 28) +
          '</div><h2 class="empty-state__title">Todavía no hay espacios</h2>' +
          '<p class="empty-state__text">Crea un espacio con tu material o pulsa «Ejemplos» para cargar demos.</p>' +
          '<button type="button" class="app-btn app-btn--primary" data-action="spaces-tab" data-tab="crear">Crear espacio</button></div>') +
      '<p class="lesson-card__caption" style="margin-top:18px;text-align:center">Cada espacio, una nueva oportunidad para entender mejor.</p>' +
      '</section>'
    );
  }

  views.spacesHub = function spacesHub(state, draft) {
    const tab = (draft && draft.tab) || 'crear';
    let body = '';
    if (tab === 'unirse') {
      body = '<div class="spaces-grid">' + joinPanel(draft) + promoJoin() + '</div>';
    } else if (tab === 'lista') {
      body = listPanel(state);
    } else {
      body = '<div class="spaces-grid">' + createPanel(draft) + promoCreate() + '</div>';
    }
    return header() + tabs(tab) + body;
  };

  views.spaceCreated = function spaceCreated(state, spaceId) {
    const space = state.getSpace(spaceId);
    if (!space) {
      return ui.emptyState({
        icon: 'users',
        title: 'Espacio no encontrado',
        text: 'Puede haberse eliminado o el enlace es incorrecto.',
        action: { href: '#/espacios', label: 'Volver a espacios' }
      });
    }
    return (
      '<header class="view-header">' +
      '<p class="view-eyebrow">Espacios compartidos</p>' +
      '<h1 class="view-title">Espacio creado</h1>' +
      '<p class="view-subtitle">Tu espacio de aprendizaje ya está listo para compartir.</p>' +
      '</header>' +
      '<article class="space-created-card">' +
      '<div class="space-created-card__top">' +
      '<div><p class="view-eyebrow" style="color:rgba(255,255,255,0.85)">' +
      esc(space.subject) +
      '</p>' +
      '<h2 class="space-created-card__title">' +
      esc(space.title) +
      '</h2>' +
      '<p class="space-created-card__date">Creado el ' +
      esc(U.formatLongDate(space.createdAt)) +
      '</p></div>' +
      ui.chip(space.questionCount + ' preguntas', 'white') +
      '</div>' +
      '<div class="space-created-card__bottom">' +
      '<p class="form-label">Código del espacio</p>' +
      '<div class="space-code-row">' +
      '<button type="button" class="space-code-copy" data-action="space-copy-code" data-code="' +
      esc(space.code) +
      '" aria-label="Copiar código">' +
      '<span>' +
      esc(space.code) +
      '</span>' +
      ui.icon('copy', 18) +
      '</button>' +
      '<p class="space-code-row__desc">Comparte este código con los demás para que puedan unirse y responder.</p>' +
      '</div>' +
      '<div class="space-created-actions">' +
      '<div class="space-created-actions__left">' +
      '<a class="app-btn app-btn--outline" href="#/espacios/quiz/' +
      esc(space.id) +
      '">Ver preguntas</a>' +
      '<a class="app-btn app-btn--outline" href="#/espacios/analisis/' +
      esc(space.id) +
      '">Ver participantes</a>' +
      '</div>' +
      '<button type="button" class="app-btn app-btn--primary" data-action="space-share" data-code="' +
      esc(space.code) +
      '" data-title="' +
      esc(space.title) +
      '">' +
      ui.icon('share', 16) +
      ' Compartir código</button>' +
      '</div></div></article>' +
      '<div class="space-created-bottom-grid">' +
      '<section class="chart-card">' +
      '<h3 class="profile-card__title">Un concepto, distintas respuestas</h3>' +
      '<p class="profile-card__sub">Herencia: una misma idea, comportamientos distintos.</p>' +
      '<pre class="code-block" style="margin-top:14px"><code>Animal → hablar()\n  ├─ Perro → "Guau"\n  └─ Gato → "Miau"</code></pre>' +
      '</section>' +
      '<aside class="space-next-card">' +
      '<div class="spaces-promo-card__illus-box" style="background:#fff" aria-hidden="true">' +
      '<svg viewBox="0 0 220 150" width="180" height="120"><use href="#illus-student"></use></svg></div>' +
      '<h3 class="space-next-card__title">El siguiente paso es compartir</h3>' +
      '<p class="space-next-card__text">Tu grupo ya tiene un punto de encuentro. Envía el código y empieza la actividad.</p>' +
      '</aside></div>'
    );
  };

  views.spaceQuiz = function spaceQuiz(state, session) {
    const space = state.getSpace(session && session.spaceId);
    if (!space || !session) {
      return ui.emptyState({
        icon: 'target',
        title: 'No hay actividad activa',
        text: 'Abre un espacio y pulsa «Ver preguntas».',
        action: { href: '#/espacios', label: 'Ir a espacios' }
      });
    }
    const total = space.questions.length;
    const index = U.clamp(session.index || 0, 0, total - 1);
    const q = space.questions[index];
    const pct = U.percent(index + 1, total);
    const selected = session.answers[index] != null ? session.answers[index] : null;
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];

    return (
      '<header class="view-header">' +
      '<p class="view-eyebrow">Espacios compartidos</p>' +
      '<h1 class="view-title">' +
      esc(space.title) +
      '</h1></header>' +
      '<div class="space-progress-row">' +
      '<div class="space-progress-row__meta"><span>Pregunta ' +
      (index + 1) +
      ' de ' +
      total +
      '</span><span>' +
      pct +
      '% completado</span></div>' +
      ui.progressBar(pct) +
      '<p style="align-self:flex-end;font-size:1.6rem;font-weight:700;color:var(--color-primary)">' +
      pct +
      '%</p></div>' +
      '<div class="spaces-grid">' +
      '<section class="spaces-form-card">' +
      '<h2 class="spaces-card__title" style="font-size:1.05rem">' +
      esc(q.stem) +
      '</h2>' +
      '<div class="quiz-options" role="radiogroup" aria-label="Opciones">' +
      (q.options || [])
        .map((opt, i) => {
          const on = selected === i;
          return (
            '<button type="button" class="quiz-option' +
            (on ? ' is-selected' : '') +
            '" data-action="space-quiz-select" data-index="' +
            i +
            '" aria-pressed="' +
            (on ? 'true' : 'false') +
            '"><span class="quiz-option__letter">' +
            letters[i] +
            '</span><span>' +
            esc(opt) +
            '</span></button>'
          );
        })
        .join('') +
      '</div></section>' +
      '<aside class="space-exercise-side">' +
      (q.code
        ? '<pre class="code-block"><code>' + esc(q.code) + '</code></pre>'
        : '<pre class="code-block"><code>// Pista del material\n' +
          esc(U.truncate(q.tip || space.title, 160)) +
          '</code></pre>') +
      '<div class="space-tip-card">' +
      '<p class="space-tip-card__title">Piensa en el comportamiento</p>' +
      '<p class="space-tip-card__text">' +
      esc(q.tip || 'Compara las opciones con la idea clave del concepto.') +
      '</p></div></aside></div>' +
      '<div class="space-exercise-footer" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
      '<button type="button" class="app-btn app-btn--outline" data-action="space-quiz-prev"' +
      (index === 0 ? ' disabled' : '') +
      '>Anterior</button>' +
      (index >= total - 1
        ? '<button type="button" class="app-btn app-btn--primary" data-action="space-quiz-submit">Enviar respuestas</button>'
        : '<button type="button" class="app-btn app-btn--primary" data-action="space-quiz-next">Siguiente</button>') +
      '</div>'
    );
  };

  views.spaceDone = function spaceDone(state, spaceId) {
    const space = state.getSpace(spaceId);
    const user = state.raw.user;
    const member = space && state.memberOf(space, user.id);
    if (!space || !member || !member.completedAt) {
      return ui.emptyState({
        icon: 'check-circle',
        title: 'Aún no has enviado respuestas',
        text: 'Completa la actividad del espacio para ver este resumen.',
        action: { href: '#/espacios', label: 'Volver a espacios' }
      });
    }
    const mins = Math.max(1, Math.round((member.timeSec || 60) / 60));
    return (
      '<p class="view-eyebrow">Espacios compartidos / Actividad completada</p>' +
      '<article class="space-done-card">' +
      '<div class="space-done-card__check" aria-hidden="true">✓</div>' +
      '<h1 class="space-done-card__title">¡Respuestas enviadas correctamente!</h1>' +
      '<p class="space-done-card__sub">Has completado las ' +
      esc(member.total) +
      ' preguntas del espacio</p>' +
      '<p class="space-done-card__topic">' +
      esc(space.title) +
      '</p>' +
      ui.chip(member.total + ' de ' + member.total + ' preguntas completadas', 'mint') +
      '<div class="space-done-stats">' +
      '<div class="stat-card"><p class="stat-card__value">' +
      esc(member.total) +
      '</p><p class="stat-card__label">Preguntas</p></div>' +
      '<div class="stat-card"><p class="stat-card__value">' +
      esc(member.total) +
      '</p><p class="stat-card__label">Respondidas</p></div>' +
      '<div class="stat-card"><p class="stat-card__value">' +
      mins +
      ' min</p><p class="stat-card__label">Tiempo total</p></div>' +
      '</div>' +
      '<div class="space-done-actions">' +
      '<a class="app-btn app-btn--primary" href="#/espacios/analisis/' +
      esc(space.id) +
      '">Ver mis resultados</a>' +
      '<a class="app-btn app-btn--outline" href="#/espacios">Volver a espacios compartidos</a>' +
      '</div></article>'
    );
  };

  views.spaceAnalysis = function spaceAnalysisView(state, spaceId) {
    const space = state.getSpace(spaceId);
    if (!space) {
      return ui.emptyState({
        icon: 'chart',
        title: 'Análisis no disponible',
        text: 'No encontramos este espacio.',
        action: { href: '#/espacios', label: 'Volver' }
      });
    }
    const a = state.spaceAnalysis(space);
    const maxDist = Math.max.apply(
      null,
      a.distribution.map((d) => d.value).concat([1])
    );

    return (
      '<header class="view-header">' +
      '<p class="view-eyebrow">Análisis IA del espacio</p>' +
      '<h1 class="view-title">' +
      esc(space.title) +
      '</h1></header>' +
      '<section class="analysis-hero">' +
      '<div><h2 class="analysis-hero__title">' +
      esc(space.title) +
      '</h2>' +
      '<p class="analysis-hero__meta">Código ' +
      esc(space.code) +
      ' · ' +
      esc(space.questionCount) +
      ' preguntas</p>' +
      '<p class="analysis-hero__date">Creado el ' +
      esc(U.formatLongDate(space.createdAt)) +
      '</p></div>' +
      '<button type="button" class="app-btn app-btn--outline" style="background:#fff" data-action="space-export" data-id="' +
      esc(space.id) +
      '">Exportar reporte</button>' +
      '</section>' +
      '<div class="analysis-kpis">' +
      [
        [a.participants, 'Participantes'],
        [a.accuracy + '%', 'Acierta el grupo'],
        [a.avgCorrect + '/' + space.questionCount, 'Promedio aciertos'],
        [a.avgMin + ' min', 'Tiempo medio']
      ]
        .map(
          (row) =>
            '<div class="stat-card"><p class="stat-card__value">' +
            esc(row[0]) +
            '</p><p class="stat-card__label">' +
            esc(row[1]) +
            '</p></div>'
        )
        .join('') +
      '</div>' +
      '<div class="analysis-mid-grid">' +
      '<section class="chart-card chart-card--flush">' +
      '<h3 class="profile-card__title">Desempeño por tema</h3>' +
      '<div class="topic-bars">' +
      a.bars
        .map(
          (b) =>
            '<div class="topic-bar-item"><div class="topic-bar-item__head"><span>' +
            esc(b.label) +
            '</span><span>' +
            b.pct +
            '%</span></div>' +
            ui.progressBar(b.pct) +
            '</div>'
        )
        .join('') +
      '</div></section>' +
      '<aside class="analysis-rec-card">' +
      '<p class="analysis-rec-card__eyebrow">' +
      ui.icon('sparkle', 16) +
      ' Recomendación de NexIA</p>' +
      '<p class="profile-card__sub">' +
      esc(a.recommendation) +
      '</p>' +
      '<p style="font-weight:700;color:var(--color-primary)">Siguiente práctica sugerida</p>' +
      '<p>«' +
      esc(a.weak.label) +
      '»: dos formas de aplicar el concepto.</p>' +
      '<a class="app-btn app-btn--primary app-btn--sm" href="#/espacios/quiz/' +
      esc(space.id) +
      '">Practicar de nuevo</a>' +
      '</aside></div>' +
      '<div class="analysis-bottom-grid">' +
      '<section class="chart-card chart-card--flush">' +
      '<h3 class="profile-card__title">Preguntas más difíciles</h3>' +
      '<ul class="check-list" style="margin-top:12px">' +
      a.hardQs
        .map(
          (q) =>
            '<li style="align-items:flex-start"><span class="check-circle" style="background:#FEE2E2;color:#B91C1C">' +
            q.pct +
            '%</span><span><strong>' +
            esc(U.truncate(q.stem, 90)) +
            '</strong><br><span class="form-hint">' +
            esc(q.topic) +
            '</span></span></li>'
        )
        .join('') +
      '</ul></section>' +
      '<section class="chart-card chart-card--flush">' +
      '<h3 class="profile-card__title">Distribución del grupo</h3>' +
      '<div style="margin-top:14px;display:flex;flex-direction:column;gap:12px">' +
      a.distribution
        .map(
          (d) =>
            '<div><div class="topic-bar-item__head"><span>' +
            esc(d.label) +
            '</span><span>' +
            d.value +
            '</span></div>' +
            '<span class="progress-track"><span class="progress-fill" style="width:' +
            U.percent(d.value, maxDist) +
            '%;background:' +
            esc(d.color) +
            '"></span></span></div>'
        )
        .join('') +
      '</div></section></div>'
    );
  };
})(typeof window !== 'undefined' ? window : globalThis);
