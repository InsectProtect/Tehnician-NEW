// Разбор заявки из сообщения в теме Telegram.
// Понимает строки «Ключ: значение» (RU/RO) и свободный текст: дату, время, вредителей, телефон, адрес.

const TZ = process.env.TZ_DISPLAY || 'Europe/Chisinau';

const KEYS = {
  company: ['клиент', 'юрлицо', 'юр.лицо', 'компания', 'заказчик', 'фирма', 'организация', 'client', 'beneficiar', 'denumire', 'firma'],
  address: ['адрес', 'адресс', 'объект', 'adresa', 'adresă', 'obiect', 'locatie', 'locație'],
  date: ['дата', 'день', 'data', 'ziua'],
  time: ['время', 'час', 'ora', 'timp'],
  procedure: ['обработка', 'услуга', 'тип', 'процедура', 'вид работ', 'serviciu', 'tratament', 'lucrare'],
  pests: ['вредител', 'насеком', 'грызун', 'daunator', 'dăunător', 'daunatori', 'dăunători'],
  phone: ['телефон', 'тел', 'контакт', 'telefon', 'tel', 'contact'],
  comment: ['коммент', 'примеч', 'заметк', 'инфо', 'comentariu', 'nota', 'notă', 'info'],
  area: ['площадь', 'м2', 'м²', 'suprafata', 'suprafață', 'm2'],
};

// Категории как в журнале компании: plosniță, roșcat, negru, zburătoare, rozătoare, purici, furnici, viespe.
// Порядок важен: сначала уточнённые тараканы, потом общее «тараканы».
const PEST_RULES = [
  ['Клопы', /клоп|plo[sș]ni[tț]/],
  ['Рыжие тараканы', /рыж|прусак|ro[sș]ca[tț]/],
  ['Чёрные тараканы', /ч[её]рн\S*\s+тарак|тарак\S*\s+ч[её]рн|(^|[^\p{L}])negr[uie]([^\p{L}]|$)/u],
  ['Тараканы', /тарак|g[aâi]nd[aă]c/],
  ['Летающие насекомые', /летающ|zbur[aă]t/],
  ['Муравьи', /мурав|furnic/],
  ['Блохи', /блох|pure[cț]|purici/],
  ['Осы', /(^|[^\p{L}])ос(а|ы|иное|иные|иного)([^\p{L}]|$)|шерш|viesp/u],
  ['Мухи', /(^|[^\p{L}])мух|mu[sș]t|musc/u],
  ['Моль / кожееды', /моль|кожеед|molii|molie/],
  ['Комары', /комар|[tț][aâ]n[tț]ar/],
  ['Клещи', /клещ|c[aă]pu[sș]/],
  ['Грызуны', /грызун|roz[aă]to/],
  ['Мыши', /мыш|[sș]oarec/],
  ['Крысы', /крыс|[sș]obolan/],
];

const RODENTS = new Set(['Мыши', 'Крысы', 'Грызуны']);

function detectProcedure(text, pests) {
  const t = text.toLowerCase();
  if (/дезинф|dezinf/.test(t)) return 'Дезинфекция';
  if (/дератиз|deratiz/.test(t)) return 'Дератизация';
  if (/дезинс|dezins/.test(t)) return 'Дезинсекция';
  if (pests.length && pests.every((p) => RODENTS.has(p))) return 'Дератизация';
  if (pests.length) return 'Дезинсекция';
  return '';
}

function detectPests(text) {
  const t = text.toLowerCase();
  const found = PEST_RULES.filter(([, re]) => re.test(t)).map(([name]) => name);
  // уточнённый вид вытесняет общее «тараканы»
  return found.includes('Рыжие тараканы') || found.includes('Чёрные тараканы') ? found.filter((p) => p !== 'Тараканы') : found;
}

const ADDRESS_MARK = /(^|[\s,(])(ул\.?|улица|пр-т|просп|бул\.?|бульвар|пер\.?|г\.|город|с\.|село|дом|кв\.?|квартира|подъезд|этаж|str\.?|strada|stradela|bd\.?|bul\.?|bulevardul|bd-ul|pia[țţt]a|[șşs]oseaua|aleea|calea|or\.|oraș|mun\.|s\.|sat|com\.|ap\.?|apt\.?|bl\.|sc\.|et\.)(\s|$|,)/i;
// «Дачия 23/2», «Ismail 33» — слово и номер дома
const ADDRESS_LIKE = /\p{L}{3,}.*\s\d{1,4}([\/-]\d{1,4})?[a-zа-я]?\b/iu;
const PHONE_RE = /(\+?\d[\d\s()-]{6,}\d)/;

/** Смещение часового пояса (минуты) в указанный момент. */
function tzOffsetMin(date, tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(date).reduce((a, x) => ((a[x.type] = x.value), a), {});
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Местные дата/время (в TZ) → ISO UTC. */
export function zonedIso(y, m, d, hh = 9, mm = 0, tz = TZ) {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const off = tzOffsetMin(guess, tz);
  return new Date(guess.getTime() - off * 60000).toISOString();
}

function localToday(now, tz = TZ) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-');
  return { y: +p[0], m: +p[1], d: +p[2] };
}

function parseDate(str, now) {
  const s = str.toLowerCase();
  const today = localToday(now);
  const shift = (days) => {
    const dt = new Date(Date.UTC(today.y, today.m - 1, today.d + days));
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  };
  if (/послезавтра|poimâine|poimaine/.test(s)) return shift(2);
  if (/завтра|mâine|maine/.test(s)) return shift(1);
  if (/сегодня|azi|astăzi|astazi/.test(s)) return shift(0);
  const m = s.match(/(?:^|[^\d/])(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?![\d/])/) || s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (!m) return null;
  const d = +m[1];
  const mo = +m[2];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  let y = m[3] ? +m[3] : today.y;
  if (y < 100) y += 2000;
  // без года и дата уже прошла больше чем на месяц — значит, следующий год
  if (!m[3] && Date.UTC(y, mo - 1, d) < Date.UTC(today.y, today.m - 1, today.d) - 30 * 86400000) y += 1;
  return { y, m: mo, d };
}

function parseTime(str, keyed) {
  const m = str.match(/\b([01]?\d|2[0-3])[:](\d{2})\b/) || (keyed ? str.match(/\b([01]?\d|2[0-3])[.\s-]?(\d{2})?\b/) : null)
    || str.match(/(?:\bв\s|\bla\s|\bora\s)([01]?\d|2[0-3])(?:[:.](\d{2}))?\b/i);
  if (!m) return null;
  return { hh: +m[1], mm: m[2] ? +m[2] : 0 };
}

/**
 * Возвращает { company, address, planned_at, has_time, procedure, pests, phone, comment, area } или null, если это не похоже на заявку.
 */
/**
 * «3 1/2 4300» → комнат 3, этап 1 из 2, цена 4300 (первое число — комнаты, необязательно).
 * Также «этап 1/2», «4300 лей». Возвращает { rooms, stage, price, text } — text без распознанного фрагмента.
 */
export function extractDeal(text) {
  let t = String(text || '');
  const out = { rooms: null, stage: '', price: null, mult: null, sotki: null };
  const m = t.match(/(^|[\s,;])(?:(\d{1,2})\s+)?([1-9])\s*\/\s*([1-9])\s+(\d{3,6})(?:\s*(?:lei|лей|mdl|л))?(?=[\s,;.]|$)/i);
  if (m && Number(m[3]) <= Number(m[4])) {
    if (m[2] && Number(m[2]) >= 1 && Number(m[2]) <= 20) out.rooms = Number(m[2]);
    out.stage = `${m[3]}/${m[4]}`;
    out.price = Number(m[5]);
    t = t.replace(m[0], m[1] + ' ');
  } else {
    const st = t.match(/(?:этап|etapa)\s*([1-9])\s*\/\s*([1-9])/i);
    if (st && Number(st[1]) <= Number(st[2])) { out.stage = `${st[1]}/${st[2]}`; t = t.replace(st[0], ' '); }
    const pr = t.match(/(?:цена|стоимость|pre[țt]|suma)?\s*[:\-]?\s*(\d{3,6})\s*(?:lei|лей|mdl)(?=[\s,;.]|$)/i);
    if (pr) { out.price = Number(pr[1]); t = t.replace(pr[0], ' '); }
  }
  // участок: «10 соток», «6 сот.»
  const sk = t.match(/(^|[\s,;])(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:сот(?:ок|ки|ка|\.)?|ari|ar)(?=[\s,;.]|$)/i);
  if (sk) { out.sotki = Number(sk[2].replace(',', '.')); t = t.replace(sk[0], sk[1] + ' '); }
  // повышенный коэффициент: «x2», «×2,5», «коэф 2.5», «k1,5»
  const mk = t.match(/(^|[\s,;])(?:[x×х]|k|коэф(?:фициент)?\.?:?)\s*(\d{1,2}(?:[.,]\d{1,2})?)(?=[\s,;.]|$)/i);
  if (mk) {
    const m = Number(mk[2].replace(',', '.'));
    if (m > 1 && m <= 10) { out.mult = m; t = t.replace(mk[0], mk[1] + ' '); }
  }
  out.text = t.replace(/[ \t]{2,}/g, ' ');
  return out;
}

export function parseTask(text, now = new Date()) {
  const deal = extractDeal(String(text || '').trim());
  const raw = deal.text.trim();
  if (!raw || raw.startsWith('/')) return null;
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = { company: '', address: '', procedure: '', pests: [], phone: '', comment: '', area: '' };
  let dateStr = '';
  let timeStr = '';
  const free = [];

  for (const line of lines) {
    const m = line.match(/^([^:–—-]{2,25})\s*[:–—-]\s*(.+)$/);
    const key = m && Object.entries(KEYS).find(([, words]) => words.some((w) => m[1].toLowerCase().replace(/[^\p{L}\d.²]/gu, ' ').trim().startsWith(w)));
    if (m && key) {
      const [k] = key;
      const v = m[2].trim();
      if (k === 'date') dateStr = v;
      else if (k === 'time') timeStr = v;
      else if (k === 'pests') out.pests = detectPests(v).length ? detectPests(v) : [];
      else if (k === 'procedure') out.procedure = detectProcedure(v, []) || v;
      else if (k === 'comment') out.comment = out.comment ? `${out.comment}\n${v}` : v;
      else out[k] = v;
    } else free.push(line);
  }

  // свободный текст
  const all = raw;
  if (!out.pests.length) out.pests = detectPests(all);
  if (!out.procedure || !['Дезинсекция', 'Дератизация', 'Дезинфекция'].includes(out.procedure)) {
    out.procedure = detectProcedure(all, out.pests) || out.procedure;
  }
  if (!out.phone) {
    for (const line of free) {
      for (const seg of line.split(/[,;]/)) {
        const mm = seg.match(/(\+?\(?\d[\d\s()-]{6,}\d)/);
        if (!mm) continue;
        // отрезаем ведущие короткие группы («кв 45 069…»)
        let cand = mm[1].trim();
        const groups = cand.split(/\s+/);
        while (groups.length > 1 && cand.replace(/\D/g, '').length > 13) { groups.shift(); cand = groups.join(' '); }
        while (groups.length > 1 && !groups[0].startsWith('+') && !groups[0].startsWith('0') && groups[0].length <= 3 && groups.slice(1).join('').replace(/\D/g, '').length >= 8) {
          groups.shift(); cand = groups.join(' ');
        }
        const digits = cand.replace(/\D/g, '').length;
        if (digits >= 8 && digits <= 13) { out.phone = cand; break; }
      }
      if (out.phone) break;
    }
  }
  // телефон, записанный в строке адреса («str. Lupu 24 Radu 79612345»), выносим из адреса
  if (out.address) {
    const pm = out.address.match(/(\+?\d[\d\s-]{6,}\d)\s*$/) || out.address.match(/(?:^|\s)(\+?\d{8,12})(?=\s|$)/);
    if (pm && pm[1].replace(/\D/g, '').length >= 8 && pm[1].replace(/\D/g, '').length <= 13) {
      out.address = out.address.replace(pm[1], ' ').replace(/\s{2,}/g, ' ').replace(/[,\s]+$/, '').trim();
      if (!out.phone) out.phone = pm[1].trim();
      else out.comment = [out.comment, `Ещё телефон: ${pm[1].trim()}`].filter(Boolean).join('\n');
    }
  }
  const date = parseDate(dateStr || all, now);
  const time = parseTime(timeStr || '', Boolean(timeStr)) || parseTime(free.join(' '), false);

  // одна строка через запятые → разбиваем на части, адресные части склеиваем обратно
  const splitCommas = (l) => {
    const res = [];
    for (const seg of l.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (ADDRESS_MARK.test(` ${seg}`) && res.length && ADDRESS_MARK.test(` ${res[res.length - 1]}`)) res[res.length - 1] += `, ${seg}`;
      else res.push(seg);
    }
    return res;
  };
  let parts = free;
  if (free.length === 1 && (free[0].match(/,/g) || []).length >= 1) parts = splitCommas(free[0]);
  else if (free.length > 1) {
    // «24.09 16:00 Orhei, strada Lupu 24 …» в первой строке многострочной заявки: город/клиент отдельно от улицы
    parts = free.flatMap((l) => (l.includes(',') && ADDRESS_MARK.test(` ${l}`) && !ADDRESS_MARK.test(` ${l.split(',')[0]}`) ? splitCommas(l) : [l]));
  }
  // слова-вредители и тип обработки вырезаем из строки: «ул. Мира 5 клопы» → адрес «ул. Мира 5»
  const PEST_TOKEN = /^(рыж|ч[её]рн|negr|ro[sș]ca|дезинс|дератиз|дезинф|dezins|deratiz|dezinf)/i;
  const stripPests = (l) => l.split(/\s+/).filter((w) => {
    const bare = w.replace(/[.,;!?()«»"]/g, '');
    return !bare || !(detectPests(bare).length || PEST_TOKEN.test(bare) || /^(и|și|si)$/i.test(bare));
  }).join(' ').replace(/[,\s]+$/, '').trim();
  const onlyKeywords = (l) => (detectPests(l).length > 0 || PEST_TOKEN.test(l)) && !stripPests(l);
  const isDateTime = (l) => /^((\d{1,2}\.\d{1,2}(\.\d{2,4})?|сегодня|завтра|послезавтра|azi|mâine|maine)(\s|$)|(в\s|la\s)?\d{1,2}:\d{2}$)/i.test(l);

  const rest = [];
  const tail = []; // в однострочной заявке всё, что после адреса, — комментарий («…, осы под крышей»)
  const oneLine = free.length === 1 && parts !== free;
  for (const line of parts) {
    const clean0 = (out.phone ? line.replace(out.phone, '') : line)
      .replace(/(^|[\s,])\d{1,2}\.\d{1,2}(\.\d{2,4})?(?=[\s,]|$)|\b\d{1,2}:\d{2}\b|(^|[\s,])(в|la)\s*$/g, ' ')

      .replace(/\s{2,}/g, ' ').replace(/[,\s]+$/, '').replace(/^[,\s]+/, '').trim();
    const withDate = clean0;
    // «str. Ismail 33, завтра» → «str. Ismail 33»
    const noDate = clean0.replace(/(^|[\s,])(сегодня|завтра|послезавтра|azi|m[âa]ine|poim[âa]ine)(?=[\s,]|$)/giu, ' ')
      .replace(/(^|[\s,])(в|la)\s*$/g, ' ').replace(/(\s*,\s*)+/g, ', ').replace(/\s{2,}/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim();
    const clean = detectPests(noDate).length ? stripPests(noDate) : noDate;
    if (!out.address && ADDRESS_MARK.test(` ${line}`) && out.phone && line.includes(out.phone)) {
      // «str. Lupu 24 Radu 79672212 roscat 1 2/2 1000»: адрес — до имени и телефона, остальное — в комментарий
      let before = line.slice(0, line.indexOf(out.phone))
        .replace(/(^|[\s,])\d{1,2}\.\d{1,2}(\.\d{2,4})?(?=[\s,]|$)|\b\d{1,2}:\d{2}\b/g, ' ').replace(/\s{2,}/g, ' ').trim();
      const after = stripPests(line.slice(line.indexOf(out.phone) + out.phone.length).trim());
      const nm = before.match(/[\s,]+(\p{Lu}\p{Ll}{2,})$/u);
      if (nm && !ADDRESS_MARK.test(` ${nm[1]} `)) before = before.slice(0, nm.index).trim();
      out.address = stripPests(before).replace(/[,\s]+$/, '') || before;
      if (nm) tail.push(`Контакт: ${nm[1]}`);
      if (after) tail.push(after);
    } else if (!out.address && ADDRESS_MARK.test(` ${line}`)) out.address = clean || line;
    else if (clean && !isDateTime(withDate) && !onlyKeywords(clean)) {
      // без слов (цифры, цена, «3 1/2») — это не клиент и не адрес, а комментарий; оставляем строку целиком
      if (!/\p{L}{2,}/u.test(clean)) {
        const dg = clean.replace(/\D/g, '');
        tail.push(dg.length >= 8 && dg.length <= 13 && /^[\d\s+()-]+$/.test(clean) ? `Ещё телефон: ${clean}` : clean0);
      }
      else (oneLine && out.address ? tail : rest).push(clean);
    }
  }
  // адрес без явных «ул./str.»: строка со словом и номером дома
  if (!out.address) {
    const i = rest.findIndex((l) => ADDRESS_LIKE.test(l));
    if (i >= 0) out.address = rest.splice(i, 1)[0];
  }
  if (!out.company && rest.length) out.company = rest.shift();
  if (!out.address && rest.length) out.address = rest.shift();
  // «Bulevardul Grigore Vieru 8 Radu» — имя клиента после номера дома уходит в «Контакт»
  const nameTail = out.address.match(/(\d+[\p{L}]?(?:[/-]\d+)?)\s+(\p{Lu}\p{Ll}{2,})$/u);
  if (nameTail && !ADDRESS_MARK.test(` ${nameTail[2]} `) && !/Контакт:/.test(out.comment + tail.join(' '))) {
    out.address = out.address.slice(0, out.address.length - nameTail[2].length).trim();
    tail.unshift(`Контакт: ${nameTail[2]}`);
  }
  if (rest.length || tail.length) out.comment = [out.comment, ...rest, ...tail].filter(Boolean).join('\n');

  // заявка должна содержать адрес или клиента плюс хоть какую-то деталь — иначе это обычная переписка
  // заявка = адрес, либо имя/название плюс вредитель или тип обработки
  const details = out.pests.length || out.procedure;
  if (!out.address && !(out.company && details)) return null;
  out.rooms = deal.rooms;
  out.stage = deal.stage;
  out.price = deal.price;
  out.mult = deal.mult;
  out.sotki = deal.sotki;
  out.planned_at = date ? zonedIso(date.y, date.m, date.d, time?.hh ?? 9, time?.mm ?? 0) : null;
  out.has_time = Boolean(date && time);
  return out;
}

/** Похоже на попытку написать заявку (есть вредитель, телефон, дата/время или адресное слово), но парсер её не принял. */
export function looksLikeTask(text) {
  const t = String(text || '');
  return detectPests(t).length > 0 || /\d{6,}|\d{2,3}[\s-]\d{2,3}[\s-]\d{2,3}/.test(t) || /\b\d{1,2}[.:]\d{2}\b/.test(t) || ADDRESS_MARK.test(` ${t}`);
}

export const TASK_TEMPLATE = [
  'Клиент: SRL «Название»',
  'Адрес: mun. Chișinău, str. Ismail 33',
  'Дата: 25.09',
  'Время: 10:00',
  'Обработка: дезинсекция',
  'Вредители: рыжие тараканы, клопы',
  'Телефон: +373 69 000 000',
  'Комментарий: вход со двора',
].join('\n');
