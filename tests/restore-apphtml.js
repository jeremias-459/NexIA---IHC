'use strict';
const fs = require('fs');
const path = require('path');
const transcript = path.join(
  'C:/Users/Intel/.cursor/projects/c-Users-Intel-Documents-CICLOS-CICLO4-HCI-Proyecto-NexIA-IHC/agent-transcripts/a4eb459e-d12f-412c-b5e0-b7ab2b635965/a4eb459e-d12f-412c-b5e0-b7ab2b635965.jsonl'
);
const lines = fs.readFileSync(transcript, 'utf8').split('\n').filter(Boolean);
let last = null;
let n = 0;
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
    if (!part || part.type !== 'tool_use' || part.name !== 'Write') continue;
    const p = String((part.input && part.input.path) || '').replace(/\\/g, '/');
    if (p.endsWith('app.html') && typeof part.input.contents === 'string') {
      last = part.input.contents;
      n++;
    }
  }
}
console.log({ n, len: last && last.length, shell: !!(last && last.includes('js/core/auth.js')) });
if (last) {
  fs.writeFileSync('app.html', last);
  console.log('written app.html');
}
