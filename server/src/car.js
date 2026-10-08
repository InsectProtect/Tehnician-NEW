// ====================================================================================================
// «МОЙ АВТО» (v47): машина сотрудника, заправки с фото чека, пробег, ТО по регламенту, советы (ИИ),
// фотопроверка чистоты 1–2 раза в неделю: 3–5 фото снаружи, 2–3 в салоне, 1–3 в будке.
// ИИ (ANTHROPIC_API_KEY) оценивает фото: чисто → +1…3 балла KPI; грязно/непонятно → менеджеру и администратору.
// ====================================================================================================
import { sendMessage, editMessage, escHtml, botEnabled } from './tgbot.js';
import { signLink, verifyLink } from './auth.js';
// ИИ пока выключен (решение владельца): фото проверяют менеджер/администратор, сумму и литры вводит сотрудник.
// Чтобы включить позже — вернуть import { aiOn, aiJson } from './ai.js'.
const aiOn = () => false;
const aiJson = async () => { throw new Error('ИИ выключен'); };
import { zonedIso } from './tasks.js';

// Регламент ТО по пробегу. Интервалы по умолчанию; администратор может изменить или выключить любой пункт (car_cfg.service_km).
const ICE = ['petrol', 'diesel', 'gas', 'hybrid'];
export const SERVICE_ITEMS = [
  { id: 'oil', label: 'Масло и масляный фильтр', km: 0, fuels: ICE }, // интервал — из настроек машины
  { id: 'tires', label: 'Перестановка и балансировка шин', km: 10000 },
  { id: 'gas_filters', label: 'Фильтры ГБО', km: 10000, fuels: ['gas'] },
  { id: 'cabin', label: 'Салонный фильтр', km: 15000 },
  { id: 'brakes', label: 'Тормозные колодки (проверка)', km: 15000 },
  { id: 'alignment', label: 'Развал-схождение', km: 15000 },
  { id: 'air', label: 'Воздушный фильтр', km: 20000, fuels: ICE },
  { id: 'suspension', label: 'Диагностика подвески', km: 20000 },
  { id: 'plugs', label: 'Свечи зажигания', km: 30000, fuels: ['petrol', 'gas', 'hybrid'] },
  { id: 'battery', label: 'Аккумулятор (проверка)', km: 30000 },
  { id: 'ac', label: 'Кондиционер (обслуживание)', km: 30000 },
  { id: 'fuel_filter', label: 'Топливный фильтр', km: 40000, fuels: ICE },
  { id: 'brake_fluid', label: 'Тормозная жидкость', km: 40000 },
  { id: 'shocks', label: 'Амортизаторы (проверка)', km: 50000 },
  { id: 'coolant', label: 'Антифриз', km: 60000 },
  { id: 'gearbox', label: 'Масло КПП', km: 60000 },
  { id: 'aux_belt', label: 'Ремень навесного оборудования', km: 60000, fuels: ICE },
  { id: 'brake_discs', label: 'Тормозные диски', km: 60000 },
  { id: 'clutch', label: 'Сцепление (проверка)', km: 60000 },
  { id: 'glow_plugs', label: 'Свечи накаливания', km: 80000, fuels: ['diesel'] },
  { id: 'timing', label: 'Ремень / цепь ГРМ (проверка)', km: 90000, fuels: ICE },
  { id: 'dpf', label: 'Сажевый фильтр / EGR (чистка)', km: 100000, fuels: ['diesel'] },
];
// Прочие расходы (кроме топлива)
export const EXPENSE_KINDS = {
  wash: { label: 'Мойка', icon: '🧽' },
  adblue: { label: 'AdBlue', icon: '💧', liters: true },
  parking: { label: 'Парковка / дорога', icon: '🅿️' },
  repair: { label: 'Ремонт / запчасти', icon: '🔧' },
  other: { label: 'Другое', icon: '🧾' },
};
const FUELS = { petrol: 'Бензин', diesel: 'Дизель', gas: 'Газ / бензин', hybrid: 'Гибрид', electric: 'Электро' };
const ZONES = { ext: 'Снаружи', int: 'Салон', box: 'Будка' };
const XPC = { fuel: 10, week: 20, km: 5, service: 10, check: 20, clean: 10 };
const DEFAULT_CFG = { on: true, checks_per_week: 2, from_hour: 9, to_hour: 17, deadline_hour: 20, points_min: 1, points_max: 3, photos: { ext: [3, 5], int: [2, 3], box: [1, 3] }, service_interval: 10000, service_km: {} };

const num = (v, d = null) => { if (v === undefined || v === null || v === '') return d; const n = Number(String(v).replace(',', '.').replace(/\s/g, '')); return Number.isFinite(n) ? n : d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const kmS = (n) => `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} км`;

export function initCar(ctx) {
  const { db, route, must, str, uid, now, getSetting, setSetting, audit, awardXp, publicBase, TZN, addNotification } = ctx;

  function lp(d = new Date()) {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZN, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(d);
    const g = (t) => f.find((p) => p.type === t)?.value;
    return { y: +g('year'), m: +g('month'), d: +g('day'), h: +g('hour') % 24, mi: +g('minute'), wd: g('weekday'), day: `${g('year')}-${g('month')}-${g('day')}`, month: `${g('year')}-${g('month')}` };
  }
  const weekKey = (d = new Date()) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
    return `${x.getUTCFullYear()}-W${String(Math.ceil(((x - y0) / 86400000 + 1) / 7)).padStart(2, '0')}`;
  };

  async function cfg() {
    const c = (await getSetting('car_cfg')) || {};
    return { ...DEFAULT_CFG, ...c, photos: { ...DEFAULT_CFG.photos, ...(c.photos || {}) }, service_km: { ...(c.service_km || {}) } };
  }
  const photoUrl = (kind, id) => `/r/car/${kind}/${id}?${signLink(`car:${kind}:${id}`, 3600 * 24 * 7)}`;
  function b64img(s) {
    const buf = Buffer.from(String(s).replace(/^data:[^,]+,/, ''), 'base64');
    const mime = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : null;
    must(mime, 400, 'Фото должно быть JPEG или PNG');
    must(buf.length <= 5_000_000, 400, 'Фото больше 5 МБ');
    return { mime, data: buf.toString('base64') };
  }
  async function staffAndAdmins() {
    return (await db.query("SELECT tg_id FROM users WHERE status = 'active' AND role IN ('admin', 'manager')")).map((u) => String(u.tg_id));
  }
  async function points(tgId, pts, reason, ref) {
    await db.query('DELETE FROM kpi_adjust WHERE ref = $1', [ref]);
    if (!pts) return;
    await db.query("INSERT INTO kpi_adjust (id, month, tg_id, rule, points, reason, status, created_at, decided_at, decided_by, ref) VALUES ($1,$2,$3,'car',$4,$5,'applied',$6,$6,'авто',$7)",
      [uid(), lp().month, String(tgId), pts, reason, now(), ref]);
  }

  // ---------- состояние машины ----------
  async function carOf(tg) { const [c] = await db.query('SELECT * FROM cars WHERE tg_id = $1', [String(tg)]); return c || null; }

  /** Интервал пункта ТО: масло — из машины; остальное — настройка администратора (0 = пункт выключен) или по умолчанию. */
  function intervalOf(it, car, c) {
    if (it.id === 'oil') return Number(car.service_interval) || 10000;
    const o = c.service_km?.[it.id];
    return o === undefined || o === null ? it.km : Number(o);
  }
  async function serviceState(car) {
    const c = await cfg();
    const logs = await db.query('SELECT item, MAX(km) AS km FROM car_service WHERE tg_id = $1 GROUP BY item', [car.tg_id]);
    const last = Object.fromEntries(logs.map((l) => [l.item, Number(l.km)]));
    const km = Number(car.mileage) || 0;
    return SERVICE_ITEMS.filter((it) => (!it.fuels || it.fuels.includes(car.fuel)) && intervalOf(it, car, c) > 0).map((it) => {
      const interval = intervalOf(it, car, c);
      const done = last[it.id];
      const next = done != null ? done + interval : (Math.floor(km / interval) + 1) * interval;
      const left = next - km;
      return { id: it.id, label: it.label, interval, last_km: done ?? null, next_km: next, left, state: left < 0 ? 'overdue' : left <= Math.max(1000, interval * 0.1) ? 'soon' : 'ok' };
    }).sort((a, b) => a.left - b.left);
  }

  function seasonTip(month) {
    if ([10, 11].includes(month)) return { id: 'winter', title: 'Зимняя резина', text: 'Когда ночью ниже +7 °C — пора ставить зимние шины. Проверьте антифриз и аккумулятор.' };
    if ([3, 4].includes(month)) return { id: 'summer', title: 'Летняя резина', text: 'Днём стабильно выше +7 °C — меняйте шины на летние, помойте днище от реагентов.' };
    if ([6, 7, 8].includes(month)) return { id: 'ac', title: 'Кондиционер', text: 'Жара: проверьте кондиционер и уровень охлаждающей жидкости, не оставляйте препараты в нагретой будке.' };
    return null;
  }

  const MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

  /** Статистика авто. «За месяц» — с 1-го числа текущего месяца (по Кишинёву): каждый новый месяц счёт начинается с нуля. */
  async function stats(car) {
    const month = lp().month;
    const [y, m] = month.split('-').map(Number);
    const from = zonedIso(y, m, 1, 0, 0);
    const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1;
    const prevFrom = zonedIso(py, pm, 1, 0, 0);
    const fuel = await db.query('SELECT km, amount, liters, created_at FROM car_fuel WHERE tg_id = $1 ORDER BY km', [car.tg_id]);
    const inMonth = fuel.filter((f) => f.created_at >= from);
    const prevMonth = fuel.filter((f) => f.created_at >= prevFrom && f.created_at < from);
    const sum = (a, k) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0);
    // пробег на начало месяца: самая большая отметка (заправки, ТО) до 1-го числа; машину завели в этом месяце — стартовый пробег
    const svc = await db.query('SELECT km FROM car_service WHERE tg_id = $1 AND created_at < $2', [car.tg_id, from]);
    const kmBefore = [...fuel.filter((f) => f.created_at < from), ...svc].map((r) => Number(r.km) || 0);
    const startKm = car.created_at >= from || !kmBefore.length ? Number(car.mileage_start) : Math.max(Number(car.mileage_start), ...kmBefore);
    const kmMonth = Math.max(0, Number(car.mileage) - startKm);
    // средний расход: литры между первой и последней заправкой / пройденные км
    let per100 = null;
    const withL = fuel.filter((f) => Number(f.liters) > 0);
    if (withL.length >= 2) {
      const dist = Number(withL[withL.length - 1].km) - Number(withL[0].km);
      const lit = sum(withL.slice(1), 'liters');
      if (dist > 50) per100 = Math.round((lit / dist) * 1000) / 10;
    }
    const monthAmount = sum(inMonth, 'amount');
    const ex = await db.query('SELECT kind, amount, created_at FROM car_expenses WHERE tg_id = $1 AND created_at >= $2', [car.tg_id, prevFrom]);
    const exMonth = ex.filter((e) => e.created_at >= from);
    const byKind = {};
    for (const e of exMonth) byKind[e.kind] = Math.round((byKind[e.kind] || 0) + Number(e.amount));
    const exAmount = Math.round(sum(exMonth, 'amount'));
    const svcMonth = Math.round(sum(await db.query('SELECT amount FROM car_service WHERE tg_id = $1 AND created_at >= $2', [car.tg_id, from]), 'amount'));
    return {
      expenses_month: exAmount, expenses_by_kind: byKind, expenses_prev_month: Math.round(sum(ex.filter((e) => e.created_at < from), 'amount')),
      service_month: svcMonth, spend_month: Math.round(monthAmount) + exAmount + svcMonth,
      mileage: Number(car.mileage), km_total: Math.max(0, Number(car.mileage) - Number(car.mileage_start)), km_month: kmMonth,
      fuel_month: Math.round(monthAmount), fuel_total: Math.round(sum(fuel, 'amount')), refuels_month: inMonth.length,
      month_label: MONTHS_RU[m - 1], prev_month_label: MONTHS_RU[pm - 1], fuel_prev_month: Math.round(sum(prevMonth, 'amount')),
      liters_month: Math.round(sum(inMonth, 'liters') * 10) / 10, per100, cost_km: kmMonth > 0 && monthAmount > 0 ? Math.round((monthAmount / kmMonth) * 100) / 100 : null,
      last_refuel: fuel.length ? [...fuel].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0].created_at : null,
    };
  }

  async function refreshAiTip(car) {
    if (!aiOn() || !car.make) return;
    if (car.ai_tip_km != null && Math.abs(Number(car.mileage) - Number(car.ai_tip_km)) < 1000) return;
    await db.query('UPDATE cars SET ai_tip_km = $1 WHERE tg_id = $2', [Number(car.mileage), car.tg_id]); // не спрашивать повторно, пока идёт запрос
    try {
      const st = await serviceState(car);
      const r = await aiJson(`Ты автомеханик. Служебная машина дезинсектора: ${car.make} ${car.model || ''}, ${car.year || 'год не указан'}, топливо: ${FUELS[car.fuel] || car.fuel}, пробег ${car.mileage} км. Регламент по пробегу (км до работ): ${st.slice(0, 6).map((s) => `${s.label}: ${s.left}`).join('; ')}. Сейчас месяц ${lp().m}. Дай 2–3 коротких практических совета по обслуживанию именно для этой модели и пробега (типичные слабые места, что проверить). Ответь только JSON: {"tips":["...","..."]}`, [], { maxTokens: 500 });
      const tips = (Array.isArray(r.tips) ? r.tips : []).map((t) => String(t).slice(0, 300)).slice(0, 3);
      if (tips.length) await db.query('UPDATE cars SET ai_tip = $1 WHERE tg_id = $2', [JSON.stringify(tips), car.tg_id]);
    } catch (e) { console.error('car ai tip:', e.message); }
  }

  async function checkOut(c, withPhotos = false) {
    const out = { id: c.id, day: c.day, status: c.status, requested_at: c.requested_at, due_at: c.due_at, submitted_at: c.submitted_at, ai_verdict: c.ai_verdict, ai_score: c.ai_score == null ? null : Number(c.ai_score), ai_note: c.ai_note, points: c.points == null ? null : Number(c.points), decided_by: c.decided_by };
    if (withPhotos) out.photos = (await db.query('SELECT id, zone FROM car_photos WHERE check_id = $1 ORDER BY created_at', [c.id])).map((p) => ({ id: p.id, zone: p.zone, url: photoUrl('p', p.id) }));
    return out;
  }

  async function fullFor(tg) {
    const c = await cfg();
    const car = await carOf(tg);
    const checks = await db.query('SELECT * FROM car_checks WHERE tg_id = $1 ORDER BY requested_at DESC LIMIT 10', [String(tg)]);
    const pending = checks.find((x) => x.status === 'requested');
    const delReq = await pendingDeleteReq(tg);
    if (!car) return { on: c.on, expense_kinds: EXPENSE_KINDS, car: null, pending: pending ? await checkOut(pending) : null, photos_need: c.photos, fuels: FUELS, items: SERVICE_ITEMS.map(({ id, label }) => ({ id, label })), ai: aiOn(), delete_request: delReq ? { status: delReq.status } : null };
    refreshAiTip(car).catch(() => {});
    const service = await serviceState(car);
    const fuel = await db.query('SELECT id, km, amount, liters, ai_note, created_at, photo <> \'\' AS has_photo FROM car_fuel WHERE tg_id = $1 ORDER BY created_at DESC LIMIT 15', [car.tg_id]);
    const expenses = await db.query('SELECT id, kind, amount, liters, km, note, created_at FROM car_expenses WHERE tg_id = $1 ORDER BY created_at DESC LIMIT 20', [car.tg_id]);
    const tips = [];
    for (const s of service.filter((x) => x.state !== 'ok').slice(0, 3)) tips.push({ id: s.id, title: s.state === 'overdue' ? `${s.label}: просрочено на ${kmS(-s.left)}` : `${s.label}: через ${kmS(s.left)}`, text: s.state === 'overdue' ? 'Запишитесь на сервис и отметьте «Сделал» с пробегом.' : 'Запланируйте замену заранее, чтобы не выпасть из графика заявок.' });
    const season = seasonTip(lp().m);
    if (season) tips.push(season);
    let ai = [];
    try { ai = JSON.parse(car.ai_tip || '[]'); } catch { /* пусто */ }
    for (const t of ai) tips.push({ id: 'ai', title: 'Совет ИИ', text: t, ai: true });
    const oil = service.find((s) => s.id === 'oil');
    return {
      on: c.on, ai: aiOn(), photos_need: c.photos, fuels: FUELS, items: SERVICE_ITEMS.map(({ id, label }) => ({ id, label })),
      car: { make: car.make, model: car.model, year: car.year == null ? null : Number(car.year), plate: car.plate, fuel: car.fuel, mileage: Number(car.mileage), mileage_start: Number(car.mileage_start), mileage_at: car.mileage_at, service_interval: Number(car.service_interval) },
      to: oil ? { left: oil.left, next_km: oil.next_km, interval: oil.interval, state: oil.state } : null,
      stats: await stats(car), service, tips,
      fuel: fuel.map((f) => ({ id: f.id, km: Number(f.km), amount: f.amount == null ? null : Number(f.amount), liters: f.liters == null ? null : Number(f.liters), ai_note: f.ai_note, created_at: f.created_at, photo: Number(f.has_photo) || f.has_photo === true ? photoUrl('f', f.id) : null })),
      expenses: expenses.map((e) => ({ id: e.id, kind: e.kind, amount: Number(e.amount), liters: e.liters == null ? null : Number(e.liters), km: e.km == null ? null : Number(e.km), note: e.note, created_at: e.created_at })),
      expense_kinds: EXPENSE_KINDS,
      pending: pending ? await checkOut(pending) : null,
      checks: await Promise.all(checks.filter((x) => x.status !== 'requested').slice(0, 6).map((x) => checkOut(x))),
      delete_request: delReq ? { status: delReq.status } : null,
    };
  }

  // ---------- API сотрудника ----------
  const carGuard = async () => must((await cfg()).on, 400, 'Раздел «Мой авто» выключен администратором');

  route('GET', '/api/car', async ({ user }) => fullFor(user.id));

  route('PUT', '/api/car', async ({ user, body }) => {
    await carGuard();
    const make = str(body.make, 60); must(make.length >= 2, 400, 'Укажите марку');
    const year = num(body.year); must(year == null || (year >= 1970 && year <= lp().y + 1), 400, 'Некорректный год');
    const mileage = Math.round(num(body.mileage, -1)); must(mileage >= 0 && mileage < 2_000_000, 400, 'Укажите пробег');
    const fuel = FUELS[body.fuel] ? body.fuel : 'petrol';
    const interval = clamp(Math.round(num(body.service_interval, (await cfg()).service_interval)), 3000, 30000);
    const cur = await carOf(user.id);
    if (cur) {
      must(mileage >= Number(cur.mileage) || user.isAdmin, 400, `Пробег не может уменьшиться (сейчас ${kmS(cur.mileage)})`);
      await db.query('UPDATE cars SET make = $1, model = $2, year = $3, plate = $4, fuel = $5, mileage = $6, service_interval = $7, updated_at = $8, mileage_at = CASE WHEN mileage <> $6 THEN $8 ELSE mileage_at END WHERE tg_id = $9',
        [make, str(body.model, 60), year, str(body.plate, 20).toUpperCase(), fuel, mileage, interval, now(), String(user.id)]);
    } else {
      await db.query('INSERT INTO cars (tg_id, make, model, year, plate, fuel, mileage_start, mileage, mileage_at, service_interval, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$8,$8)',
        [String(user.id), make, str(body.model, 60), year, str(body.plate, 20).toUpperCase(), fuel, mileage, now(), interval]);
      await awardXp(user.id, 'car', 30, 'car:new', 'Добавил свой авто');
      await audit(user, 'Добавил авто', `${make} ${str(body.model, 60)}`, `${year || ''} · ${kmS(mileage)}`);
    }
    return fullFor(user.id);
  });

  async function setMileage(tg, km) {
    await db.query('UPDATE cars SET mileage = $1, mileage_at = $2, updated_at = $2 WHERE tg_id = $3 AND mileage <= $1', [km, now(), String(tg)]);
  }

  route('POST', '/api/car/fuel', async ({ user, body }) => {
    await carGuard();
    const car = await carOf(user.id); must(car, 400, 'Сначала добавьте свой авто');
    const km = Math.round(num(body.km, -1));
    must(km >= Number(car.mileage), 400, `Пробег не может быть меньше текущего (${kmS(car.mileage)})`);
    must(km - Number(car.mileage) <= 5000, 400, `Слишком большой скачок пробега (+${kmS(km - Number(car.mileage))}) — проверьте цифры`);
    must(body.photo, 400, 'Сфотографируйте чек заправки');
    const img = b64img(body.photo);
    const amount = num(body.amount); must(amount != null && amount > 0 && amount < 100000, 400, 'Укажите сумму заправки (лей)');
    const liters = num(body.liters); must(liters != null && liters > 0 && liters < 1000, 400, 'Укажите, сколько литров заправили');
    const id = uid();
    await db.query('INSERT INTO car_fuel (id, tg_id, km, amount, liters, mime, photo, day, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, String(user.id), km, amount, liters, img.mime, img.data, lp().day, now()]);
    await setMileage(user.id, km);
    const xp1 = await awardXp(user.id, 'car_fuel', XPC.fuel, `cfuel:${id}`, 'Заправка с чеком');
    const xp2 = await awardXp(user.id, 'car_week', XPC.week, `cweek:${weekKey()}`, 'Регулярно веду «Мой авто»');
    if (aiOn() && (amount == null || liters == null)) readReceipt(id).catch((e) => console.error('receipt ai:', e.message));
    return { ok: true, xp: (xp1 ? XPC.fuel : 0) + (xp2 ? XPC.week : 0), ...(await fullFor(user.id)) };
  });

  /** ИИ читает чек: сумма и литры, если сотрудник их не ввёл. */
  async function readReceipt(id) {
    const [f] = await db.query('SELECT * FROM car_fuel WHERE id = $1', [id]);
    if (!f?.photo) return;
    const r = await aiJson('Это фото чека с АЗС (Молдова, сумма в леях MDL). Найди итоговую сумму оплаты и количество литров топлива. Ответь только JSON: {"amount": число или null, "liters": число или null, "fuel": "тип топлива или пусто", "readable": true/false}', [{ mime: f.mime, data: f.photo }], { maxTokens: 200 });
    const amount = f.amount == null && Number(r.amount) > 0 ? Number(r.amount) : f.amount;
    const liters = f.liters == null && Number(r.liters) > 0 ? Number(r.liters) : f.liters;
    await db.query('UPDATE car_fuel SET amount = $1, liters = $2, ai_note = $3 WHERE id = $4', [amount, liters, r.readable === false ? 'ИИ: чек не читается' : 'ИИ прочитал чек', id]);
  }

  route('POST', '/api/car/mileage', async ({ user, body }) => {
    await carGuard();
    const car = await carOf(user.id); must(car, 400, 'Сначала добавьте свой авто');
    const km = Math.round(num(body.km, -1));
    must(km >= Number(car.mileage), 400, `Пробег не может быть меньше текущего (${kmS(car.mileage)})`);
    must(km - Number(car.mileage) <= 5000, 400, 'Слишком большой скачок пробега — проверьте цифры');
    await setMileage(user.id, km);
    const xp = await awardXp(user.id, 'car_km', XPC.km, `ckm:${lp().day}`, 'Обновил пробег');
    return { ok: true, xp: xp ? XPC.km : 0, ...(await fullFor(user.id)) };
  });

  route('POST', '/api/car/service', async ({ user, body }) => {
    await carGuard();
    const car = await carOf(user.id); must(car, 400, 'Сначала добавьте свой авто');
    const item = SERVICE_ITEMS.find((i) => i.id === body.item); must(item, 400, 'Выберите, что сделано');
    const km = Math.round(num(body.km, Number(car.mileage)));
    must(km >= 0 && km <= Number(car.mileage) + 5000, 400, 'Некорректный пробег');
    const id = uid();
    await db.query('INSERT INTO car_service (id, tg_id, item, km, note, amount, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, String(user.id), item.id, km, str(body.note, 200), num(body.amount), now()]);
    if (km > Number(car.mileage)) await setMileage(user.id, km);
    const xp = await awardXp(user.id, 'car_service', XPC.service, `csrv:${id}`, `ТО: ${item.label}`);
    return { ok: true, xp: xp ? XPC.service : 0, ...(await fullFor(user.id)) };
  });

  route('POST', '/api/car/checks/:id/submit', async ({ user, params, body }) => {
    const c = await cfg();
    const [ch] = await db.query('SELECT * FROM car_checks WHERE id = $1 AND tg_id = $2', [params.id, String(user.id)]);
    must(ch, 404, 'Проверка не найдена');
    must(ch.status === 'requested', 400, 'Фото уже отправлены');
    const sets = {};
    for (const z of Object.keys(ZONES)) {
      const arr = Array.isArray(body[z]) ? body[z] : [];
      const [mn, mx] = c.photos[z];
      must(arr.length >= mn, 400, `${ZONES[z]}: нужно минимум ${mn} фото`);
      must(arr.length <= mx, 400, `${ZONES[z]}: не больше ${mx} фото`);
      sets[z] = arr.map(b64img);
    }
    for (const [z, arr] of Object.entries(sets)) for (const im of arr) {
      await db.query('INSERT INTO car_photos (id, check_id, tg_id, zone, mime, data, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [uid(), ch.id, String(user.id), z, im.mime, im.data, now()]);
    }
    await db.query("UPDATE car_checks SET status = 'checking', submitted_at = $1 WHERE id = $2", [now(), ch.id]);
    const xp = await awardXp(user.id, 'car_check', XPC.check, `cchk:${ch.id}`, 'Фотопроверка авто');
    evaluate(ch.id).catch((e) => console.error('car check eval:', e.message));
    return { ok: true, xp: xp ? XPC.check : 0 };
  });

  // ---------- оценка фото (ИИ или вручную) ----------
  async function evaluate(checkId) {
    const [ch] = await db.query('SELECT * FROM car_checks WHERE id = $1', [checkId]);
    if (!ch) return;
    const c = await cfg();
    if (!aiOn()) {
      await db.query("UPDATE car_checks SET status = 'review' WHERE id = $1", [ch.id]);
      return askReview(ch.id, 'Сотрудник прислал фото машины — проверьте, чисто ли снаружи, в салоне и в будке.');
    }
    const photos = await db.query('SELECT zone, mime, data FROM car_photos WHERE check_id = $1 ORDER BY zone, created_at', [ch.id]);
    const car = await carOf(ch.tg_id);
    let r;
    try {
      r = await aiJson(`Ты проверяешь служебную машину дезинсектора${car ? ` (${car.make} ${car.model || ''})` : ''}. Фото подписаны: «Снаружи», «Салон», «Будка» (грузовой отсек с препаратами и оборудованием).
Оцени чистоту и порядок. Грязь, пыль, мусор, пятна, разбросанные препараты, беспорядок в будке — это «dirty». Если на фото не машина, фото размыты, темно, повторяются одинаковые кадры или нельзя понять состояние — «unclear».
Ответь только JSON: {"is_car": true/false, "verdict": "clean" | "dirty" | "unclear", "score": 1-3 (3 — идеально, 2 — хорошо, 1 — приемлемо; только для clean), "zones": {"ext": "кратко", "int": "кратко", "box": "кратко"}, "note": "1–2 предложения по-русски для сотрудника"}`,
      photos.map((p, i) => ({ mime: p.mime, data: p.data, label: `Фото ${i + 1} — ${ZONES[p.zone] || p.zone}` })), { maxTokens: 600, timeoutMs: 90000 });
    } catch (e) {
      await db.query("UPDATE car_checks SET status = 'review', ai_note = $1 WHERE id = $2", [`ИИ не ответил: ${String(e.message).slice(0, 150)}`, ch.id]);
      return askReview(ch.id, 'ИИ не смог оценить фото — проверьте вручную');
    }
    const verdict = r.is_car === false ? 'unclear' : ['clean', 'dirty', 'unclear'].includes(r.verdict) ? r.verdict : 'unclear';
    const note = [String(r.note || '').slice(0, 300), r.zones ? Object.entries(r.zones).map(([z, t]) => `${ZONES[z] || z}: ${String(t).slice(0, 100)}`).join(' · ') : ''].filter(Boolean).join('\n');
    const score = clamp(Math.round(Number(r.score) || 2), 1, 3);
    await db.query('UPDATE car_checks SET ai_verdict = $1, ai_score = $2, ai_note = $3 WHERE id = $4', [verdict, verdict === 'clean' ? score : null, note, ch.id]);
    if (verdict === 'clean') {
      const pts = clamp(score, c.points_min, c.points_max);
      await approve(ch.id, pts, { name: 'ИИ' }, true);
      return;
    }
    await db.query("UPDATE car_checks SET status = 'flagged' WHERE id = $1", [ch.id]);
    await askReview(ch.id, verdict === 'dirty' ? `ИИ: машина грязная${note ? `\n${note}` : ''}` : `ИИ: непонятно, как выглядит машина${note ? `\n${note}` : ''}`);
    const [u] = await db.query('SELECT tg_id FROM users WHERE tg_id = $1', [ch.tg_id]);
    if (u) addNotification(ch.tg_id, 'info', `🚗 Фотопроверка авто: ${verdict === 'dirty' ? 'ИИ заметил, что машина не в порядке' : 'по фото не понятно, как выглядит машина'}. Менеджер проверит.${r.note ? ` ${r.note}` : ''}`, {}).catch(() => {});
  }

  async function askReview(checkId, why) {
    const [ch] = await db.query('SELECT k.*, u.name FROM car_checks k LEFT JOIN users u ON u.tg_id = k.tg_id WHERE k.id = $1', [checkId]);
    if (!ch || !botEnabled) return;
    const c = await cfg();
    const base = publicBase();
    const html = `🚗 <b>Проверьте машину: ${escHtml(ch.name || ch.tg_id)}</b>\n${escHtml(why)}\n\nФото — в приложении, раздел «Автопарк».`;
    const mid = Math.round((c.points_min + c.points_max) / 2);
    const kb = { inline_keyboard: [[{ text: `✅ Всё ок · +${c.points_min} б`, callback_data: `carok:${ch.id}:${c.points_min}` }, { text: `✅ +${mid} б`, callback_data: `carok:${ch.id}:${mid}` }], [{ text: '❌ Грязно — 0 баллов', callback_data: `carbad:${ch.id}` }]] };
    if (base) kb.inline_keyboard.push([{ text: '📷 Посмотреть фото', web_app: { url: `${base}/?cars=review` } }]);
    const msgs = {};
    for (const tg of await staffAndAdmins()) {
      if (!/^\d+$/.test(tg)) continue;
      const sent = await sendMessage(tg, html, { replyMarkup: kb }).catch(() => null);
      if (sent?.message_id) msgs[tg] = String(sent.message_id);
    }
    await db.query('UPDATE car_checks SET msgs = $1 WHERE id = $2', [JSON.stringify(msgs), ch.id]);
  }

  async function approve(checkId, pts, actor, auto = false) {
    const [ch] = await db.query('SELECT * FROM car_checks WHERE id = $1', [checkId]);
    if (!ch) return { ok: false, text: 'Не найдено' };
    if (['ok', 'rejected'].includes(ch.status) && !auto) return { ok: false, text: `Уже решено (${ch.decided_by || '—'})` };
    await db.query("UPDATE car_checks SET status = 'ok', points = $1, decided_by = $2, decided_at = $3 WHERE id = $4", [pts, actor?.name || '', now(), ch.id]);
    await points(ch.tg_id, pts, `Чистая машина (фотопроверка ${ch.day})`, `car:${ch.id}`);
    await awardXp(ch.tg_id, 'car_clean', XPC.clean, `cclean:${ch.id}`, 'Машина в порядке');
    const who = `Проверил ${actor?.name || 'офис'}`;
    addNotification(ch.tg_id, 'info', `🚗 Фотопроверка авто: всё в порядке! +${String(pts).replace('.', ',')} балл. KPI · ${who}`, {}).catch(() => {});
    if (botEnabled && /^\d+$/.test(String(ch.tg_id))) sendMessage(ch.tg_id, `🚗 <b>Машина в порядке — спасибо!</b>\n+${String(pts).replace('.', ',')} балл. KPI и +${XPC.clean} XP · ${escHtml(who)}`).catch(() => {});
    closeMsgs(ch, `✅ Машина в порядке · +${pts} б · ${actor?.name || ''}`);
    return { ok: true, text: 'Готово' };
  }
  async function reject(checkId, actor, note = '') {
    const [ch] = await db.query('SELECT * FROM car_checks WHERE id = $1', [checkId]);
    if (!ch) return { ok: false, text: 'Не найдено' };
    if (['ok', 'rejected'].includes(ch.status)) return { ok: false, text: `Уже решено (${ch.decided_by || '—'})` };
    await db.query("UPDATE car_checks SET status = 'rejected', points = 0, decided_by = $1, decided_at = $2, ai_note = CASE WHEN $3 <> '' THEN $3 ELSE ai_note END WHERE id = $4", [actor?.name || '', now(), note, ch.id]);
    await points(ch.tg_id, 0, '', `car:${ch.id}`);
    if (botEnabled && /^\d+$/.test(String(ch.tg_id))) sendMessage(ch.tg_id, `🚗 <b>Фотопроверка: машину нужно привести в порядок</b>${note ? `\n${escHtml(note)}` : ''}\nБаллы за эту проверку не начислены.`).catch(() => {});
    addNotification(ch.tg_id, 'info', `🚗 Фотопроверка: машину нужно привести в порядок.${note ? ` ${note}` : ''}`, {}).catch(() => {});
    closeMsgs(ch, `❌ Не засчитано · ${actor?.name || ''}`);
    return { ok: true, text: 'Готово' };
  }
  function closeMsgs(ch, text) {
    let msgs = {}; try { msgs = JSON.parse(ch.msgs || '{}'); } catch { /* пусто */ }
    for (const [tg, mid] of Object.entries(msgs)) editMessage(tg, mid, `🚗 ${escHtml(text)}`).catch(() => {});
  }

  async function handleCallback(q) {
    const data = String(q.data || '');
    if (!data.startsWith('carok:') && !data.startsWith('carbad:') && !data.startsWith('cardelok:') && !data.startsWith('cardelno:')) return false;
    const { answerCallback } = await import('./tgbot.js');
    const [who] = await db.query("SELECT tg_id AS id, name, role FROM users WHERE tg_id = $1 AND status = 'active'", [String(q.from?.id)]);
    if (!who || !['admin', 'manager'].includes(who.role)) { await answerCallback(q.id, 'Только менеджер или администратор'); return true; }
    if (data.startsWith('cardelok:') || data.startsWith('cardelno:')) {
      const r = await decideCarDelete(data.split(':')[1], data.startsWith('cardelok:'), who);
      await answerCallback(q.id, r.text);
      return true;
    }
    const [, id, p] = data.split(':');
    const r = data.startsWith('carok:') ? await approve(id, clamp(Number(p) || 1, 0, 10), who) : await reject(id, who);
    await answerCallback(q.id, r.text);
    return true;
  }

  // ---------- расписание фотопроверок ----------
  async function requestCheck(tg, reason = '') {
    const c = await cfg();
    const t = lp();
    const [open] = await db.query("SELECT id FROM car_checks WHERE tg_id = $1 AND status = 'requested'", [String(tg)]);
    if (open) return open.id;
    const id = uid();
    const due = zonedIso(t.y, t.m, t.d, c.deadline_hour, 0);
    await db.query('INSERT INTO car_checks (id, tg_id, day, requested_at, due_at) VALUES ($1,$2,$3,$4,$5)', [id, String(tg), t.day, now(), due]);
    const need = `${c.photos.ext[0]}–${c.photos.ext[1]} снаружи, ${c.photos.int[0]}–${c.photos.int[1]} в салоне, ${c.photos.box[0]}–${c.photos.box[1]} в будке`;
    const text = `🚗 Фотопроверка авто сегодня до ${c.deadline_hour}:00: ${need}.${reason ? ` ${reason}` : ''} Чистая машина — до +${c.points_max} балл. KPI.`;
    addNotification(tg, 'info', text, {}).catch(() => {});
    const base = publicBase();
    if (botEnabled && /^\d+$/.test(String(tg))) sendMessage(tg, `🚗 <b>Фотопроверка авто</b>\nСегодня до ${c.deadline_hour}:00 сфотографируйте машину: ${need}.\nЧистая машина — до <b>+${c.points_max} балл.</b> KPI и +${XPC.check + XPC.clean} XP.`,
      base ? { replyMarkup: { inline_keyboard: [[{ text: '📷 Сфотографировать', web_app: { url: `${base}/?car=check` } }]] } } : {}).catch(() => {});
    return id;
  }

  async function scheduleTick() {
    const c = await cfg();
    if (!c.on) return;
    const t = lp();
    const wk = weekKey();
    const plan = (await getSetting('car_plan')) || {};
    if (plan.week !== wk) { plan.week = wk; plan.items = {}; }
    const owners = await db.query("SELECT c.tg_id FROM cars c JOIN users u ON u.tg_id = c.tg_id WHERE u.status = 'active' AND u.role IN ('tech', 'specialist')");
    const wdIdx = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[t.wd] || 1;
    let changed = false;
    for (const o of owners) {
      if (!plan.items[o.tg_id]) {
        // случайные будние дни (с сегодняшнего по пятницу) и случайное время в рабочие часы
        const days = []; for (let d = wdIdx; d <= 5; d++) days.push(d);
        const n = Math.min(clamp(Math.round(c.checks_per_week), 1, 2), days.length);
        const picked = days.sort(() => Math.random() - 0.5).slice(0, n).sort();
        plan.items[o.tg_id] = picked.map((d) => ({ d, h: c.from_hour + Math.random() * Math.max(1, c.to_hour - c.from_hour - 1), done: false }));
        changed = true;
      }
      for (const it of plan.items[o.tg_id]) {
        if (it.done || it.d !== wdIdx) continue;
        if (t.h + t.mi / 60 < it.h) continue;
        it.done = true; changed = true;
        await requestCheck(o.tg_id);
      }
    }
    if (changed) await setSetting('car_plan', plan);
    // напоминание через 2 часа и «не прислал» после срока
    const open = await db.query("SELECT k.*, u.name FROM car_checks k LEFT JOIN users u ON u.tg_id = k.tg_id WHERE k.status = 'requested'");
    for (const ch of open) {
      if (Date.now() > Date.parse(ch.due_at)) {
        await db.query("UPDATE car_checks SET status = 'missed' WHERE id = $1", [ch.id]);
        if (botEnabled) for (const tg of await staffAndAdmins()) if (/^\d+$/.test(tg)) sendMessage(tg, `🚗 <b>${escHtml(ch.name || ch.tg_id)}</b> не прислал фото машины (фотопроверка ${ch.day}).`).catch(() => {});
        continue;
      }
      const reminded = await getSetting(`car_rem:${ch.id}`);
      if (!reminded && Date.now() - Date.parse(ch.requested_at) > 2 * 3600000 && botEnabled && /^\d+$/.test(String(ch.tg_id))) {
        await setSetting(`car_rem:${ch.id}`, 1);
        const base = publicBase();
        sendMessage(ch.tg_id, `⏰ Напоминание: фотопроверка авто до ${c.deadline_hour}:00.`, base ? { replyMarkup: { inline_keyboard: [[{ text: '📷 Сфотографировать', web_app: { url: `${base}/?car=check` } }]] } } : {}).catch(() => {});
      }
    }
  }
  setInterval(() => { scheduleTick().catch((e) => console.error('car tick:', e.message)); }, 5 * 60000).unref?.();

  // ---------- администратор / менеджер ----------
  // ---------- прочие расходы: мойка, AdBlue, парковка, ремонт ----------
  route('POST', '/api/car/expense', async ({ user, body }) => {
    await carGuard();
    const car = await carOf(user.id); must(car, 400, 'Сначала добавьте свой авто');
    const kind = String(body.kind || '');
    must(EXPENSE_KINDS[kind], 400, 'Выберите вид расхода');
    const amount = num(body.amount); must(amount != null && amount > 0 && amount < 100000, 400, 'Укажите сумму (лей)');
    const liters = EXPENSE_KINDS[kind].liters ? num(body.liters) : null;
    must(liters == null || (liters > 0 && liters < 500), 400, 'Некорректное количество литров');
    const note = str(body.note, 200);
    must(kind !== 'other' || note.length >= 2, 400, 'Напишите, на что потрачено');
    const id = uid();
    await db.query('INSERT INTO car_expenses (id, tg_id, kind, amount, liters, km, note, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, String(user.id), kind, Math.round(amount * 100) / 100, liters, Number(car.mileage) || null, note, now()]);
    await audit(user, 'Авто: расход', EXPENSE_KINDS[kind].label, `${amount} лей${liters ? ` · ${liters} л` : ''}${note ? ` · ${note}` : ''}`);
    const xp = await awardXp(user.id, 'car_week', XPC.week, `cweek:${weekKey()}`, 'Регулярно веду «Мой авто»');
    return { ok: true, xp: xp ? XPC.week : 0, ...(await fullFor(user.id)) };
  });

  // удалить свою запись расхода (ошиблись) — в течение суток
  route('DELETE', '/api/car/expense/:id', async ({ user, params }) => {
    const [e] = await db.query('SELECT * FROM car_expenses WHERE id = $1', [params.id]);
    must(e && (e.tg_id === String(user.id) || user.isAdmin), 404, 'Запись не найдена');
    must(user.isAdmin || Date.now() - new Date(e.created_at).getTime() < 86400000, 400, 'Удалить можно только в течение суток — попросите администратора');
    await db.query('DELETE FROM car_expenses WHERE id = $1', [e.id]);
    await audit(user, 'Авто: расход удалён', EXPENSE_KINDS[e.kind]?.label || e.kind, `${e.amount} лей`);
    return { ok: true, ...(await fullFor(e.tg_id)) };
  });

  route('GET', '/api/admin/cars', async () => {
    const c = await cfg();
    const users = await db.query("SELECT tg_id, name, role FROM users WHERE status = 'active' AND role IN ('tech', 'specialist') ORDER BY name");
    const items = [];
    for (const u of users) {
      const car = await carOf(u.tg_id);
      if (!car) { items.push({ tg_id: u.tg_id, name: u.name, car: null }); continue; }
      const st = await stats(car);
      const oil = (await serviceState(car)).find((s) => s.id === 'oil');
      const [last] = await db.query("SELECT status, day, points FROM car_checks WHERE tg_id = $1 AND status <> 'requested' ORDER BY requested_at DESC LIMIT 1", [u.tg_id]);
      items.push({ tg_id: u.tg_id, name: u.name, car: `${car.make} ${car.model || ''}`.trim(), year: car.year, plate: car.plate, mileage: Number(car.mileage), to_left: oil?.left ?? null, fuel_month: st.fuel_month, expenses_month: st.expenses_month, spend_month: st.spend_month, km_month: st.km_month, cost_km: st.cost_km, last_check: last ? { status: last.status, day: last.day, points: last.points == null ? null : Number(last.points) } : null });
    }
    const queue = await db.query("SELECT k.*, u.name FROM car_checks k LEFT JOIN users u ON u.tg_id = k.tg_id WHERE k.status IN ('flagged', 'review', 'checking') ORDER BY k.submitted_at DESC LIMIT 30");
    const delRows = await db.query("SELECT d.*, u.name FROM car_delete_requests d LEFT JOIN users u ON u.tg_id = d.tg_id WHERE d.status = 'pending' ORDER BY d.created_at DESC LIMIT 20");
    return { settings: c, service_items: SERVICE_ITEMS.filter((i) => i.id !== 'oil').map(({ id, label, km, fuels }) => ({ id, label, km, fuels: fuels || null })), ai: aiOn(), items, queue: await Promise.all(queue.map(async (q) => ({ ...(await checkOut(q, true)), name: q.name || q.tg_id, tg_id: q.tg_id }))),
      delete_requests: delRows.map((d) => ({ id: d.id, tg_id: d.tg_id, name: d.name || d.tg_id, label: d.label, created_at: d.created_at })) };
  });

  route('GET', '/api/admin/cars/:tg', async ({ params }) => {
    const [u] = await db.query('SELECT tg_id, name FROM users WHERE tg_id = $1', [params.tg]);
    must(u, 404, 'Сотрудник не найден');
    const data = await fullFor(u.tg_id);
    const checks = await db.query('SELECT * FROM car_checks WHERE tg_id = $1 ORDER BY requested_at DESC LIMIT 12', [u.tg_id]);
    const fuel = await db.query('SELECT id, km, amount, liters, ai_note, created_at FROM car_fuel WHERE tg_id = $1 ORDER BY created_at DESC LIMIT 40', [u.tg_id]);
    const service = await db.query('SELECT item, km, note, amount, created_at FROM car_service WHERE tg_id = $1 ORDER BY created_at DESC LIMIT 30', [u.tg_id]);
    const expenses = await db.query('SELECT id, kind, amount, liters, km, note, created_at FROM car_expenses WHERE tg_id = $1 ORDER BY created_at DESC LIMIT 40', [u.tg_id]);
    return { user: u, ...data, expenses: expenses.map((e) => ({ id: e.id, kind: e.kind, amount: Number(e.amount), liters: e.liters == null ? null : Number(e.liters), km: e.km == null ? null : Number(e.km), note: e.note, created_at: e.created_at })), fuel: fuel.map((f) => ({ id: f.id, km: Number(f.km), amount: f.amount == null ? null : Number(f.amount), liters: f.liters == null ? null : Number(f.liters), ai_note: f.ai_note, created_at: f.created_at, photo: photoUrl('f', f.id) })),
      checks: await Promise.all(checks.map((x) => checkOut(x, true))), service_log: service.map((s) => ({ ...s, label: SERVICE_ITEMS.find((i) => i.id === s.item)?.label || s.item })) };
  });

  route('POST', '/api/admin/car-checks/:id', async ({ user, params, body }) => {
    const r = body.ok ? await approve(params.id, clamp(num(body.points, 1), 0, 10), user) : await reject(params.id, user, str(body.note, 300));
    must(r.ok, 400, r.text);
    return { ok: true };
  });

  route('POST', '/api/admin/car-request/:tg', async ({ user, params }) => {
    must(await carOf(params.tg), 400, 'У сотрудника нет авто в приложении');
    const id = await requestCheck(params.tg, 'Запрос офиса.');
    await audit(user, 'Запросил фото авто', params.tg);
    return { ok: true, id };
  });

  // ---------- удаление авто (технику нужно подтверждение, администратору — сразу) ----------
  async function pendingDeleteReq(tg) {
    const [r] = await db.query("SELECT * FROM car_delete_requests WHERE tg_id = $1 AND status = 'pending'", [String(tg)]);
    return r || null;
  }

  async function wipeCar(tg) {
    const checks = await db.query('SELECT id FROM car_checks WHERE tg_id = $1', [String(tg)]);
    for (const c of checks) await db.query('DELETE FROM car_photos WHERE check_id = $1', [c.id]);
    await db.query('DELETE FROM car_checks WHERE tg_id = $1', [String(tg)]);
    await db.query('DELETE FROM car_fuel WHERE tg_id = $1', [String(tg)]);
    await db.query('DELETE FROM car_service WHERE tg_id = $1', [String(tg)]);
    await db.query('DELETE FROM cars WHERE tg_id = $1', [String(tg)]);
  }

  route('POST', '/api/car/delete-request', async ({ user }) => {
    const car = await carOf(user.id); must(car, 400, 'У вас пока нет добавленного авто');
    const open = await pendingDeleteReq(user.id); must(!open, 400, 'Запрос на удаление уже отправлен — ждите решения');
    const label = `${car.make} ${car.model || ''}`.trim() + (car.plate ? ` · ${car.plate}` : '');
    const id = uid();
    await db.query('INSERT INTO car_delete_requests (id, tg_id, label, created_at) VALUES ($1,$2,$3,$4)', [id, String(user.id), label, now()]);
    await audit(user, 'Запрос на удаление авто', label);
    const kb = { inline_keyboard: [[{ text: '🗑 Удалить', callback_data: `cardelok:${id}` }, { text: '↩️ Оставить', callback_data: `cardelno:${id}` }]] };
    const msgs = {};
    for (const tg of await staffAndAdmins()) {
      if (!/^\d+$/.test(tg)) continue;
      const sent = await sendMessage(tg, `🚗 <b>${escHtml(user.name)}</b> просит удалить машину из приложения: ${escHtml(label) || 'без данных'}.\nПодтвердить удаление?`, { replyMarkup: kb }).catch(() => null);
      if (sent?.message_id) msgs[tg] = String(sent.message_id);
    }
    await db.query('UPDATE car_delete_requests SET msgs = $1 WHERE id = $2', [JSON.stringify(msgs), id]);
    return { ok: true, id };
  });

  function closeDelMsgs(r, text) {
    let msgs = {}; try { msgs = JSON.parse(r.msgs || '{}'); } catch { /* пусто */ }
    for (const [tg, mid] of Object.entries(msgs)) editMessage(tg, mid, `🚗 ${escHtml(text)}`).catch(() => {});
  }

  async function decideCarDelete(id, ok, actor) {
    const [r] = await db.query('SELECT * FROM car_delete_requests WHERE id = $1', [id]);
    if (!r) return { ok: false, text: 'Не найдено' };
    if (r.status !== 'pending') return { ok: false, text: `Уже решено (${r.decided_by || '—'})` };
    await db.query('UPDATE car_delete_requests SET status = $1, decided_by = $2, decided_at = $3 WHERE id = $4', [ok ? 'approved' : 'rejected', actor?.name || '', now(), r.id]);
    if (ok) {
      await wipeCar(r.tg_id);
      await audit(actor, 'Авто удалено (по запросу)', r.label);
    }
    closeDelMsgs(r, ok ? `🗑 Удалено · ${actor?.name || ''}` : `↩️ Оставлено · ${actor?.name || ''}`);
    if (botEnabled && /^\d+$/.test(String(r.tg_id))) sendMessage(r.tg_id, ok ? '🚗 Ваша машина удалена из приложения по вашему запросу.' : `🚗 Запрос на удаление машины отклонён (${escHtml(actor?.name || 'офис')}).`).catch(() => {});
    addNotification(r.tg_id, 'info', ok ? '🚗 Машина удалена из приложения.' : '🚗 Запрос на удаление машины отклонён.', {}).catch(() => {});
    return { ok: true, text: 'Готово' };
  }

  /** Администратор/менеджер (право kpi) удаляет машину сразу, без запроса. */
  route('POST', '/api/admin/car-delete-requests/:id', async ({ user, params, body }) => {
    must(user.isOwner || (user.perms || []).includes('kpi'), 403, 'Решает главный администратор или менеджер с правом «KPI»');
    const r = await decideCarDelete(params.id, Boolean(body.ok), user);
    must(r.ok, 400, r.text);
    return { ok: true };
  }, { access: 'admin' });

  route('DELETE', '/api/admin/cars/:tg', async ({ user, params }) => {
    must(user.isOwner || (user.perms || []).includes('kpi'), 403, 'Удалять машины может главный администратор или менеджер с правом «KPI»');
    const car = await carOf(params.tg); must(car, 404, 'У сотрудника нет машины в приложении');
    const label = `${car.make} ${car.model || ''}`.trim();
    await wipeCar(params.tg);
    await db.query("UPDATE car_delete_requests SET status = 'approved', decided_by = $1, decided_at = $2 WHERE tg_id = $3 AND status = 'pending'", [user.name || '', now(), String(params.tg)]);
    await audit(user, 'Авто удалено', label, params.tg);
    addNotification(params.tg, 'info', '🚗 Ваша машина удалена из приложения администратором.', {}).catch(() => {});
    if (botEnabled && /^\d+$/.test(String(params.tg))) sendMessage(params.tg, '🚗 Ваша машина удалена из приложения администратором.').catch(() => {});
    return { ok: true };
  }, { access: 'admin' });

  route('PUT', '/api/admin/car-settings', async ({ user, body }) => {
    const cur = await cfg();
    const n = (v, d, a, b) => clamp(Math.round(num(v, d)), a, b);
    const ph = (z) => { const x = body.photos?.[z] || cur.photos[z]; const mn = n(x[0], cur.photos[z][0], 0, 10); return [mn, Math.max(mn, n(x[1], cur.photos[z][1], 1, 10))]; };
    const next = {
      on: body.on !== undefined ? Boolean(body.on) : cur.on,
      checks_per_week: n(body.checks_per_week, cur.checks_per_week, 1, 2),
      from_hour: n(body.from_hour, cur.from_hour, 0, 23), to_hour: n(body.to_hour, cur.to_hour, 1, 24), deadline_hour: n(body.deadline_hour, cur.deadline_hour, 1, 24),
      points_min: clamp(num(body.points_min, cur.points_min), 0, 10), points_max: clamp(num(body.points_max, cur.points_max), 0, 10),
      photos: { ext: ph('ext'), int: ph('int'), box: ph('box') },
      service_interval: n(body.service_interval, cur.service_interval, 3000, 30000),
      service_km: { ...cur.service_km },
    };
    if (body.service_km && typeof body.service_km === 'object') {
      for (const it of SERVICE_ITEMS) {
        if (it.id === 'oil' || !(it.id in body.service_km)) continue;
        const v = body.service_km[it.id];
        if (v === null || v === '') delete next.service_km[it.id]; // по умолчанию
        else next.service_km[it.id] = clamp(Math.round(num(v, it.km)), 0, 300000); // 0 — пункт выключен
      }
    }
    if (next.points_max < next.points_min) next.points_max = next.points_min;
    await setSetting('car_cfg', next);
    await audit(user, 'Настройки «Мой авто»', '', `${next.on ? 'вкл' : 'выкл'} · проверок в неделю ${next.checks_per_week} · баллы ${next.points_min}–${next.points_max}`);
    return { ok: true, settings: next };
  });

  /** /r/car/f/:id — фото чека, /r/car/p/:id — фото машины (подписанные ссылки). */
  async function handleRaw(url, res) {
    const m = url.pathname.match(/^\/r\/car\/(f|p)\/([\w-]+)$/);
    if (!m) return false;
    if (!verifyLink(`car:${m[1]}:${m[2]}`, url.searchParams.get('exp'), url.searchParams.get('sig'))) { res.writeHead(403); res.end('Ссылка недействительна'); return true; }
    const [p] = m[1] === 'f' ? await db.query('SELECT mime, photo AS data FROM car_fuel WHERE id = $1', [m[2]]) : await db.query('SELECT mime, data FROM car_photos WHERE id = $1', [m[2]]);
    if (!p?.data) { res.writeHead(404); res.end('Фото не найдено'); return true; }
    const buf = Buffer.from(p.data, 'base64');
    res.writeHead(200, { 'Content-Type': p.mime, 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400' });
    res.end(buf);
    return true;
  }

  return { handleCallback, handleRaw, requestCheck, scheduleTick, evaluate };
}
