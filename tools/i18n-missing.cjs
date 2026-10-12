// Какие русские строки приложения ещё без румынского перевода в web/src/ro-dict.json (v82).
// Запуск: node tools/i18n-missing.cjs  (нужен пакет typescript: npm i -D typescript в web/ или глобально)
// Выводит JSON-массив строк; переведите и допишите их в ro-dict.json ({ "русский": "română" }, подстановки как {0}, {1}).
const ts = require(require.resolve('typescript', { paths: [__dirname + '/../web', __dirname] }));
const fs = require('fs'); const path = require('path');
const CYR = /[А-Яа-яЁё]/;
const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '../web/src/ro-dict.json'), 'utf8'));
const seen = new Set();
const add = (s) => { s = s.replace(/\s+/g, ' ').trim(); if (s && CYR.test(s) && !/<\/?(b|i|a|code|pre)\b/.test(s) && !(s in dict)) seen.add(s); };
const SKIP = /vendor|node_modules|ro-dict|tasks\.js|ro\.js|actro\.js|journal\.js|pdf\.js|reportpdf\.js|pages\.js|amo\.js|labels\.js|qr\.js|db\.js|auth\.js|storage\.js|ai\.js/;
function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (SKIP.test(p)) continue;
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|js)$/.test(f)) {
      const sf = ts.createSourceFile(p, fs.readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true, p.endsWith('x') ? ts.ScriptKind.TSX : p.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
      (function v(n) {
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n.text);
        else if (ts.isTemplateExpression(n)) { let s = n.head.text; n.templateSpans.forEach((sp, i) => { s += `{${i}}` + sp.literal.text; }); add(s); }
        else if (ts.isJsxText(n)) add(n.text);
        ts.forEachChild(n, v);
      })(sf);
    }
  }
}
walk(path.join(__dirname, '../web/src'));
walk(path.join(__dirname, '../server/src'));
console.log(JSON.stringify([...seen], null, 1));
console.error(`Без перевода: ${seen.size}`);
