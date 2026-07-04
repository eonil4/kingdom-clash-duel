import fs from 'fs';
const p = new URL('../package.json', import.meta.url);
const content = fs.readFileSync(p, 'utf8');
const j = JSON.parse(content);
j.scripts['llm:convert:test:google/gemma-4-26b-a4-26b-a4-26b-a4b'] = 'npm run llm:convert:clear-lm-cache && node scripts/llm/convert.js data/enemies/test --model \"google/gemma-4-26b-a4-26b-a4b\"';
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\\n', 'utf8');
console.log('package.json updated');

