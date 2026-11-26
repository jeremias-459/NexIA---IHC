/*
 * NexIA · Extracción de texto de documentos, 100 % en el navegador.
 *
 * Formatos: PDF (lector propio), DOCX (ZIP + XML), TXT y Markdown.
 * No se usa ninguna librería externa: la descompresión se hace con la API
 * nativa DecompressionStream y el resto es JavaScript puro.
 *
 * La salida es texto plano "tipo Markdown": los títulos detectados se marcan
 * con "#", las listas con "- " y los párrafos se separan con una línea en blanco.
 */
(function (root) {
  'use strict';

  const NexIA = (root.NexIA = root.NexIA || {});

  const MAX_FILE_SIZE = 25 * 1024 * 1024;
  const MAX_PDF_PAGES = 400;

  class ExtractError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'ExtractError';
      this.code = code;
    }
  }

  function extensionOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function bytesToBinary(u8) {
    let out = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < u8.length; i += CHUNK) {
      out += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return out;
  }

  function nextTask() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  /* ------------------------------------------------------------------ */
  /* Descompresión (deflate / zlib)                                      */
  /* ------------------------------------------------------------------ */

  async function inflateOnce(bytes, format, careful) {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    const chunks = [];
    let total = 0;

    const pump = (async () => {
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        chunks.push(step.value);
        total += step.value.length;
      }
    })();

    const feed = (async () => {
      if (!careful) {
        await writer.write(bytes);
      } else {
        // Modo tolerante: se entrega por partes para conservar lo ya
        // descomprimido si el flujo trae bytes sobrantes al final.
        const tail = Math.max(0, bytes.length - 12);
        for (let i = 0; i < tail; i += 16384) {
          await writer.write(bytes.subarray(i, Math.min(tail, i + 16384)));
        }
        for (let i = tail; i < bytes.length; i++) {
          await nextTask();
          await writer.write(bytes.subarray(i, i + 1));
        }
      }
      await writer.close();
    })();

    let failure = null;
    await Promise.all([pump.catch((err) => { failure = err; }), feed.catch((err) => { failure = failure || err; })]);
    if (failure && (!careful || total === 0)) throw failure;

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  async function inflate(bytes, format) {
    if (typeof DecompressionStream === 'undefined') {
      throw new ExtractError('unsupported-browser', 'Tu navegador no permite leer este archivo. Actualízalo o pega el texto manualmente.');
    }
    try {
      return await inflateOnce(bytes, format, false);
    } catch (err) {
      return inflateOnce(bytes, format, true);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Texto plano y Markdown                                              */
  /* ------------------------------------------------------------------ */

  function decodeText(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (err) {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }

  /** Quita la sintaxis en línea de Markdown conservando títulos, listas y bloques de código. */
  function cleanMarkdown(text) {
    let inFence = false;
    return text
      .split(/\r\n?|\n/)
      .map((line) => {
        if (/^\s*```/.test(line)) {
          inFence = !inFence;
          return line;
        }
        if (inFence) return line;
        let clean = line
          .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
          .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
          .replace(/(\*\*|__)(.+?)\1/g, '$2')
          .replace(/(^|[\s(])[*_]([^*_\s][^*_]*)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
          .replace(/`([^`]+)`/g, '$1')
          .replace(/^\s*>+\s?/, '')
          .replace(/^\s*([-*_]\s*){3,}$/, '');
        // Filas de tabla: se descarta la línea separadora y se aplanan las celdas.
        if (/^\s*\|.*\|\s*$/.test(clean)) {
          if (/^[\s:|-]+$/.test(clean)) return '';
          clean = clean.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()).filter(Boolean).join(' · ');
        }
        return clean;
      })
      .join('\n');
  }

  /* ------------------------------------------------------------------ */
  /* DOCX                                                                */
  /* ------------------------------------------------------------------ */

  function readZip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    const minPos = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= minPos; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ExtractError('invalid-file', 'El archivo no es un documento de Word válido (.docx).');

    const count = view.getUint16(eocd + 10, true);
    let ptr = view.getUint32(eocd + 16, true);
    const entries = new Map();
    const decoder = new TextDecoder('utf-8');

    for (let i = 0; i < count && ptr + 46 <= bytes.length; i++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;
      const method = view.getUint16(ptr + 10, true);
      const compressedSize = view.getUint32(ptr + 20, true);
      const nameLength = view.getUint16(ptr + 28, true);
      const extraLength = view.getUint16(ptr + 30, true);
      const commentLength = view.getUint16(ptr + 32, true);
      const localOffset = view.getUint32(ptr + 42, true);
      const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLength));
      entries.set(name, { method, compressedSize, localOffset });
      ptr += 46 + nameLength + extraLength + commentLength;
    }
    return { bytes, view, entries };
  }

  async function readZipEntry(zip, name) {
    const entry = zip.entries.get(name);
    if (!entry) return null;
    const view = zip.view;
    if (view.getUint32(entry.localOffset, true) !== 0x04034b50) return null;
    const nameLength = view.getUint16(entry.localOffset + 26, true);
    const extraLength = view.getUint16(entry.localOffset + 28, true);
    const start = entry.localOffset + 30 + nameLength + extraLength;
    const data = zip.bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return data;
    if (entry.method === 8) return inflate(data, 'deflate-raw');
    throw new ExtractError('invalid-file', 'El documento usa una compresión no compatible.');
  }

  const XML_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

  function decodeXml(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      if (entity[0] === '#') {
        const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return Object.prototype.hasOwnProperty.call(XML_ENTITIES, entity) ? XML_ENTITIES[entity] : match;
    });
  }

  function docxXmlToText(xml) {
    const out = [];
    const paragraphRe = /<w:p[ >][\s\S]*?<\/w:p>/g;
    const runRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\s*\/>/g;
    let match;

    while ((match = paragraphRe.exec(xml))) {
      const para = match[0];
      let text = '';
      let run;
      runRe.lastIndex = 0;
      while ((run = runRe.exec(para))) {
        if (run[1] !== undefined) text += decodeXml(run[1]);
        else if (run[0].indexOf('w:tab') === 1) text += ' ';
        else text += '\n';
      }
      text = text.replace(/[ \t]+/g, ' ').trim();
      if (!text) {
        out.push('');
        continue;
      }

      let level = 0;
      const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(para);
      if (style) {
        const heading = /^(?:heading|t[ií]?tulo|encabezado)\s*(\d)$/i.exec(style[1]);
        if (heading) level = Math.min(6, parseInt(heading[1], 10));
        else if (/^(?:title|t[ií]?tulo|puesto)$/i.test(style[1])) level = 1;
        else if (/^(?:subtitle|subt[ií]?tulo)$/i.test(style[1])) level = 2;
      }
      if (!level) {
        const outline = /<w:outlineLvl\s+w:val="(\d)"/.exec(para);
        if (outline) level = Math.min(6, parseInt(outline[1], 10) + 1);
      }

      if (level && text.length <= 200) out.push('', '#'.repeat(level) + ' ' + text.replace(/\n/g, ' '), '');
      else if (/<w:numPr>/.test(para)) out.push('- ' + text.replace(/\n/g, ' '));
      else out.push('', text, '');
    }
    return out.join('\n');
  }

  async function extractDocx(bytes) {
    const zip = readZip(bytes);
    const documentXml = await readZipEntry(zip, 'word/document.xml');
    if (!documentXml) throw new ExtractError('invalid-file', 'El archivo no contiene un documento de Word legible.');
    const text = docxXmlToText(new TextDecoder('utf-8').decode(documentXml));

    let pages = null;
    try {
      const appXml = await readZipEntry(zip, 'docProps/app.xml');
      if (appXml) {
        const m = /<Pages>(\d+)<\/Pages>/.exec(new TextDecoder('utf-8').decode(appXml));
        if (m) pages = parseInt(m[1], 10) || null;
      }
    } catch (err) {
      pages = null;
    }
    return { text, pages };
  }

  /* ------------------------------------------------------------------ */
  /* PDF · objetos y analizador léxico                                   */
  /* ------------------------------------------------------------------ */

  class PdfRef {
    constructor(num, gen) {
      this.num = num;
      this.gen = gen;
    }
  }
  class PdfName {
    constructor(name) {
      this.name = name;
    }
  }
  class PdfStr {
    constructor(value) {
      this.v = value;
    }
  }
  class PdfOp {
    constructor(op) {
      this.op = op;
    }
  }

  const EOF = { eof: true };
  const ARRAY_END = { arrayEnd: true };
  const DICT_END = { dictEnd: true };

  function isWs(c) {
    return c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
  }
  function isDelim(c) {
    return c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
  }
  function isDict(value) {
    return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === null;
  }
  function nameOf(value) {
    return value instanceof PdfName ? value.name : null;
  }
  function hexVal(c) {
    if (c >= 48 && c <= 57) return c - 48;
    if (c >= 65 && c <= 70) return c - 55;
    if (c >= 97 && c <= 102) return c - 87;
    return -1;
  }

  class Lexer {
    constructor(source, pos, end) {
      this.s = source;
      this.p = pos || 0;
      this.end = end === undefined ? source.length : end;
      this.refs = false;
    }

    skip() {
      const s = this.s;
      while (this.p < this.end) {
        const c = s.charCodeAt(this.p);
        if (isWs(c)) {
          this.p++;
        } else if (c === 37) {
          while (this.p < this.end) {
            const d = s.charCodeAt(this.p);
            if (d === 10 || d === 13) break;
            this.p++;
          }
        } else {
          break;
        }
      }
    }

    read() {
      const s = this.s;
      for (;;) {
        this.skip();
        if (this.p >= this.end) return EOF;
        const c = s.charCodeAt(this.p);

        if (c === 47) return this.readName();
        if (c === 40) return this.readLiteral();
        if (c === 60) {
          if (s.charCodeAt(this.p + 1) === 60) {
            this.p += 2;
            return this.readDict();
          }
          return this.readHex();
        }
        if (c === 91) {
          this.p++;
          return this.readArray();
        }
        if (c === 93) {
          this.p++;
          return ARRAY_END;
        }
        if (c === 62) {
          if (s.charCodeAt(this.p + 1) === 62) {
            this.p += 2;
            return DICT_END;
          }
          this.p++;
          continue;
        }
        if (c === 123 || c === 125 || c === 41) {
          this.p++;
          continue;
        }
        if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) return this.readNumber();

        const start = this.p;
        while (this.p < this.end) {
          const d = s.charCodeAt(this.p);
          if (isWs(d) || isDelim(d)) break;
          this.p++;
        }
        if (this.p === start) {
          this.p++;
          continue;
        }
        const word = s.slice(start, this.p);
        if (word === 'true') return true;
        if (word === 'false') return false;
        if (word === 'null') return null;
        return new PdfOp(word);
      }
    }

    readNumber() {
      const s = this.s;
      const end = this.end;
      const start = this.p;
      let p = start;
      while (p < end) {
        const d = s.charCodeAt(p);
        if ((d >= 48 && d <= 57) || d === 43 || d === 45 || d === 46) p++;
        else break;
      }
      const text = s.slice(start, p);
      this.p = p;
      let value = parseFloat(text);
      if (Number.isNaN(value)) value = 0;

      if (this.refs && /^\d+$/.test(text)) {
        let q = p;
        while (q < end && isWs(s.charCodeAt(q))) q++;
        let g = q;
        while (g < end) {
          const d = s.charCodeAt(g);
          if (d >= 48 && d <= 57) g++;
          else break;
        }
        if (g > q) {
          let r = g;
          while (r < end && isWs(s.charCodeAt(r))) r++;
          if (s.charCodeAt(r) === 82) {
            const after = s.charCodeAt(r + 1);
            if (r + 1 >= end || isWs(after) || isDelim(after)) {
              this.p = r + 1;
              return new PdfRef(value, parseInt(s.slice(q, g), 10));
            }
          }
        }
      }
      return value;
    }

    readName() {
      const s = this.s;
      let p = this.p + 1;
      let out = '';
      while (p < this.end) {
        const c = s.charCodeAt(p);
        if (isWs(c) || isDelim(c)) break;
        if (c === 35) {
          const hi = hexVal(s.charCodeAt(p + 1));
          const lo = hexVal(s.charCodeAt(p + 2));
          if (hi >= 0 && lo >= 0) {
            out += String.fromCharCode(hi * 16 + lo);
            p += 3;
            continue;
          }
        }
        out += s[p];
        p++;
      }
      this.p = p;
      return new PdfName(out);
    }

    readLiteral() {
      const s = this.s;
      let p = this.p + 1;
      let depth = 1;
      let out = '';
      while (p < this.end) {
        const c = s.charCodeAt(p);
        if (c === 92) {
          const d = s.charCodeAt(p + 1);
          p += 2;
          if (d === 110) out += '\n';
          else if (d === 114) out += '\r';
          else if (d === 116) out += '\t';
          else if (d === 98) out += '\b';
          else if (d === 102) out += '\f';
          else if (d === 13) {
            if (s.charCodeAt(p) === 10) p++;
          } else if (d === 10) {
            // continuación de línea
          } else if (d >= 48 && d <= 55) {
            let value = d - 48;
            let digits = 1;
            while (digits < 3 && p < this.end) {
              const e = s.charCodeAt(p);
              if (e < 48 || e > 55) break;
              value = value * 8 + (e - 48);
              p++;
              digits++;
            }
            out += String.fromCharCode(value & 255);
          } else if (!Number.isNaN(d)) {
            out += String.fromCharCode(d);
          }
          continue;
        }
        if (c === 40) depth++;
        else if (c === 41) {
          depth--;
          if (depth === 0) {
            p++;
            break;
          }
        }
        out += s[p];
        p++;
      }
      this.p = p;
      return new PdfStr(out);
    }

    readHex() {
      const s = this.s;
      let p = this.p + 1;
      let out = '';
      let pending = -1;
      while (p < this.end) {
        const c = s.charCodeAt(p);
        p++;
        if (c === 62) break;
        const v = hexVal(c);
        if (v < 0) continue;
        if (pending < 0) pending = v;
        else {
          out += String.fromCharCode(pending * 16 + v);
          pending = -1;
        }
      }
      if (pending >= 0) out += String.fromCharCode(pending * 16);
      this.p = p;
      return new PdfStr(out);
    }

    readArray() {
      const out = [];
      for (;;) {
        const value = this.read();
        if (value === EOF || value === ARRAY_END) break;
        if (value === DICT_END) continue;
        out.push(value);
      }
      return out;
    }

    readDict() {
      const dict = Object.create(null);
      for (;;) {
        const key = this.read();
        if (key === EOF || key === DICT_END) break;
        if (!(key instanceof PdfName)) continue;
        const value = this.read();
        if (value === EOF || value === DICT_END) break;
        if (value === ARRAY_END) continue;
        dict[key.name] = value;
      }
      return dict;
    }
  }

  /* ------------------------------------------------------------------ */
  /* PDF · codificaciones de fuentes                                     */
  /* ------------------------------------------------------------------ */

  const CP1252_HIGH = '\u20AC\u0081\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u008D\u017D\u008F\u0090\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u009D\u017E\u0178';
  const MAC_HIGH =
    '\u00C4\u00C5\u00C7\u00C9\u00D1\u00D6\u00DC\u00E1\u00E0\u00E2\u00E4\u00E3\u00E5\u00E7\u00E9\u00E8' +
    '\u00EA\u00EB\u00ED\u00EC\u00EE\u00EF\u00F1\u00F3\u00F2\u00F4\u00F6\u00F5\u00FA\u00F9\u00FB\u00FC' +
    '\u2020\u00B0\u00A2\u00A3\u00A7\u2022\u00B6\u00DF\u00AE\u00A9\u2122\u00B4\u00A8\u2260\u00C6\u00D8' +
    '\u221E\u00B1\u2264\u2265\u00A5\u00B5\u2202\u2211\u220F\u03C0\u222B\u00AA\u00BA\u03A9\u00E6\u00F8' +
    '\u00BF\u00A1\u00AC\u221A\u0192\u2248\u2206\u00AB\u00BB\u2026\u00A0\u00C0\u00C3\u00D5\u0152\u0153' +
    '\u2013\u2014\u201C\u201D\u2018\u2019\u00F7\u25CA\u00FF\u0178\u2044\u20AC\u2039\u203A\uFB01\uFB02' +
    '\u2021\u00B7\u201A\u201E\u2030\u00C2\u00CA\u00C1\u00CB\u00C8\u00CD\u00CE\u00CF\u00CC\u00D3\u00D4' +
    '\uF8FF\u00D2\u00DA\u00DB\u00D9\u0131\u02C6\u02DC\u00AF\u02D8\u02D9\u02DA\u00B8\u02DD\u02DB\u02C7';

  const STANDARD_OVERRIDES = {
    0x27: '\u2019', 0x60: '\u2018', 0xa1: '\u00A1', 0xa2: '\u00A2', 0xa3: '\u00A3', 0xa4: '\u2044', 0xa5: '\u00A5',
    0xa6: '\u0192', 0xa7: '\u00A7', 0xa8: '\u00A4', 0xa9: "'", 0xaa: '\u201C', 0xab: '\u00AB', 0xac: '\u2039',
    0xad: '\u203A', 0xae: 'fi', 0xaf: 'fl', 0xb1: '\u2013', 0xb2: '\u2020', 0xb3: '\u2021', 0xb4: '\u00B7',
    0xb6: '\u00B6', 0xb7: '\u2022', 0xb8: '\u201A', 0xb9: '\u201E', 0xba: '\u201D', 0xbb: '\u00BB', 0xbc: '\u2026',
    0xbd: '\u2030', 0xbf: '\u00BF', 0xc1: '`', 0xc2: '\u00B4', 0xc3: '\u02C6', 0xc4: '\u02DC', 0xc5: '\u00AF',
    0xc6: '\u02D8', 0xc7: '\u02D9', 0xc8: '\u00A8', 0xca: '\u02DA', 0xcb: '\u00B8', 0xcd: '\u02DD', 0xce: '\u02DB',
    0xcf: '\u02C7', 0xd0: '\u2014', 0xe1: '\u00C6', 0xe3: '\u00AA', 0xe8: '\u0141', 0xe9: '\u00D8', 0xea: '\u0152',
    0xeb: '\u00BA', 0xf1: '\u00E6', 0xf5: '\u0131', 0xf8: '\u0142', 0xf9: '\u00F8', 0xfa: '\u0153', 0xfb: '\u00DF'
  };

  function winAnsiTable() {
    const table = new Array(256);
    for (let i = 0; i < 256; i++) table[i] = String.fromCharCode(i);
    for (let i = 0; i < 32; i++) table[0x80 + i] = CP1252_HIGH[i];
    return table;
  }
  function macRomanTable() {
    const table = new Array(256);
    for (let i = 0; i < 128; i++) table[i] = String.fromCharCode(i);
    for (let i = 0; i < 128; i++) table[128 + i] = MAC_HIGH[i];
    return table;
  }
  function standardTable() {
    const table = winAnsiTable();
    for (let i = 0x80; i < 256; i++) table[i] = '';
    Object.keys(STANDARD_OVERRIDES).forEach((code) => {
      table[Number(code)] = STANDARD_OVERRIDES[code];
    });
    return table;
  }

  const GLYPHS = (function buildGlyphTable() {
    const g = Object.create(null);
    const pairs =
      'space: |exclam:!|quotedbl:"|numbersign:#|dollar:$|percent:%|ampersand:&|quotesingle:\'|parenleft:(|parenright:)|' +
      'asterisk:*|plus:+|comma:,|hyphen:-|minus:\u2212|period:.|slash:/|colon::|semicolon:;|less:<|equal:=|greater:>|' +
      'question:?|at:@|bracketleft:[|backslash:\\|bracketright:]|asciicircum:^|underscore:_|grave:`|braceleft:{|bar:||' +
      'braceright:}|asciitilde:~|exclamdown:\u00A1|cent:\u00A2|sterling:\u00A3|currency:\u00A4|yen:\u00A5|brokenbar:\u00A6|' +
      'section:\u00A7|dieresis:\u00A8|copyright:\u00A9|ordfeminine:\u00AA|guillemotleft:\u00AB|logicalnot:\u00AC|' +
      'registered:\u00AE|macron:\u00AF|degree:\u00B0|plusminus:\u00B1|twosuperior:\u00B2|threesuperior:\u00B3|acute:\u00B4|' +
      'mu:\u00B5|paragraph:\u00B6|periodcentered:\u00B7|cedilla:\u00B8|onesuperior:\u00B9|ordmasculine:\u00BA|' +
      'guillemotright:\u00BB|onequarter:\u00BC|onehalf:\u00BD|threequarters:\u00BE|questiondown:\u00BF|multiply:\u00D7|' +
      'divide:\u00F7|germandbls:\u00DF|AE:\u00C6|ae:\u00E6|OE:\u0152|oe:\u0153|Oslash:\u00D8|oslash:\u00F8|Eth:\u00D0|' +
      'eth:\u00F0|Thorn:\u00DE|thorn:\u00FE|dotlessi:\u0131|Lslash:\u0141|lslash:\u0142|quoteleft:\u2018|quoteright:\u2019|' +
      'quotedblleft:\u201C|quotedblright:\u201D|quotesinglbase:\u201A|quotedblbase:\u201E|endash:\u2013|emdash:\u2014|' +
      'bullet:\u2022|ellipsis:\u2026|dagger:\u2020|daggerdbl:\u2021|perthousand:\u2030|guilsinglleft:\u2039|' +
      'guilsinglright:\u203A|trademark:\u2122|fi:fi|fl:fl|ff:ff|ffi:ffi|ffl:ffl|florin:\u0192|circumflex:\u02C6|' +
      'tilde:\u02DC|fraction:\u2044|Euro:\u20AC|nbspace: |nonbreakingspace: |sfthyphen:|softhyphen:|pi:\u03C0|' +
      'Delta:\u0394|Omega:\u03A9|alpha:\u03B1|beta:\u03B2|gamma:\u03B3|delta:\u03B4|lambda:\u03BB|sigma:\u03C3|' +
      'theta:\u03B8|infinity:\u221E|lessequal:\u2264|greaterequal:\u2265|notequal:\u2260|approxequal:\u2248|' +
      'summation:\u2211|radical:\u221A|arrowright:\u2192|arrowleft:\u2190|zero:0|one:1|two:2|three:3|four:4|five:5|' +
      'six:6|seven:7|eight:8|nine:9';
    pairs.split('|').forEach((pair) => {
      const idx = pair.indexOf(':');
      if (idx > 0) g[pair.slice(0, idx)] = pair.slice(idx + 1);
    });
    g.bar = '|';
    g.colon = ':';
    for (let c = 65; c <= 90; c++) {
      g[String.fromCharCode(c)] = String.fromCharCode(c);
      g[String.fromCharCode(c + 32)] = String.fromCharCode(c + 32);
    }
    const accents = { acute: '\u0301', grave: '\u0300', circumflex: '\u0302', tilde: '\u0303', dieresis: '\u0308', ring: '\u030A', cedilla: '\u0327', caron: '\u030C' };
    'AEIOUYNCSZaeiouyncsz'.split('').forEach((letter) => {
      Object.keys(accents).forEach((accent) => {
        const composed = (letter + accents[accent]).normalize('NFC');
        if (composed.length === 1) g[letter + accent] = composed;
      });
    });
    return g;
  })();

  function glyphToText(name) {
    if (name in GLYPHS) return GLYPHS[name];
    const base = name.split('.')[0];
    if (base !== name && base in GLYPHS) return GLYPHS[base];
    let m = /^uni((?:[0-9A-Fa-f]{4})+)$/.exec(base);
    if (m) {
      let out = '';
      for (let i = 0; i < m[1].length; i += 4) out += String.fromCharCode(parseInt(m[1].substr(i, 4), 16));
      return out;
    }
    m = /^u([0-9A-Fa-f]{4,6})$/.exec(base);
    if (m) {
      const code = parseInt(m[1], 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : null;
    }
    return null;
  }

  function hexToText(hex) {
    const h = hex.replace(/\s+/g, '');
    if (!h) return '';
    if (h.length <= 2) return String.fromCharCode(parseInt(h, 16));
    let out = '';
    for (let i = 0; i + 4 <= h.length; i += 4) out += String.fromCharCode(parseInt(h.substr(i, 4), 16));
    return out;
  }

  function parseCMap(source) {
    const map = new Map();
    let bytes = 0;
    const clean = (h) => h.replace(/\s+/g, '');

    const space = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(source);
    if (space) {
      const first = /<([0-9A-Fa-f\s]+)>/.exec(space[1]);
      if (first) bytes = Math.ceil(clean(first[1]).length / 2);
    }

    let block;
    const charRe = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((block = charRe.exec(source))) {
      const pairRe = /<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]*)>/g;
      let pair;
      while ((pair = pairRe.exec(block[1]))) map.set(parseInt(clean(pair[1]), 16), hexToText(pair[2]));
    }

    const rangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((block = rangeRe.exec(source))) {
      const entryRe = /<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>\s*(?:<([0-9A-Fa-f\s]*)>|\[([^\]]*)\])/g;
      let entry;
      while ((entry = entryRe.exec(block[1]))) {
        const lo = parseInt(clean(entry[1]), 16);
        const hi = parseInt(clean(entry[2]), 16);
        if (entry[3] !== undefined) {
          const base = hexToText(entry[3]);
          if (!base) continue;
          const head = base.slice(0, -1);
          const last = base.charCodeAt(base.length - 1);
          for (let code = lo; code <= hi && code - lo < 65536; code++) map.set(code, head + String.fromCharCode(last + (code - lo)));
        } else {
          const items = entry[4].match(/<[0-9A-Fa-f\s]*>/g) || [];
          items.forEach((item, i) => map.set(lo + i, hexToText(item.slice(1, -1))));
        }
      }
    }
    return { map, bytes };
  }

  /* ------------------------------------------------------------------ */
  /* PDF · filtros de flujo                                              */
  /* ------------------------------------------------------------------ */

  function undoPredictor(data, parms) {
    const predictor = typeof parms.Predictor === 'number' ? parms.Predictor : 1;
    if (predictor < 10) return data;
    const colors = typeof parms.Colors === 'number' ? parms.Colors : 1;
    const bpc = typeof parms.BitsPerComponent === 'number' ? parms.BitsPerComponent : 8;
    const columns = typeof parms.Columns === 'number' ? parms.Columns : 1;
    const bpp = Math.max(1, (colors * bpc) >> 3);
    const rowLength = (colors * bpc * columns + 7) >> 3;
    const rows = Math.floor(data.length / (rowLength + 1));
    const out = new Uint8Array(rows * rowLength);
    let prev = new Uint8Array(rowLength);

    for (let r = 0; r < rows; r++) {
      const filter = data[r * (rowLength + 1)];
      const src = data.subarray(r * (rowLength + 1) + 1, (r + 1) * (rowLength + 1));
      const dst = out.subarray(r * rowLength, (r + 1) * rowLength);
      for (let i = 0; i < rowLength; i++) {
        const a = i >= bpp ? dst[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let value = src[i];
        if (filter === 1) value += a;
        else if (filter === 2) value += b;
        else if (filter === 3) value += (a + b) >> 1;
        else if (filter === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        dst[i] = value & 255;
      }
      prev = dst;
    }
    return out;
  }

  function decodeAsciiHex(data) {
    const out = [];
    let pending = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === 62) break;
      const v = hexVal(data[i]);
      if (v < 0) continue;
      if (pending < 0) pending = v;
      else {
        out.push(pending * 16 + v);
        pending = -1;
      }
    }
    if (pending >= 0) out.push(pending * 16);
    return Uint8Array.from(out);
  }

  function decodeAscii85(data) {
    const out = [];
    let group = [];
    for (let i = 0; i < data.length; i++) {
      const c = data[i];
      if (c === 126) break;
      if (isWs(c)) continue;
      if (c === 122 && group.length === 0) {
        out.push(0, 0, 0, 0);
        continue;
      }
      if (c < 33 || c > 117) continue;
      group.push(c - 33);
      if (group.length === 5) {
        let value = 0;
        for (let k = 0; k < 5; k++) value = value * 85 + group[k];
        out.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
        group = [];
      }
    }
    if (group.length > 1) {
      const count = group.length;
      while (group.length < 5) group.push(84);
      let value = 0;
      for (let k = 0; k < 5; k++) value = value * 85 + group[k];
      const bytes = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
      for (let k = 0; k < count - 1; k++) out.push(bytes[k]);
    }
    return Uint8Array.from(out);
  }

  /* ------------------------------------------------------------------ */
  /* PDF · documento                                                     */
  /* ------------------------------------------------------------------ */

  const IDENTITY = [1, 0, 0, 1, 0, 0];

  function multiply(m, n) {
    return [
      m[0] * n[0] + m[1] * n[2],
      m[0] * n[1] + m[1] * n[3],
      m[2] * n[0] + m[3] * n[2],
      m[2] * n[1] + m[3] * n[3],
      m[4] * n[0] + m[5] * n[2] + n[4],
      m[4] * n[1] + m[5] * n[3] + n[5]
    ];
  }

  function toNumber(value) {
    return typeof value === 'number' ? value : 0;
  }

  class PdfDocument {
    constructor(bytes) {
      this.bytes = bytes;
      this.raw = bytesToBinary(bytes);
      this.objects = new Map();
      this.fonts = new Map();
    }

    resolve(value) {
      let current = value;
      for (let depth = 0; depth < 12 && current instanceof PdfRef; depth++) {
        const entry = this.objects.get(current.num);
        current = entry ? entry.value : undefined;
      }
      return current;
    }

    entryOf(value) {
      return value instanceof PdfRef ? this.objects.get(value.num) || null : null;
    }

    scanObjects() {
      const raw = this.raw;
      const re = /(\d+)\s+(\d+)\s+obj\b/g;
      let match;
      while ((match = re.exec(raw))) {
        const lexer = new Lexer(raw, re.lastIndex);
        lexer.refs = true;
        let value;
        try {
          value = lexer.read();
        } catch (err) {
          continue;
        }
        if (value === EOF) break;

        let stream = null;
        if (isDict(value)) {
          lexer.skip();
          if (raw.startsWith('stream', lexer.p)) {
            let start = lexer.p + 6;
            if (raw.charCodeAt(start) === 13) start++;
            if (raw.charCodeAt(start) === 10) start++;
            let end = -1;
            const length = value.Length;
            if (typeof length === 'number' && length >= 0 && start + length <= raw.length) {
              if (/^\s*endstream/.test(raw.substr(start + length, 24))) end = start + length;
            }
            if (end < 0) {
              const idx = raw.indexOf('endstream', start);
              if (idx < 0) end = raw.length;
              else {
                end = idx;
                if (raw.charCodeAt(end - 1) === 10) end--;
                if (raw.charCodeAt(end - 1) === 13) end--;
              }
            }
            stream = { start, end };
            re.lastIndex = Math.max(re.lastIndex, end);
          }
        }
        this.objects.set(parseInt(match[1], 10), { pos: match.index, value, stream, decoded: undefined });
      }
    }

    isEncrypted() {
      for (const entry of this.objects.values()) {
        if (isDict(entry.value) && nameOf(entry.value.Type) === 'XRef' && entry.value.Encrypt !== undefined) return true;
      }
      const raw = this.raw;
      let idx = raw.indexOf('trailer');
      while (idx >= 0) {
        const lexer = new Lexer(raw, idx + 7);
        lexer.refs = true;
        try {
          const dict = lexer.read();
          if (isDict(dict) && dict.Encrypt !== undefined) return true;
        } catch (err) {
          // se ignora un tráiler dañado
        }
        idx = raw.indexOf('trailer', idx + 7);
      }
      return false;
    }

    async decodeStream(entry) {
      if (entry.decoded !== undefined) return entry.decoded;
      const dict = entry.value;
      let data = this.bytes.subarray(entry.stream.start, entry.stream.end);

      let filters = this.resolve(dict.Filter);
      let parms = this.resolve(dict.DecodeParms);
      if (filters === undefined || filters === null) filters = [];
      if (!Array.isArray(filters)) filters = [filters];
      if (!Array.isArray(parms)) parms = [parms];

      for (let i = 0; i < filters.length; i++) {
        const filter = nameOf(this.resolve(filters[i]));
        const parm = this.resolve(parms[i]);
        if (filter === 'FlateDecode' || filter === 'Fl') {
          data = await inflate(data, 'deflate');
          if (isDict(parm)) data = undoPredictor(data, parm);
        } else if (filter === 'ASCIIHexDecode' || filter === 'AHx') {
          data = decodeAsciiHex(data);
        } else if (filter === 'ASCII85Decode' || filter === 'A85') {
          data = decodeAscii85(data);
        } else {
          throw new ExtractError('unsupported-filter', 'Filtro de PDF no compatible: ' + filter);
        }
      }
      entry.decoded = bytesToBinary(data);
      return entry.decoded;
    }

    async expandObjectStreams() {
      const containers = [];
      for (const entry of this.objects.values()) {
        if (entry.stream && isDict(entry.value) && nameOf(entry.value.Type) === 'ObjStm') containers.push(entry);
      }
      containers.sort((a, b) => a.pos - b.pos);

      for (const container of containers) {
        let data;
        try {
          data = await this.decodeStream(container);
        } catch (err) {
          continue;
        }
        const count = toNumber(this.resolve(container.value.N));
        const first = toNumber(this.resolve(container.value.First));
        const header = new Lexer(data, 0, first);
        const index = [];
        for (let i = 0; i < count; i++) {
          const num = header.read();
          const offset = header.read();
          if (typeof num !== 'number' || typeof offset !== 'number') break;
          index.push([num, offset]);
        }
        for (const pair of index) {
          const lexer = new Lexer(data, first + pair[1]);
          lexer.refs = true;
          let value;
          try {
            value = lexer.read();
          } catch (err) {
            continue;
          }
          if (value === EOF) continue;
          const existing = this.objects.get(pair[0]);
          if (!existing || existing.pos < container.pos) {
            this.objects.set(pair[0], { pos: container.pos, value, stream: null, decoded: undefined });
          }
        }
      }
    }

    collectPages() {
      const pages = [];
      const seen = new Set();
      const walk = (node, inherited, depth) => {
        const dict = this.resolve(node);
        if (!isDict(dict) || depth > 50 || seen.has(dict)) return;
        seen.add(dict);
        const resources = dict.Resources !== undefined ? dict.Resources : inherited;
        const kids = this.resolve(dict.Kids);
        if (Array.isArray(kids)) {
          kids.forEach((kid) => walk(kid, resources, depth + 1));
        } else if (nameOf(dict.Type) === 'Page' || dict.Contents !== undefined) {
          pages.push({ dict, resources });
        }
      };

      let catalog = null;
      let catalogPos = -1;
      for (const entry of this.objects.values()) {
        if (isDict(entry.value) && nameOf(entry.value.Type) === 'Catalog' && entry.value.Pages !== undefined && entry.pos > catalogPos) {
          catalog = entry.value;
          catalogPos = entry.pos;
        }
      }
      if (catalog) walk(catalog.Pages, undefined, 0);

      if (!pages.length) {
        const nums = Array.from(this.objects.keys()).sort((a, b) => a - b);
        for (const num of nums) {
          const value = this.objects.get(num).value;
          if (isDict(value) && nameOf(value.Type) === 'Page') pages.push({ dict: value, resources: value.Resources });
        }
      }
      return pages;
    }

    buildSimpleEncoding(dict, subtype) {
      const encoding = this.resolve(dict.Encoding);
      let baseName = null;
      let differences = null;
      if (encoding instanceof PdfName) baseName = encoding.name;
      else if (isDict(encoding)) {
        baseName = nameOf(this.resolve(encoding.BaseEncoding));
        differences = this.resolve(encoding.Differences);
      }

      let table;
      if (baseName === 'MacRomanEncoding') table = macRomanTable();
      else if (baseName === 'WinAnsiEncoding') table = winAnsiTable();
      else if (baseName === 'StandardEncoding' || (!baseName && subtype === 'Type1')) table = standardTable();
      else table = winAnsiTable();

      if (Array.isArray(differences)) {
        let code = 0;
        for (const item of differences) {
          const value = this.resolve(item);
          if (typeof value === 'number') code = value;
          else if (value instanceof PdfName) {
            const text = glyphToText(value.name);
            if (text !== null && code >= 0 && code < 256) table[code] = text;
            code++;
          }
        }
      }
      return table;
    }

    async loadFont(fontObj) {
      const key = fontObj instanceof PdfRef ? fontObj.num : fontObj;
      if (this.fonts.has(key)) return this.fonts.get(key);

      const font = { twoByte: false, map: null, enc: null, widths: null, defaultWidth: 500, bold: false };
      this.fonts.set(key, font);
      const dict = this.resolve(fontObj);
      if (!isDict(dict)) return font;

      const subtype = nameOf(this.resolve(dict.Subtype));
      const baseFont = nameOf(this.resolve(dict.BaseFont)) || '';
      font.bold = /bold|black|heavy|semibold|demi/i.test(baseFont);

      if (subtype === 'Type0') {
        font.twoByte = true;
        font.defaultWidth = 1000;
        const descendants = this.resolve(dict.DescendantFonts);
        const descendant = Array.isArray(descendants) ? this.resolve(descendants[0]) : null;
        if (isDict(descendant)) {
          const dw = this.resolve(descendant.DW);
          if (typeof dw === 'number') font.defaultWidth = dw;
          const w = this.resolve(descendant.W);
          if (Array.isArray(w)) {
            font.widths = new Map();
            let i = 0;
            while (i < w.length) {
              const first = this.resolve(w[i]);
              const next = this.resolve(w[i + 1]);
              if (Array.isArray(next)) {
                next.forEach((width, k) => font.widths.set(first + k, toNumber(this.resolve(width))));
                i += 2;
              } else {
                const width = toNumber(this.resolve(w[i + 2]));
                for (let code = first; code <= next && code - first < 70000; code++) font.widths.set(code, width);
                i += 3;
              }
            }
          }
        }
      } else {
        font.enc = this.buildSimpleEncoding(dict, subtype);
        const firstChar = toNumber(this.resolve(dict.FirstChar));
        const widths = this.resolve(dict.Widths);
        let scale = 1;
        if (subtype === 'Type3') {
          const matrix = this.resolve(dict.FontMatrix);
          if (Array.isArray(matrix) && typeof matrix[0] === 'number') scale = matrix[0] * 1000;
        }
        if (Array.isArray(widths)) {
          font.widths = new Map();
          widths.forEach((width, i) => font.widths.set(firstChar + i, toNumber(this.resolve(width)) * scale));
        }
        const descriptor = this.resolve(dict.FontDescriptor);
        if (isDict(descriptor)) {
          const missing = this.resolve(descriptor.MissingWidth);
          if (typeof missing === 'number' && missing > 0) font.defaultWidth = missing;
        }
      }

      const toUnicode = this.entryOf(dict.ToUnicode);
      if (toUnicode && toUnicode.stream) {
        try {
          const cmap = parseCMap(await this.decodeStream(toUnicode));
          if (cmap.map.size) font.map = cmap.map;
          if (cmap.bytes) font.twoByte = cmap.bytes >= 2;
        } catch (err) {
          font.map = null;
        }
      }
      return font;
    }

    async pageContent(page) {
      const contents = this.resolve(page.dict.Contents);
      const list = Array.isArray(contents) ? contents : [page.dict.Contents];
      let source = '';
      for (const item of list) {
        const entry = this.entryOf(item);
        if (!entry || !entry.stream) continue;
        try {
          source += (await this.decodeStream(entry)) + '\n';
        } catch (err) {
          // un flujo ilegible no impide leer el resto de la página
        }
      }
      return source;
    }

    async runContent(source, resources, baseMatrix, items, depth) {
      const resourceDict = this.resolve(resources);
      const fontDict = isDict(resourceDict) ? this.resolve(resourceDict.Font) : null;
      const xobjectDict = isDict(resourceDict) ? this.resolve(resourceDict.XObject) : null;

      const lexer = new Lexer(source);
      const stack = [];
      const saved = [];
      let ctm = baseMatrix;
      let tm = IDENTITY;
      let lineMatrix = IDENTITY;
      let font = null;
      let fontSize = 0;
      let charSpace = 0;
      let wordSpace = 0;
      let hScale = 1;
      let leading = 0;

      const show = (str) => {
        if (!(str instanceof PdfStr)) return;
        const bytes = str.v;
        const twoByte = font ? font.twoByte : false;
        const step = twoByte ? 2 : 1;
        let text = '';
        let advance = 0;
        for (let i = 0; i + step <= bytes.length; i += step) {
          const code = twoByte ? (bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1) : bytes.charCodeAt(i);
          let ch;
          if (font && font.map) ch = font.map.get(code);
          if (ch === undefined) {
            if (font && font.enc) ch = font.enc[code];
            else if (twoByte) ch = font && font.map ? '' : code >= 32 ? String.fromCharCode(code) : '';
            else ch = String.fromCharCode(code);
          }
          text += ch || '';
          const width = font && font.widths ? font.widths.get(code) : undefined;
          advance += ((width === undefined ? (font ? font.defaultWidth : 500) : width) / 1000) * fontSize + charSpace;
          if (!twoByte && code === 32) advance += wordSpace;
        }
        advance *= hScale;
        const trm = multiply(tm, ctm);
        const scaleX = Math.hypot(trm[0], trm[1]);
        const scaleY = Math.hypot(trm[2], trm[3]);
        if (text) {
          items.push({ x: trm[4], y: trm[5], w: advance * scaleX, size: Math.abs(fontSize) * scaleY, text, bold: font ? font.bold : false });
        }
        tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + advance * tm[0], tm[5] + advance * tm[1]];
      };

      const nextLine = () => {
        lineMatrix = multiply([1, 0, 0, 1, 0, -leading], lineMatrix);
        tm = lineMatrix;
      };

      for (;;) {
        const token = lexer.read();
        if (token === EOF) break;
        if (!(token instanceof PdfOp)) {
          if (token !== ARRAY_END && token !== DICT_END) {
            stack.push(token);
            if (stack.length > 80) stack.shift();
          }
          continue;
        }

        const n = stack.length;
        switch (token.op) {
          case 'q':
            saved.push({ ctm, font, fontSize, charSpace, wordSpace, hScale, leading });
            break;
          case 'Q': {
            const state = saved.pop();
            if (state) {
              ctm = state.ctm;
              font = state.font;
              fontSize = state.fontSize;
              charSpace = state.charSpace;
              wordSpace = state.wordSpace;
              hScale = state.hScale;
              leading = state.leading;
            }
            break;
          }
          case 'cm':
            if (n >= 6) ctm = multiply(stack.slice(n - 6).map(toNumber), ctm);
            break;
          case 'BT':
            tm = IDENTITY;
            lineMatrix = IDENTITY;
            break;
          case 'Tf': {
            fontSize = toNumber(stack[n - 1]);
            const fontName = nameOf(stack[n - 2]);
            font = fontName && isDict(fontDict) && fontDict[fontName] !== undefined ? await this.loadFont(fontDict[fontName]) : null;
            break;
          }
          case 'Tc':
            charSpace = toNumber(stack[n - 1]);
            break;
          case 'Tw':
            wordSpace = toNumber(stack[n - 1]);
            break;
          case 'Tz':
            hScale = toNumber(stack[n - 1]) / 100 || 1;
            break;
          case 'TL':
            leading = toNumber(stack[n - 1]);
            break;
          case 'Td':
          case 'TD': {
            const tx = toNumber(stack[n - 2]);
            const ty = toNumber(stack[n - 1]);
            if (token.op === 'TD') leading = -ty;
            lineMatrix = multiply([1, 0, 0, 1, tx, ty], lineMatrix);
            tm = lineMatrix;
            break;
          }
          case 'Tm':
            if (n >= 6) {
              lineMatrix = stack.slice(n - 6).map(toNumber);
              tm = lineMatrix;
            }
            break;
          case 'T*':
            nextLine();
            break;
          case 'Tj':
            show(stack[n - 1]);
            break;
          case "'":
            nextLine();
            show(stack[n - 1]);
            break;
          case '"':
            wordSpace = toNumber(stack[n - 3]);
            charSpace = toNumber(stack[n - 2]);
            nextLine();
            show(stack[n - 1]);
            break;
          case 'TJ': {
            const parts = stack[n - 1];
            if (Array.isArray(parts)) {
              for (const part of parts) {
                if (part instanceof PdfStr) show(part);
                else if (typeof part === 'number') {
                  const dx = (-part / 1000) * fontSize * hScale;
                  tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + dx * tm[0], tm[5] + dx * tm[1]];
                }
              }
            }
            break;
          }
          case 'Do': {
            const xName = nameOf(stack[n - 1]);
            const entry = xName && isDict(xobjectDict) ? this.entryOf(xobjectDict[xName]) : null;
            if (entry && entry.stream && isDict(entry.value) && nameOf(this.resolve(entry.value.Subtype)) === 'Form' && depth < 6) {
              try {
                const matrix = this.resolve(entry.value.Matrix);
                const formMatrix = Array.isArray(matrix) && matrix.length === 6 ? matrix.map((v) => toNumber(this.resolve(v))) : IDENTITY;
                const formResources = entry.value.Resources !== undefined ? entry.value.Resources : resources;
                await this.runContent(await this.decodeStream(entry), formResources, multiply(formMatrix, ctm), items, depth + 1);
              } catch (err) {
                // formulario ilegible: se omite
              }
            }
            break;
          }
          case 'BI': {
            const marker = /[\s]EI(?=[\s]|$)/g;
            marker.lastIndex = lexer.p;
            const found = marker.exec(source);
            lexer.p = found ? found.index + 3 : source.length;
            break;
          }
          default:
            break;
        }
        stack.length = 0;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* PDF · de fragmentos posicionados a texto estructurado               */
  /* ------------------------------------------------------------------ */

  function buildLines(items) {
    const lines = [];
    let current = null;

    const finish = (line) => {
      line.text = line.text.replace(/\s+/g, ' ').trim();
      line.size = line.chars ? line.sizeSum / line.chars : line.size;
      line.bold = line.chars > 0 && line.boldChars / line.chars > 0.85;
      if (line.text) lines.push(line);
    };

    for (const item of items) {
      const length = item.text.length;
      const size = item.size || 10;
      if (current) {
        const ref = Math.max(size, current.lastSize);
        const sameLine = Math.abs(item.y - current.y) <= ref * 0.45;
        const gap = item.x - current.endX;
        if (sameLine && gap > -ref * 0.6) {
          if (gap > ref * 0.2 && !/\s$/.test(current.text) && !/^\s/.test(item.text)) current.text += ' ';
          current.text += item.text;
          current.endX = Math.max(current.endX, item.x + item.w);
          current.sizeSum += size * length;
          current.chars += length;
          current.lastSize = size;
          if (item.bold) current.boldChars += length;
          continue;
        }
        finish(current);
      }
      current = {
        text: item.text,
        x: item.x,
        y: item.y,
        endX: item.x + item.w,
        size,
        lastSize: size,
        sizeSum: size * length,
        chars: length,
        boldChars: item.bold ? length : 0
      };
    }
    if (current) finish(current);
    return lines;
  }

  const PAGE_NUMBER_RE = /^(?:p[aá]g(?:ina|\.)?|page)?\s*[-–—]?\s*\d{1,4}\s*[-–—]?(?:\s*(?:de|of|\/)\s*\d{1,4})?$/i;

  function normalizeEdge(text) {
    return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  }

  /** Elimina encabezados, pies y números de página repetidos. */
  function stripRunningLines(pages) {
    if (pages.length < 2) return;
    const counts = new Map();
    const edges = pages.map((lines) => {
      if (!lines.length) return [];
      let top = lines[0];
      let bottom = lines[0];
      for (const line of lines) {
        if (line.y > top.y) top = line;
        if (line.y < bottom.y) bottom = line;
      }
      const found = top === bottom ? [top] : [top, bottom];
      found.forEach((line) => {
        const key = normalizeEdge(line.text);
        counts.set(key, (counts.get(key) || 0) + 1);
      });
      return found;
    });

    const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
    pages.forEach((lines, index) => {
      const remove = new Set();
      edges[index].forEach((line) => {
        const key = normalizeEdge(line.text);
        if (PAGE_NUMBER_RE.test(line.text) || (pages.length >= 3 && counts.get(key) >= threshold && line.text.length <= 120)) remove.add(line);
      });
      if (remove.size) pages[index] = lines.filter((line) => !remove.has(line));
    });
  }

  function linesToText(pages) {
    const sizes = new Map();
    pages.forEach((lines) =>
      lines.forEach((line) => {
        const key = Math.round(line.size * 2) / 2;
        sizes.set(key, (sizes.get(key) || 0) + line.text.length);
      })
    );
    let body = 10;
    let best = -1;
    sizes.forEach((chars, size) => {
      if (chars > best) {
        best = chars;
        body = size;
      }
    });

    const out = [];
    pages.forEach((lines) => {
      let prev = null;
      let prevKind = 0;
      let headingIndex = -1;

      for (const line of lines) {
        const text = line.text;
        const hasWords = /\p{L}{2}/u.test(text);
        const gap = prev ? prev.y - line.y : 0;
        const ref = prev ? Math.max(prev.size, line.size) : line.size;
        const paragraphBreak = !prev || gap > ref * 1.75 || gap < -ref * 0.5;

        let kind = 0;
        if (hasWords && line.size >= body * 1.15 && text.length <= 140) {
          kind = line.size >= body * 1.45 ? 1 : 2;
        } else if (
          hasWords &&
          line.bold &&
          line.size >= body * 0.97 &&
          text.length <= 90 &&
          text.split(' ').length <= 12 &&
          !/[.,;:]$/.test(text) &&
          (paragraphBreak || prevKind > 0 || (prev && /[.!?:]$/.test(prev.text)))
        ) {
          kind = 3;
        }

        if (kind) {
          if (prevKind === kind && headingIndex >= 0 && !paragraphBreak && out[headingIndex].length + text.length <= 180) {
            out[headingIndex] += ' ' + text;
          } else {
            out.push('');
            headingIndex = out.length;
            out.push('#'.repeat(kind) + ' ' + text);
            out.push('');
          }
        } else {
          if (paragraphBreak && !prevKind) out.push('');
          out.push(text);
          headingIndex = -1;
        }
        prev = line;
        prevKind = kind;
      }
      out.push('');
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function extractPdf(bytes, onProgress) {
    const head = bytesToBinary(bytes.subarray(0, Math.min(bytes.length, 1024)));
    if (head.indexOf('%PDF-') < 0) throw new ExtractError('invalid-file', 'El archivo no es un PDF válido.');

    const doc = new PdfDocument(bytes);
    doc.scanObjects();
    if (doc.isEncrypted()) {
      throw new ExtractError('encrypted', 'Este PDF está protegido con contraseña o permisos. Usa una copia sin protección o pega el texto.');
    }
    await doc.expandObjectStreams();

    const pages = doc.collectPages();
    if (!pages.length) throw new ExtractError('invalid-file', 'No se encontraron páginas en el PDF.');

    const limit = Math.min(pages.length, MAX_PDF_PAGES);
    const pageLines = [];
    for (let i = 0; i < limit; i++) {
      const items = [];
      try {
        const source = await doc.pageContent(pages[i]);
        await doc.runContent(source, pages[i].resources, IDENTITY, items, 0);
      } catch (err) {
        // se continúa con la siguiente página
      }
      pageLines.push(buildLines(items));
      if (onProgress) onProgress({ page: i + 1, pages: limit });
      if (i % 4 === 3) await nextTask();
    }

    stripRunningLines(pageLines);
    const text = linesToText(pageLines);
    const letters = (text.match(/\p{L}/gu) || []).length;
    if (letters < 40) {
      throw new ExtractError('no-text', 'Este PDF no contiene texto seleccionable (parece un documento escaneado). Prueba con otro archivo o pega el texto.');
    }
    const broken = (text.match(/[\uFFFD\u0001-\u0008\u000E-\u001F\uE000-\uF8FF]/g) || []).length;
    if (broken > letters * 0.25) {
      throw new ExtractError('garbled', 'No se pudo interpretar el texto de este PDF (usa fuentes sin tabla de caracteres). Prueba a pegar el texto.');
    }
    return { text, pages: pages.length, truncated: pages.length > limit };
  }

  /* ------------------------------------------------------------------ */
  /* API pública                                                         */
  /* ------------------------------------------------------------------ */

  const FORMATS = {
    pdf: 'PDF',
    docx: 'DOCX',
    txt: 'TXT',
    text: 'TXT',
    md: 'MD',
    markdown: 'MD'
  };

  /** Valida un archivo antes de leerlo. Devuelve un mensaje de error o null. */
  function validateFile(file) {
    if (!file) return 'Selecciona un archivo.';
    const ext = extensionOf(file.name);
    if (ext === 'doc') return 'El formato .doc antiguo no es compatible. Guárdalo como .docx o PDF e inténtalo de nuevo.';
    if (!FORMATS[ext]) return 'Formato no compatible. Usa un archivo PDF, DOCX, TXT o MD.';
    if (file.size === 0) return 'El archivo está vacío.';
    if (file.size > MAX_FILE_SIZE) return 'El archivo supera el límite de 25 MB.';
    return null;
  }

  async function fromBytes(bytes, name, onProgress) {
    const ext = extensionOf(name);
    const type = FORMATS[ext];
    if (!type) throw new ExtractError('unsupported', 'Formato no compatible. Usa un archivo PDF, DOCX, TXT o MD.');

    let result;
    if (type === 'PDF') result = await extractPdf(bytes, onProgress);
    else if (type === 'DOCX') result = await extractDocx(bytes);
    else {
      const decoded = decodeText(bytes);
      result = { text: type === 'MD' ? cleanMarkdown(decoded) : decoded, pages: null };
    }

    const text = String(result.text || '').replace(/\u0000/g, '').trim();
    if (!text) throw new ExtractError('no-text', 'El documento no contiene texto legible.');
    return { text, type, pages: result.pages || null, truncated: Boolean(result.truncated) };
  }

  /** Lee un objeto File del navegador y devuelve su texto. */
  async function fromFile(file, onProgress) {
    const problem = validateFile(file);
    if (problem) throw new ExtractError('invalid-file', problem);
    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (err) {
      throw new ExtractError('read-failed', 'No se pudo leer el archivo. Comprueba que siga disponible e inténtalo de nuevo.');
    }
    const result = await fromBytes(new Uint8Array(buffer), file.name, onProgress);
    result.name = file.name;
    result.size = file.size;
    return result;
  }

  NexIA.extract = {
    ExtractError,
    MAX_FILE_SIZE,
    ACCEPT: '.pdf,.docx,.txt,.md',
    validateFile,
    fromFile,
    fromBytes,
    extensionOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
