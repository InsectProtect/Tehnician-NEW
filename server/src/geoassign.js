// ====================================================================================================
// КТО БЛИЖЕ (v118). Как только менеджер кидает заявку, бот находит адрес на карте и считает, сколько лишних
// километров она добавит каждому дезинсектору, свободному в это время (время заявки НЕ меняем). Если другому
// заметно ближе (порог `free_cfg.geo_min_km`, по умолчанию 5 км) — отвечает под заявкой в группе:
// «Выгоднее Radu: +3 км вместо +14 км» с кнопками «Передать» / «Оставить». Адрес не нашёлся — просит уточнить.
// Расстояние — по прямой × 1.3 (поправка на дороги): для сравнения вариантов этого достаточно.
// ====================================================================================================

const ROAD = 1.3;
const BUSY_MIN = 60; // ближе часа к другой заявке — занят

export function distKm(a, b) {
  const p = Math.PI / 180;
  const d = Math.sin(((b.lat - a.lat) * p) / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(((b.lon - a.lon) * p) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(d)) * ROAD;
}

export function initGeoAssign(ctx) {
  const { db, taskDest, dayOf, getSetting, botEnabled, sendMessage, editMessage, escHtml, audit, assignTaskTo, notifyTech } = ctx;

  const cfg = async () => {
    const c = (await getSetting('free_cfg', null)) || {};
    return { on: c.geo_on !== false, min: Number.isFinite(Number(c.geo_min_km)) ? Number(c.geo_min_km) : 5 };
  };
  const first = (n) => String(n || '').split(' ')[0];
  const hm = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { timeZone: ctx.TZN, hour: '2-digit', minute: '2-digit' });
  const where = (t) => t.company_name || t.address || '';

  /** Лишние км для сотрудника, если отдать ему заявку t (null — не с чем сравнить или занят). */
  async function extraFor(tg, t, dest) {
    const day = dayOf(t.planned_at);
    const at = new Date(t.planned_at).getTime();
    const rows = (await db.query(`SELECT * FROM tasks WHERE id <> $1 AND has_time = 1 AND planned_at IS NOT NULL
      AND status IN ('new', 'pending', 'open', 'in_progress', 'done') AND (tech_tg_id = $2 OR team LIKE $3)`, [t.id, tg, `%${tg}%`]))
      .filter((x) => dayOf(x.planned_at) === day)
      .sort((a, b) => a.planned_at.localeCompare(b.planned_at));
    if (rows.some((x) => Math.abs(new Date(x.planned_at).getTime() - at) < BUSY_MIN * 60000)) return { busy: true };
    const prev = rows.filter((x) => new Date(x.planned_at).getTime() < at).pop();
    const next = rows.find((x) => new Date(x.planned_at).getTime() > at);
    const P = prev ? await taskDest(prev) : null;
    const N = next ? await taskDest(next) : null;
    if (!P && !N) return { extra: null, count: rows.length };
    let extra;
    if (P && N) extra = distKm(P, dest) + distKm(dest, N) - distKm(P, N);
    else extra = distKm(P || N, dest);
    const near = [P && { t: prev, km: distKm(P, dest) }, N && { t: next, km: distKm(dest, N) }].filter(Boolean).sort((a, b) => a.km - b.km)[0];
    return { extra: Math.max(0, extra), near, count: rows.length };
  }

  async function onTaskCreated(taskId) {
    const c = await cfg();
    if (!c.on) return;
    const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (!t || !t.planned_at || !Number(t.has_time) || !['new', 'pending'].includes(t.status)) return;
    if (new Date(t.planned_at).getTime() < Date.now()) return;
    let team = [];
    try { team = JSON.parse(t.team || '[]'); } catch { /* пусто */ }
    const dest = await taskDest(t);
    const reply = async (html, kb) => {
      if (!botEnabled || !t.chat_id) return null;
      return sendMessage(t.chat_id, html, { threadId: t.thread_id || undefined, replyTo: t.confirm_id || t.message_id || undefined, ...(kb ? { replyMarkup: kb } : {}) }).catch((e) => console.error('geo assign:', e.message));
    };
    if (!dest) {
      // «не нашёлся» — только если карта ответила, что адреса нет (сбой связи с картой — молчим)
      const [g] = await db.query('SELECT dest_geo FROM tasks WHERE id = $1', [t.id]);
      if (g?.dest_geo === 'fail' && /\d/.test(t.address || '')) await reply(`📍 <b>Заявка № ${t.task_no}</b>: адрес «${escHtml(t.address)}» не нашёлся на карте — проверьте улицу и номер дома.`);
      return;
    }
    if (team.length) return; // командные заявки не перекидываем
    const users = await db.query("SELECT tg_id, name FROM users WHERE status = 'active' AND role IN ('tech', 'specialist') AND name NOT IN ('Test', 'test')");
    const res = [];
    for (const u of users) res.push({ u, ...(await extraFor(String(u.tg_id), t, dest)) });
    const cur = res.find((r) => String(r.u.tg_id) === String(t.tech_tg_id));
    if (!cur || cur.extra == null) return;
    const best = res.filter((r) => !r.busy && r.extra != null && String(r.u.tg_id) !== String(t.tech_tg_id)).sort((a, b) => a.extra - b.extra)[0];
    if (!best || cur.extra - best.extra < c.min) return;
    const save = Math.round(cur.extra - best.extra);
    const nearTxt = (r) => (r.near ? `${hm(r.near.t.planned_at)} ${escHtml(where(r.near.t).slice(0, 28))} — ${r.near.km.toFixed(1).replace('.', ',')} км` : '');
    const html = [
      `💡 <b>Заявка № ${t.task_no} · ${hm(t.planned_at)} · ${escHtml(where(t).slice(0, 40))}</b>`,
      `Назначен: ${escHtml(first(cur.u.name))} — <b>+${Math.round(cur.extra)} км</b>${cur.near ? ` (ближайшая: ${nearTxt(cur)})` : ''}`,
      `Выгоднее: <b>${escHtml(first(best.u.name))} — +${Math.round(best.extra)} км</b>${best.near ? ` (рядом: ${nearTxt(best)})` : ''}`,
      `Экономия: <b>${save} км</b>. Время заявки не меняется.`,
    ].join('\n');
    const kb = { inline_keyboard: [[{ text: `✅ Передать ${first(best.u.name)}`, callback_data: `gasg:${t.id}:${best.u.tg_id}` }, { text: `Оставить ${first(cur.u.name)}`, callback_data: `gasn:${t.id}` }]] };
    const sent = await reply(html, kb);
    await audit({ id: 'bot', name: 'Бот' }, 'Кто ближе: подсказка', `№ ${t.task_no}`, `${cur.u.name} +${Math.round(cur.extra)} км → ${best.u.name} +${Math.round(best.extra)} км`);
    return sent;
  }

  /** Кнопки под подсказкой. who — менеджер/админ. */
  async function onCallback(data, who, msg) {
    const keep = data.startsWith('gasn:');
    const [, taskId, tg] = data.split(':');
    const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (!t) return 'Заявка не найдена';
    const [cur] = await db.query('SELECT name FROM users WHERE tg_id = $1', [t.tech_tg_id]);
    const text = (msg?.text || '').split('\n').slice(0, 4).map(escHtml).join('\n');
    if (keep) {
      if (msg) editMessage(msg.chat.id, msg.message_id, `${text}\n\n↩️ Оставили ${escHtml(first(cur?.name))} (${escHtml(who.name || '')})`).catch(() => {});
      return 'Оставили как есть';
    }
    if (!['new', 'pending'].includes(t.status) || t.visit_id) return 'Выезд уже начат — не меняем';
    const [u] = await db.query("SELECT tg_id, name, role FROM users WHERE tg_id = $1 AND status = 'active'", [tg]);
    if (!u) return 'Сотрудник не найден';
    if (String(t.tech_tg_id) === String(u.tg_id)) return 'Уже назначен';
    const was = String(t.tech_tg_id);
    await assignTaskTo(t, u, who);
    notifyTech(was, `🔁 Заявка № ${t.task_no} (${escHtml(where(t))}) передана ${escHtml(u.name)} — ему ближе по маршруту.`, { kind: 'task_moved' });
    if (msg) editMessage(msg.chat.id, msg.message_id, `${text}\n\n✅ Передано ${escHtml(first(u.name))} (${escHtml(who.name || '')})`).catch(() => {});
    return `Передано ${first(u.name)}`;
  }

  return { onTaskCreated, onCallback };
}
