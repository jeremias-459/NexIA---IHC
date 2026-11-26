/*
 * NexIA · Arranque de la aplicación, enrutador y acciones globales.
 */
(function (root) {
  'use strict';

  const NexIA = root.NexIA;
  const U = NexIA.utils;
  const auth = NexIA.auth;
  const ui = NexIA.ui;
  const state = NexIA.state;
  const course = NexIA.course;
  const ai = NexIA.ai;
  const views = NexIA.views || (NexIA.views = {});

  const main = document.getElementById('contenido-principal');
  const breadcrumb = document.getElementById('breadcrumbCurrent');
  const topbarDate = document.getElementById('topbarDate');
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('appBackdrop');
  const sidebarToggle = document.getElementById('appSidebarToggle');
  const desktopToggle = document.getElementById('desktopSidebarToggle');
  const userMenu = document.getElementById('userMenu');
  const userMenuButton = document.getElementById('userMenuButton');
  const userMenuButtonMobile = document.getElementById('userMenuButtonMobile');

  const sessionUi = {
    route: { name: 'inicio', params: {} },
    explore: { file: null, text: '', error: '', analyzing: false, progress: null },
    libraryQuery: '',
    libraryFilter: 'todos',
    lessonTab: 'lectura',
    quiz: null,
    review: null,
    calendar: { year: new Date().getFullYear(), month: new Date().getMonth() },
    savedFilter: 'todos',
    savedQuery: '',
    progressDays: 30,
    tts: { speaking: false, rate: 1, index: 0, sentences: [] },
    slideIndex: 0,
    tutorBusy: false,
    lastSelection: '',
    spaces: {
      tab: 'crear',
      title: '',
      questionCount: 10,
      file: null,
      error: '',
      busy: false,
      code: '',
      found: null
    },
    spaceQuiz: null
  };
  NexIA.appSession = sessionUi;

  const GROUP_TITLES = {
    inicio: 'Inicio',
    temas: 'Mis temas',
    repaso: 'Repaso',
    guardados: 'Mis guardados',
    progreso: 'Mi progreso',
    espacios: 'Espacios compartidos',
    perfil: 'Perfil'
  };

  function parseHash() {
    const raw = (location.hash || '#/inicio').replace(/^#/, '');
    const parts = raw.split('/').filter(Boolean).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch (err) {
        return p;
      }
    });
    const name = parts[0] || 'inicio';
    const params = {};
    // Formatos ricos: /leccion/:id/t/:ti/c/:ci  ·  /practica/:id/t/:ti  ·  /documento/:id
    // También se acepta el formato corto /leccion/:id/:ti/:ci
    if (name === 'leccion' || name === 'practica' || name === 'autoevaluacion' || name === 'sesion') {
      params.id = parts[1];
      for (let i = 2; i < parts.length; i++) {
        if (parts[i] === 't' && parts[i + 1] != null) {
          params.ti = Number(parts[++i]);
        } else if (parts[i] === 'c' && parts[i + 1] != null) {
          params.ci = Number(parts[++i]);
        } else if (params.ti == null && /^\d+$/.test(parts[i])) {
          params.ti = Number(parts[i]);
        } else if (params.ci == null && /^\d+$/.test(parts[i])) {
          params.ci = Number(parts[i]);
        } else if (!params.conceptId && parts[i] !== 't' && parts[i] !== 'c') {
          params.conceptId = parts[i];
        }
      }
    } else if (name === 'documento' || name === 'resultados') {
      params.id = parts[1];
    } else if (name === 'espacios') {
      params.view = parts[1] || 'hub';
      params.id = parts[2];
    }
    return { name, parts, params };
  }

  function navigate(hash) {
    if (hash.charAt(0) !== '#') hash = '#' + hash;
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function setTheme(theme) {
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    document.querySelectorAll('[data-theme-label]').forEach((el) => {
      el.textContent = theme === 'dark' ? 'Desactivar modo oscuro' : 'Activar modo oscuro';
    });
  }

  function refreshChrome() {
    const user = state.raw.user;
    if (!user) return;
    if (topbarDate) topbarDate.textContent = U.formatLongDate(new Date());
    document.querySelectorAll('[data-user-name]').forEach((el) => {
      el.textContent = user.name;
    });
    document.querySelectorAll('[data-user-email]').forEach((el) => {
      el.textContent = user.email;
    });
    document.querySelectorAll('[data-user-avatar]').forEach((el) => {
      el.textContent = auth.initials(user.name);
      el.style.setProperty('--avatar-color', user.avatarColor || '#5558F5');
    });
    setTheme((user.prefs && user.prefs.theme) || 'light');
    const due = state.dueReviews().length;
    document.querySelectorAll('[data-review-badge]').forEach((el) => {
      if (due > 0) {
        el.hidden = false;
        el.textContent = String(due);
      } else el.hidden = true;
    });
    const promoTitle = document.querySelector('[data-promo-title]');
    const promoText = document.querySelector('[data-promo-text]');
    if (promoTitle && promoText) {
      if (due > 0) {
        promoTitle.textContent = 'Tienes repasos pendientes';
        promoText.textContent = U.plural(due, 'concepto espera', 'conceptos esperan') + ' para reforzar hoy.';
      } else {
        promoTitle.textContent = 'Mejor, en equipo';
        promoText.textContent = 'Comparte lo que sabes. Descubre lo que puedes.';
      }
    }
  }

  function setActiveNav(group) {
    document.querySelectorAll('[data-nav-group]').forEach((el) => {
      el.classList.toggle('is-active', el.getAttribute('data-nav-group') === group);
    });
  }

  function closeSidebar() {
    if (!sidebar) return;
    sidebar.classList.remove('is-open');
    if (backdrop) backdrop.hidden = true;
    if (sidebarToggle) sidebarToggle.setAttribute('aria-expanded', 'false');
  }

  function openSidebar() {
    sidebar.classList.add('is-open');
    if (backdrop) backdrop.hidden = false;
    if (sidebarToggle) sidebarToggle.setAttribute('aria-expanded', 'true');
  }

  function closeUserMenu() {
    if (!userMenu) return;
    userMenu.hidden = true;
    [userMenuButton, userMenuButtonMobile].forEach((btn) => btn && btn.setAttribute('aria-expanded', 'false'));
  }

  function toggleUserMenu() {
    if (!userMenu) return;
    const open = userMenu.hidden;
    userMenu.hidden = !open;
    [userMenuButton, userMenuButtonMobile].forEach((btn) => btn && btn.setAttribute('aria-expanded', String(open)));
  }

  /** Acceso a perfil desde la esquina superior derecha (ya no está en el menú lateral). */
  function goToProfileFromMenu(event) {
    if (event) event.preventDefault();
    closeUserMenu();
    navigate('#/perfil');
  }

  function stopTts() {
    if (root.speechSynthesis) root.speechSynthesis.cancel();
    sessionUi.tts.speaking = false;
  }

  function render() {
    if (!state.raw.ready || !main) return;
    stopTts();
    const route = parseHash();
    sessionUi.route = route;
    refreshChrome();

    let html = '';
    let group = 'inicio';
    let title = 'Inicio';

    try {
      switch (route.name) {
        case 'inicio':
          html = views.home(state);
          break;
        case 'explorar':
          html = views.explore(state, sessionUi.explore);
          group = 'inicio';
          title = 'Explorar un tema';
          break;
        case 'documento': {
          const material = state.getMaterial(route.params.id);
          if (!material) {
            navigate('#/temas');
            return;
          }
          html = views.document(state, material.id);
          group = 'inicio';
          title = 'Documento listo';
          break;
        }
        case 'temas':
          html = views.library(state, { q: sessionUi.libraryQuery, filter: sessionUi.libraryFilter });
          group = 'temas';
          title = 'Mis temas';
          break;
        case 'leccion': {
          const mid = route.params.id;
          const ti = Number(route.params.ti || 0);
          const ci = Number(route.params.ci || 0);
          const material = state.getMaterial(mid);
          if (!material) {
            navigate('#/temas');
            return;
          }
          html = views.lesson(state, mid, ti, ci, sessionUi.lessonTab);
          group = 'temas';
          title = material.title;
          break;
        }
        case 'practica':
        case 'autoevaluacion': {
          ensureQuiz(route.params.id, Number(route.params.ti || 0));
          html = views.quiz(state, sessionUi.quiz);
          group = 'temas';
          title = 'Autoevaluación';
          break;
        }
        case 'resultados':
          html = views.results(state, route.params.id);
          group = 'temas';
          title = 'Resultados';
          break;
        case 'repaso':
          html = views.reviewHome(state);
          group = 'repaso';
          title = 'Repaso';
          break;
        case 'calendario':
          html = views.calendar(state, sessionUi.calendar.year, sessionUi.calendar.month);
          group = 'repaso';
          title = 'Calendario';
          break;
        case 'sesion':
          ensureReviewSession(route.params.id, route.params.conceptId);
          html = views.reviewSession(state, sessionUi.review);
          group = 'repaso';
          title = 'Sesión de repaso';
          break;
        case 'guardados':
          html = views.saved(state, sessionUi.savedFilter, sessionUi.savedQuery);
          group = 'guardados';
          title = 'Mis guardados';
          break;
        case 'progreso':
          html = views.progress(state, sessionUi.progressDays);
          group = 'progreso';
          title = 'Mi progreso';
          break;
        case 'perfil':
          html = views.profile(state);
          group = 'perfil';
          title = 'Perfil';
          break;
        case 'espacios': {
          group = 'espacios';
          const view = route.params.view || 'hub';
          if (view === 'creado' && route.params.id) {
            html = views.spaceCreated(state, route.params.id);
            title = 'Espacio creado';
          } else if (view === 'quiz' && route.params.id) {
            ensureSpaceQuiz(route.params.id);
            html = views.spaceQuiz(state, sessionUi.spaceQuiz);
            title = 'Actividad';
          } else if (view === 'hecho' && route.params.id) {
            html = views.spaceDone(state, route.params.id);
            title = 'Actividad completada';
          } else if (view === 'analisis' && route.params.id) {
            html = views.spaceAnalysis(state, route.params.id);
            title = 'Análisis del espacio';
          } else {
            html = views.spacesHub(state, sessionUi.spaces);
            title = 'Espacios compartidos';
          }
          break;
        }
        default:
          navigate('#/inicio');
          return;
      }
    } catch (err) {
      console.error(err);
      html =
        '<div class="empty-state"><h2 class="empty-state__title">Algo salió mal</h2><p class="empty-state__text">' +
        U.esc(err.message || 'Error inesperado') +
        '</p><a class="app-btn app-btn--primary" href="#/inicio">Volver al inicio</a></div>';
    }

    const breadcrumbRoot = document.querySelector('.app-breadcrumb__root');
    if (breadcrumbRoot) breadcrumbRoot.textContent = group === 'espacios' ? 'Campus' : 'Mi espacio';
    if (breadcrumb) breadcrumb.textContent = title || GROUP_TITLES[group] || 'Mi espacio';
    setActiveNav(group);
    main.innerHTML = html;
    main.focus({ preventScroll: true });
    bindView();
    closeSidebar();
    closeUserMenu();
  }

  function ensureQuiz(materialId, topicIndex) {
    const material = state.getMaterial(materialId);
    if (!material) return;
    if (
      sessionUi.quiz &&
      sessionUi.quiz.materialId === materialId &&
      sessionUi.quiz.topicIndex === topicIndex &&
      !sessionUi.quiz.done
    ) {
      return;
    }
    const questions = course.pickQuestions(material, { topicIndex, count: 5 });
    sessionUi.quiz = {
      materialId,
      topicIndex,
      questions,
      index: 0,
      selected: null,
      checked: false,
      answers: [],
      done: false
    };
  }

  function ensureSpaceQuiz(spaceId) {
    const space = state.getSpace(spaceId);
    if (!space) {
      sessionUi.spaceQuiz = null;
      return;
    }
    if (
      sessionUi.spaceQuiz &&
      sessionUi.spaceQuiz.spaceId === spaceId &&
      !sessionUi.spaceQuiz.done
    ) {
      return;
    }
    sessionUi.spaceQuiz = {
      spaceId,
      index: 0,
      answers: {},
      startedAt: Date.now(),
      done: false
    };
  }

  function ensureReviewSession(materialId, conceptId) {
    // Conserva la sesión en curso y el resumen final; solo se recrea si piden otro concepto.
    const current = sessionUi.review;
    if (current && (current.active || current.step === 'done')) {
      const sameMaterial = !materialId || current.materialId === materialId;
      const sameConcept =
        !conceptId || (Array.isArray(current.conceptIds) && current.conceptIds.indexOf(conceptId) >= 0);
      if (sameMaterial && sameConcept) return;
    }
    const weak = state.weakConcepts(8);
    let conceptIds = [];
    let mid = materialId;
    if (materialId && conceptId) {
      conceptIds = [conceptId];
      mid = materialId;
    } else if (weak.length) {
      mid = weak[0].materialId;
      conceptIds = weak.filter((w) => w.materialId === mid).slice(0, 3).map((w) => w.conceptId);
    } else {
      const material = state.raw.materials[0];
      if (!material) {
        sessionUi.review = { empty: true };
        return;
      }
      mid = material.id;
      conceptIds = material.topics[0].concepts.slice(0, 2).map((c) => c.id);
    }
    const material = state.getMaterial(mid);
    const questions = course.pickQuestions(material, { conceptIds, count: 3 });
    const cards = course.pickCards(material, conceptIds, 4);
    const topic = material.topics.find((t) => t.concepts.some((c) => conceptIds.indexOf(c.id) >= 0));
    sessionUi.review = {
      active: true,
      empty: false,
      step: 'quiz',
      materialId: mid,
      conceptIds,
      questions,
      qIndex: 0,
      qSelected: null,
      qChecked: false,
      cards,
      cardIndex: 0,
      flipped: false,
      open: topic ? topic.open : { prompt: 'Explica la idea central.', terms: [], reference: [] },
      openResult: null,
      score: 0,
      total: questions.length + cards.length + 1,
      answers: []
    };
  }

  function bindView() {
    ui.bindActions(main, {
      analyze: () => analyzeCurrent(),
      'analyze-file': () => analyzeCurrent(),
      'pick-file': () => {
        const input = main.querySelector('#fileInput, #fileUploadInput');
        if (input) input.click();
      },
      'use-sample': async () => {
        try {
          sessionUi.explore.analyzing = true;
          render();
          const material = await state.importSample();
          sessionUi.explore = { file: null, text: '', error: '', analyzing: false, progress: null };
          navigate('#/documento/' + material.id);
          ui.toast('Material de ejemplo listo.', 'success');
        } catch (err) {
          sessionUi.explore.analyzing = false;
          sessionUi.explore.error = err.message;
          render();
        }
      },
      'clear-file': () => {
        sessionUi.explore.file = null;
        sessionUi.explore.error = '';
        render();
      },
      'delete-material': async (btn) => {
        const id = btn.getAttribute('data-id');
        const ok = await ui.confirmDialog({
          title: 'Eliminar material',
          text: 'Se borrarán también sus evaluaciones y guardados. Esta acción no se puede deshacer.',
          confirm: 'Eliminar',
          danger: true
        });
        if (!ok) return;
        await state.deleteMaterial(id);
        ui.toast('Material eliminado.');
        render();
      },
      'lesson-tab': (btn) => {
        const tab = btn.getAttribute('data-tab') || 'lectura';
        sessionUi.lessonTab = tab;
        sessionUi.slideIndex = 0;
        // Las tres pestañas ya están en el DOM: solo se cambia is-active.
        const root = main.querySelector('.lesson-main') || main;
        root.querySelectorAll('.segmented-tab').forEach((el) => {
          const on = el.getAttribute('data-tab') === tab;
          el.classList.toggle('is-active', on);
          el.setAttribute('aria-selected', String(on));
        });
        root.querySelectorAll('.lesson-panel').forEach((panel) => {
          panel.classList.toggle('is-active', panel.getAttribute('data-panel') === tab);
        });
        if (tab !== 'audio') stopTts();
      },
      'mark-done': async (btn) => {
        const mid = btn.getAttribute('data-material') || btn.getAttribute('data-mid');
        const ti = Number(btn.getAttribute('data-ti'));
        const ci = Number(btn.getAttribute('data-ci'));
        await state.markConceptDone(mid, ti, ci);
        ui.toast('Concepto marcado como visto.', 'success');
        render();
      },
      'toggle-favorite': async (btn) => {
        const mid = btn.getAttribute('data-material') || btn.getAttribute('data-mid');
        const conceptId = btn.getAttribute('data-concept');
        const material = state.getMaterial(mid);
        const found = course.findConcept(material, conceptId);
        if (!found) return;
        if (state.isConceptSaved(mid, conceptId)) {
          const item = state.raw.saved.find((s) => s.materialId === mid && s.conceptId === conceptId && s.type === 'conceptos');
          if (item) await state.removeSaved(item.id);
          ui.toast('Quitado de guardados.');
        } else {
          await state.saveItem({
            type: 'conceptos',
            materialId: mid,
            conceptId,
            title: found.concept.title,
            course: material.title,
            preview: found.concept.lead
          });
          ui.toast('Concepto guardado.', 'success');
        }
        render();
      },
      'add-highlight': async (btn, event) => {
        // El clic en el botón suele vaciar la selección; usamos la última capturada.
        if (event && event.type === 'mousedown') event.preventDefault();
        const mid = btn.getAttribute('data-material') || btn.getAttribute('data-mid');
        const conceptId = btn.getAttribute('data-concept');
        const material = state.getMaterial(mid);
        if (!material) return;
        const live = String((root.getSelection && root.getSelection().toString()) || '').trim();
        const selection = live || sessionUi.lastSelection || '';
        if (!selection || selection.length < 3) {
          ui.toast('Selecciona un fragmento del texto de la lección y vuelve a pulsar.', 'error');
          return;
        }
        material.highlights = Array.isArray(material.highlights) ? material.highlights : [];
        const already = material.highlights.some(
          (h) => h && h.conceptId === conceptId && h.text === U.truncate(selection, 280)
        );
        if (already) {
          ui.toast('Ese fragmento ya está subrayado.');
          return;
        }
        material.highlights.push({
          id: U.uid('hl'),
          conceptId,
          text: U.truncate(selection, 280),
          at: Date.now()
        });
        await state.saveMaterial(material);
        await state.saveItem({
          type: 'fragmentos',
          materialId: mid,
          conceptId,
          title: U.truncate(selection, 60),
          course: material.title,
          preview: selection
        });
        sessionUi.lastSelection = '';
        ui.toast('Fragmento subrayado y guardado.', 'success');
        render();
      },
      'send-chat': () => sendTutor(),
      'tutor-submit': () => sendTutor(),
      'suggest-chat': (btn) => suggestAndSend(btn),
      'tutor-suggest': (btn) => suggestAndSend(btn),
      'tutor-clear': async (btn) => {
        const mid = btn.getAttribute('data-material');
        const material = state.getMaterial(mid);
        if (!material) return;
        material.chat = [];
        material.chatSession = {};
        await state.saveMaterial(material);
        render();
      },
      'library-filter': (btn) => {
        sessionUi.libraryFilter = btn.getAttribute('data-filter') || 'todos';
        render();
      },
      'quiz-select': (btn) => {
        if (!sessionUi.quiz || sessionUi.quiz.checked) return;
        sessionUi.quiz.selected = Number(btn.getAttribute('data-index'));
        render();
      },
      'quiz-check': () => gradeQuiz(),
      'quiz-next': () => advanceQuiz(false),
      'quiz-finish': () => advanceQuiz(true),
      'quiz-exit': () => navigate('#/temas'),
      'retry-quiz': (btn) => {
        sessionUi.quiz = null;
        navigate('#/practica/' + btn.getAttribute('data-material') + '/t/' + (btn.getAttribute('data-ti') || 0));
      },
      'start-quiz': (btn) => {
        sessionUi.quiz = null;
        navigate('#/practica/' + btn.getAttribute('data-material') + '/t/' + (btn.getAttribute('data-ti') || 0));
      },
      'tts-play': () => startTts(),
      'tts-pause': () => {
        if (root.speechSynthesis) root.speechSynthesis.pause();
        sessionUi.tts.speaking = false;
        render();
      },
      'tts-stop': () => {
        stopTts();
        sessionUi.tts.index = 0;
        render();
      },
      'tts-speed': (btn) => {
        const current = sessionUi.tts.rate || 1;
        const explicit = btn.getAttribute('data-rate') || btn.getAttribute('data-speed');
        sessionUi.tts.rate = explicit ? Number(explicit) : current >= 1.2 ? 0.9 : Number((current + 0.15).toFixed(2));
        ui.toast('Velocidad: ' + sessionUi.tts.rate + '×');
        render();
      },
      'slide-prev': () => {
        sessionUi.slideIndex = Math.max(0, sessionUi.slideIndex - 1);
        render();
      },
      'slide-next': () => {
        sessionUi.slideIndex += 1;
        render();
      },
      'cal-prev': (btn) => {
        const y = btn.getAttribute('data-year');
        const m = btn.getAttribute('data-month');
        if (y != null && m != null && y !== '' && m !== '') {
          sessionUi.calendar.year = Number(y);
          sessionUi.calendar.month = Number(m);
        } else {
          sessionUi.calendar.month -= 1;
          if (sessionUi.calendar.month < 0) {
            sessionUi.calendar.month = 11;
            sessionUi.calendar.year -= 1;
          }
        }
        render();
      },
      'cal-next': (btn) => {
        const y = btn.getAttribute('data-year');
        const m = btn.getAttribute('data-month');
        if (y != null && m != null && y !== '' && m !== '') {
          sessionUi.calendar.year = Number(y);
          sessionUi.calendar.month = Number(m);
        } else {
          sessionUi.calendar.month += 1;
          if (sessionUi.calendar.month > 11) {
            sessionUi.calendar.month = 0;
            sessionUi.calendar.year += 1;
          }
        }
        render();
      },
      'start-review': () => {
        sessionUi.review = null;
        navigate('#/sesion');
      },
      'review-select': (btn) => {
        if (!sessionUi.review || sessionUi.review.qChecked) return;
        sessionUi.review.qSelected = Number(btn.getAttribute('data-index'));
        render();
      },
      'review-check': () => {
        const rev = sessionUi.review;
        if (!rev || rev.qSelected == null) return;
        const q = rev.questions[rev.qIndex];
        const correct = rev.qSelected === q.answer;
        rev.qChecked = true;
        if (correct) rev.score += 1;
        rev.answers.push({ conceptId: q.conceptId, correct, skill: q.skill });
        render();
      },
      'review-next-q': () => {
        const rev = sessionUi.review;
        if (!rev) return;
        if (rev.qIndex >= rev.questions.length - 1) {
          rev.step = 'cards';
          rev.cardIndex = 0;
          rev.flipped = false;
        } else {
          rev.qIndex += 1;
          rev.qSelected = null;
          rev.qChecked = false;
        }
        render();
      },
      'card-flip': () => {
        if (sessionUi.review) sessionUi.review.flipped = !sessionUi.review.flipped;
        render();
      },
      'card-know': async () => advanceCard(true),
      'card-again': async () => advanceCard(false),
      'open-submit': async () => {
        const rev = sessionUi.review;
        const area = main.querySelector('#openAnswer');
        if (!rev || !area) return;
        rev.openResult = course.evaluateOpenAnswer(area.value, rev.open);
        if (rev.openResult.score >= 55) rev.score += 1;
        rev.step = 'done';
        const correct = rev.score;
        await state.saveAttempt({
          kind: 'review',
          materialId: rev.materialId,
          answers: rev.answers,
          correct,
          total: rev.total,
          score: U.percent(correct, rev.total)
        });
        for (const id of rev.conceptIds) {
          const found = course.findConcept(state.getMaterial(rev.materialId), id);
          if (!found) continue;
          await state.scheduleReview({
            materialId: rev.materialId,
            conceptId: id,
            topicTitle: found.topic.title,
            conceptTitle: found.concept.title,
            success: true
          });
        }
        // Mantener active/step='done' para mostrar el resumen; start-review limpia la sesión.
        rev.active = true;
        render();
      },
      'remove-saved': async (btn) => {
        await state.removeSaved(btn.getAttribute('data-id'));
        ui.toast('Eliminado de guardados.');
        render();
      },
      'period': (btn) => {
        sessionUi.progressDays = Number(btn.getAttribute('data-days') || 30);
        render();
      },
      'save-profile': async () => {
        const name = main.querySelector('#profileName');
        const study = main.querySelector('input[name="studyPref"]:checked');
        const from = main.querySelector('#scheduleFrom');
        const to = main.querySelector('#scheduleTo');
        const reminders = main.querySelector('#prefReminders');
        const quiet = main.querySelector('#prefQuiet');
        try {
          await auth.updateProfile(state.raw.user, {
            name: name.value,
            prefs: {
              studyMode: study ? study.value : 'lectura',
              scheduleFrom: from.value,
              scheduleTo: to.value,
              reminders: reminders.checked,
              quietHours: quiet.checked,
              theme: (state.raw.user.prefs && state.raw.user.prefs.theme) || 'light'
            }
          });
          state.raw.user = await auth.currentUser();
          ui.toast('Perfil actualizado.', 'success');
          refreshChrome();
          render();
        } catch (err) {
          ui.toast(err.message, 'error');
        }
      },
      'pick-avatar': async (btn) => {
        await auth.updateProfile(state.raw.user, { avatarColor: btn.getAttribute('data-color') });
        state.raw.user = await auth.currentUser();
        refreshChrome();
        render();
      },
      'toggle-theme': async () => {
        const current = (state.raw.user.prefs && state.raw.user.prefs.theme) || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        await auth.updateProfile(state.raw.user, { prefs: { theme: next } });
        state.raw.user = await auth.currentUser();
        setTheme(next);
        const session = auth.session();
        if (session) {
          try {
            localStorage.setItem('nexia:session', JSON.stringify(Object.assign({}, session, { theme: next })));
          } catch (err) { /* ignore */ }
        }
        render();
      },
      'save-ai': () => {
        const enabled = main.querySelector('#aiEnabled');
        const provider = main.querySelector('#aiProvider');
        const baseUrl = main.querySelector('#aiBaseUrl');
        const model = main.querySelector('#aiModel');
        const apiKey = main.querySelector('#aiApiKey');
        const preset = ai.PRESETS[provider.value] || ai.PRESETS.custom;
        ai.saveConfig({
          enabled: enabled.checked,
          provider: provider.value,
          baseUrl: baseUrl.value.trim() || preset.baseUrl,
          model: model.value.trim() || preset.model,
          apiKey: apiKey.value.trim() || ai.readConfig().apiKey
        });
        ui.toast(enabled.checked ? 'IA guardada. El tutor la usará cuando sea posible.' : 'IA desactivada. Se usará el tutor local.');
        render();
      },
      'test-ai': async () => {
        try {
          ui.toast('Probando conexión…');
          await ai.testConnection();
          ui.toast('Conexión correcta con el proveedor.', 'success');
        } catch (err) {
          ui.toast(err.message || 'No se pudo conectar.', 'error');
        }
      },
      'clear-ai': () => {
        ai.clearKey();
        ui.toast('Clave eliminada de este navegador.');
        render();
      },
      'change-password': async () => {
        const current = main.querySelector('#currentPassword');
        const next = main.querySelector('#nextPassword');
        const confirm = main.querySelector('#confirmPassword');
        if (next && confirm && next.value !== confirm.value) {
          ui.toast('La confirmación no coincide con la nueva contraseña.', 'error');
          return;
        }
        try {
          await auth.changePassword(state.raw.user, current.value, next.value);
          if (current) current.value = '';
          if (next) next.value = '';
          if (confirm) confirm.value = '';
          ui.toast('Contraseña actualizada.', 'success');
        } catch (err) {
          ui.toast(err.message, 'error');
        }
      },
      logout: async () => {
        const ok = await ui.confirmDialog({ title: 'Cerrar sesión', text: '¿Quieres salir de NexIA?', confirm: 'Salir' });
        if (!ok) return;
        auth.logout();
        location.href = 'login.html';
      },
      'delete-account': async () => {
        const ok = await ui.confirmDialog({
          title: 'Eliminar cuenta',
          text: 'Se borrarán tu cuenta y todos tus materiales en este dispositivo.',
          confirm: 'Eliminar todo',
          danger: true
        });
        if (!ok) return;
        await auth.deleteAccount(state.raw.user);
        location.href = 'login.html';
      },
      'spaces-tab': (btn) => {
        sessionUi.spaces.tab = btn.getAttribute('data-tab') || 'crear';
        sessionUi.spaces.error = '';
        sessionUi.spaces.found = null;
        render();
      },
      'space-pick-file': () => {
        const input = main.querySelector('#spaceFileInput');
        if (input) input.click();
      },
      'space-clear-file': () => {
        sessionUi.spaces.file = null;
        sessionUi.spaces.error = '';
        render();
      },
      'space-create': async () => {
        const topic = main.querySelector('#spaceTopic');
        const qty = main.querySelector('input[name="spaceQty"]:checked');
        sessionUi.spaces.title = topic ? topic.value.trim() : '';
        sessionUi.spaces.questionCount = qty ? Number(qty.value) : 10;
        sessionUi.spaces.busy = true;
        sessionUi.spaces.error = '';
        render();
        try {
          const space = await state.createSpace({
            title: sessionUi.spaces.title,
            questionCount: sessionUi.spaces.questionCount,
            file: sessionUi.spaces.file
          });
          sessionUi.spaces = {
            tab: 'lista',
            title: '',
            questionCount: 10,
            file: null,
            error: '',
            busy: false,
            code: '',
            found: null
          };
          navigate('#/espacios/creado/' + space.id);
          ui.toast('Espacio creado. Comparte el código con tu grupo.', 'success');
        } catch (err) {
          sessionUi.spaces.busy = false;
          sessionUi.spaces.error = err.message || 'No se pudo crear el espacio.';
          render();
        }
      },
      'space-lookup': () => {
        const input = main.querySelector('#spaceJoinCode');
        const code = input ? input.value : sessionUi.spaces.code;
        sessionUi.spaces.code = code;
        sessionUi.spaces.error = '';
        const found = state.findSpaceByCode(code);
        if (!found) {
          sessionUi.spaces.found = null;
          sessionUi.spaces.error = 'No hay un espacio con ese código en este navegador.';
        } else {
          sessionUi.spaces.found = found;
        }
        render();
      },
      'space-join': async (btn) => {
        try {
          const id = btn.getAttribute('data-id');
          const space = state.getSpace(id) || state.findSpaceByCode(sessionUi.spaces.code);
          if (!space) throw new Error('Espacio no encontrado.');
          await state.joinSpace(space.code);
          sessionUi.spaces.tab = 'lista';
          sessionUi.spaces.found = null;
          navigate('#/espacios/quiz/' + space.id);
          ui.toast('Te uniste al espacio. ¡A responder!', 'success');
        } catch (err) {
          sessionUi.spaces.error = err.message;
          render();
        }
      },
      'space-examples': async () => {
        try {
          await state.seedExampleSpaces();
          sessionUi.spaces.tab = 'lista';
          ui.toast('Ejemplos listos en Mis espacios.', 'success');
          render();
        } catch (err) {
          ui.toast(err.message || 'No se pudieron cargar los ejemplos.', 'error');
        }
      },
      'space-copy-code': async (btn) => {
        const code = btn.getAttribute('data-code') || '';
        try {
          if (root.navigator && root.navigator.clipboard) await root.navigator.clipboard.writeText(code);
          else {
            const ta = document.createElement('textarea');
            ta.value = code;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
          }
          ui.toast('Código copiado: ' + code, 'success');
        } catch (err) {
          ui.toast('Código: ' + code);
        }
      },
      'space-share': async (btn) => {
        const code = btn.getAttribute('data-code') || '';
        const title = btn.getAttribute('data-title') || 'Espacio NexIA';
        const text = 'Únete a «' + title + '» en NexIA con el código ' + code;
        try {
          if (root.navigator && root.navigator.share) {
            await root.navigator.share({ title: 'NexIA', text: text });
          } else if (root.navigator && root.navigator.clipboard) {
            await root.navigator.clipboard.writeText(text);
            ui.toast('Texto para compartir copiado.', 'success');
          } else {
            ui.toast(text);
          }
        } catch (err) {
          if (err && err.name !== 'AbortError') ui.toast('Código: ' + code);
        }
      },
      'space-export': (btn) => {
        const space = state.getSpace(btn.getAttribute('data-id'));
        if (!space) return;
        const analysis = state.spaceAnalysis(space);
        const lines = [
          'NexIA · Reporte de espacio',
          space.title,
          'Código: ' + space.code,
          'Participantes: ' + analysis.participants,
          'Acierta el grupo: ' + analysis.accuracy + '%',
          'Recomendación: ' + analysis.recommendation
        ];
        const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'nexia-' + space.code + '.txt';
        a.click();
        URL.revokeObjectURL(url);
        ui.toast('Reporte descargado.', 'success');
      },
      'space-quiz-select': (btn) => {
        const quiz = sessionUi.spaceQuiz;
        if (!quiz) return;
        quiz.answers[quiz.index] = Number(btn.getAttribute('data-index'));
        render();
      },
      'space-quiz-prev': () => {
        const quiz = sessionUi.spaceQuiz;
        if (!quiz || quiz.index <= 0) return;
        quiz.index -= 1;
        render();
      },
      'space-quiz-next': () => {
        const quiz = sessionUi.spaceQuiz;
        if (!quiz) return;
        if (quiz.answers[quiz.index] == null) {
          ui.toast('Elige una opción antes de continuar.', 'error');
          return;
        }
        quiz.index += 1;
        render();
      },
      'space-quiz-submit': async () => {
        const quiz = sessionUi.spaceQuiz;
        if (!quiz) return;
        const space = state.getSpace(quiz.spaceId);
        if (!space) return;
        const missing = space.questions.some((_, i) => quiz.answers[i] == null);
        if (missing) {
          ui.toast('Responde todas las preguntas antes de enviar.', 'error');
          return;
        }
        const answers = space.questions.map((_, i) => ({ index: i, selected: quiz.answers[i] }));
        const timeSec = Math.round((Date.now() - quiz.startedAt) / 1000);
        await state.submitSpaceAttempt(space.id, { answers, timeSec });
        quiz.done = true;
        navigate('#/espacios/hecho/' + space.id);
        ui.toast('Respuestas enviadas.', 'success');
      }
    });

    // Inputs no cubiertos por data-action
    const fileInput = main.querySelector('#fileInput, #fileUploadInput');
    const dropzone = main.querySelector('[data-dropzone], #uploadDropzone');
    const pasteArea = main.querySelector('#pasteText');
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const issue = NexIA.extract.validateFile(file);
        sessionUi.explore.file = issue ? null : file;
        sessionUi.explore.error = issue || '';
        render();
      });
    }
    if (dropzone) {
      ['dragenter', 'dragover'].forEach((ev) =>
        dropzone.addEventListener(ev, (e) => {
          e.preventDefault();
          dropzone.classList.add('is-dragover');
        })
      );
      ['dragleave', 'drop'].forEach((ev) =>
        dropzone.addEventListener(ev, (e) => {
          e.preventDefault();
          dropzone.classList.remove('is-dragover');
        })
      );
      dropzone.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (!file) return;
        const issue = NexIA.extract.validateFile(file);
        sessionUi.explore.file = issue ? null : file;
        sessionUi.explore.error = issue || '';
        render();
      });
    }
    if (pasteArea) {
      pasteArea.addEventListener('input', () => {
        sessionUi.explore.text = pasteArea.value;
        const counter = main.querySelector('[data-role="paste-count"]');
        if (counter) counter.textContent = U.plural(U.countWords(pasteArea.value), 'palabra', 'palabras');
      });
    }

    const librarySearch = main.querySelector('#librarySearch');
    if (librarySearch) {
      librarySearch.addEventListener(
        'input',
        U.debounce(() => {
          sessionUi.libraryQuery = librarySearch.value;
          render();
        }, 180)
      );
    }

    const savedSearch = main.querySelector('#savedSearch');
    if (savedSearch) {
      savedSearch.value = sessionUi.savedQuery;
      savedSearch.addEventListener(
        'input',
        U.debounce(() => {
          sessionUi.savedQuery = savedSearch.value;
          render();
        }, 180)
      );
    }
    main.querySelectorAll('[data-saved-filter]').forEach((chip) => {
      chip.addEventListener('click', () => {
        sessionUi.savedFilter = chip.getAttribute('data-saved-filter');
        render();
      });
    });

    const chatForm = main.querySelector('#chatForm, form[data-action="tutor-submit"]');
    if (chatForm) {
      chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendTutor();
      });
    }

    // Conservar el texto seleccionado en la lección (el clic en «Subrayar» lo borra).
    const conceptText = main.querySelector('[data-role="concept-text"]');
    if (conceptText) {
      const captureSelection = () => {
        const sel = root.getSelection && root.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        const text = String(sel.toString() || '').trim();
        if (text.length >= 3 && conceptText.contains(sel.anchorNode)) {
          sessionUi.lastSelection = U.truncate(text, 280);
        }
      };
      conceptText.addEventListener('mouseup', captureSelection);
      conceptText.addEventListener('keyup', captureSelection);
      const highlightBtn = main.querySelector('[data-action="add-highlight"]');
      if (highlightBtn) {
        highlightBtn.addEventListener('mousedown', (e) => e.preventDefault());
      }
    }

    const provider = main.querySelector('#aiProvider');
    if (provider) {
      provider.addEventListener('change', () => {
        const preset = ai.PRESETS[provider.value];
        if (!preset) return;
        const base = main.querySelector('#aiBaseUrl');
        const model = main.querySelector('#aiModel');
        if (base && preset.baseUrl) base.value = preset.baseUrl;
        if (model && preset.model) model.value = preset.model;
      });
    }

    const spaceFile = main.querySelector('#spaceFileInput');
    const spaceDrop = main.querySelector('[data-space-dropzone]');
    if (spaceFile) {
      spaceFile.addEventListener('change', () => {
        const file = spaceFile.files && spaceFile.files[0];
        if (!file) return;
        const issue = NexIA.extract.validateFile(file);
        sessionUi.spaces.file = issue ? null : file;
        sessionUi.spaces.error = issue || '';
        render();
      });
    }
    if (spaceDrop) {
      ['dragenter', 'dragover'].forEach((ev) =>
        spaceDrop.addEventListener(ev, (e) => {
          e.preventDefault();
          spaceDrop.classList.add('is-dragover');
        })
      );
      ['dragleave', 'drop'].forEach((ev) =>
        spaceDrop.addEventListener(ev, (e) => {
          e.preventDefault();
          spaceDrop.classList.remove('is-dragover');
        })
      );
      spaceDrop.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (!file) return;
        const issue = NexIA.extract.validateFile(file);
        sessionUi.spaces.file = issue ? null : file;
        sessionUi.spaces.error = issue || '';
        render();
      });
    }
    main.querySelectorAll('input[name="spaceQty"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        sessionUi.spaces.questionCount = Number(radio.value) === 10 ? 10 : 5;
        render();
      });
    });
    const spaceTopic = main.querySelector('#spaceTopic');
    if (spaceTopic) {
      spaceTopic.addEventListener(
        'input',
        U.debounce(() => {
          sessionUi.spaces.title = spaceTopic.value;
        }, 120)
      );
    }
    const joinCode = main.querySelector('#spaceJoinCode');
    if (joinCode) {
      joinCode.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const btn = main.querySelector('[data-action="space-lookup"]');
          if (btn) btn.click();
        }
      });
    }
  }

  function suggestAndSend(btn) {
    const input = main.querySelector('#chatInput, #tutorInput, input[name="message"]');
    if (input) input.value = btn.getAttribute('data-text') || btn.textContent;
    sendTutor();
  }

  function gradeQuiz() {
    const quiz = sessionUi.quiz;
    if (!quiz || quiz.selected == null) return;
    const q = quiz.questions[quiz.index];
    const material = state.getMaterial(quiz.materialId);
    const found = course.findConcept(material, q.conceptId);
    const correct = quiz.selected === q.answer;
    quiz.checked = true;
    quiz.answers.push({
      questionId: q.id,
      conceptId: q.conceptId,
      skill: q.skill,
      selected: quiz.selected,
      correct,
      topicTitle: material.topics[quiz.topicIndex].title,
      conceptTitle: found ? found.concept.title : ''
    });
    render();
  }

  async function advanceQuiz(forceFinish) {
    const quiz = sessionUi.quiz;
    if (!quiz) return;
    const finish = forceFinish || quiz.index >= quiz.questions.length - 1;
    if (finish) {
      const correct = quiz.answers.filter((a) => a.correct).length;
      const attempt = await state.saveAttempt({
        kind: 'quiz',
        materialId: quiz.materialId,
        topicIndex: quiz.topicIndex,
        answers: quiz.answers,
        correct,
        total: quiz.answers.length,
        score: U.percent(correct, quiz.answers.length)
      });
      quiz.done = true;
      navigate('#/resultados/' + attempt.id);
      return;
    }
    quiz.index += 1;
    quiz.selected = null;
    quiz.checked = false;
    render();
  }

  async function analyzeCurrent() {
    const draft = sessionUi.explore;
    if (draft.analyzing) return;
    draft.analyzing = true;
    draft.error = '';
    draft.progress = { page: 0, pages: 0 };
    render();
    try {
      let material;
      if (draft.file) {
        material = await state.importFromFile(draft.file, (p) => {
          draft.progress = p;
          const label = main.querySelector('[data-analysis-progress]');
          if (label && p.pages) label.textContent = 'Leyendo página ' + p.page + ' de ' + p.pages + '…';
        });
      } else if (String(draft.text || '').trim().length > 80) {
        material = await state.importFromText(draft.text, { fileName: 'Texto pegado.txt', fileType: 'TXT' });
      } else {
        throw new Error('Selecciona un archivo o pega un texto con al menos unas 80 palabras.');
      }
      sessionUi.explore = { file: null, text: '', error: '', analyzing: false, progress: null };
      navigate('#/documento/' + material.id);
      ui.toast('Documento analizado. Ya puedes estudiar.', 'success');
    } catch (err) {
      draft.analyzing = false;
      draft.error = err.message || 'No se pudo analizar el documento.';
      render();
    }
  }

  async function sendTutor() {
    const route = parseHash();
    if (route.name !== 'leccion' || sessionUi.tutorBusy) return;
    const input = main.querySelector('#chatInput, #tutorInput, input[name="message"]');
    const message = input ? input.value.trim() : '';
    if (!message) return;
    const material = state.getMaterial(route.params.id);
    const ti = Number(route.params.ti || 0);
    const ci = Number(route.params.ci || 0);
    material.chat = material.chat || [];
    material.chat.push({ role: 'user', text: message, at: Date.now() });
    if (input) input.value = '';
    sessionUi.tutorBusy = true;
    render();
    material.chatSession = material.chatSession || {};
    const reply = await ai.tutorReply(material, { ti, ci }, message, material.chatSession);
    material.chat.push({
      role: 'ai',
      parts: reply.parts,
      mode: reply.mode,
      notice: reply.notice,
      suggestions: reply.suggestions,
      at: Date.now()
    });
    if (reply.parts && reply.parts[0] && reply.parts[0].text) {
      // Guardar explicación IA si el usuario lo pide después; aquí solo persistimos el chat.
    }
    await state.saveMaterial(material);
    sessionUi.tutorBusy = false;
    render();
    const log = main.querySelector('#chatLog');
    if (log) log.scrollTop = log.scrollHeight;
  }

  function startTts() {
    const route = parseHash();
    const material = state.getMaterial(route.params.id);
    if (!material || !root.speechSynthesis) {
      ui.toast('Tu navegador no admite lectura en voz alta.', 'error');
      return;
    }
    const ti = Number(route.params.ti || 0);
    const ci = Number(route.params.ci || 0);
    const concept = material.topics[ti].concepts[ci];
    const text = [concept.lead].concat(concept.keyPoints || []).join('. ');
    stopTts();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = material.lang === 'en' ? 'en-US' : 'es-ES';
    utter.rate = sessionUi.tts.rate || 1;
    utter.onend = () => {
      sessionUi.tts.speaking = false;
      render();
    };
    sessionUi.tts.speaking = true;
    root.speechSynthesis.speak(utter);
    render();
  }

  async function advanceCard(knew) {
    const rev = sessionUi.review;
    if (!rev) return;
    if (knew) rev.score += 1;
    if (rev.cardIndex >= rev.cards.length - 1) {
      rev.step = 'open';
    } else {
      rev.cardIndex += 1;
      rev.flipped = false;
    }
    render();
  }

  async function boot() {
    try {
      await NexIA.store.ready();
      let user = await auth.currentUser();
      if (!user) {
        location.replace('login.html');
        return;
      }
      await state.loadAll(user);
      // Preferencia de estudio por defecto al abrir lecciones
      if (user.prefs && user.prefs.studyMode === 'audio') sessionUi.lessonTab = 'audio';
      if (user.prefs && (user.prefs.studyMode === 'video' || user.prefs.studyMode === 'visual')) {
        sessionUi.lessonTab = 'visual';
      }
      render();
      root.addEventListener('hashchange', render);
      state.onChange(() => {
        refreshChrome();
      });
    } catch (err) {
      console.error(err);
      if (main) {
        main.innerHTML =
          '<div class="empty-state"><h2 class="empty-state__title">No se pudo iniciar NexIA</h2><p class="empty-state__text">' +
          U.esc(err.message) +
          '</p></div>';
      }
    }
  }

  // Shell events
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      if (sidebar.classList.contains('is-open')) closeSidebar();
      else openSidebar();
    });
  }
  if (backdrop) backdrop.addEventListener('click', closeSidebar);
  if (desktopToggle) {
    desktopToggle.addEventListener('click', () => {
      sidebar.classList.toggle('is-collapsed');
      desktopToggle.setAttribute('aria-expanded', String(!sidebar.classList.contains('is-collapsed')));
    });
  }
  [userMenuButton, userMenuButtonMobile].forEach((btn) => btn && btn.addEventListener('click', toggleUserMenu));
  document.addEventListener('click', (e) => {
    if (userMenu && !userMenu.hidden && !e.target.closest('.user-menu-wrap')) closeUserMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSidebar();
      closeUserMenu();
    }
  });
  document.body.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action="logout"], [data-action="toggle-theme"]');
    if (!actionEl) return;
    if (!document.getElementById('userMenu') || !document.getElementById('userMenu').contains(actionEl)) return;
    e.preventDefault();
    if (actionEl.getAttribute('data-action') === 'logout') {
      auth.logout();
      location.href = 'login.html';
    } else {
      const current = (state.raw.user.prefs && state.raw.user.prefs.theme) || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      auth.updateProfile(state.raw.user, { prefs: { theme: next } }).then(async () => {
        state.raw.user = await auth.currentUser();
        setTheme(next);
        render();
      });
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
