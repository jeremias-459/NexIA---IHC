/*
 * NexIA · Analizador de documentos.
 *
 * Convierte el texto de un documento en un curso: temas, conceptos, ideas
 * clave, términos, preguntas de práctica, flashcards y una pregunta abierta.
 * También incluye el tutor, que responde buscando en el propio material.
 *
 * Todo el análisis es local y determinista (procesamiento de texto clásico:
 * segmentación, frecuencia de términos y recuperación por similitud). No se
 * envía nada a ningún servidor.
 */
(function (root) {
  'use strict';

  const NexIA = (root.NexIA = root.NexIA || {});
  const U = NexIA.utils;

  class AnalyzeError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'AnalyzeError';
      this.code = code;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Léxico                                                              */
  /* ------------------------------------------------------------------ */

  function fold(text) {
    return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  const STOP_ES =
    'a al algo alguna algunas alguno algunos ante antes aquel aquella aquellas aquello aquellos aqui asi aun aunque bien cada casi como con contra cual cuales ' +
    'cualquier cuando cuanto de del desde donde dos durante e el ella ellas ello ellos en entre era eran es esa esas ese eso esos esta estaba estaban ' +
    'estado estamos estan estar estas este esto estos fue fueron ha habia habian hace hacen hacer hacia han hasta hay he la las le les lo los mas me ' +
    'mediante mi mientras misma mismas mismo mismos mucha muchas mucho muchos muy nada ni no nos nosotros nuestra nuestras nuestro nuestros o os otra ' +
    'otras otro otros para pero poco por porque pues que quien quienes se sea sean segun ser sera seran si sido siempre sin sino sobre solo son su sus ' +
    'tal tales tambien tan tanto te tiene tienen toda todas todo todos tras tu tus un una unas uno unos usted ustedes va van ve vez veces ya yo puede ' +
    'pueden debe deben hecho dicho dice decir ejemplo ejemplos etc ademas luego entonces ahi alli parte partes forma formas manera tipo tipos caso ' +
    'casos traves general cuenta dar dado dada dados dadas tener tenga tengan siendo ningun ninguna ninguno primero primera segundo segunda tercer ' +
    'tercero uso usar usa usan utiliza utilizan utilizar permite permiten hacer hace cuyo cuya cuyos cuyas decir embargo ahora aquellos mayor menor ' +
    'mejor peor gran grande grandes nuevo nueva nuevos nuevas distintos distintas diferentes varios varias cierto cierta ciertos ciertas igual ' +
    'propio propia propios propias siguiente siguientes principal principales importante importantes posible posibles necesario necesaria ' +
    'necesarios necesarias comun comunes unico unica unicos unicas demas dentro fuera junto ambos ambas ultimo ultima ultimos ultimas ' +
    'anterior anteriores actual actuales conviene resulta suele suelen llamado llamada llamados llamadas conocido conocida';
  const STOP_EN =
    'a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing ' +
    'down during each few for from further had has have having he her here hers him his how i if in into is it its just may me more most my no nor ' +
    'not now of off on once one only or other our out over own same she should so some such than that the their them then there these they this ' +
    'those through to too two under until up use used using very was we were what when where which while who whom why will with would you your';

  const STOP = new Set((STOP_ES + ' ' + STOP_EN).split(/\s+/).map(fold));
  const STOP_ES_SET = new Set(STOP_ES.split(/\s+/));
  const STOP_EN_SET = new Set(STOP_EN.split(/\s+/));

  const DETERMINERS = new Set(
    'el la los las un una unos unas del al su sus este esta estos estas ese esa esos esas cada dicho dicha nuestro nuestra the a an this that these those each its their our'.split(' ')
  );
  const MASC_DET = new Set('el un los unos del al este estos ese esos dicho nuestro'.split(' '));
  const FEM_DET = new Set('la una las unas esta estas esa esas dicha nuestra'.split(' '));
  const CONNECTORS = new Set('de del la el los las a en of the to for'.split(' '));
  const ABBREVIATIONS = new Set(['p', 'pp', 'ej', 'etc', 'sr', 'sra', 'dr', 'dra', 'ing', 'lic', 'fig', 'cap', 'pag', 'num', 'vs', 'art', 'ed', 'vol', 'aprox', 'av', 'tel', 'ud', 'uds', 'mr', 'mrs', 'ms', 'prof', 'st']);

  const SUFFIX_RE = /(aciones|amientos|imientos|amiento|imiento|adores|adoras|idades|mente|acion|adora|ador|idad|ismos|ismo|istas|ista|ables|ibles|able|ible|ando|iendo|ados|adas|idos|idas|ado|ada|ido|ida|ces|es|as|os|a|o|e|s)$/;
  const stemCache = new Map();

  /**
   * Raíz "ligera": solo iguala género y número (clase/clases, hijo/hijas).
   * Se usa para reconocer términos sin confundir palabras distintas
   * de la misma familia (programación ≠ programador).
   */
  function stem(word) {
    const w = fold(word);
    let s = stemCache.get(w);
    if (s !== undefined) return s;
    s = w.replace(/z$/, 'c');
    if (w.length >= 4) {
      let cut = s.replace(/([^si])s$/, '$1');
      cut = cut.replace(/[aoe]$/, '');
      if (cut.length >= 3) s = cut;
    }
    if (stemCache.size > 60000) stemCache.clear();
    stemCache.set(w, s);
    return s;
  }

  const rootCache = new Map();

  /**
   * Raíz "amplia": además recorta sufijos de derivación. Se usa para buscar
   * en el material y valorar respuestas, donde conviene ser más flexible.
   */
  function broadStem(word) {
    const w = fold(word);
    let s = rootCache.get(w);
    if (s !== undefined) return s;
    s = w;
    if (w.length >= 4) {
      const cut = w.replace(SUFFIX_RE, '');
      if (cut.length >= 3) s = cut;
      else if (w.length > 4 && w.charAt(w.length - 1) === 's') s = w.slice(0, -1);
    }
    if (rootCache.size > 60000) rootCache.clear();
    rootCache.set(w, s);
    return s;
  }

  const tokenCache = new Map();

  /** Divide una oración en palabras con posición, raíz y marca de "palabra con contenido". */
  function tokenize(sentence) {
    let tokens = tokenCache.get(sentence);
    if (tokens) return tokens;
    tokens = [];
    const re = /[\p{L}][\p{L}\p{N}]*(?:[-'’][\p{L}\p{N}]+)*/gu;
    let match;
    let lastEnd = 0;
    while ((match = re.exec(sentence))) {
      const text = match[0];
      const folded = fold(text);
      const content = (folded.length >= 3 || /^\p{Lu}{2}$/u.test(text)) && !STOP.has(folded);
      tokens.push({
        text,
        index: match.index,
        end: match.index + text.length,
        folded,
        content,
        stem: content ? stem(folded) : folded,
        breakBefore: tokens.length > 0 && !/^\s*$/.test(sentence.slice(lastEnd, match.index))
      });
      lastEnd = match.index + text.length;
    }
    if (tokenCache.size > 40000) tokenCache.clear();
    tokenCache.set(sentence, tokens);
    return tokens;
  }

  function contentStems(text) {
    const out = [];
    tokenize(text).forEach((token) => {
      if (token.content) out.push(token.stem);
    });
    return out;
  }

  function contentRoots(text) {
    const out = [];
    tokenize(text).forEach((token) => {
      if (token.content) out.push(broadStem(token.folded));
    });
    return out;
  }

  /** Divide un párrafo en oraciones respetando abreviaturas y decimales. */
  function splitSentences(text) {
    const out = [];
    const n = text.length;
    let start = 0;
    for (let i = 0; i < n; i++) {
      const ch = text[i];
      if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…') continue;
      let j = i + 1;
      while (j < n && /[.!?…"»”’')\]]/.test(text[j])) j++;
      if (j >= n) break;
      if (!/\s/.test(text[j])) continue;
      let k = j;
      while (k < n && /\s/.test(text[k])) k++;
      if (k >= n) break;
      if (!/^[«"“¿¡(\[]?[\p{Lu}\p{N}]/u.test(text.slice(k, k + 2))) continue;
      if (ch === '.') {
        const before = /([\p{L}\p{N}]+)$/u.exec(text.slice(Math.max(start, i - 14), i));
        const word = before ? before[1] : '';
        if (ABBREVIATIONS.has(fold(word))) continue;
        if (word.length === 1 && /\p{Lu}/u.test(word)) continue;
        if (/^\d+$/.test(word) && i - word.length <= start + 1) continue;
      }
      const sentence = text.slice(start, j).trim();
      if (sentence) out.push(sentence);
      start = k;
      i = k - 1;
    }
    const tail = text.slice(start).trim();
    if (tail) out.push(tail);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Texto → bloques (títulos, párrafos, listas, código)                 */
  /* ------------------------------------------------------------------ */

  const KEYWORD_HEADING = /^(cap[ií]tulo|tema|unidad|secci[oó]n|m[oó]dulo|lecci[oó]n|parte|anexo|ap[eé]ndice|chapter|section|unit|part|lesson|module)\s+(\d+|[IVXLC]+)\b/i;
  const NUMBERED_HEADING = /^(\d{1,2}(?:\.\d{1,2}){0,3})[.)]?\s+(\p{Lu}.*)$/u;
  const BULLET_RE = /^(?:[-*•·▪◦‣●○■□➢➤✓✔]|\d{1,2}[.)]|[a-zA-Z][)])\s+(.+)$/;
  const STRONG_CODE = /^\s*(?:class\s+\w+\s*(?:\(.*\))?\s*[:{]|def\s+\w+\s*\(.*\)\s*:|function\s+\w+\s*\(|(?:public|private|protected)\s+(?:static\s+)?[\w<>[\]]+\s+\w+\s*[({;=]|#include\s*[<"]|import\s+[\w.]+\s*;|from\s+[\w.]+\s+import\s|(?:const|let|var)\s+\w+\s*=)/;
  const WEAK_CODE = /(?:[{};]\s*$|^\s*(?:return\b|pass$|print\s*\(|if\s*\(|for\s*\(|while\s*\(|else\b|elif\b|\}|#\s|\/\/|[\w.]+\s*=\s*[\w"'([]|[\w.]+\(.*\)\s*$)|^\s*(?:for|if|while|with|try|except|else|elif|def|class)\b.*:\s*$)/;

  function cleanHeading(text) {
    const original = text.replace(/\s+/g, ' ').trim();
    let t = original.replace(/^\d{1,2}(?:\.\d{1,2}){0,3}[.)]?\s+/, '');
    const keyword = /^(?:cap[ií]tulo|tema|unidad|secci[oó]n|m[oó]dulo|lecci[oó]n|parte|chapter|section|unit|part|lesson|module)\s+(?:\d+|[IVXLC]+)\s*[:.\-–—]\s*(.{3,})$/i.exec(t);
    if (keyword) t = keyword[1];
    t = t.replace(/[:\s]+$/, '');
    if (!/\p{L}{2}/u.test(t)) t = original;
    if (t.length > 4 && t === t.toUpperCase()) t = U.capitalize(t.toLowerCase());
    return U.truncate(t, 90);
  }

  function joinLines(lines) {
    let out = lines[0] || '';
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (/\p{L}-$/u.test(out) && /^\p{Ll}/u.test(line)) out = out.slice(0, -1) + line;
      else out += ' ' + line;
    }
    return out;
  }

  function guessHeading(line, startsBlock, next, nextIsAdjacent) {
    if (!startsBlock || line.length < 3 || line.length > 90) return 0;
    const words = line.split(' ').length;
    if (words > 12 || !/\p{L}{2}/u.test(line) || /[.,;:]$/.test(line)) return 0;
    if (KEYWORD_HEADING.test(line)) return 1;

    const numbered = NUMBERED_HEADING.exec(line);
    if (numbered) {
      const depth = numbered[1].split('.').length;
      if (words > 10) return 0;
      if (depth === 1 && nextIsAdjacent && /^\d{1,2}[.)]\s/.test(next)) return 0;
      return Math.min(4, depth);
    }

    const letters = line.replace(/[^\p{L}]/gu, '');
    if (letters.length >= 4 && line === line.toUpperCase() && /\p{Lu}{3}/u.test(line) && words <= 10) return 1;
    if (words <= 8 && /^[\p{Lu}¿¡]/u.test(line) && !/[.!]\s/.test(line) && line.indexOf(',') < 0 && next.length >= 70) return 2;
    return 0;
  }

  function parseBlocks(text) {
    const rawLines = String(text)
      .replace(/\r\n?/g, '\n')
      .replace(/[\u00AD\u200B\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .split('\n');

    const blocks = [];
    let para = [];
    let list = null;
    let code = null;
    let fence = false;

    const flushText = () => {
      if (para.length) {
        blocks.push({ type: 'p', text: joinLines(para) });
        para = [];
      }
      if (list) {
        blocks.push(list);
        list = null;
      }
    };
    const flushCode = () => {
      if (code) {
        while (code.lines.length && !code.lines[code.lines.length - 1].trim()) code.lines.pop();
        if (code.lines.length) blocks.push({ type: 'code', text: code.lines.join('\n'), lang: code.lang });
      }
      code = null;
    };

    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i].replace(/\t/g, '    ').replace(/\s+$/, '');
      const line = raw.replace(/\s+/g, ' ').trim();

      if (fence) {
        if (/^```/.test(line)) {
          fence = false;
          flushCode();
        } else {
          code.lines.push(raw);
        }
        continue;
      }
      if (/^```/.test(line)) {
        flushText();
        flushCode();
        fence = true;
        code = { lines: [], lang: line.slice(3).trim().toLowerCase() };
        continue;
      }
      if (code) {
        if (line && (STRONG_CODE.test(raw) || WEAK_CODE.test(raw) || /^\s{2,}\S/.test(raw))) {
          code.lines.push(raw);
          continue;
        }
        flushCode();
      }
      if (!line) {
        flushText();
        continue;
      }

      const explicit = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
      if (explicit) {
        flushText();
        blocks.push({ type: 'h', level: explicit[1].length, text: cleanHeading(explicit[2]) });
        continue;
      }
      if (STRONG_CODE.test(raw)) {
        flushText();
        code = { lines: [raw], lang: '' };
        continue;
      }

      let j = i + 1;
      while (j < rawLines.length && !rawLines[j].trim()) j++;
      const next = j < rawLines.length ? rawLines[j].replace(/\s+/g, ' ').trim() : '';
      const level = guessHeading(line, para.length === 0 && !list, next, j === i + 1);
      if (level) {
        flushText();
        blocks.push({ type: 'h', level, text: cleanHeading(line) });
        continue;
      }

      const bullet = BULLET_RE.exec(line);
      if (bullet) {
        if (para.length) {
          blocks.push({ type: 'p', text: joinLines(para) });
          para = [];
        }
        if (!list) list = { type: 'list', items: [] };
        list.items.push(bullet[1]);
        continue;
      }
      if (list) {
        list.items[list.items.length - 1] = joinLines([list.items[list.items.length - 1], line]);
        continue;
      }
      para.push(line);
    }
    flushText();
    flushCode();
    return blocks;
  }

  function blockWords(block) {
    if (block.type === 'p') return U.countWords(block.text);
    if (block.type === 'list') return block.items.reduce((sum, item) => sum + U.countWords(item), 0);
    return 0;
  }

  function wordsOf(blocks) {
    return blocks.reduce((sum, block) => sum + blockWords(block), 0);
  }

  /** Parte los párrafos muy largos y descarta los que no contienen texto útil. */
  function normalizeBlocks(blocks) {
    const out = [];
    blocks.forEach((block) => {
      if (block.type !== 'p') {
        out.push(block);
        return;
      }
      const letters = (block.text.match(/\p{L}/gu) || []).length;
      if (letters < 3) return;
      const words = U.countWords(block.text);
      if (words <= 130) {
        out.push(block);
        return;
      }
      const sentences = splitSentences(block.text);
      let group = [];
      let count = 0;
      sentences.forEach((sentence) => {
        const w = U.countWords(sentence);
        if (count + w > 95 && group.length) {
          out.push({ type: 'p', text: group.join(' ') });
          group = [];
          count = 0;
        }
        group.push(sentence);
        count += w;
      });
      if (group.length) out.push({ type: 'p', text: group.join(' ') });
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Bloques → temas y conceptos                                         */
  /* ------------------------------------------------------------------ */

  const SKIP_SECTION = /^(?:[ií]ndice|contenidos?|tabla de contenidos?|table of contents|bibliograf[ií]a|referencias(?: bibliogr[aá]ficas)?|references|agradecimientos|acknowledge?ments?)$/i;

  function buildOutline(blocks) {
    const rootNode = { title: '', level: -1, blocks: [], children: [] };
    const stack = [rootNode];
    let skipping = false;

    blocks.forEach((block) => {
      if (block.type === 'h') {
        skipping = SKIP_SECTION.test(block.text);
        if (skipping) return;
        const node = { title: block.text, level: block.level, blocks: [], children: [] };
        while (stack.length > 1 && stack[stack.length - 1].level >= node.level) stack.pop();
        stack[stack.length - 1].children.push(node);
        stack.push(node);
      } else if (!skipping) {
        stack[stack.length - 1].blocks.push(block);
      }
    });
    return rootNode;
  }

  function flattenParts(node, out) {
    node.children.forEach((child) => {
      out.push({ title: child.title, blocks: child.blocks });
      flattenParts(child, out);
    });
    return out;
  }

  /** Devuelve { title, topics: [{ title, parts: [{ title, blocks }] }] } a partir del esquema. */
  function outlineToTopics(rootNode) {
    let top = rootNode;
    let title = '';
    while (top.children.length === 1) {
      const only = top.children[0];
      if (!title) title = only.title;
      only.blocks = top.blocks.concat(only.blocks);
      top = only;
    }

    if (!top.children.length) return { title, topics: [], loose: top.blocks };

    const topics = [];
    if (wordsOf(top.blocks) >= 40) topics.push({ title: 'Introducción', parts: [{ title: '', blocks: top.blocks }] });
    else if (top.blocks.length) top.children[0].blocks = top.blocks.concat(top.children[0].blocks);

    top.children.forEach((child) => {
      const parts = [{ title: '', blocks: child.blocks }].concat(flattenParts(child, []));
      topics.push({ title: child.title, parts: parts.filter((part) => part.blocks.length) });
    });

    // Los temas casi vacíos se integran en un vecino para no crear lecciones huecas.
    const merged = [];
    topics.forEach((topic) => {
      const words = topic.parts.reduce((sum, part) => sum + wordsOf(part.blocks), 0);
      if (words < 30 && merged.length) {
        const prev = merged[merged.length - 1];
        topic.parts.forEach((part) => prev.parts.push({ title: part.title || topic.title, blocks: part.blocks }));
      } else if (words < 30 && !merged.length) {
        merged.push(Object.assign(topic, { tiny: true }));
      } else if (merged.length === 1 && merged[0].tiny) {
        const tiny = merged.pop();
        topic.parts = tiny.parts.concat(topic.parts);
        merged.push(topic);
      } else {
        merged.push(topic);
      }
    });
    return { title, topics: merged.filter((topic) => topic.parts.length), loose: [] };
  }

  /** Agrupa bloques en "conceptos" de tamaño cómodo para leer. */
  function chunkBlocks(blocks, targetWords) {
    const total = wordsOf(blocks);
    if (!blocks.length) return [];
    const count = U.clamp(Math.round(total / targetWords), 1, 8);
    const target = Math.ceil(total / count);
    const chunks = [];
    let current = [];
    let words = 0;
    let remaining = total;

    blocks.forEach((block) => {
      const w = blockWords(block);
      if (current.length && block.type === 'p' && words >= target * 0.85 && remaining >= 45) {
        chunks.push(current);
        current = [];
        words = 0;
      }
      current.push(block);
      words += w;
      remaining -= w;
    });
    if (current.length) chunks.push(current);
    return chunks;
  }

  function splitLooseTopics(blocks) {
    const total = wordsOf(blocks);
    const count = total < 260 ? 1 : U.clamp(Math.round(total / 430), 2, 8);
    const target = total / count;
    const groups = [];
    let current = [];
    let words = 0;
    blocks.forEach((block) => {
      if (current.length && block.type === 'p' && words >= target && groups.length < count - 1) {
        groups.push(current);
        current = [];
        words = 0;
      }
      current.push(block);
      words += blockWords(block);
    });
    if (current.length) groups.push(current);
    return groups.map((group) => ({ title: '', parts: [{ title: '', blocks: group }] }));
  }

  function conceptSentenceList(blocks) {
    const out = [];
    blocks.forEach((block) => {
      if (block.type === 'p') splitSentences(block.text).forEach((s) => out.push(s));
      else if (block.type === 'list') {
        block.items.forEach((item) => {
          const clean = item.trim();
          if (clean) out.push(/[.!?…]$/.test(clean) ? clean : clean + '.');
        });
      }
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Términos clave                                                      */
  /* ------------------------------------------------------------------ */

  function displayForm(forms, keepCase) {
    let best = '';
    let bestScore = -1;
    forms.forEach((count, form) => {
      const score = /^\p{Lu}\p{Ll}/u.test(form) ? count - 0.5 : count;
      if (score > bestScore) {
        bestScore = score;
        best = form;
      }
    });
    if (!keepCase && /^\p{Lu}\p{Ll}/u.test(best)) best = best.charAt(0).toLowerCase() + best.slice(1);
    return best;
  }

  function collectTerms(sentences, headings, totalWords) {
    const headingStems = new Set();
    headings.forEach((heading) => tokenize(heading).forEach((t) => t.content && headingStems.add(t.stem)));

    const singles = new Map();
    const grams = new Map();
    const touch = (map, key, form, init) => {
      let rec = map.get(key);
      if (!rec) {
        rec = Object.assign({ key, count: 0, forms: new Map() }, init);
        map.set(key, rec);
      }
      rec.count++;
      rec.forms.set(form, (rec.forms.get(form) || 0) + 1);
      return rec;
    };

    sentences.forEach((sentence) => {
      const tokens = tokenize(sentence);
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (!token.content) continue;
        const rec = touch(singles, token.stem, token.text, { stems: [token.stem], n: 1, afterDet: 0, capitalized: 0, masc: 0, fem: 0 });
        if (i > 0 && !token.breakBefore && DETERMINERS.has(tokens[i - 1].folded)) {
          rec.afterDet++;
          if (MASC_DET.has(tokens[i - 1].folded)) rec.masc++;
          else if (FEM_DET.has(tokens[i - 1].folded)) rec.fem++;
        }
        if (i > 0 && /^\p{Lu}/u.test(token.text)) rec.capitalized++;

        const stems = [token.stem];
        let connectors = 0;
        for (let j = i + 1; j < tokens.length && j <= i + 5; j++) {
          const next = tokens[j];
          if (next.breakBefore) break;
          if (next.content) {
            stems.push(next.stem);
            touch(grams, stems.join(' '), sentence.slice(token.index, next.end), { stems: stems.slice(), n: stems.length, head: token.stem });
            connectors = 0;
            if (stems.length >= 3) break;
          } else if (CONNECTORS.has(next.folded) && connectors < 2) {
            connectors++;
          } else {
            break;
          }
        }
      }
    });

    const nounLike = (rec) =>
      (rec.afterDet >= 1 && rec.afterDet / rec.count >= 0.12) || rec.capitalized / rec.count >= 0.6 || headingStems.has(rec.key);

    const minGram = sentences.length > 400 ? 3 : 2;
    let picked = [];
    grams.forEach((gram) => {
      if (gram.count < minGram) return;
      const head = singles.get(gram.head);
      if (!head || !nounLike(head)) return;
      let score = gram.count * 2.2 * (gram.n === 3 ? 1.15 : 1);
      if (gram.stems.every((s) => headingStems.has(s))) score *= 1.6;
      picked.push(Object.assign({}, gram, { score, text: displayForm(gram.forms, false) }));
    });

    // Un bigrama contenido casi siempre en un trigrama aporta lo mismo: se descarta.
    const dropped = new Set();
    picked.forEach((big) => {
      if (big.n !== 3) return;
      picked.forEach((small) => {
        if (small.n !== 2) return;
        const inside = big.key.indexOf(small.key + ' ') === 0 || big.key.slice(-small.key.length - 1) === ' ' + small.key;
        if (inside && big.count >= small.count * 0.8) dropped.add(small.key);
      });
    });
    picked = picked.filter((gram) => !dropped.has(gram.key));

    const covered = new Map();
    picked.forEach((gram) => gram.stems.forEach((s) => covered.set(s, Math.max(covered.get(s) || 0, gram.count))));

    const minSingle = sentences.length < 40 ? 2 : 3;
    singles.forEach((rec) => {
      const inHeading = headingStems.has(rec.key);
      if (rec.count < (inHeading ? Math.min(2, minSingle - 1) || 1 : minSingle)) return;
      if (!nounLike(rec)) return;
      if ((covered.get(rec.key) || 0) >= rec.count * 0.67) return;
      const score = rec.count * (0.8 + Math.min(rec.key.length, 10) / 10) * (inHeading ? 1.6 : 1);
      picked.push(Object.assign({}, rec, { score, text: displayForm(rec.forms, rec.capitalized / rec.count >= 0.6) }));
    });

    // Con textos muy breves casi nada se repite: se completa con las palabras más frecuentes.
    if (picked.length < 8) {
      const have = new Set(picked.map((t) => t.key));
      Array.from(singles.values())
        .filter((rec) => !have.has(rec.key) && rec.key.length >= 4 && (covered.get(rec.key) || 0) < rec.count)
        .sort((a, b) => b.count - a.count || b.key.length - a.key.length)
        .slice(0, 8 - picked.length)
        .forEach((rec) => picked.push(Object.assign({}, rec, { score: rec.count * 0.5, text: displayForm(rec.forms, rec.capitalized / rec.count >= 0.6) })));
    }

    // Género gramatical aproximado (según los artículos que acompañan al término).
    const genderOf = (term) => {
      const head = singles.get(term.stems[0]);
      if (!head || head.masc === head.fem) return '';
      return head.masc > head.fem ? 'm' : 'f';
    };

    const limit = U.clamp(Math.round(totalWords / 45), 10, 70);
    return picked
      .filter((term) => term.text && term.text.length >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((term) => ({ key: term.key, text: term.text, stems: term.stems, n: term.n, count: term.count, score: term.score, gender: genderOf(term) }));
  }

  /** Posición de un término dentro de una oración (admite plural/singular y conectores). */
  function findTerm(sentence, term) {
    const tokens = tokenize(sentence);
    const stems = term.stems;
    for (let a = 0; a < tokens.length; a++) {
      if (!tokens[a].content || tokens[a].stem !== stems[0]) continue;
      let matched = 1;
      let b = a;
      while (matched < stems.length) {
        b++;
        if (b >= tokens.length || tokens[b].breakBefore) break;
        if (!tokens[b].content) {
          if (CONNECTORS.has(tokens[b].folded)) continue;
          break;
        }
        if (tokens[b].stem !== stems[matched]) break;
        matched++;
      }
      if (matched === stems.length) return { start: tokens[a].index, end: tokens[b].end };
    }
    return null;
  }

  function adHocTerm(text) {
    const stems = contentStems(text);
    if (!stems.length) return null;
    return { key: stems.join(' '), text, stems, n: stems.length, count: 1, score: 1 };
  }

  /* ------------------------------------------------------------------ */
  /* Preguntas, flashcards y pregunta abierta                            */
  /* ------------------------------------------------------------------ */

  const DEFINITION_RE = /^(?:(?:el|la|los|las|un|una|the|an?)\s+)?(.{2,70}?)\s+(es|son|se define como|se definen como|consiste en|consisten en|se refiere a|se refieren a|se denomina|se conoce como|significa|representa|is|are|refers to|means|is defined as)\s+(.{25,})$/iu;
  const DEFINITION_NEXT = /^(?:un|una|unos|unas|el|la|los|las|aquel|aquella|aquello|lo que|cuando|a|an|the|one)\b/i;

  function parseDefinition(sentence, terms) {
    if (/\?$/.test(sentence)) return null;
    const match = DEFINITION_RE.exec(sentence);
    if (!match) return null;
    const subject = match[1].trim();
    const verb = match[2];
    const predicate = match[3].trim();
    if (/[,;:()«»"“”]/.test(subject) || subject.split(/\s+/).length > 6) return null;
    if (/^(?:es|son|is|are)$/i.test(verb) && !DEFINITION_NEXT.test(predicate)) return null;
    const subjectTokens = tokenize(subject);
    if (!subjectTokens.length || !subjectTokens.some((t) => t.content)) return null;

    // El sujeto debe coincidir por completo con un término conocido; si no,
    // el propio sujeto se usa como término (p. ej. "programación orientada a objetos").
    const subjectKey = contentStems(subject).join(' ');
    const known = terms.find((term) => term.key === subjectKey);
    const term = known || (subjectTokens.length <= 5 ? adHocTerm(subject.replace(/^(?:el|la|los|las|un|una|the|an?)\s+/i, '')) : null);
    if (!term) return null;
    return { term, verb, predicate, plural: /^(?:son|se definen|consisten|se refieren|are)/i.test(verb) };
  }

  function sharesStem(a, b) {
    return a.stems.some((s) => b.stems.indexOf(s) >= 0);
  }

  /** Términos alternativos para las opciones: parecidos en longitud y, si se conoce, en género. */
  function pickDistractors(answer, pool, count, rnd, sentence) {
    const candidates = pool.filter((term) => term.key !== answer.key && !sharesStem(term, answer) && !(sentence && findTerm(sentence, term)));
    const mismatch = (term) => (answer.gender && term.gender && term.gender !== answer.gender ? 1 : 0);
    const ranked = U.shuffle(candidates, rnd).sort(
      (a, b) => mismatch(a) - mismatch(b) || Math.abs(a.n - answer.n) - Math.abs(b.n - answer.n)
    );
    return ranked.slice(0, count);
  }

  function shuffledOptions(answerText, distractorTexts, rnd) {
    const options = U.shuffle([answerText].concat(distractorTexts), rnd);
    return { options: options.map((o) => U.capitalize(o)), answer: options.indexOf(answerText) };
  }

  function blankTerm(sentence, term) {
    let out = sentence;
    for (let guard = 0; guard < 4; guard++) {
      const pos = findTerm(out, term);
      if (!pos) break;
      out = out.slice(0, pos.start) + '_____' + out.slice(pos.end);
    }
    return out;
  }

  function buildConceptPractice(concept, info, ctx) {
    const rnd = ctx.rnd;
    const questions = [];
    const cards = [];
    const usedSentences = new Set();
    const addQuestion = (q) => {
      q.id = concept.id + '-q' + (questions.length + 1);
      q.conceptId = concept.id;
      questions.push(q);
    };

    const usable = info.sentences.filter((s) => s.text.length >= 45 && s.text.length <= 300 && !/\?$/.test(s.text));

    // 1) Definiciones: "_____ es ..." → ¿de qué concepto se habla?
    const definitions = [];
    usable.forEach((s) => {
      const def = parseDefinition(s.text, ctx.terms);
      if (def) definitions.push({ sentence: s, def });
    });
    definitions.slice(0, 2).forEach((item, index) => {
      const distractors = pickDistractors(item.def.term, ctx.terms, 3, rnd, item.sentence.text);
      if (index === 0 && distractors.length >= 2) {
        const set = shuffledOptions(item.def.term.text, distractors.map((d) => d.text), rnd);
        addQuestion({
          type: 'concept',
          skill: 'comprension',
          stem: '¿A qué concepto se refiere esta descripción?',
          quote: '_____ ' + item.def.verb + ' ' + item.def.predicate,
          options: set.options,
          answer: set.answer,
          explanation: item.sentence.text
        });
        usedSentences.add(item.sentence.text);
      }
      cards.push({
        front: (item.def.plural ? '¿Qué son ' : '¿Qué es ') + '«' + item.def.term.text + '»?',
        back: item.sentence.text,
        hint: 'Piensa en cómo lo define tu material en «' + concept.title + '».'
      });
    });

    // 2) Completar: se oculta un término clave de una oración importante.
    const clozeCandidates = usable
      .filter((s) => !usedSentences.has(s.text) && s.terms.length && s.text.length >= 60)
      .sort((a, b) => b.score - a.score);
    let clozeCount = 0;
    const clozeTerms = new Set();
    clozeCandidates.forEach((s) => {
      if (clozeCount >= 2) return;
      const term = s.terms.slice().sort((a, b) => b.n - a.n || b.score - a.score).find((t) => !clozeTerms.has(t.key));
      if (!term) return;
      const distractors = pickDistractors(term, ctx.terms, 3, rnd, s.text);
      if (distractors.length < 2) return;
      // La opción correcta se muestra tal como aparece en la oración (respeta el plural).
      const pos = findTerm(s.text, term);
      let shown = pos ? s.text.slice(pos.start, pos.end) : term.text;
      if (fold(shown) === fold(term.text)) shown = term.text;
      else if (pos && pos.start === 0) shown = shown.charAt(0).toLowerCase() + shown.slice(1);
      const set = shuffledOptions(shown, distractors.map((d) => d.text), rnd);
      addQuestion({
        type: 'cloze',
        skill: 'aplicacion',
        stem: 'Completa la idea según tu material:',
        quote: blankTerm(s.text, term),
        options: set.options,
        answer: set.answer,
        explanation: s.text
      });
      usedSentences.add(s.text);
      clozeTerms.add(term.key);
      clozeCount++;
    });

    // 3) Verdadero o falso: la oración original o una versión con un término cambiado.
    //    Solo se altera cuando el cambio encaja gramaticalmente (misma forma y género).
    const tfPool = usable.filter((s) => !usedSentences.has(s.text) && s.terms.length && s.text.length <= 240).sort((a, b) => b.score - a.score);
    const falseVersion = (s) => {
      const ordered = s.terms.slice().sort((a, b) => b.n - a.n || b.score - a.score);
      for (let i = 0; i < ordered.length; i++) {
        const term = ordered[i];
        const pos = findTerm(s.text, term);
        if (!pos || fold(s.text.slice(pos.start, pos.end)) !== fold(term.text)) continue;
        // Un término contenido en otro más largo (p. ej. "clase" dentro de "clase base") no se toca.
        if (ordered.some((other) => other !== term && other.n > term.n && sharesStem(other, term))) continue;
        const swap = pickDistractors(term, ctx.terms, 6, rnd, s.text).find(
          (cand) => cand.n === term.n && (term.gender ? cand.gender === term.gender : !cand.gender)
        );
        if (!swap) continue;
        const replacement = pos.start === 0 ? U.capitalize(swap.text) : swap.text;
        return s.text.slice(0, pos.start) + replacement + s.text.slice(pos.end);
      }
      return null;
    };
    let tfSource = tfPool[0];
    let statement = tfSource ? tfSource.text : '';
    let makeFalse = false;
    if (tfSource && rnd() < 0.6) {
      for (let i = 0; i < tfPool.length && i < 4; i++) {
        const altered = falseVersion(tfPool[i]);
        if (altered) {
          tfSource = tfPool[i];
          statement = altered;
          makeFalse = true;
          break;
        }
      }
    }
    if (tfSource) {
      addQuestion({
        type: 'tf',
        skill: 'analisis',
        stem: '¿Esta afirmación coincide con lo que dice tu material?',
        quote: statement,
        options: ['Verdadero', 'Falso'],
        answer: makeFalse ? 1 : 0,
        explanation: makeFalse ? 'El material dice: «' + tfSource.text + '»' : 'Así lo explica tu material en «' + concept.title + '».'
      });
      usedSentences.add(tfSource.text);
    }

    // 4) Relación: ¿en qué parte del material se desarrolla esta idea?
    if (ctx.titles.length >= 3) {
      const titleStems = new Set();
      ctx.titles.forEach((title) => contentStems(title).forEach((s) => titleStems.add(s)));
      const own = info.terms.find((entry) => entry.exclusive && !entry.term.stems.some((s) => titleStems.has(s)));
      if (own) {
        const others = U.shuffle(ctx.titles.filter((title) => title !== concept.title), rnd).slice(0, 3);
        const set = shuffledOptions(concept.title, others, rnd);
        const source = info.sentences.find((s) => s.terms.indexOf(own.term) >= 0);
        addQuestion({
          type: 'where',
          skill: 'sintesis',
          stem: '¿En qué parte de tu material se desarrolla la idea de «' + own.term.text + '»?',
          quote: '',
          options: set.options,
          answer: set.answer,
          explanation: 'Se explica en «' + concept.title + '»' + (source ? ': ' + source.text : '.')
        });
      }
    }

    // Flashcards adicionales a partir de los términos propios del concepto.
    info.terms.forEach((entry) => {
      if (cards.length >= 3) return;
      const term = entry.term;
      if (cards.some((card) => card.front.indexOf('«' + term.text + '»') >= 0)) return;
      const source = info.sentences
        .filter((s) => s.terms.indexOf(term) >= 0 && s.text.length <= 280 && !/\?$/.test(s.text))
        .sort((a, b) => b.score - a.score)[0];
      if (!source) return;
      cards.push({
        front: '¿Qué dice tu material sobre «' + term.text + '»?',
        back: source.text,
        hint: 'Se explica en «' + concept.title + '».'
      });
    });

    cards.forEach((card, i) => {
      card.id = concept.id + '-f' + (i + 1);
      card.conceptId = concept.id;
    });
    concept.questions = questions;
    concept.cards = cards.slice(0, 3);
  }

  /* ------------------------------------------------------------------ */
  /* Construcción del curso                                              */
  /* ------------------------------------------------------------------ */

  function prettifyFileName(name) {
    const base = String(name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return base ? U.capitalize(base) : '';
  }

  function detectLanguage(sentences) {
    let es = 0;
    let en = 0;
    sentences.slice(0, 120).forEach((sentence) => {
      tokenize(sentence).forEach((token) => {
        if (STOP_ES_SET.has(token.folded)) es++;
        if (STOP_EN_SET.has(token.folded)) en++;
      });
    });
    return en > es * 1.3 ? 'en' : 'es';
  }

  function joinNatural(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' y ' + items[items.length - 1];
  }

  /**
   * Construye el curso completo a partir del texto extraído de un documento.
   * @param {string} text Texto plano (los títulos pueden venir marcados con "#").
   * @param {{ fileName?: string, title?: string }} options
   */
  function buildCourse(text, options) {
    const opts = options || {};
    const blocks = normalizeBlocks(parseBlocks(text));
    const totalWords = wordsOf(blocks);
    if (totalWords < 60) {
      throw new AnalyzeError('too-short', 'El documento tiene muy poco texto para crear un curso (se necesitan al menos unas 60 palabras).');
    }

    const outline = outlineToTopics(buildOutline(blocks));
    let draftTopics = outline.topics;
    if (!draftTopics.length) draftTopics = splitLooseTopics(outline.loose);
    else if (draftTopics.length === 1 && draftTopics[0].parts.length === 1 && wordsOf(draftTopics[0].parts[0].blocks) > 520) {
      const single = draftTopics[0];
      if (!outline.title) outline.title = single.title;
      draftTopics = splitLooseTopics(single.parts[0].blocks);
    }

    // Borrador de temas y conceptos (aún sin títulos automáticos).
    let conceptCounter = 0;
    const headings = [];
    const topics = draftTopics.map((draft, ti) => {
      if (draft.title) headings.push(draft.title);
      const concepts = [];
      draft.parts.forEach((part) => {
        if (part.title) headings.push(part.title);
        const chunks = chunkBlocks(part.blocks, 170);
        chunks.forEach((chunk, index) => {
          if (wordsOf(chunk) < 12 && concepts.length) {
            concepts[concepts.length - 1].blocks.push.apply(concepts[concepts.length - 1].blocks, chunk);
            return;
          }
          conceptCounter++;
          concepts.push({
            id: 'c' + conceptCounter,
            title: part.title ? (index === 0 ? part.title : part.title + ' · parte ' + (index + 1)) : '',
            autoTitle: !part.title,
            blocks: chunk
          });
        });
      });
      return { id: 't' + (ti + 1), title: draft.title, autoTitle: !draft.title, concepts };
    }).filter((topic) => topic.concepts.length);

    if (!topics.length) {
      throw new AnalyzeError('too-short', 'No se encontró contenido suficiente en el documento.');
    }

    // Oraciones y términos clave de todo el material.
    const infoByConcept = new Map();
    const allSentences = [];
    topics.forEach((topic) =>
      topic.concepts.forEach((concept) => {
        const sentences = conceptSentenceList(concept.blocks);
        infoByConcept.set(concept, { sentences: sentences.map((text) => ({ text, terms: [], score: 0 })), terms: [] });
        sentences.forEach((s) => allSentences.push(s));
      })
    );

    const terms = collectTerms(allSentences, headings, totalWords);
    const conceptCount = infoByConcept.size;
    const termDf = new Map();

    infoByConcept.forEach((info) => {
      const counts = new Map();
      info.sentences.forEach((s) => {
        terms.forEach((term) => {
          if (findTerm(s.text, term)) {
            s.terms.push(term);
            counts.set(term, (counts.get(term) || 0) + 1);
          }
        });
        let score = s.terms.reduce((sum, term) => sum + Math.log2(1 + term.score), 0);
        if (s.text.length < 50) score *= 0.5;
        else if (s.text.length > 260) score *= 0.6;
        if (/\?$/.test(s.text)) score *= 0.3;
        if (DEFINITION_RE.test(s.text)) score *= 1.25;
        s.score = score;
      });
      info.counts = counts;
      counts.forEach((count, term) => termDf.set(term, (termDf.get(term) || 0) + 1));
    });

    infoByConcept.forEach((info) => {
      info.terms = Array.from(info.counts.entries())
        .map((entry) => {
          const df = termDf.get(entry[0]) || 1;
          return { term: entry[0], weight: entry[1] * Math.log(1 + conceptCount / df) * (1 + entry[0].n * 0.15), exclusive: df === 1 };
        })
        .sort((a, b) => b.weight - a.weight);
    });

    // Títulos automáticos donde el documento no los trae.
    const usedTitles = new Set();
    const titleFromTerms = (entries, fallback) => {
      const fresh = entries.filter((entry) => !usedTitles.has(entry.term.key));
      const chosen = (fresh.length ? fresh : entries).slice(0, 2);
      if (!chosen.length) return fallback;
      chosen.forEach((entry) => usedTitles.add(entry.term.key));
      const names = chosen.filter((entry, i) => i === 0 || !sharesStem(entry.term, chosen[0].term)).map((entry) => entry.term.text);
      return U.capitalize(joinNatural(names));
    };

    topics.forEach((topic, ti) => {
      topic.concepts.forEach((concept, ci) => {
        if ((concept.autoTitle || !concept.title) && topic.concepts.length === 1 && topic.title && !topic.autoTitle) {
          // Un tema con un único concepto sin título propio hereda el título del tema.
          concept.title = topic.title;
          return;
        }
        if (concept.autoTitle || !concept.title) {
          concept.title = titleFromTerms(infoByConcept.get(concept).terms, 'Idea ' + (ci + 1));
        }
      });
      if (topic.autoTitle || !topic.title) {
        const weights = new Map();
        topic.concepts.forEach((concept) =>
          infoByConcept.get(concept).terms.forEach((entry) => weights.set(entry.term, (weights.get(entry.term) || 0) + entry.weight))
        );
        const ranked = Array.from(weights.entries()).sort((a, b) => b[1] - a[1]).map((entry) => ({ term: entry[0] }));
        const first = ranked[0];
        topic.title = first ? U.capitalize(first.term.text) + (ranked[1] && !sharesStem(ranked[1].term, first.term) ? ' y ' + ranked[1].term.text : '') : 'Tema ' + (ti + 1);
      }
    });

    // Títulos repetidos confunden en las preguntas de relación: se numeran.
    const seenTitles = new Map();
    topics.forEach((topic) =>
      topic.concepts.forEach((concept) => {
        const key = fold(concept.title);
        const count = (seenTitles.get(key) || 0) + 1;
        seenTitles.set(key, count);
        if (count > 1) concept.title += ' (' + count + ')';
      })
    );

    const allTitles = [];
    topics.forEach((topic) => topic.concepts.forEach((concept) => allTitles.push(concept.title)));
    const seed = U.hashString(allSentences.slice(0, 40).join('|'));
    const ctx = { rnd: U.seededRandom(seed), terms, titles: allTitles };

    topics.forEach((topic) => {
      const topicWeights = new Map();
      topic.concepts.forEach((concept) => {
        const info = infoByConcept.get(concept);
        const ranked = info.sentences.slice().sort((a, b) => b.score - a.score);
        // La idea central es, si existe, la primera definición del concepto; si no, la oración más relevante.
        const leadSentence =
          info.sentences.slice(0, 4).find((s) => s.text.length >= 40 && s.text.length <= 220 && parseDefinition(s.text, terms)) ||
          ranked.find((s) => s.text.length >= 40 && s.text.length <= 190 && !/\?$/.test(s.text));
        concept.lead = leadSentence ? leadSentence.text : U.truncate(info.sentences.length ? info.sentences[0].text : '', 190);
        const pointSet = new Set(
          ranked.filter((s) => s.text !== concept.lead && s.text.length >= 40 && s.text.length <= 260 && !/\?$/.test(s.text)).slice(0, 3).map((s) => s.text)
        );
        concept.keyPoints = info.sentences.filter((s) => pointSet.has(s.text)).map((s) => s.text);
        concept.terms = info.terms.slice(0, 5).map((entry) => entry.term.text);
        concept.words = wordsOf(concept.blocks);
        concept.minutes = Math.max(1, Math.round(concept.words / 180));
        info.terms.forEach((entry) => topicWeights.set(entry.term, (topicWeights.get(entry.term) || 0) + entry.weight));
        buildConceptPractice(concept, info, ctx);
        delete concept.autoTitle;
      });

      const topicTerms = Array.from(topicWeights.entries()).sort((a, b) => b[1] - a[1]).map((entry) => entry[0]);
      topic.terms = topicTerms.slice(0, 6).map((term) => term.text);
      topic.minutes = Math.max(1, topic.concepts.reduce((sum, concept) => sum + concept.minutes, 0));
      topic.words = topic.concepts.reduce((sum, concept) => sum + concept.words, 0);
      const subtitleTerms = topicTerms.filter((term) => fold(topic.title).indexOf(fold(term.text)) < 0).slice(0, 3).map((term) => term.text);
      topic.subtitle = subtitleTerms.length ? U.capitalize(joinNatural(subtitleTerms)) : U.plural(topic.concepts.length, 'concepto', 'conceptos');

      const reference = [];
      topic.concepts.forEach((concept) => {
        if (reference.length < 3 && concept.lead) reference.push(concept.lead);
      });
      const openTerms = topic.terms.slice(0, 4);
      topic.open = {
        prompt:
          'Explica con tus palabras la idea central de «' + topic.title + '»' +
          (openTerms.length >= 2 ? ' y cómo se relacionan ' + joinNatural(openTerms.slice(0, 3).map((t) => '«' + t + '»')) + '.' : '.'),
        terms: openTerms,
        reference
      };
      delete topic.autoTitle;
    });

    const title = opts.title || outline.title || prettifyFileName(opts.fileName) || U.capitalize(topics[0].title) || 'Material sin título';
    return {
      title: U.truncate(title, 80),
      lang: detectLanguage(allSentences),
      words: totalWords,
      minutes: topics.reduce((sum, topic) => sum + topic.minutes, 0),
      terms: terms.slice(0, 30).map((term) => term.text),
      topics
    };
  }

  /* ------------------------------------------------------------------ */
  /* Utilidades sobre un curso ya creado                                 */
  /* ------------------------------------------------------------------ */

  const sentenceCache = new WeakMap();

  function conceptSentences(concept) {
    let list = sentenceCache.get(concept);
    if (!list) {
      list = conceptSentenceList(concept.blocks);
      sentenceCache.set(concept, list);
    }
    return list;
  }

  function conceptText(concept) {
    return conceptSentences(concept).join(' ');
  }

  function countConcepts(material) {
    return material.topics.reduce((sum, topic) => sum + topic.concepts.length, 0);
  }

  function findConcept(material, conceptId) {
    for (let ti = 0; ti < material.topics.length; ti++) {
      const concepts = material.topics[ti].concepts;
      for (let ci = 0; ci < concepts.length; ci++) {
        if (concepts[ci].id === conceptId) return { topic: material.topics[ti], concept: concepts[ci], ti, ci };
      }
    }
    return null;
  }

  function prepareQuestion(question, rnd) {
    if (question.type === 'tf') return Object.assign({}, question);
    const correct = question.options[question.answer];
    const options = U.shuffle(question.options, rnd);
    return Object.assign({}, question, { options, answer: options.indexOf(correct) });
  }

  /**
   * Selecciona preguntas para una evaluación.
   * Reparte entre conceptos y tipos, priorizando el concepto indicado.
   */
  function pickQuestions(material, options) {
    const opts = options || {};
    const count = opts.count || 5;
    const rnd = opts.random || Math.random;
    const avoid = new Set(opts.avoidIds || []);
    const allowed = opts.conceptIds ? new Set(opts.conceptIds) : null;

    let concepts = [];
    if (typeof opts.topicIndex === 'number' && material.topics[opts.topicIndex]) concepts = material.topics[opts.topicIndex].concepts.slice();
    else material.topics.forEach((topic) => concepts.push.apply(concepts, topic.concepts));
    if (allowed) concepts = concepts.filter((concept) => allowed.has(concept.id));

    if (opts.focusConceptId) {
      concepts.sort((a, b) => (a.id === opts.focusConceptId ? -1 : 0) - (b.id === opts.focusConceptId ? -1 : 0));
    }

    const queues = concepts
      .map((concept) => {
        const fresh = U.shuffle(concept.questions.filter((q) => !avoid.has(q.id)), rnd);
        const seen = U.shuffle(concept.questions.filter((q) => avoid.has(q.id)), rnd);
        return fresh.concat(seen);
      })
      .filter((queue) => queue.length);

    const picked = [];
    const typeCount = {};
    while (picked.length < count && queues.some((queue) => queue.length)) {
      for (let i = 0; i < queues.length && picked.length < count; i++) {
        const queue = queues[i];
        if (!queue.length) continue;
        // Se prefiere el tipo de pregunta menos usado hasta ahora.
        let bestIndex = 0;
        for (let k = 1; k < queue.length; k++) {
          if ((typeCount[queue[k].type] || 0) < (typeCount[queue[bestIndex].type] || 0)) bestIndex = k;
        }
        const question = queue.splice(bestIndex, 1)[0];
        typeCount[question.type] = (typeCount[question.type] || 0) + 1;
        picked.push(prepareQuestion(question, rnd));
      }
    }
    return picked;
  }

  function pickCards(material, conceptIds, limit) {
    const allowed = new Set(conceptIds || []);
    const out = [];
    material.topics.forEach((topic) =>
      topic.concepts.forEach((concept) => {
        if (allowed.size && !allowed.has(concept.id)) return;
        concept.cards.forEach((card) => out.push(Object.assign({ conceptTitle: concept.title }, card)));
      })
    );
    return out.slice(0, limit || 6);
  }

  /** Evalúa una respuesta abierta por cobertura de los términos clave del tema. */
  function evaluateOpenAnswer(answer, open) {
    const stems = new Set(contentRoots(answer));
    const words = U.countWords(answer);
    const matched = [];
    const missing = [];
    (open.terms || []).forEach((term) => {
      const termStems = contentRoots(term);
      const hit = termStems.length > 0 && termStems.every((s) => stems.has(s));
      (hit ? matched : missing).push(term);
    });
    const total = matched.length + missing.length;
    const coverage = total ? matched.length / total : words >= 25 ? 0.7 : 0.4;
    const depth = Math.min(1, words / 40);
    const score = Math.round(100 * (0.75 * coverage + 0.25 * depth));
    let verdict;
    if (score >= 80) verdict = 'Muy buena explicación: conectas las ideas principales del tema.';
    else if (score >= 55) verdict = 'Vas por buen camino. Tu respuesta cubre parte de las ideas clave.';
    else verdict = 'Tu respuesta aún es parcial. Intenta relacionar los conceptos clave entre sí.';
    return { score, matched, missing, words, verdict, reference: open.reference || [] };
  }

  /* ------------------------------------------------------------------ */
  /* Tutor: responde buscando en el material                             */
  /* ------------------------------------------------------------------ */

  const indexCache = new WeakMap();

  function materialIndex(material) {
    let index = indexCache.get(material);
    if (index) return index;
    const sentences = [];
    const df = new Map();
    material.topics.forEach((topic, ti) =>
      topic.concepts.forEach((concept, ci) => {
        conceptSentences(concept).forEach((text) => {
          const stems = new Set(contentRoots(text));
          if (stems.size < 2) return;
          sentences.push({ text, stems, ti, ci });
          stems.forEach((s) => df.set(s, (df.get(s) || 0) + 1));
        });
      })
    );
    index = { sentences, df };
    indexCache.set(material, index);
    return index;
  }

  const QUERY_NOISE = new Set(
    ('que como cual cuales explica explicame explicar dime significa significado define definir definicion quiero saber puedes podrias acerca ' +
      'diferencia sirve funciona hablame cuentame entender ayuda ayudame tema material documento what how explain tell mean means define about')
      .split(' ')
      .map(broadStem)
  );
  const EXAMPLE_RE = /\b(?:por ejemplo|ejemplo|como por|tal como|tales como|such as|for example|e\.g\.)/i;

  function defaultSuggestions(concept) {
    const out = ['Resúmelo', 'Dame un ejemplo', 'Hazme una pregunta'];
    if (concept.terms && concept.terms[0]) out.push('¿Qué es ' + concept.terms[0] + '?');
    return out;
  }

  /**
   * Genera la respuesta del tutor.
   * @param material Material activo.
   * @param where { ti, ci } Tema y concepto que el estudiante está viendo.
   * @param message Texto del estudiante.
   * @param session Objeto mutable para recordar una pregunta pendiente.
   */
  function tutorReply(material, where, message, session) {
    const text = String(message || '').trim();
    const low = fold(text);
    const topic = material.topics[where.ti] || material.topics[0];
    const concept = topic.concepts[where.ci] || topic.concepts[0];
    const reply = { parts: [], source: null, suggestions: defaultSuggestions(concept) };
    const say = (t) => reply.parts.push({ type: 'p', text: t });
    const quote = (t) => reply.parts.push({ type: 'quote', text: t });
    const state = session || {};

    if (state.pending) {
      const pending = state.pending;
      const letter = /^\s*(?:la\s+|opcion\s+|es\s+la\s+)?([a-d])\b[).]?\s*$/i.exec(low);
      const truth = /^\s*(verdadero|falso|v|f)\s*$/i.exec(low);
      let chosen = -1;
      if (letter) chosen = letter[1].toLowerCase().charCodeAt(0) - 97;
      else if (truth && pending.options.length === 2) chosen = /^(v|verdadero)$/i.test(truth[1]) ? 0 : 1;
      if (chosen >= 0 && chosen < pending.options.length) {
        state.pending = null;
        if (chosen === pending.answer) say('¡Correcto! ' + pending.options[pending.answer] + ' es la respuesta.');
        else say('No exactamente. La respuesta correcta es: ' + pending.options[pending.answer] + '.');
        quote(pending.explanation);
        return reply;
      }
      state.pending = null;
    }

    const stems = contentRoots(text).filter((s) => !QUERY_NOISE.has(s));

    if (/^(hola|buenas|buenos dias|buenas tardes|hey|hi|hello|que tal)\b/.test(low) && stems.length <= 1) {
      say('¡Hola! Estoy aquí para ayudarte con «' + concept.title + '». Puedes pedirme un resumen, un ejemplo o que te haga una pregunta.');
      return reply;
    }
    if (/\b(gracias|thanks|thank you)\b/.test(low)) {
      say('¡Con gusto! Cuando quieras seguimos repasando «' + topic.title + '».');
      return reply;
    }

    if (/\b(resum\w*|sintesis|sintetiza\w*|puntos clave|ideas? clave|idea principal|ideas principales|summary|summarize)\b/.test(low)) {
      say('En resumen, «' + concept.title + '» trata de lo siguiente:');
      const points = [concept.lead].concat(concept.keyPoints || []).filter(Boolean);
      reply.parts.push({ type: 'list', items: points.slice(0, 4) });
      reply.source = { ti: where.ti, ci: where.ci };
      return reply;
    }

    if (/\b(ejemplos?|examples?)\b/.test(low)) {
      const pools = [conceptSentences(concept)];
      pools.push(topic.concepts.reduce((all, c) => all.concat(conceptSentences(c)), []));
      let found = null;
      for (let i = 0; i < pools.length && !found; i++) found = pools[i].find((s) => EXAMPLE_RE.test(s)) || null;
      const codeBlock = concept.blocks.find((block) => block.type === 'code');
      if (found) {
        say('Tu material incluye este ejemplo:');
        quote(found);
      } else if (codeBlock) {
        say('Tu material lo ilustra con este fragmento:');
        reply.parts.push({ type: 'code', text: codeBlock.text });
      } else {
        say('Tu material no trae un ejemplo explícito de esta parte. La idea que conviene poder ejemplificar es:');
        quote(concept.lead);
        say('Intenta proponer tú un caso concreto: es una de las mejores formas de comprobar que lo entendiste.');
      }
      reply.source = { ti: where.ti, ci: where.ci };
      return reply;
    }

    if (/\b(pregunta\w*|evalua\w*|ponme a prueba|quiz|test|examen)\b/.test(low)) {
      const pool = concept.questions.length ? concept.questions : topic.concepts.reduce((all, c) => all.concat(c.questions), []);
      if (!pool.length) {
        say('Este fragmento es muy breve para generar una pregunta. Prueba con otro concepto del tema.');
        return reply;
      }
      const question = prepareQuestion(pool[Math.floor(Math.random() * pool.length)], Math.random);
      state.pending = { options: question.options, answer: question.answer, explanation: question.explanation };
      say(question.stem);
      if (question.quote) quote(question.quote);
      reply.parts.push({ type: 'list', items: question.options.map((option, i) => String.fromCharCode(65 + i) + ') ' + option) });
      say(question.options.length === 2 ? 'Responde «verdadero» o «falso».' : 'Responde con la letra de tu opción.');
      reply.suggestions = question.options.length === 2 ? ['Verdadero', 'Falso'] : question.options.map((o, i) => String.fromCharCode(65 + i));
      return reply;
    }

    if (/\b(no entiendo|no entendi|no comprendo|mas simple|mas facil|mas sencillo|simplifica\w*|explicamelo|explicalo)\b/.test(low) && stems.length <= 2) {
      const shortest = conceptSentences(concept).filter((s) => s.length >= 40).sort((a, b) => a.length - b.length)[0];
      say('Vamos paso a paso. La idea central es:');
      quote(concept.lead);
      if (shortest && shortest !== concept.lead) {
        say('Dicho de la forma más breve que aparece en tu material:');
        quote(shortest);
      }
      if (concept.terms.length) say('Fíjate sobre todo en: ' + joinNatural(concept.terms.slice(0, 3)) + '.');
      reply.source = { ti: where.ti, ci: where.ci };
      return reply;
    }

    if (!stems.length) {
      say('¿Sobre qué parte de «' + concept.title + '» quieres que profundice? Puedes preguntarme por un término o pedirme un resumen.');
      return reply;
    }

    const index = materialIndex(material);
    const unique = Array.from(new Set(stems));
    const total = index.sentences.length || 1;
    const wantsDefinition = /\b(que es|que son|que significa|define|definicion|what is|what are)\b/.test(low);
    const scored = [];
    index.sentences.forEach((entry) => {
      let sum = 0;
      let hits = 0;
      unique.forEach((s) => {
        if (entry.stems.has(s)) {
          sum += Math.log(1 + total / (index.df.get(s) || 1));
          hits++;
        }
      });
      if (!hits) return;
      const coverage = hits / unique.length;
      let score = sum * (0.6 + 0.4 * coverage);
      if (entry.ti === where.ti) score *= entry.ci === where.ci ? 1.25 : 1.1;
      if (wantsDefinition && DEFINITION_RE.test(entry.text)) score *= 1.35;
      if (entry.text.length > 320) score *= 0.8;
      if (/\?$/.test(entry.text)) score *= 0.5;
      scored.push({ entry, score, coverage });
    });
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.coverage < 0.34) {
      say('No encontré eso en tu material. Prueba con otras palabras o pregúntame por alguno de sus términos clave.');
      reply.suggestions = (concept.terms.length ? concept.terms : material.terms || []).slice(0, 4).map((t) => '¿Qué es ' + t + '?');
      return reply;
    }

    const chosen = scored.filter((item) => item.score >= best.score * 0.6 && item.coverage >= 0.34).slice(0, 3);
    chosen.sort((a, b) => index.sentences.indexOf(a.entry) - index.sentences.indexOf(b.entry));
    const sourceConcept = material.topics[best.entry.ti].concepts[best.entry.ci];
    say('Según tu material, en «' + sourceConcept.title + '»:');
    chosen.forEach((item) => quote(item.entry.text));
    reply.source = { ti: best.entry.ti, ci: best.entry.ci };
    return reply;
  }

  NexIA.analyzer = {
    AnalyzeError,
    buildCourse,
    parseBlocks,
    splitSentences,
    fold,
    stem
  };

  NexIA.course = {
    conceptSentences,
    conceptText,
    countConcepts,
    findConcept,
    pickQuestions,
    pickCards,
    evaluateOpenAnswer,
    tutorReply
  };
})(typeof window !== 'undefined' ? window : globalThis);
