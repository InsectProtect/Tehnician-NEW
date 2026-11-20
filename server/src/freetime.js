// ====================================================================================================
// СВОБОДНОЕ ВРЕМЯ ТЕХНИКОВ (v107)
// Менеджер в дороге видит, у кого и когда есть окно под новую заявку: сегодня и на неделю вперёд.
// Занятость = активные заявки со временем (исполнитель + команда), длительность выезда по умолчанию
// (+ надбавка за большой объект по площади), дорога до и после. Настройки — setting `free_cfg` (владелец).
// ====================================================================================================
import { zonedIso } from './tasks.js';

export const FREE_DEFAULTS = {
  from: '08:00', to: '20:00',
  off: [7], // выходные дни недели 1..7 (пн..вс)
  dur: 60, // выезд по умолчанию, мин
  big_m2: 150, big_add: 60, // большой объект: от N м² — +мин
  road: 30, // дорога между выездами, мин
  min_slot: 60, // окна короче — не показываем
  days: 7,
};
const hm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
const fmt = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export function normFree(x = {}, cur = FREE_DEFAULTS) {
  const from = hm(x.from) != null ? x.from : cur.from;
  const to = hm(x.to) != null && hm(x.to) > hm(from) ? x.to : cur.to;
  return {
    from, to,
    off: Array.isArray(x.off) ? [...new Set(x.off.map((d) => Math.round(num(d, 0))).filter((d) => d >= 1 && d <= 7))].sort() : cur.off,
    dur: clamp(Math.round(num(x.dur, cur.dur)), 15, 480),
    big_m2: clamp(Math.round(num(x.big_m2, cur.big_m2)), 0, 100000),
    big_add: clamp(Math.round(num(x.big_add, cur.big_add)), 0, 480),
    road: clamp(Math.round(num(x.road, cur.road)), 0, 240),
    min_slot: clamp(Math.round(num(x.min_slot, cur.min_slot)), 15, 480),
    days: clamp(Math.round(num(x.days, cur.days)), 1, 14),
  };
}

export function initFree({ db, route, must, getSetting, setSetting, audit, TZN }) {
  const cfgGet = async () => normFree({ ...FREE_DEFAULTS, ...((await getSetting('free_cfg', null)) || {}) });

  /** Дата (ГГГГ-ММ-ДД) и минуты от полуночи по местному времени. */
  const local = (iso) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZN, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
  };
  const areaM2 = (a) => { const m = String(a || '').replace(',', '.').match(/\d+(\.\d+)?/); return m ? Number(m[0]) : 0; };
  const shortAddr = (t) => String(t.company_name || t.address || '').replace(/^(strada|str\.?|bd\.?|bulevardul)\s+/i, '').slice(0, 22);

  async function freeTime(user) {
    const cfg = await cfgGet();
    const start = hm(cfg.from); const end = hm(cfg.to);
    const nowL = local(new Date().toISOString());
    const [y, m, d] = nowL.day.split('-').map(Number);
    const days = [];
    for (let i = 0; i < cfg.days; i++) {
      const dt = new Date(Date.UTC(y, m - 1, d + i));
      const key = dt.toISOString().slice(0, 10);
      const wd = (dt.getUTCDay() + 6) % 7 + 1; // 1..7
      days.push({ day: key, wd, label: i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : WD[wd - 1], date: i < 2 ? `${WD[wd - 1]} ${dt.getUTCDate()}` : `${dt.getUTCDate()}.${String(dt.getUTCMonth() + 1).padStart(2, '0')}`, off: cfg.off.includes(wd) });
    }
    const fromIso = zonedIso(y, m, d, 0, 0, TZN);
    const last = days[days.length - 1].day.split('-').map(Number);
    const toIso = zonedIso(last[0], last[1], last[2] + 1, 0, 0, TZN);
    const techs = await db.query("SELECT tg_id, name, role FROM users WHERE status = 'active' AND role IN ('tech', 'specialist') AND name NOT IN ('Test', 'test') ORDER BY name");
    const tasks = await db.query(`SELECT id, task_no, tech_tg_id, team, planned_at, has_time, area, rooms, company_name, address, status
      FROM tasks WHERE status IN ('new', 'pending', 'open', 'in_progress') AND planned_at >= $1 AND planned_at < $2 ORDER BY planned_at`, [fromIso, toIso]);
    const busyOf = new Map(); // tg|day → [{from,to,...}]
    const noTime = new Map();
    for (const t of tasks) {
      let team = [];
      try { team = JSON.parse(t.team || '[]'); } catch { /* пусто */ }
      const people = [...new Set([t.tech_tg_id, ...team.map(String)].filter(Boolean).map(String))];
      const L = local(t.planned_at);
      for (const tg of people) {
        const k = `${tg}|${L.day}`;
        if (!Number(t.has_time)) { noTime.set(k, (noTime.get(k) || 0) + 1); continue; }
        const dur = cfg.dur + (cfg.big_m2 > 0 && areaM2(t.area) >= cfg.big_m2 ? cfg.big_add : 0);
        const list = busyOf.get(k) || [];
        list.push({ from: L.min, to: L.min + dur, label: shortAddr(t), task_no: Number(t.task_no) });
        busyOf.set(k, list);
      }
    }
    const out = days.map((D, di) => {
      const items = techs.map((u) => {
        const k = `${u.tg_id}|${D.day}`;
        const busy = (busyOf.get(k) || []).sort((a, b) => a.from - b.from);
        let free = [];
        if (!D.off) {
          // занято = выезд ± дорога; день начинается не раньше «сейчас» (сегодня, с шагом 15 мин)
          const dayStart = di === 0 ? Math.max(start, Math.ceil(nowL.min / 15) * 15) : start;
          let cur = dayStart;
          for (const b of busy) {
            const bs = b.from - cfg.road; const be = b.to + cfg.road;
            if (bs - cur >= cfg.min_slot) free.push({ from: cur, to: bs });
            cur = Math.max(cur, be);
          }
          if (end - cur >= cfg.min_slot) free.push({ from: cur, to: end });
          free = free.filter((f) => f.from >= start && f.to <= end).map((f) => ({ from: fmt(f.from), to: fmt(f.to), min: f.to - f.from }));
        }
        const prevOf = (f) => busy.filter((b) => b.to <= hm(f.from)).pop();
        return {
          tg: String(u.tg_id), name: u.name, count: busy.length + (noTime.get(k) || 0), no_time: noTime.get(k) || 0,
          busy_min: busy.reduce((s, b) => s + (b.to - b.from), 0),
          busy: busy.map((b) => ({ from: fmt(b.from), to: fmt(Math.min(b.to, 24 * 60 - 1)), label: b.label, task_no: b.task_no })),
          free: free.map((f) => { const p = prevOf(f); return { ...f, prev: p ? `${fmt(p.from)} ${p.label}` : '' }; }),
        };
      });
      return { ...D, techs: items };
    });
    // ближайшее окно у каждого техника
    const best = [];
    for (const u of techs) {
      for (const D of out) {
        const t = D.techs.find((x) => x.tg === String(u.tg_id));
        if (t?.free.length) { best.push({ tg: t.tg, name: u.name, day: D.day, label: D.label, date: D.date, ...t.free[0] }); break; }
      }
    }
    best.sort((a, b) => (a.day + a.from).localeCompare(b.day + b.from));
    return { cfg, now: fmt(nowL.min), today: nowL.day, days: out, best };
  }

  route('GET', '/api/free-time', async ({ user }) => freeTime(user), { access: 'admin' });
  route('GET', '/api/admin/free-settings', async () => ({ settings: await cfgGet(), defaults: FREE_DEFAULTS }), { access: 'admin' });
  route('PUT', '/api/admin/free-settings', async ({ user, body }) => {
    must(user.isOwner, 403, 'Только владелец');
    const s = normFree(body || {}, await cfgGet());
    await setSetting('free_cfg', s);
    await audit(user, 'Свободное время: настройки', '', `${s.from}–${s.to}, выезд ${s.dur} мин, дорога ${s.road} мин`);
    return { settings: s };
  }, { access: 'admin' });

  return { freeTime };
}
