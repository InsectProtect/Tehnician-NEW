// ====================================================================================================
// «КАССА» (v52): сколько наличных сейчас на руках у сотрудника (из оплат cash в его выездах),
// сдача кассы (администратор/менеджер с правом «Касса» пересчитывает и подтверждает) и
// выдача из кассы под отчёт (сотрудник просит сумму и пишет, на что — без одобрения взять нельзя).
// ====================================================================================================
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.').replace(/\s/g, '')); return Number.isFinite(n) ? n : NaN; };

export function initCash(ctx) {
  const { db, route, must, str, uid, now, audit, notifyTech, escHtml } = ctx;

  /** Кому слать уведомления о кассе: главный администратор — всегда, менеджер — только с правом «Касса». */
  function hasCashPerm(u) { try { return (JSON.parse(u.perms || '[]') || []).includes('cash'); } catch { return false; } }
  async function cashStaff() {
    const rows = await db.query("SELECT tg_id, perms, role FROM users WHERE status = 'active' AND role IN ('admin', 'manager')");
    return rows.filter((u) => u.role === 'admin' || hasCashPerm(u)).map((u) => String(u.tg_id));
  }

  /** Время последней решённой сдачи кассы — всё после неё считается «на руках» у сотрудника. */
  async function settledAt(tg) {
    const [r] = await db.query("SELECT created_at FROM cash_handovers WHERE tg_id = $1 AND status IN ('ok', 'short') ORDER BY created_at DESC LIMIT 1", [String(tg)]);
    return r?.created_at || null;
  }

  /** Сколько наличных сейчас на руках: оплаты cash по завершённым выездам минус одобренные выдачи, плюс ручные правки администратора, с момента последней сдачи. */
  async function balanceOf(tg) {
    const since = await settledAt(tg);
    const [v] = await db.query(
      `SELECT COALESCE(SUM(pay_amount), 0) AS s FROM visits WHERE tech_tg_id = $1 AND status = 'done' AND payment = 'cash'${since ? ' AND finished_at > $2' : ''}`,
      since ? [String(tg), since] : [String(tg)],
    );
    const [w] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS s FROM cash_withdrawals WHERE tg_id = $1 AND status = 'approved'${since ? ' AND created_at > $2' : ''}`,
      since ? [String(tg), since] : [String(tg)],
    );
    const [a] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS s FROM cash_adjustments WHERE tg_id = $1${since ? ' AND created_at > $2' : ''}`,
      since ? [String(tg), since] : [String(tg)],
    );
    return r2(Number(v?.s || 0) - Number(w?.s || 0) + Number(a?.s || 0));
  }

  async function pendingHandover(tg) {
    const [r] = await db.query("SELECT * FROM cash_handovers WHERE tg_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1", [String(tg)]);
    return r || null;
  }

  // ---------- сотрудник ----------

  route('GET', '/api/cash/me', async ({ user }) => {
    const balance = await balanceOf(user.id);
    const pending = await pendingHandover(user.id);
    const withdrawals = await db.query("SELECT id, amount, reason, status, created_at, decided_at FROM cash_withdrawals WHERE tg_id = $1 ORDER BY created_at DESC LIMIT 10", [user.id]);
    const history = await db.query("SELECT id, expected_amount, received_amount, status, created_at, decided_at FROM cash_handovers WHERE tg_id = $1 AND status != 'pending' ORDER BY created_at DESC LIMIT 10", [user.id]);
    const adjustments = await db.query("SELECT id, amount, reason, created_at, created_by FROM cash_adjustments WHERE tg_id = $1 ORDER BY created_at DESC LIMIT 10", [user.id]);
    return {
      balance,
      pending: pending ? { id: pending.id, expected_amount: Number(pending.expected_amount), created_at: pending.created_at } : null,
      pending_withdrawals: withdrawals.filter((w) => w.status === 'pending').map((w) => ({ id: w.id, amount: Number(w.amount), reason: w.reason, created_at: w.created_at })),
      withdrawals: withdrawals.map((w) => ({ id: w.id, amount: Number(w.amount), reason: w.reason, status: w.status, created_at: w.created_at, decided_at: w.decided_at })),
      history: history.map((h) => ({ id: h.id, expected_amount: Number(h.expected_amount), received_amount: h.received_amount == null ? null : Number(h.received_amount), status: h.status, created_at: h.created_at, decided_at: h.decided_at })),
      adjustments: adjustments.map((a) => ({ id: a.id, amount: Number(a.amount), reason: a.reason, created_at: a.created_at, created_by: a.created_by })),
    };
  });

  route('POST', '/api/cash/handover', async ({ user }) => {
    must(!(await pendingHandover(user.id)), 400, 'Запрос на сдачу кассы уже отправлен — ждите, пока его примут');
    const expected = await balanceOf(user.id);
    must(expected > 0, 400, 'На руках пока нет наличных — нечего сдавать');
    const id = uid();
    await db.query('INSERT INTO cash_handovers (id, tg_id, expected_amount, status, created_at) VALUES ($1,$2,$3,\'pending\',$4)', [id, user.id, expected, now()]);
    await audit(user, 'Касса: запрос на сдачу', user.name, `${expected} лей`);
    for (const tg of await cashStaff()) {
      if (/^\d+$/.test(tg)) notifyTech(tg, `💵 <b>${escHtml(user.name)}</b> хочет сдать кассу: ожидается ${expected} лей.`, { kind: 'cash' });
    }
    return { ok: true, id, expected };
  });

  route('POST', '/api/cash/withdraw', async ({ user, body }) => {
    const amount = num(body.amount);
    must(amount > 0 && amount < 1000000, 400, 'Укажите сумму');
    const reason = str(body.reason, 300);
    must(reason.length >= 3, 400, 'Напишите, на что нужны деньги');
    const id = uid();
    await db.query('INSERT INTO cash_withdrawals (id, tg_id, amount, reason, status, created_at) VALUES ($1,$2,$3,$4,\'pending\',$5)', [id, user.id, r2(amount), reason, now()]);
    await audit(user, 'Касса: запрос на выдачу', user.name, `${r2(amount)} лей · ${reason}`);
    for (const tg of await cashStaff()) {
      if (/^\d+$/.test(tg)) notifyTech(tg, `💵 <b>${escHtml(user.name)}</b> просит взять из кассы ${r2(amount)} лей — ${escHtml(reason)}.`, { kind: 'cash' });
    }
    return { ok: true, id };
  });

  // ---------- администратор / менеджер с правом «Касса» ----------

  async function cashOverview() {
    const techs = await db.query("SELECT tg_id, name FROM users WHERE status = 'active' AND role NOT IN ('admin', 'manager') ORDER BY name");
    const items = [];
    for (const t of techs) {
      const balance = await balanceOf(t.tg_id);
      const pending = await pendingHandover(t.tg_id);
      const [{ n: wn }] = await db.query("SELECT COUNT(*) AS n FROM cash_withdrawals WHERE tg_id = $1 AND status = 'pending'", [t.tg_id]);
      items.push({ tg_id: t.tg_id, name: t.name, balance, pending_handover: pending ? { id: pending.id, expected_amount: Number(pending.expected_amount), created_at: pending.created_at } : null, pending_withdrawals: Number(wn) || 0 });
    }
    const withdrawals = await db.query(
      "SELECT w.*, u.name FROM cash_withdrawals w LEFT JOIN users u ON u.tg_id = w.tg_id WHERE w.status = 'pending' ORDER BY w.created_at",
    );
    return {
      items,
      withdrawals: withdrawals.map((w) => ({ id: w.id, tg_id: w.tg_id, name: w.name || w.tg_id, amount: Number(w.amount), reason: w.reason, created_at: w.created_at })),
    };
  }

  route('GET', '/api/admin/cash', async () => cashOverview(), { access: 'admin' });

  route('POST', '/api/admin/cash/handover/:id/confirm', async ({ user, params, body }) => {
    const [r] = await db.query('SELECT * FROM cash_handovers WHERE id = $1', [params.id]);
    must(r, 404, 'Запрос не найден');
    must(r.status === 'pending', 400, 'Уже решено');
    const received = num(body.received_amount);
    must(received >= 0 && received < 1000000, 400, 'Укажите пересчитанную сумму');
    const expected = Number(r.expected_amount);
    const ok = Math.abs(r2(received) - r2(expected)) < 0.01;
    await db.query('UPDATE cash_handovers SET received_amount = $1, status = $2, decided_at = $3, decided_by = $4 WHERE id = $5',
      [r2(received), ok ? 'ok' : 'short', now(), user.name || '', r.id]);
    await audit(user, 'Касса: сдача принята', r.tg_id, `ожидалось ${expected}, принято ${r2(received)}${ok ? '' : ` · недостача ${r2(expected - received)}`}`);
    notifyTech(r.tg_id, ok
      ? `✅ Касса принята: ${r2(received)} лей — всё сошлось.`
      : `⚠️ Касса принята: ${r2(received)} лей из ${expected} — не хватает ${r2(expected - received)} лей.`,
      { kind: 'cash' });
    return { ok: true, status: ok ? 'ok' : 'short', shortfall: ok ? 0 : r2(expected - received) };
  }, { access: 'admin' });

  route('POST', '/api/admin/cash/withdraw/:id/decide', async ({ user, params, body }) => {
    const [r] = await db.query('SELECT * FROM cash_withdrawals WHERE id = $1', [params.id]);
    must(r, 404, 'Запрос не найден');
    must(r.status === 'pending', 400, 'Уже решено');
    const approve = Boolean(body.ok);
    await db.query('UPDATE cash_withdrawals SET status = $1, decided_at = $2, decided_by = $3 WHERE id = $4', [approve ? 'approved' : 'rejected', now(), user.name || '', r.id]);
    await audit(user, approve ? 'Касса: выдача одобрена' : 'Касса: выдача отклонена', r.tg_id, `${r.amount} лей · ${r.reason}`);
    notifyTech(r.tg_id, approve
      ? `✅ Разрешено взять из кассы ${r.amount} лей — ${escHtml(r.reason)}.`
      : `❌ Нельзя взять из кассы ${r.amount} лей (${escHtml(r.reason)}) — администратор отклонил запрос.`,
      { kind: 'cash' });
    return { ok: true };
  }, { access: 'admin' });

  route('POST', '/api/admin/cash/adjust', async ({ user, body }) => {
    const tg = String(body.tg || '');
    must(/^\d+$/.test(tg), 400, 'Не указан сотрудник');
    const [t] = await db.query("SELECT tg_id, name FROM users WHERE tg_id = $1 AND status = 'active'", [tg]);
    must(t, 404, 'Сотрудник не найден');
    const target = num(body.balance);
    must(Number.isFinite(target) && target >= 0 && target < 1000000, 400, 'Укажите сумму, которая должна быть на руках');
    const reason = str(body.reason, 300);
    must(reason.length >= 3, 400, 'Напишите причину правки');
    const current = await balanceOf(tg);
    const delta = r2(target - current);
    must(Math.abs(delta) >= 0.01, 400, 'Сумма не отличается от текущей');
    const id = uid();
    await db.query('INSERT INTO cash_adjustments (id, tg_id, amount, reason, created_at, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [id, tg, delta, reason, now(), user.name || '']);
    await audit(user, 'Касса: ручная правка', t.name, `${current} → ${target} лей (${delta > 0 ? '+' : ''}${delta}) · ${reason}`);
    if (/^\d+$/.test(tg)) {
      notifyTech(tg, `✏️ Администратор изменил сумму кассы на руках: ${current} → ${target} лей — ${escHtml(reason)}.`, { kind: 'cash' });
    }
    return { ok: true, balance: target };
  }, { access: 'admin' });

  return { balanceOf };
}
