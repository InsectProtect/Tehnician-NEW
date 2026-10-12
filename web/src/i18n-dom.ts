// ====================================================================================================
// Румынский интерфейс (v82): переводчик «поверх» готового интерфейса. Словарь ro-dict.json (RU → RO) собран из всех
// русских строк приложения и сервера (кнопки, подписи, ошибки, справочники). Включается, если у пользователя lang = 'ro':
// проходит по всем текстам страницы и следит за изменениями (MutationObserver). Шаблоны с подстановками («Проверено {0} из {1}»)
// превращаются в регулярные выражения. Пользовательский ввод (поля), а также элементы с translate="no" не трогаются.
// Новые строки в коде: допишите перевод в ro-dict.json (иначе останется русский текст).
// ====================================================================================================

const CYR = /[А-Яа-яЁё]/;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

let exact = new Map<string, string>();
let lower = new Map<string, string>();
type Pat = { re: RegExp; ro: string; groups: number[]; weight: number };
const buckets = new Map<string, Pat[]>();
let generic: Pat[] = [];

const MW = (re: string) => new RegExp(`(?<![а-яё])(?:${re})(?![а-яё])`, 'gi');
const FULL: [string, string][] = [['январ', 'ianuarie'], ['феврал', 'februarie'], ['март', 'martie'], ['апрел', 'aprilie'], ['ма', 'mai'], ['июн', 'iunie'],
  ['июл', 'iulie'], ['август', 'august'], ['сентябр', 'septembrie'], ['октябр', 'octombrie'], ['ноябр', 'noiembrie'], ['декабр', 'decembrie']];
const MONTHS: [RegExp, string][] = [
  // полные формы: «октябрь», «октября», «в октябре», «май», «мая»
  ...FULL.map(([r, ro]): [RegExp, string] => [MW(r === 'ма' ? 'ма[йяе]' : r === 'март' ? 'марта?|марте' : r === 'август' ? 'августа?|августе' : `${r}[ьяе]`), ro]),
  [MW('янв\\.?'), 'ian.'], [MW('февр?\\.?'), 'feb.'], [MW('мар\\.?'), 'mar.'], [MW('апр\\.?'), 'apr.'],
  [MW('июн\\.?'), 'iun.'], [MW('июл\\.?'), 'iul.'], [MW('авг\\.?'), 'aug.'],
  [MW('сент?\\.?'), 'sept.'], [MW('окт\\.?'), 'oct.'], [MW('нояб?\\.?'), 'nov.'], [MW('дек\\.?'), 'dec.'],
];

export function build(dict: Record<string, string>) {
  for (const [ru, ro] of Object.entries(dict)) {
    const k = norm(ru);
    if (!k.includes('{')) { exact.set(k, ro); lower.set(k.toLowerCase(), ro); continue; }
    const parts = k.split(/\{(\d+)\}/);
    // parts: [lit, n, lit, n, lit...]
    const groups: number[] = [];
    let src = '^';
    let lit = 0;
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) { src += parts[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); lit += parts[i].length; } else { src += '(.+?)'; groups.push(Number(parts[i])); }
    }
    src += '$';
    if (lit < 2) continue; // «{0} {1}» — слишком общий
    // подстановка посреди слова («Фото{0}») — ловит лишнее («Фотограф»): такие шаблоны не используем
    if (/\p{L}\{\d+\}|\{\d+\}\p{L}/u.test(k)) continue;
    let re: RegExp;
    try { re = new RegExp(src, 's'); } catch { continue; }
    const p: Pat = { re, ro, groups, weight: lit };
    const head = parts[0];
    if (head.length >= 2) {
      const b = head.slice(0, 2).toLowerCase();
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b)!.push(p);
    } else generic.push(p);
  }
  for (const list of buckets.values()) list.sort((a, b) => b.weight - a.weight);
  generic.sort((a, b) => b.weight - a.weight);
}

function viaPattern(s: string): string | null {
  const list = [...(buckets.get(s.slice(0, 2).toLowerCase()) || []), ...generic];
  for (const p of list) {
    const m = p.re.exec(s);
    if (!m) continue;
    let out = p.ro;
    p.groups.forEach((n, i) => {
      const v = m[i + 1];
      out = out.split(`{${n}}`).join(CYR.test(v) ? translateCore(v, 1) ?? months(v) : v);
    });
    return out;
  }
  return null;
}

/** Перевод строки без внешних пробелов; null — перевода нет. */
function translateCore(s: string, depth = 0): string | null {
  if (!s || !CYR.test(s)) return null;
  const hit = exact.get(s) ?? lower.get(s.toLowerCase());
  if (hit != null) return matchCase(s, hit);
  const p = viaPattern(s);
  if (p != null) return p;
  if (depth > 2) return null;
  // составные строки: «a · b», «Метка: значение», «a — b», «a, b»
  for (const sep of [' · ', '\n', ' — ', ': ', ' / ', ', ']) {
    if (!s.includes(sep)) continue;
    const parts = s.split(sep);
    let any = false;
    const out = parts.map((x) => {
      const t = norm(x);
      const r = translateCore(t, depth + 1);
      if (r != null) { any = true; return x.replace(t, r); }
      const mo = months(x);
      if (mo !== x) any = true;
      return mo;
    });
    if (any) return out.join(sep);
  }
  // концовка вида «… (3)» или «… 12»
  const tail = s.match(/^(.*?)(\s*[([]?\d[\d\s.,:%×/-]*[)\]]?)$/s);
  if (tail && tail[1] && CYR.test(tail[1])) {
    const r = translateCore(norm(tail[1]), depth + 1);
    if (r != null) return r + tail[2];
  }
  const head = s.match(/^([^А-Яа-яЁё]+)(.*)$/s); // ведущие эмодзи/цифры: «🎯 Квесты», «3 станции»
  if (head && head[2]) {
    const r = translateCore(head[2], depth + 1);
    if (r != null) return head[1] + r;
  }
  return null;
}

function matchCase(src: string, ro: string) {
  if (src === src.toUpperCase() && src !== src.toLowerCase()) return ro.toUpperCase();
  return ro;
}

function months(s: string) {
  if (!CYR.test(s)) return s;
  let out = s;
  for (const [re, ro] of MONTHS) out = out.replace(re, ro);
  return out.replace(/(?<![а-яё])в(?= \d)/gi, 'la');
}

/** Перевод текста с сохранением пробелов по краям; null — оставить как есть. */
export function trText(raw: string): string | null {
  if (!raw || !CYR.test(raw)) return null;
  const lead = raw.match(/^\s*/)![0];
  const trail = raw.match(/\s*$/)![0];
  const core = norm(raw);
  let r = translateCore(core);
  if (r == null && raw.includes('\n')) {
    const lines = raw.split('\n').map((l) => { const c = norm(l); const t = translateCore(c); return t != null ? l.replace(c, t) : l; });
    r = lines.join('\n');
    return r === raw ? (/[а-яё]+\.?\s?\d|\d\s(янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)/i.test(raw) ? months(raw) : null) : r;
  }
  if (r == null) {
    // даты «12 окт., 14:30» и т.п.
    if (/\d\s*(янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)/i.test(core)) return lead + months(core) + trail;
    return null;
  }
  return lead + r + trail;
}

// ---------- обход DOM ----------
const done = new WeakMap<Node, string>(); // узел → текст, который мы туда записали
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE']);

function skipEl(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP.has(e.tagName) || e.getAttribute('translate') === 'no' || (e as HTMLElement).isContentEditable) return true;
  }
  return false;
}

function doText(n: Text) {
  const v = n.nodeValue || '';
  if (done.get(n) === v) return;
  if (skipEl(n.parentElement)) return;
  const r = trText(v);
  if (r != null && r !== v) { done.set(n, r); n.nodeValue = r; }
}
function doAttrs(el: Element) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v || !CYR.test(v)) continue;
    const r = trText(v);
    if (r != null && r !== v) el.setAttribute(a, r);
  }
}
function walk(root: Node) {
  if (root.nodeType === 3) { doText(root as Text); return; }
  if (root.nodeType !== 1) return;
  const el = root as Element;
  if (SKIP.has(el.tagName) && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
  doAttrs(el);
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === 3) doText(n as Text); else doAttrs(n as Element);
  }
}

let started = false;
export async function enableRomanian() {
  if (started) return;
  started = true;
  const dict = (await import('./ro-dict.json')).default as Record<string, string>;
  build(dict);
  document.documentElement.lang = 'ro';
  walk(document.body);
  if (document.title && CYR.test(document.title)) document.title = trText(document.title) || document.title;
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target as Text);
      else if (m.type === 'attributes') { if (m.target.nodeType === 1) doAttrs(m.target as Element); }
      else m.addedNodes.forEach((n) => walk(n));
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

/** Перевод строки для мест вне DOM (confirm/alert, заголовок окна). */
export function ro(s: string) { return started ? trText(s) ?? s : s; }
