// ====================================================================================================
// «ПЛАН ОБЪЕКТА» (v78): чертёж (фото/скан) и/или нарисованный в приложении план помещения + точки станций.
// План принадлежит объекту (objects.id), у объекта может быть несколько планов (этажи, склад, территория).
// Станция хранит, где она на плане: traps.plan_id, plan_x, plan_y (в единицах плана: ширина всегда 1000).
// Рисунок — JSON-фигуры поверх чертежа (или на чистом листе): rect (помещение), line (стена), door, text.
// ====================================================================================================

const MAX_SHAPES = 600;
const W = 1000; // ширина плана в условных единицах; высота — по пропорциям чертежа или ориентации листа

const num = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n * 10) / 10)) : null;
};

/** Проверка и нормализация фигур рисунка. */
function cleanDrawing(list, h) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list.slice(0, MAX_SHAPES)) {
    if (!s || typeof s !== 'object') continue;
    const X = (v) => num(v, -50, W + 50);
    const Y = (v) => num(v, -50, h + 50);
    if (s.t === 'rect') {
      const r = { t: 'rect', x: X(s.x), y: Y(s.y), w: num(s.w, 2, W + 100), h: num(s.h, 2, h + 100), label: String(s.label || '').slice(0, 40) };
      if ([r.x, r.y, r.w, r.h].every((v) => v != null)) out.push(r);
    } else if (s.t === 'spot') {
      // запланированная станция (без QR): поставят на объекте — привяжется к этой точке
      const sp = { t: 'spot', id: String(s.id || '').slice(0, 24) || Math.random().toString(36).slice(2, 10), x: X(s.x), y: Y(s.y), target: ['rodents', 'crawling', 'flying'].includes(s.target) ? s.target : 'rodents', kind: String(s.kind || '').slice(0, 60), n: Math.max(0, Math.min(9999, Math.floor(Number(s.n)) || 0)) };
      if (sp.x != null && sp.y != null) out.push(sp);
    } else if (s.t === 'line' || s.t === 'door' || s.t === 'gate') {
      const l = { t: s.t, x1: X(s.x1), y1: Y(s.y1), x2: X(s.x2), y2: Y(s.y2) };
      if ([l.x1, l.y1, l.x2, l.y2].every((v) => v != null)) out.push(l);
    } else if (s.t === 'text') {
      const t = { t: 'text', x: X(s.x), y: Y(s.y), s: String(s.s || '').slice(0, 40) };
      if (t.x != null && t.y != null && t.s.trim()) out.push(t);
    }
  }
  return out;
}

// Адрес → ключ для сравнения: без «str./ул./mun.», диакритики и пунктуации — «str. Ismail 33» ≈ «strada Ismail, 33»
const STOP = new Set(['str', 'strada', 'stradela', 'ul', 'ulica', 'улица', 'ул', 'mun', 'municipiul', 'or', 'oras', 'orasul', 'bd', 'bul', 'bulevardul', 'bdul', 'sos', 'soseaua', 'calea', 'aleea', 'piata', 'nr', 'ap', 'apt', 'bl', 'sc', 'et', 'кв', 'дом', 'chisinau', 'кишинев', 'кишинёв', 'moldova', 'republica', 'md', 'sat', 'satul', 'com', 'r', 'rl', 'raionul']);
export function addrKey(a) {
  const t = String(a || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zа-яё0-9/]+/gi, ' ').split(/\s+/).filter(Boolean);
  return t.filter((w) => !STOP.has(w) && !/^md\d+$/.test(w));
}
export function sameAddress(a, b) {
  const x = addrKey(a); const y = addrKey(b);
  if (!x.length || !y.length) return false;
  const nx = x.filter((w) => /\d/.test(w)); const ny = y.filter((w) => /\d/.test(w));
  const wx = x.filter((w) => !/\d/.test(w) && w.length >= 3); const wy = y.filter((w) => !/\d/.test(w) && w.length >= 3);
  const numOk = nx.length && ny.length ? nx[0] === ny[0] : nx.length === ny.length;
  return numOk && wx.some((w) => wy.includes(w));
}

export function initPlans(ctx) {
  const { db, route, must, str, uid, now, audit, signLink, verifyLink, sendText, taskObject } = ctx;
  const isDraft = (id) => /^draft-[\w]{6,40}$/.test(String(id || ''));

  const imgPath = (p) => `/r/plan/${p.id}.jpg?${signLink(`plan:${p.id}:${p.updated_at}`, 30 * 86400)}&v=${encodeURIComponent(p.updated_at)}`;
  const shape = (p) => {
    let drawing = [];
    try { drawing = JSON.parse(p.drawing || '[]'); } catch { /* пустой */ }
    return { id: p.id, object_id: p.object_id, title: p.title, w: Number(p.w) || W, h: Number(p.h) || 750, mscale: p.mscale == null ? 0.8 : Number(p.mscale), image_url: p.image ? imgPath(p) : null, drawing, updated_at: p.updated_at };
  };
  const canEdit = (user) => user.isAdmin || ['tech', 'specialist'].includes(user.role);

  async function objectOf(id) {
    // план, нарисованный заранее, до привязки к клиенту: «черновой объект»
    if (isDraft(id)) return { id: String(id), company_name: 'Новый план', address: '', draft: true };
    const [o] = await db.query('SELECT id, company_name, address FROM objects WHERE id = $1', [str(id, 64)]);
    must(o, 404, 'Объект не найден');
    return o;
  }
  async function planOf(id) {
    const [p] = await db.query('SELECT * FROM object_plans WHERE id = $1', [str(id, 64)]);
    must(p, 404, 'План не найден');
    return p;
  }
  /** Чертёж: JPEG data URL → base64 + размеры (из маркера SOF). */
  function parseImage(dataUrl) {
    const m = String(dataUrl || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
    must(m, 400, 'Нужна картинка JPEG (сфотографируйте чертёж или выберите фото)');
    must(m[1].length < 4_500_000, 400, 'Слишком большая картинка');
    const buf = Buffer.from(m[1], 'base64');
    let i = 2; let iw = 0; let ih = 0;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const mk = buf[i + 1];
      if (mk >= 0xc0 && mk <= 0xc3) { ih = buf.readUInt16BE(i + 5); iw = buf.readUInt16BE(i + 7); break; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    must(iw > 0 && ih > 0, 400, 'Не удалось прочитать картинку');
    return { data: m[1], h: Math.max(200, Math.min(3000, Math.round((W * ih) / iw))) };
  }
  /**
   * Автопривязка: у объекта ещё нет плана, а заранее нарисованный план привязан к «соседнему» объекту того же клиента
   * (или к клиенту с тем же названием) с похожим адресом — переносим план сюда. Так план находит обработку,
   * даже если адрес в заявке записан чуть иначе («str. Ismail 33» / «strada Ismail, 33»).
   */
  async function adoptPlans(objectId) {
    if (isDraft(objectId) || objectId === 'stock') return;
    const [o] = await db.query('SELECT id, company_id, company_name, address FROM objects WHERE id = $1', [objectId]);
    if (!o) return;
    const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[«»"'`,.]/g, ' ').replace(/\s+/g, ' ').trim();
    const cands = await db.query(
      `SELECT DISTINCT o.id, o.company_id, o.company_name, o.address FROM objects o JOIN object_plans p ON p.object_id = o.id WHERE o.id <> $1`, [objectId],
    );
    // физлицо: «Persoană fizică · 069 123 456» — сравниваем по последним 8 цифрам телефона
    const key = (n0) => (/persoan|физлиц/i.test(n0 || '') ? `pf:${String(n0).replace(/\D/g, '').slice(-8)}` : norm(n0));
    const hit = cands.find((c) => (c.company_id === o.company_id || (key(c.company_name) && key(c.company_name) === key(o.company_name))) && sameAddress(c.address, o.address));
    if (!hit) return;
    // станций у того объекта нет (план рисовали заранее) — переносим; если станции есть, это реальный другой объект
    const [{ n }] = await db.query('SELECT COUNT(*) AS n FROM traps WHERE object_id = $1 AND active = 1', [hit.id]);
    if (Number(n) > 0) return;
    await db.query('UPDATE object_plans SET object_id = $1 WHERE object_id = $2', [objectId, hit.id]);
  }

  async function objectPlans(objectId) {
    let plans = await db.query('SELECT * FROM object_plans WHERE object_id = $1 ORDER BY sort, created_at', [objectId]);
    if (!plans.length) { await adoptPlans(objectId); plans = await db.query('SELECT * FROM object_plans WHERE object_id = $1 ORDER BY sort, created_at', [objectId]); }
    const traps = await db.query(
      'SELECT id, code, number, kind, target, location, prepared, plan_id, plan_x, plan_y FROM traps WHERE object_id = $1 AND active = 1 ORDER BY number, created_at', [objectId],
    );
    return {
      plans: plans.map(shape),
      traps: traps.map((t) => ({
        id: t.id, code: t.code, number: Number(t.number), kind: t.kind, target: t.target || '', location: t.location || '', prepared: Number(t.prepared) === 1,
        plan_id: t.plan_id || null, plan_x: t.plan_x == null ? null : Number(t.plan_x), plan_y: t.plan_y == null ? null : Number(t.plan_y),
      })),
    };
  }

  route('GET', '/api/objects/:id/plans', async ({ params }) => {
    const o = await objectOf(params.id);
    return { object: o, ...(await objectPlans(o.id)) };
  });

  // Новый план: с чертежом (image) или чистый лист для рисования (orient: land | port)
  route('POST', '/api/objects/:id/plans', async ({ params, body, user }) => {
    must(canEdit(user), 403, 'Нет доступа');
    const o = await objectOf(params.id);
    const [{ n }] = await db.query('SELECT COUNT(*) AS n FROM object_plans WHERE object_id = $1', [o.id]);
    must(Number(n) < 12, 400, 'У объекта уже 12 планов');
    let image = null; let h = body.orient === 'port' ? 1333 : 750;
    if (body.image) { const im = parseImage(body.image); image = im.data; h = im.h; }
    const id = uid();
    const t = now();
    await db.query(
      'INSERT INTO object_plans (id, object_id, title, image, drawing, w, h, sort, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)',
      [id, o.id, str(body.title, 60) || (Number(n) ? `План ${Number(n) + 1}` : 'План'), image, '[]', W, h, Number(n), user.name || String(user.id), t],
    );
    await audit(user, 'План объекта добавлен', `${o.company_name} · ${o.address}`, image ? 'чертёж' : 'рисунок');
    return { plan: shape(await planOf(id)), ...(await objectPlans(o.id)) };
  });

  route('PUT', '/api/plans/:id', async ({ params, body, user }) => {
    must(canEdit(user), 403, 'Нет доступа');
    const p = await planOf(params.id);
    const title = body.title !== undefined ? (str(body.title, 60) || p.title) : p.title;
    let image = p.image; let h = Number(p.h);
    if (body.image === null) image = null;
    else if (body.image) { const im = parseImage(body.image); image = im.data; h = im.h; }
    const drawing = body.drawing !== undefined ? JSON.stringify(cleanDrawing(body.drawing, h)) : p.drawing;
    const mscale = body.mscale !== undefined ? Math.max(0.3, Math.min(2, Number(body.mscale) || 0.8)) : (p.mscale == null ? 0.8 : Number(p.mscale));
    const onlyScale = body.mscale !== undefined && body.title === undefined && body.image === undefined && body.drawing === undefined;
    await db.query('UPDATE object_plans SET title = $1, image = $2, h = $3, drawing = $4, updated_at = $5, mscale = $6 WHERE id = $7', [title, image, h, drawing, onlyScale ? p.updated_at : now(), mscale, p.id]);
    return { plan: shape(await planOf(p.id)) };
  });

  route('DELETE', '/api/plans/:id', async ({ params, user }) => {
    must(canEdit(user), 403, 'Нет доступа');
    const p = await planOf(params.id);
    await db.query('UPDATE traps SET plan_id = NULL, plan_x = NULL, plan_y = NULL WHERE plan_id = $1', [p.id]);
    await db.query('DELETE FROM object_plans WHERE id = $1', [p.id]);
    await audit(user, 'План объекта удалён', p.title, '');
    return objectPlans(p.object_id);
  });

  // Станция на плане: { plan_id, x, y } — поставить/передвинуть; { plan_id, spot } — на запланированную точку
  // (точка убирается, станция получает её номер, если он свободен); { plan_id: null } — убрать с плана
  route('PUT', '/api/traps/:id/place', async ({ params, body, user }) => {
    must(canEdit(user), 403, 'Нет доступа');
    const [t] = await db.query('SELECT id, object_id FROM traps WHERE id = $1', [str(params.id, 64)]);
    must(t, 404, 'Станция не найдена');
    if (!body.plan_id) {
      await db.query('UPDATE traps SET plan_id = NULL, plan_x = NULL, plan_y = NULL WHERE id = $1', [t.id]);
    } else {
      const p = await planOf(body.plan_id);
      must(p.object_id === t.object_id, 400, 'Станция с другого объекта');
      let x = num(body.x, 0, W); let y = num(body.y, 0, Number(p.h));
      if (body.spot) {
        let drawing = [];
        try { drawing = JSON.parse(p.drawing || '[]'); } catch { /* пусто */ }
        const sp = drawing.find((d) => d.t === 'spot' && d.id === String(body.spot));
        must(sp, 404, 'Точка уже занята — обновите план');
        x = sp.x; y = sp.y;
        await db.query('UPDATE object_plans SET drawing = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(drawing.filter((d) => d !== sp)), now(), p.id]);
        if (sp.n > 0) {
          const [busy] = await db.query('SELECT id FROM traps WHERE object_id = $1 AND active = 1 AND number = $2 AND id <> $3', [t.object_id, sp.n, t.id]);
          if (!busy) await db.query('UPDATE traps SET number = $1 WHERE id = $2', [sp.n, t.id]);
        }
      }
      must(x != null && y != null, 400, 'Некорректная точка');
      await db.query('UPDATE traps SET plan_id = $1, plan_x = $2, plan_y = $3 WHERE id = $4', [p.id, x, y, t.id]);
    }
    return objectPlans(t.object_id);
  });

  // Черновые планы (нарисованы заранее, ещё не привязаны к клиенту)
  route('GET', '/api/plans/drafts', async ({ user }) => {
    must(canEdit(user), 403, 'Нет доступа');
    const rows = await db.query("SELECT object_id, MIN(created_at) AS created_at, MAX(updated_at) AS updated_at, COUNT(*) AS n, MAX(created_by) AS created_by FROM object_plans WHERE object_id LIKE 'draft-%' GROUP BY object_id ORDER BY MAX(updated_at) DESC LIMIT 20");
    return { items: rows.map((x) => ({ id: x.object_id, plans: Number(x.n), created_at: x.created_at, updated_at: x.updated_at, created_by: x.created_by })) };
  });
  // Привязать черновик к клиенту: юрлицо (название) или физлицо (телефон) + фактический адрес объекта
  route('POST', '/api/plans/attach', async ({ body, user }) => {
    must(canEdit(user), 403, 'Нет доступа');
    const draft = String(body.draft || '');
    must(isDraft(draft), 400, 'Нет черновика');
    const [{ n }] = await db.query('SELECT COUNT(*) AS n FROM object_plans WHERE object_id = $1', [draft]);
    must(Number(n) > 0, 400, 'Сначала нарисуйте план');
    const person = body.kind === 'person';
    const company = person ? '' : str(body.company, 120);
    const phone = str(body.phone, 30);
    const address = str(body.address, 200);
    must(person || company.length >= 2, 400, 'Укажите название юрлица');
    must(!person || phone.replace(/\D/g, '').length >= 6, 400, 'Укажите телефон клиента — по нему план найдёт обработку');
    must(address.length >= 3, 400, 'Укажите фактический адрес объекта');
    const o = await taskObject({ id: `plan-${draft}`, company_name: company, phone }, address);
    await db.query('UPDATE object_plans SET object_id = $1 WHERE object_id = $2', [o.id, draft]);
    await audit(user, 'План объекта привязан', `${o.company_name} · ${o.address}`, `${n} план(а)`);
    return { object: { id: o.id, company_name: o.company_name, address: o.address } };
  });

  /** Свободные запланированные точки объекта (для подсказки при установке). */
  async function freeSpots(objectId) {
    const rows = await db.query('SELECT drawing FROM object_plans WHERE object_id = $1', [objectId]);
    let n = 0;
    for (const r0 of rows) { try { n += JSON.parse(r0.drawing || '[]').filter((d) => d.t === 'spot').length; } catch { /* */ } }
    return n;
  }

  /** Картинка чертежа по подписанной ссылке. */
  async function handleRaw(url, res) {
    const m = url.pathname.match(/^\/r\/plan\/([\w-]+)\.jpg$/);
    if (!m) return false;
    const [p] = await db.query('SELECT id, image, updated_at FROM object_plans WHERE id = $1', [m[1]]);
    if (!p || !p.image) return sendText(res, 404, 'Нет чертежа');
    if (!verifyLink(`plan:${p.id}:${p.updated_at}`, url.searchParams.get('exp'), url.searchParams.get('sig'))) return sendText(res, 403, 'Ссылка недействительна');
    const buf = Buffer.from(p.image, 'base64');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=604800' });
    res.end(buf);
    return true;
  }

  return { handleRaw, objectPlans, freeSpots, adoptPlans };
}
