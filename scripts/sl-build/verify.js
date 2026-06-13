const fs = require('fs');
const path = require('path');
const sd = JSON.parse(fs.readFileSync(path.join(__dirname, 'out/superdrops.json'), 'utf8'));
const named = sd.filter((s) => s.superdrop);
const standalone = sd.filter((s) => !s.superdrop);
console.log('named superdrops:', named.length, '| standalone drops:', standalone.length);
console.log('\n=== ALL named superdrops (date · #drops) ===');
named.forEach((s) => console.log('  ' + String(s.date || '??????').slice(0, 10).padEnd(11) + s.superdrop + '  (' + s.drops.length + ')'));
console.log('\n=== boundary-case spot checks ===');
['PlayStation Superdrop', 'Sonic Superdrop', 'Summer Superdrop 2025', "Marvel's Spider-Man Superdrop", 'Avatar: The Last Airbender Superdrop'].forEach((name) => {
  const s = named.find((x) => x.superdrop === name);
  console.log('\n' + name + ' [' + (s ? s.date : '?') + ']:');
  if (s) s.drops.forEach((d) => console.log('   - ' + d));
});
const dead = standalone.find((s) => /Deadpool/.test(s.drops[0]));
console.log('\nDeadpool standalone?:', dead ? 'YES -> ' + dead.drops.join(', ') + ' [' + dead.date + ']' : 'no');
console.log('standalone sample:', standalone.slice(0, 12).map((s) => s.drops[0]).join(' | '));
