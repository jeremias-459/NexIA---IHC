'use strict';
const fs = require('fs');
const html = fs.readFileSync('app.html', 'utf8');
const scripts = [...html.matchAll(/src="(js\/[^"]+)"/g)].map((m) => m[1]);
console.log(scripts.join('\n'));
scripts.forEach((s) => {
  if (!fs.existsSync(s)) console.log('MISSING', s);
});
console.log('login scripts:');
const login = fs.readFileSync('login.html', 'utf8');
[...login.matchAll(/src="(js\/[^"]+)"/g)].map((m) => m[1]).forEach((s) => {
  console.log(s, fs.existsSync(s) ? 'ok' : 'MISSING');
});
