'use strict';
const fs = require('fs');
const path = require('path');

const transcript =
  'C:\\Users\\Intel\\.cursor\\projects\\c-Users-Intel-Documents-CICLOS-CICLO4-HCI-Proyecto-NexIA-IHC\\agent-transcripts\\a4eb459e-d12f-412c-b5e0-b7ab2b635965\\a4eb459e-d12f-412c-b5e0-b7ab2b635965.jsonl';

const targets = [
  'js/core/utils.js',
  'js/core/extract.js',
  'js/core/analyzer.js',
  'js/core/sample.js',
  'js/core/store.js',
  'js/core/auth.js',
  'tests/run.js',
  'css/app-extra.css',
  'js/app/ui.js',
  'js/app/state.js',
  'js/app/views-home.js',
  'js/app/views-learn.js',
  'js/app/views-review.js',
  'js/app/views-more.js',
  'js/app/app.js',
  'js/login.js',
  'app.html'
];

const files = Object.create(null);
let writes = 0;
let patches = 0;
let misses = 0;

const lines = fs.readFileSync(transcript, 'utf8').split(/\n/).filter(Boolean);
for (const line of lines) {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch (err) {
    continue;
  }
  const parts = obj.message && obj.message.content;
  if (!Array.isArray(parts)) continue;
  for (const part of parts) {
    if (!part || part.type !== 'tool_use') continue;
    const input = part.input || {};
    const p = String(input.path || '').replace(/\\/g, '/');
    const key = targets.find((t) => p.endsWith(t));
    if (!key) continue;
    if (part.name === 'Write' && typeof input.contents === 'string') {
      files[key] = input.contents;
      writes++;
    } else if (part.name === 'StrReplace' && files[key] != null) {
      const old = input.old_string;
      const neu = input.new_string;
      if (typeof old !== 'string' || typeof neu !== 'string') continue;
      const idx = files[key].indexOf(old);
      if (idx < 0) {
        misses++;
        console.log('MISS', key, JSON.stringify(old.slice(0, 80)));
        continue;
      }
      files[key] = files[key].slice(0, idx) + neu + files[key].slice(idx + old.length);
      patches++;
    }
  }
}

console.log({ writes, patches, misses, found: Object.keys(files) });
for (const [rel, content] of Object.entries(files)) {
  // No sobreescribir app.html si el Write del transcript era incompleto/experimental;
  // solo restauramos el núcleo y scripts.
  if (rel === 'app.html') {
    console.log('skip app.html from transcript (' + content.length + ' chars)');
    continue;
  }
  const out = path.join(process.cwd(), rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, content);
  console.log('restored', rel, content.length);
}
