/*
 * NexIA · IA opcional (API compatible con OpenAI).
 *
 * No hace falta un servidor: la clave se guarda solo en este navegador y las
 * peticiones salen directamente al proveedor que elijas (OpenAI, Groq,
 * OpenRouter, Azure, Ollama local, etc.).
 *
 * Si no hay clave configurada, o si la petición falla, la aplicación sigue
 * usando el tutor local basado en el propio material.
 */
(function (root) {
  'use strict';

  const NexIA = (root.NexIA = root.NexIA || {});
  const U = NexIA.utils;
  const course = NexIA.course;

  const STORAGE_KEY = 'nexia:ai';
  const DEFAULTS = {
    enabled: false,
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: ''
  };

  const PRESETS = {
    openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
    openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
    ollama: { label: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2' },
    custom: { label: 'Personalizado', baseUrl: '', model: '' }
  };

  class AIError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'AIError';
      this.code = code;
    }
  }

  function readConfig() {
    try {
      const raw = root.localStorage.getItem(STORAGE_KEY);
      if (!raw) return Object.assign({}, DEFAULTS);
      return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (err) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function saveConfig(patch) {
    const next = Object.assign(readConfig(), patch || {});
    root.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  function clearKey() {
    return saveConfig({ apiKey: '', enabled: false });
  }

  function isReady(config) {
    const cfg = config || readConfig();
    return Boolean(cfg.enabled && cfg.apiKey && cfg.baseUrl && cfg.model);
  }

  function conceptContext(material, where) {
    const topic = material.topics[where.ti] || material.topics[0];
    const concept = topic && (topic.concepts[where.ci] || topic.concepts[0]);
    if (!concept) return { topic: null, concept: null, text: '' };
    const text = [
      'Material: ' + material.title,
      'Tema: ' + topic.title,
      'Concepto: ' + concept.title,
      '',
      'Idea central: ' + (concept.lead || ''),
      '',
      'Puntos clave:',
      (concept.keyPoints || []).map((p) => '- ' + p).join('\n'),
      '',
      'Texto del concepto:',
      course.conceptText(concept)
    ].join('\n');
    return { topic, concept, text: U.truncate(text, 6000) };
  }

  /**
   * Llama a /chat/completions de una API compatible con OpenAI.
   * @returns {Promise<string>} texto de la respuesta
   */
  function chat(messages, options) {
    const cfg = readConfig();
    if (!isReady(cfg)) return Promise.reject(new AIError('not-configured', 'Configura una clave de IA en tu perfil.'));
    const opts = options || {};
    const url = String(cfg.baseUrl).replace(/\/$/, '') + '/chat/completions';
    const body = {
      model: cfg.model,
      messages,
      temperature: opts.temperature == null ? 0.4 : opts.temperature,
      max_tokens: opts.maxTokens || 700
    };
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify(body),
      signal: opts.signal
    }).then(async (res) => {
      let data = null;
      try {
        data = await res.json();
      } catch (err) {
        data = null;
      }
      if (!res.ok) {
        const detail = (data && (data.error && data.error.message)) || res.statusText || 'Error ' + res.status;
        if (res.status === 401) throw new AIError('unauthorized', 'La clave de API fue rechazada. Revísala en tu perfil.');
        if (res.status === 429) throw new AIError('rate-limit', 'Se alcanzó el límite de uso del proveedor. Intenta más tarde.');
        throw new AIError('http', detail);
      }
      const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!text) throw new AIError('empty', 'El proveedor no devolvió una respuesta.');
      return String(text).trim();
    });
  }

  function toParts(text) {
    const chunks = String(text || '')
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!chunks.length) return [{ type: 'p', text: text }];
    return chunks.map((chunk) => {
      if (/^```/.test(chunk)) {
        const body = chunk.replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '');
        return { type: 'code', text: body };
      }
      const lines = chunk.split('\n');
      if (lines.length > 1 && lines.every((l) => /^[-*•]\s+/.test(l) || !l.trim())) {
        return { type: 'list', items: lines.filter(Boolean).map((l) => l.replace(/^[-*•]\s+/, '')) };
      }
      if (/^["«“]/.test(chunk) && chunk.length < 420) return { type: 'quote', text: chunk.replace(/^["«“]|["»”]$/g, '') };
      return { type: 'p', text: chunk };
    });
  }

  /**
   * Tutor con IA. Si falla o no está configurada, usa el tutor local.
   */
  function tutorReply(material, where, message, session) {
    const local = () => course.tutorReply(material, where, message, session);
    if (!isReady()) return Promise.resolve(Object.assign({ mode: 'local' }, local()));

    const ctx = conceptContext(material, where);
    const history = (session && session.aiHistory) || [];
    const system =
      'Eres el tutor de NexIA. Responde en español, de forma clara y breve (máximo 180 palabras). ' +
      'Usa SOLO el material del estudiante. Si no está en el material, dilo con sinceridad y sugiere qué pedir. ' +
      'No inventes datos fuera del texto. Puedes usar listas cortas o un ejemplo si ayuda.';

    const messages = [{ role: 'system', content: system + '\n\nMATERIAL:\n' + ctx.text }];
    history.slice(-6).forEach((turn) => messages.push(turn));
    messages.push({ role: 'user', content: String(message || '').trim() });

    return chat(messages)
      .then((answer) => {
        if (session) {
          session.aiHistory = history.concat(
            { role: 'user', content: String(message || '').trim() },
            { role: 'assistant', content: answer }
          ).slice(-8);
        }
        return {
          mode: 'ai',
          parts: toParts(answer),
          source: { ti: where.ti, ci: where.ci },
          suggestions: ['Resúmelo', 'Dame un ejemplo', 'Explícamelo más fácil', 'Hazme una pregunta']
        };
      })
      .catch((err) => {
        const fallback = local();
        fallback.mode = 'local';
        fallback.notice =
          err && err.message
            ? 'No se pudo usar la IA (' + err.message + '). Respondí con el tutor local.'
            : 'No se pudo usar la IA. Respondí con el tutor local.';
        return fallback;
      });
  }

  /** Prueba rápida de la configuración (sin gastar muchas tokens). */
  function testConnection() {
    return chat(
      [
        { role: 'system', content: 'Responde solo con la palabra OK.' },
        { role: 'user', content: 'Di OK' }
      ],
      { maxTokens: 8, temperature: 0 }
    ).then((text) => ({ ok: true, sample: text }));
  }

  NexIA.ai = {
    AIError,
    PRESETS,
    DEFAULTS,
    readConfig,
    saveConfig,
    clearKey,
    isReady,
    chat,
    tutorReply,
    testConnection,
    conceptContext
  };
})(typeof window !== 'undefined' ? window : globalThis);
