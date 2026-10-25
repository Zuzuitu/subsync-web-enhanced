// Execute the actual production PWA loader, without replacing its parsing rules.
const fs = require('fs'), vm = require('vm');
const input = fs.readFileSync(process.argv[2], 'utf8');
class Dictionary {
  constructor() { this.entries = new Map(); }
  add(key, value) {
    if (!this.entries.has(key)) this.entries.set(key, new Set());
    this.entries.get(key).add(value);
  }
}
const context = {
  Gizmo: {instance: {Dictionary}}, Logger: {logger: {get: () => ({})}},
  languages: JSON.parse(fs.readFileSync('web/src/data/languages.json', 'utf8')),
};
let source = fs.readFileSync('web/src/extractor/assets.js', 'utf8')
  .replace(/^import .*$/gm, '').replace('export default class Assets', 'class Assets');
source += '\nAssets.getAsset = () => dictionaryText; globalThis.dictionary = Assets.loadDictionary("rum", "eng", 5);';
context.dictionaryText = input;
vm.runInNewContext(source, context);
const hex = value => Buffer.from(value, 'utf8').toString('hex');
const pairs = [...context.dictionary.entries].flatMap(([key, values]) => [...values].map(value => hex(key) + '\t' + hex(value))).sort();
fs.writeFileSync(process.argv[3], pairs.join('\n') + '\n');
console.log(JSON.stringify({productionPairs: pairs.length}));
