/*
 * Pruebas del núcleo de NexIA (extracción de texto y analizador).
 *
 * Uso:  node tests/run.js            → ejecuta las comprobaciones
 *       node tests/run.js --verbose  → además imprime el curso generado
 *
 * Los documentos de prueba (PDF y DOCX) se construyen en memoria, por lo que
 * no se necesita ningún archivo adicional ni dependencias externas.
 */
'use strict';

const assert = require('assert');
const path = require('path');
const zlib = require('zlib');

const core = path.join(__dirname, '..', 'js', 'core');
require(path.join(core, 'utils.js'));
require(path.join(core, 'extract.js'));
require(path.join(core, 'analyzer.js'));
require(path.join(core, 'sample.js'));

const { extract, analyzer, course, sample } = globalThis.NexIA;
const verbose = process.argv.includes('--verbose');
const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('  ok   ' + name);
  } catch (err) {
    results.push({ name, ok: false });
    console.log('  FALLA ' + name + '\n       ' + (err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n       ') : err));
  }
}

/* ---------------------------- constructores ---------------------------- */

const latin1 = (text) => Buffer.from(text, 'latin1');

/** Ensambla un PDF a partir de una lista de objetos { num, body, stream? }. */
function assemblePdf(objects, extra) {
  const parts = [latin1('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n')];
  objects.forEach((obj) => {
    parts.push(latin1(obj.num + ' 0 obj\n' + obj.body + '\n'));
    if (obj.stream) {
      parts.push(latin1('stream\n'), obj.stream, latin1('\nendstream\n'));
    }
    parts.push(latin1('endobj\n'));
  });
  parts.push(latin1('trailer\n<< /Root 1 0 R ' + (extra || '') + '>>\n%%EOF\n'));
  return new Uint8Array(Buffer.concat(parts));
}

/** PDF sencillo: fuentes Type1 con WinAnsi, cadenas literales, TJ con kerning y dos páginas. */
function buildSimplePdf() {
  const page1 = [
    'BT /F2 20 Tf 72 720 Td (Fundamentos de redes) Tj ET',
    'BT /F1 11 Tf 72 690 Td 14 TL',
    '(Una red de computadoras es un conjunto de dispositivos) Tj T*',
    '[(interconectados que comparten recursos e informaci\\363n. Las re) -10 (des)] TJ T*',
    '(permiten la comunicaci\\363n entre equipos ubicados en distin-) Tj T*',
    '(tos lugares del mundo.) Tj',
    '0 -30 Td /F2 11 Tf (Modelo OSI) Tj /F1 11 Tf 0 -20 Td',
    '[(El) -278 (modelo) -278 (OSI) -278 (divide) -278 (la) -278 (comunicaci\\363n) -278 (en) -278 (siete) -278 (capas.)] TJ',
    'ET',
    'BT /F1 9 Tf 300 40 Td (P\\341gina 1) Tj ET'
  ].join('\n');
  const page2 = [
    'BT /F1 11 Tf 72 720 Td 14 TL',
    '(La capa de red se encarga del direccionamiento l\\363gico) Tj T*',
    '(y del enrutamiento de paquetes \\(por ejemplo, el protocolo IP\\).) Tj',
    'ET',
    'BT /F1 9 Tf 300 40 Td (P\\341gina 2) Tj ET'
  ].join('\n');

  return assemblePdf([
    { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, body: '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>' },
    { num: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R >>' },
    { num: 4, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents [8 0 R] >>' },
    { num: 5, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' },
    { num: 6, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>' },
    { num: 7, body: '<< /Length ' + page1.length + ' >>', stream: latin1(page1) },
    { num: 8, body: '<< /Length 9 0 R >>', stream: latin1(page2) },
    { num: 9, body: String(page2.length) }
  ]);
}

/**
 * PDF "moderno": contenido comprimido, fuente Type0 con ToUnicode, cadenas
 * hexadecimales, matriz de página invertida (como Chrome/Skia), palabras
 * colocadas una a una sin glifo de espacio y objetos dentro de un ObjStm.
 */
function buildModernPdf() {
  const lines = [
    { text: 'Seguridad en redes', size: 18, y: 90 },
    { text: 'La seguridad en redes consiste en proteger la información.', size: 11, y: 120 },
    { text: 'Un cortafuegos filtra el tráfico según reglas definidas.', size: 11, y: 134 },
    { text: 'El cifrado convierte los datos en un formato ilegible: «clave».', size: 11, y: 148 },
    { text: '¿Qué ocurre si falla el cifrado? La información queda expuesta.', size: 11, y: 190 }
  ];

  const glyphs = new Map();
  const gid = (ch) => {
    if (!glyphs.has(ch)) glyphs.set(ch, glyphs.size + 1);
    return glyphs.get(ch);
  };
  const hex = (word) => word.split('').map((ch) => gid(ch).toString(16).padStart(4, '0')).join('');

  const WIDTH = 520;
  let content = '1 0 0 -1 0 792 cm\nq\n';
  lines.forEach((line) => {
    let x = 72;
    line.text.split(' ').forEach((word) => {
      content += 'BT /F1 ' + line.size + ' Tf 1 0 0 -1 ' + x.toFixed(2) + ' ' + line.y + ' Tm <' + hex(word) + '> Tj ET\n';
      x += (word.length * WIDTH * line.size) / 1000 + line.size * 0.28;
    });
  });
  content += 'Q\n';

  let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
  const entries = Array.from(glyphs.entries());
  const half = Math.ceil(entries.length / 2);
  cmap += half + ' beginbfchar\n';
  entries.slice(0, half).forEach(([ch, id]) => {
    cmap += '<' + id.toString(16).padStart(4, '0') + '> <' + ch.charCodeAt(0).toString(16).padStart(4, '0') + '>\n';
  });
  cmap += 'endbfchar\n' + (entries.length - half) + ' beginbfrange\n';
  entries.slice(half).forEach(([ch, id]) => {
    const code = id.toString(16).padStart(4, '0');
    cmap += '<' + code + '> <' + code + '> <' + ch.charCodeAt(0).toString(16).padStart(4, '0') + '>\n';
  });
  cmap += 'endbfrange\nendcmap\nend end\n';

  // Página, árbol de páginas y fuentes viajan dentro de un flujo de objetos.
  const packed = [
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 10 0 R /Resources << /Font << /F1 5 0 R >> >> >>'],
    [5, '<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Inter /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 11 0 R >>'],
    [6, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ABCDEF+Inter /DW ' + WIDTH + ' /W [1 [' + WIDTH + ' ' + WIDTH + ']] >>']
  ];
  let header = '';
  let body = '';
  packed.forEach(([num, text]) => {
    header += num + ' ' + body.length + ' ';
    body += text + '\n';
  });
  const objStm = zlib.deflateSync(latin1(header + body));
  const contentZ = zlib.deflateSync(latin1(content));
  const cmapZ = zlib.deflateSync(latin1(cmap));

  return assemblePdf([
    { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 9, body: '<< /Type /ObjStm /N ' + packed.length + ' /First ' + header.length + ' /Filter /FlateDecode /Length ' + objStm.length + ' >>', stream: objStm },
    { num: 10, body: '<< /Filter /FlateDecode /Length ' + contentZ.length + ' >>', stream: contentZ },
    { num: 11, body: '<< /Filter [/FlateDecode] /Length ' + cmapZ.length + ' >>', stream: cmapZ }
  ]);
}

function buildZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  files.forEach((file) => {
    const name = Buffer.from(file.name, 'utf8');
    const raw = Buffer.from(file.data, 'utf8');
    const data = file.store ? raw : zlib.deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(file.store ? 0 : 8, 8);
    local.writeUInt32LE(zlib.crc32 ? zlib.crc32(raw) : 0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(file.store ? 0 : 8, 10);
    entry.writeUInt32LE(zlib.crc32 ? zlib.crc32(raw) : 0, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += 30 + name.length + data.length;
  });
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat(locals.concat([centralBuf, end])));
}

function buildDocx() {
  const p = (text, style) =>
    '<w:p>' + (style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : '') + '<w:r><w:t xml:space="preserve">' + text + '</w:t></w:r></w:p>';
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    p('Ecosistemas acuáticos', 'Ttulo1') +
    '<w:p><w:r><w:t>Un ecosistema acuático es </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">una comunidad de organismos</w:t></w:r><w:r><w:t xml:space="preserve"> que vive en el agua &amp; interactúa con su entorno.</w:t></w:r></w:p>' +
    p('Tipos de ecosistemas', 'Heading2') +
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Marinos: océanos y mares.</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>De agua dulce: ríos y lagos.</w:t></w:r></w:p>' +
    p('Los ecosistemas marinos cubren la mayor parte del planeta.') +
    '</w:body></w:document>';
  return buildZip([
    { name: '[Content_Types].xml', data: '<Types/>', store: true },
    { name: 'word/document.xml', data: xml },
    { name: 'docProps/app.xml', data: '<Properties><Pages>3</Pages></Properties>', store: true }
  ]);
}

/* -------------------------------- pruebas -------------------------------- */

async function main() {
  console.log('\nExtracción de texto');

  await test('TXT en UTF-8 y en Windows-1252', async () => {
    const utf = await extract.fromBytes(new Uint8Array(Buffer.from('Canción de prueba', 'utf8')), 'nota.txt');
    assert.strictEqual(utf.text, 'Canción de prueba');
    const ansi = await extract.fromBytes(new Uint8Array(Buffer.from('Canción de prueba', 'latin1')), 'nota.txt');
    assert.strictEqual(ansi.text, 'Canción de prueba');
  });

  await test('Markdown: limpia la sintaxis y conserva títulos y código', async () => {
    const md = '# Título\n\nTexto con **negrita** y [enlace](http://x.y).\n\n```js\nconst a = **1**;\n```';
    const out = await extract.fromBytes(new Uint8Array(Buffer.from(md, 'utf8')), 'a.md');
    assert.ok(out.text.includes('# Título'));
    assert.ok(out.text.includes('Texto con negrita y enlace.'));
    assert.ok(out.text.includes('const a = **1**;'));
  });

  await test('DOCX: títulos, listas, entidades y páginas', async () => {
    const out = await extract.fromBytes(buildDocx(), 'eco.docx');
    if (verbose) console.log(out.text);
    assert.strictEqual(out.type, 'DOCX');
    assert.strictEqual(out.pages, 3);
    assert.ok(out.text.includes('# Ecosistemas acuáticos'));
    assert.ok(out.text.includes('## Tipos de ecosistemas'));
    assert.ok(out.text.includes('Un ecosistema acuático es una comunidad de organismos que vive en el agua & interactúa con su entorno.'));
    assert.ok(out.text.includes('- Marinos: océanos y mares.'));
  });

  await test('PDF sencillo: WinAnsi, TJ, saltos de línea, títulos y pies de página', async () => {
    const out = await extract.fromBytes(buildSimplePdf(), 'redes.pdf');
    if (verbose) console.log(out.text);
    assert.strictEqual(out.pages, 2);
    assert.ok(out.text.includes('# Fundamentos de redes'), 'título por tamaño de letra');
    assert.ok(/#+ Modelo OSI/.test(out.text), 'título en negrita');
    assert.ok(out.text.includes('interconectados que comparten recursos e información. Las redes'), 'kerning sin espacio falso');
    assert.ok(out.text.includes('El modelo OSI divide la comunicación en siete capas.'), 'espacios por desplazamiento TJ');
    assert.ok(out.text.includes('(por ejemplo, el protocolo IP).'), 'paréntesis escapados');
    assert.ok(!/Página \d/.test(out.text), 'números de página eliminados');
  });

  await test('PDF moderno: Flate, Type0 + ToUnicode, ObjStm y palabras posicionadas', async () => {
    const out = await extract.fromBytes(buildModernPdf(), 'seguridad.pdf');
    if (verbose) console.log(out.text);
    assert.strictEqual(out.pages, 1);
    assert.ok(/^#+ Seguridad en redes/m.test(out.text));
    assert.ok(out.text.includes('La seguridad en redes consiste en proteger la información.'));
    assert.ok(out.text.includes('El cifrado convierte los datos en un formato ilegible: «clave».'));
    assert.ok(/definidas\.\nEl cifrado/.test(out.text), 'líneas consecutivas en el mismo párrafo');
    assert.ok(/«clave»\.\n\n¿Qué ocurre/.test(out.text), 'salto de párrafo por separación vertical');
  });

  await test('PDF protegido o sin texto: errores claros', async () => {
    const encrypted = assemblePdf([{ num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' }], '/Encrypt 5 0 R ');
    await assert.rejects(() => extract.fromBytes(encrypted, 'x.pdf'), (err) => err.code === 'encrypted');
    const empty = assemblePdf([
      { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
      { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      { num: 3, body: '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>' },
      { num: 4, body: '<< /Length 12 >>', stream: latin1('0 0 10 10 re') }
    ]);
    await assert.rejects(() => extract.fromBytes(empty, 'x.pdf'), (err) => err.code === 'no-text');
    await assert.rejects(() => extract.fromBytes(new Uint8Array([1, 2, 3]), 'x.pdf'), (err) => err.code === 'invalid-file');
  });

  await test('Validación de archivos', async () => {
    assert.ok(extract.validateFile({ name: 'a.exe', size: 10 }));
    assert.ok(extract.validateFile({ name: 'a.doc', size: 10 }).includes('.docx'));
    assert.ok(extract.validateFile({ name: 'a.pdf', size: 0 }));
    assert.ok(extract.validateFile({ name: 'a.pdf', size: 30 * 1024 * 1024 }));
    assert.strictEqual(extract.validateFile({ name: 'Apuntes.PDF', size: 1000 }), null);
  });

  console.log('\nAnalizador');
  let built = null;

  await test('Curso a partir del material de ejemplo', async () => {
    built = analyzer.buildCourse(sample.text, { fileName: sample.fileName });
    assert.strictEqual(built.title, 'Programación orientada a objetos');
    assert.strictEqual(built.lang, 'es');
    const titles = built.topics.map((t) => t.title);
    ['Clases y objetos', 'Herencia', 'Polimorfismo', 'Encapsulamiento', 'Aplicaciones prácticas'].forEach((t) => assert.ok(titles.includes(t), 'falta el tema ' + t));
    built.topics.forEach((topic) => {
      assert.ok(topic.concepts.length >= 1);
      assert.ok(topic.minutes >= 1);
      topic.concepts.forEach((concept) => {
        assert.ok(concept.title && concept.lead, 'concepto sin título o idea central');
        concept.questions.forEach((q) => {
          assert.ok(q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length, 'respuesta fuera de rango');
          assert.strictEqual(new Set(q.options).size, q.options.length, 'opciones repetidas');
          assert.ok(q.explanation);
        });
      });
    });
    const questions = built.topics.reduce((n, t) => n + t.concepts.reduce((m, c) => m + c.questions.length, 0), 0);
    const cards = built.topics.reduce((n, t) => n + t.concepts.reduce((m, c) => m + c.cards.length, 0), 0);
    assert.ok(questions >= 10, 'pocas preguntas: ' + questions);
    assert.ok(cards >= 6, 'pocas flashcards: ' + cards);
    assert.ok(built.topics.some((t) => t.concepts.some((c) => c.blocks.some((b) => b.type === 'code'))), 'se perdió el código');
  });

  await test('El análisis es determinista', async () => {
    const again = analyzer.buildCourse(sample.text, { fileName: sample.fileName });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(again)), JSON.parse(JSON.stringify(built)));
  });

  await test('Texto sin títulos: se divide en temas con título automático', async () => {
    const plain = sample.text.split('\n').filter((l) => !/^#/.test(l) && !/^```/.test(l) && !/^\s{2,}|^class |^auto |^vehiculos|^for /.test(l)).join('\n');
    const c = analyzer.buildCourse(plain, { fileName: 'apuntes_poo.txt' });
    assert.strictEqual(c.title, 'Apuntes poo');
    assert.ok(c.topics.length >= 2, 'temas: ' + c.topics.length);
    c.topics.forEach((t) => assert.ok(t.title && !/^Tema \d/.test(t.title), 'título automático vacío: ' + t.title));
    if (verbose) console.log(c.topics.map((t) => t.title + ' → ' + t.concepts.map((k) => k.title).join(' | ')).join('\n'));
  });

  await test('Texto demasiado corto: error controlado', async () => {
    assert.throws(() => analyzer.buildCourse('Hola mundo. Esto es poco.', {}), (err) => err.code === 'too-short');
  });

  await test('Selección de preguntas y flashcards', async () => {
    const quiz = course.pickQuestions(built, { topicIndex: 1, count: 5 });
    assert.ok(quiz.length >= 3 && quiz.length <= 5);
    quiz.forEach((q) => assert.ok(q.answer >= 0 && q.answer < q.options.length));
    const cards = course.pickCards(built, built.topics[1].concepts.map((c) => c.id), 6);
    assert.ok(cards.length >= 1);
  });

  await test('Tutor: recuperación, resumen, ejemplo y pregunta', async () => {
    const where = { ti: 1, ci: 0 };
    const session = {};
    const answer = course.tutorReply(built, where, '¿Qué es el polimorfismo?', session);
    const text = answer.parts.map((p) => p.text || (p.items || []).join(' ')).join(' ');
    assert.ok(/polimorfismo es la capacidad/i.test(text), text);
    assert.ok(course.tutorReply(built, where, 'Resúmelo', session).parts.some((p) => p.type === 'list'));
    assert.ok(course.tutorReply(built, where, 'Dame un ejemplo', session).parts.length >= 2);
    const none = course.tutorReply(built, where, '¿Cuál es la capital de Mongolia?', session);
    assert.ok(/No encontré/.test(none.parts[0].text));
    course.tutorReply(built, where, 'Hazme una pregunta', session);
    assert.ok(session.pending, 'debe quedar una pregunta pendiente');
    const letter = String.fromCharCode(65 + session.pending.answer);
    const graded = course.tutorReply(built, where, session.pending.options.length === 2 ? (session.pending.answer === 0 ? 'verdadero' : 'falso') : letter, session);
    assert.ok(/Correcto/.test(graded.parts[0].text));
  });

  await test('Evaluación de respuesta abierta', async () => {
    const open = built.topics[1].open;
    const good = course.evaluateOpenAnswer('La herencia permite que una clase hija reutilice los atributos y métodos de la clase base, evitando duplicar código en cada clase nueva del sistema y facilitando su mantenimiento a largo plazo.', open);
    const bad = course.evaluateOpenAnswer('No lo sé muy bien.', open);
    assert.ok(good.score > bad.score, good.score + ' vs ' + bad.score);
    assert.ok(good.matched.length >= 1);
  });

  await test('Del PDF al curso (flujo completo)', async () => {
    const pdf = await extract.fromBytes(buildSimplePdf(), 'Redes de computadoras.pdf');
    const longer = pdf.text + '\n\n' + 'La capa de transporte garantiza la entrega confiable de los datos mediante el protocolo TCP. '.repeat(3) +
      'El protocolo IP asigna una dirección única a cada dispositivo de la red. La capa física transmite bits a través del medio.';
    const c = analyzer.buildCourse(longer, { fileName: 'Redes de computadoras.pdf' });
    assert.ok(c.topics.length >= 1);
    assert.ok(c.words > 80);
  });

  if (verbose && built) {
    console.log('\n──── Curso generado ────');
    console.log(built.title + ' · ' + built.words + ' palabras · ' + built.minutes + ' min');
    console.log('Términos: ' + built.terms.join(', '));
    built.topics.forEach((topic) => {
      console.log('\n■ ' + topic.title + ' — ' + topic.subtitle + ' (' + topic.minutes + ' min)');
      console.log('  Abierta: ' + topic.open.prompt);
      topic.concepts.forEach((concept) => {
        console.log('  ▸ ' + concept.title + ' [' + concept.terms.join(', ') + ']');
        console.log('    Idea: ' + concept.lead);
        concept.keyPoints.forEach((k) => console.log('    · ' + k));
        concept.questions.forEach((q) => console.log('    ? (' + q.type + ') ' + q.stem + (q.quote ? ' «' + q.quote + '»' : '') + '\n        ' + q.options.map((o, i) => (i === q.answer ? '[' + o + ']' : o)).join(' / ')));
        concept.cards.forEach((card) => console.log('    ⧉ ' + card.front));
      });
    });
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log('\n' + (results.length - failed) + ' de ' + results.length + ' pruebas correctas.\n');
  process.exit(failed ? 1 : 0);
}

main();
