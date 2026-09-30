// ====================================================================================================
// KPI МЕНЕДЖЕРОВ ПО ПРОДАЖАМ (v44)
// Модель — как в таблице «KPI менеджера»: план × сезонность, премия = выручка × ставка × K_KPI × K(%плана),
// порог отсечки, штраф за критическое недовыполнение, разовый бонус ≥130% и супербонусы.
// + бот-коуч, напоминания о незаполненных заявках (каждые N минут, влияет на KPI «CRM»), игра «Звонилка».
// ====================================================================================================
import { sendMessage, deleteMessage, escHtml, botEnabled } from './tgbot.js';
import { zonedIso } from './tasks.js';

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/** Каталог показателей: auto — считается из приложения (заявки, звонки «Звонилки»), manual — вводит администратор. */
export const KPI_CATALOG = {
  plan: { label: 'Выполнение плана продаж', unit: '%', dir: 'up', target: 100, src: 'auto' },
  conversion: { label: 'Конверсия лид → сделка', unit: '%', dir: 'up', target: 35, src: 'auto' },
  avg_check: { label: 'Средний чек', unit: 'MDL', dir: 'up', target: 850, src: 'auto' },
  subs_share: { label: 'Доля абонентских/повторных договоров', unit: '%', dir: 'up', target: 40, src: 'auto' },
  crm: { label: 'Стандарты и своевременность CRM', unit: '%', dir: 'up', target: 100, src: 'auto' },
  churn: { label: 'Удержание (отток)', unit: '%', dir: 'down', target: 5, src: 'manual' },
  calls: { label: 'Звонков за месяц', unit: 'шт', dir: 'up', target: 600, src: 'auto' },
  deals: { label: 'Сделок за месяц', unit: 'шт', dir: 'up', target: 60, src: 'auto' },
  b2b_new: { label: 'Новые B2B договоры', unit: 'шт', dir: 'up', target: 4, src: 'auto' },
  reviews: { label: 'Отзывы клиентов', unit: 'шт', dir: 'up', target: 10, src: 'manual' },
};

const K = (id, weight, target) => ({ id, weight, target: target ?? KPI_CATALOG[id].target });
const SHEET_KPIS = [K('plan', 35), K('conversion', 25), K('avg_check', 5), K('subs_share', 15), K('crm', 5), K('churn', 15)];

/** Каталог типов штрафов для менеджеров (админ настраивает вкл/выкл, сумму и порог per-менеджер, как SUPERS). */
export const PENALTIES = {
  late_dispatch: {
    label: 'Долгая отправка технику', amount: 1, param: 30, param_unit: 'мин',
    hint: 'штраф за каждую заявку, если от создания (менеджером) до отправки технику проходит больше N минут',
  },
};

export const SUPERS = {
  record: { label: 'Личный рекорд выручки', amount: 500, param: null, hint: 'выручка месяца больше, чем в любой прошлый месяц (при ≥100% плана)' },
  big_deal: { label: 'Крупная сделка', amount: 300, param: 10000, hint: 'за каждую сделку от суммы (MDL), не больше 3 в месяц' },
  new_sub: { label: 'Новый абонент', amount: 100, param: null, hint: 'за каждый абонентский/повторный договор, не больше 10 в месяц' },
  perfect_crm: { label: 'Идеальная CRM', amount: 300, param: 10, hint: 'CRM 100% и не меньше N заявок за месяц' },
  call_streak: { label: 'Марафон звонков', amount: 300, param: 15, hint: 'N дней в месяце выполнен квест звонков' },
  conv_master: { label: 'Мастер конверсии', amount: 300, param: 50, hint: 'конверсия от N% (не меньше 30 дозвонов)' },
};

const DEFAULT_CFG = {
  preset: 'standard',
  base_plan: 200000, rate: 2.1, salary: 11000, cutoff: 70, cap: 1.5,
  season: [0.8, 0.8, 0.85, 0.95, 1.15, 1.3, 1.3, 1.3, 1.35, 1.2, 1.1, 1.0],
  plan_override: {},
  kpis: SHEET_KPIS,
  ladder: [[0, 0], [60, 0.5], [80, 0.75], [90, 0.9], [100, 1], [110, 1.2], [120, 1.3], [130, 1.5]],
  bonus: { from: 130, amount: 1000 },
  crit: { below: 60, cut: 40 },
  structure: [{ id: 'b2c', label: 'B2C разовые выезды', share: 23 }, { id: 'b2b_new', label: 'B2B новые договоры', share: 20 }, { id: 'b2b_port', label: 'B2B портфель абонентов', share: 57 }],
  supers: Object.fromEntries(Object.entries(SUPERS).map(([id, s]) => [id, { on: true, amount: s.amount, param: s.param }])),
  gap_fine: 0,
  penalties: Object.fromEntries(Object.entries(PENALTIES).map(([id, p]) => [id, { on: false, amount: p.amount, param: p.param }])),
};

/** Готовые схемы — администратор выбирает и потом донастраивает. */
export const PRESETS = {
  standard: { label: 'Стандарт (как в таблице)', patch: {} },
  b2b: { label: 'Аккаунт B2B', patch: { base_plan: 250000, rate: 2, kpis: [K('plan', 30), K('subs_share', 25, 60), K('churn', 20), K('b2b_new', 15), K('crm', 10)] } },
  b2c: { label: 'Колл-центр B2C', patch: { base_plan: 150000, rate: 2.5, kpis: [K('plan', 30), K('conversion', 25), K('calls', 20, 800), K('avg_check', 15), K('crm', 10)] } },
  newbie: { label: 'Новичок (первые 3 месяца)', patch: { base_plan: 120000, rate: 2, cutoff: 50, kpis: [K('plan', 20), K('calls', 30, 500), K('conversion', 20, 25), K('crm', 20), K('avg_check', 10)] } },
};

const DEFAULT_SETTINGS = {
  gaps: { on: true, fields: ['phone', 'address', 'date', 'time'], every_min: 5, grace_min: 15, max_pings: 100, from_hour: 8, to_hour: 20, admins_too: false },
  coach: { on: true, hour: 10, weekdays: true },
  game: { calls_day: 40, reached_day: 20, deals_day: 3 },
};

export const GAP_FIELDS = {
  phone: 'телефон', address: 'адрес', date: 'дата', time: 'время', price: 'цена', procedure: 'процедура/вредитель', point_cat: 'тип помещения', company: 'клиент (фирма/имя)',
};

const XPM = { call: 2, reached: 3, deal: 25, sub: 15, b2b: 10, big: 50, clean: 5, fixed: 10, q_calls: 30, q_reached: 20, q_deals: 50 };
const OUTCOMES = ['deal', 'callback', 'refuse', 'no_answer'];

const num = (v, d = 0) => { if (v === undefined || v === null || v === '') return d; const n = Number(String(v ?? '').replace(',', '.').replace(/\s/g, '')); return Number.isFinite(n) ? n : d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;
const lei = (v) => `${Math.round(v).toLocaleString('ru-RU').replace(/ /g, ' ')} MDL`;

export function initSales(ctx) {
  const { db, route, must, str, uid, now, getSetting, setSetting, audit, awardXp, xpTotal, levelOf, publicBase, TZN, notifyTech, taskSummary, pointsConfig } = ctx;

  // ---------- время ----------
  function lp(d = new Date()) {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZN, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(d);
    const g = (t) => f.find((p) => p.type === t)?.value;
    return { y: +g('year'), m: +g('month'), d: +g('day'), h: +g('hour') % 24, mi: +g('minute'), wd: g('weekday'), day: `${g('year')}-${g('month')}-${g('day')}`, month: `${g('year')}-${g('month')}` };
  }
  const dayOf = (iso) => lp(new Date(iso)).day;
  const monthRange = (ym) => {
    let [y, m] = ym.split('-').map(Number);
    const from = zonedIso(y, m, 1, 0, 0);
    m += 1; if (m > 12) { m = 1; y += 1; }
    return { from, to: zonedIso(y, m, 1, 0, 0) };
  };
  const daysIn = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
  const validMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));

  // ---------- настройки ----------
  async function store() { return (await getSetting('mgr_kpi')) || {}; }
  async function settings() {
    const s = await store();
    return { gaps: { ...DEFAULT_SETTINGS.gaps, ...(s.gaps || {}) }, coach: { ...DEFAULT_SETTINGS.coach, ...(s.coach || {}) }, game: { ...DEFAULT_SETTINGS.game, ...(s.game || {}) } };
  }
  function normCfg(c = {}) {
    const d = DEFAULT_CFG;
    const out = { ...d, ...c };
    out.season = Array.from({ length: 12 }, (_, i) => clamp(num(c.season?.[i], d.season[i]), 0, 5));
    out.kpis = (Array.isArray(c.kpis) ? c.kpis : d.kpis).map((k) => {
      const cat = KPI_CATALOG[k.id];
      const custom = !cat;
      return {
        id: String(k.id).slice(0, 40), weight: clamp(num(k.weight), 0, 100), target: num(k.target, cat?.target ?? 1),
        label: custom ? String(k.label || 'Свой показатель').slice(0, 80) : cat.label, unit: custom ? String(k.unit || '').slice(0, 10) : cat.unit,
        dir: custom ? (k.dir === 'down' ? 'down' : 'up') : cat.dir, src: custom ? 'manual' : cat.src, custom,
      };
    }).filter((k) => k.id).slice(0, 15);
    out.ladder = (Array.isArray(c.ladder) ? c.ladder : d.ladder).map(([p, k]) => [clamp(num(p), 0, 1000), clamp(num(k), 0, 10)]).sort((a, b) => a[0] - b[0]).slice(0, 15);
    out.bonus = { from: num(c.bonus?.from, d.bonus.from), amount: Math.max(0, num(c.bonus?.amount, d.bonus.amount)) };
    out.crit = { below: num(c.crit?.below, d.crit.below), cut: clamp(num(c.crit?.cut, d.crit.cut), 0, 100) };
    out.structure = (Array.isArray(c.structure) ? c.structure : d.structure).map((s) => ({ id: String(s.id || '').slice(0, 30), label: String(s.label || '').slice(0, 60), share: clamp(num(s.share), 0, 100) })).slice(0, 8);
    out.supers = Object.fromEntries(Object.entries(SUPERS).map(([id, s]) => {
      const x = c.supers?.[id] || {};
      return [id, { on: x.on !== undefined ? Boolean(x.on) : true, amount: Math.max(0, num(x.amount, s.amount)), param: s.param == null ? null : num(x.param, s.param) }];
    }));
    out.penalties = Object.fromEntries(Object.entries(PENALTIES).map(([id, p]) => {
      const x = c.penalties?.[id] || {};
      return [id, { on: x.on !== undefined ? Boolean(x.on) : false, amount: Math.max(0, num(x.amount, p.amount)), param: Math.max(0, num(x.param, p.param)) }];
    }));
    out.plan_override = Object.fromEntries(Object.entries(c.plan_override || {}).filter(([m, v]) => validMonth(m) && num(v) > 0).map(([m, v]) => [m, num(v)]));
    for (const f of ['base_plan', 'rate', 'salary', 'cutoff', 'cap', 'gap_fine']) out[f] = Math.max(0, num(c[f], d[f]));
    out.cap = clamp(out.cap || 1.5, 1, 5);
    out.preset = PRESETS[c.preset] ? c.preset : c.preset ? 'custom' : 'standard';
    return out;
  }
  async function cfgFor(tg) { return normCfg((await store()).managers?.[String(tg)] || {}); }
  const planFor = (cfg, ym) => cfg.plan_override[ym] ?? Math.round(cfg.base_plan * cfg.season[Number(ym.slice(5)) - 1]);

  async function managers() {
    return db.query("SELECT tg_id, name FROM users WHERE status = 'active' AND role = 'manager' ORDER BY name");
  }
  async function isManager(tg) {
    const [u] = await db.query("SELECT role FROM users WHERE tg_id = $1 AND status = 'active'", [String(tg)]);
    return u?.role === 'manager';
  }

  // ---------- факты ----------
  async function manualFacts(tg, ym) {
    const [r] = await db.query('SELECT data, updated_at, updated_by FROM mgr_facts WHERE tg_id = $1 AND month = $2', [String(tg), ym]);
    let data = {};
    try { data = JSON.parse(r?.data || '{}'); } catch { /* пусто */ }
    return { data, updated_at: r?.updated_at || null, updated_by: r?.updated_by || '' };
  }

  async function autoFacts(tg, ym, gcfg) {
    tg = String(tg);
    const { from, to } = monthRange(ym);
    const done = await db.query(`SELECT t.id, t.company_name, COALESCE(v.price, t.price) AS price FROM tasks t JOIN visits v ON v.id = t.visit_id
      WHERE t.author_id = $1 AND v.status = 'done' AND v.finished_at >= $2 AND v.finished_at < $3`, [tg, from, to]);
    const revenue = done.reduce((s, x) => s + (Number(x.price) || 0), 0);
    const b2c = done.filter((x) => !String(x.company_name || '').trim()).reduce((s, x) => s + (Number(x.price) || 0), 0);
    const calls = await db.query('SELECT outcome, amount, sub, b2b, day FROM mgr_calls WHERE tg_id = $1 AND created_at >= $2 AND created_at < $3', [tg, from, to]);
    const reached = calls.filter((c) => c.outcome !== 'no_answer').length;
    const deals = calls.filter((c) => c.outcome === 'deal');
    const created = await db.query(`SELECT t.id, g.first_at, g.fixed_at, g.pings FROM tasks t LEFT JOIN task_gaps g ON g.task_id = t.id
      WHERE t.author_id = $1 AND t.created_at >= $2 AND t.created_at < $3 AND t.status <> 'void'`, [tg, from, to]);
    const graceMs = (gcfg?.grace_min ?? 15) * 60000;
    const t0 = Date.now();
    const bad = created.filter((x) => x.first_at && ((x.fixed_at ? Date.parse(x.fixed_at) : t0) - Date.parse(x.first_at)) > graceMs).length;
    const pings = created.reduce((s, x) => s + (Number(x.pings) || 0), 0);
    const byDay = {};
    for (const c of calls) byDay[c.day] = (byDay[c.day] || 0) + 1;
    const penaltyCounts = {};
    for (const id of Object.keys(PENALTIES)) {
      const [row] = await db.query('SELECT COUNT(*) AS n FROM mgr_penalties WHERE tg_id = $1 AND penalty_id = $2 AND created_at >= $3 AND created_at < $4', [tg, id, from, to]);
      penaltyCounts[id] = Number(row?.n) || 0;
    }
    return {
      revenue, revenue_b2c: b2c, revenue_b2b: revenue - b2c, done: done.length,
      avg_check: done.length ? revenue / done.length : null,
      calls: calls.length, reached, deals: deals.length,
      conversion: reached ? (deals.length / reached) * 100 : null,
      subs: deals.filter((d) => Number(d.sub)).length,
      subs_share: deals.length ? (deals.filter((d) => Number(d.sub)).length / deals.length) * 100 : null,
      b2b_new: deals.filter((d) => Number(d.b2b)).length,
      big_deals: deals.map((d) => Number(d.amount) || 0),
      tasks: created.length, tasks_bad: bad, pings,
      crm: created.length ? ((created.length - bad) / created.length) * 100 : null,
      call_days: byDay,
      penalty_counts: penaltyCounts,
    };
  }

  /** Главный расчёт месяца — как в листе «KPI по месяцам». */
  function calc(cfg, ym, auto, manual, extra = {}) {
    const m = manual || {};
    const has = (k) => m[k] !== undefined && m[k] !== null && m[k] !== '';
    const plan = planFor(cfg, ym);
    const revenue = (has('revenue') ? num(m.revenue) : auto.revenue) + num(m.revenue_extra);
    const pct = plan ? (revenue / plan) * 100 : 0;
    const values = {
      plan: pct,
      conversion: has('conversion') ? num(m.conversion) : auto.conversion,
      avg_check: has('avg_check') ? num(m.avg_check) : (has('revenue') || num(m.revenue_extra) ? (auto.done ? revenue / auto.done : auto.avg_check) : auto.avg_check),
      subs_share: has('subs_share') ? num(m.subs_share) : auto.subs_share,
      crm: has('crm') ? num(m.crm) : (auto.crm ?? 100),
      churn: has('churn') ? num(m.churn) : null,
      calls: has('calls') ? num(m.calls) : auto.calls,
      deals: has('deals') ? num(m.deals) : auto.deals,
      b2b_new: has('b2b_new') ? num(m.b2b_new) : auto.b2b_new,
      reviews: has('reviews') ? num(m.reviews) : null,
    };
    const wsum = cfg.kpis.reduce((s, k) => s + k.weight, 0) || 1;
    const kpis = cfg.kpis.map((k) => {
      const v = k.custom ? (has(k.id) ? num(m[k.id]) : null) : values[k.id];
      let ratio = 0;
      if (v != null) {
        if (k.dir === 'up') ratio = k.target > 0 ? v / k.target : 0;
        else ratio = v <= 0 ? cfg.cap : k.target / v;
      }
      ratio = clamp(ratio, 0, cfg.cap);
      const w = k.weight / wsum;
      return { id: k.id, label: k.label, unit: k.unit, dir: k.dir, src: k.src, weight: k.weight, target: k.target, value: v == null ? null : r2(v), manual: k.custom || has(k.id) || k.src === 'manual', ratio: r2(ratio), raw: w * ratio, score: r2(w * ratio), lost: r2(w * Math.max(0, 1 - Math.min(ratio, 1))) };
    });
    const kkpi = kpis.reduce((s, k) => s + k.raw, 0);
    for (const k of kpis) delete k.raw;
    const kLadder = cfg.ladder.reduce((acc, [p, k]) => (pct >= p ? k : acc), 0);
    let premium = pct < cfg.cutoff ? 0 : revenue * (cfg.rate / 100) * kkpi * kLadder;
    const critical = pct < cfg.crit.below && premium > 0;
    if (critical) premium *= 1 - cfg.crit.cut / 100;
    const bonus = cfg.bonus.amount > 0 && pct >= cfg.bonus.from ? cfg.bonus.amount : 0;
    // супербонусы
    const S = cfg.supers; const sup = [];
    const add = (id, count, note) => { if (S[id]?.on && count > 0) sup.push({ id, label: SUPERS[id].label, count, amount: S[id].amount, total: S[id].amount * count, note }); };
    if (extra.record && pct >= 100) add('record', 1, `рекорд: ${lei(revenue)}`);
    add('big_deal', Math.min(3, (auto.big_deals || []).filter((a) => a >= (S.big_deal.param || 0)).length), `сделки от ${lei(S.big_deal.param || 0)}`);
    add('new_sub', Math.min(10, auto.subs || 0), 'абонентские/повторные договоры');
    if ((values.crm ?? 0) >= 100 && auto.tasks >= (S.perfect_crm.param || 0)) add('perfect_crm', 1, `${auto.tasks} заявок без пропусков`);
    const questDays = Object.values(auto.call_days || {}).filter((n) => n >= (extra.calls_day || 40)).length;
    if (questDays >= (S.call_streak.param || 15)) add('call_streak', 1, `${questDays} дней с квестом звонков`);
    if ((values.conversion ?? 0) >= (S.conv_master.param || 50) && auto.reached >= 30) add('conv_master', 1, `конверсия ${Math.round(values.conversion)}%`);
    const supers = sup.reduce((s, x) => s + x.total, 0);
    let fine = cfg.gap_fine > 0 ? cfg.gap_fine * (auto.tasks_bad || 0) : 0;
    const penalties = [];
    for (const [id, p] of Object.entries(cfg.penalties || {})) {
      if (!p.on) continue;
      const n = (auto.penalty_counts || {})[id] || 0;
      if (n <= 0) continue;
      const total = p.amount * n;
      fine += total;
      penalties.push({ id, label: PENALTIES[id]?.label || id, count: n, amount: p.amount, total });
    }
    const total = cfg.salary + premium + bonus + supers - fine;
    const structure = cfg.structure.map((s) => ({ ...s, plan: Math.round((plan * s.share) / 100) }));
    return {
      month: ym, plan, revenue: Math.round(revenue), pct: r2(pct), kkpi: r2(kkpi), k: kLadder, below_cutoff: pct < cfg.cutoff, critical,
      kkpi_exact: kkpi, premium: Math.round(premium), bonus, supers: sup, supers_total: supers, fine: Math.round(fine), penalties, salary: cfg.salary, total: Math.round(total), kpis, structure,
      auto: { revenue: Math.round(auto.revenue), revenue_b2c: Math.round(auto.revenue_b2c), revenue_b2b: Math.round(auto.revenue_b2b), done: auto.done, calls: auto.calls, reached: auto.reached, deals: auto.deals, subs: auto.subs, b2b_new: auto.b2b_new, tasks: auto.tasks, tasks_bad: auto.tasks_bad, pings: auto.pings },
    };
  }

  /** «Что если»: сколько получит при 100 / 110 / 120 / 130 % плана с текущим K_KPI. */
  function whatIf(cfg, c) {
    const steps = [...new Set([...cfg.ladder.map(([p]) => p).filter((p) => p >= 100), cfg.bonus.from])].sort((a, b) => a - b).slice(0, 5);
    return steps.map((p) => {
      const revenue = (c.plan * p) / 100;
      const k = cfg.ladder.reduce((acc, [lp2, kk]) => (p >= lp2 ? kk : acc), 0);
      const premium = p < cfg.cutoff ? 0 : revenue * (cfg.rate / 100) * (c.kkpi_exact ?? c.kkpi) * k;
      const bonus = cfg.bonus.amount > 0 && p >= cfg.bonus.from ? cfg.bonus.amount : 0;
      return { pct: p, revenue: Math.round(revenue), need: Math.max(0, Math.round(revenue - c.revenue)), premium: Math.round(premium), bonus, total: Math.round(cfg.salary + premium + bonus + c.supers_total - c.fine), reached: c.pct >= p };
    });
  }

  async function monthCalc(tg, ym, { withRecord = true } = {}) {
    const s = await settings();
    const cfg = await cfgFor(tg);
    const [auto, man] = await Promise.all([autoFacts(tg, ym, s.gaps), manualFacts(tg, ym)]);
    let record = false;
    if (withRecord) {
      const cur = (man.data.revenue != null && man.data.revenue !== '' ? num(man.data.revenue) : auto.revenue) + num(man.data.revenue_extra);
      if (cur > 0) {
        let [y, m] = ym.split('-').map(Number); let best = 0;
        for (let i = 0; i < 12; i++) {
          m -= 1; if (m < 1) { m = 12; y -= 1; }
          const p = `${y}-${String(m).padStart(2, '0')}`;
          const [a, mm] = await Promise.all([autoFacts(tg, p, s.gaps), manualFacts(tg, p)]);
          best = Math.max(best, (mm.data.revenue != null && mm.data.revenue !== '' ? num(mm.data.revenue) : a.revenue) + num(mm.data.revenue_extra));
        }
        record = best > 0 && cur > best;
      }
    }
    const c = calc(cfg, ym, auto, man.data, { record, calls_day: s.game.calls_day });
    return { cfg, c, manual: man, auto };
  }

  // ---------- советы (бот-коуч) ----------
  const TIPS = {
    plan: 'Держите темп: каждый день сверяйтесь, сколько нужно продать до плана, и начинайте утро со «звонков силы».',
    conversion: 'Конверсия: выясняйте вредителя и площадь, называйте цену сразу с гарантией и закрывайте на конкретное время — «Мастер может приехать завтра в 10:00 или в 15:00?»',
    avg_check: 'Средний чек: предлагайте комплекс — обработка + повтор через 14 дней, барьерная защита, ловушки; для клопов — пакет из 2 обработок.',
    subs_share: 'Абонентские договоры: каждому B2B-клиенту предлагайте регулярное обслуживание (ежемесячно/ежеквартально, документы для HACCP и проверок), физлицам — гарантийный повтор со скидкой.',
    crm: 'CRM: заполняйте заявку сразу полностью — телефон, адрес, дата и время, цена, процедура. Незаполненная заявка — это напоминания каждые 5 минут и минус к KPI.',
    churn: 'Отток: за 2 недели до окончания договора позвоните клиенту, после выезда — звонок качества через 3 дня.',
    calls: 'Звонки: выполняйте квест дня в «Звонилке», лучше — «час силы» с утра без перерывов.',
    deals: 'Сделки: перезванивайте всем «подумаю» в тот же день — бот напомнит о перезвоне.',
    b2b_new: 'Новые B2B: HoReCa, склады, магазины, школы и садики — 10 холодных звонков в день по базе.',
    reviews: 'Отзывы: после каждого выполненного выезда отправляйте клиенту ссылку на отзыв.',
  };

  function coachTips(cfg, c, ym, gapsOpen = 0) {
    const tips = [];
    const cur = lp().month === ym;
    if (cur && c.plan > 0) {
      const days = daysIn(ym); const d = lp().d;
      const expected = (c.plan * d) / days;
      const left = Math.max(0, days - d + 1);
      if (c.revenue < expected) tips.push({ kpi: 'plan', title: `Отставание от темпа: ${lei(expected - c.revenue)}`, text: `Чтобы выйти на 100% плана, нужно продавать по ${lei((c.plan - c.revenue) / left)} в день (осталось дней: ${left}).` });
      else tips.push({ kpi: 'plan', title: 'Идёте с опережением плана 👍', text: `Сейчас ${Math.round(c.pct)}% при ожидаемых ${Math.round((d / days) * 100)}%. ${nextStep(cfg, c.pct) != null ? `Дальше — к ступени ${nextStep(cfg, c.pct)}%.` : 'Вы на максимальной ступени — держите темп!'}` });
    }
    if (gapsOpen) tips.push({ kpi: 'crm', title: `Заявки с ошибкой: ${gapsOpen}`, text: 'Нет адреса, времени или телефона — исправьте в кабинете. Пока не исправлено, бот напоминает каждые 5 минут, это снижает KPI «CRM».' });
    for (const k of [...c.kpis].filter((x) => x.lost > 0.01).sort((a, b) => b.lost - a.lost).slice(0, 3)) {
      if (k.id === 'plan' && cur) continue;
      const tip = TIPS[k.id] || `Подтяните показатель «${k.label}» до цели ${fmtVal(k.target, k.unit)}.`;
      tips.push({ kpi: k.id, title: `${k.label}: ${k.value == null ? 'нет данных' : fmtVal(k.value, k.unit)} из ${fmtVal(k.target, k.unit)}`, text: `${tip} Вес ${k.weight}% — теряете ${Math.round(k.lost * 100)} п. K_KPI.` });
    }
    const step = nextStep(cfg, c.pct);
    if (step != null && c.plan) {
      const w = whatIf(cfg, c).find((x) => x.pct === step);
      if (w && w.need > 0) tips.push({ kpi: 'money', title: `До ${step}% плана — ${lei(w.need)}`, text: `Тогда к выплате ≈ ${lei(w.total)} (сейчас ${lei(c.total)}).` });
    }
    return tips;
  }
  const nextStep = (cfg, pct) => [...cfg.ladder.map(([p]) => p), cfg.bonus.from].filter((p) => p > pct).sort((a, b) => a - b)[0] ?? null;
  const fmtVal = (v, unit) => (unit === 'MDL' ? lei(v) : `${Math.round(v * 10) / 10}${unit === '%' ? '%' : ` ${unit}`}`);

  // ---------- незаполненные заявки ----------
  function missing(t, fields) {
    const miss = [];
    let pests = [];
    try { pests = JSON.parse(t.pests || '[]'); } catch { /* пусто */ }
    for (const f of fields) {
      const ok = {
        phone: String(t.phone || '').replace(/\D/g, '').length >= 6,
        address: String(t.address || '').trim().length >= 3,
        date: Boolean(t.planned_at),
        time: Boolean(t.planned_at) && Boolean(Number(t.has_time)),
        price: t.price != null && Number(t.price) > 0,
        procedure: Boolean(String(t.procedure || '').trim()) || pests.length > 0,
        point_cat: Boolean(String(t.point_cat || '').trim()),
        company: Boolean(String(t.company_name || '').trim()) || /[A-Za-zА-Яа-яĂÂÎȘȚăâîșț]{3}/.test(String(t.comment || '')),
      }[f];
      if (ok === false) miss.push(f);
    }
    return miss;
  }
  const ACTIVE = ['new', 'pending', 'open'];

  /** Кто исправляет заявку с ошибкой: менеджер-автор; иначе — все менеджеры; нет менеджеров — администраторы. */
  async function gapRecipients(t) {
    if (t.author_id) {
      const [u] = await db.query("SELECT role FROM users WHERE tg_id = $1 AND status = 'active'", [String(t.author_id)]);
      if (u?.role === 'manager') return [String(t.author_id)];
    }
    const ms = (await managers()).map((m) => String(m.tg_id));
    if (ms.length) return ms;
    return (await db.query("SELECT tg_id FROM users WHERE status = 'active' AND role = 'admin'")).map((u) => String(u.tg_id));
  }
  const msgMap = (g) => { try { const x = JSON.parse(g.msg_id || '{}'); return x && typeof x === 'object' ? x : {}; } catch { return g.msg_id && g.author_id ? { [g.author_id]: g.msg_id } : {}; } };
  const clearPings = (g) => { if (!botEnabled) return; for (const [tg, mid] of Object.entries(msgMap(g))) deleteMessage(tg, mid).catch(() => {}); };
  const authorIsManager = async (t) => Boolean(t.author_id) && (await isManager(t.author_id));

  async function pingGap(t, g, miss, s) {
    if (!botEnabled) return;
    clearPings(g);
    const base = publicBase();
    const n = (Number(g.pings) || 0) + 1;
    const [tech] = t.tech_tg_id ? await db.query('SELECT name FROM users WHERE tg_id = $1', [t.tech_tg_id]) : [];
    const html = `🚨 <b>Ошибка в заявке № ${t.task_no}</b>${tech?.name ? ` → ${escHtml(tech.name)}` : ''}\nНет: <b>${miss.map((f) => GAP_FIELDS[f] || f).join(', ')}</b>\n${escHtml(t.company_name || t.address || '')}\n\nБез этого дезинсектор не может нормально выехать. Напоминаю каждые ${s.gaps.every_min} мин, пока не исправите (${n}-е). Влияет на KPI «CRM».`;
    const ids = {};
    for (const tg of await gapRecipients(t)) {
      if (!/^\d+$/.test(tg)) continue;
      const sent = await sendMessage(tg, html, base ? { replyMarkup: { inline_keyboard: [[{ text: '✏️ Исправить заявку', web_app: { url: `${base}/?sales=gaps` } }]] } } : {}).catch(() => null);
      if (sent?.message_id) ids[tg] = String(sent.message_id);
    }
    await db.query('UPDATE task_gaps SET pings = $1, last_ping_at = $2, msg_id = $3 WHERE task_id = $4', [n, now(), JSON.stringify(ids), t.id]);
  }

  /** После создания/правки заявки: нет адреса/времени/телефона — ошибка, сразу напоминание; исправили — спасибо. */
  async function onTaskSaved(taskId) {
    const s = await settings();
    if (!s.gaps.on) return;
    const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (!t) return;
    const miss = ACTIVE.includes(t.status) ? missing(t, s.gaps.fields) : [];
    const [g] = await db.query('SELECT * FROM task_gaps WHERE task_id = $1', [t.id]);
    if (miss.length) {
      if (!g) {
        await db.query('INSERT INTO task_gaps (task_id, author_id, fields, first_at) VALUES ($1,$2,$3,$4) ON CONFLICT (task_id) DO NOTHING', [t.id, t.author_id || '', JSON.stringify(miss), now()]);
        const lt = lp();
        if (lt.h >= s.gaps.from_hour && lt.h < s.gaps.to_hour) await pingGap(t, { pings: 0, msg_id: '' }, miss, s);
      } else {
        await db.query('UPDATE task_gaps SET fields = $1, fixed_at = NULL WHERE task_id = $2', [JSON.stringify(miss), t.id]);
      }
      return;
    }
    if (!g) {
      if (ACTIVE.includes(t.status) && (await authorIsManager(t))) await awardXp(t.author_id, 'm_clean', XPM.clean, `mclean:${t.id}`, `Заявка № ${t.task_no} заполнена полностью`);
      return;
    }
    if (g.fixed_at) return;
    await db.query("UPDATE task_gaps SET fields = '[]', fixed_at = $1 WHERE task_id = $2", [now(), t.id]);
    clearPings(g);
    const inTime = Date.now() - Date.parse(g.first_at) <= s.gaps.grace_min * 60000;
    if (inTime && (await authorIsManager(t))) await awardXp(t.author_id, 'm_fixed', XPM.fixed, `mfix:${t.id}`, `Исправил заявку № ${t.task_no}`);
    if (botEnabled && ACTIVE.includes(t.status)) {
      for (const tg of Object.keys(msgMap(g))) sendMessage(tg, `✅ Заявка № ${t.task_no} исправлена. Спасибо!`).catch(() => {});
    }
  }

  async function gapsTick() {
    const s = await settings();
    if (!s.gaps.on) return;
    const lt = lp();
    // заявки, созданные любым способом за последние 3 дня и ещё не проверенные
    const fresh = await db.query(`SELECT id FROM tasks WHERE status IN ('new','pending','open') AND created_at >= $1 AND id NOT IN (SELECT task_id FROM task_gaps)`, [new Date(Date.now() - 3 * 86400000).toISOString()]);
    for (const x of fresh) {
      const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [x.id]);
      if (t && missing(t, s.gaps.fields).length) await onTaskSaved(x.id);
    }
    const open = await db.query('SELECT g.*, t.status, t.task_no FROM task_gaps g JOIN tasks t ON t.id = g.task_id WHERE g.fixed_at IS NULL');
    for (const g of open) {
      const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [g.task_id]);
      const miss = t && ACTIVE.includes(t.status) ? missing(t, s.gaps.fields) : [];
      if (!miss.length) { await onTaskSaved(g.task_id); if (t && !ACTIVE.includes(t.status)) await db.query('UPDATE task_gaps SET fixed_at = COALESCE(fixed_at, $1) WHERE task_id = $2', [now(), g.task_id]); continue; }
      if (lt.h < s.gaps.from_hour || lt.h >= s.gaps.to_hour) continue;
      if ((Number(g.pings) || 0) >= s.gaps.max_pings) continue;
      if (g.last_ping_at && Date.now() - Date.parse(g.last_ping_at) < s.gaps.every_min * 60000 - 20000) continue;
      await pingGap(t, g, miss, s);
    }
  }

  // ---------- общий контроль штрафов менеджеров (генерируемый, по каталогу PENALTIES) ----------
  /** Долгая отправка технику: от создания заявки (менеджером) до её отправки технику (tasks.sent_at) дольше порога. */
  async function evalLateDispatch(tg, p) {
    const thresholdMs = Math.max(1, p.param || 30) * 60000;
    const rows = await db.query(
      `SELECT id, created_at, sent_at FROM tasks WHERE author_id = $1 AND tech_tg_id <> '' AND sent_at IS NOT NULL AND status <> 'void'
       AND id NOT IN (SELECT task_id FROM mgr_penalties WHERE penalty_id = 'late_dispatch')`, [String(tg)],
    );
    for (const t of rows) {
      const diffMs = Date.parse(t.sent_at) - Date.parse(t.created_at);
      if (!(diffMs > thresholdMs)) continue;
      await db.query(
        'INSERT INTO mgr_penalties (id, task_id, penalty_id, tg_id, minutes, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (task_id, penalty_id) DO NOTHING',
        [uid(), t.id, 'late_dispatch', String(tg), Math.round(diffMs / 60000), now()],
      );
    }
  }
  /** По id/типу записи каталога PENALTIES — какая функция проверяет нарушения. Новый тип штрафа добавляется сюда. */
  const PENALTY_EVALUATORS = { late_dispatch: evalLateDispatch };

  async function penaltyTick() {
    for (const m of await managers()) {
      const cfg = await cfgFor(m.tg_id);
      for (const [id, p] of Object.entries(cfg.penalties || {})) {
        if (!p.on) continue;
        const fn = PENALTY_EVALUATORS[id];
        if (!fn) continue;
        try { await fn(m.tg_id, p); } catch (e) { console.error(`penalty ${id}:`, e.message); }
      }
    }
  }

  // ---------- «Звонилка» ----------
  async function gameFor(tg) {
    tg = String(tg);
    const s = await settings();
    const today = lp().day;
    const calls = await db.query('SELECT * FROM mgr_calls WHERE tg_id = $1 AND day = $2 ORDER BY created_at', [tg, today]);
    const st = { calls: calls.length, reached: calls.filter((c) => c.outcome !== 'no_answer').length, deals: calls.filter((c) => c.outcome === 'deal').length, amount: calls.filter((c) => c.outcome === 'deal').reduce((a, c) => a + (Number(c.amount) || 0), 0) };
    const quests = [
      { id: 'calls', title: `${s.game.calls_day} звонков`, have: st.calls, need: s.game.calls_day, xp: XPM.q_calls },
      { id: 'reached', title: `${s.game.reached_day} дозвонов`, have: st.reached, need: s.game.reached_day, xp: XPM.q_reached },
      { id: 'deals', title: `${s.game.deals_day} сделки`, have: st.deals, need: s.game.deals_day, xp: XPM.q_deals },
    ].map((q) => ({ ...q, done: q.have >= q.need }));
    for (const q of quests) if (q.done) await awardXp(tg, 'm_quest', q.xp, `mq:${q.id}:${today}`, `Квест: ${q.title}`);
    let combo = 0;
    for (const c of [...calls].reverse()) { if (c.outcome === 'deal') combo += 1; else if (c.outcome === 'refuse') break; }
    // серия рабочих дней с выполненным квестом звонков
    const hist = await db.query('SELECT day, COUNT(*) AS n FROM mgr_calls WHERE tg_id = $1 GROUP BY day', [tg]);
    const byDay = Object.fromEntries(hist.map((h) => [h.day, Number(h.n)]));
    let streak = 0;
    const d = new Date(`${today}T12:00:00Z`);
    if ((byDay[today] || 0) < s.game.calls_day) d.setUTCDate(d.getUTCDate() - 1);
    for (let i = 0; i < 120; i++) {
      const wd = d.getUTCDay();
      const key = d.toISOString().slice(0, 10);
      if (wd !== 0 && wd !== 6) { if ((byDay[key] || 0) >= s.game.calls_day) streak += 1; else break; }
      d.setUTCDate(d.getUTCDate() - 1);
    }
    const best = Math.max(0, ...hist.map((h) => Number(h.n)));
    const xp = await xpTotal(tg);
    const [xt] = await db.query('SELECT COALESCE(SUM(xp), 0) AS s FROM xp_events WHERE tg_id = $1 AND created_at >= $2', [tg, zonedIso(...today.split('-').map(Number), 0, 0)]);
    const cbs = await db.query("SELECT id, client, phone, note, callback_at FROM mgr_calls WHERE tg_id = $1 AND outcome = 'callback' AND cb_done_at IS NULL AND callback_at IS NOT NULL AND callback_at < $2 ORDER BY callback_at LIMIT 20",
      [tg, new Date(Date.now() + 36 * 3600000).toISOString()]);
    return {
      today: st, quests, combo, streak, best_day: best, xp, xp_today: Number(xt?.s) || 0, level: levelOf(xp),
      recent: calls.slice(-8).reverse().map((c) => ({ id: c.id, outcome: c.outcome, amount: c.amount == null ? null : Number(c.amount), sub: Boolean(Number(c.sub)), b2b: Boolean(Number(c.b2b)), client: c.client, created_at: c.created_at })),
      callbacks: cbs.map((c) => ({ id: c.id, client: c.client, phone: c.phone, note: c.note, at: c.callback_at, overdue: Date.parse(c.callback_at) < Date.now() })),
    };
  }

  async function callbackTick() {
    if (!botEnabled) return;
    const due = await db.query("SELECT * FROM mgr_calls WHERE outcome = 'callback' AND cb_done_at IS NULL AND reminded_at IS NULL AND callback_at IS NOT NULL AND callback_at <= $1 LIMIT 50", [now()]);
    const base = publicBase();
    for (const c of due) {
      await db.query('UPDATE mgr_calls SET reminded_at = $1 WHERE id = $2', [now(), c.id]);
      if (!/^\d+$/.test(String(c.tg_id))) continue;
      sendMessage(c.tg_id, `🔁 <b>Пора перезвонить</b>\n${escHtml(c.client || 'Клиент')}${c.phone ? ` · ${escHtml(c.phone)}` : ''}${c.note ? `\n${escHtml(c.note)}` : ''}`,
        base ? { replyMarkup: { inline_keyboard: [[{ text: '📞 Открыть «Звонилку»', web_app: { url: `${base}/?sales=calls` } }]] } } : {}).catch(() => {});
    }
  }

  // ---------- бот-коуч: каждое утро менеджеру ----------
  async function coachTick() {
    const s = await settings();
    if (!s.coach.on || !botEnabled) return;
    const lt = lp();
    if (lt.h < s.coach.hour || (s.coach.weekdays && ['Sat', 'Sun'].includes(lt.wd))) return;
    if ((await getSetting('mgr_coach_day')) === lt.day) return;
    await setSetting('mgr_coach_day', lt.day);
    const base = publicBase();
    for (const m of await managers()) {
      if (!/^\d+$/.test(String(m.tg_id))) continue;
      const { cfg, c } = await monthCalc(m.tg_id, lt.month, { withRecord: false });
      const tips = coachTips(cfg, c, lt.month, (await openGaps(m.tg_id)).length).slice(0, 4);
      const first = String(m.name || '').split(/\s+/)[0];
      const html = [
        `☀️ <b>${escHtml(first)}, план на день</b>`,
        `План ${MONTHS_FULL[lt.m - 1]}: ${lei(c.plan)} · факт ${lei(c.revenue)} (<b>${Math.round(c.pct)}%</b>) · K_KPI ${c.kkpi.toFixed(2).replace('.', ',')}`,
        `💰 Сейчас к выплате: <b>${lei(c.total)}</b> (премия ${lei(c.premium)}${c.bonus ? ` + бонус ${lei(c.bonus)}` : ''}${c.supers_total ? ` + супербонусы ${lei(c.supers_total)}` : ''})`,
        '',
        ...tips.map((t) => `• <b>${escHtml(t.title)}</b>\n${escHtml(t.text)}`),
      ].join('\n');
      sendMessage(m.tg_id, html, base ? { replyMarkup: { inline_keyboard: [[{ text: '📊 Мой KPI и бонус', web_app: { url: `${base}/?sales=me` } }]] } } : {}).catch(() => {});
    }
  }

  async function tick() {
    await gapsTick().catch((e) => console.error('gaps tick:', e.message));
    await penaltyTick().catch((e) => console.error('penalty tick:', e.message));
    await callbackTick().catch((e) => console.error('callback tick:', e.message));
    await coachTick().catch((e) => console.error('mgr coach:', e.message));
  }
  setInterval(() => { tick(); }, 60000).unref?.();

  // ---------- общий ответ «мой KPI» ----------
  async function openGaps(tg) {
    const rows = await db.query(`SELECT g.task_id, g.fields, g.first_at, g.pings, t.task_no, t.company_name, t.address, t.phone, t.planned_at, t.has_time, t.price, t.procedure, t.point_cat, t.status
      FROM task_gaps g JOIN tasks t ON t.id = g.task_id LEFT JOIN users a ON a.tg_id = g.author_id
      WHERE g.fixed_at IS NULL AND (g.author_id = $1 OR a.role IS NULL OR a.role <> 'manager') ORDER BY g.first_at DESC LIMIT 30`, [String(tg)]);
    return rows.map((r) => ({ task_id: r.task_id, task_no: r.task_no, fields: (() => { try { return JSON.parse(r.fields); } catch { return []; } })(), first_at: r.first_at, pings: Number(r.pings) || 0,
      company: r.company_name, address: r.address, phone: r.phone, planned_at: r.planned_at, has_time: Boolean(Number(r.has_time)), price: r.price == null ? null : Number(r.price), procedure: r.procedure, point_cat: r.point_cat }));
  }

  async function league(ym) {
    const out = [];
    const { from } = monthRange(ym);
    for (const m of await managers()) {
      const { c } = await monthCalc(m.tg_id, ym, { withRecord: false });
      const [x] = await db.query('SELECT COALESCE(SUM(xp), 0) AS s FROM xp_events WHERE tg_id = $1 AND created_at >= $2', [m.tg_id, from]);
      out.push({ tg_id: m.tg_id, name: m.name, pct: Math.round(c.pct), xp: Number(x?.s) || 0, calls: c.auto.calls, deals: c.auto.deals });
    }
    return out.sort((a, b) => b.pct - a.pct || b.xp - a.xp);
  }

  async function full(tg, ym) {
    const { cfg, c, manual } = await monthCalc(tg, ym);
    const gaps = await openGaps(tg);
    return {
      month: ym, month_label: `${MONTHS_FULL[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`, calc: c, what_if: whatIf(cfg, c), tips: coachTips(cfg, c, ym, gaps.length), gaps,
      manual: manual.data, manual_at: manual.updated_at, manual_by: manual.updated_by,
      cfg: { preset: cfg.preset, base_plan: cfg.base_plan, rate: cfg.rate, salary: cfg.salary, cutoff: cfg.cutoff, ladder: cfg.ladder, bonus: cfg.bonus, crit: cfg.crit, gap_fine: cfg.gap_fine,
        supers: Object.entries(cfg.supers).filter(([, v]) => v.on).map(([id, v]) => ({ id, label: SUPERS[id].label, amount: v.amount, param: v.param, hint: SUPERS[id].hint })),
        penalties: Object.entries(cfg.penalties || {}).filter(([, v]) => v.on).map(([id, v]) => ({ id, label: PENALTIES[id]?.label || id, amount: v.amount, param: v.param, hint: PENALTIES[id]?.hint || '' })) },
    };
  }

  const monthParam = (q) => { const m = q?.get ? q.get('month') : q?.month; return validMonth(m) ? m : lp().month; };
  const canSelf = (user) => user.role === 'manager' || user.isOwner;

  route('GET', '/api/mgr/me', async ({ user, query }) => {
    must(canSelf(user), 403, 'Раздел для менеджеров');
    const ym = monthParam(query);
    const [data, game, lg] = await Promise.all([full(user.id, ym), gameFor(user.id), league(ym)]);
    return { ...data, game, league: lg.map((x) => ({ name: x.name, pct: x.pct, xp: x.xp, me: String(x.tg_id) === String(user.id) })), settings: (await settings()).game, gap_labels: GAP_FIELDS };
  });

  route('POST', '/api/mgr/calls', async ({ user, body }) => {
    must(canSelf(user), 403, 'Раздел для менеджеров');
    const outcome = OUTCOMES.includes(body.outcome) ? body.outcome : null;
    must(outcome, 400, 'Выберите результат звонка');
    const amount = body.amount === '' || body.amount == null ? null : num(body.amount, NaN);
    must(amount == null || (Number.isFinite(amount) && amount >= 0 && amount < 1e8), 400, 'Некорректная сумма');
    let cb = null;
    if (outcome === 'callback') {
      const t = Date.parse(String(body.callback_at || ''));
      cb = Number.isFinite(t) ? new Date(t).toISOString() : new Date(Date.now() + 2 * 3600000).toISOString();
    }
    const before = await gameFor(user.id);
    const doneBefore = new Set(before.quests.filter((q) => q.done).map((q) => q.id));
    const c = { id: uid(), tg_id: String(user.id), outcome, amount: outcome === 'deal' ? amount : null, sub: outcome === 'deal' && body.sub ? 1 : 0, b2b: outcome === 'deal' && body.b2b ? 1 : 0,
      client: str(body.client, 120), phone: str(body.phone, 40), note: str(body.note, 300), callback_at: cb, day: lp().day, created_at: now() };
    await db.query('INSERT INTO mgr_calls (id, tg_id, outcome, amount, sub, b2b, client, phone, note, callback_at, day, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [c.id, c.tg_id, c.outcome, c.amount, c.sub, c.b2b, c.client, c.phone, c.note, c.callback_at, c.day, c.created_at]);
    if (body.from_callback) await db.query('UPDATE mgr_calls SET cb_done_at = $1 WHERE id = $2 AND tg_id = $3', [now(), str(body.from_callback, 60), c.tg_id]);
    let xp = XPM.call;
    if (outcome !== 'no_answer') xp += XPM.reached;
    const events = [];
    if (outcome === 'deal') {
      xp += XPM.deal;
      if (c.sub) xp += XPM.sub;
      if (c.b2b) xp += XPM.b2b;
      const cfg = await cfgFor(user.id);
      if (c.amount && c.amount >= (cfg.supers.big_deal.param || 1e12)) { xp += XPM.big; events.push({ kind: 'big', text: `Крупная сделка! ${cfg.supers.big_deal.on ? `+${lei(cfg.supers.big_deal.amount)} к бонусу` : ''}`.trim() }); }
      if (before.combo >= 1) events.push({ kind: 'combo', text: `Комбо ×${before.combo + 1}: сделки подряд!` });
    }
    await awardXp(user.id, 'm_call', xp, `mcall:${c.id}`, { deal: 'Сделка', callback: 'Перезвон', refuse: 'Отказ', no_answer: 'Звонок' }[outcome]);
    const game = await gameFor(user.id);
    for (const q of game.quests) if (q.done && !doneBefore.has(q.id)) events.push({ kind: 'quest', text: `Квест «${q.title}» выполнен · +${q.xp} XP` });
    return { ok: true, id: c.id, xp, events, game };
  });

  route('DELETE', '/api/mgr/calls/:id', async ({ user, params }) => {
    const [c] = await db.query('SELECT * FROM mgr_calls WHERE id = $1 AND tg_id = $2', [params.id, String(user.id)]);
    must(c, 404, 'Звонок не найден');
    must(Date.now() - Date.parse(c.created_at) < 15 * 60000, 400, 'Отменить можно только в течение 15 минут');
    await db.query('DELETE FROM mgr_calls WHERE id = $1', [c.id]);
    await db.query('DELETE FROM xp_events WHERE tg_id = $1 AND ref = $2', [String(user.id), `mcall:${c.id}`]);
    return { ok: true, game: await gameFor(user.id) };
  });

  route('POST', '/api/mgr/callbacks/:id/done', async ({ user, params }) => {
    await db.query('UPDATE mgr_calls SET cb_done_at = $1 WHERE id = $2 AND tg_id = $3', [now(), params.id, String(user.id)]);
    return { ok: true };
  });

  /** Дополнить незаполненную заявку (автор или администратор). */
  route('POST', '/api/tasks/:id/fill', async ({ user, params, body }) => {
    const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [params.id]);
    must(t, 404, 'Заявка не найдена');
    must(String(t.author_id) === String(user.id) || user.isOwner || user.role === 'manager' || (user.isAdmin && (user.perms || []).includes('tasks')), 403, 'Исправить заявку может менеджер или администратор');
    must(ACTIVE.includes(t.status), 400, 'Заявка уже в работе — изменения через офис');
    const set = {};
    if (body.phone !== undefined) set.phone = str(body.phone, 40);
    if (body.address !== undefined) { set.address = str(body.address, 300); must(set.address.length >= 3, 400, 'Укажите адрес'); }
    if (body.procedure !== undefined) set.procedure = str(body.procedure, 120);
    if (body.company !== undefined) set.company_name = str(body.company, 200);
    if (body.price !== undefined) {
      const p = body.price === '' || body.price == null ? null : num(body.price, NaN);
      must(p == null || (Number.isFinite(p) && p >= 0), 400, 'Некорректная цена');
      set.price = p;
    }
    if (body.point_cat !== undefined) {
      const pc = (await pointsConfig()).cats.find((c) => c.id === body.point_cat);
      must(!body.point_cat || pc, 400, 'Неизвестный тип помещения');
      set.point_cat = body.point_cat || '';
      if (pc?.zones && !t.point_zone) set.point_zone = 'city';
    }
    if (body.date) {
      const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(body.date, 10));
      must(d, 400, 'Некорректная дата');
      const tm = /^(\d{1,2}):(\d{2})$/.exec(str(body.time, 5));
      set.planned_at = zonedIso(+d[1], +d[2], +d[3], tm ? +tm[1] : 9, tm ? +tm[2] : 0);
      set.has_time = tm ? 1 : 0;
    }
    const keys = Object.keys(set);
    must(keys.length, 400, 'Нечего сохранять');
    await db.query(`UPDATE tasks SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = $${keys.length + 1} WHERE id = $${keys.length + 2}`, [...keys.map((k) => set[k]), now(), t.id]);
    await audit(user, 'Дополнил заявку', `№ ${t.task_no}`, keys.join(', '));
    const [nt] = await db.query('SELECT * FROM tasks WHERE id = $1', [t.id]);
    if (nt.tech_tg_id && nt.status === 'new') notifyTech(nt.tech_tg_id, `✏️ Заявка дополнена\n${taskSummary(nt)}`, { kind: 'task_update', task_id: t.id });
    await onTaskSaved(t.id);
    const s = await settings();
    return { ok: true, missing: missing(nt, s.gaps.fields) };
  });

  // ---------- администратор ----------
  const ownerOnly = (user) => must(user.isOwner, 403, 'KPI менеджеров видит и настраивает главный администратор');

  route('GET', '/api/admin/sales', async ({ user, query }) => {
    ownerOnly(user);
    const ym = monthParam(query);
    const items = [];
    for (const m of await managers()) {
      const { c } = await monthCalc(m.tg_id, ym, { withRecord: false });
      const [gp] = await db.query('SELECT COUNT(*) AS n FROM task_gaps WHERE author_id = $1 AND fixed_at IS NULL', [m.tg_id]);
      const cfg = await cfgFor(m.tg_id);
      items.push({ tg_id: m.tg_id, name: m.name, preset: cfg.preset, plan: c.plan, revenue: c.revenue, pct: c.pct, kkpi: c.kkpi, k: c.k, premium: c.premium, bonus: c.bonus, supers: c.supers_total, fine: c.fine, total: c.total, gaps: Number(gp?.n) || 0,
        calls: c.auto.calls, deals: c.auto.deals, weak: [...c.kpis].sort((a, b) => b.lost - a.lost)[0]?.label || '' });
    }
    return { month: ym, items, settings: await settings(), catalog: KPI_CATALOG, presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.label])), supers: SUPERS, penalties: PENALTIES, gap_fields: GAP_FIELDS };
  });

  route('GET', '/api/admin/sales/:tg', async ({ user, params, query }) => {
    ownerOnly(user);
    const [u] = await db.query('SELECT tg_id, name, role FROM users WHERE tg_id = $1', [params.tg]);
    must(u, 404, 'Сотрудник не найден');
    const ym = monthParam(query);
    const year = Number(ym.slice(0, 4));
    const cur = lp().month;
    const months = [];
    for (let i = 1; i <= 12; i++) {
      const m = `${year}-${String(i).padStart(2, '0')}`;
      if (m > cur) { const cfg = await cfgFor(u.tg_id); months.push({ month: m, label: MONTHS[i - 1], plan: planFor(cfg, m), future: true }); continue; }
      const { c } = await monthCalc(u.tg_id, m, { withRecord: false });
      months.push({ month: m, label: MONTHS[i - 1], plan: c.plan, revenue: c.revenue, pct: c.pct, kkpi: c.kkpi, k: c.k, premium: c.premium, bonus: c.bonus, supers: c.supers_total, fine: c.fine, salary: c.salary, total: c.total,
        values: Object.fromEntries(c.kpis.map((k) => [k.id, k.value])) });
    }
    const past = months.filter((m) => !m.future);
    const sum = (f) => past.reduce((s, m) => s + (Number(m[f]) || 0), 0);
    const cfg = await cfgFor(u.tg_id);
    const year_plan = months.reduce((s, m) => s + m.plan, 0);
    const yearT = {
      plan: year_plan, revenue: sum('revenue'), pct: year_plan ? r2((sum('revenue') / year_plan) * 100) : 0,
      kkpi: past.length ? r2(sum('kkpi') / past.length) : 0, k: past.length ? r2(sum('k') / past.length) : 0,
      premium: sum('premium'), bonus: sum('bonus') + sum('supers'), salary: sum('salary'), total: sum('total'),
      months_100: past.filter((m) => m.pct >= 100).length, months_below: past.filter((m) => m.pct < cfg.cutoff).length,
    };
    return { user: { tg_id: u.tg_id, name: u.name, role: u.role }, ...(await full(u.tg_id, ym)), months, year: yearT, raw_cfg: cfg };
  });

  route('PUT', '/api/admin/sales/:tg/config', async ({ user, params, body }) => {
    ownerOnly(user);
    const s = await store();
    let c = body.cfg || {};
    if (body.preset && PRESETS[body.preset]) c = { ...(s.managers?.[params.tg] || {}), ...structuredClone(PRESETS[body.preset].patch), preset: body.preset, ...(body.preset === 'standard' ? { kpis: SHEET_KPIS, base_plan: DEFAULT_CFG.base_plan, rate: DEFAULT_CFG.rate, cutoff: DEFAULT_CFG.cutoff } : {}) };
    const cfg = normCfg(c);
    const wsum = cfg.kpis.reduce((a, k) => a + k.weight, 0);
    must(Math.abs(wsum - 100) < 0.01, 400, `Сумма весов KPI должна быть 100% (сейчас ${r2(wsum)}%)`);
    const targets = body.all ? (await managers()).map((m) => String(m.tg_id)) : [String(params.tg)];
    s.managers = s.managers || {};
    for (const t of targets) s.managers[t] = { ...cfg, kpis: cfg.kpis.map(({ id, weight, target, label, unit, dir, custom }) => (custom ? { id, weight, target, label, unit, dir } : { id, weight, target })) };
    await setSetting('mgr_kpi', s);
    await audit(user, 'KPI менеджера: настройки', targets.length > 1 ? 'все менеджеры' : params.tg, `${PRESETS[cfg.preset]?.label || 'своя схема'} · план ${cfg.base_plan} · ставка ${cfg.rate}%`);
    return { ok: true, cfg };
  });

  route('PUT', '/api/admin/sales/:tg/facts/:month', async ({ user, params, body }) => {
    ownerOnly(user);
    must(validMonth(params.month), 400, 'Некорректный месяц');
    const cfg = await cfgFor(params.tg);
    const allowed = new Set(['revenue', 'revenue_extra', 'conversion', 'avg_check', 'subs_share', 'crm', 'churn', 'calls', 'deals', 'b2b_new', 'reviews', 'note', ...cfg.kpis.filter((k) => k.custom).map((k) => k.id)]);
    const data = {};
    for (const [k, v] of Object.entries(body.data || {})) {
      if (!allowed.has(k) || v === '' || v == null) continue;
      if (k === 'note') { data.note = str(v, 500); continue; }
      const n = num(v, NaN);
      must(Number.isFinite(n) && n >= 0, 400, `Некорректное значение: ${k}`);
      data[k] = n;
    }
    await db.query(`INSERT INTO mgr_facts (tg_id, month, data, updated_at, updated_by) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (tg_id, month) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`, [String(params.tg), params.month, JSON.stringify(data), now(), user.name || '']);
    await audit(user, 'KPI менеджера: факты месяца', params.tg, `${params.month}: ${Object.keys(data).join(', ') || 'очищено'}`);
    return { ok: true };
  });

  route('PUT', '/api/admin/sales-settings', async ({ user, body }) => {
    ownerOnly(user);
    const s = await store();
    const g = body.gaps || {}; const c = body.coach || {}; const gm = body.game || {};
    const cur = await settings();
    s.gaps = {
      on: g.on !== undefined ? Boolean(g.on) : cur.gaps.on,
      fields: Array.isArray(g.fields) ? g.fields.filter((f) => GAP_FIELDS[f]) : cur.gaps.fields,
      every_min: clamp(Math.round(num(g.every_min, cur.gaps.every_min)), 1, 120), grace_min: clamp(Math.round(num(g.grace_min, cur.gaps.grace_min)), 0, 1440),
      max_pings: clamp(Math.round(num(g.max_pings, cur.gaps.max_pings)), 1, 200), from_hour: clamp(Math.round(num(g.from_hour, cur.gaps.from_hour)), 0, 23), to_hour: clamp(Math.round(num(g.to_hour, cur.gaps.to_hour)), 1, 24),
      admins_too: g.admins_too !== undefined ? Boolean(g.admins_too) : cur.gaps.admins_too,
    };
    s.coach = { on: c.on !== undefined ? Boolean(c.on) : cur.coach.on, hour: clamp(Math.round(num(c.hour, cur.coach.hour)), 0, 23), weekdays: c.weekdays !== undefined ? Boolean(c.weekdays) : cur.coach.weekdays };
    s.game = { calls_day: clamp(Math.round(num(gm.calls_day, cur.game.calls_day)), 1, 500), reached_day: clamp(Math.round(num(gm.reached_day, cur.game.reached_day)), 1, 500), deals_day: clamp(Math.round(num(gm.deals_day, cur.game.deals_day)), 1, 100) };
    await setSetting('mgr_kpi', s);
    await audit(user, 'KPI менеджеров: общие настройки', '', `напоминания ${s.gaps.on ? `каждые ${s.gaps.every_min} мин` : 'выкл'} · коуч ${s.coach.on ? `${s.coach.hour}:00` : 'выкл'}`);
    return { ok: true, settings: await settings() };
  });

  return { onTaskSaved, gapsTick, penaltyTick, coachTick, callbackTick, calc, normCfg, monthCalc, gapRecipients };
}
