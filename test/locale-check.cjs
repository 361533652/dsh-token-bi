/**
 * Locale dictionary check.
 *
 * The client bundle carries its own `zh`/`en` dictionaries. This verifies that
 * both define exactly the same keys and that every `t('key')` the UI calls is
 * defined — a missing key renders the raw key name to the user.
 *
 *   node test/locale-check.cjs
 */
const fs = require('fs');
const path = require('path');

const CLIENT = path.join(__dirname, '..', 'lib', 'client.js');
const source = fs.readFileSync(CLIENT, 'utf8');

/**
 * Extract the keys of one dictionary literal by scanning balanced braces from
 * its declaration, so nested objects cannot truncate the range.
 */
function dictionaryKeys(name) {
  const marker = `const ${name} = {`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`dictionary "${name}" not found`);

  const open = source.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }

  const body = source.slice(open, end);
  // Only top-level entries: keys are indented exactly six spaces in this file.
  return [...body.matchAll(/^ {6}'([^']+)':/gm)].map((match) => match[1]);
}

const zh = dictionaryKeys('zh');
const en = dictionaryKeys('en');
const zhSet = new Set(zh);
const enSet = new Set(en);

const missingInEn = [...zhSet].filter((key) => !enSet.has(key));
const missingInZh = [...enSet].filter((key) => !zhSet.has(key));
const used = new Set([...source.matchAll(/\bt\('([^']+)'\)/g)].map((match) => match[1]));

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!ok) failures += 1;
};

console.log(`zh keys: ${zh.length}, en keys: ${en.length}`);
check('both dictionaries define the same keys', missingInEn.length === 0 && missingInZh.length === 0,
  missingInEn.length + missingInZh.length === 0 ? '' : `missing in en: ${missingInEn.join(', ') || '-'}; missing in zh: ${missingInZh.join(', ') || '-'}`);
check('both dictionaries are non-empty', zh.length > 0 && en.length > 0);
// Every locale key the UI passes to t() must exist; unknown keys surface as raw text.
const unknown = [...used].filter((key) => !zhSet.has(key) && !['style', 'a'].includes(key));
check('every t() key is defined', unknown.length === 0, unknown.length === 0 ? '' : unknown.join(', '));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nlocale ok');
