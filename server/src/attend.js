// ====================================================================================================
// ПУНКТУАЛЬНОСТЬ МЕНЕДЖЕРОВ (v89)
// Отметка «Я на работе» / «Ухожу» по геопозиции офиса (место офиса — общее с квестами: quests_cfg.office),
// график (общий + свой у менеджера), допуск опоздания, выходные/отпуск, причина опоздания, «засчитать».
// Напоминание до начала, пинг при опоздании, утренняя сводка главному администратору, неявка через N часов.
// Штрафы — через каталог PENALTIES в sales.js (late_arrival / absence, по умолчанию выключены = только учёт),
// автопредупреждение каждые N опозданий/неявок за месяц (strike_after, 0 — выкл).
// ====================================================================================================
import { sendMessage, escHtml, botEnabled } from './tgbot.js';
import { zonedIso } from './tasks.js';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const OFF_KINDS = { off: 'Выходной', vacation: 'Отпуск', sick: 'Больничный', trip: 'Командировка' };
const DEFAULTS = {
  on: true,
  schedule: { days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' },
  per: {}, // tg → { days?, from?, to?, remote?, skip? }
  grace: 10, // допуск опоздания, мин
  remind_min: 15, // напоминание «отметьтесь» за N минут до начала (0 — выкл)
  absent_after: 180, // нет отметки через N минут после начала — неявка
  strike_after: 0, // каждое N-е опоздание/неявка за месяц → предупреждение (0 — выкл)
  digest: true, // утренняя сводка главному администратору
  xp: 10, // опыт за отметку вовремя
};
const hm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
const fmtHm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const validDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const validMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));
const minWord = (n) => `${n} мин`;
const monthQ = (q) => { const m = q?.get ? q.get('month') : q?.month; return validMonth(m) ? m : null; };

export function initAttend(ctx) {
  const { db, route, must, str, uid, now, getSetting, setSetting, audit, awardXp, notifyTech, publicBase, TZN, questsCfg, distM } = ctx;

  // ---------- время ----------
  function lt(d = new Date()) {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZN, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(d);
    const g = (t) => f.find((p) => p.type === t)?.value;
    return { day: `${g('year')}-${g('month')}-${g('day')}`, month: `${g('year')}-${g('month')}`, min: (+g('hour') % 24) * 60 + +g('minute'), wd: WD.indexOf(g('weekday')) + 1 };
  }
  const wdOf = (day) => { const d = new Date(`${day}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
  const minOf = (iso) => lt(new Date(iso)).min;
  const daysOfMonth = (ym) => { const [y, m] = ym.split('-').map(Number); const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`); };

  // ---------- настройки ----------
  async function settings() {
    const s = (await getSetting('attend_cfg')) || {};
    // с какого дня ведётся учёт: прошлые дни до включения не считаются пропусками
    if (!validDay(s.since)) { s.since = lt().day; await setSetting('attend_cfg', s); }
    const sch = s.schedule || {};
    return {
      ...DEFAULTS, ...s,
      schedule: { days: Array.isArray(sch.days) ? sch.days : DEFAULTS.schedule.days, from: hm(sch.from) != null ? sch.from : DEFAULTS.schedule.from, to: hm(sch.to) != null ? sch.to : DEFAULTS.schedule.to },
      per: s.per && typeof s.per === 'object' ? s.per : {},
    };
  }
  /** График сотрудника: общий + его поправки. */
  function scheduleOf(s, tg) {
    const p = s.per[String(tg)] || {};
    return {
      days: Array.isArray(p.days) && p.days.length ? p.days : s.schedule.days,
      from: hm(p.from) != null ? p.from : s.schedule.from,
      to: hm(p.to) != null ? p.to : s.schedule.to,
      remote: Boolean(p.remote), skip: Boolean(p.skip), custom: Boolean(p.days || p.from || p.to),
    };
  }
  async function office() {
    const o = (await questsCfg()).office || {};
    return o.lat != null && o.lon != null ? { lat: Number(o.lat), lon: Number(o.lon), radius: Number(o.radius) || 150, label: o.label || 'Офис' } : null;
  }
  async function managers() {
    return db.query("SELECT tg_id, name FROM users WHERE status = 'active' AND role = 'manager' ORDER BY name");
  }
  async function offOn(tg, day) {
    const [r] = await db.query('SELECT * FROM attend_off WHERE tg_id = $1 AND from_day <= $2 AND to_day >= $2 LIMIT 1', [String(tg), day]);
    return r || null;
  }
  async function rowOf(tg, day) {
    const [r] = await db.query('SELECT * FROM attend_days WHERE tg_id = $1 AND day = $2', [String(tg), day]);
    return r || null;
  }
  /** Рабочий ли день для сотрудника (по графику и без выходного/отпуска). */
  async function dayInfo(s, tg, day) {
    const sc = scheduleOf(s, tg);
    const off = await offOn(tg, day);
    return { sc, off, work: !sc.skip && sc.days.includes(wdOf(day)) && !off };
  }
  const shapeRow = (r) => (r ? {
    day: r.day, status: r.status, in_at: r.in_at || null, in_mode: r.in_mode || '', in_dist: r.in_dist == null ? null : Number(r.in_dist),
    late_min: Number(r.late_min) || 0, out_at: r.out_at || null, early_min: Number(r.early_min) || 0,
    reason: r.reason || '', excused: Boolean(Number(r.excused)), decided_by: r.decided_by || '',
  } : null);

  // ---------- месяц сотрудника ----------
  async function monthOf(s, tg, ym) {
    const today = lt();
    const rows = await db.query('SELECT * FROM attend_days WHERE tg_id = $1 AND day LIKE $2', [String(tg), `${ym}-%`]);
    const offs = await db.query('SELECT * FROM attend_off WHERE tg_id = $1 AND from_day <= $2 AND to_day >= $3 ORDER BY from_day', [String(tg), `${ym}-31`, `${ym}-01`]);
    const sc = scheduleOf(s, tg);
    const byDay = Object.fromEntries(rows.map((r) => [r.day, r]));
    const days = daysOfMonth(ym).map((day) => {
      const off = offs.find((o) => o.from_day <= day && o.to_day >= day);
      const work = !sc.skip && sc.days.includes(wdOf(day)) && !off;
      const r = shapeRow(byDay[day]);
      const future = day > today.day || (day === today.day && today.min < (hm(sc.from) ?? 540) + s.grace && !r);
      const before = day < s.since;
      // прошедший рабочий день без отметки (сервер мог «спать») — тоже неявка
      const status = r?.status || (off ? 'off' : !work ? 'rest' : before ? 'before' : future ? 'future' : day === today.day ? 'waiting' : 'absent');
      return { day, wd: wdOf(day), work, off: off ? { id: off.id, kind: off.kind, label: OFF_KINDS[off.kind] || 'Выходной', note: off.note || '' } : null, future, before, ...(r || {}), status };
    });
    const counted = days.filter((d) => d.work && !d.future && !d.before && d.status !== 'waiting');
    const ok = counted.filter((d) => d.status === 'ok' || (d.excused && ['late', 'absent'].includes(d.status))).length;
    const late = counted.filter((d) => d.status === 'late' && !d.excused);
    const absent = counted.filter((d) => d.status === 'absent' && !d.excused).length;
    const early = counted.filter((d) => d.early_min > s.grace).length;
    // серия «вовремя» подряд по рабочим дням (с конца)
    let streak = 0;
    for (const d of [...counted].reverse()) { if (d.status === 'ok' || d.excused) streak += 1; else if (d.status === 'waiting') continue; else break; }
    return {
      schedule: sc, days,
      stats: { work_days: counted.length, ontime: ok, late: late.length, late_min: late.reduce((a, d) => a + (d.late_min || 0), 0), absent, early, streak, pct: counted.length ? Math.round((ok / counted.length) * 100) : null },
    };
  }

  // ---------- отметки ----------
  async function autoStrike(s, tg, ym, why) {
    if (!(s.strike_after > 0)) return;
    const [c] = await db.query("SELECT COUNT(*) AS n FROM attend_days WHERE tg_id = $1 AND day LIKE $2 AND excused = 0 AND status IN ('late','absent')", [String(tg), `${ym}-%`]);
    const n = Number(c?.n) || 0;
    if (!n || n % s.strike_after !== 0) return;
    const note = `Пунктуальность: ${n} ${why} за месяц (авто)`;
    const [dup] = await db.query('SELECT id FROM mgr_strikes WHERE tg_id = $1 AND month = $2 AND note = $3', [String(tg), ym, note]);
    if (dup) return;
    await db.query('INSERT INTO mgr_strikes (id, tg_id, month, note, created_at, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [uid(), String(tg), ym, note, now(), 'авто']);
    notifyTech(tg, `⚠️ <b>Предупреждение за пунктуальность</b>\n${escHtml(note)}. Это снижает бонус KPI.`, { kind: 'mgr_strike' });
  }

  route('GET', '/api/attend/me', async ({ user, query }) => {
    must(user.role === 'manager', 403, 'Отметка прихода — для менеджеров');
    const s = await settings();
    const t = lt();
    const ym = monthQ(query) || t.month;
    const info = await dayInfo(s, user.id, t.day);
    const o = await office();
    return {
      on: s.on, grace: s.grace, office: o ? { label: o.label, radius: o.radius } : null,
      today: { day: t.day, work: info.work, off: info.off ? { kind: info.off.kind, label: OFF_KINDS[info.off.kind] || 'Выходной' } : null, from: info.sc.from, to: info.sc.to, remote: info.sc.remote, skip: info.sc.skip, now_min: t.min, row: shapeRow(await rowOf(user.id, t.day)) },
      month: ym, ...(await monthOf(s, user.id, ym)),
    };
  });

  /** Проверка места: в радиусе офиса (с поправкой на точность), или удалённо — если разрешено. */
  async function where(s, tg, body) {
    const lat = Number(body.lat); const lon = Number(body.lon);
    const sc = scheduleOf(s, tg);
    const o = await office();
    const has = Number.isFinite(lat) && Number.isFinite(lon);
    if (o && has) {
      const d = distM(o, { lat, lon });
      const acc = clamp(Number(body.acc) || 0, 0, 100);
      if (d <= o.radius + acc) return { mode: 'office', dist: d };
      if (sc.remote) return { mode: 'remote', dist: d };
      must(false, 400, `Вы в ${d >= 1000 ? `${(d / 1000).toFixed(1).replace('.', ',')} км` : `${d} м`} от офиса — отметиться можно только в офисе`);
    }
    if (sc.remote) return { mode: 'remote', dist: null };
    must(o, 400, 'Место офиса не задано — главный администратор задаёт его в «Продажи» → «Пунктуальность»');
    must(false, 400, 'Нет геопозиции — разрешите её для Telegram в настройках телефона');
    return null;
  }

  route('POST', '/api/attend/in', async ({ user, body }) => {
    must(user.role === 'manager', 403, 'Отметка прихода — для менеджеров');
    const s = await settings();
    must(s.on, 400, 'Отметка прихода выключена');
    const t = lt();
    const cur = await rowOf(user.id, t.day);
    if (cur?.in_at) return { ok: true, already: true, row: shapeRow(cur) };
    const w = await where(s, user.id, body);
    const info = await dayInfo(s, user.id, t.day);
    const late = info.work ? Math.max(0, t.min - (hm(info.sc.from) ?? 540)) : 0;
    const status = late > s.grace ? 'late' : 'ok';
    const at = now();
    if (cur) {
      // была отмечена неявка — пришёл позже: это опоздание
      await db.query('UPDATE attend_days SET in_at = $1, in_mode = $2, in_dist = $3, late_min = $4, status = $5 WHERE tg_id = $6 AND day = $7', [at, w.mode, w.dist, late, status, String(user.id), t.day]);
      await db.query("DELETE FROM mgr_penalties WHERE task_id = $1 AND penalty_id = 'absence'", [`att:${user.id}:${t.day}`]);
    } else {
      await db.query('INSERT INTO attend_days (tg_id, day, in_at, in_mode, in_dist, late_min, status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [String(user.id), t.day, at, w.mode, w.dist, late, status]);
    }
    let xp = 0;
    if (status === 'ok' && info.work && (await awardXp(user.id, 'attend', s.xp, `att:${t.day}`, 'Пришёл вовремя'))) xp = s.xp;
    if (status === 'late') await autoStrike(s, user.id, t.month, 'опозданий/неявок');
    return { ok: true, row: shapeRow(await rowOf(user.id, t.day)), xp, late_min: late, status, mode: w.mode };
  });

  route('POST', '/api/attend/out', async ({ user, body }) => {
    must(user.role === 'manager', 403, 'Отметка ухода — для менеджеров');
    const s = await settings();
    const t = lt();
    const cur = await rowOf(user.id, t.day);
    must(cur?.in_at, 400, 'Сначала отметьте приход');
    const w = await where(s, user.id, body).catch(() => ({ mode: 'remote', dist: null })); // уход фиксируем и вне офиса
    const info = await dayInfo(s, user.id, t.day);
    const early = info.work ? Math.max(0, (hm(info.sc.to) ?? 1080) - t.min) : 0;
    await db.query('UPDATE attend_days SET out_at = $1, out_dist = $2, early_min = $3 WHERE tg_id = $4 AND day = $5', [now(), w.dist, early, String(user.id), t.day]);
    return { ok: true, row: shapeRow(await rowOf(user.id, t.day)), early_min: early };
  });

  route('POST', '/api/attend/reason', async ({ user, body }) => {
    const day = validDay(body.day) ? body.day : lt().day;
    const text = str(body.text, 300);
    must(text.length >= 3, 400, 'Напишите причину');
    const cur = await rowOf(user.id, day);
    must(cur && ['late', 'absent'].includes(cur.status), 400, 'В этот день нет опоздания');
    await db.query('UPDATE attend_days SET reason = $1 WHERE tg_id = $2 AND day = $3', [text, String(user.id), day]);
    // главному администратору — с кнопкой «засчитать»
    if (botEnabled) {
      const owners = await db.query("SELECT tg_id FROM users WHERE status = 'active' AND role = 'admin'");
      const what = cur.status === 'absent' ? 'неявка' : `опоздание ${minWord(Number(cur.late_min) || 0)}`;
      for (const o of owners) {
        if (!/^\d+$/.test(String(o.tg_id))) continue;
        sendMessage(o.tg_id, `⏰ <b>${escHtml(user.name || '')}</b> · ${what} ${day.slice(8)}.${day.slice(5, 7)}\nПричина: «${escHtml(text)}»`,
          { replyMarkup: { inline_keyboard: [[{ text: '✅ Засчитать', callback_data: `attok:${user.id}:${day}` }]] } }).catch(() => {});
      }
    }
    return { ok: true };
  });

  // ---------- главный администратор ----------
  const ownerOnly = (user) => must(user.isOwner, 403, 'Пунктуальность менеджеров настраивает главный администратор');

  async function todayBoard(s) {
    const t = lt();
    const out = [];
    for (const m of await managers()) {
      const info = await dayInfo(s, m.tg_id, t.day);
      if (info.sc.skip) continue;
      const r = shapeRow(await rowOf(m.tg_id, t.day));
      const from = hm(info.sc.from) ?? 540;
      const state = !info.work ? (info.off ? 'off' : 'rest') : r?.in_at ? r.status : r?.status === 'absent' ? 'absent' : t.min > from + s.grace ? 'missing' : 'waiting';
      out.push({ tg_id: String(m.tg_id), name: m.name, state, from: info.sc.from, to: info.sc.to, off: info.off ? OFF_KINDS[info.off.kind] || 'Выходной' : '', row: r, late_now: state === 'missing' ? t.min - from : 0 });
    }
    return out;
  }

  route('GET', '/api/admin/attend', async ({ user, query }) => {
    ownerOnly(user);
    const s = await settings();
    const ym = monthQ(query) || lt().month;
    const items = [];
    for (const m of await managers()) {
      const mo = await monthOf(s, m.tg_id, ym);
      items.push({ tg_id: String(m.tg_id), name: m.name, schedule: mo.schedule, stats: mo.stats, days: mo.days });
    }
    const offs = await db.query("SELECT o.*, u.name FROM attend_off o LEFT JOIN users u ON u.tg_id = o.tg_id WHERE o.to_day >= $1 ORDER BY o.from_day", [`${ym}-01`]);
    return { month: ym, settings: s, office: await office(), today: await todayBoard(s), items, offs: offs.map((o) => ({ id: o.id, tg_id: o.tg_id, name: o.name || '', from: o.from_day, to: o.to_day, kind: o.kind, label: OFF_KINDS[o.kind] || 'Выходной', note: o.note || '' })), off_kinds: OFF_KINDS };
  });

  route('PUT', '/api/admin/attend-settings', async ({ user, body }) => {
    ownerOnly(user);
    const s = await settings();
    if (body.on !== undefined) s.on = Boolean(body.on);
    if (body.schedule) {
      const sc = body.schedule;
      if (sc.from !== undefined) { must(hm(sc.from) != null, 400, 'Начало — в формате 09:00'); s.schedule.from = sc.from; }
      if (sc.to !== undefined) { must(hm(sc.to) != null, 400, 'Конец — в формате 18:00'); s.schedule.to = sc.to; }
      if (Array.isArray(sc.days)) s.schedule.days = [...new Set(sc.days.map(Number).filter((d) => d >= 1 && d <= 7))].sort();
    }
    for (const [k, a, b] of [['grace', 0, 120], ['remind_min', 0, 120], ['absent_after', 30, 720], ['strike_after', 0, 20], ['xp', 0, 100]]) {
      if (body[k] !== undefined) { const n = Math.round(Number(body[k])); must(Number.isFinite(n) && n >= a && n <= b, 400, `Значение «${k}» — от ${a} до ${b}`); s[k] = n; }
    }
    if (body.digest !== undefined) s.digest = Boolean(body.digest);
    if (body.per && body.tg) {
      const p = body.per;
      if (p.from) must(hm(p.from) != null, 400, 'Начало — в формате 09:00');
      if (p.to) must(hm(p.to) != null, 400, 'Конец — в формате 18:00');
      const clean = {
        ...(Array.isArray(p.days) && p.days.length ? { days: [...new Set(p.days.map(Number).filter((d) => d >= 1 && d <= 7))].sort() } : {}),
        ...(p.from ? { from: p.from } : {}), ...(p.to ? { to: p.to } : {}),
        ...(p.remote ? { remote: true } : {}), ...(p.skip ? { skip: true } : {}),
      };
      s.per = { ...s.per, [String(body.tg)]: clean };
      if (!Object.keys(clean).length) delete s.per[String(body.tg)];
    }
    if (body.office) {
      // место офиса — общее с квестом «Кофе в офисе»
      const q = (await getSetting('quests_cfg')) || {};
      const lat = Number(body.office.lat); const lon = Number(body.office.lon);
      must(Number.isFinite(lat) && Number.isFinite(lon), 400, 'Нет координат офиса');
      q.office = { ...(q.office || {}), lat, lon, radius: clamp(Math.round(Number(body.office.radius) || (q.office?.radius ?? 150)), 30, 2000), label: str(body.office.label, 60) || q.office?.label || 'Офис' };
      await setSetting('quests_cfg', q);
    } else if (body.radius !== undefined) {
      const q = (await getSetting('quests_cfg')) || {};
      q.office = { ...(q.office || {}), radius: clamp(Math.round(Number(body.radius) || 150), 30, 2000) };
      await setSetting('quests_cfg', q);
    }
    const { per, ...rest } = s;
    await setSetting('attend_cfg', { ...rest, per });
    await audit(user, 'Пунктуальность: настройки', body.tg || '', `${s.schedule.from}–${s.schedule.to} · допуск ${s.grace} мин`);
    return { ok: true };
  });

  /** День сотрудника: засчитать опоздание/неявку, снять «засчитано», сделать выходным, очистить. */
  async function decideDay(user, tg, day, action, note = '') {
    must(validDay(day), 400, 'Некорректная дата');
    const cur = await rowOf(tg, day);
    const key = `att:${tg}:${day}`;
    if (action === 'excuse' && !cur && day < lt().day) {
      // прошедший день без отметки (неявка без записи) — засчитать
      await db.query("INSERT INTO attend_days (tg_id, day, status, late_min) VALUES ($1,$2,'absent',0)", [String(tg), day]);
    }
    const cur2 = cur || (await rowOf(tg, day));
    if (action === 'excuse' || action === 'unexcuse') {
      must(cur2 && ['late', 'absent'].includes(cur2.status), 400, 'В этот день нет опоздания');
      await db.query('UPDATE attend_days SET excused = $1, decided_by = $2 WHERE tg_id = $3 AND day = $4', [action === 'excuse' ? 1 : 0, user.name || '', String(tg), day]);
      if (action === 'excuse') await db.query("DELETE FROM mgr_penalties WHERE task_id = $1 AND penalty_id IN ('late_arrival','absence')", [key]);
    } else if (action === 'off') {
      await db.query('INSERT INTO attend_off (id, tg_id, from_day, to_day, kind, note, created_by, created_at) VALUES ($1,$2,$3,$3,$4,$5,$6,$7)', [uid(), String(tg), day, 'off', str(note, 200), user.name || '', now()]);
      if (cur && !cur.in_at) await db.query('DELETE FROM attend_days WHERE tg_id = $1 AND day = $2', [String(tg), day]);
      await db.query("DELETE FROM mgr_penalties WHERE task_id = $1 AND penalty_id IN ('late_arrival','absence')", [key]);
    } else if (action === 'clear') {
      await db.query('DELETE FROM attend_days WHERE tg_id = $1 AND day = $2', [String(tg), day]);
      await db.query("DELETE FROM mgr_penalties WHERE task_id = $1 AND penalty_id IN ('late_arrival','absence')", [key]);
    } else must(false, 400, 'Неизвестное действие');
    await audit(user, 'Пунктуальность: день', tg, `${day} · ${{ excuse: 'засчитано', unexcuse: 'не засчитано', off: 'выходной', clear: 'очищено' }[action]}`);
  }
  route('POST', '/api/admin/attend/:tg/day', async ({ user, params, body }) => {
    ownerOnly(user);
    await decideDay(user, params.tg, body.day, body.action, body.note);
    return { ok: true };
  });

  route('POST', '/api/admin/attend/:tg/off', async ({ user, params, body }) => {
    ownerOnly(user);
    must(validDay(body.from) && validDay(body.to) && body.from <= body.to, 400, 'Укажите даты «с» и «по»');
    const kind = OFF_KINDS[body.kind] ? body.kind : 'off';
    await db.query('INSERT INTO attend_off (id, tg_id, from_day, to_day, kind, note, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [uid(), String(params.tg), body.from, body.to, kind, str(body.note, 200), user.name || '', now()]);
    await db.query("DELETE FROM attend_days WHERE tg_id = $1 AND day >= $2 AND day <= $3 AND in_at IS NULL", [String(params.tg), body.from, body.to]);
    await db.query("DELETE FROM mgr_penalties WHERE tg_id = $1 AND penalty_id = 'absence' AND task_id >= $2 AND task_id <= $3", [String(params.tg), `att:${params.tg}:${body.from}`, `att:${params.tg}:${body.to}`]);
    await audit(user, 'Пунктуальность: выходные', params.tg, `${OFF_KINDS[kind]} ${body.from}–${body.to}`);
    return { ok: true };
  });
  route('DELETE', '/api/admin/attend/off/:id', async ({ user, params }) => {
    ownerOnly(user);
    await db.query('DELETE FROM attend_off WHERE id = $1', [params.id]);
    return { ok: true };
  });

  /** Кнопка «✅ Засчитать» в Telegram у главного администратора. */
  async function onCallback(data, user) {
    const m = /^attok:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(String(data || ''));
    if (!m || !user?.isOwner) return null;
    await decideDay(user, m[1], m[2], 'excuse');
    notifyTech(m[1], `✅ Опоздание ${m[2].slice(8)}.${m[2].slice(5, 7)} засчитано — без штрафа.`, { kind: 'attend' });
    return 'Засчитано ✅';
  }

  // ---------- тик: напоминания, неявки, сводка ----------
  async function tick() {
    const s = await settings();
    if (!s.on) return;
    const t = lt();
    const st = (await getSetting('attend_state')) || {};
    const state = st.day === t.day ? st : { day: t.day, reminded: [], pinged: [], absent: [], digest: false };
    let dirty = state !== st;
    const base = publicBase();
    const btn = base ? { replyMarkup: { inline_keyboard: [[{ text: '📍 Отметиться', web_app: { url: base } }]] } } : {};
    const list = await managers();
    let firstFrom = 24 * 60;
    for (const m of list) {
      const tg = String(m.tg_id);
      const info = await dayInfo(s, tg, t.day);
      if (!info.work) continue;
      const from = hm(info.sc.from) ?? 540;
      firstFrom = Math.min(firstFrom, from);
      const r = await rowOf(tg, t.day);
      if (r?.in_at) continue;
      const ok = /^\d+$/.test(tg) && botEnabled;
      // напоминание до начала
      if (s.remind_min > 0 && t.min >= from - s.remind_min && t.min < from && !state.reminded.includes(tg)) {
        state.reminded.push(tg); dirty = true;
        if (ok) sendMessage(tg, `⏰ Рабочий день с <b>${info.sc.from}</b>. Придёте — отметьтесь в приложении «📍 Я на работе».`, btn).catch(() => {});
      }
      // опаздывает
      if (t.min > from + s.grace && t.min < from + s.absent_after && !state.pinged.includes(tg)) {
        state.pinged.push(tg); dirty = true;
        if (ok) sendMessage(tg, `⏰ <b>Вы опаздываете</b> — начало было в ${info.sc.from}. Отметьтесь, как придёте, и напишите причину.`, btn).catch(() => {});
      }
      // неявка
      if (t.min >= from + s.absent_after && !state.absent.includes(tg)) {
        state.absent.push(tg); dirty = true;
        if (!r) await db.query("INSERT INTO attend_days (tg_id, day, status, late_min) VALUES ($1,$2,'absent',0)", [tg, t.day]);
        if (ok) sendMessage(tg, '❗️ Сегодня нет отметки прихода — день отмечен как неявка. Если вы работаете — отметьтесь и напишите причину.', btn).catch(() => {});
        await autoStrike(s, tg, t.month, 'опозданий/неявок');
      }
    }
    // сводка главному администратору: через 30 мин после самого раннего начала
    if (s.digest && !state.digest && firstFrom < 24 * 60 && t.min >= firstFrom + Math.max(30, s.grace + 5)) {
      state.digest = true; dirty = true;
      const board = await todayBoard(s);
      const work = board.filter((b) => !['off', 'rest'].includes(b.state));
      if (work.length && botEnabled) {
        const ontime = work.filter((b) => b.state === 'ok');
        const late = work.filter((b) => b.state === 'late');
        const miss = work.filter((b) => ['missing', 'waiting', 'absent'].includes(b.state));
        const off = board.filter((b) => b.state === 'off');
        const html = [
          `⏰ <b>Пунктуальность · ${t.day.slice(8)}.${t.day.slice(5, 7)}</b>`,
          ontime.length ? `✅ Вовремя: ${ontime.map((b) => `${escHtml(b.name)} ${fmtHm(minOf(b.row.in_at))}`).join(', ')}` : '',
          late.length ? `🟠 Опоздали: ${late.map((b) => `${escHtml(b.name)} +${minWord(b.row.late_min)}`).join(', ')}` : '',
          miss.length ? `🔴 Нет отметки: ${miss.map((b) => `${escHtml(b.name)} (с ${b.from})`).join(', ')}` : '',
          off.length ? `🌴 ${off.map((b) => `${escHtml(b.name)} — ${b.off.toLowerCase()}`).join(', ')}` : '',
        ].filter(Boolean).join('\n');
        for (const o of await db.query("SELECT tg_id FROM users WHERE status = 'active' AND role = 'admin'")) {
          if (/^\d+$/.test(String(o.tg_id))) sendMessage(o.tg_id, html, base ? { replyMarkup: { inline_keyboard: [[{ text: '📊 Пунктуальность', web_app: { url: `${base}/?sales=attend` } }]] } } : {}).catch(() => {});
        }
      }
    }
    if (dirty) await setSetting('attend_state', state);
  }
  setInterval(() => { tick().catch((e) => console.error('attend tick:', e.message)); }, 60000).unref?.();

  return { onCallback, tick, settings };
}

/** Для штрафов в sales.js: опоздания/неявки за всё время (без засчитанных), ключ — att:<tg>:<day>. */
export const ATTEND_PENALTIES = {
  late_arrival: { label: 'Опоздание на работу', amount: 50, param: 10, param_unit: 'мин', hint: 'за каждое опоздание больше N минут (засчитанные — без штрафа)' },
  absence: { label: 'Неявка без причины', amount: 200, param: 0, param_unit: '', hint: 'за каждый рабочий день без отметки прихода (выходные, отпуск и засчитанные — без штрафа)' },
};
export const attendDayIso = (day) => zonedIso(+day.slice(0, 4), +day.slice(5, 7), +day.slice(8, 10), 12, 0);
