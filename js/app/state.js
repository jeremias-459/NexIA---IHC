/*
 * NexIA · Estado de la sesión de estudio.
 * Carga y guarda materiales, intentos, guardados, repasos y actividad.
 */
(function (root) {
  'use strict';

  const NexIA = (root.NexIA = root.NexIA || {});
  const U = NexIA.utils;
  const store = NexIA.store;
  const analyzer = NexIA.analyzer;
  const course = NexIA.course;
  const sample = NexIA.sample;
  const extract = NexIA.extract;

  const REVIEW_INTERVALS = [1, 3, 7, 14, 30];

  const state = {
    user: null,
    materials: [],
    attempts: [],
    saved: [],
    reviews: [],
    activity: [],
    spaces: [],
    ready: false,
    listeners: new Set()
  };

  function emit() {
    state.listeners.forEach((fn) => {
      try {
        fn(state);
      } catch (err) {
        if (root.console) console.error(err);
      }
    });
  }

  function onChange(fn) {
    state.listeners.add(fn);
    return () => state.listeners.delete(fn);
  }

  function materialProgress(material) {
    const total = course.countConcepts(material);
    const done = Object.keys((material.progress && material.progress.done) || {}).length;
    return { total, done, pct: U.percent(done, total) };
  }

  function materialStatus(material) {
    const { pct } = materialProgress(material);
    if (pct >= 100) return 'completado';
    if (pct > 0 || material.lastOpenedAt) return 'progreso';
    return 'nuevo';
  }

  async function loadAll(user) {
    state.user = user;
    const uid = user.id;
    const [materials, attempts, saved, reviews, activity, spaces] = await Promise.all([
      store.getAll('materials', uid),
      store.getAll('attempts', uid),
      store.getAll('saved', uid),
      store.getAll('reviews', uid),
      store.getAll('activity', uid),
      store.getAll('spaces')
    ]);
    state.materials = materials.sort((a, b) => (b.lastOpenedAt || b.createdAt) - (a.lastOpenedAt || a.createdAt));
    state.attempts = attempts.sort((a, b) => b.createdAt - a.createdAt);
    state.saved = saved.sort((a, b) => b.createdAt - a.createdAt);
    state.reviews = reviews.sort((a, b) => a.dueAt - b.dueAt);
    state.activity = activity.sort((a, b) => b.day.localeCompare(a.day));
    state.spaces = (spaces || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    state.ready = true;
    emit();
    return state;
  }

  function normalizeSpaceCode(code) {
    return String(code || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  function makeSpaceCode() {
    const n = (U.hashString(String(Date.now()) + U.uid('c')) % 9000) + 1000;
    return 'NX' + n;
  }

  function getSpace(id) {
    return state.spaces.find((s) => s.id === id) || null;
  }

  function findSpaceByCode(code) {
    const needle = normalizeSpaceCode(code);
    return state.spaces.find((s) => normalizeSpaceCode(s.code) === needle) || null;
  }

  function mySpaces() {
    const uid = state.user && state.user.id;
    if (!uid) return [];
    return state.spaces.filter(
      (s) => s.userId === uid || (Array.isArray(s.members) && s.members.some((m) => m.userId === uid))
    );
  }

  function memberOf(space, userId) {
    if (!space) return null;
    return (space.members || []).find((m) => m.userId === userId) || null;
  }

  async function saveSpace(space) {
    await store.put('spaces', space);
    const idx = state.spaces.findIndex((s) => s.id === space.id);
    if (idx >= 0) state.spaces[idx] = space;
    else state.spaces.unshift(space);
    state.spaces.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    emit();
    return space;
  }

  function buildSpaceQuestions(material, count) {
    const questions = course.pickQuestions(material, { count: count || 5 });
    return questions.map((q, i) => ({
      id: q.id || U.uid('sq'),
      index: i,
      stem: q.stem,
      options: (q.options || []).slice(),
      answer: q.answer,
      tip: q.explanation || q.quote || 'Revisa la idea clave en tu material.',
      code: q.code || '',
      skill: q.skill || 'comprension',
      conceptId: q.conceptId,
      conceptTitle: q.conceptTitle || ''
    }));
  }

  async function createSpace(opts) {
    const user = state.user;
    if (!user) throw new Error('Debes iniciar sesión.');
    const title = String((opts && opts.title) || '').trim();
    if (title.length < 3) throw new Error('Escribe un tema de al menos 3 caracteres.');
    const count = Number(opts.questionCount) === 10 ? 10 : 5;
    let material = null;
    if (opts.materialId) material = getMaterial(opts.materialId);
    if (!material && opts.file) material = await importFromFile(opts.file);
    if (!material && opts.text) material = await importFromText(opts.text, { title: title });
    if (!material) {
      // Sin archivo: usa el material de ejemplo o el primero disponible.
      if (!state.materials.length) material = await importSample();
      else material = state.materials[0];
    }
    let questions = buildSpaceQuestions(material, count);
    if (questions.length < count) {
      const extra = buildSpaceQuestions(material, count);
      questions = questions.concat(extra).slice(0, count);
    }
    if (!questions.length) throw new Error('No se pudieron generar preguntas de este material.');

    let code = makeSpaceCode();
    while (findSpaceByCode(code)) code = makeSpaceCode();

    const space = {
      id: U.uid('sp'),
      userId: user.id,
      code,
      title,
      subject: (material && material.title) || 'Aprendizaje',
      description: 'Espacio generado a partir de «' + ((material && material.title) || title) + '».',
      questionCount: questions.length,
      questions,
      materialId: material.id,
      createdAt: Date.now(),
      ownerName: user.name,
      preview: 'code',
      demoCrowd: 12 + (U.hashString(code) % 20),
      members: [
        {
          userId: user.id,
          name: user.name,
          avatarColor: user.avatarColor || '#5558F5',
          role: 'owner',
          joinedAt: Date.now(),
          answers: [],
          completedAt: null,
          score: null,
          correct: 0,
          total: questions.length,
          timeSec: 0
        }
      ]
    };
    await saveSpace(space);
    await touchActivity('study');
    return space;
  }

  async function joinSpace(code) {
    const user = state.user;
    const space = findSpaceByCode(code);
    if (!space) throw new Error('No encontramos un espacio con ese código.');
    if (!memberOf(space, user.id)) {
      space.members = space.members || [];
      space.members.push({
        userId: user.id,
        name: user.name,
        avatarColor: user.avatarColor || '#5558F5',
        role: 'member',
        joinedAt: Date.now(),
        answers: [],
        completedAt: null,
        score: null,
        correct: 0,
        total: space.questionCount,
        timeSec: 0
      });
      await saveSpace(space);
    }
    return space;
  }

  async function submitSpaceAttempt(spaceId, payload) {
    const space = getSpace(spaceId);
    const user = state.user;
    if (!space || !user) throw new Error('Espacio no encontrado.');
    let member = memberOf(space, user.id);
    if (!member) {
      await joinSpace(space.code);
      member = memberOf(getSpace(spaceId), user.id);
    }
    const answers = (payload && payload.answers) || [];
    let correct = 0;
    answers.forEach((a) => {
      const q = space.questions[a.index];
      if (q && a.selected === q.answer) correct += 1;
    });
    member.answers = answers;
    member.correct = correct;
    member.total = space.questions.length;
    member.score = U.percent(correct, space.questions.length);
    member.timeSec = Math.max(30, Number(payload.timeSec) || 0);
    member.completedAt = Date.now();
    await saveSpace(space);
    await saveAttempt({
      kind: 'space',
      materialId: space.materialId,
      spaceId: space.id,
      answers: answers.map((a) => ({
        conceptId: (space.questions[a.index] && space.questions[a.index].conceptId) || null,
        correct: space.questions[a.index] && a.selected === space.questions[a.index].answer,
        skill: (space.questions[a.index] && space.questions[a.index].skill) || 'comprension'
      })),
      correct,
      total: space.questions.length,
      score: member.score
    });
    return { space, member };
  }

  function spaceAnalysis(space) {
    if (!space) return null;
    const completed = (space.members || []).filter((m) => m.completedAt);
    const rnd = U.seededRandom(U.hashString(space.code || space.id));
    const crowd = space.demoCrowd || 18;
    const participants = Math.max(completed.length, crowd);
    const realAvg =
      completed.length > 0
        ? Math.round(completed.reduce((n, m) => n + (m.score || 0), 0) / completed.length)
        : 0;
    const accuracy = completed.length ? Math.round(realAvg * 0.45 + (55 + rnd() * 25) * 0.55) : Math.round(55 + rnd() * 25);
    const avgCorrect = Math.max(1, Math.round((accuracy / 100) * space.questionCount));
    const avgMin = Math.max(6, Math.round(8 + rnd() * 8));

    const skills = {};
    (space.questions || []).forEach((q, i) => {
      const key = q.conceptTitle || q.skill || 'Tema ' + (i + 1);
      if (!skills[key]) skills[key] = { label: key, hits: 0, total: 0 };
      skills[key].total += 1;
      // Desempeño sintético + respuestas reales
      let hitRate = 0.45 + rnd() * 0.45;
      completed.forEach((m) => {
        const ans = (m.answers || []).find((a) => a.index === i);
        if (ans) {
          skills[key].total += 0; // ya contamos pregunta
          if (ans.selected === q.answer) skills[key].hits += 1;
          else skills[key].hits += 0;
        }
      });
      skills[key].hits += Math.round(hitRate * Math.max(1, crowd / 4));
      skills[key].total += Math.max(1, Math.round(crowd / 4));
    });
    const bars = Object.values(skills)
      .slice(0, 6)
      .map((s) => ({ label: s.label, pct: U.clamp(U.percent(s.hits, s.total), 20, 95) }))
      .sort((a, b) => a.pct - b.pct);

    const weak = bars[0] || { label: space.title, pct: 40 };
    const hardQs = (space.questions || [])
      .slice(0, 3)
      .map((q, i) => ({
        stem: q.stem,
        topic: q.conceptTitle || q.skill || 'General',
        pct: U.clamp(28 + Math.round(rnd() * 20) + i * 2, 20, 55)
      }));

    const master = Math.round(participants * (0.25 + rnd() * 0.15));
    const partial = Math.round(participants * (0.35 + rnd() * 0.15));
    const need = Math.max(0, participants - master - partial);

    return {
      participants,
      accuracy,
      avgCorrect,
      avgMin,
      bars,
      weak,
      hardQs,
      distribution: [
        { label: 'Dominan el tema', value: master, color: '#14B8A6' },
        { label: 'Comprensión parcial', value: partial, color: '#5558F5' },
        { label: 'Requieren refuerzo', value: need, color: '#F59E0B' }
      ],
      recommendation:
        'El grupo necesita reforzar «' +
        weak.label +
        '». Propón una práctica corta centrada en ese concepto.'
    };
  }

  async function seedExampleSpaces() {
    const user = state.user;
    if (!user) return [];
    const existing = mySpaces();
    if (existing.length >= 2) return existing;

    const sampleMat = state.materials[0] || (await importSample());
    const demos = [
      {
        title: 'Herencia y polimorfismo',
        subject: 'PROGRAMACIÓN',
        description: 'Practica los pilares de la POO con preguntas generadas del material.',
        preview: 'code',
        code: 'NX4821',
        demoCrowd: 24
      },
      {
        title: 'Circuitos eléctricos',
        subject: 'FÍSICA',
        description: 'Relaciona voltaje, corriente y resistencia con ejercicios cortos.',
        preview: 'circuit',
        code: 'NX7392',
        demoCrowd: 12
      }
    ];
    const created = [];
    for (const demo of demos) {
      if (findSpaceByCode(demo.code) || mySpaces().some((s) => s.title === demo.title)) continue;
      const questions = buildSpaceQuestions(sampleMat, 10);
      const space = {
        id: U.uid('sp'),
        userId: user.id,
        code: demo.code,
        title: demo.title,
        subject: demo.subject,
        description: demo.description,
        questionCount: questions.length || 10,
        questions: questions.length ? questions : buildSpaceQuestions(sampleMat, 5),
        materialId: sampleMat.id,
        createdAt: Date.now() - created.length * 86400000,
        ownerName: user.name,
        preview: demo.preview,
        demoCrowd: demo.demoCrowd,
        members: [
          {
            userId: user.id,
            name: user.name,
            avatarColor: user.avatarColor || '#5558F5',
            role: 'owner',
            joinedAt: Date.now(),
            answers: [],
            completedAt: null,
            score: null,
            correct: 0,
            total: 10,
            timeSec: 0
          }
        ]
      };
      await saveSpace(space);
      created.push(space);
    }
    return mySpaces();
  }

  function getMaterial(id) {
    return state.materials.find((m) => m.id === id) || null;
  }

  function getAttempt(id) {
    return state.attempts.find((a) => a.id === id) || null;
  }

  async function saveMaterial(material) {
    await store.put('materials', material);
    const idx = state.materials.findIndex((m) => m.id === material.id);
    if (idx >= 0) state.materials[idx] = material;
    else state.materials.unshift(material);
    state.materials.sort((a, b) => (b.lastOpenedAt || b.createdAt) - (a.lastOpenedAt || a.createdAt));
    emit();
    return material;
  }

  async function deleteMaterial(id) {
    await store.remove('materials', id);
    state.materials = state.materials.filter((m) => m.id !== id);
    const relatedAttempts = state.attempts.filter((a) => a.materialId === id);
    const relatedSaved = state.saved.filter((s) => s.materialId === id);
    const relatedReviews = state.reviews.filter((r) => r.materialId === id);
    await Promise.all(
      relatedAttempts
        .map((a) => store.remove('attempts', a.id))
        .concat(relatedSaved.map((s) => store.remove('saved', s.id)))
        .concat(relatedReviews.map((r) => store.remove('reviews', r.id)))
    );
    state.attempts = state.attempts.filter((a) => a.materialId !== id);
    state.saved = state.saved.filter((s) => s.materialId !== id);
    state.reviews = state.reviews.filter((r) => r.materialId !== id);
    emit();
  }

  function buildMaterialRecord(courseData, meta) {
    return Object.assign({}, courseData, {
      id: U.uid('m'),
      userId: state.user.id,
      fileName: meta.fileName || courseData.title + '.txt',
      fileType: meta.fileType || 'TXT',
      fileSize: meta.fileSize || 0,
      pages: meta.pages || null,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      progress: { done: {}, last: { t: 0, c: 0 } },
      highlights: [],
      chat: []
    });
  }

  async function importFromText(text, meta) {
    const courseData = analyzer.buildCourse(text, { fileName: meta.fileName, title: meta.title });
    const material = buildMaterialRecord(courseData, meta);
    await saveMaterial(material);
    await touchActivity('study');
    return material;
  }

  async function importFromFile(file, onProgress) {
    const issue = extract.validateFile(file);
    if (issue) throw new extract.ExtractError('invalid-file', issue);
    const extracted = await extract.fromFile(file, onProgress);
    return importFromText(extracted.text, {
      fileName: file.name,
      fileType: extracted.type,
      fileSize: file.size,
      pages: extracted.pages,
      title: undefined
    });
  }

  async function importSample() {
    return importFromText(sample.text, {
      fileName: sample.fileName,
      fileType: 'MD',
      fileSize: sample.text.length,
      title: sample.title
    });
  }

  async function markConceptDone(materialId, ti, ci) {
    const material = getMaterial(materialId);
    if (!material) return null;
    const concept = material.topics[ti] && material.topics[ti].concepts[ci];
    if (!concept) return null;
    material.progress = material.progress || { done: {}, last: { t: 0, c: 0 } };
    material.progress.done[concept.id] = Date.now();
    material.progress.last = { t: ti, c: ci };
    material.lastOpenedAt = Date.now();
    await saveMaterial(material);
    await touchActivity('study');
    return material;
  }

  async function touchActivity(kind) {
    const day = U.dateKey();
    let row = state.activity.find((a) => a.day === day);
    if (!row) {
      row = { id: U.uid('act'), userId: state.user.id, day, study: 0, quiz: 0, review: 0 };
      state.activity.push(row);
    }
    if (kind === 'study') row.study += 1;
    if (kind === 'quiz') row.quiz += 1;
    if (kind === 'review') row.review += 1;
    await store.put('activity', row);
    emit();
    return row;
  }

  function streakDays() {
    const days = new Set(state.activity.filter((a) => a.study || a.quiz || a.review).map((a) => a.day));
    let streak = 0;
    let cursor = U.parseDateKey(U.dateKey());
    // Si hoy no hay actividad, empieza a contar desde ayer.
    if (!days.has(U.dateKey(cursor))) cursor = U.addDays(cursor, -1);
    while (days.has(U.dateKey(cursor))) {
      streak++;
      cursor = U.addDays(cursor, -1);
    }
    return streak;
  }

  function weekDots() {
    const today = new Date();
    const day = (today.getDay() + 6) % 7; // lunes = 0
    const monday = U.addDays(today, -day);
    const labels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    const active = new Set(state.activity.filter((a) => a.study || a.quiz || a.review).map((a) => a.day));
    return labels.map((label, i) => {
      const key = U.dateKey(U.addDays(monday, i));
      return { label, done: active.has(key), today: key === U.dateKey() };
    });
  }

  async function saveAttempt(attempt) {
    attempt.id = attempt.id || U.uid('att');
    attempt.userId = state.user.id;
    attempt.createdAt = attempt.createdAt || Date.now();
    await store.put('attempts', attempt);
    const idx = state.attempts.findIndex((a) => a.id === attempt.id);
    if (idx >= 0) state.attempts[idx] = attempt;
    else state.attempts.unshift(attempt);
    await touchActivity(attempt.kind === 'review' ? 'review' : 'quiz');
    // Programa repasos para conceptos fallados.
    if (attempt.answers) {
      for (const ans of attempt.answers) {
        if (!ans.correct && ans.conceptId) {
          await scheduleReview({
            materialId: attempt.materialId,
            conceptId: ans.conceptId,
            topicTitle: ans.topicTitle,
            conceptTitle: ans.conceptTitle
          });
        }
      }
    }
    emit();
    return attempt;
  }

  async function scheduleReview(info) {
    const existing = state.reviews.find(
      (r) => r.materialId === info.materialId && r.conceptId === info.conceptId && r.status !== 'done'
    );
    const stage = existing ? Math.min((existing.stage || 0) + (info.success ? 1 : 0), REVIEW_INTERVALS.length - 1) : 0;
    const due = U.addDays(new Date(), info.success ? REVIEW_INTERVALS[stage] : 1);
    const row = existing || {
      id: U.uid('rev'),
      userId: state.user.id,
      materialId: info.materialId,
      conceptId: info.conceptId,
      topicTitle: info.topicTitle,
      conceptTitle: info.conceptTitle,
      createdAt: Date.now()
    };
    row.stage = info.success ? stage : 0;
    row.dueAt = due.getTime();
    row.status = 'scheduled';
    row.topicTitle = info.topicTitle || row.topicTitle;
    row.conceptTitle = info.conceptTitle || row.conceptTitle;
    await store.put('reviews', row);
    if (!existing) state.reviews.push(row);
    state.reviews.sort((a, b) => a.dueAt - b.dueAt);
    emit();
    return row;
  }

  function dueReviews(date) {
    const end = U.addDays(date || new Date(), 0);
    end.setHours(23, 59, 59, 999);
    return state.reviews.filter((r) => r.status !== 'done' && r.dueAt <= end.getTime());
  }

  async function saveItem(item) {
    item.id = item.id || U.uid('sav');
    item.userId = state.user.id;
    item.createdAt = item.createdAt || Date.now();
    await store.put('saved', item);
    const idx = state.saved.findIndex((s) => s.id === item.id);
    if (idx >= 0) state.saved[idx] = item;
    else state.saved.unshift(item);
    emit();
    return item;
  }

  async function removeSaved(id) {
    await store.remove('saved', id);
    state.saved = state.saved.filter((s) => s.id !== id);
    emit();
  }

  function isConceptSaved(materialId, conceptId) {
    return state.saved.some((s) => s.type === 'conceptos' && s.materialId === materialId && s.conceptId === conceptId);
  }

  function weakConcepts(limit) {
    const stats = new Map();
    state.attempts.forEach((att) => {
      (att.answers || []).forEach((ans) => {
        if (!ans.conceptId) return;
        const key = att.materialId + ':' + ans.conceptId;
        const row = stats.get(key) || {
          materialId: att.materialId,
          conceptId: ans.conceptId,
          topicTitle: ans.topicTitle,
          conceptTitle: ans.conceptTitle,
          wrong: 0,
          total: 0
        };
        row.total++;
        if (!ans.correct) row.wrong++;
        row.topicTitle = ans.topicTitle || row.topicTitle;
        row.conceptTitle = ans.conceptTitle || row.conceptTitle;
        stats.set(key, row);
      });
    });
    return Array.from(stats.values())
      .filter((r) => r.wrong > 0)
      .sort((a, b) => b.wrong / b.total - a.wrong / a.total)
      .slice(0, limit || 6)
      .map((r) => {
        const material = getMaterial(r.materialId);
        return Object.assign(r, {
          materialTitle: material ? material.title : 'Material',
          rate: U.percent(r.total - r.wrong, r.total)
        });
      });
  }

  function progressStats(days) {
    const since = U.addDays(new Date(), -(days || 30)).getTime();
    const attempts = state.attempts.filter((a) => a.createdAt >= since);
    const correct = attempts.reduce((n, a) => n + (a.correct || 0), 0);
    const total = attempts.reduce((n, a) => n + (a.total || 0), 0);
    const completedTopics = state.materials.reduce((n, m) => {
      return n + m.topics.filter((t) => t.concepts.every((c) => m.progress && m.progress.done && m.progress.done[c.id])).length;
    }, 0);
    const skill = { comprension: [0, 0], aplicacion: [0, 0], analisis: [0, 0], sintesis: [0, 0], memoria: [0, 0] };
    attempts.forEach((a) => {
      (a.answers || []).forEach((ans) => {
        const key = ans.skill || 'comprension';
        if (!skill[key]) skill[key] = [0, 0];
        skill[key][1]++;
        if (ans.correct) skill[key][0]++;
      });
    });
    // Memoria ≈ aciertos en flashcards/repaso
    const reviewAttempts = attempts.filter((a) => a.kind === 'review');
    skill.memoria = [
      reviewAttempts.reduce((n, a) => n + (a.correct || 0), 0),
      Math.max(1, reviewAttempts.reduce((n, a) => n + (a.total || 0), 0))
    ];

    const weeks = [];
    for (let i = 4; i >= 0; i--) {
      const start = U.addDays(new Date(), -7 * (i + 1));
      const end = U.addDays(new Date(), -7 * i);
      const count = state.materials.reduce((n, m) => {
        return (
          n +
          m.topics.filter((t) =>
            t.concepts.every((c) => {
              const ts = m.progress && m.progress.done && m.progress.done[c.id];
              return ts && ts >= start.getTime() && ts < end.getTime();
            })
          ).length
        );
      }, 0);
      weeks.push({ label: 'S' + (5 - i), value: count });
    }
    // Acumulado
    let acc = 0;
    const cumulative = weeks.map((w) => {
      acc += w.value;
      return acc;
    });

    return {
      completedTopics,
      accuracy: U.percent(correct, total),
      streakWeeks: Math.max(1, Math.ceil(streakDays() / 7)) || 0,
      streakDays: streakDays(),
      radar: [
        { label: 'Comprensión', value: U.percent(skill.comprension[0], skill.comprension[1] || 1) },
        { label: 'Aplicación', value: U.percent(skill.aplicacion[0], skill.aplicacion[1] || 1) },
        { label: 'Análisis', value: U.percent(skill.analisis[0], skill.analisis[1] || 1) },
        { label: 'Síntesis', value: U.percent(skill.sintesis[0], skill.sintesis[1] || 1) },
        { label: 'Memoria', value: U.percent(skill.memoria[0], skill.memoria[1] || 1) }
      ],
      line: { points: cumulative, labels: weeks.map((w) => w.label) }
    };
  }

  NexIA.state = {
    get raw() {
      return state;
    },
    onChange,
    loadAll,
    getMaterial,
    getAttempt,
    saveMaterial,
    deleteMaterial,
    importFromText,
    importFromFile,
    importSample,
    markConceptDone,
    materialProgress,
    materialStatus,
    streakDays,
    weekDots,
    saveAttempt,
    scheduleReview,
    dueReviews,
    saveItem,
    removeSaved,
    isConceptSaved,
    weakConcepts,
    progressStats,
    touchActivity,
    getSpace,
    findSpaceByCode,
    mySpaces,
    memberOf,
    saveSpace,
    createSpace,
    joinSpace,
    submitSpaceAttempt,
    spaceAnalysis,
    seedExampleSpaces,
    normalizeSpaceCode
  };
})(typeof window !== 'undefined' ? window : globalThis);
