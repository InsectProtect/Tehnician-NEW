// ====================================================================================================
// СООБЩИТЬ МЕНЕДЖЕРУ ОБ ОШИБКЕ (v117)
// Дезинсектор с главной пишет об ошибке (в заявке, адресе, времени — что угодно), можно указать заявку.
// Менеджеру (автор заявки, иначе все менеджеры, иначе админы) бот присылает сообщение с кнопкой «✅ Уведомлен»
// и повторяет его каждые 5 минут, пока кто-то не нажмёт. В приложении — карточка на «Обзоре» с той же кнопкой.
// ====================================================================================================

export const ISSUES_SCHEMA = `CREATE TABLE IF NOT EXISTS tech_issues (
  id TEXT PRIMARY KEY,
  tg_id TEXT NOT NULL,
  task_id TEXT,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  recipients TEXT,
  msgs TEXT,
  pings INTEGER DEFAULT 0,
  last_ping TEXT,
  created_at TEXT NOT NULL,
  ack_at TEXT,
  ack_by TEXT,
  ack_name TEXT
)`;

const EVERY_MIN = 5;
const MAX_PINGS = 48; // 4 часа — дальше не спамим, карточка в приложении остаётся

export function initIssues(ctx) {
  const { db, route, must, str, uid, now, audit, notifyTech, addNotification, botEnabled, sendMessage, editMessage, deleteMessage, escHtml, publicBase, TZN } = ctx;
  let ready = false;
  const ensure = async () => { if (!ready) { await db.query(ISSUES_SCHEMA); ready = true; } };

  const json = (s, d) => { try { const x = JSON.parse(s || ''); return x ?? d; } catch { return d; } };
  const hm = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { timeZone: TZN, hour: '2-digit', minute: '2-digit' });
  const dm = (iso) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: TZN, day: '2-digit', month: '2-digit' });

  async function recipients(task) {
    if (task?.author_id) {
      const [u] = await db.query("SELECT role FROM users WHERE tg_id = $1 AND status = 'active'", [String(task.author_id)]);
      if (u?.role === 'manager') return [String(task.author_id)];
    }
    const ms = await db.query("SELECT tg_id FROM users WHERE status = 'active' AND role = 'manager'");
    if (ms.length) return ms.map((m) => String(m.tg_id));
    return (await db.query("SELECT tg_id FROM users WHERE status = 'active' AND role = 'admin'")).map((u) => String(u.tg_id));
  }

  async function view(i) {
    const [tech] = await db.query('SELECT name FROM users WHERE tg_id = $1', [i.tg_id]);
    const [t] = i.task_id ? await db.query('SELECT id, task_no, company_name, address, planned_at, has_time FROM tasks WHERE id = $1', [i.task_id]) : [];
    return {
      id: i.id, text: i.text, status: i.status, created_at: i.created_at, ack_at: i.ack_at, ack_name: i.ack_name || '',
      pings: Number(i.pings) || 0, tech: tech?.name || '', tech_tg: i.tg_id,
      task: t ? { id: t.id, task_no: Number(t.task_no), title: t.company_name || t.address || '', when: t.planned_at ? `${dm(t.planned_at)}${Number(t.has_time) ? ` ${hm(t.planned_at)}` : ''}` : '' } : null,
    };
  }

  function html(v, n) {
    return `🆘 <b>Дезинсектор сообщает об ошибке</b>${n > 1 ? ` · ${n}-е напоминание` : ''}\n`
      + `👷 ${escHtml(v.tech)} · ${hm(v.created_at)}\n`
      + (v.task ? `📋 Заявка № ${v.task.task_no}${v.task.when ? ` · ${v.task.when}` : ''}${v.task.title ? `\n📍 ${escHtml(v.task.title)}` : ''}\n` : '')
      + `\n💬 ${escHtml(v.text)}\n\n<i>Повторяю каждые ${EVERY_MIN} мин, пока не нажмёте «Уведомлен».</i>`;
  }
  const kb = (id) => {
    const rows = [[{ text: '✅ Уведомлен', callback_data: `isack:${id}` }]];
    const base = publicBase();
    if (base) rows.push([{ text: 'Открыть приложение', web_app: { url: base } }]);
    return { inline_keyboard: rows };
  };

  /** Отправить (или переотправить — старое сообщение удаляем, чтобы телефон снова зазвенел). */
  async function ping(i) {
    const v = await view(i);
    const n = (Number(i.pings) || 0) + 1;
    const old = json(i.msgs, {});
    const msgs = {};
    for (const tg of json(i.recipients, [])) {
      if (botEnabled) {
        if (old[tg]) deleteMessage(tg, old[tg]).catch(() => {});
        try { const m = await sendMessage(tg, html(v, n), { replyMarkup: kb(i.id) }); if (m?.message_id) msgs[tg] = m.message_id; } catch (e) { console.error('issue ping:', e.message); }
      }
      if (n === 1) addNotification(tg, 'issue', `🆘 ${v.tech}: ${v.text}`, { issue_id: i.id }).catch(() => {});
    }
    await db.query('UPDATE tech_issues SET msgs = $1, pings = $2, last_ping = $3 WHERE id = $4', [JSON.stringify(msgs), n, now(), i.id]);
  }

  async function ack(id, who) {
    await ensure();
    const [i] = await db.query('SELECT * FROM tech_issues WHERE id = $1', [id]);
    must(i, 404, 'Сообщение не найдено');
    if (i.status === 'ack') return { already: true, ack_name: i.ack_name };
    await db.query("UPDATE tech_issues SET status = 'ack', ack_at = $1, ack_by = $2, ack_name = $3 WHERE id = $4", [now(), String(who.id), who.name || '', id]);
    const v = await view({ ...i, status: 'ack' });
    for (const [tg, mid] of Object.entries(json(i.msgs, {}))) {
      editMessage(tg, mid, `${html(v, 1).split('\n\n<i>')[0]}\n\n✅ Уведомлен: <b>${escHtml(who.name || '')}</b> · ${hm(now())}`).catch(() => {});
    }
    notifyTech(i.tg_id, `✅ <b>${escHtml(who.name || 'Менеджер')}</b> получил(а) ваше сообщение об ошибке:\n«${escHtml(i.text.slice(0, 200))}»`, { kind: 'issue_ack' });
    await audit(who, 'Ошибка от дезинсектора: уведомлен', v.task ? `№${v.task.task_no}` : '', `${v.tech}: ${i.text.slice(0, 200)}`);
    return { ok: true };
  }

  async function tick() {
    await ensure();
    const since = new Date(Date.now() - EVERY_MIN * 60000 + 15000).toISOString();
    const due = await db.query("SELECT * FROM tech_issues WHERE status = 'new' AND (last_ping IS NULL OR last_ping < $1) AND pings < $2", [since, MAX_PINGS]);
    for (const i of due) await ping(i).catch((e) => console.error('issue tick:', e.message));
  }
  setInterval(() => { tick().catch((e) => console.error('issues tick:', e.message)); }, 60000).unref?.();

  // ---------- API дезинсектора ----------
  route('GET', '/api/issues/form', async ({ user }) => {
    await ensure();
    const from = new Date(Date.now() - 36 * 3600000).toISOString();
    const to = new Date(Date.now() + 7 * 86400000).toISOString();
    const tasks = await db.query(`SELECT id, task_no, company_name, address, planned_at, has_time, team FROM tasks
      WHERE status IN ('new', 'pending', 'open', 'in_progress', 'done') AND planned_at >= $1 AND planned_at < $2
      AND (tech_tg_id = $3 OR team LIKE $4) ORDER BY planned_at LIMIT 30`, [from, to, String(user.id), `%${String(user.id)}%`]);
    const mine = await db.query('SELECT * FROM tech_issues WHERE tg_id = $1 ORDER BY created_at DESC LIMIT 5', [String(user.id)]);
    return {
      tasks: tasks.map((t) => ({ id: t.id, task_no: Number(t.task_no), title: t.company_name || t.address || '', when: t.planned_at ? `${dm(t.planned_at)}${Number(t.has_time) ? ` ${hm(t.planned_at)}` : ''}` : '' })),
      mine: await Promise.all(mine.map(view)),
    };
  });

  route('POST', '/api/issues', async ({ user, body }) => {
    await ensure();
    const text = str(body.text, 1000).trim();
    must(text.length >= 3, 400, 'Напишите, в чём ошибка');
    let task = null;
    if (body.task_id) {
      [task] = await db.query('SELECT * FROM tasks WHERE id = $1', [String(body.task_id)]);
      must(task, 404, 'Заявка не найдена');
    }
    const [open] = await db.query("SELECT id FROM tech_issues WHERE tg_id = $1 AND text = $2 AND status = 'new'", [String(user.id), text]);
    must(!open, 409, 'Такое сообщение уже отправлено — менеджер ещё не ответил');
    const rec = await recipients(task);
    must(rec.length, 400, 'Некому отправить — нет менеджеров');
    const id = uid();
    await db.query('INSERT INTO tech_issues (id, tg_id, task_id, text, status, recipients, msgs, pings, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, String(user.id), task?.id || null, text, 'new', JSON.stringify(rec), '{}', 0, now()]);
    const [i] = await db.query('SELECT * FROM tech_issues WHERE id = $1', [id]);
    await ping(i);
    await audit(user, 'Ошибка от дезинсектора', task ? `№${task.task_no}` : '', text.slice(0, 300));
    return { ok: true, sent_to: rec.length };
  });

  // ---------- офис ----------
  route('GET', '/api/admin/issues', async () => {
    await ensure();
    const rows = await db.query("SELECT * FROM tech_issues WHERE status = 'new' OR ack_at > $1 ORDER BY created_at DESC LIMIT 20", [new Date(Date.now() - 12 * 3600000).toISOString()]);
    return { items: await Promise.all(rows.map(view)) };
  }, { access: 'admin' });
  route('POST', '/api/admin/issues/:id/ack', async ({ user, params }) => ack(params.id, user), { access: 'admin' });

  /** callback «isack:<id>» из Telegram. */
  async function onCallback(data, who) { return ack(data.slice(6), who); }

  return { onCallback, tick };
}
