import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDb } from './db.js';
import { authenticate, makeAppToken, signLink, verifyLink } from './auth.js';
import {
  amoEnabled, searchCompanies, getCompany, addCompanyNote,
  leadsEnabled, listLeads, getLead, moveLead, addLeadNote, setupInfo,
} from './amo.js';
import {
  PROCEDURES, TRAP_KINDS, PESTS, STATUSES, STATUS_IDS, statusLabel,
  newTrapCode, parseTrapCode, qrPayload,
  ASSESS_PROCEDURES, INFESTATION, PREPARATION, OBS_CATEGORIES, labelOf,
  STATION_TARGETS, RODENTICIDE, CONDITIONS, BAIT_LEVELS, POINT_CATS, POINT_ZONES, DEFAULT_POINTS,
} from './config.js';
import { journalPdf } from './journal.js';
import { initSales } from './sales.js';
import { initCar } from './car.js';
import { initCrm } from './crm.js';
import { initCash } from './cash.js';
import { PREMISES, REENTRY, reentryDefault } from './premises.js';
import { reverseGeocode, forwardGeocode } from './geo.js';
import { qrSvg } from './qr.js';
import { resolveUser, shape as shapeUser, adminIds, ALL_PERMS, parsePerms, hashPin, verifyPin, checkSession, issueSession } from './users.js';
import { sendDocument, getMe, getWebhookInfo, getChatMember, sendMedia, editCaption, fileUrl, tgCall } from './tgbot.js';
import { visitPdf } from './reportpdf.js';
import { actRoPdf, actNumber } from './actro.js';
import { DEFAULT_COMPANY, buildRecommendationsRo, localityFromAddress } from './ro.js';
import { looksLikeTask, parseTask, TASK_TEMPLATE, zonedIso } from './tasks.js';
import { editMessage, answerCallback, deleteMessage } from './tgbot.js';
import { storageOn, uploadMaxBytes, objectKey, headObject, getObject, deleteObject, objectUrl, presign } from './storage.js';
import { buildRecommendations, PESTS_BY_PROCEDURE } from './recs.js';
import { botEnabled, sendMessage, sendPhotos, discoverChats, escHtml, setWebhook, webhookSecret, chatTitle } from './tgbot.js';
import { visitReportHtml, labelsHtml } from './pages.js';
import { importClients, searchLocalClients, getLocalClient, createClient } from './clients.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(__dirname, '../../web/dist');
const PORT = Number(process.env.PORT) || 3000;

const db = await createDb();
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const must = (cond, status, msg) => { if (!cond) throw new HttpError(status, msg); };
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);

const fmtRu = (iso) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: process.env.TZ_DISPLAY || 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';

// ---------- настройки (хранятся в БД) ----------
async function getSetting(key) {
  const [r] = await db.query('SELECT value FROM settings WHERE key = $1', [key]);
  return r ? JSON.parse(r.value) : null;
}
async function setSetting(key, value) {
  await db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, JSON.stringify(value)]);
}
// ---------- журнал действий ----------
async function audit(actor, action, target = '', details = '') {
  try {
    await db.query('INSERT INTO audit (id, at, actor_id, actor_name, action, target, details) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [uid(), now(), actor?.id || 'system', actor?.name || 'Система', action, String(target).slice(0, 300), String(details).slice(0, 1000)]);
  } catch (e) {
    console.error('audit:', e.message);
  }
}
// ---------- уведомления (панель техника, обнуляется каждый месяц) ----------
const TZN = process.env.TZ_DISPLAY || 'Europe/Chisinau';
function monthStartIso(date = new Date()) {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: TZN, year: 'numeric', month: '2-digit' }).format(date).split('-').map(Number);
  return zonedIso(y, m, 1, 0, 0, TZN);
}
async function addNotification(tgId, kind, text, { visit_id = null, task_id = null, author } = {}) {
  await db.query(
    'INSERT INTO notifications (id, tg_id, kind, text, visit_id, task_id, author_id, author_name, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [uid(), String(tgId), kind, String(text).slice(0, 2000), visit_id, task_id, author?.id || '', author?.name || '', now()],
  );
}

/** Замечание офиса технику: в панель уведомлений, в личку, в журнал. */
// Типы замечаний и сколько баллов снимается (редактируются: Админка → Замечания → «Типы замечаний»)
const DEFAULT_REMARK_TYPES = [
  { id: 'look', label: 'Неопрятный вид', points: 1 },
  { id: 'car', label: 'Машина: грязная / неисправна', points: 1 },
  { id: 'late', label: 'Опоздание к клиенту', points: 1 },
  { id: 'rude', label: 'Некорректное общение с клиентом', points: 2 },
  { id: 'complaint', label: 'Жалоба клиента', points: 2 },
  { id: 'safety', label: 'Нарушение техники безопасности', points: 2 },
  { id: 'act', label: 'Ошибки в акте / не заполнен', points: 0.5 },
  { id: 'other', label: 'Другое', points: 1 },
];
async function remarkTypes() {
  const saved = await getSetting('remark_types');
  return Array.isArray(saved) && saved.length ? saved : DEFAULT_REMARK_TYPES;
}

async function createRemark({ techId, text, visitId = null, author, type = '' }) {
  const [u] = await db.query('SELECT tg_id, name FROM users WHERE tg_id = $1', [techId]);
  if (!u) throw new HttpError(404, 'Сотрудник не найден');
  let ref = '';
  if (visitId) {
    const [v] = await db.query('SELECT id, act_seq, company_name, finished_at, started_at FROM visits WHERE id = $1', [visitId]);
    if (v) ref = `Акт № ${actNumber(v)} · ${v.company_name}`;
  }
  const rt = type ? (await remarkTypes()).find((x) => x.id === type) : null;
  const penalty = rt ? Number(rt.points) || 0 : 0;
  const body = [rt ? rt.label : '', String(text || '').trim()].filter(Boolean).join(': ').slice(0, 1500);
  await addNotification(u.tg_id, 'remark', ref ? `${body}\n${ref}` : body, { visit_id: visitId, author });
  const [n] = await db.query("SELECT id FROM notifications WHERE tg_id = $1 AND kind = 'remark' ORDER BY created_at DESC LIMIT 1", [u.tg_id]);
  // штраф в KPI сразу — в баллы текущего месяца
  let adjustId = null;
  if (penalty > 0) {
    adjustId = uid();
    await db.query("INSERT INTO kpi_adjust (id, month, tg_id, rule, points, reason, status, created_at, decided_at, decided_by) VALUES ($1,$2,$3,$4,$5,$6,'applied',$7,$7,$8)",
      [adjustId, curMonth(), u.tg_id, `remark:${rt.id}`, -penalty, `Замечание: ${body}`.slice(0, 200), now(), author?.name || '']);
  }
  if (n) await db.query('UPDATE notifications SET remark_type = $1, remark_points = $2, adjust_id = $3 WHERE id = $4', [rt?.id || '', penalty || null, adjustId, n.id]);
  await audit(author, 'Замечание технику', u.name, `${ref ? `${ref}: ` : ''}${body}${penalty ? ` · −${penalty} б` : ''}`.slice(0, 900));
  if (botEnabled && /^\d+$/.test(u.tg_id)) {
    const base = publicBase();
    sendMessage(u.tg_id, `⚠️ <b>Замечание от офиса</b>${penalty ? ` · <b>−${String(penalty).replace('.', ',')} балл.</b>` : ''}\n${escHtml(body)}${ref ? `\n\n📄 ${escHtml(ref)}` : ''}\n— ${escHtml(author?.name || 'Офис')}`,
      base ? { replyMarkup: { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: base } }]] } } : {}).catch((e) => console.error('remark dm:', e.message));
  }
  return u;
}

/**
 * Сотрудник не запустил бота (или заблокировал) — Telegram не даёт ему писать.
 * Отмечаем это и не чаще раза в 12 часов предупреждаем ответственных (администраторов + extra).
 */
const BOT_DEAD_RE = /forbidden|chat not found|bot was blocked|user is deactivated|bot can't initiate/i;
async function botSendFailed(tgId, err, { extra = [], about = '' } = {}) {
  if (!err || !BOT_DEAD_RE.test(String(err.message || err)) || !/^\d+$/.test(String(tgId))) return false;
  const [u] = await db.query('SELECT tg_id, name, bot_warned_at FROM users WHERE tg_id = $1', [String(tgId)]);
  if (!u) return false;
  await db.query('UPDATE users SET bot_blocked_at = COALESCE(bot_blocked_at, $1) WHERE tg_id = $2', [now(), u.tg_id]);
  if (u.bot_warned_at && Date.now() - new Date(u.bot_warned_at).getTime() < 12 * 3600000) return true;
  await db.query('UPDATE users SET bot_warned_at = $1 WHERE tg_id = $2', [now(), u.tg_id]);
  const html = `🤖 <b>${escHtml(u.name)} не запустил бота</b> — уведомления и напоминания до него не доходят${about ? ` (${escHtml(about)})` : ''}.\nПопросите открыть бота в Telegram и нажать «Старт» (Start).`;
  const to = new Set([...(await adminIds(db)), ...extra.filter((x) => x && /^\d+$/.test(String(x)))].map(String));
  to.delete(u.tg_id);
  for (const id of to) {
    addNotification(id, 'info', html.replace(/<[^>]+>/g, ''), {}).catch(() => {});
    if (botEnabled) sendMessage(id, html).catch(() => {});
  }
  return true;
}

const notifyAdmins = async (html) => {
  if (!botEnabled) return;
  for (const id of await adminIds(db)) sendMessage(id, html).catch((e) => console.error(e.message));
};
let botUsername = process.env.BOT_USERNAME || '';

const publicBase = () => (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '');
let webhookActive = false;

async function rememberChat(c) {
  await db.query(
    'INSERT INTO tg_chats (id, title, type, updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, type = EXCLUDED.type, updated_at = EXCLUDED.updated_at',
    [String(c.id), chatTitle(c), c.type, now()],
  );
}

async function companySettings() {
  return { ...DEFAULT_COMPANY, ...((await getSetting('company')) || {}) };
}
async function productLists() {
  return (await getSetting('products')) || { 'Дезинсекция': [], 'Дератизация': [], 'Дезинфекция': [] };
}
async function actTemplate() {
  return process.env.ACT_TEMPLATE || (await getSetting('act_template')) || 'ro';
}

async function officeChat() {
  return (await getSetting('office_chat')) || (process.env.OFFICE_CHAT_ID ? { id: process.env.OFFICE_CHAT_ID, title: 'Чат офиса' } : null);
}

// Источник юрлиц: amoCRM, если подключена, иначе своя база (импорт из Excel)
const findCompanies = (q) => (amoEnabled ? searchCompanies(q) : searchLocalClients(db, q));
const findCompany = (id) => (amoEnabled ? getCompany(id) : getLocalClient(db, id));

function baseUrl(req) {
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host}`;
}

// ---------- доступ к данным ----------

async function getVisit(id) {
  const [v] = await db.query('SELECT * FROM visits WHERE id = $1', [id]);
  must(v, 404, 'Выезд не найден');
  return v;
}

async function getVisitFor(id, user) {
  const v = await getVisit(id);
  must(user.isAdmin || v.tech_tg_id === user.id, 403, 'Это выезд другого специалиста');
  return v;
}

/** Выезд, с которым можно работать: выезд без заявки техника должен быть подтверждён администратором. */
async function getWorkVisit(id, user) {
  const v = await getVisitFor(id, user);
  must(v.approval !== 'pending', 423, 'Выезд ждёт подтверждения администратора');
  must(v.approval !== 'rejected', 423, 'Администратор отклонил этот выезд');
  return v;
}

const photoPath = (id) => `/r/photo/${id}?${signLink(`photo:${id}`)}`;

async function loadObservations(visitId) {
  const obs = await db.query('SELECT * FROM observations WHERE visit_id = $1 ORDER BY created_at', [visitId]);
  const photos = await db.query('SELECT id, observation_id FROM photos WHERE visit_id = $1 ORDER BY created_at', [visitId]);
  return obs.map((o) => ({
    id: o.id, category: o.category, comment: o.comment, created_at: o.created_at,
    photos: photos.filter((p) => p.observation_id === o.id).map((p) => ({ id: p.id, url: photoPath(p.id) })),
  }));
}

async function visitRows(visit) {
  return db.query(
    `SELECT t.id, t.code, t.number, t.kind, t.location, t.target,
            i.status, i.pest, i.count, i.bait_replaced, i.comment, i.created_at AS checked_at, i.condition, i.bait_eaten
       FROM traps t
       LEFT JOIN inspections i ON i.trap_id = t.id AND i.visit_id = $1
      WHERE t.object_id = $2 AND t.active = 1
      ORDER BY t.number, t.created_at`,
    [visit.id, visit.object_id],
  );
}

async function nextTrapNumber(objectId) {
  const [r] = await db.query('SELECT MAX(number) AS m FROM traps WHERE object_id = $1', [objectId]);
  return (Number(r?.m) || 0) + 1;
}

const isIndividual = (name) => /^(persoan[ăa] fizic|физлицо|частное лицо)/i.test(String(name || '').trim());

/** История станций объекта для электронного журнала: последние N завершённых выездов (+ текущий). */
async function stationHistory(v, limit = 6) {
  const visits = await db.query(
    `SELECT id, finished_at, started_at FROM visits WHERE object_id = $1 AND (status = 'done' OR id = $2)
     ORDER BY COALESCE(finished_at, started_at) DESC LIMIT ${limit}`, [v.object_id, v.id],
  );
  visits.reverse();
  const ids = visits.map((x) => x.id);
  const insp = ids.length
    ? await db.query(`SELECT visit_id, trap_id, status, condition, bait_eaten, count, pest FROM inspections WHERE visit_id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`, ids)
    : [];
  const cells = {};
  for (const i of insp) (cells[i.trap_id] ||= {})[i.visit_id] = i;
  return { visits: visits.map((x) => ({ id: x.id, date: x.finished_at || x.started_at })), cells };
}

async function journalData(v) {
  v = await ensureActSeq(v);
  return { visit: v, rows: await visitRows(v), history: await stationHistory(v), company: await companySettings() };
}

function shapeRow(r) {
  return {
    id: r.id, code: r.code, number: Number(r.number), kind: r.kind, location: r.location, target: r.target || '',
    inspection: r.status
      ? {
        status: r.status, pest: r.pest, count: Number(r.count), bait_replaced: Boolean(Number(r.bait_replaced)), comment: r.comment, checked_at: r.checked_at,
        condition: r.condition || '', bait_eaten: r.bait_eaten || '',
      }
      : null,
  };
}

function reportPath(visitId) {
  return `/r/visit/${visitId}.pdf?${signLink(`visit:${visitId}`)}`;
}

const BRAND = process.env.COMPANY_NAME || '';
const visitPests = (v) => { try { return JSON.parse(v.pests || '[]'); } catch { return []; } };
const visitPremises = (v) => { try { return JSON.parse(v.premises || '[]'); } catch { return []; } };
const visitReentry = (v) => (v.procedure === 'Дератизация' ? '' : v.reentry || reentryDefault(v.procedure, visitPests(v)));
const recArgs = (v) => ({ procedure: v.procedure, pests: visitPests(v), infestation: v.infestation, preparation: v.preparation, premises: visitPremises(v), reentry: visitReentry(v) });
const visitRecs = (v) => buildRecommendations(recArgs(v));

const visitProducts = (v) => { try { return JSON.parse(v.products || '[]'); } catch { return []; } };

/** Сквозной номер акта присваивается при первом завершении. */
async function ensureActSeq(v) {
  if (v.act_seq) return v;
  const [r] = await db.query('SELECT MAX(act_seq) AS m FROM visits');
  const seq = (Number(r?.m) || 0) + 1;
  await db.query('UPDATE visits SET act_seq = $1 WHERE id = $2 AND act_seq IS NULL', [seq, v.id]);
  return { ...v, act_seq: seq };
}

const visitDocs = (v) => { try { const d = JSON.parse(v.docs || ''); return { proces: d.proces !== false, anexa: d.anexa !== false, obs: d.obs !== false, traps: d.traps !== false }; } catch { return { proces: true, anexa: true, obs: true, traps: true }; } };
const b64buf = (s) => { const m = String(s || '').match(/^data:image\/jpeg;base64,(.+)$/); return m ? Buffer.from(m[1], 'base64') : null; };
async function stampImage() {
  const custom = await getSetting('stamp');
  if (custom === false) return null; // печать отключена
  return custom ? b64buf(custom) : undefined; // undefined → печать по умолчанию (server/assets/stamp.jpg)
}

async function buildVisitPdf(v, parts = { proces: true, anexa: true }) {
  if ((await actTemplate()) === 'ro') {
    v = await ensureActSeq(v);
    const rows = await visitRows(v);
    const obs = await db.query('SELECT * FROM observations WHERE visit_id = $1 ORDER BY created_at', [v.id]);
    const observations = [];
    for (const o of obs) {
      const ph = await db.query("SELECT data FROM photos WHERE observation_id = $1 AND mime = 'image/jpeg' ORDER BY created_at", [o.id]);
      observations.push({ ...o, photos: ph.map((p) => Buffer.from(p.data, 'base64')) });
    }
    const [client] = await db.query('SELECT inn, legal_address FROM clients WHERE id = $1', [v.company_id]);
    const pests = visitPests(v);
    const journal = Number(v.monitoring) === 1 && rows.length ? await stationHistory(v) : null;
    const stamp = await stampImage();
    return actRoPdf({
      visit: Number(v.quick) === 1 ? { ...v, reentry: visitReentry(v) } : v, client: client || {}, company: await companySettings(), products: visitProducts(v), rows, observations, pests, journal,
      parts, clientSign: b64buf(v.client_signature), ...(stamp !== undefined ? { stamp } : {}), quick: Number(v.quick) === 1,
      recs: buildRecommendationsRo(recArgs(v)),
    });
  }
  const rows = await visitRows(v);
  const obs = await db.query('SELECT * FROM observations WHERE visit_id = $1 ORDER BY created_at', [v.id]);
  const observations = [];
  for (const o of obs) {
    const ph = await db.query("SELECT data FROM photos WHERE observation_id = $1 AND mime = 'image/jpeg' ORDER BY created_at", [o.id]);
    observations.push({ ...o, photos: ph.map((p) => Buffer.from(p.data, 'base64')) });
  }
  return visitPdf({
    visit: v, rows, observations,
    assessment: { infestation: labelOf(INFESTATION, v.infestation), preparation: labelOf(PREPARATION, v.preparation) },
    pests: visitPests(v), recs: visitRecs(v), brand: BRAND,
  });
}

const pdfName = (v) => {
  const d = new Date(v.finished_at || v.started_at);
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const company = v.company_name.replace(/[^\p{L}\p{N} .-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return `${Number(v.quick) === 1 ? "Act" : "Proces-verbal"} nr ${actNumber(v)} din ${date} ${company}.pdf`;
};

// ---------- API ----------

const routes = [];
// access: 'public' — без входа; 'any' — любой вошедший (в т.ч. ожидающий подтверждения);
//         'active' — подтверждённый сотрудник (по умолчанию); 'admin' — администратор.
// pin: false — маршрут доступен без ввода PIN-кода (вход, установка PIN).
const route = (method, pattern, handler, { access = 'active', auth, pin = true, raw = false } = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler, access: auth === false ? 'public' : access, pin, raw });
};

/** Версия собранного фронтенда: открытое приложение сравнивает её и перезагружается после деплоя. */
let webBuildId = null;
function webBuild() {
  if (webBuildId === null) {
    try { webBuildId = crypto.createHash('sha1').update(fs.readFileSync(path.join(WEB_DIST, 'index.html'))).digest('hex').slice(0, 12); }
    catch { webBuildId = ''; }
  }
  return webBuildId;
}
route('GET', '/api/health', async () => ({ ok: true, db: db.kind, amo: amoEnabled, build: webBuild(), uptime_min: Math.round(process.uptime() / 60), keep_alive: keepAlive }), { auth: false });

// ---------- вход в отдельное приложение (APK / браузер) через подтверждение в Telegram-боте ----------
// 1) приложение: POST /api/app/login → код и ссылка t.me/<бот>?start=applogin_<код>
// 2) сотрудник открывает бота и нажимает «Войти» (только по его запросу; без нажатия вход не выполняется)
// 3) приложение опрашивает GET /api/app/login/<код> и получает токен; дальше — PIN, как обычно.
const APP_LOGIN_TTL = 10 * 60000;
route('POST', '/api/app/login', async ({ body }) => {
  must(botEnabled && botUsername, 400, 'Бот не настроен — вход через Telegram недоступен');
  const code = crypto.randomBytes(12).toString('base64url');
  await db.query('INSERT INTO app_logins (code, device, created_at) VALUES ($1,$2,$3)', [code, str(body.device, 120), now()]);
  await db.query('DELETE FROM app_logins WHERE created_at < $1', [new Date(Date.now() - 24 * 3600000).toISOString()]);
  return { code, link: `https://t.me/${botUsername}?start=applogin_${code}`, tg_link: `tg://resolve?domain=${botUsername}&start=applogin_${code}`, expires_in: APP_LOGIN_TTL / 1000 };
}, { auth: false });
route('GET', '/api/app/login/:code', async ({ params }) => {
  const [l] = await db.query('SELECT * FROM app_logins WHERE code = $1', [params.code]);
  if (!l || Date.now() - new Date(l.created_at).getTime() > APP_LOGIN_TTL) return { status: 'expired' };
  if (l.status === 'denied') return { status: 'denied' };
  if (l.status === 'used') return { status: 'expired' };
  if (l.status !== 'approved') return { status: 'pending' };
  const [u] = await db.query('SELECT tg_id, app_ver FROM users WHERE tg_id = $1', [l.tg_id]);
  if (!u) return { status: 'denied' };
  await db.query("UPDATE app_logins SET status = 'used' WHERE code = $1", [l.code]);
  return { status: 'ok', token: makeAppToken(u.tg_id, Number(u.app_ver) || 0) };
}, { auth: false });
/** Выйти из приложения на всех устройствах (токены прежней версии перестают работать). */
route('POST', '/api/app/logout-all', async ({ user }) => {
  await db.query('UPDATE users SET app_ver = app_ver + 1 WHERE tg_id = $1', [user.id]);
  return { ok: true };
}, { access: 'any' });
async function handleAppLoginStart(chatId, from, code) {
  const [l] = await db.query('SELECT * FROM app_logins WHERE code = $1', [code]);
  if (!l || l.status !== 'pending' || Date.now() - new Date(l.created_at).getTime() > APP_LOGIN_TTL) {
    await sendMessage(chatId, '⌛️ Запрос на вход устарел. Нажмите «Войти через Telegram» в приложении ещё раз.');
    return;
  }
  const [u] = await db.query('SELECT name, status FROM users WHERE tg_id = $1', [String(from.id)]);
  if (!u || u.status !== 'active') {
    await sendMessage(chatId, '⛔️ Вы ещё не сотрудник в приложении. Сначала откройте приложение в Telegram (кнопка меню) и дождитесь подтверждения администратора.');
    return;
  }
  await sendMessage(chatId, `🔐 <b>Вход в приложение InsectProtect</b>${l.device ? `\nУстройство: ${escHtml(l.device)}` : ''}\n\nЭто вы входите? Если нет — нажмите «Это не я».`,
    { replyMarkup: { inline_keyboard: [[{ text: '✅ Войти', callback_data: `alok:${code}` }, { text: '🚫 Это не я', callback_data: `alno:${code}` }]] } });
}

route('GET', '/api/bootstrap', async ({ user, row, session }) => {
  if (user.status !== 'active') return { user };
  if (!session) return { user, pin: { set: Boolean(row.pin_hash), locked_until: row.pin_locked_until || null } };
  const count = async (sql) => Number((await db.query(sql))[0].n);
  return {
    user,
    isAdmin: user.isAdmin,
    clients: amoEnabled ? null : await count('SELECT COUNT(*) AS n FROM clients'),
    pendingUsers: user.isAdmin ? await count("SELECT COUNT(*) AS n FROM users WHERE status = 'pending'") : 0,
    unread: Number((await db.query('SELECT COUNT(*) AS n FROM notifications WHERE tg_id = $1 AND read_at IS NULL AND created_at >= $2', [user.id, monthStartIso()]))[0].n),
    office: user.isAdmin ? await officeChat() : null,
    amo: amoEnabled,
    bot: botUsername,
    leads: leadsEnabled,
    procedures: PROCEDURES,
    assessProcedures: ASSESS_PROCEDURES,
    pestsByProcedure: PESTS_BY_PROCEDURE,
    products: await productLists(),
    actTemplate: await actTemplate(),
    taskApproval: user.isAdmin ? await taskApprovalOn() : undefined,
    company: user.isAdmin ? await companySettings() : null,
    infestation: INFESTATION,
    preparation: PREPARATION,
    obsCategories: OBS_CATEGORIES,
    trapKinds: TRAP_KINDS,
    stationTargets: STATION_TARGETS,
    pointCats: pointCatsPublic(await pointsConfig()),
    pointZones: POINT_ZONES,
    pestMult: (await pointsConfig()).pest_mult,
    pointExtras: (await pointsConfig()).extras,
    features: await features(),
    crowns: await crownHolders(),
    uploadMaxMb: Math.round(uploadMaxBytes() / 1024 / 1024), storage: storageOn(),
    multCfg: await (async () => { const pc = await pointsConfig(); return { weekday: pc.weekday, special: pc.special, windows: pc.windows }; })(),
    premises: PREMISES.map((p) => ({ id: p.id, label: p.label })),
    reentryOptions: REENTRY.map((r) => ({ id: r.id, label: r.label })),
    prefs: await userPrefs(user.id),
    conditions: CONDITIONS,
    baitLevels: BAIT_LEVELS,
    rodenticide: RODENTICIDE,
    pests: PESTS,
    statuses: STATUSES,
  };
}, { access: 'any', pin: false });

// Ошибки из приложения (белый экран и т.п.): в логи Render и в журнал действий; одинаковые — не чаще раза в 10 минут
const clientErrSeen = new Map();
route('POST', '/api/client-error', async ({ body, user }) => {
  const message = str(body.message, 500) || 'Неизвестная ошибка';
  const key = `${user.id}|${message}`;
  const last = clientErrSeen.get(key) || 0;
  if (Date.now() - last < 600000) return { ok: true, skipped: true };
  clientErrSeen.set(key, Date.now());
  if (clientErrSeen.size > 500) clientErrSeen.clear();
  const stack = str(body.stack, 2000);
  console.error(`[client-error] ${user.name} (${user.id}) ${str(body.where, 20)}: ${message}\n${stack}\n${str(body.ua, 200)} ${str(body.url, 200)}`);
  await audit(user, 'Ошибка в приложении', message, `${str(body.where, 20)} · ${str(body.ua, 160)}\n${stack.split('\n').slice(0, 6).join('\n')}`);
  return { ok: true };
}, { access: 'any', pin: false });

// ---------- PIN-код ----------

route('POST', '/api/pin/set', async ({ body, user, row, session }) => {
  const pin = str(body.pin, 10);
  must(/^\d{4}$/.test(pin), 400, 'PIN — 4 цифры');
  must(!row.pin_hash || session, 403, 'Сначала введите текущий PIN');
  const pinHash = hashPin(pin);
  await db.query('UPDATE users SET pin_hash = $1, pin_fails = 0, pin_locked_until = NULL WHERE tg_id = $2', [pinHash, user.id]);
  await audit(user, row.pin_hash ? 'PIN изменён' : 'PIN установлен');
  return { token: issueSession({ ...row, pin_hash: pinHash }) };
}, { pin: false });

route('POST', '/api/pin/verify', async ({ body, row }) => {
  must(row.pin_hash, 400, 'PIN ещё не установлен');
  const r = await verifyPin(db, row, str(body.pin, 10));
  if (!r.ok) throw Object.assign(new HttpError(403, r.error), { extra: { code: 'pin_wrong', locked_until: r.locked_until || null } });
  return { token: r.token };
}, { pin: false });

// ---------- аккаунты ----------

// Новый сотрудник отправляет заявку на доступ (ФИО и телефон)
route('POST', '/api/me/request', async ({ body, user }) => {
  must(user.status === 'pending', 400, 'Заявка уже рассмотрена');
  const name = str(body.name, 120);
  must(name.length >= 3, 400, 'Укажите фамилию и имя');
  const phone = str(body.phone, 30);
  await db.query('UPDATE users SET name = $1, phone = $2 WHERE tg_id = $3', [name, phone, user.id]);
  if (botEnabled) {
    const text = `👤 <b>Заявка на доступ</b>\n${escHtml(name)}${phone ? `\n📞 ${escHtml(phone)}` : ''}${user.username ? `\n@${escHtml(user.username)}` : ''}\n\nОткройте приложение → «Сотрудники», чтобы подтвердить.`;
    for (const id of await adminIds(db)) sendMessage(id, text).catch((e) => console.error(e.message));
  }
  return { ok: true };
}, { access: 'any', pin: false });

route('GET', '/api/admin/users', async () => {
  const rows = await db.query('SELECT * FROM users ORDER BY created_at');
  const stats = await db.query("SELECT tech_tg_id, COUNT(*) AS n, MAX(started_at) AS last FROM visits GROUP BY tech_tg_id");
  const map = Object.fromEntries(stats.map((r) => [r.tech_tg_id, r]));
  return { items: rows.map((r) => ({ ...shapeUser(r), visits: Number(map[r.tg_id]?.n || 0), last_visit: map[r.tg_id]?.last || null })) };
}, { access: 'admin' });

route('PATCH', '/api/admin/users/:id', async ({ params, body, user }) => {
  const [u] = await db.query('SELECT * FROM users WHERE tg_id = $1', [params.id]);
  must(u, 404, 'Сотрудник не найден');
  const status = body.status !== undefined ? str(body.status, 20) : u.status;
  const role = body.role !== undefined ? str(body.role, 20) : u.role;
  const name = body.name !== undefined ? str(body.name, 120) : u.name;
  must(['active', 'blocked', 'pending'].includes(status), 400, 'Неизвестный статус');
  must(['admin', 'manager', 'tech', 'specialist'].includes(role), 400, 'Неизвестная роль');
  must(name.length >= 2, 400, 'Укажите имя');
  if (u.tg_id === user.id) must(status === 'active' && role === u.role, 400, 'Нельзя снять права или заблокировать самого себя');
  // менеджер не назначает администраторов и не трогает их
  if (!user.isOwner) {
    must(!['admin', 'manager'].includes(u.role) || u.tg_id === user.id, 403, 'Администраторов меняет только главный администратор');
    must(!['admin', 'manager'].includes(role) || role === u.role, 403, 'Назначать администраторов может только главный администратор');
    must(body.perms === undefined, 403, 'Права меняет только главный администратор');
  }
  if (role === 'manager') must((await features()).managers, 400, 'Роль «Менеджер» выключена в настройках');
  let perms = u.perms || '';
  if (body.perms !== undefined) {
    must(Array.isArray(body.perms), 400, 'Некорректные права');
    perms = JSON.stringify([...new Set(body.perms.filter((x) => ALL_PERMS.includes(x)))]);
  }
  await db.query('UPDATE users SET status = $1, role = $2, name = $3, perms = $4 WHERE tg_id = $5', [status, role, name, perms, u.tg_id]);
  if (body.perms !== undefined && perms !== (u.perms || '')) await audit(user, 'Права менеджера', name, JSON.parse(perms).join(', ') || 'нет');
  if (body.reset_pin) {
    await db.query("UPDATE users SET pin_hash = '', pin_fails = 0, pin_locked_until = NULL WHERE tg_id = $1", [u.tg_id]);
    await audit(user, 'Сброс PIN', name);
  }
  const changes = [
    status !== u.status && `статус: ${u.status} → ${status}`,
    role !== u.role && `роль: ${u.role} → ${role}`,
    name !== u.name && `имя: ${u.name} → ${name}`,
  ].filter(Boolean);
  if (changes.length) await audit(user, 'Изменён сотрудник', name, changes.join('; '));
  if (u.status !== 'active' && status === 'active' && botEnabled && /^\d+$/.test(u.tg_id)) {
    // маленький пример i18n для бота: пара готовых строк на RO для сотрудников с users.lang = 'ro'
    const msg = u.lang === 'ro' ? '✅ Accesul la aplicație este deschis. Apăsați butonul de meniu pentru a începe.' : '✅ Доступ к приложению открыт. Нажмите кнопку меню, чтобы начать работу.';
    sendMessage(u.tg_id, msg).catch((e) => console.error(e.message));
  }
  return { ok: true };
}, { access: 'admin' });

// Удалить сотрудника: убирает учётную запись (доступа к приложению больше нет), история (выезды, акты, KPI) сохраняется.
route('DELETE', '/api/admin/users/:id', async ({ params, user }) => {
  const [u] = await db.query('SELECT * FROM users WHERE tg_id = $1', [params.id]);
  must(u, 404, 'Сотрудник не найден');
  must(u.tg_id !== user.id, 400, 'Нельзя удалить самого себя');
  if (!user.isOwner) must(!['admin', 'manager'].includes(u.role), 403, 'Администраторов и менеджеров удаляет только главный администратор');
  await db.query('DELETE FROM users WHERE tg_id = $1', [u.tg_id]);
  await audit(user, 'Сотрудник удалён', u.name, ROLE_LABEL[u.role] || u.role);
  return { ok: true };
}, { access: 'admin' });

// ---------- приглашения ----------

// ---------- права менеджера (администратор с ограничениями) ----------
const PERM_LABEL = {
  tasks: 'заявки', jobs: 'поручения', media: 'фото и видео', kpi: 'KPI, план и баллы', reports: 'акты и отчёты',
  staff: 'сотрудники', settings: 'настройки', audit: 'журнал', cash: 'касса',
};
const PERM_RULES = [
  // поручения: право «jobs» (или «tasks» — у менеджеров, настроенных до появления «jobs»)
  ['jobs|tasks', /^\/api\/admin\/(jobs|assignees|announcements)/],
  ['tasks', /^\/api\/(admin\/(tasks|cancelled|office-call)|tasks\/[^/]+\/(approve|assign|cancel|mult|restore|team|reschedule\/confirm))/],
  ['media', /^\/api\/admin\/media/],
  ['kpi', /^\/api\/(admin\/(kpi|points|coach|efficiency|timeliness|specialists|contest|guard|car-settings)|visits\/[^/]+\/points)/],
  ['reports', /^\/api\/(admin\/(stats|done|visits|pests-stats|tasks-stats|remarks|export)|visits\/[^/]+\/(reopen|approve|annul\/reject))/],
  ['staff', /^\/api\/admin\/(users|invites)/],
  ['audit', /^\/api\/admin\/audit/],
  ['cash', /^\/api\/admin\/cash/],
];
function permFor(method, path) {
  // «Автопарк»: смотреть машины и подтверждать фото может любой менеджер (настройки — по праву kpi)
  if (/^\/api\/admin\/(cars|car-checks|car-request)(\/|$)/.test(path)) return null;
  for (const [perm, re] of PERM_RULES) if (re.test(path)) return perm;
  if (/^\/api\/admin\/(office\/chats|bot-status)$/.test(path) && method === 'GET') return null;
  if (/^\/api\/admin\//.test(path)) return 'settings';
  return null;
}

// ---------- соревнование: рейтинг по баллам за месяц, победителю — корона 👑 и бонус ----------
const DEFAULT_CONTEST = { bonus: 3, show_staff: true, min_points: 1 };
async function contestSettings() { return { ...DEFAULT_CONTEST, ...((await getSetting('contest')) || {}) }; }
async function contestState() {
  let st = await getSetting('contest_state');
  if (!st) { st = { since: curMonth(), winners: {} }; await setSetting('contest_state', st); } // награждаем с месяца включения, не задним числом
  return st;
}
const prevMonthKey = (m) => { const [y, mm] = m.split('-').map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`; };
/** Баллы за месяц: выезды (доля ответственного) + применённые бонусы/штрафы, поручения, командные доли. */
async function leaderboard(month) {
  const { since, until } = monthRange(month);
  const users = await db.query("SELECT tg_id, name FROM users WHERE status = 'active' AND role NOT IN ('admin', 'manager')");
  const vis = await db.query("SELECT tech_tg_id AS id, SUM(points) AS p, COUNT(*) AS n FROM visits WHERE status = 'done' AND finished_at >= $1 AND finished_at < $2 GROUP BY tech_tg_id", [since, until]);
  const adj = await db.query("SELECT tg_id AS id, SUM(points) AS p FROM kpi_adjust WHERE month = $1 AND status = 'applied' AND rule <> 'crown' GROUP BY tg_id", [month]);
  const vm = Object.fromEntries(vis.map((r) => [r.id, r]));
  const am = Object.fromEntries(adj.map((r) => [r.id, Number(r.p) || 0]));
  const items = users.map((u) => ({ id: u.tg_id, name: u.name, points: r2((Number(vm[u.tg_id]?.p) || 0) + (am[u.tg_id] || 0)), visits: Number(vm[u.tg_id]?.n) || 0 }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  let rank = 0; let prev = null;
  items.forEach((it, i) => { if (it.points !== prev) { rank = i + 1; prev = it.points; } it.rank = rank; });
  return items;
}
/** Носители короны сейчас — победители прошлого месяца. */
async function crownHolders() {
  if (!(await features()).contest) return [];
  const st = await contestState();
  return st.winners?.[prevMonthKey(curMonth())]?.ids || [];
}
route('GET', '/api/contest', async ({ user }) => {
  const f = await features();
  must(f.contest, 404, 'Соревнование выключено');
  const cs = await contestSettings();
  must(user.isAdmin || cs.show_staff, 403, 'Рейтинг видит только администратор');
  const month = curMonth();
  const st = await contestState();
  const crowns = st.winners?.[prevMonthKey(month)]?.ids || [];
  const items = (await leaderboard(month)).map((it) => ({ ...it, crown: crowns.includes(it.id), me: it.id === user.id }));
  const history = Object.entries(st.winners || {}).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12)
    .map(([m, w]) => ({ month: m, label: monthRu(m), names: (w.ids || []).map((id) => userNames[id] || id), points: w.points, bonus: w.bonus }));
  return { month, label: monthRu(month), settings: cs, items, history, days_left: Math.max(0, Math.ceil((new Date(monthRange(month).until) - Date.now()) / 86400000)) };
});
route('PUT', '/api/admin/contest', async ({ body, user }) => {
  const cs = await contestSettings();
  if (body.bonus !== undefined) { const b = Number(String(body.bonus).replace(',', '.')); must(Number.isFinite(b) && b >= 0 && b <= 100, 400, 'Бонус — от 0 до 100'); cs.bonus = r2(b); }
  if (body.min_points !== undefined) { const b = Number(String(body.min_points).replace(',', '.')); must(Number.isFinite(b) && b >= 0, 400, 'Некорректный минимум'); cs.min_points = r2(b); }
  if (body.show_staff !== undefined) cs.show_staff = Boolean(body.show_staff);
  await setSetting('contest', cs);
  await audit(user, 'Соревнование', `бонус ${cs.bonus} · минимум ${cs.min_points} · сотрудникам ${cs.show_staff ? 'видно' : 'скрыто'}`);
  return { ok: true, settings: cs };
}, { access: 'admin' });
/** 1-го числа: победитель прошлого месяца получает корону и бонус (один раз). */
async function contestTick() {
  if (!(await features()).contest) return;
  await refreshUserNames();
  const st = await contestState();
  const prev = prevMonthKey(curMonth());
  if (prev < st.since || st.winners?.[prev]) return;
  const cs = await contestSettings();
  const lb = await leaderboard(prev);
  const top = lb.length ? lb[0].points : 0;
  const ids = top >= Number(cs.min_points || 0) && top > 0 ? lb.filter((x) => x.points === top).map((x) => x.id) : [];
  st.winners = { ...(st.winners || {}), [prev]: { ids, points: top, bonus: ids.length ? cs.bonus : 0 } };
  await setSetting('contest_state', st);
  if (!ids.length) return;
  for (const id of ids) {
    if (cs.bonus > 0) {
      await db.query("INSERT INTO kpi_adjust (id, month, tg_id, rule, points, reason, status, created_at, decided_at, decided_by, ref) VALUES ($1,$2,$3,'crown',$4,$5,'applied',$6,$6,'авто',$7)",
        [uid(), prev, id, cs.bonus, `👑 Победитель соревнования · ${monthRu(prev)}`, now(), `contest:${prev}`]);
    }
    notifyTech(id, `👑 <b>Поздравляем — вы победитель месяца!</b>\n${escHtml(monthRu(prev))}: ${ptsRu(top)} баллов — первое место.${cs.bonus > 0 ? `\nБонус: <b>+${ptsRu(cs.bonus)} б</b> в KPI.` : ''}\nКорона 👑 будет рядом с вашим именем весь месяц.`, { kind: 'info' });
  }
  const names = ids.map((id) => userNames[id] || id).join(', ');
  for (const u of lb.filter((x) => !ids.includes(x.id))) {
    notifyTech(u.id, `🏁 Итоги соревнования за ${escHtml(monthRu(prev))}: 👑 ${escHtml(names)} — ${ptsRu(top)} б. Ваше место: ${u.rank}. Новый месяц — новый шанс!`, { kind: 'info' });
  }
  notifyAdmins(`👑 Победитель соревнования за ${escHtml(monthRu(prev))}: <b>${escHtml(names)}</b> — ${ptsRu(top)} б${cs.bonus > 0 ? ` · бонус +${ptsRu(cs.bonus)} б` : ''}`);
}
setInterval(() => { contestTick().catch((e) => console.error('contest tick:', e.message)); }, 30 * 60000).unref?.();
setTimeout(() => { contestTick().catch(() => {}); }, 20000).unref?.();

// ---------- подключаемые функции (Настройки → «Функции») ----------
const DEFAULT_FEATURES = { team: true, job_reviewer: true, managers: true, contest: true, one_open: true, game: true, geo_shift: true, require_geo_start: false };
/** Нельзя начать следующую заявку, пока не закрыт (не завершён) предыдущий выезд. */
async function mustNoOpenVisit(user, exceptId = null) {
  if (!(await features()).one_open) return;
  const [v] = await db.query(
    "SELECT id, company_name, address, act_seq, started_at FROM visits WHERE tech_tg_id = $1 AND status = 'open' AND COALESCE(approval, '') <> 'rejected' ORDER BY started_at DESC LIMIT 1",
    [user.id]);
  if (!v || v.id === exceptId) return;
  const label = [v.company_name, v.address].filter(Boolean).join(' · ') || 'без названия';
  const e = new HttpError(409, `Сначала завершите предыдущий выезд: ${label} (акт № ${actNumber(v)}). Пока он открыт, следующую заявку начать нельзя.`);
  e.extra = { code: 'open_visit', visit_id: v.id, visit_name: v.address || v.company_name || '' };
  throw e;
}
async function features() { return { ...DEFAULT_FEATURES, ...((await getSetting('features')) || {}) }; }
route('PUT', '/api/admin/features', async ({ body, user }) => {
  must(user.isOwner, 403, 'Функции включает главный администратор');
  const f = await features();
  for (const k of Object.keys(DEFAULT_FEATURES)) if (body[k] !== undefined) f[k] = Boolean(body[k]);
  await setSetting('features', f);
  await audit(user, 'Функции', Object.entries(f).map(([k, v]) => `${k}: ${v ? 'вкл' : 'выкл'}`).join(', '));
  return { ok: true, features: f };
}, { access: 'admin' });

const ROLE_LABEL = { admin: 'администратор', manager: 'менеджер', tech: 'дезинсектор', specialist: 'специалист' };
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const inviteLink = (code) => (botUsername ? `https://t.me/${botUsername}?startapp=inv_${code}` : null);

route('GET', '/api/admin/invites', async () => {
  const rows = await db.query('SELECT * FROM invites WHERE used_by IS NULL AND expires_at > $1 ORDER BY created_at DESC', [now()]);
  return { items: rows.map((r) => ({ code: r.code, name: r.name, role: r.role, expires_at: r.expires_at, link: inviteLink(r.code) })) };
}, { access: 'admin' });

route('POST', '/api/admin/invites', async ({ body, user }) => {
  const name = str(body.name, 120);
  must(name.length >= 3, 400, 'Укажите фамилию и имя сотрудника');
  const role = ['admin', 'manager', 'specialist'].includes(body.role) ? body.role : 'tech';
  must(user.isOwner || !['admin', 'manager'].includes(role), 403, 'Приглашать администраторов может только главный администратор');
  let code = '';
  for (const b of crypto.randomBytes(10)) code += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();
  await db.query('INSERT INTO invites (code, name, role, created_by, created_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [code, name, role, user.id, now(), expires]);
  await audit(user, 'Создано приглашение', name, ROLE_LABEL[role]);
  return { code, name, role, expires_at: expires, link: inviteLink(code) };
}, { access: 'admin' });

route('DELETE', '/api/admin/invites/:code', async ({ params, user }) => {
  await db.query('DELETE FROM invites WHERE code = $1 AND used_by IS NULL', [params.code]);
  await audit(user, 'Приглашение отменено', params.code);
  return { ok: true };
}, { access: 'admin' });

// ---------- админ-панель ----------

function periodFilter(query) {
  const d = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
  const from = d(query.get('from')) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = d(query.get('to')) || new Date().toISOString().slice(0, 10);
  return { from, to, fromIso: `${from}T00:00:00.000Z`, toIso: `${to}T23:59:59.999Z` };
}

async function adminVisits(query) {
  const { from, to, fromIso, toIso } = periodFilter(query);
  const rows = await db.query(
    `SELECT v.*,
       (SELECT COUNT(*) FROM observations o WHERE o.visit_id = v.id) AS notes,
       (SELECT COUNT(*) FROM photos p WHERE p.visit_id = v.id) AS photos,
       (SELECT COUNT(*) FROM traps t WHERE t.object_id = v.object_id AND t.active = 1) AS traps_total,
       (SELECT COUNT(*) FROM inspections i WHERE i.visit_id = v.id) AS traps_checked,
       (SELECT COUNT(*) FROM inspections i WHERE i.visit_id = v.id AND i.status = 'activity') AS traps_activity
     FROM visits v WHERE v.started_at >= $1 AND v.started_at <= $2 ORDER BY v.started_at DESC`,
    [fromIso, toIso],
  );
  const tech = query.get('tech') || '';
  const procedure = query.get('procedure') || '';
  const status = query.get('status') || '';
  const q = (query.get('q') || '').toLowerCase().trim();
  const items = rows
    .filter((v) => (!tech || v.tech_tg_id === tech) && (!procedure || v.procedure === procedure) && (!status || v.status === status))
    .filter((v) => !q || `${v.company_name} ${v.address} ${v.tech_name} ${actNumber(v)} ${v.id.slice(0, 8)}`.toLowerCase().includes(q))
    .map((v) => ({
      id: v.id, act_no: actNumber(v), company_name: v.company_name, address: v.address, procedure: v.procedure,
      status: v.status, tech_id: v.tech_tg_id, tech_name: v.tech_name, started_at: v.started_at, finished_at: v.finished_at,
      pests: visitPests(v), infestation: v.infestation || '', preparation: v.preparation || '', comment: v.comment,
      notes: Number(v.notes), photos: Number(v.photos), traps_total: Number(v.traps_total), traps_checked: Number(v.traps_checked),
      traps_activity: Number(v.traps_activity), office_sent_at: v.office_sent_at, revision: Number(v.revision || 0),
    }));
  return { from, to, items };
}

route('GET', '/api/admin/visits', async ({ query }) => {
  const r = await adminVisits(query);
  return { ...r, items: r.items.slice(0, 300) };
}, { access: 'admin' });

// ---------- уведомления и замечания ----------

route('GET', '/api/notifications', async ({ user }) => {
  const since = monthStartIso();
  const rows = await db.query('SELECT * FROM notifications WHERE tg_id = $1 AND created_at >= $2 ORDER BY created_at DESC LIMIT 200', [user.id, since]);
  return {
    month_start: since,
    month: await monthSummary(user.id),
    remarks: rows.filter((r) => r.kind === 'remark').length,
    unread: rows.filter((r) => !r.read_at).length,
    items: rows.map((r) => ({ id: r.id, kind: r.kind, text: r.text, visit_id: r.visit_id, task_id: r.task_id, author: r.author_name, created_at: r.created_at, read: Boolean(r.read_at) })),
  };
});

route('POST', '/api/notifications/read', async ({ user }) => {
  await db.query('UPDATE notifications SET read_at = $1 WHERE tg_id = $2 AND read_at IS NULL', [now(), user.id]);
  return { ok: true };
});

route('POST', '/api/admin/remarks', async ({ body, user }) => {
  const text = str(body.text, 1500);
  const type = str(body.type, 30);
  must(text.length >= 3 || type, 400, 'Выберите тип замечания или напишите текст');
  let techId = str(body.tech_id, 40);
  const visitId = str(body.visit_id, 64) || null;
  if (visitId && !techId) techId = (await getVisit(visitId)).tech_tg_id;
  must(techId, 400, 'Выберите сотрудника');
  const u = await createRemark({ techId, text, visitId, author: user, type });
  return { ok: true, tech: u.name };
}, { access: 'admin' });

route('GET', '/api/admin/remarks', async () => {
  const since = monthStartIso();
  const rows = await db.query(
    `SELECT n.*, u.name AS tech_name FROM notifications n LEFT JOIN users u ON u.tg_id = n.tg_id
     WHERE n.kind = 'remark' AND n.created_at >= $1 ORDER BY n.created_at DESC`, [since],
  );
  const byTech = {};
  for (const r of rows) byTech[r.tech_name || r.tg_id] = (byTech[r.tech_name || r.tg_id] || 0) + 1;
  return {
    month_start: since,
    by_tech: Object.entries(byTech).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    items: rows.map((r) => ({ id: r.id, tech_id: r.tg_id, tech_name: r.tech_name || '', text: r.text, visit_id: r.visit_id, author: r.author_name, created_at: r.created_at, read: Boolean(r.read_at), type: r.remark_type || '', points: r.remark_points == null ? null : Number(r.remark_points) })),
    types: await remarkTypes(),
  };
}, { access: 'admin' });

route('PUT', '/api/admin/remark-types', async ({ body, user }) => {
  must(Array.isArray(body.types) && body.types.length >= 1 && body.types.length <= 30, 400, 'Нужен хотя бы один тип');
  const ids = new Set();
  const types = body.types.map((t, i) => {
    const label = str(t.label, 80);
    must(label.length >= 2, 400, `Название типа ${i + 1} слишком короткое`);
    const p = Number(String(t.points ?? 0).replace(',', '.'));
    must(Number.isFinite(p) && p >= 0 && p <= 50, 400, `Некорректные баллы: ${label}`);
    let id = str(t.id, 30).replace(/[^a-z0-9_]/gi, '') || `t${Date.now().toString(36)}${i}`;
    while (ids.has(id)) id += '_';
    ids.add(id);
    return { id, label, points: Math.round(p * 100) / 100 };
  });
  await setSetting('remark_types', types);
  await audit(user, 'Типы замечаний изменены', types.map((t) => `${t.label} −${t.points}`).join(', '));
  return { ok: true, types };
}, { access: 'admin' });

route('DELETE', '/api/admin/remarks/:id', async ({ params, user }) => {
  const [r] = await db.query("SELECT * FROM notifications WHERE id = $1 AND kind = 'remark'", [params.id]);
  must(r, 404, 'Замечание не найдено');
  await db.query('DELETE FROM notifications WHERE id = $1', [r.id]);
  if (r.adjust_id) await db.query('DELETE FROM kpi_adjust WHERE id = $1', [r.adjust_id]); // штраф возвращается
  await audit(user, 'Замечание удалено', r.text.slice(0, 200), r.remark_points ? `штраф ${r.remark_points} б снят` : '');
  return { ok: true };
}, { access: 'admin' });

// ---------- диагностика бота ----------

route('GET', '/api/admin/bot-status', async () => {
  const out = { enabled: botEnabled, expected_url: publicBase() ? `${publicBase()}/api/tg/webhook` : '', webhook: null, bot: null, bindings: [], recent: tgLog, last_update_at: lastUpdateAt, error: null };
  if (!botEnabled) return out;
  try {
    const me = await getMe();
    out.bot = { username: me.username, can_read_all_group_messages: Boolean(me.can_read_all_group_messages), id: me.id };
    const w = await getWebhookInfo();
    out.webhook = {
      url: w.url || '', pending: w.pending_update_count || 0,
      last_error: w.last_error_message || '', last_error_at: w.last_error_date ? new Date(w.last_error_date * 1000).toISOString() : null,
      allowed: w.allowed_updates || [],
    };
    const b = await topicBindings();
    const names = (await getSetting('topic_names')) || {};
    const chats = Object.fromEntries((await db.query('SELECT id, title FROM tg_chats')).map((r) => [r.id, r.title]));
    const users = Object.fromEntries((await db.query('SELECT tg_id, name FROM users')).map((r) => [r.tg_id, r.name]));
    const adminCache = {};
    for (const [key, tech] of Object.entries(b)) {
      const [chatId, thread] = key.split(':');
      if (!(chatId in adminCache)) {
        try { const mem = await getChatMember(chatId, me.id); adminCache[chatId] = mem.status; } catch (e) { adminCache[chatId] = `ошибка: ${e.message}`; }
      }
      const [cnt] = await db.query('SELECT COUNT(*) AS n FROM tasks WHERE chat_id = $1 AND COALESCE(thread_id, \'0\') = $2', [chatId, thread]);
      out.bindings.push({
        key, chat_id: chatId, chat_title: chats[chatId] || chatId, thread_id: thread === '0' ? null : thread, topic: names[key] || '',
        tech_id: tech, tech_name: users[tech] || '', tech_exists: Boolean(users[tech]), bot_status: adminCache[chatId], tasks: Number(cnt.n),
      });
    }
  } catch (e) {
    out.error = e.message;
  }
  return out;
}, { access: 'admin' });

route('POST', '/api/admin/bot-webhook', async ({ user }) => {
  const base = publicBase();
  must(base, 400, 'Не задан адрес сервиса (RENDER_EXTERNAL_URL / PUBLIC_URL)');
  await setWebhook(`${base}/api/tg/webhook`);
  webhookActive = true;
  await audit(user, 'Переустановлен webhook бота', base);
  return { ok: true };
}, { access: 'admin' });

// ---------- KPI: помесячная история по сотрудникам ----------

const monthKeyTz = (iso) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: TZN, year: 'numeric', month: '2-digit' }).format(new Date(iso)) : '');
const dayKeyTz = (iso) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: TZN, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)) : '');

/**
 * Для каждого сотрудника и месяца: получено заявок, выполнено, из них в срок, отменено, выездов (актов) всего,
 * замечаний офиса, среднее время от заявки до выполнения. Выполнение считается по дате завершения акта.
 */
async function kpiHistory({ months = 12, techId = null } = {}) {
  months = Math.min(Math.max(Number(months) || 12, 1), 24);
  const keys = [];
  const [y, m] = monthKeyTz(new Date().toISOString()).split('-').map(Number);
  for (let k = months - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(y, m - 1 - k, 15));
    keys.push(d.toISOString().slice(0, 7));
  }
  const since = zonedIso(Number(keys[0].slice(0, 4)), Number(keys[0].slice(5, 7)), 1, 0, 0, TZN);
  const f = techId ? ' AND (t.tech_tg_id = $2 OR t.team LIKE $3)' : '';
  const tasks = await db.query(
    `SELECT t.*, v.finished_at AS v_finished FROM tasks t LEFT JOIN visits v ON v.id = t.visit_id
     WHERE (t.created_at >= $1 OR t.updated_at >= $1) AND t.status <> 'void'${f}`, techId ? [since, techId, `%"${techId}"%`] : [since],
  );
  const visits = await db.query(
    `SELECT tech_tg_id, finished_at, points FROM visits WHERE status = 'done' AND finished_at >= $1${techId ? ' AND tech_tg_id = $2' : ''}`, techId ? [since, techId] : [since],
  );
  const remarks = await db.query(
    `SELECT tg_id, created_at FROM notifications WHERE kind = 'remark' AND created_at >= $1${techId ? ' AND tg_id = $2' : ''}`, techId ? [since, techId] : [since],
  );
  const users = await db.query(`SELECT tg_id, name, status FROM users${techId ? ' WHERE tg_id = $1' : ''}`, techId ? [techId] : []);
  const names = Object.fromEntries(users.map((u) => [u.tg_id, u.name]));

  const events = await db.query(
    `SELECT tech_tg_id, kind, created_at FROM task_events WHERE created_at >= $1${techId ? ' AND tech_tg_id = $2' : ''}`, techId ? [since, techId] : [since],
  );
  const blank = () => ({ received: 0, done: 0, on_time: 0, late: 0, cancelled: 0, client_cancelled: 0, reschedules: 0, visits: 0, remarks: 0, hours_sum: 0, hours_n: 0, revenue: 0, points: 0, adjust: 0 });
  const data = {}; // tech -> month -> stats
  const cell = (tech, key) => { data[tech] ||= {}; return (data[tech][key] ||= blank()); };

  for (const t of tasks) {
    const rk = monthKeyTz(t.created_at);
    if (keys.includes(rk)) cell(t.tech_tg_id, rk).received++;
    if (t.status === 'done') {
      const doneAt = t.v_finished || t.updated_at;
      const dk = monthKeyTz(doneAt);
      if (!keys.includes(dk)) continue;
      const c = cell(t.tech_tg_id, dk);
      c.done++;
      // командная заявка: стоимость делится поровну на всех участников, выполнение засчитывается каждому
      const team = taskTeam(t);
      const share = t.price != null ? (Number(t.price) || 0) / (team.length + 1) : 0;
      c.revenue += share;
      const onTime = !t.planned_at || dayKeyTz(doneAt) <= dayKeyTz(t.planned_at);
      for (const id of team) { const mc = cell(id, dk); mc.done++; mc.revenue += share; if (onTime) mc.on_time++; else mc.late++; }
      if (onTime) c.on_time++; else c.late++;
      const h = (new Date(doneAt) - new Date(t.created_at)) / 3600000;
      if (h >= 0) { c.hours_sum += h; c.hours_n++; }
    } else if (t.status === 'cancelled') {
      const ck = monthKeyTz(t.updated_at);
      if (keys.includes(ck)) {
        if (t.cancel_reason === 'client') cell(t.tech_tg_id, ck).client_cancelled++;
        else cell(t.tech_tg_id, ck).cancelled++;
      }
    }
  }
  for (const e of events) {
    const k = monthKeyTz(e.created_at);
    if (e.kind === 'reschedule' && keys.includes(k)) cell(e.tech_tg_id, k).reschedules++;
  }
  for (const v of visits) { const k = monthKeyTz(v.finished_at); if (keys.includes(k)) { const c = cell(v.tech_tg_id, k); c.visits++; c.points += Number(v.points) || 0; } }
  // бонусы и штрафы (применённые администратором) — входят в баллы месяца
  const adjs = await db.query(`SELECT tg_id, month, points FROM kpi_adjust WHERE status = 'applied'${techId ? ' AND tg_id = $1' : ''}`, techId ? [techId] : []);
  for (const a of adjs) if (keys.includes(a.month)) { const c = cell(a.tg_id, a.month); c.points += Number(a.points) || 0; c.adjust += Number(a.points) || 0; }
  for (const r of remarks) { const k = monthKeyTz(r.created_at); if (keys.includes(k)) cell(r.tg_id, k).remarks++; }

  const finish = (c) => ({
    received: c.received, done: c.done, on_time: c.on_time, late: c.late, cancelled: c.cancelled, client_cancelled: c.client_cancelled,
    reschedules: c.reschedules, visits: c.visits, remarks: c.remarks, revenue: Math.round(c.revenue), points: Math.round(c.points * 100) / 100, adjust: Math.round(c.adjust * 100) / 100,
    on_time_pct: c.done ? Math.round((c.on_time / c.done) * 100) : null,
    avg_hours: c.hours_n ? Math.round((c.hours_sum / c.hours_n) * 10) / 10 : null,
  });
  const techIds = new Set([...Object.keys(data), ...(techId ? [techId] : users.filter((u) => u.status === 'active').map((u) => u.tg_id))]);
  const techs = [...techIds].map((id) => ({
    id, name: names[id] || id,
    months: keys.map((k) => ({ month: k, ...finish(data[id]?.[k] || blank()) })),
  }));
  techs.forEach((t) => { t.total_done = t.months.reduce((n, x) => n + x.done, 0); });
  techs.sort((a, b) => b.total_done - a.total_done || a.name.localeCompare(b.name));
  return { months: keys, current: keys[keys.length - 1], techs };
}

route('GET', '/api/kpi', async ({ user, query }) => {
  const techId = user.isAdmin ? (query.get('tech') || null) : user.id; // техник видит только себя
  return kpiHistory({ months: query.get('months') || 12, techId });
});

route('POST', '/api/admin/kpi/export', async ({ user, body }) => {
  const months = Math.min(Math.max(Number(body.months) || 12, 1), 24);
  await audit(user, 'Выгрузка KPI', `${months} мес.`);
  return { url: `/r/kpi.csv?months=${months}&${signLink(`kpi:${months}`, 600)}` };
}, { access: 'admin' });

// ---------- план KPI на месяц (с учётом сезона) ----------
// План в баллах = базовый план × сезонный коэффициент месяца (или вручную для сотрудника).
// Итог KPI, % = выполнение плана (до «потолка») × вес + работа в срок × вес + отсутствие замечаний × вес.
const DEFAULT_KPI = {
  base_points: 60,                                                     // план в баллах при коэффициенте 1,0
  season: [0.6, 0.6, 0.8, 1.0, 1.2, 1.4, 1.5, 1.5, 1.2, 1.0, 0.8, 0.6], // янв…дек: летом клопы/тараканы/осы — пик
  w_plan: 70, w_on_time: 20, w_quality: 10,                            // веса, в сумме 100
  on_time_target: 90,                                                  // % заявок в срок, который считается нормой
  remark_penalty: 25,                                                  // −% за каждое замечание в части «качество»
  cap: 120,                                                            // выполнение плана учитывается не выше 120%
  min_plan_pct: 70,                                                    // KPI начинает считаться, только если выполнено ≥ 70% плана; ниже — KPI = 0
  remind_minutes: 60,                                                  // повтор уведомления о плане, пока не подтвердит
};
async function kpiSettings() {
  const s = { ...DEFAULT_KPI, ...((await getSetting('kpi')) || {}) };
  if (!Array.isArray(s.season) || s.season.length !== 12) s.season = DEFAULT_KPI.season;
  return s;
}
const curMonth = () => monthKeyTz(new Date().toISOString());
const monthRu = (key) => new Date(`${key}-15T12:00:00Z`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');
const r2 = (n) => Math.round(n * 100) / 100;

function kpiScore(k, plan, m) {
  const planPct = plan > 0 ? Math.min((m.points || 0) / plan * 100, k.cap) : 0;
  const onTime = m.on_time_pct == null ? 100 : Math.min(m.on_time_pct / (k.on_time_target || 100), 1) * 100;
  const quality = Math.max(0, 100 - (m.remarks || 0) * k.remark_penalty);
  const total = (planPct * k.w_plan + onTime * k.w_on_time + quality * k.w_quality) / 100;
  const rawPct = plan > 0 ? (m.points || 0) / plan * 100 : 0;
  const min = Number(k.min_plan_pct) || 0;
  const below = rawPct < min; // порог не пройден — KPI не начисляется
  return {
    plan_pct: Math.round(rawPct), on_time_score: Math.round(onTime), quality_score: Math.round(quality),
    score: below ? 0 : Math.round(total), score_raw: Math.round(total), below_min: below,
    min_points: Math.round(plan * min) / 100,
  };
}

/** Строки плана на месяц: все активные специалисты (не администраторы). */
async function kpiPlanRows(month) {
  const k = await kpiSettings();
  const coef = k.season[Number(month.slice(5, 7)) - 1];
  const auto = Math.round(k.base_points * coef);
  const techs = await db.query("SELECT tg_id, name FROM users WHERE status = 'active' AND role NOT IN ('admin', 'manager') ORDER BY name");
  const plans = Object.fromEntries((await db.query('SELECT * FROM kpi_plans WHERE month = $1', [month])).map((p) => [p.tg_id, p]));
  const hist = await kpiHistory({ months: 13 });
  const rows = techs.map((u) => {
    const p = plans[u.tg_id];
    const plan = p?.points != null ? Number(p.points) : auto;
    const m = hist.techs.find((t) => t.id === u.tg_id)?.months.find((x) => x.month === month)
      || { points: 0, done: 0, on_time_pct: null, remarks: 0, late: 0, received: 0 };
    return {
      id: u.tg_id, name: u.name, plan, plan_custom: p?.points != null,
      points: r2(m.points || 0), adjust: r2(m.adjust || 0), done: m.done || 0, received: m.received || 0, on_time_pct: m.on_time_pct, late: m.late || 0, remarks: m.remarks || 0,
      ...kpiScore(k, plan, m),
      sent_at: p?.sent_at || null, ack_at: p?.ack_at || null, remind_count: Number(p?.remind_count || 0),
    };
  });
  return { month, month_label: monthRu(month), coef, auto_plan: auto, settings: k, rows };
}

async function sendPlan(month, tgId, reset = true) {
  const { rows, month_label: label, settings: k } = await kpiPlanRows(month);
  const r = rows.find((x) => x.id === String(tgId));
  if (!r) return;
  const [ex] = await db.query('SELECT * FROM kpi_plans WHERE month = $1 AND tg_id = $2', [month, r.id]);
  if (!ex) await db.query('INSERT INTO kpi_plans (month, tg_id) VALUES ($1, $2)', [month, r.id]);
  if (ex?.msg_id && botEnabled) await deleteMessage(r.id, ex.msg_id).catch(() => {});
  const n = reset ? 0 : Number(ex?.remind_count || 0);
  const pc = await pointsConfig();
  const html = [
    `🎯 <b>План KPI на ${escHtml(label)}</b>${n ? ` · напоминание ${n + 1}` : ''}`,
    '',
    `Цель: <b>${r.plan} баллов</b>`,
    k.min_plan_pct ? `KPI начисляется от <b>${r.min_points} баллов</b> (${k.min_plan_pct}% плана) — ниже KPI = 0.` : '',
    `Как считается итог: план — ${k.w_plan}%, работа в срок (норма ${k.on_time_target}%) — ${k.w_on_time}%, без замечаний — ${k.w_quality}%.`,
    `Баллы: ${pc.cats.map((c) => `${c.label} ${c.zones ? `${c.zones.city}/${c.zones.near}/${c.zones.far}` : c.points}`.replace(/\./g, ',')).join(' · ')}${pc.night ? ` · после ${pc.night_from}:00 +${String(pc.night).replace('.', ',')}` : ''}.`,
    '',
    'Нажмите «Ознакомлен», чтобы подтвердить план.',
  ].filter((x, i) => x !== '' || i === 1 || i === 6).join('\n');
  let msgId = '';
  if (botEnabled && /^\d+$/.test(r.id)) {
    const base = publicBase();
    const kb = [[{ text: '✅ Ознакомлен', callback_data: `planok:${month}` }]];
    if (base) kb.push([{ text: 'Открыть приложение', web_app: { url: base } }]);
    try { msgId = String((await sendMessage(r.id, html, { replyMarkup: { inline_keyboard: kb } }))?.message_id || ''); } catch (e) { console.error('plan send:', e.message); }
  }
  await db.query(`UPDATE kpi_plans SET sent_at = COALESCE(${reset ? 'NULL' : 'sent_at'}, $1), msg_id = $2, remind_at = $1, remind_count = $3${reset ? ', ack_at = NULL' : ''} WHERE month = $4 AND tg_id = $5`,
    [now(), msgId, n + 1, month, r.id]);
  if (reset) addNotification(r.id, 'info', `План KPI на ${label}: ${r.plan} баллов. Подтвердите «Ознакомлен».`, {}).catch(() => {});
}

async function ackPlan(month, tgId) {
  const [p] = await db.query('SELECT * FROM kpi_plans WHERE month = $1 AND tg_id = $2', [month, String(tgId)]);
  if (!p || p.ack_at) return false;
  const at = now();
  await db.query('UPDATE kpi_plans SET ack_at = $1 WHERE month = $2 AND tg_id = $3', [at, month, String(tgId)]);
  if (p.msg_id && botEnabled) editMessage(String(tgId), p.msg_id, `🎯 План KPI на ${escHtml(monthRu(month))}\n\n✅ Вы ознакомились с планом · ${escHtml(fmtRu(at))}`).catch(() => {});
  return true;
}

// 1-го числа в 9:00 планы уходят сами; неподтверждённым — повтор раз в час (9:00–20:00), до 12 раз
async function planTick() {
  if (!botEnabled) return;
  const month = curMonth();
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: TZN, hour: '2-digit', hour12: false })) % 24;
  if (hour < 9 || hour >= 20) return;
  const sentFor = await getSetting('kpi_autosent');
  // первый запуск посреди месяца: не рассылаем задним числом — автоматически начнём с 1-го числа следующего месяца
  if (sentFor === null || sentFor === undefined) { await setSetting('kpi_autosent', month); return; }
  if (sentFor !== month) {
    await setSetting('kpi_autosent', month);
    const { rows } = await kpiPlanRows(month);
    for (const r of rows) if (!r.sent_at) await sendPlan(month, r.id, true);
    await audit({ id: 'system', name: 'Система' }, 'Планы KPI разосланы', monthRu(month), `${rows.length} сотр.`);
    return;
  }
  const k = await kpiSettings();
  const due = new Date(Date.now() - (Number(k.remind_minutes) || 60) * 60000 + 30000).toISOString();
  const rows = await db.query('SELECT * FROM kpi_plans WHERE month = $1 AND sent_at IS NOT NULL AND ack_at IS NULL AND remind_count < 12 AND (remind_at IS NULL OR remind_at <= $2)', [month, due]);
  for (const p of rows) await sendPlan(month, p.tg_id, false);
}
setInterval(() => { planTick().catch((e) => console.error('plan tick:', e.message)); }, 60000).unref?.();

route('GET', '/api/admin/kpi-plan', async ({ query }) => kpiPlanRows(/^\d{4}-\d{2}$/.test(query.get('month') || '') ? query.get('month') : curMonth()), { access: 'admin' });

route('PUT', '/api/admin/kpi-settings', async ({ body, user }) => {
  const k = await kpiSettings();
  const num = (v, min, max, name) => { const n = Number(String(v).replace(',', '.')); must(Number.isFinite(n) && n >= min && n <= max, 400, `Некорректно: ${name}`); return n; };
  const next = {
    base_points: num(body.base_points ?? k.base_points, 0, 10000, 'базовый план'),
    season: Array.isArray(body.season) && body.season.length === 12 ? body.season.map((v, i) => num(v, 0, 5, `коэффициент ${i + 1}`)) : k.season,
    w_plan: num(body.w_plan ?? k.w_plan, 0, 100, 'вес плана'),
    w_on_time: num(body.w_on_time ?? k.w_on_time, 0, 100, 'вес «в срок»'),
    w_quality: num(body.w_quality ?? k.w_quality, 0, 100, 'вес качества'),
    on_time_target: num(body.on_time_target ?? k.on_time_target, 1, 100, 'норма «в срок»'),
    remark_penalty: num(body.remark_penalty ?? k.remark_penalty, 0, 100, 'штраф за замечание'),
    cap: num(body.cap ?? k.cap, 100, 300, 'потолок'),
    min_plan_pct: num(body.min_plan_pct ?? k.min_plan_pct, 0, 100, 'минимальный % плана'),
    remind_minutes: num(body.remind_minutes ?? k.remind_minutes, 5, 1440, 'интервал напоминаний'),
  };
  must(Math.round(next.w_plan + next.w_on_time + next.w_quality) === 100, 400, 'Сумма весов должна быть 100');
  await setSetting('kpi', next);
  await audit(user, 'Изменены настройки KPI', `база ${next.base_points} · минимум ${next.min_plan_pct}%`, `сезон: ${next.season.join(' / ')}`);
  return { ok: true, settings: next };
}, { access: 'admin' });

route('PUT', '/api/admin/kpi-plan', async ({ body, user }) => {
  const month = str(body.month, 7);
  must(/^\d{4}-\d{2}$/.test(month), 400, 'Некорректный месяц');
  const tg = str(body.tg_id, 40);
  const pts = body.points === null || body.points === '' ? null : Number(String(body.points).replace(',', '.'));
  must(pts === null || (Number.isFinite(pts) && pts >= 0 && pts <= 10000), 400, 'Некорректный план');
  const [ex] = await db.query('SELECT 1 AS x FROM kpi_plans WHERE month = $1 AND tg_id = $2', [month, tg]);
  if (ex) await db.query('UPDATE kpi_plans SET points = $1 WHERE month = $2 AND tg_id = $3', [pts, month, tg]);
  else await db.query('INSERT INTO kpi_plans (month, tg_id, points) VALUES ($1, $2, $3)', [month, tg, pts]);
  await audit(user, 'План KPI изменён', `${monthRu(month)} · ${tg}`, pts === null ? 'по сезону' : `${pts} баллов`);
  return { ok: true };
}, { access: 'admin' });

route('POST', '/api/admin/kpi-plan/send', async ({ body, user }) => {
  const month = /^\d{4}-\d{2}$/.test(str(body.month, 7)) ? str(body.month, 7) : curMonth();
  must(botEnabled, 400, 'Бот не настроен');
  const { rows } = await kpiPlanRows(month);
  const only = body.tg_id ? String(body.tg_id) : null;
  let n = 0;
  for (const r of rows) if (!only || r.id === only) { await sendPlan(month, r.id, true); n++; }
  if (month === curMonth()) await setSetting('kpi_autosent', month);
  await audit(user, 'Планы KPI отправлены', monthRu(month), `${n} сотр.`);
  return { ok: true, sent: n };
}, { access: 'admin' });

// ---------- «Специалисты»: карточка на каждого — заявки, KPI, активность ----------
route('GET', '/api/admin/specialists', async ({ query }) => {
  const month = /^\d{4}-\d{2}$/.test(query.get('month') || '') ? query.get('month') : curMonth();
  const plan = await kpiPlanRows(month);
  const hist = await kpiHistory({ months: 13 });
  const users = Object.fromEntries((await db.query("SELECT tg_id, username, phone, last_seen, created_at FROM users")).map((u) => [u.tg_id, u]));
  const openTasks = await db.query("SELECT tech_tg_id, planned_at, ack_at FROM tasks WHERE status IN ('new', 'in_progress') AND visit_id IS NULL");
  const openVisits = await db.query("SELECT tech_tg_id, company_name, address, started_at FROM visits WHERE status = 'open'");
  const lastDone = await db.query("SELECT tech_tg_id, MAX(finished_at) AS at FROM visits WHERE status = 'done' GROUP BY tech_tg_id");
  const totals = await db.query("SELECT tech_tg_id, COUNT(*) AS n, SUM(points) AS p FROM visits WHERE status = 'done' GROUP BY tech_tg_id");
  const calls = await db.query('SELECT id, tg_id, created_at, count FROM office_calls WHERE ack_at IS NULL AND cancelled_at IS NULL');
  const dayKey = (iso) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: TZN }).format(new Date(iso)) : '');
  const today = dayKey(new Date().toISOString());
  const items = plan.rows.map((r) => {
    const mine = openTasks.filter((t) => t.tech_tg_id === r.id);
    const m = hist.techs.find((t) => t.id === r.id)?.months.find((x) => x.month === month) || {};
    const tot = totals.find((t) => t.tech_tg_id === r.id);
    const onSite = openVisits.find((v) => v.tech_tg_id === r.id);
    return {
      ...r,
      username: users[r.id]?.username || '', phone: users[r.id]?.phone || '', last_seen: users[r.id]?.last_seen || null,
      open: mine.length,
      today: mine.filter((t) => !t.planned_at || dayKey(t.planned_at) <= today).length,
      overdue: mine.filter((t) => t.planned_at && dayKey(t.planned_at) < today).length,
      unacked: mine.filter((t) => !t.ack_at).length,
      client_cancelled: m.client_cancelled || 0, reschedules: m.reschedules || 0, revenue: m.revenue || 0, avg_hours: m.avg_hours ?? null,
      on_site: onSite ? { company_name: onSite.company_name, address: onSite.address, started_at: onSite.started_at } : null,
      last_done_at: lastDone.find((x) => x.tech_tg_id === r.id)?.at || null,
      total_done: Number(tot?.n || 0), total_points: r2(Number(tot?.p || 0)),
      office_call: (() => { const c = calls.find((x) => x.tg_id === r.id); return c ? { id: c.id, created_at: c.created_at, count: Number(c.count) } : null; })(),
    };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { month, month_label: plan.month_label, items };
}, { access: 'admin' });

route('GET', '/api/admin/specialists/:id', async ({ params }) => {
  const id = String(params.id);
  const [u] = await db.query('SELECT tg_id, name, username, phone, role, status, created_at, last_seen FROM users WHERE tg_id = $1', [id]);
  must(u, 404, 'Сотрудник не найден');
  // KPI за последние 6 месяцев (план этого месяца, баллы, итог)
  const keys = [];
  const since = monthKeyTz(u.created_at); // месяцы до прихода сотрудника не показываем
  for (let i = 5; i >= 0; i--) { const k = shift(curMonth(), -i); if (!since || k >= since) keys.push(k); }
  const months = [];
  for (const k of keys) {
    const pr = await kpiPlanRows(k);
    const r = pr.rows.find((x) => x.id === id);
    if (r) months.push({ month: k, label: pr.month_label, plan: r.plan, points: r.points, plan_pct: r.plan_pct, score: r.score, done: r.done, on_time_pct: r.on_time_pct, remarks: r.remarks, ack_at: r.ack_at });
  }
  const tasks = (await db.query(`SELECT t.*, u.name AS tech_name FROM tasks t LEFT JOIN users u ON u.tg_id = t.tech_tg_id
     WHERE t.tech_tg_id = $1 AND t.status IN ('new', 'in_progress') AND t.visit_id IS NULL ORDER BY COALESCE(t.planned_at, t.created_at)`, [id])).map((t) => shapeTask(t, t.tech_name));
  const visits = (await db.query(`SELECT id, company_name, address, procedure, status, started_at, finished_at, points, act_seq FROM visits
     WHERE tech_tg_id = $1 ORDER BY started_at DESC LIMIT 25`, [id])).map((v) => ({ ...v, act_no: actNumber(v), points: v.points == null ? null : Number(v.points) }));
  return { user: { id: u.tg_id, name: u.name, username: u.username, phone: u.phone, created_at: u.created_at, last_seen: u.last_seen }, months, tasks, visits };
}, { access: 'admin' });
const shift = (key, d) => { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + d, 15)).toISOString().slice(0, 7); };

// ---------- главная админки: какие блоки показывать ----------
const OVERVIEW_WIDGETS = ['tasks', 'live', 'contest', 'guard', 'coach', 'media', 'tiles', 'efficiency', 'timeliness', 'office', 'daily', 'bars', 'alerts'];

// ---------- дашборд «Эффективность сотрудников» (KPI текущего месяца) ----------
route('GET', '/api/admin/efficiency', async () => {
  const { rows, month_label: label, settings } = await kpiPlanRows(curMonth());
  return { month_label: label, min_plan_pct: settings.min_plan_pct, items: rows.sort((a, b) => b.score - a.score) };
}, { access: 'admin' });

// ---------- дашборд «Своевременность работы с приложением» ----------
// Реакция на новую заявку («Уведомлен»), на напоминание «Скоро заявка» («Увидел»), начало работы вовремя, подтверждение плана.
async function computeTimeliness(since, until = '9999', planMonth = curMonth()) {
  const techs = await db.query("SELECT tg_id, name FROM users WHERE status = 'active' AND role NOT IN ('admin', 'manager') ORDER BY name");
  const tasks = await db.query(`SELECT t.tech_tg_id, t.created_at, t.sent_at, t.ack_at, t.alert_count, t.planned_at, t.has_time, t.soon_count, t.soon_ack_at, t.soon_for,
       v.started_at AS v_started FROM tasks t LEFT JOIN visits v ON v.id = t.visit_id
     WHERE t.created_at >= $1 AND t.created_at < $2 AND t.status NOT IN ('pending', 'void')`, [since, until]);
  const plans = await db.query('SELECT tg_id, sent_at, ack_at FROM kpi_plans WHERE month = $1', [planMonth]);
  const calls = await db.query('SELECT tg_id, created_at, ack_at, count FROM office_calls WHERE created_at >= $1 AND created_at < $2 AND cancelled_at IS NULL', [since, until]);
  const min = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 60000;
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length * 10) / 10 : null);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const items = techs.map((u) => {
    const ts = tasks.filter((t) => t.tech_tg_id === u.tg_id);
    const sent = ts.filter((t) => t.sent_at || t.created_at);
    const acked = sent.filter((t) => t.ack_at);
    const ackMins = acked.map((t) => Math.max(0, min(t.sent_at || t.created_at, t.ack_at)));
    const ackFast = ackMins.filter((m) => m <= 5).length;
    const soon = ts.filter((t) => Number(t.soon_count) > 0);
    const soonOk = soon.filter((t) => t.soon_ack_at);
    const started = ts.filter((t) => t.v_started && Number(t.has_time) === 1 && t.planned_at);
    const onTime = started.filter((t) => min(t.planned_at, t.v_started) <= 15);
    const p = plans.find((x) => x.tg_id === u.tg_id);
    const cs = calls.filter((c) => c.tg_id === u.tg_id);
    const csOk = cs.filter((c) => c.ack_at);
    const parts = [pct(ackFast, sent.length), pct(soonOk.length, soon.length), pct(onTime.length, started.length), pct(csOk.length, cs.length)].filter((x) => x != null);
    return {
      id: u.tg_id, name: u.name,
      tasks: sent.length,
      ack_fast_pct: pct(ackFast, sent.length), ack_avg_min: avg(ackMins), unacked: sent.length - acked.length,
      reminders_avg: avg(sent.map((t) => Math.max(0, Number(t.alert_count || 0) - 1))),
      soon_total: soon.length, soon_ok_pct: pct(soonOk.length, soon.length), soon_reminders_avg: avg(soon.map((t) => Number(t.soon_count || 0))),
      started: started.length, start_on_time_pct: pct(onTime.length, started.length),
      plan_ack_hours: p?.sent_at && p?.ack_at ? Math.round(min(p.sent_at, p.ack_at) / 6) / 10 : null, plan_sent: Boolean(p?.sent_at), plan_acked: Boolean(p?.ack_at),
      office_calls: cs.length, office_ok_pct: pct(csOk.length, cs.length),
      score: parts.length ? Math.round(parts.reduce((s, x) => s + x, 0) / parts.length) : null,
    };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return items;
}
route('GET', '/api/admin/timeliness', async ({ query }) => {
  const days = Math.min(Math.max(Number(query.get('days')) || 30, 1), 180);
  return { days, items: await computeTimeliness(new Date(Date.now() - days * 86400000).toISOString()) };
}, { access: 'admin' });

// ---------- «Вызвать в офис»: сообщение в бот, повтор каждые 2 минуты до «Получил» ----------
const OFFICE_CALL_EVERY_MS = Number(process.env.OFFICE_CALL_EVERY_MINUTES || 2) * 60000;
const OFFICE_CALL_MAX = Number(process.env.OFFICE_CALL_MAX || 30);

async function sendOfficeCall(c) {
  if (!botEnabled || !/^\d+$/.test(String(c.tg_id))) return;
  const n = Number(c.count || 0);
  if (c.msg_id) await deleteMessage(c.tg_id, c.msg_id).catch(() => {});
  let msgId = '';
  try {
    const sent = await sendMessage(c.tg_id, [
      `🏢 <b>Вас вызывают в офис</b>${n ? ` · напоминание ${n + 1}` : ''}`,
      `От: ${escHtml(c.by_name || 'администратор')} · ${escHtml(new Date(c.created_at).toLocaleTimeString('ru-RU', { timeZone: TZN, hour: '2-digit', minute: '2-digit' }))}`,
      c.note ? `💬 ${escHtml(c.note)}` : '',
      '',
      `Нажмите «Получил», иначе напомню снова через ${Math.round(OFFICE_CALL_EVERY_MS / 60000)} мин.`,
    ].filter((x, i) => x !== '' || i === 3).join('\n'), { replyMarkup: { inline_keyboard: [[{ text: '✅ Получил', callback_data: `ocall:${c.id}` }]] } });
    msgId = String(sent?.message_id || '');
  } catch (e) { console.error('office call:', e.message); }
  await db.query('UPDATE office_calls SET last_at = $1, count = $2, msg_id = $3 WHERE id = $4', [now(), n + 1, msgId, c.id]);
}

async function ackOfficeCall(id, tgId) {
  const [c] = await db.query('SELECT * FROM office_calls WHERE id = $1', [id]);
  if (!c || String(c.tg_id) !== String(tgId)) return { ok: false, reason: 'not_found' };
  if (c.ack_at || c.cancelled_at) return { ok: false, reason: 'done' };
  const at = now();
  await db.query('UPDATE office_calls SET ack_at = $1 WHERE id = $2', [at, id]);
  const [u] = await db.query('SELECT name FROM users WHERE tg_id = $1', [c.tg_id]);
  const t = new Date(at).toLocaleTimeString('ru-RU', { timeZone: TZN, hour: '2-digit', minute: '2-digit' });
  if (c.msg_id && botEnabled) editMessage(c.tg_id, c.msg_id, `🏢 Вызов в офис${c.note ? `\n💬 ${escHtml(c.note)}` : ''}\n\n✅ Вы подтвердили · ${t}`).catch(() => {});
  if (c.by_id && botEnabled && /^\d+$/.test(c.by_id)) sendMessage(c.by_id, `✅ <b>${escHtml(u?.name || '')}</b> получил вызов в офис · ${t}`).catch(() => {});
  await audit({ id: c.tg_id, name: u?.name || '' }, 'Вызов в офис получен', u?.name || '', t);
  return { ok: true };
}

async function officeCallTick() {
  if (!botEnabled) return;
  const due = new Date(Date.now() - OFFICE_CALL_EVERY_MS + 15000).toISOString();
  const rows = await db.query('SELECT * FROM office_calls WHERE ack_at IS NULL AND cancelled_at IS NULL AND count < $1 AND (last_at IS NULL OR last_at <= $2)', [OFFICE_CALL_MAX, due]);
  for (const c of rows) await sendOfficeCall(c);
}
setInterval(() => { officeCallTick().catch((e) => console.error('office tick:', e.message)); }, 60000).unref?.();

route('POST', '/api/admin/office-call', async ({ body, user }) => {
  const tg = str(body.tg_id, 40);
  const [u] = await db.query("SELECT tg_id, name FROM users WHERE tg_id = $1 AND status = 'active'", [tg]);
  must(u, 404, 'Сотрудник не найден');
  must(botEnabled, 400, 'Бот не настроен');
  const [open] = await db.query('SELECT id FROM office_calls WHERE tg_id = $1 AND ack_at IS NULL AND cancelled_at IS NULL', [tg]);
  must(!open, 400, 'Сотрудник уже вызван — ждём подтверждения');
  const c = { id: uid(), tg_id: tg, by_id: user.id, by_name: user.name, note: str(body.note, 300), created_at: now(), count: 0 };
  await db.query('INSERT INTO office_calls (id, tg_id, by_id, by_name, note, created_at, count) VALUES ($1,$2,$3,$4,$5,$6,0)', [c.id, c.tg_id, c.by_id, c.by_name, c.note, c.created_at]);
  addNotification(tg, 'call', `🏢 Вас вызывают в офис${c.note ? `: ${c.note}` : ''}`, {}).catch(() => {});
  await sendOfficeCall(c);
  await audit(user, 'Вызов в офис', u.name, c.note);
  return { ok: true, id: c.id };
}, { access: 'admin' });

route('POST', '/api/admin/office-call/:id/cancel', async ({ params, user }) => {
  const [c] = await db.query('SELECT * FROM office_calls WHERE id = $1', [params.id]);
  must(c, 404, 'Вызов не найден');
  await db.query('UPDATE office_calls SET cancelled_at = $1 WHERE id = $2', [now(), c.id]);
  if (c.msg_id && botEnabled) editMessage(c.tg_id, c.msg_id, '🏢 Вызов в офис отменён').catch(() => {});
  await audit(user, 'Вызов в офис отменён', c.tg_id);
  return { ok: true };
}, { access: 'admin' });

route('GET', '/api/admin/office-calls', async () => {
  const rows = await db.query(`SELECT c.*, u.name FROM office_calls c LEFT JOIN users u ON u.tg_id = c.tg_id
     WHERE c.cancelled_at IS NULL ORDER BY c.created_at DESC LIMIT 20`);
  return { items: rows.map((c) => ({ id: c.id, tg_id: c.tg_id, name: c.name || '', note: c.note, by_name: c.by_name, created_at: c.created_at, ack_at: c.ack_at, count: Number(c.count) })) };
}, { access: 'admin' });

route('GET', '/api/me/office-call', async ({ user }) => {
  const [c] = await db.query('SELECT id, note, by_name, created_at FROM office_calls WHERE tg_id = $1 AND ack_at IS NULL AND cancelled_at IS NULL ORDER BY created_at DESC LIMIT 1', [user.id]);
  return { call: c || null };
});
route('POST', '/api/me/office-call/:id/ack', async ({ params, user }) => ackOfficeCall(params.id, user.id));

// ---------- бонусы и штрафы: бот предлагает в конце месяца, администратор применяет ----------
// Правила редактируются (вкл/выкл, баллы, порог). per_unit — за каждый случай (замечание, неподтверждённый вызов).
const DEFAULT_ADJ_RULES = [
  { id: 'plan_over', kind: 'bonus', label: 'Перевыполнение плана', points: 3, threshold: 110, unit: '% плана', enabled: true },
  { id: 'no_remarks', kind: 'bonus', label: 'Месяц без замечаний', points: 1, threshold: 5, unit: 'выполнено минимум', enabled: true },
  { id: 'fast_app', kind: 'bonus', label: 'Отличная реакция в приложении', points: 1, threshold: 95, unit: '% своевременности', enabled: true },
  { id: 'remark', kind: 'penalty', label: 'Замечание офиса (без типа)', points: 1, threshold: 0, unit: 'за каждое', per_unit: true, enabled: true },
  { id: 'slow_ack', kind: 'penalty', label: 'Медленно подтверждает заявки', points: 1, threshold: 60, unit: '% «Уведомлен» за 5 мин, ниже', enabled: true },
  { id: 'late_start', kind: 'penalty', label: 'Опаздывает на заявки', points: 1, threshold: 70, unit: '% вовремя, ниже', enabled: true },
  { id: 'office_ignored', kind: 'penalty', label: 'Не подтвердил вызов в офис', points: 0.5, threshold: 0, unit: 'за каждый', per_unit: true, enabled: true },
  { id: 'plan_unacked', kind: 'penalty', label: 'Не подтвердил план KPI', points: 0.5, threshold: 0, unit: '', enabled: true },
];
async function adjRules() {
  const saved = (await getSetting('kpi_rules')) || {};
  return DEFAULT_ADJ_RULES.map((r) => ({ ...r, ...(saved[r.id] || {}) }));
}
const monthRange = (month) => {
  const [y, m] = month.split('-').map(Number);
  return { since: zonedIso(y, m, 1, 0, 0, TZN), until: zonedIso(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1, 0, 0, TZN) };
};

/** Бот сам подбирает бонусы и штрафы по правилам: возвращает предложения по каждому специалисту. */
async function suggestAdjustments(month) {
  const rules = (await adjRules()).filter((r) => r.enabled && Number(r.points) > 0);
  const { rows } = await kpiPlanRows(month);
  const { since, until } = monthRange(month);
  const tl = await computeTimeliness(since, until, month);
  const calls = await db.query('SELECT tg_id FROM office_calls WHERE created_at >= $1 AND created_at < $2 AND cancelled_at IS NULL AND ack_at IS NULL', [since, until]);
  const untyped = await db.query("SELECT tg_id FROM notifications WHERE kind = 'remark' AND remark_type = '' AND created_at >= $1 AND created_at < $2", [since, until]);
  const out = [];
  for (const r of rows) {
    const t = tl.find((x) => x.id === r.id) || {};
    const add = (rule, times, why) => {
      if (!times) return;
      const pts = Math.round(Number(rule.points) * times * 100) / 100;
      out.push({ tg_id: r.id, name: r.name, rule: rule.id, points: rule.kind === 'bonus' ? pts : -pts, reason: `${rule.label}: ${why}` });
    };
    const planPct = r.plan > 0 ? ((r.points - (r.adjust || 0)) / r.plan) * 100 : 0; // без уже применённых корректировок
    for (const rule of rules) {
      const th = Number(rule.threshold) || 0;
      if (rule.id === 'plan_over' && r.plan > 0 && planPct >= th) add(rule, 1, `${Math.round(planPct)}% плана`);
      if (rule.id === 'no_remarks' && r.remarks === 0 && r.done >= th) add(rule, 1, `${r.done} выполнено, замечаний 0`);
      if (rule.id === 'fast_app' && t.score != null && t.score >= th && t.tasks >= 3) add(rule, 1, `своевременность ${t.score}%`);
      if (rule.id === 'remark') { const n = untyped.filter((x) => x.tg_id === r.id).length; if (n) add(rule, n, `${n} шт.`); } // замечания с типом уже сняли баллы сразу
      if (rule.id === 'slow_ack' && t.ack_fast_pct != null && t.tasks >= 3 && t.ack_fast_pct < th) add(rule, 1, `за 5 мин подтверждено ${t.ack_fast_pct}%`);
      if (rule.id === 'late_start' && t.start_on_time_pct != null && t.started >= 3 && t.start_on_time_pct < th) add(rule, 1, `вовремя ${t.start_on_time_pct}%`);
      if (rule.id === 'office_ignored') { const n = calls.filter((c) => c.tg_id === r.id).length; if (n) add(rule, n, `${n} шт.`); }
      if (rule.id === 'plan_unacked' && r.sent_at && !r.ack_at) add(rule, 1, 'план отправлен, «Ознакомлен» не нажат');
    }
  }
  return out;
}

/** Сохранить предложения (заменяя прежние нерешённые, решённые по тому же правилу не трогаем). */
async function proposeAdjustments(month) {
  const sug = await suggestAdjustments(month);
  const existing = await db.query('SELECT * FROM kpi_adjust WHERE month = $1', [month]);
  await db.query("DELETE FROM kpi_adjust WHERE month = $1 AND status = 'proposed' AND rule <> 'manual'", [month]);
  let n = 0;
  for (const x of sug) {
    if (existing.some((e) => e.tg_id === x.tg_id && e.rule === x.rule && e.status !== 'proposed')) continue;
    await db.query('INSERT INTO kpi_adjust (id, month, tg_id, rule, points, reason, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [uid(), month, x.tg_id, x.rule, x.points, x.reason, 'proposed', now()]);
    n++;
  }
  return n;
}

async function decideAdjustment(a, apply, actor) {
  await db.query('UPDATE kpi_adjust SET status = $1, decided_at = $2, decided_by = $3 WHERE id = $4', [apply ? 'applied' : 'rejected', now(), actor.name || '', a.id]);
  if (!apply) return;
  const sign = Number(a.points) > 0 ? '+' : '';
  const html = `${Number(a.points) > 0 ? '🎁' : '⚠️'} <b>KPI за ${escHtml(monthRu(a.month))}: ${sign}${String(a.points).replace('.', ',')} балл.</b>\n${escHtml(a.reason)}`;
  addNotification(a.tg_id, 'info', html.replace(/<[^>]+>/g, ''), {}).catch(() => {});
  if (botEnabled && /^\d+$/.test(a.tg_id)) sendMessage(a.tg_id, html).catch(() => {});
}

route('GET', '/api/admin/kpi-adjust', async ({ query }) => {
  const month = /^\d{4}-\d{2}$/.test(query.get('month') || '') ? query.get('month') : curMonth();
  const rows = await db.query(`SELECT a.*, u.name FROM kpi_adjust a LEFT JOIN users u ON u.tg_id = a.tg_id WHERE a.month = $1 ORDER BY u.name, a.created_at`, [month]);
  return { month, rules: await adjRules(), items: rows.map((a) => ({ ...a, points: Number(a.points), name: a.name || a.tg_id })) };
}, { access: 'admin' });

route('POST', '/api/admin/kpi-adjust/suggest', async ({ body, user }) => {
  const month = /^\d{4}-\d{2}$/.test(str(body.month, 7)) ? str(body.month, 7) : curMonth();
  const n = await proposeAdjustments(month);
  await audit(user, 'KPI: рекомендации бонусов/штрафов', monthRu(month), `${n} предложений`);
  return { ok: true, proposed: n };
}, { access: 'admin' });

route('POST', '/api/admin/kpi-adjust', async ({ body, user }) => {
  const month = /^\d{4}-\d{2}$/.test(str(body.month, 7)) ? str(body.month, 7) : curMonth();
  const tg = str(body.tg_id, 40);
  const pts = Number(String(body.points).replace(',', '.'));
  must(Number.isFinite(pts) && pts !== 0 && Math.abs(pts) <= 100, 400, 'Укажите баллы (плюс — бонус, минус — штраф)');
  const reason = str(body.reason, 200);
  must(reason.length >= 3, 400, 'Напишите причину');
  const [u] = await db.query('SELECT tg_id FROM users WHERE tg_id = $1', [tg]);
  must(u, 404, 'Сотрудник не найден');
  const a = { id: uid(), month, tg_id: tg, rule: 'manual', points: Math.round(pts * 100) / 100, reason };
  await db.query('INSERT INTO kpi_adjust (id, month, tg_id, rule, points, reason, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [a.id, month, tg, 'manual', a.points, reason, 'proposed', now()]);
  await decideAdjustment(a, true, user);
  await audit(user, a.points > 0 ? 'KPI: бонус' : 'KPI: штраф', tg, `${a.points} · ${reason}`);
  return { ok: true };
}, { access: 'admin' });

route('POST', '/api/admin/kpi-adjust/:id/decide', async ({ params, body, user }) => {
  const [a] = await db.query('SELECT * FROM kpi_adjust WHERE id = $1', [params.id]);
  must(a, 404, 'Не найдено');
  if (body.points !== undefined && body.apply) {
    const pts = Number(String(body.points).replace(',', '.'));
    must(Number.isFinite(pts) && Math.abs(pts) <= 100, 400, 'Некорректные баллы');
    await db.query('UPDATE kpi_adjust SET points = $1 WHERE id = $2', [pts, a.id]);
    a.points = pts;
  }
  if (body.undo) {
    must(a.status !== 'proposed', 400, 'Ещё не решено');
    await db.query("UPDATE kpi_adjust SET status = 'proposed', decided_at = NULL, decided_by = '' WHERE id = $1", [a.id]);
    await audit(user, 'KPI: корректировка отменена', a.tg_id, `${a.points} · ${a.reason}`);
    return { ok: true };
  }
  must(a.status === 'proposed', 400, 'Уже решено');
  await decideAdjustment(a, Boolean(body.apply), user);
  await audit(user, body.apply ? 'KPI: корректировка применена' : 'KPI: корректировка отклонена', a.tg_id, `${a.points} · ${a.reason}`);
  return { ok: true };
}, { access: 'admin' });

route('POST', '/api/admin/kpi-adjust/apply-all', async ({ body, user }) => {
  const month = /^\d{4}-\d{2}$/.test(str(body.month, 7)) ? str(body.month, 7) : curMonth();
  const rows = await db.query("SELECT * FROM kpi_adjust WHERE month = $1 AND status = 'proposed'", [month]);
  for (const a of rows) await decideAdjustment(a, true, user);
  await audit(user, 'KPI: все рекомендации применены', monthRu(month), `${rows.length} шт.`);
  return { ok: true, applied: rows.length };
}, { access: 'admin' });

route('PUT', '/api/admin/kpi-rules', async ({ body, user }) => {
  const saved = {};
  for (const r of DEFAULT_ADJ_RULES) {
    const x = (body.rules || []).find((y) => y.id === r.id);
    if (!x) continue;
    const pts = Number(String(x.points).replace(',', '.'));
    const th = Number(String(x.threshold ?? r.threshold).replace(',', '.'));
    must(Number.isFinite(pts) && pts >= 0 && pts <= 50, 400, `Некорректные баллы: ${r.label}`);
    must(Number.isFinite(th) && th >= 0 && th <= 1000, 400, `Некорректный порог: ${r.label}`);
    saved[r.id] = { points: pts, threshold: th, enabled: Boolean(x.enabled) };
  }
  await setSetting('kpi_rules', saved);
  await audit(user, 'KPI: правила бонусов/штрафов изменены');
  return { ok: true, rules: await adjRules() };
}, { access: 'admin' });

// последний день месяца в 18:00 бот сам формирует рекомендации и пишет администраторам
async function adjustTick() {
  if (!botEnabled) return;
  const nowD = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZN, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(nowD);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  const y = get('year'); const m = get('month'); const d = get('day'); const h = get('hour') % 24;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d !== last || h < 18) return;
  const month = `${y}-${String(m).padStart(2, '0')}`;
  if ((await getSetting('kpi_adjust_sent')) === month) return;
  await setSetting('kpi_adjust_sent', month);
  const n = await proposeAdjustments(month);
  const base = publicBase();
  const html = `🤖 <b>KPI за ${escHtml(monthRu(month))}: рекомендации готовы</b>\nБот предложил ${n} бонусов и штрафов по правилам. Проверьте и примените до конца месяца: Админ-панель → План KPI → «Бонусы и штрафы».`;
  for (const aid of await adminIds(db)) sendMessage(aid, html, base ? { replyMarkup: { inline_keyboard: [[{ text: 'Открыть', web_app: { url: base } }]] } } : {}).catch(() => {});
  await audit({ id: 'system', name: 'Система' }, 'KPI: рекомендации сформированы', monthRu(month), `${n} шт.`);
}
setInterval(() => { adjustTick().catch((e) => console.error('adjust tick:', e.message)); }, 60000 * 5).unref?.();

// ---------- еженедельный разбор: бот готовит сообщения сотрудникам, администратор подтверждает отправку ----------
const COACH_GOOD = 90; // от этого % своевременности — похвала
const COACH_BAD = 80;  // ниже — рекомендация работать активнее

function coachText(name, t) {
  const first = String(name || '').split(/\s+/)[0] || '';
  if (t.score != null && t.score >= COACH_GOOD) {
    return `👏 ${first}, спасибо за отличную неделю в приложении: своевременность ${t.score}%. Так держать!`;
  }
  const tips = [];
  if (t.ack_fast_pct != null && t.ack_fast_pct < 80) {
    tips.push(t.ack_avg_min != null
      ? `• подтверждайте новые заявки кнопкой «Уведомлен» сразу — сейчас в среднем через ${String(t.ack_avg_min).replace('.', ',')} мин (за 5 минут — ${t.ack_fast_pct}%)`
      : '• подтверждайте новые заявки кнопкой «Уведомлен» сразу, как пришло сообщение');
  }
  if (t.unacked > 0) tips.push(`• не подтверждено заявок: ${t.unacked}`);
  if (t.soon_ok_pct != null && t.soon_ok_pct < 80) tips.push(`• нажимайте «Увидел» на напоминание «Скоро заявка» (сейчас ${t.soon_ok_pct}%)`);
  if (t.start_on_time_pct != null && t.start_on_time_pct < 80) tips.push(`• начинайте выезд вовремя: «Позвонил» → «Еду к клиенту» → «Приступить» (вовремя ${t.start_on_time_pct}%)`);
  if (t.office_ok_pct != null && t.office_ok_pct < 100) tips.push('• подтверждайте вызовы в офис кнопкой «Получил»');
  if (!tips.length) tips.push('• чаще открывайте приложение и отмечайте шаги по заявкам вовремя');
  return `📲 ${first}, итоги недели по работе с приложением: своевременность ${t.score ?? '—'}%.\nЧтобы было лучше:\n${tips.join('\n')}\n\nЭто влияет на KPI и бонусы в конце месяца.`;
}

const weekKey = (d = new Date()) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return `${x.getUTCFullYear()}-W${String(Math.ceil(((x - y0) / 86400000 + 1) / 7)).padStart(2, '0')}`;
};

/** Разбор за последние 7 дней → черновики сообщений (заменяет неотправленные черновики этой недели). */
async function prepareCoach() {
  const week = weekKey();
  const items = await computeTimeliness(new Date(Date.now() - 7 * 86400000).toISOString());
  await db.query("DELETE FROM coach_msgs WHERE week = $1 AND status = 'proposed'", [week]);
  const done = await db.query("SELECT tg_id FROM coach_msgs WHERE week = $1 AND status <> 'proposed'", [week]);
  let n = 0;
  for (const t of items) {
    if (t.tasks < 1 || t.score == null) continue; // не было заявок — нечего разбирать
    if (done.some((x) => x.tg_id === t.id)) continue;
    const kind = t.score >= COACH_GOOD ? 'praise' : t.score < COACH_BAD ? 'improve' : null;
    if (!kind) continue;
    await db.query('INSERT INTO coach_msgs (id, week, tg_id, kind, text, metrics, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [uid(), week, t.id, kind, coachText(t.name, t), JSON.stringify(t), 'proposed', now()]);
    n++;
  }
  return { week, n };
}

async function sendCoach(m, actor, text) {
  const body = str(text ?? m.text, 1500) || m.text;
  if (botEnabled && /^\d+$/.test(m.tg_id)) await sendMessage(m.tg_id, escHtml(body)).catch((e) => console.error('coach:', e.message));
  addNotification(m.tg_id, 'info', body, {}).catch(() => {});
  await db.query("UPDATE coach_msgs SET status = 'sent', text = $1, decided_at = $2, decided_by = $3 WHERE id = $4", [body, now(), actor?.name || '', m.id]);
}

// понедельник, 10:00 — бот готовит разбор и просит администратора подтвердить отправку
async function coachTick() {
  if (!botEnabled) return;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZN, weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(new Date());
  const wd = parts.find((p) => p.type === 'weekday')?.value;
  const h = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
  if (wd !== 'Mon' || h < 10) return;
  const week = weekKey();
  if ((await getSetting('coach_week')) === week) return;
  await setSetting('coach_week', week);
  const { n } = await prepareCoach();
  if (!n) return;
  const base = publicBase();
  const html = `🤖 <b>Разбор недели готов</b>\nБот подготовил ${n} сообщений сотрудникам о работе с приложением (похвала и рекомендации). Они уйдут только после вашего подтверждения.`;
  const kb = [[{ text: '✅ Отправить все', callback_data: `coachall:${week}` }]];
  if (base) kb.push([{ text: 'Посмотреть и изменить', web_app: { url: base } }]);
  for (const aid of await adminIds(db)) sendMessage(aid, html, { replyMarkup: { inline_keyboard: kb } }).catch(() => {});
}
setInterval(() => { coachTick().catch((e) => console.error('coach tick:', e.message)); }, 5 * 60000).unref?.();

route('GET', '/api/admin/coach', async () => {
  const rows = await db.query(`SELECT c.*, u.name FROM coach_msgs c LEFT JOIN users u ON u.tg_id = c.tg_id ORDER BY c.created_at DESC LIMIT 60`);
  return { week: weekKey(), items: rows.map((c) => ({ id: c.id, week: c.week, tg_id: c.tg_id, name: c.name || c.tg_id, kind: c.kind, text: c.text, status: c.status, created_at: c.created_at, decided_at: c.decided_at, decided_by: c.decided_by, metrics: (() => { try { return JSON.parse(c.metrics); } catch { return {}; } })() })) };
}, { access: 'admin' });
route('POST', '/api/admin/coach/prepare', async ({ user }) => {
  const r = await prepareCoach();
  await audit(user, 'Разбор недели подготовлен', r.week, `${r.n} сообщений`);
  return { ok: true, ...r };
}, { access: 'admin' });
route('POST', '/api/admin/coach/:id', async ({ params, body, user }) => {
  const [m] = await db.query('SELECT * FROM coach_msgs WHERE id = $1', [params.id]);
  must(m, 404, 'Не найдено');
  must(m.status === 'proposed', 400, 'Уже решено');
  if (body.send) await sendCoach(m, user, body.text);
  else await db.query("UPDATE coach_msgs SET status = 'rejected', decided_at = $1, decided_by = $2 WHERE id = $3", [now(), user.name, m.id]);
  await audit(user, body.send ? 'Сообщение сотруднику отправлено (разбор недели)' : 'Сообщение разбора отклонено', m.tg_id);
  return { ok: true };
}, { access: 'admin' });
route('POST', '/api/admin/coach-send-all', async ({ user }) => {
  const rows = await db.query("SELECT * FROM coach_msgs WHERE status = 'proposed'");
  for (const m of rows) await sendCoach(m, user);
  await audit(user, 'Разбор недели отправлен', '', `${rows.length} сообщений`);
  return { ok: true, sent: rows.length };
}, { access: 'admin' });

// ---------- видео и фото с объектов: специалист присылает, администратор оценивает (+баллы, лимит в месяц) ----------
const DEFAULT_MEDIA = { per_item: 0.2, month_cap: 1 };
async function mediaSettings() { return { ...DEFAULT_MEDIA, ...((await getSetting('media_points')) || {}) }; }
const MEDIA_MAX = 50 * 1024 * 1024; // лимит Telegram для ботов (без хранилища S3/R2)
const TG_INLINE_MAX = 45 * 1024 * 1024; // до этого размера файл из хранилища ещё и отправляется в Telegram «как есть» (с превью)
const mb = (n) => (Number(n) >= 1024 ** 3 ? `${String(Math.round((Number(n) / 1024 ** 3) * 10) / 10).replace('.', ',')} ГБ` : `${Math.max(1, Math.round(Number(n) / 1024 / 1024))} МБ`);

async function readRaw(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, `Файл больше ${mb(limit)} — снимите короче или в меньшем качестве`);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
const mediaPath = (id) => `/r/media/${id}?${signLink(`media:${id}`, 3600 * 24 * 30)}`;
const mediaKb = (id) => ({ inline_keyboard: [[{ text: '👍 Хорошее — начислить баллы', callback_data: `medok:${id}` }], [{ text: '👎 Без баллов', callback_data: `medno:${id}` }]] });

/** Подпись к видео/фото для чата офиса. */
async function mediaCaption(user, kind, visitId, caption) {
  let obj = '';
  if (visitId) { const [v] = await db.query('SELECT company_name, address FROM visits WHERE id = $1', [visitId]); if (v) obj = `${v.company_name} · ${v.address}`; }
  const ms = await mediaSettings();
  const cap = [
    `${kind === 'video' ? '🎬 Видео' : '📷 Фото'} с объекта · <b>${escHtml(user.name)}</b>`,
    obj ? `📍 ${escHtml(obj)}` : '',
    caption ? `💬 ${escHtml(caption)}` : '',
    '',
    `Хорошее — +${String(ms.per_item).replace('.', ',')} балла (до ${String(ms.month_cap).replace('.', ',')} в месяц).`,
  ].filter((x, i) => x !== '' || i === 3).join('\n');
  return { cap, obj };
}
async function mediaTargets() {
  const chat = await officeChat();
  const targets = chat ? [{ id: chat.id, thread: chat.thread_id }] : (await adminIds(db)).map((a) => ({ id: a }));
  must(targets.length, 400, 'Нет чата офиса и администраторов — некуда отправить');
  return targets;
}
/**
 * Отправить в офис одно видео/фото — отдельным сообщением со своими кнопками «Хорошее / Без баллов».
 * buf — файл (до 45–50 МБ, придёт с превью); без buf — большой файл из хранилища: сообщение с кнопкой «▶️ Открыть».
 */
async function postMediaToOffice(id, { buf, mime, name, cap, sizeBytes }) {
  let sent = null; let to = null; let text = 0;
  for (const t of await mediaTargets()) {
    try {
      let m;
      if (buf) m = await sendMedia(t.id, buf, { mime, filename: name, caption: cap, threadId: t.thread, replyMarkup: mediaKb(id) });
      else {
        const open = publicBase() ? [[{ text: `▶️ Открыть (${mb(sizeBytes)})`, url: publicBase() + mediaPath(id) }]] : [];
        m = await sendMessage(t.id, `${cap}\n\n📦 Большой файл, ${mb(sizeBytes)} — откройте по кнопке.`, { threadId: t.thread, replyMarkup: { inline_keyboard: [...open, ...mediaKb(id).inline_keyboard] } });
        text = 1;
      }
      if (!sent) { sent = m; to = t.id; }
    } catch (e) { console.error('media send:', e.message); }
  }
  must(sent, 502, 'Telegram не принял файл — попробуйте ещё раз');
  return {
    to, msgId: String(sent.message_id), text,
    fileId: sent.video?.file_id || sent.photo?.[sent.photo.length - 1]?.file_id || sent.document?.file_id || '',
    thumbId: sent.video?.thumbnail?.file_id || sent.photo?.[0]?.file_id || '',
  };
}

/** Загрузка через сервер (без хранилища): файл до 50 МБ уходит в Telegram. */
route('POST', '/api/media', async ({ req, user, query }) => {
  must(botEnabled, 400, 'Бот не настроен — видео некуда отправить');
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  must(/^(video|image)\//.test(mime), 400, 'Можно загрузить только видео или фото');
  const buf = await readRaw(req, MEDIA_MAX);
  must(buf.length > 1000, 400, 'Пустой файл');
  const id = uid();
  const visitId = str(query.get('visit_id') || '', 64) || null;
  const caption = str(query.get('caption') || '', 300);
  const name = decodeURIComponent(String(req.headers['x-file-name'] || '')).slice(0, 100) || (mime.startsWith('video/') ? 'video.mp4' : 'photo.jpg');
  const kind = mime.startsWith('video/') ? 'video' : 'photo';
  const { cap, obj } = await mediaCaption(user, kind, visitId, caption);
  const r = await postMediaToOffice(id, { buf, mime, name, cap, sizeBytes: buf.length });
  await db.query(`INSERT INTO media_posts (id, tg_id, visit_id, kind, mime, size, file_id, thumb_id, caption, status, chat_id, msg_id, created_at, name)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'proposed',$10,$11,$12,$13)`, [id, user.id, visitId, kind, mime, buf.length, r.fileId, r.thumbId, caption, String(r.to), r.msgId, now(), name]);
  await audit(user, kind === 'video' ? 'Видео с объекта' : 'Фото с объекта', obj || '', `${Math.round(buf.length / 1024)} КБ`);
  return { ok: true, id };
}, { raw: true });

/**
 * Большие файлы (хранилище S3/R2): 1) start — сервер выдаёт подписанную ссылку, 2) телефон загружает файл прямо в хранилище,
 * 3) complete — сервер проверяет, что файл на месте, и отправляет его в офис на оценку. Каждый файл — отдельная оценка.
 */
route('POST', '/api/media/start', async ({ body, user }) => {
  if (!storageOn()) return { mode: 'telegram', max: MEDIA_MAX };
  must(botEnabled, 400, 'Бот не настроен — видео некуда отправить');
  const mime = str(body.mime, 100).toLowerCase();
  must(/^(video|image)\//.test(mime), 400, 'Можно загрузить только видео или фото');
  const size = Number(body.size) || 0;
  must(size > 1000, 400, 'Пустой файл');
  must(size <= uploadMaxBytes(), 413, `Файл больше ${mb(uploadMaxBytes())}`);
  const id = uid();
  const name = str(body.name, 100) || (mime.startsWith('video/') ? 'video.mp4' : 'photo.jpg');
  const key = objectKey('media', id, name);
  const visitId = str(body.visit_id, 64) || null;
  await db.query(`INSERT INTO media_posts (id, tg_id, visit_id, kind, mime, size, file_id, thumb_id, caption, status, created_at, storage_key, name)
    VALUES ($1,$2,$3,$4,$5,$6,'','',$7,'uploading',$8,$9,$10)`, [id, user.id, visitId, mime.startsWith('video/') ? 'video' : 'photo', mime, size, str(body.caption, 300), now(), key, name]);
  return { mode: 's3', id, put_url: presign('PUT', key, 6 * 3600) };
});
route('POST', '/api/media/:id/complete', async ({ params, user }) => {
  const [m] = await db.query('SELECT * FROM media_posts WHERE id = $1', [params.id]);
  must(m && m.tg_id === user.id, 404, 'Файл не найден');
  if (m.status !== 'uploading') return { ok: true, id: m.id };
  const head = await headObject(m.storage_key);
  must(head && head.size > 0, 400, 'Файл не дошёл до хранилища — загрузите ещё раз');
  const { cap, obj } = await mediaCaption(user, m.kind, m.visit_id, m.caption);
  // небольшой файл — ещё и в Telegram «как есть» (превью в чате); большой — ссылкой
  let buf = null;
  if (head.size <= TG_INLINE_MAX) { try { buf = await getObject(m.storage_key); } catch (e) { console.error('media get:', e.message); } }
  const r = await postMediaToOffice(m.id, { buf, mime: m.mime, name: m.name || 'file', cap, sizeBytes: head.size });
  await db.query("UPDATE media_posts SET status = 'proposed', size = $1, file_id = $2, thumb_id = $3, chat_id = $4, msg_id = $5, msg_text = $6, created_at = $7 WHERE id = $8",
    [head.size, r.fileId, r.thumbId, String(r.to), r.msgId, r.text, now(), m.id]);
  await audit(user, m.kind === 'video' ? 'Видео с объекта' : 'Фото с объекта', obj || '', mb(head.size));
  return { ok: true, id: m.id };
});
/** Брошенные загрузки (телефон не дослал файл) — убрать через 12 часов. */
async function cleanupUploads() {
  if (!storageOn()) return;
  const old = new Date(Date.now() - 12 * 3600000).toISOString();
  for (const m of await db.query("SELECT id, storage_key FROM media_posts WHERE status = 'uploading' AND created_at < $1", [old])) { await db.query('DELETE FROM media_posts WHERE id = $1', [m.id]); deleteObject(m.storage_key); }
  for (const f of await db.query('SELECT id, storage_key FROM job_files WHERE ready = 0 AND created_at < $1', [old])) { await db.query('DELETE FROM job_files WHERE id = $1', [f.id]); deleteObject(f.storage_key); }
}
setInterval(() => { cleanupUploads().catch((e) => console.error('uploads cleanup:', e.message)); }, 3600000).unref?.();
/** Загрузка не удалась или отменена — убрать черновик. */
route('DELETE', '/api/media/:id/upload', async ({ params, user }) => {
  const [m] = await db.query("SELECT * FROM media_posts WHERE id = $1 AND status = 'uploading'", [params.id]);
  if (!m || m.tg_id !== user.id) return { ok: true };
  await db.query('DELETE FROM media_posts WHERE id = $1', [m.id]);
  deleteObject(m.storage_key);
  return { ok: true };
});

async function decideMedia(m, approve, actor, pointsOverride) {
  const ms = await mediaSettings();
  let pts = 0; let note = '';
  if (approve) {
    const month = curMonth();
    const [u] = await db.query("SELECT COALESCE(SUM(points), 0) AS s FROM kpi_adjust WHERE tg_id = $1 AND month = $2 AND rule = 'media' AND status = 'applied'", [m.tg_id, month]);
    const used = Number(u?.s) || 0;
    const want = pointsOverride != null ? Number(pointsOverride) : Number(ms.per_item);
    pts = Math.max(0, Math.min(want, Number(ms.month_cap) - used));
    pts = Math.round(pts * 100) / 100;
    if (pts < want) note = pts > 0 ? ` (лимит месяца: начислено ${pts})` : ' (лимит месяца исчерпан)';
    if (pts > 0) {
      const aid = uid();
      await db.query("INSERT INTO kpi_adjust (id, month, tg_id, rule, points, reason, status, created_at, decided_at, decided_by) VALUES ($1,$2,$3,'media',$4,$5,'applied',$6,$6,$7)",
        [aid, month, m.tg_id, pts, `${m.kind === 'video' ? 'Видео' : 'Фото'} с объекта — хорошее`, now(), actor?.name || '']);
      m.adjust_id = aid;
    }
  }
  await db.query('UPDATE media_posts SET status = $1, points = $2, adjust_id = $3, decided_at = $4, decided_by = $5 WHERE id = $6',
    [approve ? 'approved' : 'rejected', approve ? pts : null, m.adjust_id || null, now(), actor?.name || '', m.id]);
  const label = m.kind === 'video' ? 'видео' : 'фото';
  const text = approve
    ? `👍 Ваше ${label} с объекта оценили${pts > 0 ? `: <b>+${String(pts).replace('.', ',')} балла</b> в KPI` : ''}${note}. Спасибо!`
    : `Ваше ${label} посмотрели — в этот раз без баллов. Снимайте объект подробнее: до/после, места обработки, крупные планы.`;
  addNotification(m.tg_id, 'info', text.replace(/<[^>]+>/g, ''), {}).catch(() => {});
  if (botEnabled && /^\d+$/.test(m.tg_id)) sendMessage(m.tg_id, text).catch(() => {});
  if (m.chat_id && m.msg_id && botEnabled) {
    const html = `${m.kind === 'video' ? '🎬 Видео' : '📷 Фото'} с объекта\n${approve ? `👍 Хорошее · +${String(pts).replace('.', ',')} б` : '👎 Без баллов'}${note} · ${escHtml(actor?.name || '')}`;
    if (Number(m.msg_text)) {
      const open = publicBase() ? { inline_keyboard: [[{ text: '▶️ Открыть', url: publicBase() + mediaPath(m.id) }]] } : { inline_keyboard: [] };
      editMessage(m.chat_id, m.msg_id, html, open).catch(() => {});
    } else editCaption(m.chat_id, m.msg_id, html).catch(() => {});
  }
  return { points: pts, note };
}

route('GET', '/api/me/media', async ({ user }) => {
  const rows = await db.query("SELECT id, kind, status, points, created_at, caption FROM media_posts WHERE tg_id = $1 AND status <> 'uploading' ORDER BY created_at DESC LIMIT 20", [user.id]);
  const ms = await mediaSettings();
  const [u] = await db.query("SELECT COALESCE(SUM(points), 0) AS s FROM kpi_adjust WHERE tg_id = $1 AND month = $2 AND rule = 'media' AND status = 'applied'", [user.id, curMonth()]);
  return { settings: ms, month_points: Math.round((Number(u?.s) || 0) * 100) / 100, items: rows.map((r) => ({ ...r, points: r.points == null ? null : Number(r.points) })) };
});

route('GET', '/api/admin/media', async ({ query }) => {
  const where = [];
  const args = [];
  const st = query.get('status') || '';
  if (['proposed', 'approved', 'rejected'].includes(st)) { args.push(st); where.push(`m.status = $${args.length}`); }
  const tech = query.get('tech') || '';
  if (tech) { args.push(tech); where.push(`m.tg_id = $${args.length}`); }
  const kind = query.get('kind') || '';
  if (['video', 'photo'].includes(kind)) { args.push(kind); where.push(`m.kind = $${args.length}`); }
  const month = query.get('month') || '';
  if (/^\d{4}-\d{2}$/.test(month)) { const r = monthRange(month); args.push(r.since, r.until); where.push(`m.created_at >= $${args.length - 1} AND m.created_at < $${args.length}`); }
  where.push("m.status <> 'uploading'");
  const rows = await db.query(`SELECT m.*, u.name, v.company_name, v.address FROM media_posts m LEFT JOIN users u ON u.tg_id = m.tg_id LEFT JOIN visits v ON v.id = m.visit_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE WHEN m.status = 'proposed' THEN 0 ELSE 1 END, m.created_at DESC LIMIT 200`, args);
  const all = await db.query("SELECT tg_id, status, points FROM media_posts WHERE status <> 'uploading'");
  const techs = await db.query("SELECT DISTINCT m.tg_id, u.name FROM media_posts m LEFT JOIN users u ON u.tg_id = m.tg_id ORDER BY u.name");
  return {
    settings: await mediaSettings(),
    stats: {
      total: all.length, proposed: all.filter((x) => x.status === 'proposed').length,
      approved: all.filter((x) => x.status === 'approved').length, rejected: all.filter((x) => x.status === 'rejected').length,
      points: Math.round(all.reduce((s2, x) => s2 + (Number(x.points) || 0), 0) * 100) / 100,
    },
    techs: techs.map((t) => ({ id: t.tg_id, name: t.name || t.tg_id })),
    items: rows.map((m) => ({
      id: m.id, tg_id: m.tg_id, name: m.name || m.tg_id, kind: m.kind, size: Number(m.size), caption: m.caption, status: m.status,
      points: m.points == null ? null : Number(m.points), created_at: m.created_at, decided_by: m.decided_by, decided_at: m.decided_at,
      object: m.company_name ? `${m.company_name} · ${m.address}` : '', url: mediaPath(m.id), download_url: `${mediaPath(m.id)}&dl=1`, visit_id: m.visit_id, stored: Boolean(m.storage_key),
    })),
  };
}, { access: 'admin' });

/** Прислать файл администратору в Telegram (любого размера — по file_id). */
route('POST', '/api/admin/media/:id/send-me', async ({ params, user }) => {
  const [m] = await db.query('SELECT m.*, u.name FROM media_posts m LEFT JOIN users u ON u.tg_id = m.tg_id WHERE m.id = $1', [params.id]);
  must(m && (m.file_id || m.storage_key), 404, 'Файл не найден');
  must(botEnabled, 400, 'Бот не настроен');
  if (!m.file_id) {
    await sendMessage(user.id, `${m.kind === 'video' ? '🎬' : '📷'} ${escHtml(m.name || '')}${m.caption ? ` · ${escHtml(m.caption)}` : ''} · ${mb(m.size)}`,
      { replyMarkup: { inline_keyboard: [[{ text: '▶️ Открыть / скачать', url: objectUrl(m.storage_key, { expires: 7 * 86400 }) }]] } });
    return { ok: true };
  }
  const method = m.kind === 'video' ? 'sendVideo' : 'sendPhoto';
  await tgCall(method, { chat_id: user.id, [m.kind === 'video' ? 'video' : 'photo']: m.file_id, caption: `${m.kind === 'video' ? '🎬' : '📷'} ${m.name || ''}${m.caption ? ` · ${m.caption}` : ''}`.slice(0, 1000) });
  return { ok: true };
}, { access: 'admin' });

/** Переоценить: вернуть на оценку (баллы снимаются). */
route('POST', '/api/admin/media/:id/reset', async ({ params, user }) => {
  const [m] = await db.query('SELECT * FROM media_posts WHERE id = $1', [params.id]);
  must(m, 404, 'Не найдено');
  if (m.adjust_id) await db.query('DELETE FROM kpi_adjust WHERE id = $1', [m.adjust_id]);
  await db.query("UPDATE media_posts SET status = 'proposed', points = NULL, adjust_id = NULL, decided_at = NULL, decided_by = '' WHERE id = $1", [m.id]);
  await audit(user, 'Видео/фото: оценка отменена', m.tg_id, m.points ? `снято ${m.points} б` : '');
  return { ok: true };
}, { access: 'admin' });

route('POST', '/api/admin/media/:id/decide', async ({ params, body, user }) => {
  const [m] = await db.query('SELECT * FROM media_posts WHERE id = $1', [params.id]);
  must(m, 404, 'Не найдено');
  must(m.status === 'proposed', 400, 'Уже оценено');
  const pts = body.points === undefined || body.points === null || body.points === '' ? null : Number(String(body.points).replace(',', '.'));
  must(pts === null || (Number.isFinite(pts) && pts >= 0 && pts <= 10), 400, 'Некорректные баллы');
  const r = await decideMedia(m, Boolean(body.approve), user, pts);
  await audit(user, body.approve ? 'Видео/фото оценено' : 'Видео/фото без баллов', m.tg_id, body.approve ? `+${r.points}${r.note}` : '');
  return { ok: true, ...r };
}, { access: 'admin' });

route('PUT', '/api/admin/media-settings', async ({ body, user }) => {
  const per = Number(String(body.per_item ?? '').replace(',', '.'));
  const cap = Number(String(body.month_cap ?? '').replace(',', '.'));
  must(Number.isFinite(per) && per >= 0 && per <= 10, 400, 'Некорректные баллы за видео/фото');
  must(Number.isFinite(cap) && cap >= 0 && cap <= 100, 400, 'Некорректный лимит в месяц');
  await setSetting('media_points', { per_item: Math.round(per * 100) / 100, month_cap: Math.round(cap * 100) / 100 });
  await audit(user, 'Баллы за видео/фото изменены', `+${per} за шт.`, `лимит ${cap} в месяц`);
  return { ok: true };
}, { access: 'admin' });

route('GET', '/api/me/plan', async ({ user }) => {
  if (user.isAdmin) return { plan: null };
  const { rows, month, month_label: label, settings } = await kpiPlanRows(curMonth());
  const r = rows.find((x) => x.id === user.id);
  return { plan: r ? { ...r, month, month_label: label, weights: { plan: settings.w_plan, on_time: settings.w_on_time, quality: settings.w_quality } } : null };
});
route('POST', '/api/me/plan/ack', async ({ user }) => ({ ok: await ackPlan(curMonth(), user.id) }));

// ---------- дашборд заявок ----------

// Обнулить счётчик отменённых заявок: отменённые за период убираются из списков и счётчиков (история KPI сохраняется)
route('POST', '/api/admin/cancelled/reset', async ({ body, user }) => {
  const days = body.period === 'month' ? 31 : 7;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [r] = await db.query("SELECT COUNT(*) AS n FROM tasks WHERE status = 'cancelled' AND archived_at IS NULL AND updated_at >= $1", [since]);
  await db.query("UPDATE tasks SET archived_at = $1 WHERE status = 'cancelled' AND archived_at IS NULL AND updated_at >= $2", [now(), since]);
  await audit(user, 'Обнулён счётчик отменённых заявок', days === 7 ? 'за неделю' : 'за месяц', `${r.n} шт.`);
  return { ok: true, count: Number(r.n) };
}, { access: 'admin' });

route('GET', '/api/admin/cancelled/count', async () => {
  const c = async (days) => Number((await db.query("SELECT COUNT(*) AS n FROM tasks WHERE status = 'cancelled' AND archived_at IS NULL AND updated_at >= $1",
    [new Date(Date.now() - days * 86400000).toISOString()]))[0].n);
  return { week: await c(7), month: await c(31) };
}, { access: 'admin' });

route('GET', '/api/admin/tasks-stats', async ({ query }) => {
  const { from, to, fromIso, toIso } = periodFilter(query);
  const rows = await db.query(
    `SELECT t.*, u.name AS tech_name FROM tasks t LEFT JOIN users u ON u.tg_id = t.tech_tg_id
     WHERE t.created_at >= $1 AND t.created_at <= $2 AND t.status <> 'void' ORDER BY t.created_at`, [fromIso, toIso],
  );
  const openAll = await db.query(`SELECT t.*, u.name AS tech_name FROM tasks t LEFT JOIN users u ON u.tg_id = t.tech_tg_id WHERE t.status IN ('new', 'in_progress')`);
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const overdue = openAll.filter((t) => t.status === 'new' && t.planned_at && t.planned_at < todayStart);
  const by = (st) => rows.filter((t) => t.status === st).length;
  const techs = {};
  for (const t of rows) {
    const k = t.tech_name || t.tech_tg_id;
    techs[k] ||= { name: k, total: 0, done: 0, open: 0, cancelled: 0 };
    techs[k].total++;
    if (t.status === 'done') techs[k].done++;
    else if (t.status === 'cancelled') techs[k].cancelled++;
    else techs[k].open++;
  }
  const doneRows = rows.filter((t) => t.status === 'done');
  const avgHours = doneRows.length
    ? Math.round((doneRows.reduce((s, t) => s + (new Date(t.updated_at) - new Date(t.created_at)), 0) / doneRows.length / 3600000) * 10) / 10
    : null;
  const days = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86400000)) {
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, n: rows.filter((t) => t.created_at.slice(0, 10) === key).length });
  }
  const pests = {};
  for (const t of rows) for (const p of taskPests(t)) pests[p] = (pests[p] || 0) + 1;
  return {
    from, to, total: rows.length, new: by('new'), in_progress: by('in_progress'), done: by('done'),
    cancelled: rows.filter((t) => t.status === 'cancelled' && !t.archived_at).length,
    client_cancelled: rows.filter((t) => t.status === 'cancelled' && !t.archived_at && t.cancel_reason === 'client').length,
    reschedule_pending: openAll.filter((t) => Number(t.reschedule_req)).length,
    overdue: overdue.length, open_now: openAll.length, avg_hours: avgHours,
    by_tech: Object.values(techs).sort((a, b) => b.total - a.total),
    by_pest: Object.entries(pests).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    daily: days.length <= 93 ? days : [],
    overdue_items: overdue.slice(0, 20).map((t) => shapeTask(t, t.tech_name)),
  };
}, { access: 'admin' });

// ---------- дашборд вредителей ----------

route('GET', '/api/admin/pests-stats', async ({ query }) => {
  const { from, to, items } = await adminVisits(query);
  const done = items.filter((v) => v.status === 'done');
  const pests = {};
  for (const v of done) {
    for (const p of v.pests) {
      pests[p] ||= { name: p, n: 0, high: 0, objects: new Set() };
      pests[p].n++;
      if (['high', 'critical'].includes(v.infestation)) pests[p].high++;
      pests[p].objects.add(`${v.company_name}|${v.address}`);
    }
  }
  const total = Object.values(pests).reduce((s, p) => s + p.n, 0);
  // повторные объекты: один и тот же адрес с вредителями 2+ раза за период
  const objMap = {};
  for (const v of done) {
    if (!v.pests.length) continue;
    const k = `${v.company_name}|${v.address}`;
    objMap[k] ||= { company_name: v.company_name, address: v.address, n: 0, pests: new Set(), last: v.finished_at || v.started_at };
    objMap[k].n++;
    v.pests.forEach((p) => objMap[k].pests.add(p));
  }
  // активность в ловушках за период
  const { fromIso, toIso } = periodFilter(query);
  const trap = await db.query(
    `SELECT i.pest, SUM(i.count) AS cnt, COUNT(*) AS n FROM inspections i
     WHERE i.status = 'activity' AND i.created_at >= $1 AND i.created_at <= $2 GROUP BY i.pest`, [fromIso, toIso],
  );
  // помесячная динамика за 6 месяцев
  const months = [];
  const nowD = new Date();
  for (let k = 5; k >= 0; k--) {
    const d = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() - k, 1));
    months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString('ru-RU', { month: 'short' }) });
  }
  const since = `${months[0].key}-01T00:00:00.000Z`;
  const hist = await db.query("SELECT pests, started_at FROM visits WHERE status = 'done' AND started_at >= $1", [since]);
  const top = Object.values(pests).sort((a, b) => b.n - a.n).slice(0, 5).map((p) => p.name);
  const trend = months.map((m) => {
    const row = { month: m.label };
    for (const p of top) row[p] = 0;
    for (const h of hist) {
      if (h.started_at.slice(0, 7) !== m.key) continue;
      for (const p of visitPests(h)) if (p in row) row[p]++;
    }
    return row;
  });
  const byProc = {};
  for (const v of done) byProc[v.procedure] = (byProc[v.procedure] || 0) + 1;
  return {
    from, to, visits: done.length, total,
    pests: Object.values(pests).map((p) => ({ name: p.name, n: p.n, share: total ? Math.round((p.n / total) * 100) : 0, high: p.high, objects: p.objects.size }))
      .sort((a, b) => b.n - a.n),
    by_procedure: Object.entries(byProc).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    repeat_objects: Object.values(objMap).filter((o) => o.n >= 2).sort((a, b) => b.n - a.n).slice(0, 15)
      .map((o) => ({ ...o, pests: [...o.pests] })),
    traps: trap.filter((t) => t.pest).map((t) => ({ name: t.pest, n: Number(t.n), count: Number(t.cnt) })).sort((a, b) => b.count - a.count),
    trend, trend_keys: top,
  };
}, { access: 'admin' });

route('GET', '/api/admin/stats', async ({ query }) => {
  const { from, to, items } = await adminVisits(query);
  const count = (key) => {
    const m = new Map();
    for (const v of items) m.set(key(v), (m.get(key(v)) || 0) + 1);
    return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  };
  const days = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86400000)) {
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, n: items.filter((v) => v.started_at.slice(0, 10) === key).length });
  }
  const alerts = items.filter((v) => ['high', 'critical'].includes(v.infestation) || v.preparation === 'none').slice(0, 20);
  return {
    from, to,
    total: items.length,
    done: items.filter((v) => v.status === 'done').length,
    open: items.filter((v) => v.status === 'open').length,
    notes: items.reduce((s, v) => s + v.notes, 0),
    photos: items.reduce((s, v) => s + v.photos, 0),
    high: items.filter((v) => ['high', 'critical'].includes(v.infestation)).length,
    unprepared: items.filter((v) => v.preparation === 'none' || v.preparation === 'partial').length,
    by_procedure: count((v) => v.procedure),
    by_tech: count((v) => v.tech_name),
    by_pest: (() => {
      const m = new Map();
      for (const v of items) for (const p of v.pests) m.set(p, (m.get(p) || 0) + 1);
      return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
    })(),
    daily: days.length <= 93 ? days : [],
    alerts,
  };
}, { access: 'admin' });

route('POST', '/api/admin/export', async ({ body, user }) => {
  const qs = new URLSearchParams();
  for (const k of ['from', 'to', 'tech', 'procedure', 'status', 'q']) if (body[k]) qs.set(k, str(body[k], 100));
  const payload = `export:${qs.toString()}`;
  await audit(user, 'Выгрузка актов', `${qs.get('from') || ''} — ${qs.get('to') || ''}`);
  return { url: `/r/export.csv?${qs.toString()}${qs.toString() ? '&' : ''}${signLink(payload, 600)}` };
}, { access: 'admin' });

route('GET', '/api/admin/audit', async () => {
  const rows = await db.query('SELECT * FROM audit ORDER BY at DESC LIMIT 300');
  return { items: rows };
}, { access: 'admin' });

// ---------- настройки акта ----------

// Печать и подпись исполнителя в акте: своя картинка (JPEG), по умолчанию или без печати
route('GET', '/api/admin/stamp', async () => {
  const custom = await getSetting('stamp');
  let image = custom || null;
  if (!custom) {
    try { image = `data:image/jpeg;base64,${fs.readFileSync(path.resolve(__dirname, '../assets/stamp.jpg')).toString('base64')}`; } catch { image = null; }
  }
  return { mode: custom === false ? 'off' : custom ? 'custom' : 'default', image };
}, { access: 'admin' });
route('PUT', '/api/admin/stamp', async ({ body, user }) => {
  if (body.mode === 'off') await setSetting('stamp', false);
  else if (body.mode === 'default') await db.query("DELETE FROM settings WHERE key = 'stamp'");
  else {
    const img = String(body.image || '');
    must(/^data:image\/jpeg;base64,/.test(img) && img.length < 1500000, 400, 'Нужна картинка JPEG до 1 МБ');
    await setSetting('stamp', img);
  }
  await audit(user, 'Изменена печать в акте', body.mode || 'custom');
  return { ok: true };
}, { access: 'admin' });

// ---------- баллы ----------
// Редактируемый список категорий: { id, label, points, zones: { city, near, far } | null }.
// Если zones задан — балл зависит от удалённости (как у квартиры), иначе фиксированный.
function defaultPointsConfig(old = {}) {
  const t = { ...DEFAULT_POINTS, ...old };
  return {
    cats: POINT_CATS.map((c) => (c.id === 'apartment'
      ? { id: c.id, label: c.label, points: t.apartment_city, zones: { city: t.apartment_city, near: t.apartment_near, far: t.apartment_far } }
      : { id: c.id, label: c.label, points: Number(t[c.id] ?? 1), zones: null })),
    night: t.night, night_from: t.night_from,
    weekday: DEFAULT_WEEKDAY, special: [],
  };
}
// коэффициент за вредителя: баллы объекта × коэффициент (тараканы ×1 — квартира 1 б; клопы ×1,2 — квартира 1,2 б).
// Если в акте несколько вредителей — берётся наибольший. Редактируется в «Баллы сотрудникам».
const DEFAULT_PEST_MULT = { 'Клопы': 1.2 };
const ALL_PESTS = [...new Set(Object.values(PESTS_BY_PROCEDURE).flat())];
// коэффициенты по дням недели: Пн…Вс (воскресенье ×2,5)
const DEFAULT_WEEKDAY = [1, 1, 1, 1, 1, 1, 2.5];
const WEEKDAY_RU = ['понедельник', 'вторник', 'среда', 'суббота', 'пятница', 'суббота', 'воскресенье'];
WEEKDAY_RU[3] = 'четверг';
let lastPointsCfg = null; // для синхронного расчёта коэффициента в shapeTask
async function pointsConfig() {
  const v2 = await getSetting('points_v2');
  const cfg = v2 && Array.isArray(v2.cats) && v2.cats.length ? v2 : defaultPointsConfig((await getSetting('points')) || {}); // перенос старой таблицы
  return lastPointsCfg = {
    ...cfg,
    weekday: Array.isArray(cfg.weekday) && cfg.weekday.length === 7 ? cfg.weekday : DEFAULT_WEEKDAY,
    special: Array.isArray(cfg.special) ? cfg.special : [],
    windows: Array.isArray(cfg.windows) ? cfg.windows : [],
    pest_mult: cfg.pest_mult && typeof cfg.pest_mult === 'object' ? cfg.pest_mult : DEFAULT_PEST_MULT,
    // надбавки за размер объекта: комнаты сверх «включено» и сотки сверх «включено» (0 — выключено)
    extras: { free_rooms: 1, per_room: 0, free_sotki: 0, per_sotka: 0, ...(cfg.extras || {}) },
  };
}
/** Окно повышенного коэффициента: дни недели (0 = Пн) + время «с–по»; «по» 24:00 = до полуночи; если «по» раньше «с» — через полночь. */
function inWindow(w, wd, hm) {
  const days = Array.isArray(w.days) ? w.days.map(Number) : [];
  const from = w.from || '00:00'; const to = w.to || '24:00';
  if (from < to) return days.includes(wd) && hm >= from && hm < to;
  return (days.includes(wd) && hm >= from) || (days.includes((wd + 6) % 7) && hm < to); // через полночь
}
const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const windowLabel = (w) => `${(w.days || []).map((d) => WD_SHORT[d]).join(', ')} ${w.from}–${w.to}`;
const multRu = (m) => `×${String(Math.round(m * 100) / 100).replace('.', ',')}`;
/** Повышенный коэффициент выезда: наибольший из «день недели», «особый период» и заданного вручную для заявки/выезда. */
function visitMult(v, cfg) {
  const t = v.started_at || v.finished_at || new Date().toISOString();
  const day = new Date(t).toLocaleDateString('en-CA', { timeZone: TZN });
  const wd = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Пн
  const cands = [{ m: Number(cfg.weekday?.[wd]) || 1, why: WEEKDAY_RU[wd] }];
  for (const sp of cfg.special || []) if (sp.from && day >= sp.from && day <= (sp.to || sp.from)) cands.push({ m: Number(sp.mult) || 1, why: sp.label || 'особый период' });
  if ((cfg.windows || []).length) {
    const hm = new Date(t).toLocaleTimeString('en-GB', { timeZone: TZN, hour: '2-digit', minute: '2-digit', hour12: false }).replace(/^24/, '00');
    for (const w of cfg.windows) if (inWindow(w, wd, hm)) cands.push({ m: Number(w.mult) || 1, why: w.label || windowLabel(w) });
  }
  if (v.mult != null && Number(v.mult) > 0) cands.push({ m: Number(v.mult), why: 'назначен офисом' });
  const best = cands.reduce((a, b) => (b.m > a.m ? b : a), { m: 1, why: '' });
  return best.m > 1 ? best : { m: 1, why: '' };
}
// ---------- удалённость по геолокации (защита от «до 100 км», когда объект в Кишинёве) ----------
const GEO_CENTER = { lat: Number(process.env.GEO_CENTER_LAT || 47.0105), lon: Number(process.env.GEO_CENTER_LON || 28.8638) }; // центр Кишинёва
const CITY_RADIUS_KM = Number(process.env.CITY_RADIUS_KM || 15);
const NEAR_LIMIT_KM = Number(process.env.NEAR_LIMIT_KM || 100);
const ZONE_RANK = { city: 0, near: 1, far: 2 };
function kmFromCenter(lat, lon) {
  const R = 6371; const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat - GEO_CENTER.lat); const dLon = rad(lon - GEO_CENTER.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(GEO_CENTER.lat)) * Math.cos(rad(lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10;
}
const zoneFromKm = (km) => (km <= CITY_RADIUS_KM ? 'city' : km <= NEAR_LIMIT_KM ? 'near' : 'far');
/** Можно ли засчитать удалённость: «Кишинёв» — всегда; дальше — только если подтверждено геолокацией или задано офисом. */
function zoneAllowed(v, zone) {
  if (!zone || zone === 'city') return true;
  if (v.zone_src === 'admin' && v.point_zone === zone) return true;
  if (v.geo_km == null) return false;
  return ZONE_RANK[zoneFromKm(Number(v.geo_km))] >= ZONE_RANK[zone];
}
/** Удалённость без выбора дезинсектора: задал офис → как задал; есть геолокация → по километрам; нет → «Кишинёв». */
const autoZone = (v) => (v.zone_src === 'admin' && v.point_zone ? v.point_zone : v.geo_km != null ? zoneFromKm(Number(v.geo_km)) : 'city');
const pointCatLabel = (t) => {
  const c = (lastPointsCfg?.cats || []).find((x) => x.id === t.point_cat);
  if (!c) return '';
  const z = c.zones ? POINT_ZONES.find((x) => x.id === (t.point_zone || 'city'))?.label : '';
  return `${c.label}${z ? ` · ${z}` : ''}`;
};
const pointCatsPublic = (cfg) => cfg.cats.map((c) => ({ id: c.id, label: c.label, zoned: Boolean(c.zones), points: c.points, zones: c.zones }));

const localHour = (iso) => Number(new Date(iso).toLocaleString('en-GB', { timeZone: process.env.TZ_DISPLAY || 'Europe/Chisinau', hour: '2-digit', hour12: false })) % 24;
/** Категория по умолчанию: жилое → квартира, кухня/ресторан → ресторан; зона — Кишинёв, если адрес в Кишинёве. */
function pointDefaults(v) {
  const prem = visitPremises(v);
  const cat = v.point_cat || (prem.includes('living') || v.rooms ? 'apartment' : prem.includes('kitchen') ? 'restaurant' : '');
  // «Кишинёв» подставляем, только если он явно есть в адресе (город по умолчанию в акте не считается)
  const inCity = /chi[șşs]in[ăa]u|кишин/i.test(String(v.address || ''));
  return { cat, zone: v.point_zone || (inCity ? 'city' : '') };
}
/** Баллы за выезд: категория (+ удалённость, если у категории она есть) + надбавка за работу вечером. */
function calcPoints(v, cfg) {
  const { cat, zone } = pointDefaults(v);
  const c = cfg.cats.find((x) => x.id === cat);
  if (!cat || !c) return { points: null, detail: '' };
  const z = zone || 'city';
  const base = c.zones ? Number(c.zones[z] ?? c.points) : Number(c.points);
  const t = v.finished_at || v.started_at;
  const h = t ? localHour(t) : 12;
  const hs = v.started_at ? localHour(v.started_at) : h;
  const from = Number(cfg.night_from) || 20;
  const night = (h >= from || h < 6 || hs >= from) ? Number(cfg.night) || 0 : 0;
  const zoneLabel = c.zones ? POINT_ZONES.find((x) => x.id === z)?.label : '';
  const mult = visitMult(v, cfg);
  // вредитель с наибольшим коэффициентом (тараканы ×1, клопы ×1,2 …)
  const pestTop = visitPests(v).map((p) => ({ p, k: Number(cfg.pest_mult?.[p]) || 1 })).reduce((a, b) => (b.k > a.k ? b : a), { p: '', k: 1 });
  const ex = cfg.extras || {};
  const extraRooms = Number(ex.per_room) > 0 && Number(v.rooms) > Number(ex.free_rooms || 0) ? (Number(v.rooms) - Number(ex.free_rooms || 0)) * Number(ex.per_room) : 0;
  const extraSotki = Number(ex.per_sotka) > 0 && Number(v.sotki) > Number(ex.free_sotki || 0) ? (Number(v.sotki) - Number(ex.free_sotki || 0)) * Number(ex.per_sotka) : 0;
  const extra = Math.round((extraRooms + extraSotki) * 100) / 100;
  const points = Math.round(((base || 0) + night + extra) * pestTop.k * mult.m * 100) / 100;
  return {
    points, mult: mult.m,
    detail: [`${c.label}${zoneLabel ? ` · ${zoneLabel}` : ''}${c.zones && v.geo_km != null ? ` (📍 ${String(v.geo_km).replace('.', ',')} км)` : ''}: ${base || 0}`, night ? `после ${from}:00: +${night}` : '', extraRooms ? `комнат ${v.rooms}: +${String(r2(extraRooms)).replace('.', ',')}` : '', extraSotki ? `${String(v.sotki).replace('.', ',')} сот.: +${String(r2(extraSotki)).replace('.', ',')}` : '', pestTop.k !== 1 ? `${pestTop.p} ${multRu(pestTop.k)}` : '', mult.m > 1 ? `${multRu(mult.m)} (${mult.why})` : ''].filter(Boolean).join(' · '),
  };
}

/**
 * Командный выезд: баллы объекта — каждому участнику полностью; стоимость заказа делится поровну (в «Выполнено» и KPI).
 * Ответственному — в самом акте (visits.points = доля), остальным — строки KPI «Командный выезд» (kpi_adjust, ref = visit).
 * total = null → убрать доли (акт снова открыт, аннулирован или удалён).
 */
async function syncTeamShares(visitId, total, finishedAt) {
  await db.query("DELETE FROM kpi_adjust WHERE ref = $1 AND rule = 'team'", [`visit:${visitId}`]);
  const [v] = await db.query('SELECT * FROM visits WHERE id = $1', [visitId]);
  if (!v) return;
  const team = taskTeam(v);
  if (!team.length && v.points_total != null) { await db.query('UPDATE visits SET points = points_total, points_total = NULL WHERE id = $1', [visitId]); return; }
  if (!team.length || total == null) return;
  const share = Number(total); // баллы — каждому полностью (делится только стоимость заказа)
  await db.query('UPDATE visits SET points_total = $1, points = $2 WHERE id = $3', [Number(total), share, visitId]);
  const month = monthKeyTz(finishedAt || v.finished_at || now());
  for (const id of team) {
    await db.query("INSERT INTO kpi_adjust (id, month, tg_id, rule, points, reason, status, created_at, decided_at, decided_by, ref) VALUES ($1,$2,$3,'team',$4,$5,'applied',$6,$6,'авто',$7)",
      [uid(), month, id, share, `Командный выезд (баллы объекта) · акт № ${actNumber(v)} · ${v.company_name || v.address}`.slice(0, 300), now(), `visit:${visitId}`]);
  }
}

/**
 * Пересчитать баллы завершённых выездов месяца по текущим настройкам (категории, удалённость, вредители, коэффициенты).
 * Акты с баллами, исправленными вручную, не трогаются. dry=true — только показать, что изменится.
 */
route('POST', '/api/admin/points/recalc', async ({ body, user }) => {
  const month = /^\d{4}-\d{2}$/.test(String(body.month || '')) ? String(body.month) : curMonth();
  const { since, until } = monthRange(month);
  const cfg = await pointsConfig();
  const rows = await db.query("SELECT * FROM visits WHERE status = 'done' AND finished_at >= $1 AND finished_at < $2", [since, until]);
  let changed = 0; let manual = 0; let before = 0; let after = 0;
  const items = [];
  for (const v of rows) {
    const oldTotal = v.points_total != null ? Number(v.points_total) : Number(v.points) || 0;
    if (Number(v.points_manual)) { manual++; before += oldTotal; after += oldTotal; continue; }
    const np = calcPoints(v, cfg).points;
    const newTotal = np == null ? oldTotal : np;
    before += oldTotal; after += newTotal;
    if (Math.abs(newTotal - oldTotal) < 0.001) continue;
    changed++;
    if (items.length < 50) items.push({ id: v.id, act_no: actNumber(v), company_name: v.company_name, tech_name: v.tech_name, before: r2(oldTotal), after: r2(newTotal) });
    if (!body.dry) {
      await db.query('UPDATE visits SET points = $1 WHERE id = $2', [newTotal, v.id]);
      if (taskTeam(v).length) await syncTeamShares(v.id, newTotal, v.finished_at);
    }
  }
  if (!body.dry && changed) {
    await audit(user, 'Баллы пересчитаны', monthRu(month), `актов изменено: ${changed}, было ${r2(before)} → стало ${r2(after)}`);
  }
  return { ok: true, month, label: monthRu(month), total: rows.length, changed, manual, before: r2(before), after: r2(after), items, dry: Boolean(body.dry) };
}, { access: 'admin' });

route('GET', '/api/admin/points', async () => ({ config: await pointsConfig(), zones: POINT_ZONES, all_pests: ALL_PESTS }), { access: 'admin' });
route('PUT', '/api/admin/points', async ({ body, user }) => {
  const num = (v, name, max = 100) => { const n = Number(String(v ?? '').replace(',', '.')); must(Number.isFinite(n) && n >= 0 && n <= max, 400, `Некорректное значение: ${name}`); return Math.round(n * 100) / 100; };
  must(Array.isArray(body.cats) && body.cats.length >= 1 && body.cats.length <= 40, 400, 'Нужна хотя бы одна категория');
  const ids = new Set();
  const cats = body.cats.map((c, i) => {
    const label = str(c.label, 60);
    must(label.length >= 2, 400, `Название категории ${i + 1} слишком короткое`);
    let id = str(c.id, 30).replace(/[^a-z0-9_]/gi, '') || `cat_${Date.now().toString(36)}_${i}`;
    while (ids.has(id)) id += '_';
    ids.add(id);
    const zones = c.zones ? { city: num(c.zones.city, `${label} · Кишинёв`), near: num(c.zones.near, `${label} · до 100 км`), far: num(c.zones.far, `${label} · дальше`) } : null;
    return { id, label, points: zones ? zones.city : num(c.points, label), zones };
  });
  const mnum = (v, name) => { const x = num(v, name, 10); must(x >= 0.1, 400, `Коэффициент «${name}» — от 0,1 до 10`); return x; };
  const wdNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const weekday = Array.isArray(body.weekday) && body.weekday.length === 7 ? body.weekday.map((x, i) => mnum(x, wdNames[i])) : DEFAULT_WEEKDAY;
  must(!body.special || (Array.isArray(body.special) && body.special.length <= 50), 400, 'Слишком много периодов');
  const special = (body.special || []).map((sp, i) => {
    const from = str(sp.from, 10); const to = str(sp.to, 10) || from;
    must(/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && to >= from, 400, `Период ${i + 1}: укажите даты «с» и «по»`);
    return { label: str(sp.label, 60) || 'Особый период', from, to, mult: mnum(sp.mult, str(sp.label, 60) || `период ${i + 1}`) };
  });
  must(!body.windows || (Array.isArray(body.windows) && body.windows.length <= 30), 400, 'Слишком много окон');
  const hmOk = (x) => /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(x);
  const windows = (body.windows || []).map((w, i) => {
    const days = [...new Set((Array.isArray(w.days) ? w.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    const from = str(w.from, 5) || '00:00'; const to = str(w.to, 5) || '24:00';
    must(days.length > 0, 400, `Окно ${i + 1}: выберите дни недели`);
    must(hmOk(from) && hmOk(to) && from !== '24:00' && from !== to, 400, `Окно ${i + 1}: время в формате ЧЧ:ММ`);
    return { days, from, to, mult: mnum(w.mult, `окно ${i + 1}`), label: str(w.label, 60) };
  });
  const pestMult = {};
  if (body.pest_mult && typeof body.pest_mult === 'object') {
    for (const [k, v] of Object.entries(body.pest_mult)) {
      const name = str(k, 60); const x = Number(String(v).replace(',', '.'));
      if (name && Number.isFinite(x) && x > 0 && x !== 1) pestMult[name] = mnum(v, name);
    }
  }
  const prevCfg = await pointsConfig();
  const extras = body.extras && typeof body.extras === 'object' ? {
    free_rooms: num(body.extras.free_rooms ?? 1, 'включено комнат', 50), per_room: num(body.extras.per_room ?? 0, 'за комнату', 20),
    free_sotki: num(body.extras.free_sotki ?? 0, 'включено соток', 1000), per_sotka: num(body.extras.per_sotka ?? 0, 'за сотку', 20),
  } : prevCfg.extras;
  const cfg = { cats, night: num(body.night, 'надбавка за вечер'), night_from: num(body.night_from, 'час вечера', 23), weekday, special, windows: body.windows ? windows : prevCfg.windows, pest_mult: body.pest_mult ? pestMult : prevCfg.pest_mult, extras };
  await setSetting('points_v2', cfg);
  await audit(user, 'Изменены баллы', cats.map((c) => `${c.label}=${c.zones ? `${c.zones.city}/${c.zones.near}/${c.zones.far}` : c.points}`).join(', '), `вечер +${cfg.night} с ${cfg.night_from}:00 · дни ${weekday.join('/')}${special.length ? ` · периодов: ${special.length}` : ''}${windows.length ? ` · окон: ${windows.length}` : ''}`);
  return { ok: true, config: cfg };
}, { access: 'admin' });

/** Администратор вручную исправляет баллы завершённого выезда (с причиной). */
route('PUT', '/api/visits/:id/points', async ({ params, body, user }) => {
  const v = await getVisit(params.id);
  must(v.status === 'done', 400, 'Баллы вручную меняются только у завершённого выезда');
  const reset = body.points === null || body.points === '';
  const n = reset ? null : Number(String(body.points).replace(',', '.'));
  must(reset || (Number.isFinite(n) && n >= 0 && n <= 100), 400, 'Некорректное число баллов');
  const reason = str(body.reason, 200);
  const cat = body.point_cat !== undefined ? str(body.point_cat, 30) : v.point_cat;
  const zone = body.point_zone !== undefined ? str(body.point_zone, 10) : v.point_zone;
  const cfg = await pointsConfig();
  must(!cat || cfg.cats.some((c) => c.id === cat), 400, 'Неизвестная категория');
  let mult = v.mult;
  if (body.mult !== undefined) {
    mult = body.mult === null || body.mult === '' || Number(String(body.mult).replace(',', '.')) === 1 ? null : Number(String(body.mult).replace(',', '.'));
    must(mult == null || (Number.isFinite(mult) && mult > 0 && mult <= 10), 400, 'Коэффициент — от 0,1 до 10');
  }
  const pts = reset ? calcPoints({ ...v, point_cat: cat, point_zone: zone, mult }, cfg).points : Math.round(n * 100) / 100;
  await db.query('UPDATE visits SET points = $1, point_cat = $2, point_zone = $3, points_manual = $4, mult = $5 WHERE id = $6', [pts, cat || '', zone || '', reset ? 0 : 1, mult, v.id]);
  if (taskTeam(v).length) await syncTeamShares(v.id, pts); // для команды — это баллы на всех, делятся заново
  await audit(user, 'Баллы исправлены', `№ ${actNumber(v)} · ${v.company_name}`, `${v.points ?? '—'} → ${pts ?? '—'}${reason ? ` · ${reason}` : ''}`);
  if (!reset && Number(v.points) !== pts) addNotification(v.tech_tg_id, 'info', `Баллы за акт № ${actNumber(v)} (${v.company_name}) изменены: ${v.points ?? '—'} → ${pts}${reason ? ` — ${reason}` : ''}`, {}).catch(() => {});
  return { ok: true, points: pts };
}, { access: 'admin' });

route('PUT', '/api/admin/settings', async ({ body, user }) => {
  const changes = [];
  if (body.task_approval !== undefined) {
    await setSetting('task_approval', Boolean(body.task_approval));
    changes.push(`подтверждение заявок: ${body.task_approval ? 'вкл' : 'выкл'}`);
  }
  if (body.company) {
    const c = {};
    for (const k of ['name', 'fiscal', 'seat', 'rep', 'func', 'tagline', 'declarations', 'annex_declaration']) c[k] = str(body.company[k], ['declarations', 'annex_declaration'].includes(k) ? 5000 : 200);
    must(c.name.length >= 2, 400, 'Укажите название компании');
    await setSetting('company', c);
    changes.push('реквизиты компании');
  }
  if (body.products) {
    const p = {};
    for (const proc of PROCEDURES) {
      const list = Array.isArray(body.products[proc]) ? body.products[proc] : [];
      p[proc] = [...new Set(list.map((x) => str(x, 120)).filter(Boolean))].slice(0, 60);
    }
    await setSetting('products', p);
    changes.push('список препаратов');
  }
  if (body.act_template) {
    must(['ro', 'modern'].includes(body.act_template), 400, 'Неизвестный шаблон');
    await setSetting('act_template', body.act_template);
    changes.push(`шаблон акта: ${body.act_template}`);
  }
  if (changes.length) await audit(user, 'Изменены настройки', changes.join(', '));
  return { company: await companySettings(), products: await productLists(), actTemplate: await actTemplate() };
}, { access: 'admin' });

// ---------- чат офиса ----------

route('GET', '/api/admin/office/chats', async () => {
  let items = (await db.query('SELECT id, title, type FROM tg_chats ORDER BY updated_at DESC')).map((c) => ({ id: c.id, title: c.title, type: c.type }));
  if (!items.length && !webhookActive) {
    try {
      items = await discoverChats();
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  }
  return { items, webhook: webhookActive };
}, { access: 'admin' });

route('POST', '/api/admin/office', async ({ body, user }) => {
  const id = str(body.id, 40);
  must(/^-?\d+$/.test(id), 400, 'Некорректный чат');
  const threadId = /^\d+$/.test(str(body.thread_id, 20)) ? str(body.thread_id, 20) : '';
  const chat = { id, title: str(body.title, 200) || 'Чат офиса', ...(threadId ? { thread_id: threadId } : {}) };
  try {
    await sendMessage(id, `✅ Бот подключён. Сюда будут приходить отчёты о выездах.\nНастроил: ${escHtml(user.name)}`, { threadId });
  } catch (e) {
    throw new HttpError(400, `Не удалось написать в чат: ${e.message}`);
  }
  await setSetting('office_chat', chat);
  await audit(user, 'Подключён чат офиса', chat.title);
  return { office: chat };
}, { access: 'admin' });

route('GET', '/api/companies', async ({ query }) => ({ items: await findCompanies(str(query.get('q'), 100)) }));

// Новый клиент вручную (только своя база)
// «Поделиться адресом»: координаты телефона → город и улица (map.md или OpenStreetMap)
/** Специалист делится геолокацией на объекте: считаем расстояние от Кишинёва и ставим удалённость автоматически. */
route('POST', '/api/visits/:id/geo', async ({ params, body, user }) => {
  const v = await getVisit(params.id);
  must(v.tech_tg_id === user.id || user.isAdmin, 403, 'Это выезд другого специалиста');
  must(v.status === 'open', 400, 'Выезд уже завершён');
  const lat = Number(body.lat); const lon = Number(body.lon);
  must(Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180, 400, 'Некорректные координаты');
  const km = kmFromCenter(lat, lon);
  const zone = zoneFromKm(km);
  const pcat = (await pointsConfig()).cats.find((c) => c.id === pointDefaults(v).cat);
  await db.query('UPDATE visits SET geo_lat = $1, geo_lon = $2, geo_km = $3, geo_at = $4 WHERE id = $5', [lat, lon, km, now(), v.id]);
  // офис задал удалённость в заявке — не трогаем; иначе ставим по геолокации
  if (pcat?.zones && v.zone_src !== 'admin') await db.query("UPDATE visits SET point_zone = $1, zone_src = 'geo' WHERE id = $2", [zone, v.id]);
  return { ok: true, km, zone, zone_label: POINT_ZONES.find((z) => z.id === zone)?.label || '' };
});

route('GET', '/api/geo/reverse', async ({ query }) => {
  try {
    return await reverseGeocode(query.get('lat'), query.get('lon'));
  } catch (e) {
    throw new HttpError(502, `Не удалось определить адрес: ${e.message}`);
  }
});

route('POST', '/api/clients', async ({ body }) => {
  must(!amoEnabled, 400, 'Клиенты ведутся в amoCRM');
  if (body.individual) {
    // физлицо: ФИО, телефон, адрес → клиент «Persoană fizică · ФИО» + объект по адресу
    const fio = str(body.contact, 200);
    const phone = str(body.phone, 50);
    const city = str(body.city, 120);
    const street = str(body.street, 250);
    const address = city || street ? [city, street].filter(Boolean).join(', ') : str(body.address, 300);
    must(phone.replace(/\D/g, '').length >= 8, 400, 'Укажите телефон');
    must(address.length >= 3, 400, 'Укажите адрес');
    const c = await createClient(db, { name: `Persoană fizică · ${fio || phone}`, phone, contact: fio, rep_function: '', legal_address: address });
    const oid = uid();
    await db.query('INSERT INTO objects (id, company_id, company_name, address, created_at) VALUES ($1,$2,$3,$4,$5)', [oid, c.id, c.name, address, now()]);
    return { ...c, addresses: [address], object: { id: oid, address, traps: 0 } };
  }
  const name = str(body.name, 300);
  must(name.length >= 2, 400, 'Укажите название юрлица');
  return createClient(db, {
    name, inn: str(body.inn, 20).replace(/\D/g, ''), phone: str(body.phone, 50), contact: str(body.contact, 200),
    rep_function: str(body.rep_function, 120), legal_address: str(body.legal_address, 300),
  });
});

// Импорт базы клиентов из Excel/CSV: { filename, data: base64 }
route('POST', '/api/clients/import', async ({ body, user }) => {
  must(user.isAdmin, 403, 'Загружать базу может только администратор');
  must(!amoEnabled, 400, 'Клиенты ведутся в amoCRM — импорт отключён');
  const buf = Buffer.from(String(body.data || ''), 'base64');
  must(buf.length > 0, 400, 'Пустой файл');
  try {
    const r = await importClients(db, buf, str(body.filename, 200));
    await audit(user, 'Загрузка базы клиентов', str(body.filename, 200), `новых: ${r.created}, обновлено: ${r.updated}, адресов: ${r.addresses}`);
    return r;
  } catch (e) {
    throw new HttpError(400, e.message);
  }
});

// Объекты (адреса) юрлица. При первом обращении создаются из поля «Адрес» компании в amoCRM.
route('GET', '/api/companies/:companyId/objects', async ({ params }) => {
  let rows = await db.query('SELECT * FROM objects WHERE company_id = $1 ORDER BY created_at', [params.companyId]);
  if (!rows.length) {
    const company = await findCompany(params.companyId);
    must(company, 404, 'Юрлицо не найдено');
    for (const address of company.addresses) {
      await db.query('INSERT INTO objects (id, company_id, company_name, address, created_at) VALUES ($1,$2,$3,$4,$5)',
        [uid(), company.id, company.name, address, now()]);
    }
    rows = await db.query('SELECT * FROM objects WHERE company_id = $1 ORDER BY created_at', [params.companyId]);
  }
  const counts = await db.query(
    `SELECT object_id, COUNT(*) AS n FROM traps WHERE active = 1 AND object_id IN (SELECT id FROM objects WHERE company_id = $1) GROUP BY object_id`,
    [params.companyId],
  );
  const map = Object.fromEntries(counts.map((c) => [c.object_id, Number(c.n)]));
  return { items: rows.map((o) => ({ id: o.id, address: o.address, traps: map[o.id] || 0 })) };
});

route('POST', '/api/companies/:companyId/objects', async ({ params, body }) => {
  const address = str(body.address);
  must(address.length >= 3, 400, 'Укажите адрес');
  const companyName = str(body.company_name) || (await findCompany(params.companyId))?.name;
  must(companyName, 404, 'Юрлицо не найдено');
  const id = uid();
  await db.query('INSERT INTO objects (id, company_id, company_name, address, created_at) VALUES ($1,$2,$3,$4,$5)',
    [id, params.companyId, companyName, address, now()]);
  return { id, address, traps: 0 };
});


// ---------- заявки (сделки amoCRM) ----------

async function ensureObject(companyId, companyName, address) {
  const rows = await db.query('SELECT * FROM objects WHERE company_id = $1', [companyId]);
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const found = rows.find((o) => norm(o.address) === norm(address));
  if (found) return found;
  const obj = { id: uid(), company_id: companyId, company_name: companyName, address, created_at: now() };
  await db.query('INSERT INTO objects (id, company_id, company_name, address, created_at) VALUES ($1,$2,$3,$4,$5)',
    [obj.id, obj.company_id, obj.company_name, obj.address, obj.created_at]);
  return obj;
}

async function visitsForLeads(ids) {
  if (!ids.length) return {};
  const ph = ids.map((_, i) => `$${i + 1}`).join(',');
  const rows = await db.query(`SELECT id, lead_id, status, started_at FROM visits WHERE lead_id IN (${ph}) ORDER BY started_at`, ids);
  const map = {};
  for (const r of rows) if (!map[r.lead_id] || r.status === 'open') map[r.lead_id] = r; // открытый выезд приоритетнее
  return map;
}

route('GET', '/api/leads', async ({ user }) => {
  if (!leadsEnabled) return { enabled: false, items: [] };
  const leads = await listLeads(user.id);
  const visits = await visitsForLeads(leads.map((l) => l.id));
  const items = leads
    .map((l) => ({ ...l, visit_id: visits[l.id]?.status === 'open' ? visits[l.id].id : null }))
    .sort((a, b) => String(a.planned_at || '9').localeCompare(String(b.planned_at || '9')));
  return { enabled: true, items };
});

// Начать выезд по заявке: создаёт (или возвращает открытый) выезд, двигает сделку в «В работе».
route('POST', '/api/leads/:id/start', async ({ params, body, user }) => {
  const lead = await getLead(params.id);
  must(lead, 404, 'Заявка не найдена в amoCRM');
  const existing = (await visitsForLeads([lead.id]))[lead.id];
  if (existing?.status === 'open') return { id: existing.id };
  await mustNoOpenVisit(user);

  const address = str(body.address) || lead.address;
  must(address.length >= 3, 400, 'В заявке не указан адрес — введите его');
  const procedure = PROCEDURES.find((p) => p.toLowerCase() === lead.procedure.toLowerCase()) || str(body.procedure, 100);
  must(PROCEDURES.includes(procedure), 400, 'Выберите тип процедуры');

  const obj = await ensureObject(lead.company_id, lead.company_name, address);
  const id = uid();
  await db.query(
    `INSERT INTO visits (id, object_id, company_id, company_name, address, procedure, tech_tg_id, tech_name, status, started_at, lead_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10)`,
    [id, obj.id, obj.company_id, obj.company_name, obj.address, procedure, user.id, user.name, now(), lead.id],
  );
  try { await moveLead(lead.id, 'in_progress'); } catch (e) { console.error(e); }
  return { id };
});

// Справка для настройки amoCRM (ID воронок, этапов, полей, пользователей).
// Открывается в браузере: /api/amo/setup?key=<значение REPORT_SECRET из панели Render>
route('GET', '/api/amo/setup', async ({ query }) => {
  const secret = process.env.REPORT_SECRET;
  const key = query.get('key') || '';
  must(secret && key.length === secret.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(secret)), 403, 'Неверный ключ');
  return setupInfo();
}, { auth: false });

// ---------- заявки из тем Telegram ----------

async function userPrefs(tgId) {
  const [r] = await db.query('SELECT prefs FROM users WHERE tg_id = $1', [tgId]);
  try { return JSON.parse(r?.prefs || '{}'); } catch { return {}; }
}

route('POST', '/api/me/prefs', async ({ user, body }) => {
  const prefs = await userPrefs(user.id);
  if (body.all_tasks !== undefined) prefs.all_tasks = Boolean(body.all_tasks);
  if (body.theme !== undefined) prefs.theme = ['light', 'dark', 'auto'].includes(body.theme) ? body.theme : 'dark';
  // вкладки админ-панели: порядок и скрытые («Обзор» и «Настройки» скрыть нельзя)
  const tabId = (x) => str(x, 30).replace(/[^a-z_]/g, '');
  if (Array.isArray(body.tabs_order)) prefs.tabs_order = [...new Set(body.tabs_order.map(tabId).filter(Boolean))].slice(0, 40);
  if (Array.isArray(body.tabs_hidden)) prefs.tabs_hidden = [...new Set(body.tabs_hidden.map(tabId).filter((x) => x && x !== 'overview' && x !== 'settings'))].slice(0, 40);
  if (Array.isArray(body.overview)) { prefs.overview = [...new Set(body.overview.map((x) => str(x, 30)).filter((x) => OVERVIEW_WIDGETS.includes(x)))]; prefs.overview_known = OVERVIEW_WIDGETS; }
  await db.query('UPDATE users SET prefs = $1 WHERE tg_id = $2', [JSON.stringify(prefs), user.id]);
  return { prefs };
});

// Язык интерфейса (RU/RO) — своя настройка у каждого сотрудника.
route('PUT', '/api/me/lang', async ({ user, body }) => {
  const lang = body.lang === 'ro' ? 'ro' : 'ru';
  await db.query('UPDATE users SET lang = $1 WHERE tg_id = $2', [lang, user.id]);
  return { ok: true, lang };
}, { access: 'any', pin: false });

route('GET', '/api/tasks', async ({ user, query }) => {
  await pointsConfig();
  // админ может скрыть чужие заявки у себя (Инструменты → «Заявки всех сотрудников»); ?all=1 — доска заявок в админ-панели
  const prefs = await userPrefs(user.id);
  const all = user.isAdmin && (prefs.all_tasks === true || query.get('all') === '1'); // по умолчанию админ видит только свои заявки
  const rows = await db.query(
    `SELECT t.*, u.name AS tech_name FROM tasks t LEFT JOIN users u ON u.tg_id = t.tech_tg_id
     WHERE t.status IN ('new', 'in_progress') ${all ? '' : 'AND (t.tech_tg_id = $1 OR t.team LIKE $2)'}
     ORDER BY COALESCE(t.planned_at, t.created_at)`,
    all ? [] : [user.id, `%"${user.id}"%`],
  );
  await refreshUserNames();
  const openRows = await db.query("SELECT t.* FROM tasks t WHERE t.status = 'open' ORDER BY COALESCE(t.planned_at, t.created_at)");
  const openForMe = openRows.filter((t) => user.isAdmin || audienceOk(t.audience, user.role));
  const cancelled = await db.query(
    `SELECT t.*, u.name AS tech_name FROM tasks t LEFT JOIN users u ON u.tg_id = t.tech_tg_id
     WHERE t.status = 'cancelled' AND t.archived_at IS NULL AND t.updated_at >= $1 ${all ? '' : 'AND t.tech_tg_id = $2'}
     ORDER BY t.updated_at DESC LIMIT 30`,
    all ? [new Date(Date.now() - 7 * 86400000).toISOString()] : [new Date(Date.now() - 7 * 86400000).toISOString(), user.id],
  );
  return {
    items: rows.map((t) => shapeTask(t, t.tech_name)),
    open_tasks: openForMe.map((t) => shapeTask(t, '')),
    cancelled: cancelled.map((t) => ({ ...shapeTask(t, t.tech_name), cancel_note: t.cancel_note || '', cancelled_at: t.updated_at })),
    month: await monthSummary(user.id),
    all_tasks: all,
    // отправлены технику, но он ещё не нажал «Уведомлен»
    unacked: user.isAdmin
      ? (await db.query(`SELECT t.*, u.name AS tech_name FROM tasks t LEFT JOIN users u ON u.tg_id = t.tech_tg_id
          WHERE t.status = 'new' AND t.ack_at IS NULL AND t.visit_id IS NULL ORDER BY t.created_at`)).map((t) => ({ ...shapeTask(t, t.tech_name), sent_at: t.updated_at || t.created_at }))
      : [],
    pending: user.isAdmin
      ? (await db.query(`SELECT t.*, u.name AS tech_name FROM tasks t LEFT JOIN users u ON u.tg_id = t.tech_tg_id WHERE t.status = 'pending' ORDER BY t.created_at`)).map((t) => shapeTask(t, t.tech_name))
      : [],
    annul_requests: user.isAdmin
      ? (await db.query("SELECT id, company_name, address, tech_name, act_seq, started_at, annul_reason, annul_at FROM visits WHERE annul_req = 1 ORDER BY annul_at"))
        .map((v) => ({ id: v.id, company_name: v.company_name, address: v.address, tech_name: v.tech_name, act_no: actNumber(v), reason: v.annul_reason, at: v.annul_at }))
      : [],
  };
});

/** Личный счётчик сотрудника за текущий месяц (1-го числа обнуляется сам — считаем от начала месяца). */
async function monthSummary(tgId) {
  const since = monthStartIso();
  const n = async (sql, p) => Number((await db.query(sql, p))[0].n);
  const done = await n("SELECT COUNT(*) AS n FROM visits WHERE tech_tg_id = $1 AND status = 'done' AND finished_at >= $2", [tgId, since]);
  const fromTasks = await n("SELECT COUNT(*) AS n FROM tasks WHERE tech_tg_id = $1 AND status = 'done' AND updated_at >= $2", [tgId, since]);
  const open = await n("SELECT COUNT(*) AS n FROM tasks WHERE tech_tg_id = $1 AND status IN ('new', 'in_progress')", [tgId]);
  const remarks = await n("SELECT COUNT(*) AS n FROM notifications WHERE tg_id = $1 AND kind = 'remark' AND created_at >= $2", [tgId, since]);
  const [pr] = await db.query("SELECT SUM(points) AS p FROM visits WHERE tech_tg_id = $1 AND status = 'done' AND finished_at >= $2", [tgId, since]);
  const [ad] = await db.query("SELECT SUM(points) AS p FROM kpi_adjust WHERE tg_id = $1 AND month = $2 AND status = 'applied'", [tgId, curMonth()]);
  const points = Math.round(((Number(pr?.p) || 0) + (Number(ad?.p) || 0)) * 100) / 100;
  const unread = await n('SELECT COUNT(*) AS n FROM notifications WHERE tg_id = $1 AND read_at IS NULL AND created_at >= $2', [tgId, since]);
  return { month_start: since, done, from_tasks: fromTasks, open, remarks, unread, points };
}

/** Номер в международном формате (Молдова по умолчанию): 60356016 / 069123456 → +373 60 356 016 */
function intlPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9 && d.startsWith('0')) d = `373${d.slice(1)}`;
  else if (d.length === 8) d = `373${d}`;
  return `+${d}`;
}

// «Позвонить»: бот присылает номер в личку — в Telegram номер кликабельный и сразу набирается (tel: в мини-приложении на iPhone не работает)
route('POST', '/api/tasks/:id/phone', async ({ params, user }) => {
  const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [params.id]);
  must(t, 404, 'Заявка не найдена');
  must(user.isAdmin || t.tech_tg_id === user.id, 403, 'Это заявка другого специалиста');
  must(t.phone, 400, 'В заявке нет телефона');
  must(botEnabled, 400, 'Бот не настроен');
  const num = intlPhone(t.phone);
  const lines = [
    `📞 <b>${escHtml(num)}</b>`,
    `${escHtml(t.company_name || 'Физлицо')} · заявка № ${t.task_no}`,
    t.address ? `📍 ${escHtml(t.address)}` : '',
    t.planned_at ? `🗓 ${escHtml(fmtTaskDate(t.planned_at, t.has_time))}` : '',
    '',
    'Нажмите на номер, чтобы позвонить.',
  ].filter((x, i, a) => x || i === a.length - 2);
  try {
    await sendMessage(user.id, lines.join('\n'));
  } catch (e) {
    throw new HttpError(400, /chat not found|blocked|initiate/i.test(e.message)
      ? 'Бот не может написать вам: откройте бота и нажмите «Старт»'
      : `Не удалось отправить: ${e.message}`);
  }
  return { ok: true, phone: num, bot: botUsername };
});

// Сменить ответственного (админ): новому технику сразу уходит уведомление с «Уведомлен»
route('POST', '/api/tasks/:id/assign', async ({ params, body, user }) => {
  const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [params.id]);
  must(t, 404, 'Заявка не найдена');
  must(['new', 'in_progress'].includes(t.status) && !t.visit_id, 400, 'Выезд по заявке уже начат');
  const [u] = await db.query("SELECT tg_id, name, role FROM users WHERE tg_id = $1 AND status = 'active'", [str(body.tech_id, 40)]);
  must(u, 400, 'Сотрудник не найден');
  must(!['admin', 'manager'].includes(u.role), 400, 'Заявки назначаются только специалистам — у администраторов выездов нет');
  if (u.tg_id === t.tech_tg_id) return { ok: true };
  if (t.alert_msg_id) deleteMessage(t.tech_tg_id, t.alert_msg_id).catch(() => {});
  await db.query('UPDATE tasks SET tech_tg_id = $1, ack_at = NULL, alert_msg_id = NULL, alert_count = 0, updated_at = $2 WHERE id = $3', [u.tg_id, now(), t.id]);
  const [nt] = await db.query('SELECT * FROM tasks WHERE id = $1', [t.id]);
  await audit(user, 'Заявка переназначена', `№ ${t.task_no}`, `→ ${u.name}`);
  addNotification(u.tg_id, 'task_new', `Заявка № ${t.task_no} · ${t.company_name || 'Физлицо'} · ${t.address}`, { task_id: t.id }).catch(() => {});
  await sendTaskAlert(nt);
  await boostCongrats(nt);
  if (t.confirm_id) {
    editMessage(t.chat_id, t.confirm_id, `${taskSummary(nt, u.name)}\n\n✅ Отправлено технику (назначил ${escHtml(user.name)}).`,
      { inline_keyboard: [[{ text: '❌ Отменить заявку', callback_data: `cancel:${t.id}` }]] }).catch(() => {});
  }
  return { ok: true };
}, { access: 'admin' });

// Перед обработкой: «Позвонил клиенту» / «Звонок не требуется» и «Еду к клиенту»
route('POST', '/api/tasks/:id/progress', async ({ params, body, user }) => {
  const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [params.id]);
  must(t, 404, 'Заявка не найдена');
  must(t.tech_tg_id === user.id, 403, user.isAdmin ? 'Отметки ставит специалист, на которого заявка' : 'Это заявка другого специалиста');
  must(['new', 'in_progress'].includes(t.status), 400, 'Заявка закрыта');
  if (body.en_route === true && !t.visit_id) await mustNoOpenVisit(user);
  if (!t.ack_at) await ackTask(t, user.name);
  // каждая кнопка нажимается один раз; ошибочное нажатие можно отменить тоже только один раз (защита от спама в тему)
  if (body.call !== undefined) {
    const c = str(body.call, 20);
    must(['called', 'not_needed', ''].includes(c), 400, 'Некорректно');
    if (c === '') {
      must(t.call_status, 400, 'Нечего отменять');
      must(!Number(t.call_undo), 400, 'Отметку уже отменяли — второй раз нельзя');
      await db.query("UPDATE tasks SET call_status = '', call_at = NULL, call_undo = 1 WHERE id = $1", [t.id]);
    } else {
      must(!t.call_status, 400, 'Отметка о звонке уже стоит');
      await db.query('UPDATE tasks SET call_status = $1, call_at = $2 WHERE id = $3', [c, now(), t.id]);
      if (c === 'called' && !Number(t.call_undo)) taskReply(t, `📞 ${escHtml(user.name)} созвонился с клиентом`);
      // опыт: позвонил заранее (до времени заявки) — больше
      if (c === 'called') await awardXp(user.id, 'call', !t.planned_at || Date.now() < new Date(t.planned_at).getTime() ? XP.call : XP.call_late, `call:${t.id}`, `звонок клиенту № ${t.task_no}`);
    }
  }
  if (body.en_route === true) {
    must(!t.en_route_at, 400, '«Еду к клиенту» уже отмечено');
    await db.query('UPDATE tasks SET en_route_at = $1 WHERE id = $2', [now(), t.id]);
    await awardXp(user.id, 'route', XP.en_route, `route:${t.id}`, `выехал к клиенту № ${t.task_no}`);
    taskReply(t, Number(t.route_undo) ? `🚗 ${escHtml(user.name)} выехал к клиенту (повторно)` : `🚗 ${escHtml(user.name)} выехал к клиенту`);
  }
  if (body.en_route === false) {
    must(t.en_route_at, 400, 'Нечего отменять');
    must(!t.visit_id, 400, 'Выезд уже начат');
    must(!Number(t.route_undo), 400, '«Еду к клиенту» уже отменяли — второй раз нельзя');
    await db.query('UPDATE tasks SET en_route_at = NULL, route_undo = 1 WHERE id = $1', [t.id]);
    taskReply(t, `↩️ ${escHtml(user.name)}: «выехал» отменено (нажато по ошибке)`);
  }
  const [nt] = await db.query('SELECT * FROM tasks WHERE id = $1', [t.id]);
  return { ok: true, task: shapeTask(nt) };
});

route('POST', '/api/tasks/:id/approve', async ({ params, user }) => {
  const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [params.id]);
  must(t && t.status === 'pending', 400, 'Заявка не ждёт подтверждения');
  await approveTask(t, user.name);
  return { ok: true };
}, { access: 'admin' });

route('POST', '/api/tasks/:id/ack', async ({ params, user }) => {
  const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [params.id]);
  must(t, 404, 'Заявка не найдена');
  must(t.tech_tg_id === user.id, 403, 'Это заявка другого специалиста');
  await ackTask(t, user.name);
  return { ok: true };
});

route('POST', '/api/tasks/:id/start', async ({ params, body, user }) => {
  const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [params.id]);
  must(t, 404, 'Заявка не найдена');
  must(!user.isAdmin, 403, 'Администратор не выезжает — обработку начинает специалист, на которого заявка');
  must(t.tech_tg_id === user.id, 403, 'Это заявка другого специалиста');
  if (!t.ack_at && t.tech_tg_id === user.id) await ackTask(t, user.name);
  // к обработке — только после звонка (или «звонок не требуется») и «Еду к клиенту»
  if (!t.visit_id) await mustNoOpenVisit(user);
  if (!t.visit_id && !user.isAdmin) {
    must(t.call_status, 400, 'Сначала отметьте: позвонили клиенту или звонок не требуется');
    must(t.en_route_at, 400, 'Сначала нажмите «Еду к клиенту»');
  }
  if (!t.visit_id && (await features()).require_geo_start) {
    const [g] = await db.query('SELECT * FROM geo_live WHERE tg_id = $1', [String(user.id)]);
    must(geoFresh(g), 400, 'Сначала поделитесь геолокацией: в боте включите трансляцию геопозиции (📎 → Геопозиция → «Транслировать»), затем начните обработку.');
  }
  if (t.visit_id) {
    const [v] = await db.query('SELECT id, status FROM visits WHERE id = $1', [t.visit_id]);
    if (v?.status === 'open') return { id: v.id };
  }
  must(t.status === 'new' || t.status === 'in_progress', 400, 'Заявка закрыта');
  const procedure = PROCEDURES.includes(t.procedure) ? t.procedure : str(body.procedure, 100);
  must(PROCEDURES.includes(procedure), 400, 'Выберите тип обработки');
  const address = str(body.address) || t.address || t.company_name;
  must(address.length >= 3, 400, 'В заявке нет адреса — укажите его');

  // клиент: ищем в базе по названию, иначе создаём
  let clientId = str(body.client_id, 64);
  // физлицо: без названия фирмы — «Persoană fizică» + телефон, чтобы повторные заявки попадали к тому же клиенту
  const individual = !t.company_name;
  let clientName = t.company_name || (t.phone ? `Persoană fizică · ${t.phone}` : 'Persoană fizică');
  if (!clientId && !amoEnabled) {
    const norm = (x) => String(x || '').toLowerCase().replace(/[«»"'`,.]/g, ' ').replace(/\s+/g, ' ').trim();
    const all = await db.query('SELECT id, name FROM clients');
    const n = norm(clientName);
    const found = all.find((c) => norm(c.name) === n) || (n.length >= 4 ? all.find((c) => norm(c.name).includes(n) || n.includes(norm(c.name))) : null);
    if (found && !(individual && !t.phone)) { clientId = found.id; clientName = found.name; }
    else clientId = (await createClient(db, { name: clientName, phone: t.phone, legal_address: individual ? address : '', rep_function: individual ? '' : 'Administrator' })).id;
  }
  if (!clientId) clientId = `task-${t.id}`;
  const obj = await ensureObject(clientId, clientName, address);
  const [cl] = await db.query('SELECT contact, rep_function FROM clients WHERE id = $1', [clientId]);
  const id = uid();
  await db.query(
    `INSERT INTO visits (id, object_id, company_id, company_name, address, procedure, tech_tg_id, tech_name, status, started_at, client_rep, client_rep_function, locality, pests, area, task_id, rooms, stage, price, location, premises)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [id, obj.id, obj.company_id, obj.company_name, obj.address, procedure, user.id, user.name, now(), cl?.contact || '',
      individual ? (cl?.rep_function || '') : (cl?.rep_function || 'Administrator'),
      localityFromAddress(obj.address), t.pests || '[]', t.area || '', t.id,
      t.rooms || null, t.stage || '', t.price ?? null,
      t.rooms ? `Квартира / дом, ${t.rooms} ${Number(t.rooms) === 1 ? 'комната' : Number(t.rooms) < 5 ? 'комнаты' : 'комнат'}` : '',
      t.rooms ? '["living"]' : '[]'],
  );
  await db.query("UPDATE tasks SET status = 'in_progress', visit_id = $1, updated_at = $2 WHERE id = $3", [id, now(), t.id]);
  if (t.mult != null) await db.query('UPDATE visits SET mult = $1 WHERE id = $2', [Number(t.mult), id]);
  if (taskTeam(t).length) await db.query('UPDATE visits SET team = $1 WHERE id = $2', [JSON.stringify(taskTeam(t)), id]);
  if (t.sotki != null) await db.query('UPDATE visits SET sotki = $1 WHERE id = $2', [Number(t.sotki), id]);
  if (t.point_cat) await db.query('UPDATE visits SET point_cat = $1, point_zone = $2, zone_src = $3 WHERE id = $4', [t.point_cat, t.point_zone || '', t.point_zone ? 'admin' : '', id]);
  taskReply(t, `🚗 <b>${escHtml(user.name)}</b> начал выезд по заявке № ${t.task_no}`);
  await applyShiftGeo(id, user.id).catch((e) => console.error('shift geo:', e.message));
  if (startedOnTime({ planned_at: t.planned_at, has_time: t.has_time, started_at: now() })) await awardXp(user.id, 'on_time', XP.on_time, `ontime:${t.id}`, `вовремя: заявка № ${t.task_no}`);
  return { id };
});

/** «Нажал по ошибке»: вернуть заявку из «В работе» обратно — только пока в выезде ничего не сделано, один раз на заявку. */
route('POST', '/api/visits/:id/undo-start', async ({ params, user }) => {
  const v = await getVisit(params.id);
  must(v.tech_tg_id === user.id, 403, 'Это выезд другого специалиста');
  must(v.status === 'open', 400, 'Выезд уже завершён');
  must(v.task_id, 400, 'Выезд без заявки — его можно только удалить');
  const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [v.task_id]);
  must(t && t.visit_id === v.id, 400, 'Заявка не найдена');
  must(!Number(t.start_undo), 400, 'Отменить начало можно только один раз');
  const n = async (sql) => Number((await db.query(sql, [v.id]))[0].n);
  const done = (await n('SELECT COUNT(*) AS n FROM inspections WHERE visit_id = $1')) + (await n('SELECT COUNT(*) AS n FROM observations WHERE visit_id = $1'));
  must(!done, 400, 'В выезде уже есть отметки или фото — вернуть нельзя');
  await db.query('DELETE FROM photos WHERE visit_id = $1', [v.id]);
  await db.query('DELETE FROM visits WHERE id = $1', [v.id]);
  await db.query("UPDATE tasks SET status = 'new', visit_id = NULL, start_undo = 1, updated_at = $1 WHERE id = $2", [now(), t.id]);
  await audit(user, 'Начало обработки отменено', `Заявка № ${t.task_no} · ${t.company_name || t.address}`, 'нажал по ошибке');
  taskReply(t, `↩️ <b>${escHtml(user.name)}</b> отменил начало обработки по заявке № ${t.task_no} (нажал по ошибке)`);
  return { ok: true, task_id: t.id };
});

// ---------- аннулирование ошибочно выполненной заявки ----------
// Акт удаляется, заявка получает статус 'void' — её нет ни в «Выполнено», ни в KPI, ни в списках.
// Администратор аннулирует сразу; специалист отправляет запрос — администратор подтверждает (в боте или в приложении).
async function annulVisit(v, actor, reason) {
  const actNo = actNumber(v);
  await db.query('DELETE FROM photos WHERE visit_id = $1', [v.id]);
  await db.query('DELETE FROM observations WHERE visit_id = $1', [v.id]);
  await db.query('DELETE FROM inspections WHERE visit_id = $1', [v.id]);
  await db.query('DELETE FROM visits WHERE id = $1', [v.id]);
  await db.query("DELETE FROM kpi_adjust WHERE ref = $1 AND rule = 'team'", [`visit:${v.id}`]);
  let t = null;
  if (v.task_id) {
    [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [v.task_id]);
    await db.query("UPDATE tasks SET status = 'void', visit_id = NULL, archived_at = $1, updated_at = $1 WHERE id = $2", [now(), v.task_id]);
  }
  await audit(actor, 'Выполнение аннулировано', `№ ${actNo} · ${v.company_name}`,
    [`техник: ${v.tech_name}`, t ? `заявка № ${t.task_no}` : 'без заявки', reason && `причина: ${reason}`].filter(Boolean).join('; '));
  addNotification(v.tech_tg_id, 'info', `Выполнение аннулировано: акт № ${actNo} · ${v.company_name}${reason ? ` — ${reason}` : ''}`, {}).catch(() => {});
  if (t) taskReply(t, `🗑 Выполнение по заявке № ${t.task_no} аннулировано (${escHtml(actor.name)})${reason ? `\nПричина: ${escHtml(reason)}` : ''}`);
  if (v.office_sent_at) {
    const chat = await officeChat();
    if (chat) {
      sendMessage(chat.id, `🗑 <b>Акт № ${actNo} аннулирован</b> — выполнен по ошибке\n${escHtml(v.company_name)} · ${escHtml(v.procedure)}${reason ? `\nПричина: ${escHtml(reason)}` : ''}\nАннулировал: ${escHtml(actor.name)}`,
        { threadId: chat.thread_id }).catch((e) => console.error(e.message));
    }
  }
}

route('POST', '/api/visits/:id/annul', async ({ params, body, user }) => {
  const v = await getVisit(params.id);
  must(v.status === 'done', 400, 'Аннулировать можно только завершённый выезд');
  const reason = str(body.reason, 300);
  if (user.isAdmin) {
    await annulVisit(v, user, reason || v.annul_reason);
    return { ok: true, annulled: true };
  }
  must(v.tech_tg_id === user.id, 403, 'Это акт другого специалиста');
  must(!Number(v.annul_req), 400, 'Запрос уже отправлен — ждите решения администратора');
  must(reason.length >= 3, 400, 'Напишите, что случилось');
  await db.query('UPDATE visits SET annul_req = 1, annul_reason = $1, annul_at = $2 WHERE id = $3', [reason, now(), v.id]);
  await audit(user, 'Запрос на аннулирование', `№ ${actNumber(v)} · ${v.company_name}`, reason);
  const html = [
    '🗑 <b>Выполнено по ошибке — аннулировать?</b>',
    `👷 ${escHtml(user.name)}`,
    `📋 Акт № ${escHtml(actNumber(v))} · ${escHtml(v.company_name)}`,
    `📍 ${escHtml(v.address)}`,
    `💬 ${escHtml(reason)}`,
    '',
    'Если подтвердить — акт удалится, заявка не попадёт в «Выполнено» и KPI.',
  ].join('\n');
  const kb = { inline_keyboard: [[{ text: '🗑 Аннулировать', callback_data: `anok:${v.id}` }, { text: '↩️ Оставить', callback_data: `anno:${v.id}` }]] };
  if (botEnabled) for (const aid of await adminIds(db)) sendMessage(aid, html, { replyMarkup: kb }).catch((e) => console.error(e.message));
  return { ok: true, requested: true };
});

async function rejectAnnul(v, actor) {
  await db.query("UPDATE visits SET annul_req = 0, annul_reason = '', annul_at = NULL WHERE id = $1", [v.id]);
  await audit(actor, 'Аннулирование отклонено', `№ ${actNumber(v)} · ${v.company_name}`);
  addNotification(v.tech_tg_id, 'info', `Аннулирование отклонено: акт № ${actNumber(v)} · ${v.company_name} остаётся выполненным`, {}).catch(() => {});
}

route('POST', '/api/visits/:id/annul/reject', async ({ params, user }) => {
  const v = await getVisit(params.id);
  must(Number(v.annul_req), 400, 'Запроса нет');
  await rejectAnnul(v, user);
  return { ok: true };
}, { access: 'admin' });

async function ownTask(id, user) {
  const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
  must(t, 404, 'Заявка не найдена');
  must(user.isAdmin || t.tech_tg_id === user.id, 403, 'Это заявка другого специалиста');
  must(['new', 'in_progress'].includes(t.status), 400, 'Заявка уже закрыта');
  return t;
}

// Клиент отменил заявку (сообщает техник)
route('POST', '/api/tasks/:id/client-cancel', async ({ params, body, user }) => {
  const t = await ownTask(params.id, user);
  const reason = str(body.reason, 100);
  const note = str(body.note, 500);
  const text = [reason, note].filter(Boolean).join(': ');
  await dropOpenVisit(t);
  await db.query("UPDATE tasks SET status = 'cancelled', cancel_reason = 'client', cancel_note = $1, reschedule_req = 0, updated_at = $2 WHERE id = $3", [text, now(), t.id]);
  await taskEvent(t, 'client_cancel', text);
  await audit(user, 'Клиент отменил заявку', `№ ${t.task_no} · ${t.company_name || t.address}`, text);
  if (t.confirm_id) editMessage(t.chat_id, t.confirm_id, `${taskSummary(t)}\n\n🚫 Клиент отменил${text ? `: ${escHtml(text)}` : ''}.`, restoreKb(t)).catch(() => {});
  await notifyOffice(t, [
    `🚫 <b>Клиент отменил заявку № ${t.task_no}</b>`,
    `${escHtml(t.company_name || 'Физлицо')}${t.address ? ` · ${escHtml(t.address)}` : ''}`,
    t.planned_at ? `🗓 была на ${escHtml(fmtTaskDate(t.planned_at, t.has_time))}` : '',
    text ? `Причина: ${escHtml(text)}` : '',
    `Сообщил: ${escHtml(user.name)}`,
  ].filter(Boolean).join('\n'), restoreKb(t));
  return { ok: true };
});

route('POST', '/api/tasks/:id/restore', async ({ params, user }) => {
  const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [params.id]);
  must(t, 404, 'Заявка не найдена');
  must(user.isAdmin || t.tech_tg_id === user.id, 403, 'Это заявка другого специалиста');
  must(t.status === 'cancelled', 400, 'Заявка не отменена');
  await restoreTask(t, user.name);
  await notifyOffice(t, `♻️ <b>Заявка № ${t.task_no} восстановлена</b>\n${escHtml(t.company_name || 'Физлицо')}${t.address ? ` · ${escHtml(t.address)}` : ''}\nВосстановил: ${escHtml(user.name)}`);
  return { ok: true };
});

// Клиент просит перенести — уведомление офису с кнопкой подтверждения
route('POST', '/api/tasks/:id/reschedule', async ({ params, body, user }) => {
  const t = await ownTask(params.id, user);
  const date = str(body.date, 10);
  const time = str(body.time, 5);
  const note = str(body.note, 500);
  must(!date || /^\d{4}-\d{2}-\d{2}$/.test(date), 400, 'Некорректная дата');
  must(!time || /^\d{2}:\d{2}$/.test(time), 400, 'Некорректное время');
  must(date || note, 400, 'Укажите новую дату или комментарий');
  const [y, m, d] = date ? date.split('-').map(Number) : [];
  const [hh, mm] = time ? time.split(':').map(Number) : [9, 0];
  const to = date ? zonedIso(y, m, d, hh, mm, TZN) : null;
  await dropOpenVisit(t);
  await db.query(
    "UPDATE tasks SET reschedule_req = 1, reschedule_to = $1, reschedule_has_time = $2, reschedule_note = $3, reschedule_count = reschedule_count + 1, status = 'new', updated_at = $4 WHERE id = $5",
    [to, time ? 1 : 0, note, now(), t.id],
  );
  const when = to ? fmtTaskDate(to, Boolean(time)) : '';
  await taskEvent(t, 'reschedule', [when, note].filter(Boolean).join(' · '));
  await audit(user, 'Клиент просит перенести', `№ ${t.task_no} · ${t.company_name || t.address}`, [when && `на ${when}`, note].filter(Boolean).join('; '));
  const kb = [
    ...(to ? [[{ text: `✅ Перенести на ${when}`, callback_data: `resched_ok:${t.id}` }]] : []),
    [{ text: '❌ Отменить заявку', callback_data: `cancel:${t.id}` }],
  ];
  await notifyOffice(t, [
    `🔁 <b>Клиент просит перенести заявку № ${t.task_no}</b>`,
    `${escHtml(t.company_name || 'Физлицо')}${t.address ? ` · ${escHtml(t.address)}` : ''}`,
    t.planned_at ? `Было: ${escHtml(fmtTaskDate(t.planned_at, t.has_time))}` : '',
    to ? `Просит: <b>${escHtml(when)}</b>` : 'Новую дату клиент не назвал',
    note ? `💬 ${escHtml(note)}` : '',
    t.phone ? `📞 ${escHtml(intlPhone(t.phone))}` : '',
    `Сообщил: ${escHtml(user.name)}`,
    '',
    to ? 'Подтвердите кнопкой или исправьте дату в исходном сообщении заявки.' : 'Созвонитесь с клиентом и исправьте дату в исходном сообщении заявки.',
  ].filter((x, i, a) => x || i === a.length - 2).join('\n'), { inline_keyboard: kb });
  return { ok: true };
});

// Админ подтверждает перенос из приложения
route('POST', '/api/tasks/:id/reschedule/confirm', async ({ params, user }) => {
  const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [params.id]);
  must(t && Number(t.reschedule_req) && t.reschedule_to, 400, 'Нет запроса на перенос с датой');
  await confirmReschedule(t, user.name);
  await notifyOffice(t, `✅ Заявка № ${t.task_no} перенесена на <b>${escHtml(fmtTaskDate(t.reschedule_to, t.reschedule_has_time))}</b> (${escHtml(user.name)})`);
  return { ok: true };
}, { access: 'admin' });

route('GET', '/api/cancel-reasons', async () => ({ items: CANCEL_REASONS }));

/** Команда заявки: кто ещё едет на объект (ответственный — tech_tg_id, меняется через «Переназначить»). */
route('POST', '/api/tasks/:id/team', async ({ params, body, user }) => {
  must((await features()).team, 400, 'Командные заявки выключены в настройках');
  const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [params.id]);
  must(t, 404, 'Заявка не найдена');
  must(Array.isArray(body.team), 400, 'Некорректная команда');
  const team = [...new Set(body.team.map((x) => str(x, 40)))].filter((x) => x && x !== t.tech_tg_id).slice(0, 10);
  for (const id of team) {
    const [m] = await db.query("SELECT role FROM users WHERE tg_id = $1 AND status = 'active'", [id]);
    must(m && !['admin', 'manager'].includes(m.role), 400, 'В команду добавляются только дезинсекторы и специалисты');
  }
  const before = taskTeam(t);
  await db.query('UPDATE tasks SET team = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(team), now(), t.id]);
  if (t.visit_id) {
    await db.query('UPDATE visits SET team = $1 WHERE id = $2', [JSON.stringify(team), t.visit_id]);
    const [v] = await db.query('SELECT * FROM visits WHERE id = $1', [t.visit_id]);
    if (v?.status === 'done') await syncTeamShares(v.id, v.points_total != null ? Number(v.points_total) : Number(v.points) || 0);
  }
  await refreshUserNames();
  await audit(user, 'Команда заявки', `№ ${t.task_no}`, team.map((id) => userNames[id] || id).join(', ') || 'без команды');
  const added = team.filter((id) => !before.includes(id));
  if (added.length) await notifyTeam(t, userNames[t.tech_tg_id], added);
  for (const id of before.filter((x) => !team.includes(x))) notifyTech(id, `👥 Вас убрали из команды по заявке № ${t.task_no}`, { kind: 'task_update', task_id: t.id });
  return { ok: true };
}, { access: 'admin' });

/** Администратор задаёт повышенный коэффициент заявке (null / 1 — снять). Если выезд уже начат — и выезду. */
route('POST', '/api/tasks/:id/mult', async ({ params, body, user }) => {
  const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [params.id]);
  must(t, 404, 'Заявка не найдена');
  const raw = body.mult === '' || body.mult == null ? null : Number(String(body.mult).replace(',', '.'));
  must(raw == null || (Number.isFinite(raw) && raw > 0 && raw <= 10), 400, 'Коэффициент — от 0,1 до 10');
  const mult = raw && raw !== 1 ? r2(raw) : null;
  await db.query('UPDATE tasks SET mult = $1, updated_at = $2 WHERE id = $3', [mult, now(), t.id]);
  if (t.visit_id) {
    const [v] = await db.query('SELECT status, points_manual FROM visits WHERE id = $1', [t.visit_id]);
    await db.query('UPDATE visits SET mult = $1 WHERE id = $2', [mult, t.visit_id]);
    if (v?.status === 'done' && !Number(v.points_manual)) {
      const [fv] = await db.query('SELECT * FROM visits WHERE id = $1', [t.visit_id]);
      const np = calcPoints(fv, await pointsConfig()).points;
      await db.query('UPDATE visits SET points = $1 WHERE id = $2', [np, t.visit_id]);
      if (taskTeam(fv).length) await syncTeamShares(t.visit_id, np);
    }
  }
  await audit(user, 'Коэффициент заявки', `№ ${t.task_no} · ${t.company_name || t.address}`, mult ? multRu(mult) : 'снят');
  const [nt] = await db.query('SELECT * FROM tasks WHERE id = $1', [t.id]);
  if (nt.visit_id) { if (mult) notifyTech(t.tech_tg_id, `⚡ Выезд по заявке № ${t.task_no} — повышенный коэффициент <b>${multRu(mult)}</b> к баллам`, { kind: 'info', task_id: t.id }); }
  else await boostCongrats(nt);
  return { ok: true, mult };
}, { access: 'admin' });

route('POST', '/api/tasks/:id/cancel', async ({ params, user }) => {
  const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [params.id]);
  must(t, 404, 'Заявка не найдена');
  must(await cancelTask(t, user.name), 400, 'Заявку уже нельзя отменить');
  return { ok: true };
}, { access: 'admin' });

route('GET', '/api/visits', async ({ user }) => {
  // техник видит только свои выезды, администратор — все
  const pcfg = await pointsConfig();
  const rows = await db.query(
    `SELECT v.*,
       (SELECT COUNT(*) FROM traps t WHERE t.object_id = v.object_id AND t.active = 1) AS total,
       (SELECT COUNT(*) FROM inspections i WHERE i.visit_id = v.id) AS checked,
       (SELECT COUNT(*) FROM observations o WHERE o.visit_id = v.id) AS notes
     FROM visits v ${user.isAdmin ? '' : 'WHERE v.tech_tg_id = $1'} ORDER BY v.started_at DESC LIMIT 60`,
    user.isAdmin ? [] : [user.id],
  );
  return {
    items: rows.map((v) => ({
      id: v.id, company_name: v.company_name, address: v.address, procedure: v.procedure, lead_id: v.lead_id || null,
      status: v.status, tech_name: v.tech_name, started_at: v.started_at, finished_at: v.finished_at,
      total: Number(v.total), checked: Number(v.checked), notes: Number(v.notes), mine: v.tech_tg_id === user.id,
      approval: v.approval || '',
      mult_eff: visitMult(v, pcfg).m,
    })),
  };
});

/** «Выполнено» для администратора: сколько сделал каждый сотрудник за период + список его актов. */
route('GET', '/api/admin/done', async ({ query }) => {
  const period = ['month', 'prev', 'all'].includes(query.get('period')) ? query.get('period') : 'month';
  const start = new Date(monthStartIso());
  const prevStart = new Date(start); prevStart.setMonth(prevStart.getMonth() - 1);
  const from = period === 'month' ? start.toISOString() : period === 'prev' ? prevStart.toISOString() : '1970-01-01T00:00:00.000Z';
  const to = period === 'prev' ? start.toISOString() : '9999-12-31T00:00:00.000Z';
  const rows = await db.query(
    `SELECT v.id, v.tech_tg_id, v.tech_name, v.company_name, v.address, v.procedure, v.status, v.started_at, v.finished_at, v.lead_id, v.approval,
       (SELECT MAX(t.price) FROM tasks t WHERE t.visit_id = v.id) AS price, v.points, v.team, v.payment, v.pay_amount, v.pay_note
     FROM visits v WHERE v.status = 'done' AND v.finished_at >= $1 AND v.finished_at < $2 ORDER BY v.finished_at DESC`,
    [from, to],
  );
  await refreshUserNames();
  const by = new Map();
  const add = (k, name, share, pts, cash = 0) => {
    const e = by.get(k) || { id: k, name: name || '—', count: 0, revenue: 0, points: 0, cash: 0 };
    e.count += 1; e.revenue = Math.round(e.revenue + share); e.points = Math.round((e.points + pts) * 100) / 100; e.cash = Math.round((e.cash + cash) * 100) / 100;
    by.set(k, e);
  };
  const cashOf = (v) => (v.payment === 'cash' ? Number(v.pay_amount) || 0 : 0);
  for (const v of rows) {
    // команда: стоимость — поровну на всех, баллы — каждому полностью
    const team = taskTeam(v);
    const share = (Number(v.price) || 0) / (team.length + 1);
    add(v.tech_tg_id || v.tech_name, v.tech_name, share, Number(v.points) || 0, cashOf(v)); // наличные — у ответственного
    for (const id of team) add(id, userNames[id], share, Number(v.points) || 0);
  }
  const techs = [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const tech = query.get('tech') || '';
  const list = rows.filter((v) => !tech || (v.tech_tg_id || v.tech_name) === tech || taskTeam(v).includes(tech)).slice(0, 150);
  return {
    period, total: rows.length, revenue: rows.reduce((s, v) => s + (Number(v.price) || 0), 0),
    cash: Math.round(rows.reduce((s, v) => s + cashOf(v), 0) * 100) / 100,
    pay_counts: Object.fromEntries(Object.keys(PAYMENTS).map((k) => [k, rows.filter((v) => v.payment === k).length])), points: Math.round(techs.reduce((s, t) => s + t.points, 0) * 100) / 100, techs,
    items: list.map((v) => ({
      id: v.id, company_name: v.company_name, address: v.address, procedure: v.procedure, lead_id: v.lead_id || null,
      status: v.status, tech_name: v.tech_name, started_at: v.started_at, finished_at: v.finished_at,
      total: 0, checked: 0, notes: 0, mine: false, approval: v.approval || '', price: v.price == null ? null : Number(v.price), points: v.points == null ? null : Number(v.points),
      payment: v.payment || '', pay_amount: v.pay_amount == null ? null : Number(v.pay_amount),
    })),
  };
}, { access: 'admin' });

route('POST', '/api/visits', async ({ body, user }) => {
  must(!user.isAdmin, 403, 'Администратор не выезжает — он только добавляет заявки');
  await mustNoOpenVisit(user);
  const procedure = str(body.procedure, 100);
  must(PROCEDURES.includes(procedure), 400, 'Выберите тип процедуры');
  const [obj] = await db.query('SELECT * FROM objects WHERE id = $1', [str(body.object_id, 64)]);
  must(obj, 400, 'Выберите адрес');
  const id = uid();
  const [cl] = await db.query('SELECT contact, rep_function FROM clients WHERE id = $1', [obj.company_id]);
  const individual = isIndividual(obj.company_name);
  const reason = str(body.reason, 500);
  // вредители, тип помещения, комнаты — сразу при запросе
  const allowedPests = PESTS_BY_PROCEDURE[procedure] || [];
  const pests = [...new Set((Array.isArray(body.pests) ? body.pests : []).map((x) => str(x, 60)).filter((x) => allowedPests.includes(x)))];
  must(!allowedPests.length || pests.length, 400, 'Выберите вредителей');
  const premises = [...new Set((Array.isArray(body.premises) ? body.premises : []).map((x) => str(x, 30)).filter((x) => PREMISES.some((p) => p.id === x)))];
  must(procedure === 'Дератизация' || premises.length, 400, 'Выберите тип помещения');
  const rooms = premises.includes('living') ? Math.max(1, Math.min(20, Math.floor(Number(body.rooms)) || 0)) : null;
  must(!premises.includes('living') || Number(body.rooms) >= 1, 400, 'Укажите количество комнат');
  const location = rooms ? `Квартира / дом, ${rooms} ${rooms === 1 ? 'комната' : rooms < 5 ? 'комнаты' : 'комнат'}` : '';
  const approval = user.isAdmin ? '' : 'pending'; // выезд без заявки техника подтверждает администратор
  await db.query(
    `INSERT INTO visits (id, object_id, company_id, company_name, address, procedure, tech_tg_id, tech_name, status, started_at, client_rep, client_rep_function, locality, approval, unplanned_reason, pests, premises, rooms, location)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [id, obj.id, obj.company_id, obj.company_name, obj.address, procedure, user.id, user.name, now(),
      cl?.contact || '', individual ? (cl?.contact ? 'Persoană fizică' : '') : cl?.rep_function || 'Administrator', localityFromAddress(obj.address), approval, reason,
      JSON.stringify(pests), JSON.stringify(premises), rooms, location],
  );
  if (!approval) await createTaskForVisit(await getVisit(id), user.name);
  if (approval === 'pending') {
    await audit(user, 'Запрос выезда без заявки', `${obj.company_name} · ${obj.address}`, reason);
    const html = [
      '🟠 <b>Выезд без заявки — нужно подтверждение</b>',
      `👷 ${escHtml(user.name)}`,
      `${individual ? '👤' : '🏢'} ${escHtml(obj.company_name)}`,
      `📍 ${escHtml(obj.address)}`,
      `🐞 ${escHtml([procedure, pests.join(', ')].filter(Boolean).join(' · '))}`,
      premises.length ? `🏠 ${escHtml(premises.map((pid) => PREMISES.find((p) => p.id === pid)?.label).join(', '))}${rooms ? ` · ${rooms} комн.` : ''}` : '',
      reason ? `💬 ${escHtml(reason)}` : '',
      '',
      'После подтверждения будет создана заявка.',
    ].filter(Boolean).join('\n');
    const kb = { inline_keyboard: [[{ text: '✅ Подтвердить', callback_data: `vok:${id}` }, { text: '❌ Отклонить', callback_data: `vno:${id}` }]] };
    if (botEnabled) for (const aid of await adminIds(db)) sendMessage(aid, html, { replyMarkup: kb }).catch((e) => console.error(e.message));
  }
  await applyShiftGeo(id, user.id).catch(() => {});
  return { id, approval };
});

route('GET', '/api/visits/:id', async ({ params, user }) => {
  const v = await getVisitFor(params.id, user);
  const rows = await visitRows(v);
  await refreshUserNames();
  const pts = calcPoints(v, await pointsConfig());
  return {
    visit: {
      id: v.id, company_id: v.company_id, company_name: v.company_name, address: v.address, procedure: v.procedure,
      status: v.status, comment: v.comment, tech_name: v.tech_name, started_at: v.started_at, finished_at: v.finished_at,
      report_url: v.status === 'done' && user.isAdmin ? reportPath(v.id) : null, // техники не скачивают акты
      lead_id: v.lead_id || null,
      act_no: actNumber(v),
      area: v.area || '', location: v.location || '', products: visitProducts(v),
      client_rep: v.client_rep || '', client_rep_function: v.client_rep_function || '', locality: v.locality || '',
      revision: Number(v.revision || 0),
      can_reopen: user.isAdmin && v.status === 'done',
      can_delete: user.isAdmin || (v.tech_tg_id === user.id && v.status === 'open'),
      infestation: v.infestation || '', preparation: v.preparation || '',
      pests: visitPests(v),
      recommendations: visitRecs(v),
      needs_assessment: ASSESS_PROCEDURES.includes(v.procedure),
      office_sent_at: v.office_sent_at || null,
      office_configured: Boolean(await officeChat()),
      is_company: !isIndividual(v.company_name),
      approval: v.approval || '',
      approval_note: v.approval_note || '',
      approved_by: v.approved_by || '',
      unplanned_reason: v.unplanned_reason || '',
      rooms: v.rooms == null ? null : Number(v.rooms),
      rooms_task: v.task_id ? await (async () => { const [tr] = await db.query('SELECT rooms FROM tasks WHERE id = $1', [v.task_id]); return Number(tr?.rooms) > 0 ? Number(tr.rooms) : null; })() : null,
      rooms_dispute: await (async () => { const [d] = await db.query('SELECT id, status, claimed, decided_rooms, decided_by FROM rooms_disputes WHERE visit_id = $1 ORDER BY created_at DESC LIMIT 1', [v.id]); return d ? { id: d.id, status: d.status, claimed: d.claimed == null ? null : Number(d.claimed), decided_rooms: d.decided_rooms == null ? null : Number(d.decided_rooms), decided_by: d.decided_by } : null; })(),
      sotki: v.sotki == null ? null : Number(v.sotki),
      stage: v.stage || '',
      price: v.price == null ? null : Number(v.price),
      payment: v.payment || '', pay_amount: v.pay_amount == null ? null : Number(v.pay_amount), pay_note: v.pay_note || '',
      can_approve: user.isAdmin && v.approval === 'pending',
      premises: visitPremises(v),
      point_cat: pointDefaults(v).cat,
      point_zone: pointDefaults(v).zone,
      points: v.status === 'done' && v.points != null ? Number(v.points) : pts.points,
      points_detail: pts.detail,
      mult: v.mult == null ? null : Number(v.mult),
      mult_now: pts.mult || 1,
      geo: v.geo_km == null ? null : { km: Number(v.geo_km), lat: Number(v.geo_lat), lon: Number(v.geo_lon), at: v.geo_at, zone: zoneFromKm(Number(v.geo_km)), map: `https://www.google.com/maps?q=${v.geo_lat},${v.geo_lon}` },
      zone_src: v.zone_src || '',
      team: taskTeam(v).map((id) => ({ id, name: userNames[id] || id })),
      points_total: v.points_total == null ? null : Number(v.points_total),
      points_manual: Boolean(Number(v.points_manual)),
      quick: Number(v.quick) === 1,
      annul_pending: Boolean(Number(v.annul_req)),
      annul_reason: v.annul_reason || '',
      can_annul: v.status === 'done' && (user.isAdmin || (v.tech_tg_id === user.id && !Number(v.annul_req))),
      // «Приступил по ошибке»: вернуть заявку можно, пока в выезде нет отметок и фото (один раз)
      can_undo_start: Boolean(v.task_id && v.status === 'open' && v.tech_tg_id === user.id
        && !(await db.query('SELECT start_undo FROM tasks WHERE id = $1', [v.task_id]))[0]?.start_undo
        && !Number((await db.query('SELECT COUNT(*) AS n FROM inspections WHERE visit_id = $1', [v.id]))[0].n)
        && !Number((await db.query('SELECT COUNT(*) AS n FROM observations WHERE visit_id = $1', [v.id]))[0].n)),
      reentry: visitReentry(v),
      reentry_custom: Boolean(v.reentry),
      reentry_default: reentryDefault(v.procedure, visitPests(v)),
      monitoring: v.monitoring == null ? null : Number(v.monitoring) === 1,
      journal_url: v.status === 'done' && user.isAdmin && rows.length ? `/r/journal/${v.id}.pdf?${signLink(`journal:${v.id}`)}` : null,
    },
    traps: rows.map(shapeRow),
    observations: await loadObservations(v.id),
    task: v.task_id ? await db.query('SELECT * FROM tasks WHERE id = $1', [v.task_id]).then(([t]) => (t ? shapeTask(t) : null)) : null,
  };
});

// Оценка объекта (для дезинсекции): степень заселённости и подготовка помещения
route('PATCH', '/api/visits/:id', async ({ params, body, user }) => {
  const v = await getWorkVisit(params.id, user);
  must(v.status === 'open', 409, 'Выезд уже завершён');
  let pests = visitPests(v);
  if (body.pests !== undefined) {
    must(Array.isArray(body.pests) && body.pests.length <= 12, 400, 'Некорректный список вредителей');
    pests = [...new Set(body.pests.map((p) => str(p, 60)).filter(Boolean))];
  }
  const infestation = body.infestation !== undefined ? str(body.infestation, 20) : v.infestation || '';
  const preparation = body.preparation !== undefined ? str(body.preparation, 20) : v.preparation || '';
  must(!infestation || INFESTATION.some((x) => x.id === infestation), 400, 'Неизвестная степень заселённости');
  must(!preparation || PREPARATION.some((x) => x.id === preparation), 400, 'Неизвестное состояние подготовки');
  await db.query('UPDATE visits SET infestation = $1, preparation = $2, pests = $3 WHERE id = $4', [infestation, preparation, JSON.stringify(pests), v.id]);
  // данные для акта
  const act = {
    area: body.area !== undefined ? str(body.area, 20) : v.area || '',
    location: body.location !== undefined ? str(body.location, 300) : v.location || '',
    client_rep: body.client_rep !== undefined ? str(body.client_rep, 120) : v.client_rep || '',
    client_rep_function: body.client_rep_function !== undefined ? str(body.client_rep_function, 120) : v.client_rep_function || '',
    locality: body.locality !== undefined ? str(body.locality, 120) : v.locality || '',
    address: body.address !== undefined && str(body.address, 300).length >= 3 ? str(body.address, 300) : v.address,
    products: body.products !== undefined
      ? JSON.stringify([...new Set((Array.isArray(body.products) ? body.products : []).map((x) => str(x, 120)).filter(Boolean))].slice(0, 20))
      : v.products || '[]',
  };
  await db.query('UPDATE visits SET area = $1, location = $2, client_rep = $3, client_rep_function = $4, locality = $5, products = $6, address = $7 WHERE id = $8',
    [act.area, act.location, act.client_rep, act.client_rep_function, act.locality, act.products, act.address, v.id]);
  // тип помещения и время отсутствия — для рекомендаций
  if (body.premises !== undefined) {
    must(Array.isArray(body.premises), 400, 'Некорректные помещения');
    const ids = body.premises.map((x) => str(x, 30)).filter((x) => PREMISES.some((p) => p.id === x));
    await db.query('UPDATE visits SET premises = $1 WHERE id = $2', [JSON.stringify([...new Set(ids)]), v.id]);
  }
  if (body.quick !== undefined) {
    await db.query('UPDATE visits SET quick = $1 WHERE id = $2', [body.quick ? 1 : 0, v.id]);
    // быстрый акт: заселённость «средняя» (стандартная) и «клиент подготовился», если не указано
    if (body.quick) await db.query("UPDATE visits SET infestation = COALESCE(NULLIF(infestation, ''), 'medium'), preparation = COALESCE(NULLIF(preparation, ''), 'done') WHERE id = $1", [v.id]);
  }
  if (body.rooms !== undefined && !user.isAdmin && v.task_id) {
    const [tr] = await db.query('SELECT rooms FROM tasks WHERE id = $1', [v.task_id]);
    must(!(Number(tr?.rooms) > 0), 400, `Количество комнат указано в заявке (${tr?.rooms}). Если оно неверное — нажмите «Ошибка», менеджер проверит.`);
  }
  if (body.rooms !== undefined) {
    const r = body.rooms === '' || body.rooms == null ? null : Math.round(Number(body.rooms));
    must(r == null || (r >= 1 && r <= 50), 400, 'Комнат — от 1 до 50');
    await db.query('UPDATE visits SET rooms = $1 WHERE id = $2', [r, v.id]);
  }
  if (body.sotki !== undefined) {
    const x = body.sotki === '' || body.sotki == null ? null : Number(String(body.sotki).replace(',', '.'));
    must(x == null || (Number.isFinite(x) && x > 0 && x <= 10000), 400, 'Некорректное количество соток');
    await db.query('UPDATE visits SET sotki = $1 WHERE id = $2', [x == null ? null : r2(x), v.id]);
  }
  if (body.point_cat !== undefined || body.point_zone !== undefined) {
    const cat = body.point_cat !== undefined ? str(body.point_cat, 20) : v.point_cat || '';
    const zone = body.point_zone !== undefined ? str(body.point_zone, 10) : v.point_zone || '';
    must(!cat || (await pointsConfig()).cats.some((c) => c.id === cat), 400, 'Неизвестная категория объекта');
    must(!zone || POINT_ZONES.some((z) => z.id === zone), 400, 'Неизвестная удалённость');
    if (!user.isAdmin) {
      // удалённость дезинсектор не выбирает — только по геолокации (или как задал офис)
      const pc = (await pointsConfig()).cats.find((c) => c.id === cat);
      const z = pc?.zones ? autoZone(v) : '';
      await db.query('UPDATE visits SET point_cat = $1, point_zone = $2 WHERE id = $3', [cat, z, v.id]);
    } else {
      const zoneChanged = zone !== (v.point_zone || '');
      await db.query('UPDATE visits SET point_cat = $1, point_zone = $2, zone_src = $3 WHERE id = $4', [cat, zone, zoneChanged ? 'admin' : (v.zone_src || ''), v.id]);
    }
  }
  if (body.reentry !== undefined) {
    const r = str(body.reentry, 10);
    must(!r || REENTRY.some((x) => x.id === r), 400, 'Некорректное время');
    await db.query('UPDATE visits SET reentry = $1 WHERE id = $2', [r, v.id]);
  }
  const nv = await getVisit(v.id);
  return { ok: true, recommendations: visitRecs(nv), reentry: visitReentry(nv), reentry_default: reentryDefault(nv.procedure, visitPests(nv)) };
});

// Замечание с фотографиями: { category, comment, photos: [base64 JPEG/PNG] }
const ROD_OBS = 'Грызун в станции'; // категория для фото грызуна из осмотра станции (не зависит от OBS_CATEGORIES в ENV)
route('POST', '/api/visits/:id/observations', async ({ params, body, user }) => {
  const v = await getWorkVisit(params.id, user);
  must(v.status === 'open', 409, 'Выезд уже завершён');
  const category = str(body.category, 100);
  must(OBS_CATEGORIES.includes(category) || category === ROD_OBS, 400, 'Выберите категорию');
  const comment = str(body.comment, 2000);
  const list = Array.isArray(body.photos) ? body.photos : [];
  must(list.length <= 10, 400, 'Не больше 10 фото за раз');
  must(comment || list.length, 400, 'Добавьте фото или комментарий');
  const photos = list.map((b64) => {
    const buf = Buffer.from(String(b64).replace(/^data:[^,]+,/, ''), 'base64');
    const mime = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : null;
    must(mime, 400, 'Фото должно быть в формате JPEG или PNG');
    must(buf.length <= 5_000_000, 400, 'Фото больше 5 МБ');
    return { buf, mime };
  });
  const id = uid();
  const ts = now();
  await db.query('INSERT INTO observations (id, visit_id, category, comment, created_at) VALUES ($1,$2,$3,$4,$5)', [id, v.id, category, comment, ts]);
  for (const p of photos) {
    await db.query('INSERT INTO photos (id, observation_id, visit_id, mime, data, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [uid(), id, v.id, p.mime, p.buf.toString('base64'), now()]);
  }
  return { observations: await loadObservations(v.id) };
});

route('DELETE', '/api/observations/:id', async ({ params, user }) => {
  const [o] = await db.query('SELECT * FROM observations WHERE id = $1', [params.id]);
  must(o, 404, 'Замечание не найдено');
  const v = await getVisitFor(o.visit_id, user);
  must(v.status === 'open', 409, 'Выезд уже завершён');
  await db.query('DELETE FROM photos WHERE observation_id = $1', [o.id]);
  await db.query('DELETE FROM observations WHERE id = $1', [o.id]);
  return { ok: true };
});

route('POST', '/api/visits/:id/send-office', async ({ params, user, req }) => {
  const v = await getVisitFor(params.id, user);
  must(v.status === 'done', 400, 'Сначала завершите выезд');
  const r = await sendToOffice(v.id, req);
  must(!r.skipped, 400, 'Чат офиса не настроен — попросите администратора');
  return { ok: true, office_sent_at: r.sent_at };
});

// Исправление акта: администратор возвращает выезд в работу, после завершения акт уходит в офис с пометкой.
route('POST', '/api/visits/:id/reopen', async ({ params, user }) => {
  const v = await getVisit(params.id);
  must(v.status === 'done', 400, 'Выезд ещё не завершён');
  await db.query("UPDATE visits SET status = 'open', finished_at = NULL, office_sent_at = NULL, revision = $1 WHERE id = $2",
    [Number(v.revision || 0) + 1, v.id]);
  await syncTeamShares(v.id, null);
  notifyTech(v.tech_tg_id, `✏️ Акт № ${actNumber(v)} (${escHtml(v.company_name)}) открыт на исправление`, { kind: 'act_reopened', visit_id: v.id });
  await audit(user, 'Акт открыт на исправление', `№ ${actNumber(v)} · ${v.company_name}`, `техник: ${v.tech_name}`);
  return { ok: true };
}, { access: 'admin' });

route('DELETE', '/api/visits/:id', async ({ params, body, user }) => {
  const v = await getVisit(params.id);
  must(user.isAdmin || (v.tech_tg_id === user.id && v.status === 'open'), 403,
    user.isAdmin ? 'Нет доступа' : 'Удалить завершённый акт может только администратор');
  const reason = str(body.reason, 300);
  await db.query('DELETE FROM photos WHERE visit_id = $1', [v.id]);
  await db.query('DELETE FROM observations WHERE visit_id = $1', [v.id]);
  await db.query('DELETE FROM inspections WHERE visit_id = $1', [v.id]);
  await db.query('DELETE FROM visits WHERE id = $1', [v.id]);
  await db.query("DELETE FROM kpi_adjust WHERE ref = $1 AND rule = 'team'", [`visit:${v.id}`]);
  if (v.task_id) await db.query("UPDATE tasks SET status = 'new', visit_id = NULL, updated_at = $1 WHERE id = $2", [now(), v.task_id]);
  const actNo = actNumber(v);
  await audit(user, v.status === 'done' ? 'Акт удалён' : 'Выезд удалён', `№ ${actNo} · ${v.company_name}`,
    [`техник: ${v.tech_name}`, `${v.procedure}, ${fmtRu(v.started_at)}`, reason && `причина: ${reason}`].filter(Boolean).join('; '));
  if (v.office_sent_at) {
    const chat = await officeChat();
    if (chat) {
      sendMessage(chat.id, `🗑 <b>Акт № ${actNo} удалён</b>\n${escHtml(v.company_name)} · ${escHtml(v.procedure)} · ${escHtml(fmtRu(v.finished_at || v.started_at))}${reason ? `\nПричина: ${escHtml(reason)}` : ''}\nУдалил: ${escHtml(user.name)}`,
        { threadId: chat.thread_id }).catch((e) => console.error(e.message));
    }
  }
  return { ok: true };
});

/** Заявка для выезда без заявки: номер, запись в теме техника, учёт в KPI. */
async function taskApprovalOn() {
  const v = await getSetting('task_approval');
  return v === null || v === undefined ? true : Boolean(v);
}

/** Администратор подтвердил заявку → она уходит технику (уведомление с «Уведомлен»). */
async function approveTask(t, who) {
  if (t.status !== 'pending') return false;
  await db.query("UPDATE tasks SET status = 'new', updated_at = $1 WHERE id = $2", [now(), t.id]);
  const [nt] = await db.query('SELECT * FROM tasks WHERE id = $1', [t.id]);
  const [u] = await db.query('SELECT name FROM users WHERE tg_id = $1', [t.tech_tg_id]);
  await audit({ id: 'bot', name: who }, 'Заявка подтверждена', `№ ${t.task_no} · ${t.company_name || t.address}`, `для: ${u?.name || ''}`);
  if (t.confirm_id) {
    editMessage(t.chat_id, t.confirm_id, `${taskSummary(nt, u?.name)}\n\n✅ Подтвердил ${escHtml(who)} · отправлено технику.`,
      { inline_keyboard: [[{ text: '❌ Отменить заявку', callback_data: `cancel:${t.id}` }]] }).catch(() => {});
  }
  addNotification(t.tech_tg_id, 'task_new', `Заявка № ${t.task_no} · ${t.company_name || 'Физлицо'} · ${t.address}`, { task_id: t.id }).catch(() => {});
  await sendTaskAlert(nt);
  await boostCongrats(nt);
  return true;
}

async function createTaskForVisit(v, who) {
  if (v.task_id) return null;
  const [cl] = await db.query('SELECT phone FROM clients WHERE id = $1', [v.company_id]);
  const b = await topicBindings();
  const key = Object.keys(b).find((k) => b[k] === v.tech_tg_id);
  const [chatId, thread] = key ? key.split(':') : [null, null];
  const [r] = await db.query('SELECT MAX(task_no) AS m FROM tasks');
  const t = {
    id: uid(), task_no: (Number(r?.m) || 0) + 1, tech_tg_id: v.tech_tg_id,
    company_name: isIndividual(v.company_name) ? '' : v.company_name, address: v.address,
    planned_at: v.started_at, has_time: 1, procedure: v.procedure, pests: v.pests || '[]', phone: cl?.phone || '',
    comment: [v.location, v.unplanned_reason ? `Без заявки: ${v.unplanned_reason}` : 'Выезд без заявки'].filter(Boolean).join('\n'),
    status: 'in_progress', visit_id: v.id, chat_id: chatId, thread_id: thread && thread !== '0' ? thread : null, author: who, at: now(),
  };
  await db.query(
    `INSERT INTO tasks (id, task_no, tech_tg_id, company_name, address, planned_at, has_time, procedure, pests, phone, comment, area, status, visit_id, chat_id, thread_id, message_id, author, created_at, updated_at, ack_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'',$12,$13,$14,$15,NULL,$16,$17,$17,$17)`,
    [t.id, t.task_no, t.tech_tg_id, t.company_name, t.address, t.planned_at, t.has_time, t.procedure, t.pests, t.phone, t.comment,
      t.status, t.visit_id, t.chat_id, t.thread_id, t.author, t.at],
  );
  await db.query('UPDATE visits SET task_id = $1 WHERE id = $2', [t.id, v.id]);
  if (botEnabled && chatId) {
    const sent = await sendMessage(chatId, `${taskSummary(t, v.tech_name)}\n\n🟠 Выезд без заявки · подтвердил ${escHtml(who)}`, { threadId: t.thread_id }).catch(() => null);
    if (sent?.message_id) await db.query('UPDATE tasks SET message_id = $1, confirm_id = $1 WHERE id = $2', [String(sent.message_id), t.id]);
  }
  return t;
}

async function decideVisit(v, ok, who, note = '') {
  if (v.approval !== 'pending') return false;
  await db.query('UPDATE visits SET approval = $1, approved_by = $2, approval_note = $3 WHERE id = $4', [ok ? '' : 'rejected', who, note, v.id]);
  const task = ok ? await createTaskForVisit(v, who) : null;
  await audit({ id: 'bot', name: who }, ok ? 'Выезд без заявки подтверждён' : 'Выезд без заявки отклонён', `${v.company_name} · ${v.address}`, `${v.tech_name}${note ? `; ${note}` : ''}`);
  notifyTech(v.tech_tg_id, ok
    ? `✅ <b>Выезд подтверждён</b> (${escHtml(who)})${task ? ` · заявка № ${task.task_no}` : ''}\n${escHtml(v.company_name)} · ${escHtml(v.address)}\nМожно работать.`
    : `❌ <b>Выезд отклонён</b> (${escHtml(who)})\n${escHtml(v.company_name)} · ${escHtml(v.address)}${note ? `\nПричина: ${escHtml(note)}` : ''}`,
  { kind: ok ? 'visit_approved' : 'visit_rejected', visit_id: v.id });
  return true;
}

route('POST', '/api/visits/:id/approve', async ({ params, body, user }) => {
  const v = await getVisit(params.id);
  must(v.approval === 'pending', 400, 'Выезд не ждёт подтверждения');
  await decideVisit(v, Boolean(body.approve), user.name, str(body.note, 300));
  return { ok: true };
}, { access: 'admin' });

// Нужны ли станции мониторинга на этом выезде (спрашиваем у юрлиц)
route('POST', '/api/visits/:id/monitoring', async ({ params, body, user }) => {
  const v = await getWorkVisit(params.id, user);
  must(v.status === 'open', 409, 'Выезд уже завершён');
  await db.query('UPDATE visits SET monitoring = $1 WHERE id = $2', [body.enabled ? 1 : 0, v.id]);
  return { ok: true };
});

// Результат сканирования QR в рамках выезда.
route('POST', '/api/visits/:id/scan', async ({ params, body, user }) => {
  const v = await getWorkVisit(params.id, user);
  const code = parseTrapCode(body.text);
  must(code, 400, 'Это не QR-код ловушки');
  const [trap] = await db.query('SELECT * FROM traps WHERE code = $1', [code]);
  if (!trap) return { state: 'new', code, next_number: await nextTrapNumber(v.object_id) };
  if (trap.object_id !== v.object_id) {
    const [o] = await db.query('SELECT company_name, address FROM objects WHERE id = $1', [trap.object_id]);
    return { state: 'other_object', code, object: o };
  }
  const [row] = (await visitRows(v)).filter((r) => r.id === trap.id);
  if (!row) return { state: 'inactive', code };
  return { state: 'found', trap: shapeRow(row) };
});

// Скан QR с главной (вне выезда): чья ловушка и по каким моим заявкам можно начать обслуживание.
route('POST', '/api/scan', async ({ body, user }) => {
  const code = parseTrapCode(body.text);
  must(code, 400, 'Это не QR-код ловушки');
  const [trap] = await db.query('SELECT * FROM traps WHERE code = $1', [code]);
  if (!trap) return { state: 'new', code, object: null, trap: null, task_ids: [], visit_id: null };
  const [o] = await db.query('SELECT id, company_name, address FROM objects WHERE id = $1', [trap.object_id]);
  const [openVisit] = await db.query(
    "SELECT id FROM visits WHERE object_id = $1 AND tech_tg_id = $2 AND status = 'open' AND COALESCE(approval, '') = '' ORDER BY started_at DESC LIMIT 1",
    [trap.object_id, user.id],
  );
  const mine = await db.query(
    "SELECT id, company_name, address, visit_id FROM tasks WHERE status IN ('new', 'in_progress') AND (tech_tg_id = $1 OR team LIKE $2)",
    [user.id, `%"${user.id}"%`],
  );
  const norm = (s) => String(s || '').toLowerCase().replace(/[«»"'`,.]/g, ' ').replace(/\s+/g, ' ').trim();
  const same = (a, b) => a.length >= 4 && b.length >= 4 && (a === b || a.includes(b) || b.includes(a));
  const oc = norm(o?.company_name);
  const oa = norm(o?.address);
  const task_ids = mine
    .filter((t) => (t.visit_id && openVisit && t.visit_id === openVisit.id) || same(norm(t.address), oa) || same(norm(t.company_name), oc))
    .map((t) => t.id);
  return {
    state: Number(trap.active) === 0 ? 'inactive' : 'found', code, object: o || null,
    trap: { number: trap.number, kind: trap.kind, location: trap.location || '' },
    task_ids, visit_id: openVisit?.id || null,
  };
});

// Привязка новой (наклеенной) этикетки к объекту выезда.
route('POST', '/api/visits/:id/traps', async ({ params, body, user }) => {
  const v = await getWorkVisit(params.id, user);
  const code = parseTrapCode(body.code);
  must(code, 400, 'Некорректный код');
  const kind = str(body.kind, 100);
  const target = str(body.target, 20);
  const tgt = STATION_TARGETS.find((x) => x.id === target);
  must(!target || tgt, 400, 'Неизвестное назначение станции');
  must(tgt ? tgt.devices.includes(kind) : TRAP_KINDS.includes(kind), 400, 'Выберите тип ловушки');
  const number = Math.max(1, Math.floor(Number(body.number)) || (await nextTrapNumber(v.object_id)));
  const [exists] = await db.query('SELECT id FROM traps WHERE code = $1', [code]);
  must(!exists, 409, 'Эта этикетка уже привязана');
  const id = uid();
  await db.query(
    'INSERT INTO traps (id, code, object_id, number, kind, location, active, created_at, target) VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8)',
    [id, code, v.object_id, number, kind, str(body.location, 200), now(), target],
  );
  if (v.monitoring == null) await db.query('UPDATE visits SET monitoring = 1 WHERE id = $1', [v.id]);
  return { trap: { id, code, number, kind, location: str(body.location, 200), target, inspection: null } };
});

route('PATCH', '/api/traps/:id', async ({ params, body }) => {
  const [t] = await db.query('SELECT * FROM traps WHERE id = $1', [params.id]);
  must(t, 404, 'Ловушка не найдена');
  const kind = body.kind !== undefined ? str(body.kind, 100) : t.kind;
  must(TRAP_KINDS.includes(kind), 400, 'Неизвестный тип ловушки');
  await db.query('UPDATE traps SET number = $1, kind = $2, location = $3, active = $4 WHERE id = $5', [
    body.number !== undefined ? Math.max(1, Math.floor(Number(body.number)) || 1) : t.number,
    kind,
    body.location !== undefined ? str(body.location, 200) : t.location,
    body.active !== undefined ? (body.active ? 1 : 0) : t.active,
    t.id,
  ]);
  return { ok: true };
});

route('POST', '/api/visits/:id/inspections', async ({ params, body, user }) => {
  const v = await getWorkVisit(params.id, user);
  must(v.status === 'open', 409, 'Выезд уже завершён');
  const [trap] = await db.query('SELECT * FROM traps WHERE id = $1 AND object_id = $2', [str(body.trap_id, 64), v.object_id]);
  must(trap, 404, 'Ловушка не относится к этому объекту');
  const count = Math.max(0, Math.min(9999, Math.floor(Number(body.count)) || 0));
  let status; let condition = ''; let bait = ''; let pest = ''; let caught = 0;
  if (body.condition !== undefined) {
    // новый журнал станций: состояние + приманка + улов
    condition = str(body.condition, 20);
    must(CONDITIONS.some((c) => c.id === condition), 400, 'Выберите состояние станции');
    const blocked = ['damaged', 'missing', 'no_access'].includes(condition);
    bait = !blocked && trap.kind === RODENTICIDE ? str(body.bait_eaten, 10) : '';
    must(!bait || BAIT_LEVELS.some((b) => b.id === bait), 400, 'Отметьте приманку');
    must(blocked || trap.kind !== RODENTICIDE || bait, 400, 'Отметьте, тронута ли приманка');
    caught = blocked ? 0 : count;
    pest = caught ? str(body.pest, 50) : '';
    must(!caught || pest, 400, 'Укажите, кто в ловушке');
    status = blocked ? condition : (caught || ['partial', 'full'].includes(bait)) ? 'activity' : condition === 'replaced' ? 'replaced' : 'ok';
  } else {
    status = str(body.status, 20);
    must(STATUS_IDS.has(status), 400, 'Выберите состояние');
    pest = status === 'activity' ? str(body.pest, 50) : '';
    caught = status === 'activity' ? count : 0;
  }
  await db.query(
    `INSERT INTO inspections (id, visit_id, trap_id, status, pest, count, bait_replaced, comment, created_at, condition, bait_eaten)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (visit_id, trap_id) DO UPDATE SET
       status = EXCLUDED.status, pest = EXCLUDED.pest, count = EXCLUDED.count,
       bait_replaced = EXCLUDED.bait_replaced, comment = EXCLUDED.comment, created_at = EXCLUDED.created_at,
       condition = EXCLUDED.condition, bait_eaten = EXCLUDED.bait_eaten`,
    [uid(), v.id, trap.id, status, pest, caught, body.bait_replaced ? 1 : 0, str(body.comment, 500), now(), condition, bait],
  );
  if (v.monitoring == null) await db.query('UPDATE visits SET monitoring = 1 WHERE id = $1', [v.id]);
  return { ok: true };
});

// ---------- оплата при завершении выезда ----------
const PAYMENTS = {
  cash: { label: 'Наличные получены', icon: '💵' },
  transfer: { label: 'Перечисление (юрлицо)', icon: '🏦' },
  none: { label: 'Без оплаты — гарантия', icon: '🛡' },
  multi: { label: 'Обработка на несколько дней — оплата позже', icon: '📅' },
};
const lei = (n) => `${Math.round(Number(n) * 100) / 100} лей`.replace('.', ',');
function paymentText(v) {
  const p = PAYMENTS[v.payment];
  if (!p) return '';
  const amount = v.payment === 'cash' && v.pay_amount != null ? `: ${lei(v.pay_amount)}` : '';
  return `${p.icon} ${p.label}${amount}${v.pay_note ? ` · ${v.pay_note}` : ''}`;
}
/** Проверка выбора оплаты из формы завершения. */
function parsePayment(body, v) {
  const kind = str(body.payment, 20);
  // исправленный акт: оплату уже отметили при первом завершении — можно не выбирать заново
  if (!kind && Number(v.revision) > 0 && v.payment) return { payment: v.payment, pay_amount: v.pay_amount ?? null, pay_note: v.pay_note || '' };
  must(PAYMENTS[kind], 400, 'Отметьте оплату: наличные, перечисление, гарантия или несколько дней');
  let amount = null;
  if (kind === 'cash') {
    amount = Number(String(body.pay_amount ?? '').replace(',', '.').replace(/\s/g, ''));
    must(String(body.pay_amount ?? '').trim() !== '' && Number.isFinite(amount) && amount > 0 && amount < 1000000, 400, 'Укажите, сколько наличных получено');
    amount = Math.round(amount * 100) / 100;
  }
  return { payment: kind, pay_amount: amount, pay_note: str(body.pay_note, 200) };
}

route('POST', '/api/visits/:id/finish', async ({ params, body, req, user }) => {
  const v = await getWorkVisit(params.id, user);
  must(v.status === 'open', 409, 'Выезд уже завершён');
  const quick = Number(v.quick) === 1;
  if (quick) {
    // быстрый акт: только адрес и вредители
    must(visitPests(v).length || !(PESTS_BY_PROCEDURE[v.procedure] || []).length, 400, 'Отметьте вредителей');
  } else if (ASSESS_PROCEDURES.includes(v.procedure)) {
    must(v.infestation && v.preparation, 400, 'Укажите степень заселённости и подготовку помещения');
    must(visitPests(v).length || !(PESTS_BY_PROCEDURE[v.procedure] || []).length, 400, 'Отметьте вредителей');
  }
  // баллы: категория объекта обязательна (для квартиры — и удалённость)
  if (quick) await db.query("UPDATE visits SET infestation = COALESCE(NULLIF(infestation, ''), 'medium'), preparation = COALESCE(NULLIF(preparation, ''), 'done') WHERE id = $1", [v.id]);
  await applyShiftGeo(v.id, v.tech_tg_id).catch(() => {});
  Object.assign(v, (await db.query('SELECT geo_km, point_zone, zone_src, infestation, preparation FROM visits WHERE id = $1', [v.id]))[0] || {});
  if ((await features()).require_geo_start) must(v.geo_km != null, 400, 'Сначала поделитесь геолокацией (кнопка «Поделиться геолокацией» в блоке «Объект · баллы» или трансляция боту), затем завершите выезд.');
  const pd = pointDefaults(v);
  pd.zone = autoZone(v);
  must(pd.cat, 400, 'Выберите категорию объекта (баллы): квартира, дом, поликлиника…');
  const pcat = (await pointsConfig()).cats.find((c) => c.id === pd.cat);
  must(pcat, 400, 'Категория объекта удалена администратором — выберите другую');
  const comment = str(body.comment, 2000);
  const pay = parsePayment(body, v);
  const xpBefore = await xpTotal(user.id);
  const finishedAt = now();
  const pts = calcPoints({ ...v, point_zone: pcat.zones ? pd.zone : '', finished_at: finishedAt }, await pointsConfig());
  await db.query('UPDATE visits SET point_cat = $1, point_zone = $2, points = $3 WHERE id = $4', [pd.cat, pcat.zones ? pd.zone : '', pts.points, v.id]);
  await syncTeamShares(v.id, pts.points, finishedAt);
  if (v.task_id) {
    const [ct] = await db.query('SELECT task_no, claim_bonus FROM tasks WHERE id = $1', [v.task_id]);
    if (ct && Number(ct.claim_bonus) > 0) {
      await db.query("DELETE FROM kpi_adjust WHERE ref = $1 AND rule = 'claim'", [`task:${v.task_id}`]);
      await db.query("INSERT INTO kpi_adjust (id, month, tg_id, rule, points, reason, status, created_at, decided_at, decided_by, ref) VALUES ($1,$2,$3,'claim',$4,$5,'applied',$6,$6,'авто',$7)",
        [uid(), monthKeyTz(finishedAt), v.tech_tg_id, Number(ct.claim_bonus), `Бонус: забрал заявку № ${ct.task_no}`, now(), `task:${v.task_id}`]);
    }
  }
  // какие документы отправлять в офис и подпись клиента (рисуется в приложении)
  const docs = quick
    ? { proces: true, anexa: false, obs: body.docs?.obs !== false, traps: body.docs?.traps !== false }
    : { proces: body.docs?.proces !== false, anexa: body.docs?.anexa !== false };
  const sign = String(body.signature || '');
  must(!sign || (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(sign) && sign.length < 600000), 400, 'Некорректная подпись');
  await db.query('UPDATE visits SET docs = $1, client_signature = $2 WHERE id = $3', [JSON.stringify(docs), sign || null, v.id]);
  await db.query('UPDATE visits SET payment = $1, pay_amount = $2, pay_note = $3 WHERE id = $4', [pay.payment, pay.pay_amount, pay.pay_note, v.id]);
  Object.assign(v, pay);
  if (Number(v.revision) > 0) await audit(user, 'Исправленный акт завершён', `№ ${actNumber(v)} · ${v.company_name}`, `ред. ${v.revision}`);
  await db.query("UPDATE visits SET status = 'done', comment = $1, finished_at = $2 WHERE id = $3", [comment, finishedAt, v.id]);
  await ensureActSeq(v);

  const rows = await visitRows(v);
  const checked = rows.filter((r) => r.status);
  const by = (s) => checked.filter((r) => r.status === s);
  const activity = by('activity');
  const url = baseUrl(req) + reportPath(v.id);
  const lines = [
    `🐞 Выезд: ${v.procedure}`,
    `Адрес: ${v.address}`,
    `Техник: ${v.tech_name}`,
    `Проверено ловушек: ${checked.length} из ${rows.length}`,
    `С активностью: ${activity.length}` +
      (activity.length ? ` — ${activity.map((r) => `№${r.number}${r.pest ? ` (${r.pest} ×${r.count})` : ''}`).join(', ')}` : ''),
  ];
  for (const s of ['replaced', 'damaged', 'missing', 'no_access']) {
    const list = by(s);
    if (list.length) lines.push(`${statusLabel(s)}: ${list.map((r) => `№${r.number}`).join(', ')}`);
  }
  const unchecked = rows.filter((r) => !r.status);
  if (unchecked.length) lines.push(`Не проверены: ${unchecked.map((r) => `№${r.number}`).join(', ')}`);
  if (comment) lines.push(`Заключение: ${comment}`);
  if (paymentText(v)) lines.push(`Оплата: ${paymentText(v)}`);
  lines.push(`Акт: ${url}`);

  let amoError = null;
  if (amoEnabled) try {
    const text = lines.join('\n');
    const noteId = v.lead_id ? await addLeadNote(v.lead_id, text) : await addCompanyNote(v.company_id, text);
    await db.query('UPDATE visits SET amo_note_id = $1 WHERE id = $2', [noteId, v.id]);
  } catch (e) {
    console.error(e);
    amoError = 'Выезд сохранён, но примечание в amoCRM не отправилось';
  }
  if (amoEnabled && v.lead_id) {
    try {
      await moveLead(v.lead_id, 'done');
    } catch (e) {
      console.error(e);
      amoError = amoError || 'Выезд сохранён, но заявку в amoCRM не удалось перевести в «Выполнено»';
    }
  }
  if (v.task_id) {
    const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [v.task_id]);
    if (t) {
      await db.query("UPDATE tasks SET status = 'done', updated_at = $1 WHERE id = $2", [now(), t.id]);
      const [fresh] = await db.query('SELECT act_seq, id FROM visits WHERE id = $1', [v.id]);
      taskReply(t, `✅ <b>Выполнено</b> · акт № ${actNumber(fresh || v)}${Number(v.revision) ? ' (исправленный)' : ''} · ${escHtml(user.name)}${paymentText(v) ? `\n${escHtml(paymentText(v))}` : ''}`);
      // подключаемая CRM (amoCRM и др., Настройки → «CRM»): best-effort, не блокирует завершение выезда
      if (t.crm_lead_id) {
        crm.onVisitDone({ task: t, visit: v, buildPdf: () => buildVisitPdf(v, docs), filename: pdfName(v) }).catch((e) => console.error('crm onVisitDone:', e.message));
      }
    }
  }
  let office = { skipped: true };
  try {
    office = await sendToOffice(v.id, req);
  } catch (e) {
    console.error(e);
    office = { error: `Выезд сохранён, но отчёт в офис не отправился: ${e.message}` };
  }
  guardVisit(v.id).catch((e) => console.error('guard:', e.message)); // контроль баллов — в фоне
  // игра: опыт за выезд и фото, квесты дня; итог — для экрана награды
  let reward = null;
  if (Number(v.revision) === 0 && v.tech_tg_id === user.id) {
    try {
      await awardXp(user.id, 'visit', XP.visit, `visit:${v.id}`, `выезд: ${v.company_name || v.address}`);
      const nPhotos = Number((await db.query('SELECT COUNT(*) AS n FROM photos WHERE visit_id = $1', [v.id]))[0].n) || 0;
      if (nPhotos) await awardXp(user.id, 'photo', Math.min(XP.photo * nPhotos, XP.photo_cap), `photo:${v.id}`, `фото в акте: ${nPhotos}`);
      const gs = await gameState(user.id);
      const pre = v.task_id ? await db.query('SELECT ref, xp FROM xp_events WHERE tg_id = $1 AND ref IN ($2, $3, $4)', [user.id, `ontime:${v.task_id}`, `call:${v.task_id}`, `route:${v.task_id}`]) : [];
      const ot = { xp: pre.reduce((a, r) => a + Number(r.xp), 0) };
      const onTime = pre.some((r) => r.ref.startsWith('ontime:'));
      const { rows: planRows } = await kpiPlanRows(curMonth());
      const pr = planRows.find((x) => x.id === user.id);
      const [fresh] = await db.query('SELECT points, points_total, mult FROM visits WHERE id = $1', [v.id]);
      reward = {
        xp: (gs.xp - xpBefore) + (Number(ot?.xp) || 0), xp_total: gs.xp, level: gs.level, title: gs.title, level_from: gs.from, level_to: gs.to,
        points: Number(fresh?.points_total ?? fresh?.points) || 0, detail: pts.detail, on_time: onTime,
        quests: gs.quests, streak: gs.streak,
        plan: pr ? { points: pr.points, plan: pr.plan, pct: pr.plan_pct, min: pr.min_points ?? null } : null,
      };
    } catch (e) { console.error('reward:', e.message); }
  }
  return {
    ok: true, report_url: reportPath(v.id), amo_error: amoError, reward,
    office_sent: Boolean(office.sent), office_error: office.error || null, office_none: Boolean(office.none),
  };
});

// ---------- контроль баллов: бот ищет признаки «накрутки» и сообщает администратору ----------
// Правила без ИИ: каждое проверяет конкретный признак, результат — строка в point_flags и сообщение админам.
const DEFAULT_GUARD = { enabled: true, mode: 'instant', min_minutes: 10, max_unplanned_day: 3, digest_hour: 19, notify_min_extra: 0 };
async function guardSettings() { return { ...DEFAULT_GUARD, ...((await getSetting('point_guard')) || {}) }; }
const GUARD_KINDS = {
  fast: 'Слишком быстро',
  cat_up: 'Тип помещения выше, чем в заявке',
  rooms_up: 'Комнат больше, чем в заявке',
  sotki_up: 'Соток больше, чем в заявке',
  pest_up: 'Добавлен «дорогой» вредитель',
  boost_shift: 'Сдвиг на повышенный коэффициент',
  night: 'Вечерняя надбавка при дневной заявке',
  dup_address: 'Повторный акт по адресу',
  unplanned_many: 'Много выездов без заявки',
};
const normAddr = (a) => String(a || '').toLowerCase().replace(/[^a-zа-яёăâîșşțţ0-9]+/gi, '');
const parseArr = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const hm = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { timeZone: TZN, hour: '2-digit', minute: '2-digit' });
const dayRu = (iso) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: TZN, weekday: 'short', day: 'numeric', month: 'short' });
const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZN });

/** Проверить завершённый выезд. Возвращает { flags: [{kind,text}], extra } — extra ≈ сколько баллов сверх того, что было в заявке. */
async function guardCheck(v, s, cfg) {
  const flags = [];
  const add = (kind, text) => flags.push({ kind, text });
  const [t] = v.task_id ? await db.query('SELECT * FROM tasks WHERE id = $1', [v.task_id]) : [];
  const catLabel = (id) => cfg.cats.find((c) => c.id === id)?.label || id;
  // 1. слишком быстро
  if (v.started_at && v.finished_at && Number(v.quick) !== 1) {
    const min = Math.round((new Date(v.finished_at) - new Date(v.started_at)) / 60000);
    if (min < Number(s.min_minutes || 0)) {
      const photos = Number((await db.query('SELECT COUNT(*) AS n FROM photos WHERE visit_id = $1', [v.id]))[0].n);
      add('fast', `акт закрыт через ${min} мин после начала (минимум ${s.min_minutes})${photos ? '' : ', без фото'}`);
    }
  }
  // базовый расчёт «как было в заявке» — для оценки лишних баллов
  const base = { ...v };
  if (t) {
    if (t.point_cat && v.point_cat && t.point_cat !== v.point_cat) {
      const alt = calcPoints({ ...v, point_cat: t.point_cat, point_zone: t.point_zone || v.point_zone }, cfg).points;
      if (alt != null && Number(v.points_total ?? v.points) > alt) {
        add('cat_up', `в заявке «${catLabel(t.point_cat)}», в акте «${catLabel(v.point_cat)}»`);
        base.point_cat = t.point_cat; base.point_zone = t.point_zone || v.point_zone;
      }
    }
    if (Number(t.rooms) > 0 && Number(v.rooms) > Number(t.rooms)) { add('rooms_up', `в заявке ${t.rooms} комн., в акте ${v.rooms}`); base.rooms = t.rooms; }
    if (Number(t.sotki) > 0 && Number(v.sotki) > Number(t.sotki)) { add('sotki_up', `в заявке ${t.sotki} сот., в акте ${v.sotki}`); base.sotki = t.sotki; }
    const tp = parseArr(t.pests);
    if (tp.length) {
      const added = visitPests(v).filter((p) => !tp.includes(p) && Number(cfg.pest_mult?.[p]) > Math.max(1, ...tp.map((x) => Number(cfg.pest_mult?.[x]) || 1)));
      if (added.length) { add('pest_up', `в заявке: ${tp.join(', ')}; в акте добавлено: ${added.join(', ')} (${multRu(Number(cfg.pest_mult[added[0]]))})`); base.pests = JSON.stringify(tp); }
    }
    if (t.planned_at && v.mult == null) {
      const planned = visitMult({ started_at: t.planned_at }, cfg);
      const actual = visitMult(v, cfg);
      if (actual.m > planned.m) {
        add('boost_shift', `заявка на ${dayRu(t.planned_at)}${Number(t.has_time) ? ` ${hm(t.planned_at)}` : ''} (${planned.m > 1 ? multRu(planned.m) : 'без коэффициента'}), начал ${dayRu(v.started_at)} ${hm(v.started_at)} — ${multRu(actual.m)} (${actual.why})`);
        base.started_at = t.planned_at; // как если бы начал в назначенное время
      }
    }
    const from = Number(cfg.night_from) || 20;
    if (Number(cfg.night) > 0 && t.planned_at && Number(t.has_time) && localHour(t.planned_at) < from - 2
      && (localHour(v.started_at) >= from || localHour(v.finished_at || v.started_at) >= from)) {
      add('night', `заявка на ${hm(t.planned_at)}, выезд ${hm(v.started_at)}–${hm(v.finished_at || v.started_at)} — надбавка +${ptsRu(cfg.night)}`);
      base.started_at = t.planned_at; base.finished_at = t.planned_at;
    }
  }
  // повторный акт по тому же адресу за сутки
  if (v.address && v.finished_at) {
    const since = new Date(new Date(v.finished_at).getTime() - 24 * 3600000).toISOString();
    const same = (await db.query("SELECT id, address, finished_at FROM visits WHERE tech_tg_id = $1 AND status = 'done' AND id <> $2 AND finished_at >= $3 AND finished_at <= $4",
      [v.tech_tg_id, v.id, since, v.finished_at])).filter((x) => normAddr(x.address) === normAddr(v.address));
    if (same.length) add('dup_address', `ещё ${same.length} акт(а) по этому адресу за сутки (${same.map((x) => hm(x.finished_at)).join(', ')})`);
  }
  // много выездов без заявки за день
  if (!v.task_id && v.finished_at) {
    const d = dayKey(v.finished_at);
    const n = (await db.query("SELECT finished_at FROM visits WHERE tech_tg_id = $1 AND status = 'done' AND task_id IS NULL AND finished_at >= $2",
      [v.tech_tg_id, new Date(new Date(v.finished_at).getTime() - 36 * 3600000).toISOString()])).filter((x) => dayKey(x.finished_at) === d).length;
    if (n > Number(s.max_unplanned_day || 99)) add('unplanned_many', `${n} выездов без заявки за ${dayRu(v.finished_at)} (порог ${s.max_unplanned_day})`);
  }
  const now2 = calcPoints(v, cfg).points || 0;
  const was = calcPoints(base, cfg).points || 0;
  return { flags, extra: r2(Math.max(0, now2 - was)) };
}

/** Проверить выезд и записать результат. notify: сразу написать администраторам (режим «сразу»). */
async function guardVisit(visitId, { notify = true } = {}) {
  const s = await guardSettings();
  if (!s.enabled) return null;
  const [v] = await db.query('SELECT * FROM visits WHERE id = $1', [visitId]);
  if (!v || v.status !== 'done') return null;
  const decided = await db.query("SELECT id FROM point_flags WHERE visit_id = $1 AND status <> 'new'", [v.id]);
  if (decided.length) return null; // администратор уже разобрал этот акт
  await db.query("DELETE FROM point_flags WHERE visit_id = $1 AND status = 'new'", [v.id]);
  const { flags, extra } = await guardCheck(v, s, await pointsConfig());
  if (!flags.length) return null;
  const id = uid();
  await db.query('INSERT INTO point_flags (id, visit_id, tg_id, tech_name, flags, extra, status, note, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, v.id, v.tech_tg_id, v.tech_name, JSON.stringify(flags), extra, 'new', '', now()]);
  if (notify && s.mode === 'instant' && botEnabled && extra >= Number(s.notify_min_extra || 0)) {
    const html = `🕵️ <b>Контроль баллов</b> · ${escHtml(v.tech_name)}\nАкт № ${actNumber(v)} · ${escHtml(v.company_name || '')} · ${escHtml(v.address || '')}\n`
      + flags.map((f) => `• <b>${escHtml(GUARD_KINDS[f.kind] || f.kind)}</b>: ${escHtml(f.text)}`).join('\n')
      + `\nБаллы за акт: ${ptsRu(v.points_total ?? v.points)}${extra > 0 ? ` · ≈ +${ptsRu(extra)} сверх заявки` : ''}`;
    const row = [{ text: '✅ Всё в порядке', callback_data: `pgok:${id}` }];
    if (publicBase()) row.push({ text: '📄 Акт (PDF)', url: publicBase() + reportPath(v.id) });
    for (const aid of await adminIds(db)) sendMessage(aid, `${html}\n\nРазобрать: Админка → Обзор → «Контроль баллов».`, { replyMarkup: { inline_keyboard: [row] } }).catch((e) => console.error('guard:', e.message));
  }
  return { id, flags, extra };
}

/** По сотрудникам за месяц: сколько актов с замечаниями, среднее время выезда против команды. */
async function guardStats(month = curMonth()) {
  const { since, until } = monthRange(month);
  const vis = await db.query("SELECT tech_tg_id, tech_name, started_at, finished_at, quick FROM visits WHERE status = 'done' AND finished_at >= $1 AND finished_at < $2", [since, until]);
  const fl = await db.query("SELECT tg_id, status, extra FROM point_flags WHERE created_at >= $1 AND created_at < $2", [since, until]);
  const by = new Map();
  for (const v of vis) {
    const e = by.get(v.tech_tg_id) || { id: v.tech_tg_id, name: v.tech_name, visits: 0, flagged: 0, confirmed: 0, extra: 0, mins: [] };
    e.visits += 1;
    if (Number(v.quick) !== 1 && v.started_at && v.finished_at) e.mins.push((new Date(v.finished_at) - new Date(v.started_at)) / 60000);
    by.set(v.tech_tg_id, e);
  }
  for (const f of fl) {
    const e = by.get(f.tg_id); if (!e) continue;
    e.flagged += 1; if (f.status === 'fixed') e.confirmed += 1; if (f.status !== 'ok') e.extra = r2(e.extra + (Number(f.extra) || 0));
  }
  const med = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return Math.round(b[Math.floor(b.length / 2)]); };
  const team = med(vis.filter((v) => Number(v.quick) !== 1 && v.started_at && v.finished_at).map((v) => (new Date(v.finished_at) - new Date(v.started_at)) / 60000));
  return {
    team_minutes: team,
    items: [...by.values()].map((e) => {
      const m = med(e.mins);
      const share = e.visits ? Math.round((e.flagged / e.visits) * 100) : 0;
      const warn = [share >= 30 && e.flagged >= 3 && `${share}% актов с замечаниями`, m != null && team && m < team * 0.5 && e.mins.length >= 5 && `выезды вдвое короче команды (${m} мин против ${team})`].filter(Boolean);
      return { id: e.id, name: e.name, visits: e.visits, flagged: e.flagged, confirmed: e.confirmed, extra: e.extra, minutes: m, share, warn };
    }).sort((a, b) => b.flagged - a.flagged || b.share - a.share),
  };
}

async function guardDigestTick() {
  const s = await guardSettings();
  if (!s.enabled || s.mode !== 'digest' || !botEnabled) return;
  const today = todayLocal();
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: TZN, hour: '2-digit', hour12: false })) % 24;
  if (hour < Number(s.digest_hour || 19) || (await getSetting('guard_digest_day')) === today) return;
  await setSetting('guard_digest_day', today);
  const rows = (await db.query("SELECT f.*, v.company_name, v.address, v.act_seq, v.started_at, v.id AS vid FROM point_flags f LEFT JOIN visits v ON v.id = f.visit_id WHERE f.status = 'new' ORDER BY f.created_at DESC LIMIT 40"));
  const st = await guardStats();
  const pattern = st.items.filter((x) => x.warn.length);
  if (!rows.length && !pattern.length) return;
  const L = [`🕵️ <b>Контроль баллов · итог дня</b>`];
  if (rows.length) {
    L.push('', `Не разобрано: <b>${rows.length}</b>`);
    for (const r of rows.slice(0, 15)) L.push(`• ${escHtml(r.tech_name)} — ${escHtml(r.company_name || r.address || '')}: ${parseArr(r.flags).map((f) => escHtml(GUARD_KINDS[f.kind] || f.kind).toLowerCase()).join(', ')}${Number(r.extra) > 0 ? ` (≈ +${ptsRu(r.extra)} б)` : ''}`);
  }
  if (pattern.length) {
    L.push('', '<b>Систематически:</b>');
    for (const p of pattern) L.push(`• ${escHtml(p.name)}: ${escHtml(p.warn.join('; '))}`);
  }
  L.push('', 'Подробнее — Админка → Обзор → «Контроль баллов».');
  await notifyAdmins(L.join('\n'));
}
setInterval(() => { guardDigestTick().catch((e) => console.error('guard digest:', e.message)); }, 5 * 60000).unref?.();

route('GET', '/api/admin/guard', async ({ query }) => {
  const status = ['new', 'all'].includes(query.get('status')) ? query.get('status') : 'new';
  const rows = await db.query(`SELECT f.*, v.company_name, v.address, v.points, v.points_total, v.started_at, v.finished_at FROM point_flags f LEFT JOIN visits v ON v.id = f.visit_id
    ${status === 'new' ? "WHERE f.status = 'new'" : ''} ORDER BY f.created_at DESC LIMIT 100`);
  return {
    settings: await guardSettings(), kinds: GUARD_KINDS, stats: await guardStats(),
    items: rows.map((r) => ({ id: r.id, visit_id: r.visit_id, tg_id: r.tg_id, tech_name: r.tech_name, flags: parseArr(r.flags), extra: Number(r.extra) || 0, status: r.status, note: r.note || '',
      company_name: r.company_name || '', address: r.address || '', points: r.points_total ?? r.points, started_at: r.started_at, finished_at: r.finished_at, created_at: r.created_at, decided_by: r.decided_by || '' })),
  };
}, { access: 'admin' });
route('PUT', '/api/admin/guard', async ({ body, user }) => {
  const s = await guardSettings();
  if (body.enabled !== undefined) s.enabled = Boolean(body.enabled);
  if (body.mode !== undefined) { must(['instant', 'digest'].includes(body.mode), 400, 'Режим: сразу или раз в день'); s.mode = body.mode; }
  const num = (k, lo, hi, name) => { if (body[k] === undefined) return; const n = Number(String(body[k]).replace(',', '.')); must(Number.isFinite(n) && n >= lo && n <= hi, 400, `${name}: от ${lo} до ${hi}`); s[k] = n; };
  num('min_minutes', 0, 240, 'Минимум минут на выезд'); num('max_unplanned_day', 1, 50, 'Выездов без заявки в день'); num('digest_hour', 0, 23, 'Час итога'); num('notify_min_extra', 0, 50, 'Порог лишних баллов');
  await setSetting('point_guard', s);
  await audit(user, 'Контроль баллов', `${s.enabled ? 'вкл' : 'выкл'} · ${s.mode === 'instant' ? 'сразу' : `итог в ${s.digest_hour}:00`} · мин ${s.min_minutes} мин · без заявки ≤ ${s.max_unplanned_day}/день`);
  return { ok: true, settings: s };
}, { access: 'admin' });
async function decideFlag(id, status, note, actor) {
  must(['ok', 'fixed', 'new'].includes(status), 400, 'Некорректное решение');
  const [f] = await db.query('SELECT * FROM point_flags WHERE id = $1', [id]);
  must(f, 404, 'Не найдено');
  await db.query('UPDATE point_flags SET status = $1, note = $2, decided_by = $3, decided_at = $4 WHERE id = $5', [status, str(note, 300), actor?.name || '', now(), id]);
  await audit(actor, 'Контроль баллов', `${f.tech_name}: ${status === 'ok' ? 'всё в порядке' : status === 'fixed' ? 'подтверждено нарушение' : 'снова открыто'}`, str(note, 300));
  return f;
}
route('POST', '/api/admin/guard/:id', async ({ params, body, user }) => { await decideFlag(params.id, str(body.status, 10), body.note, user); return { ok: true }; }, { access: 'admin' });
/** Проверить уже завершённые акты за месяц (например, сразу после включения). Сообщения не рассылаются. */
route('POST', '/api/admin/guard-scan', async ({ user }) => {
  const s = await guardSettings();
  must(s.enabled, 400, 'Сначала включите контроль баллов');
  const { since, until } = monthRange(curMonth());
  const vis = await db.query("SELECT id FROM visits WHERE status = 'done' AND finished_at >= $1 AND finished_at < $2 ORDER BY finished_at", [since, until]);
  let found = 0;
  for (const v of vis) if (await guardVisit(v.id, { notify: false })) found += 1;
  await audit(user, 'Контроль баллов', `проверка месяца: ${vis.length} актов, с замечаниями ${found}`);
  return { ok: true, checked: vis.length, found };
}, { access: 'admin' });

// ---------- отчёт в чат офиса ----------

async function sendToOffice(visitId, req) {
  const chat = await officeChat();
  if (!chat) return { skipped: true };
  const v = await getVisit(visitId);
  const parts = visitDocs(v);
  if (!parts.proces && !parts.anexa) return { skipped: true, none: true }; // специалист решил ничего не отправлять
  const rows = await visitRows(v);
  const obs = await db.query('SELECT * FROM observations WHERE visit_id = $1 ORDER BY created_at', [v.id]);
  const checked = rows.filter((r) => r.status);
  const activity = checked.filter((r) => r.status === 'activity');
  const obsCount = Number((await db.query('SELECT COUNT(*) AS n FROM observations WHERE visit_id = $1', [v.id]))[0].n);
  const photoCount = Number((await db.query('SELECT COUNT(*) AS n FROM photos WHERE visit_id = $1', [v.id]))[0].n);
  const inf = labelOf(INFESTATION, v.infestation);
  const prep = labelOf(PREPARATION, v.preparation);
  const pests = visitPests(v);
  const L = [
    ...(Number(v.revision) > 0 ? [`✏️ <b>Исправленный акт № ${actNumber(v)}</b> (ред. ${v.revision}) — предыдущая версия недействительна`, ''] : []),
    `📋 <b>${escHtml(v.procedure)}</b> · ${escHtml(fmtRu(v.finished_at || v.started_at))}`,
    `<b>${escHtml(v.company_name)}</b>`,
    `📍 ${escHtml(v.address)}`,
    `👷 ${escHtml(v.tech_name)}`,
  ];
  if (pests.length) L.push(`🐞 ${escHtml(pests.join(', '))}`);
  if (inf) L.push(`Заселённость: <b>${escHtml(inf)}</b>${['high', 'critical'].includes(v.infestation) ? ' ⚠️' : ''}`);
  if (prep) L.push(`Подготовка: <b>${escHtml(prep)}</b>${v.preparation !== 'done' ? ' ⚠️' : ''}`);
  if (rows.length) L.push(`Ловушки: ${checked.length}/${rows.length}, с активностью ${activity.length}`);
  if (obsCount) L.push(`Замечаний: ${obsCount}, фото: ${photoCount}`);
  if (paymentText(v)) L.push(`<b>${escHtml(paymentText(v))}</b>`);
  L.push(`📎 ${Number(v.quick) === 1
    ? ['Быстрый акт', parts.obs && obsCount && 'замечания с фото', parts.traps && rows.length && 'журнал ловушек'].filter(Boolean).join(' + ')
    : [parts.proces && 'Proces-verbal', parts.anexa && 'Anexa'].filter(Boolean).join(' + ')}${v.client_signature ? ' · ✍️ подпись клиента' : ''}`);
  const pdf = await buildVisitPdf(v, parts);
  const sent = await sendDocument(chat.id, pdf, pdfName(v), L.join('\n'), chat.thread_id);
  if (sent?.message_id) await db.query('UPDATE visits SET office_msg_id = $1 WHERE id = $2', [String(sent.message_id), v.id]);
  const sentAt = now();
  await db.query('UPDATE visits SET office_sent_at = $1 WHERE id = $2', [sentAt, v.id]);
  return { sent: true, sent_at: sentAt };
}

/** Документы для клиента: те, что специалист выбрал при завершении (если «никакие» — оба). */
const clientDocs = (v) => { const p = visitDocs(v); return p.proces || p.anexa ? p : { proces: true, anexa: true, obs: true, traps: true }; };
const clientPath = (visitId) => `/r/act/${visitId}.pdf?${signLink(`act:${visitId}`, 3600 * 24 * 90)}`;

/** Поделиться актом с клиентом: ссылка на PDF (живёт 90 дней) + номер клиента; via=bot — PDF приходит специалисту в личку для пересылки. */
route('POST', '/api/visits/:id/share', async ({ params, user, body, req }) => {
  const v = await getVisit(params.id);
  must(user.isAdmin || v.tech_tg_id === user.id, 403, 'Это акт другого специалиста');
  must(v.status === 'done', 400, 'Сначала завершите выезд');
  const done = await ensureActSeq(v);
  const url = baseUrl(req) + clientPath(v.id);
  const [task] = await db.query('SELECT phone FROM tasks WHERE visit_id = $1 ORDER BY created_at DESC LIMIT 1', [v.id]);
  const [cl] = await db.query('SELECT phone FROM clients WHERE id = $1', [v.company_id]);
  const phone = intlPhone(task?.phone || cl?.phone || '');
  const parts = clientDocs(v);
  const what = Number(v.quick) === 1 ? 'actul de executare a lucrărilor' : [parts.proces && 'proces-verbal', parts.anexa && 'anexa cu recomandări'].filter(Boolean).join(' și ');
  const company = (await companySettings()).name || 'InsectProtect';
  const text = `Bună ziua! Vă trimitem ${what} nr. ${actNumber(done)} din ${new Date(v.finished_at || v.started_at).toLocaleDateString('ro-RO', { timeZone: process.env.TZ_DISPLAY || 'Europe/Chisinau', day: '2-digit', month: '2-digit', year: 'numeric' })} (${company}). Vă rugăm să respectați recomandările din anexă.`;
  if (body.via === 'bot') {
    must(botEnabled, 400, 'Бот не настроен');
    const pdf = await buildVisitPdf(done, parts);
    const caption = [
      `📄 <b>Акт для клиента</b> · № ${escHtml(actNumber(done))}`,
      escHtml(v.company_name),
      phone ? `📞 ${escHtml(phone)}` : '',
      '',
      'Перешлите файл клиенту: удерживайте сообщение → «Переслать» или ⋯ → «Поделиться» (WhatsApp, Viber, почта).',
    ].filter((x, i, a) => x || i === a.length - 2).join('\n');
    try { await sendDocument(user.id, pdf, pdfName(done), caption); } catch (e) {
      throw new HttpError(400, /chat not found|blocked|initiate/i.test(e.message)
        ? 'Бот не может написать вам: откройте бота и нажмите «Старт»' : `Не удалось отправить: ${e.message}`);
    }
  }
  const VIA = { bot: 'PDF в бот', qr: 'QR-код', file: 'файлом', whatsapp: 'WhatsApp', telegram: 'Telegram', copy: 'ссылка скопирована' };
  if (VIA[body.via]) await audit(user, 'Акт отправлен клиенту', `№ ${actNumber(done)} · ${v.company_name}`, VIA[body.via]);
  return { ok: true, url, text, phone, file_name: pdfName(done), bot: botUsername, qr_svg: qrSvg(url) };
});

route('POST', '/api/labels', async ({ body }) => {
  const count = Math.max(1, Math.min(120, Math.floor(Number(body.count)) || 21));
  return { url: `/r/labels/${count}?${signLink(`labels:${count}`)}` };
}, { access: 'admin' }); // печатать QR-этикетки может только администратор

// ---------- Telegram webhook ----------
// Команды: /office — в группе (или теме) подключает её как чат офиса; /start — в личке кнопка приложения.

route('POST', '/api/tg/webhook', async ({ req, body }) => {
  must(webhookSecret && req.headers['x-telegram-bot-api-secret-token'] === webhookSecret, 403, 'forbidden');
  try {
    await handleUpdate(body);
  } catch (e) {
    console.error('webhook:', e.message);
  }
  return { ok: true };
}, { access: 'public' });

// ---------- журнал входящих сообщений бота (для диагностики в админке) ----------
const tgLog = [];
let lastUpdateAt = null;
function logTg(entry) {
  tgLog.unshift({ at: now(), ...entry });
  if (tgLog.length > 30) tgLog.length = 30;
  console.log(`[tg] ${entry.chat || ''}${entry.thread ? `#${entry.thread}` : ''} ${entry.result} · ${String(entry.text || '').slice(0, 60).replace(/\n/g, ' ')}`);
}
async function rememberTopicName(m) {
  const name = m.reply_to_message?.forum_topic_created?.name || m.forum_topic_created?.name;
  if (!name || !m.message_thread_id) return;
  const key = topicKey(m.chat.id, m.message_thread_id);
  const names = (await getSetting('topic_names')) || {};
  if (names[key] !== name) { names[key] = name; await setSetting('topic_names', names); }
}

const normName = (x) => String(x || '').toLowerCase().replace(/ё/g, 'е').replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't').trim();
const TOPIC_NOISE = new Set(['заявки', 'заявка', 'заказы', 'задачи', 'для', 'техник', 'техника', 'cereri', 'comenzi', 'lucrari', 'pentru']);

/** Сотрудник, чьё имя указано в названии темы («Заявки Артем» → Артем). Техники в приоритете перед админами. */
async function techByTopicName(topicName) {
  const words = normName(topicName).split(/[^a-zа-я0-9]+/i).filter((w) => w.length >= 3 && !TOPIC_NOISE.has(w));
  if (!words.length) return null;
  const users = await db.query("SELECT tg_id, name, role FROM users WHERE status = 'active'");
  const hits = users.filter((u) => {
    const parts = normName(u.name).split(/\s+/).filter(Boolean);
    return parts.some((p) => words.some((w) => p === w || (w.length >= 4 && (p.startsWith(w) || w.startsWith(p)))));
  });
  const techs = hits.filter((u) => !['admin', 'manager'].includes(u.role)); // администраторов к темам не привязываем
  return techs.length === 1 ? techs[0] : null;
}

async function autoBindTopic(c, threadId, m, current) {
  const key = topicKey(c.id, threadId);
  const names = (await getSetting('topic_names')) || {};
  const topicName = m.reply_to_message?.forum_topic_created?.name || names[key] || '';
  if (!topicName) return null;
  const match = await techByTopicName(topicName);
  if (!match || match.tg_id === current) return null;
  if (current) {
    // уже привязана: меняем только если сейчас на ней администратор, а в названии — другой сотрудник
    const [cur] = await db.query('SELECT role FROM users WHERE tg_id = $1', [current]);
    if (cur && !['admin', 'manager'].includes(cur.role)) return null;
  }
  const b = await topicBindings();
  b[key] = match.tg_id;
  await setSetting('topic_bindings', b);
  await audit({ id: 'bot', name: 'бот' }, 'Тема привязана автоматически', topicName, match.name);
  await sendMessage(c.id, `🔗 Тема «${escHtml(topicName)}» привязана к <b>${escHtml(match.name)}</b> — заявки отсюда уходят ему. Изменить: /tech`, { threadId }).catch(() => {});
  return match.tg_id;
}

const isAdminTg = async (tgId) =>
  Boolean((await db.query("SELECT tg_id FROM users WHERE tg_id = $1 AND role IN ('admin', 'manager') AND status = 'active'", [String(tgId || '')]))[0]);
const topicKey = (chatId, threadId) => `${chatId}:${threadId || 0}`;
async function topicBindings() { return (await getSetting('topic_bindings')) || {}; }

// ====================================================================================================
// ИГРА: опыт (XP), уровни, квесты дня, серия «вовремя», значки. Опыт — отдельно от баллов KPI (на деньги не влияет).
// Каждое начисление записывается один раз (tg_id + ref), поэтому повторные нажатия XP не дают.
// ====================================================================================================
const XP = { call: 10, call_late: 5, en_route: 5, on_time: 15, photo: 5, photo_cap: 20, visit: 30, ack: 5, geo_hour: 10 };
const ON_TIME_GRACE_MIN = 15;
const LEVEL_TITLES = ['Новичок', 'Помощник', 'Специалист', 'Специалист', 'Профи', 'Профи', 'Мастер', 'Мастер', 'Эксперт', 'Эксперт', 'Легенда'];
const levelNeed = (n) => 50 * n * (n + 1); // XP, с которого начинается уровень n+1: 0 · 100 · 300 · 600 · 1000 · 1500 · 2100 · 2800…
function levelOf(xp) {
  let n = 0;
  while (xp >= levelNeed(n + 1)) n += 1;
  return { level: n + 1, from: levelNeed(n), to: levelNeed(n + 1), title: LEVEL_TITLES[Math.min(n, LEVEL_TITLES.length - 1)] };
}
const gameOn = async () => (await features()).game !== false;

/** Начислить опыт один раз. Возвращает true, если начислено сейчас. */
async function awardXp(tgId, kind, xp, ref, note = '') {
  if (!tgId || !xp || !(await gameOn())) return false;
  const rows = await db.query('INSERT INTO xp_events (id, tg_id, kind, xp, ref, note, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tg_id, ref) DO NOTHING RETURNING id',
    [uid(), String(tgId), kind, Math.round(xp), ref, str(note, 200), now()]);
  return rows.length > 0;
}
async function xpTotal(tgId) { return Number((await db.query('SELECT COALESCE(SUM(xp), 0) AS s FROM xp_events WHERE tg_id = $1', [String(tgId)]))[0].s) || 0; }

// KPI менеджеров, «Звонилка», коуч, напоминания о незаполненных заявках — server/src/sales.js
const sales = initSales({ db, route, must, str, uid, now, getSetting, setSetting, audit, awardXp, xpTotal, levelOf, publicBase, TZN, notifyTech, taskSummary, pointsConfig });
// «Мой авто»: машина, заправки, ТО, фотопроверки с ИИ — server/src/car.js
const car = initCar({ db, route, must, str, uid, now, getSetting, setSetting, audit, awardXp, publicBase, TZN, addNotification });
const crm = initCrm({ route, must, str, getSetting, setSetting, audit, notifyAdmins });
// Касса: наличные на руках у сотрудника, сдача кассы и выдача под отчёт — server/src/cash.js
const cash = initCash({ db, route, must, str, uid, now, audit, notifyTech, escHtml });

// Привязка заявки к лиду CRM (например, ID сделки amoCRM) — необязательное поле, задаёт менеджер/администратор.
route('PUT', '/api/tasks/:id/crm-lead', async ({ params, body, user }) => {
  must(user.isOwner || (user.isAdmin && (user.perms || []).includes('tasks')), 403, 'Привязать CRM-лид может администратор или менеджер с правом «Заявки»');
  const [t] = await db.query('SELECT id, task_no FROM tasks WHERE id = $1', [params.id]);
  must(t, 404, 'Заявка не найдена');
  const leadId = str(body.crm_lead_id, 100);
  await db.query('UPDATE tasks SET crm_lead_id = $1 WHERE id = $2', [leadId, t.id]);
  await audit(user, 'CRM-лид заявки', `№ ${t.task_no}`, leadId || 'очищено');
  return { ok: true, crm_lead_id: leadId };
}, { access: 'admin' });

const dayOf = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZN });
/** Начал вовремя: заявка со временем и начало не позже времени + 15 минут. */
const startedOnTime = (v) => Boolean(v.planned_at && Number(v.has_time) && v.started_at
  && new Date(v.started_at).getTime() <= new Date(v.planned_at).getTime() + ON_TIME_GRACE_MIN * 60000);

/** Серия «вовремя»: дни подряд (с выездами по времени), когда все такие выезды начаты вовремя. */
function onTimeStreaks(visits) {
  const byDay = new Map();
  for (const v of visits) {
    if (!v.planned_at || !Number(v.has_time) || !v.started_at) continue;
    const d = dayOf(v.started_at);
    const e = byDay.get(d) || { all: 0, ok: 0 };
    e.all += 1; if (startedOnTime(v)) e.ok += 1;
    byDay.set(d, e);
  }
  const days = [...byDay.keys()].sort().reverse();
  let current = 0;
  for (const d of days) { const e = byDay.get(d); if (e.ok === e.all) current += 1; else break; }
  let best = 0; let run = 0;
  for (const d of [...days].reverse()) { const e = byDay.get(d); if (e.ok === e.all) { run += 1; best = Math.max(best, run); } else run = 0; }
  return { current, best };
}

const BADGES = [
  { id: 'first', title: 'Первый выезд', hint: '1 выполненный выезд', icon: 'flag' },
  { id: 'punctual', title: 'Пунктуальный', hint: '5 дней подряд вовремя', icon: 'clock' },
  { id: 'boost', title: 'Воскресный', hint: 'выезд с повышенным коэффициентом', icon: 'bolt' },
  { id: 'photo', title: 'Фотограф', hint: '50 фото в актах', icon: 'camera' },
  { id: 'bedbug', title: 'Мастер клопов', hint: '20 выездов на клопов', icon: 'bug' },
  { id: 'hundred', title: 'Сотня', hint: '100 выездов', icon: 'hundred' },
  { id: 'onair', title: 'В эфире', hint: '40 часов смены в эфире', icon: 'pin' },
  { id: 'media', title: 'Оператор', hint: '5 одобренных видео/фото', icon: 'video' },
  { id: 'crown', title: 'Чемпион', hint: 'победа в соревновании месяца', icon: 'crown' },
];

/** Всё игровое состояние сотрудника: уровень, квесты дня (с начислением XP за выполненные), серия, значки, смена. */
async function gameState(tgId) {
  tgId = String(tgId);
  const today = todayLocal();
  const since = new Date(Date.now() - 62 * 86400000).toISOString();
  const visits = await db.query(`SELECT v.id, v.status, v.started_at, v.finished_at, v.task_id, v.pests, v.mult, v.quick, t.planned_at, t.has_time
    FROM visits v LEFT JOIN tasks t ON t.id = v.task_id WHERE v.tech_tg_id = $1 AND v.started_at >= $2`, [tgId, since]);
  const todays = visits.filter((v) => dayOf(v.started_at) === today);
  const doneToday = todays.filter((v) => v.status === 'done');
  const photoCounts = doneToday.length
    ? Object.fromEntries((await db.query(`SELECT visit_id, COUNT(*) AS n FROM photos WHERE visit_id IN (${doneToday.map((_, i) => `$${i + 1}`).join(',')}) GROUP BY visit_id`, doneToday.map((v) => v.id))).map((r) => [r.visit_id, Number(r.n)]))
    : {};
  const plannedToday = (await db.query("SELECT planned_at FROM tasks WHERE tech_tg_id = $1 AND status NOT IN ('cancelled', 'void') AND planned_at IS NOT NULL", [tgId]))
    .filter((t) => dayOf(t.planned_at) === today).length;
  const timed = todays.filter((v) => v.planned_at && Number(v.has_time));
  const quests = [
    { id: 'visits', title: `${Math.max(3, Math.min(5, plannedToday || 3))} выезда сегодня`, target: Math.max(3, Math.min(5, plannedToday || 3)), progress: doneToday.length, xp: 50 },
    { id: 'ontime', title: 'Приехать вовремя ко всем', target: Math.max(1, timed.length), progress: timed.filter(startedOnTime).length, xp: 30, need: timed.length > 0 },
    { id: 'photos', title: 'Фото в каждом акте', target: Math.max(1, doneToday.length), progress: doneToday.filter((v) => (photoCounts[v.id] || 0) > 0).length, xp: 20, need: doneToday.length > 0 },
  ].map((q) => ({ ...q, progress: Math.min(q.progress, q.target), done: q.need !== false && q.progress >= q.target }));
  for (const q of quests) if (q.done) await awardXp(tgId, 'quest', q.xp, `quest:${today}:${q.id}`, q.title);

  const streak = onTimeStreaks(visits);
  const total = await xpTotal(tgId);
  const lvl = levelOf(total);
  const recent = await db.query('SELECT kind, xp, note, created_at FROM xp_events WHERE tg_id = $1 ORDER BY created_at DESC LIMIT 40', [tgId]);
  const todayXp = recent.filter((r) => dayOf(r.created_at) === today).reduce((s, r) => s + Number(r.xp), 0);

  // значки
  const cnt = async (sql, p) => Number((await db.query(sql, p))[0].n) || 0;
  const doneAll = await cnt("SELECT COUNT(*) AS n FROM visits WHERE tech_tg_id = $1 AND status = 'done'", [tgId]);
  const photosAll = await cnt("SELECT COUNT(*) AS n FROM photos p JOIN visits v ON v.id = p.visit_id WHERE v.tech_tg_id = $1", [tgId]);
  const bedbugs = await cnt("SELECT COUNT(*) AS n FROM visits WHERE tech_tg_id = $1 AND status = 'done' AND pests LIKE '%Клоп%'", [tgId]);
  const geoHours = await cnt("SELECT COUNT(*) AS n FROM xp_events WHERE tg_id = $1 AND kind = 'geo_hour'", [tgId]);
  const mediaOk = await cnt("SELECT COUNT(*) AS n FROM media_posts WHERE tg_id = $1 AND status = 'approved'", [tgId]);
  const cfg = lastPointsCfg || (await pointsConfig());
  const boostDone = visits.some((v) => v.status === 'done' && visitMult(v, cfg).m > 1);
  const crowned = (await contestState().catch(() => ({ winners: {} }))).winners;
  const wonEver = Object.values(crowned || {}).some((w) => (w?.ids || []).includes(tgId));
  const got = { first: doneAll >= 1, punctual: streak.best >= 5, boost: boostDone, photo: photosAll >= 50, bedbug: bedbugs >= 20, hundred: doneAll >= 100, onair: geoHours >= 40, media: mediaOk >= 5, crown: wonEver };
  const progress = { first: [Math.min(doneAll, 1), 1], punctual: [Math.min(streak.best, 5), 5], photo: [Math.min(photosAll, 50), 50], bedbug: [Math.min(bedbugs, 20), 20], hundred: [Math.min(doneAll, 100), 100], onair: [Math.min(geoHours, 40), 40], media: [Math.min(mediaOk, 5), 5] };

  return {
    enabled: await gameOn(),
    xp: total, today_xp: todayXp, ...lvl,
    quests, streak: streak.current, best_streak: streak.best,
    badges: BADGES.map((b) => ({ ...b, got: Boolean(got[b.id]), progress: progress[b.id] || null })),
    recent: recent.slice(0, 15).map((r) => ({ kind: r.kind, xp: Number(r.xp), note: r.note, at: r.created_at })),
    shift: await shiftState(tgId),
  };
}
route('GET', '/api/me/game', async ({ user }) => gameState(user.id));

// ====================================================================================================
// СМЕНА В ЭФИРЕ: сотрудник транслирует геопозицию боту (до 8 часов). Бот благодарит, +10 XP за каждый час
// (только в рабочее время и пока точки приходят). Позиции видит офис, по ним — карта «В пути» и удалённость.
// ====================================================================================================
const DEFAULT_GEO = { from_hour: 8, to_hour: 20, max_hours: 8, morning: true, morning_hour: 8 };
async function geoSettings() { return { ...DEFAULT_GEO, ...((await getSetting('geo_shift')) || {}) }; }
const GEO_FRESH_MS = 12 * 60000;
const geoFresh = (g) => Boolean(g && g.last_at && Date.now() - new Date(g.last_at).getTime() < GEO_FRESH_MS && g.lat != null);
const hhmmLocal = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { timeZone: TZN, hour: '2-digit', minute: '2-digit' });

async function shiftState(tgId) {
  const [g] = await db.query('SELECT * FROM geo_live WHERE tg_id = $1', [String(tgId)]);
  const s = await geoSettings();
  const today = todayLocal();
  const live = Boolean(g && geoFresh(g) && g.live_until && g.live_until > now());
  const minutes = g && g.day === today ? Math.round(Number(g.minutes) || 0) : 0;
  return {
    live, since: live ? g.started_at : null, until: live ? g.live_until : null, last_at: g?.last_at || null,
    minutes, hours: g && g.day === today ? Number(g.hours_awarded) || 0 : 0, max_hours: s.max_hours, xp_per_hour: XP.geo_hour,
    from_hour: s.from_hour, to_hour: s.to_hour,
  };
}
route('GET', '/api/me/shift', async ({ user }) => shiftState(user.id));

const kmBetween = (a, b) => {
  const R = 6371; const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat); const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
/** Примерное время в пути: по прямой × 1,35 (дороги), в городе ~25 км/ч, за городом ~55 км/ч. */
function etaMinutes(km) {
  const road = km * 1.35;
  return Math.max(1, Math.round((road / (km < 15 ? 25 : 55)) * 60));
}

/** Бот получил геопозицию: трансляция (live_period) или одна точка. */
async function handleLocation(m, edited) {
  const tgId = String(m.from?.id || m.chat?.id || '');
  const loc = m.location;
  if (!tgId || !loc) return;
  const [u] = await db.query("SELECT tg_id, name, role, status FROM users WHERE tg_id = $1 AND status = 'active'", [tgId]);
  if (!u) return;
  const at = now();
  const today = todayLocal();
  const [g] = await db.query('SELECT * FROM geo_live WHERE tg_id = $1', [tgId]);
  const lat = Number(loc.latitude); const lon = Number(loc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  if (edited) {
    // обновление трансляции (точки приходят как правка того же сообщения)
    if (!g || String(g.msg_id) !== String(m.message_id)) return;
    const stillLive = Number(loc.live_period) > 0 || (m.edit_date && g.live_until && g.live_until > at);
    await db.query('UPDATE geo_live SET lat = $1, lon = $2, last_at = $3, live_until = $4 WHERE tg_id = $5', [lat, lon, at, stillLive ? g.live_until : at, tgId]);
    return;
  }
  const livePeriod = Number(loc.live_period) || 0;
  if (livePeriod > 0) {
    const secs = Math.min(livePeriod, 12 * 3600); // «пока не выключу» — считаем максимум 12 часов
    const until = new Date(Date.now() + secs * 1000).toISOString();
    const keepDay = g && g.day === today;
    await db.query(`INSERT INTO geo_live (tg_id, msg_id, started_at, live_until, last_at, lat, lon, day, minutes, hours_awarded, tick_at)
      VALUES ($1,$2,$3,$4,$3,$5,$6,$7,$8,$9,$3)
      ON CONFLICT (tg_id) DO UPDATE SET msg_id = EXCLUDED.msg_id, started_at = EXCLUDED.started_at, live_until = EXCLUDED.live_until, last_at = EXCLUDED.last_at,
        lat = EXCLUDED.lat, lon = EXCLUDED.lon, day = EXCLUDED.day, minutes = EXCLUDED.minutes, hours_awarded = EXCLUDED.hours_awarded, tick_at = EXCLUDED.tick_at`,
    [tgId, String(m.message_id), at, until, lat, lon, today, keepDay ? Number(g.minutes) || 0 : 0, keepDay ? Number(g.hours_awarded) || 0 : 0]);
    const s = await geoSettings();
    const first = (u.name || '').split(' ')[0];
    const game = await gameOn();
    if (botEnabled) {
      sendMessage(tgId, [
        `🙏 <b>Спасибо, ${escHtml(first)}!</b> Смена в эфире до ${hhmmLocal(until)}.`,
        game ? `⭐️ За каждый час в эфире — <b>+${XP.geo_hour} XP</b> (с ${s.from_hour}:00 до ${s.to_hour}:00, до ${s.max_hours} ч в день).` : '',
        'Офис видит, где вы, — удалённость выезда подтвердится сама. Трансляцию можно остановить в любой момент.',
      ].filter(Boolean).join('\n')).catch(() => {});
    }
    return;
  }
  // одна точка: сохраняем позицию (для удалённости и карты), трансляцией не считается
  await db.query(`INSERT INTO geo_live (tg_id, msg_id, last_at, live_until, lat, lon, day) VALUES ($1,'',$2,$2,$3,$4,$5)
    ON CONFLICT (tg_id) DO UPDATE SET last_at = EXCLUDED.last_at, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
      live_until = CASE WHEN geo_live.live_until > EXCLUDED.last_at THEN geo_live.live_until ELSE EXCLUDED.live_until END`, [tgId, at, lat, lon, today]);
  if (botEnabled) sendMessage(tgId, `📍 Точка получена (${kmFromCenter(lat, lon).toString().replace('.', ',')} км от центра Кишинёва). Чтобы офис видел вас в пути и шёл опыт — включите <b>трансляцию</b>: 📎 → Геопозиция → «Транслировать» → 8 часов.`).catch(() => {});
}

/** Раз в 5 минут: минуты в эфире и +10 XP за каждый полный час. */
async function geoTick() {
  if (!(await features()).geo_shift) return;
  const s = await geoSettings();
  const today = todayLocal();
  const hour = localHour(now());
  for (const g of await db.query('SELECT * FROM geo_live')) {
    let minutes = Number(g.minutes) || 0; let awarded = Number(g.hours_awarded) || 0;
    if (g.day !== today) { minutes = 0; awarded = 0; }
    const last = g.tick_at ? new Date(g.tick_at).getTime() : Date.now();
    const delta = Math.max(0, Math.min(10, (Date.now() - last) / 60000));
    const live = geoFresh(g) && g.live_until && g.live_until > now();
    if (live && hour >= s.from_hour && hour < s.to_hour) minutes += delta;
    const hours = Math.min(Number(s.max_hours) || 8, Math.floor(minutes / 60));
    while (awarded < hours) {
      awarded += 1;
      if (await awardXp(g.tg_id, 'geo_hour', XP.geo_hour, `geo:${today}:${awarded}`, `${awarded} ч в эфире`) && botEnabled) {
        sendMessage(g.tg_id, `⭐️ <b>+${XP.geo_hour} XP</b> · ${awarded} ч в эфире сегодня${awarded >= (Number(s.max_hours) || 8) ? ' — максимум на сегодня, спасибо за смену!' : '. Так держать!'}`).catch(() => {});
      }
    }
    await db.query('UPDATE geo_live SET minutes = $1, hours_awarded = $2, day = $3, tick_at = $4 WHERE tg_id = $5', [minutes, awarded, today, now(), g.tg_id]);
  }
}
/** Утром — напоминание включить смену (тем, у кого сегодня заявки). */
async function geoMorningTick() {
  if (!botEnabled || !(await features()).geo_shift) return;
  const s = await geoSettings();
  if (!s.morning || localHour(now()) !== Number(s.morning_hour)) return;
  const today = todayLocal();
  const users = await db.query("SELECT tg_id, name FROM users WHERE status = 'active' AND role IN ('tech', 'specialist') AND bot_blocked_at IS NULL");
  const game = await gameOn();
  for (const u of users) {
    const [g] = await db.query('SELECT morning_day, live_until, last_at, lat FROM geo_live WHERE tg_id = $1', [u.tg_id]);
    if (g?.morning_day === today) continue;
    if (g && geoFresh(g) && g.live_until > now()) continue;
    const n = (await db.query("SELECT planned_at FROM tasks WHERE tech_tg_id = $1 AND status IN ('new', 'in_progress') AND planned_at IS NOT NULL", [u.tg_id])).filter((t) => dayOf(t.planned_at) === today).length;
    if (!n) continue;
    await db.query(`INSERT INTO geo_live (tg_id, morning_day) VALUES ($1, $2) ON CONFLICT (tg_id) DO UPDATE SET morning_day = EXCLUDED.morning_day`, [u.tg_id, today]);
    sendMessage(u.tg_id, [
      `☀️ <b>Доброе утро, ${escHtml((u.name || '').split(' ')[0])}!</b> Заявок на сегодня: ${n}.`,
      `Включите трансляцию геопозиции на 8 часов: 📎 → Геопозиция → «Транслировать геопозицию» → 8 часов.${game ? ` За каждый час — <b>+${XP.geo_hour} XP</b>.` : ''}`,
    ].join('\n')).catch(() => {});
  }
}
setInterval(() => { geoTick().catch((e) => console.error('geo tick:', e.message)); geoMorningTick().catch((e) => console.error('geo morning:', e.message)); }, 5 * 60000).unref?.();

route('GET', '/api/admin/geo-settings', async () => ({ settings: await geoSettings() }), { access: 'admin' });
route('PUT', '/api/admin/geo-settings', async ({ body, user }) => {
  const s = await geoSettings();
  const int = (k, lo, hi, name) => { if (body[k] === undefined) return; const n = Math.round(Number(body[k])); must(Number.isFinite(n) && n >= lo && n <= hi, 400, `${name}: от ${lo} до ${hi}`); s[k] = n; };
  int('from_hour', 0, 23, 'С какого часа'); int('to_hour', 1, 24, 'До какого часа'); int('max_hours', 1, 16, 'Часов в день'); int('morning_hour', 0, 23, 'Час напоминания');
  if (body.morning !== undefined) s.morning = Boolean(body.morning);
  must(s.to_hour > s.from_hour, 400, '«До» должно быть позже «с»');
  await setSetting('geo_shift', s);
  await audit(user, 'Смена в эфире', `${s.from_hour}:00–${s.to_hour}:00 · до ${s.max_hours} ч · утро ${s.morning ? `${s.morning_hour}:00` : 'выкл'}`);
  return { ok: true, settings: s };
}, { access: 'admin' });

/** Координаты адреса заявки (один раз, с кэшем в заявке). */
async function taskDest(t) {
  if (t.dest_lat != null && t.dest_lon != null) return { lat: Number(t.dest_lat), lon: Number(t.dest_lon) };
  if (t.dest_geo === 'fail' || !t.address) return null;
  try {
    const p = await forwardGeocode(t.address);
    await db.query('UPDATE tasks SET dest_lat = $1, dest_lon = $2, dest_geo = $3 WHERE id = $4', [p?.lat ?? null, p?.lon ?? null, p ? 'ok' : 'fail', t.id]);
    return p;
  } catch (e) { console.error('geocode:', e.message); return null; }
}
/** Карта «В пути»: где сотрудник, куда едет, сколько осталось. */
route('GET', '/api/tasks/:id/route', async ({ params, user }) => {
  const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [params.id]);
  must(t, 404, 'Заявка не найдена');
  must(t.tech_tg_id === user.id || user.isAdmin, 403, 'Это заявка другого специалиста');
  const [g] = await db.query('SELECT * FROM geo_live WHERE tg_id = $1', [t.tech_tg_id]);
  const me = g && geoFresh(g) ? { lat: Number(g.lat), lon: Number(g.lon), at: g.last_at, live: Boolean(g.live_until && g.live_until > now()) } : null;
  const dest = await taskDest(t);
  const km = me && dest ? Math.round(kmBetween(me, dest) * 10) / 10 : null;
  const eta = km != null ? etaMinutes(km) : null;
  const arrive = eta != null ? new Date(Date.now() + eta * 60000).toISOString() : null;
  const late = Boolean(arrive && t.planned_at && Number(t.has_time) && new Date(arrive).getTime() > new Date(t.planned_at).getTime() + ON_TIME_GRACE_MIN * 60000);
  return {
    me, dest, km, eta_min: eta, arrive_at: arrive, late, near: km != null && km <= 0.3,
    zone: me ? { km: kmFromCenter(me.lat, me.lon), zone: zoneFromKm(kmFromCenter(me.lat, me.lon)) } : null,
    nav_url: dest ? `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lon}` : (t.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(t.address)}` : null),
    planned_at: t.planned_at, has_time: Boolean(Number(t.has_time)),
  };
});
/** Офис: кто где — позиции, статус (едет / на объекте / свободен), опоздание. */
route('GET', '/api/admin/live', async () => {
  const users = await db.query("SELECT tg_id, name, role FROM users WHERE status = 'active' AND role IN ('tech', 'specialist')");
  const geo = Object.fromEntries((await db.query('SELECT * FROM geo_live')).map((g) => [g.tg_id, g]));
  const open = await db.query("SELECT id, tech_tg_id, company_name, address, started_at, geo_lat, geo_lon FROM visits WHERE status = 'open'");
  const route_ = await db.query("SELECT * FROM tasks WHERE status IN ('new', 'in_progress') AND en_route_at IS NOT NULL AND visit_id IS NULL");
  const items = [];
  for (const u of users) {
    const g = geo[u.tg_id];
    const pos = g && geoFresh(g) ? { lat: Number(g.lat), lon: Number(g.lon), at: g.last_at, live: Boolean(g.live_until && g.live_until > now()) } : null;
    const v = open.find((x) => x.tech_tg_id === u.tg_id);
    const t = route_.find((x) => x.tech_tg_id === u.tg_id);
    let state = 'free'; let text = pos ? 'свободен' : 'нет геопозиции'; let late = false; let eta = null; let site = null;
    // последняя известная точка (даже старая) — чтобы по нажатию показать, где сотрудник был в последний раз
    const last = g && g.lat != null && g.lon != null ? { lat: Number(g.lat), lon: Number(g.lon), at: g.last_at, live: Boolean(g.live_until && g.live_until > now()) } : null;
    if (v) {
      state = 'onsite'; text = `${v.company_name || v.address} · ${Math.round((Date.now() - new Date(v.started_at).getTime()) / 60000)} мин`;
      if (v.geo_lat != null) site = { lat: Number(v.geo_lat), lon: Number(v.geo_lon), label: v.company_name || v.address || 'объект' };
    }
    else if (t) {
      state = 'route';
      const dest = await taskDest(t);
      if (dest) site = { lat: dest.lat, lon: dest.lon, label: t.company_name || t.address || 'адрес заявки' };
      if (pos && dest) { eta = etaMinutes(kmBetween(pos, dest)); }
      late = Boolean(t.planned_at && Number(t.has_time) && Date.now() + (eta || 0) * 60000 > new Date(t.planned_at).getTime() + ON_TIME_GRACE_MIN * 60000);
      text = `${t.planned_at && Number(t.has_time) ? `к ${hhmmLocal(t.planned_at)} · ` : ''}${t.company_name || t.address}${eta != null ? ` · ≈${eta} мин` : ''}`;
    }
    items.push({ id: u.tg_id, name: u.name, role: u.role, pos, last, site, state, text, late, eta_min: eta, shift_hours: g && g.day === todayLocal() ? Math.floor((Number(g.minutes) || 0) / 60) : 0 });
  }
  const order = { route: 0, onsite: 1, free: 2 };
  items.sort((a, b) => Number(b.late) - Number(a.late) || order[a.state] - order[b.state] || a.name.localeCompare(b.name));
  return { items };
}, { access: 'admin' });

/** Удалённость выезда по свежей геопозиции из смены (если сотрудник не поделился вручную). */
async function applyShiftGeo(visitId, tgId) {
  const [g] = await db.query('SELECT * FROM geo_live WHERE tg_id = $1', [String(tgId)]);
  if (!geoFresh(g)) return;
  const v = await getVisit(visitId);
  if (v.geo_km != null) return;
  const km = kmFromCenter(Number(g.lat), Number(g.lon));
  await db.query('UPDATE visits SET geo_lat = $1, geo_lon = $2, geo_km = $3, geo_at = $4 WHERE id = $5', [Number(g.lat), Number(g.lon), km, g.last_at, v.id]);
  const pcat = (await pointsConfig()).cats.find((c) => c.id === pointDefaults(v).cat);
  if (pcat?.zones && v.zone_src !== 'admin') await db.query("UPDATE visits SET point_zone = $1, zone_src = 'geo' WHERE id = $2", [zoneFromKm(km), v.id]);
}

// ---------- комнаты: в заявке указано N, дезинсектор не меняет — нажимает «Ошибка», менеджер решает ----------
const roomsWord = (n) => `${n} ${Number(n) % 10 === 1 && Number(n) % 100 !== 11 ? 'комната' : [2, 3, 4].includes(Number(n) % 10) && ![12, 13, 14].includes(Number(n) % 100) ? 'комнаты' : 'комнат'}`;
route('POST', '/api/visits/:id/rooms-error', async ({ params, body, user }) => {
  const v = await getVisit(params.id);
  must(v.tech_tg_id === user.id || user.isAdmin, 403, 'Это выезд другого специалиста');
  must(v.status === 'open', 400, 'Выезд уже завершён');
  const [t] = v.task_id ? await db.query('SELECT * FROM tasks WHERE id = $1', [v.task_id]) : [];
  must(t && Number(t.rooms) > 0, 400, 'В заявке нет количества комнат — укажите его сами');
  const claimed = Math.round(Number(body.rooms));
  must(Number.isFinite(claimed) && claimed >= 1 && claimed <= 50, 400, 'Укажите, сколько комнат на самом деле (1–50)');
  must(claimed !== Number(t.rooms), 400, 'Это то же количество, что в заявке');
  const [open] = await db.query("SELECT id FROM rooms_disputes WHERE visit_id = $1 AND status = 'new'", [v.id]);
  must(!open, 400, 'Ошибка уже отправлена — ждём менеджера');
  const d = { id: uid(), note: str(body.note, 300) };
  await db.query('INSERT INTO rooms_disputes (id, visit_id, task_id, tg_id, task_rooms, claimed, note, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [d.id, v.id, t.id, v.tech_tg_id, Number(t.rooms), claimed, d.note, now()]);
  const [tech] = await db.query('SELECT name FROM users WHERE tg_id = $1', [v.tech_tg_id]);
  const html = `🏠 <b>Ошибка в количестве комнат · заявка № ${t.task_no}</b>\n${escHtml(tech?.name || '')} · ${escHtml(t.company_name || t.address || '')}\nВ заявке: <b>${roomsWord(t.rooms)}</b> · на объекте: <b>${roomsWord(claimed)}</b>${d.note ? `\n💬 ${escHtml(d.note)}` : ''}\n\nПроверьте и подтвердите.`;
  const kb = { inline_keyboard: [[{ text: `✅ Всё верно: ${t.rooms}`, callback_data: `rmok:${d.id}` }, { text: `✏️ Исправить на ${claimed}`, callback_data: `rmset:${d.id}:${claimed}` }]] };
  const base = publicBase();
  if (base) kb.inline_keyboard.push([{ text: 'Другое количество', web_app: { url: base } }]);
  const msgs = {};
  if (botEnabled) for (const tg of await sales.gapRecipients(t)) {
    if (!/^\d+$/.test(tg)) continue;
    const sent = await sendMessage(tg, html, { replyMarkup: kb }).catch(() => null);
    if (sent?.message_id) msgs[tg] = String(sent.message_id);
  }
  await db.query('UPDATE rooms_disputes SET msgs = $1 WHERE id = $2', [JSON.stringify(msgs), d.id]);
  await audit(user, 'Ошибка в количестве комнат', `№ ${t.task_no}`, `в заявке ${t.rooms}, на объекте ${claimed}`);
  return { ok: true, id: d.id };
});

async function decideRooms(id, rooms, actor) {
  const [d] = await db.query('SELECT * FROM rooms_disputes WHERE id = $1', [id]);
  if (!d) return { ok: false, text: 'Не найдено' };
  if (d.status !== 'new') return { ok: false, text: `Уже решено: ${d.decided_rooms ?? d.task_rooms} (${d.decided_by || '—'})` };
  const n = rooms == null ? Number(d.task_rooms) : Math.round(Number(rooms));
  if (!(n >= 1 && n <= 50)) return { ok: false, text: 'Некорректное количество' };
  const status = n === Number(d.task_rooms) ? 'ok' : 'fixed';
  await db.query('UPDATE rooms_disputes SET status = $1, decided_rooms = $2, decided_by = $3, decided_at = $4 WHERE id = $5', [status, n, actor?.name || '', now(), d.id]);
  await db.query('UPDATE visits SET rooms = $1 WHERE id = $2', [n, d.visit_id]);
  if (status === 'fixed' && d.task_id) await db.query('UPDATE tasks SET rooms = $1 WHERE id = $2', [n, d.task_id]);
  const [t] = d.task_id ? await db.query('SELECT task_no FROM tasks WHERE id = $1', [d.task_id]) : [];
  notifyTech(d.tg_id, status === 'ok'
    ? `🏠 Заявка № ${t?.task_no || ''}: менеджер подтвердил — <b>${roomsWord(n)}</b>, как в заявке.`
    : `🏠 Заявка № ${t?.task_no || ''}: менеджер исправил количество — <b>${roomsWord(n)}</b>. Баллы пересчитаны.`, { kind: 'info', visit_id: d.visit_id });
  let msgs = {}; try { msgs = JSON.parse(d.msgs || '{}'); } catch { /* пусто */ }
  for (const [tg, mid] of Object.entries(msgs)) editMessage(tg, mid, `🏠 Заявка № ${t?.task_no || ''}: ${status === 'ok' ? `подтверждено ${roomsWord(n)}` : `исправлено на ${roomsWord(n)}`} · ${escHtml(actor?.name || '')}`).catch(() => {});
  await audit(actor, status === 'ok' ? 'Комнаты: всё верно' : 'Комнаты: исправлено', `№ ${t?.task_no || ''}`, roomsWord(n));
  return { ok: true, text: 'Готово' };
}
const canRooms = (user) => user.isAdmin || user.role === 'manager';
route('GET', '/api/rooms-disputes', async ({ user }) => {
  must(canRooms(user), 403, 'Только менеджер или администратор');
  const rows = await db.query(`SELECT d.*, t.task_no, t.company_name, t.address, u.name AS tech_name FROM rooms_disputes d LEFT JOIN tasks t ON t.id = d.task_id LEFT JOIN users u ON u.tg_id = d.tg_id
    WHERE d.status = 'new' ORDER BY d.created_at DESC LIMIT 50`);
  return { items: rows.map((r) => ({ id: r.id, visit_id: r.visit_id, task_no: r.task_no, client: r.company_name || r.address || '', tech_name: r.tech_name || '', task_rooms: Number(r.task_rooms), claimed: Number(r.claimed), note: r.note, created_at: r.created_at })) };
});
route('POST', '/api/rooms-disputes/:id', async ({ user, params, body }) => {
  must(canRooms(user), 403, 'Только менеджер или администратор');
  const r = await decideRooms(params.id, body.ok ? null : body.rooms, user);
  must(r.ok, 400, r.text);
  return { ok: true };
});

// ---------- «Хочу ещё заявку» ----------
route('POST', '/api/me/more-work', async ({ user }) => {
  must(!user.isAdmin, 400, 'Это кнопка для сотрудников');
  const [last] = await db.query('SELECT created_at FROM more_work WHERE tg_id = $1 ORDER BY created_at DESC LIMIT 1', [user.id]);
  must(!last || Date.now() - new Date(last.created_at).getTime() > 30 * 60000, 429, 'Запрос уже отправлен — офис подберёт заявку. Повторить можно через 30 минут.');
  await db.query('INSERT INTO more_work (id, tg_id, name, created_at) VALUES ($1,$2,$3,$4)', [uid(), user.id, user.name, now()]);
  const today = todayLocal();
  const tasks = (await db.query("SELECT planned_at, status FROM tasks WHERE tech_tg_id = $1 AND planned_at IS NOT NULL AND status NOT IN ('cancelled', 'void')", [user.id])).filter((t) => dayOf(t.planned_at) === today);
  const [g] = await db.query('SELECT * FROM geo_live WHERE tg_id = $1', [user.id]);
  const L = [
    `🙋 <b>${escHtml(user.name)}</b> просит ещё заявку`,
    `Сегодня заявок: ${tasks.length}, выполнено: ${tasks.filter((t) => t.status === 'done').length}`,
    geoFresh(g) ? `📍 Сейчас: <a href="https://maps.google.com/?q=${g.lat},${g.lon}">на карте</a> · ${kmFromCenter(Number(g.lat), Number(g.lon)).toString().replace('.', ',')} км от центра` : '',
  ].filter(Boolean);
  if (await officeChat()) await notifyOffice({}, L.join('\n')); else await notifyAdmins(L.join('\n'));
  await audit(user, 'Попросил ещё заявку', `сегодня ${tasks.length}`);
  return { ok: true };
});

// ====================================================================================================
// ВХОДЯЩИЕ ОТ ОФИСА: всё, что требует реакции сотрудника, — в одном списке (новые / в работе / готово).
// «Понял / Принял / Беру» — одна кнопка на всё, +5 XP за каждое.
// ====================================================================================================
function noteColor(n) {
  const t = String(n.text || '');
  if (n.kind === 'remark') return 'red';
  if (/отмен|перенес|перенос|перенёс/i.test(t)) return 'red';
  if (/коэффициент|×/i.test(t)) return 'purple';
  return 'blue';
}
async function inboxFor(user) {
  const uidS = String(user.id);
  const newItems = []; const work = []; const done = [];
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  // вызов в офис
  for (const c of await db.query('SELECT * FROM office_calls WHERE tg_id = $1 AND ack_at IS NULL AND cancelled_at IS NULL', [uidS])) {
    newItems.push({ key: `call:${c.id}`, type: 'call', color: 'red', urgent: true, title: 'Вызов в офис', text: c.note || `вызвал(а) ${c.by_name || 'офис'}`, at: c.created_at, action: 'Иду' });
  }
  // новые заявки (не нажато «Уведомлен»)
  const tasks = await db.query("SELECT * FROM tasks WHERE tech_tg_id = $1 AND status IN ('new', 'in_progress')", [uidS]);
  for (const t of tasks.filter((x) => !x.ack_at)) {
    newItems.push({ key: `task:${t.id}`, type: 'task', color: taskMult(t).mult_eff > 1 ? 'purple' : 'orange', title: `Новая заявка № ${t.task_no}`,
      text: [t.company_name || t.address, t.planned_at ? fmtTaskDate(t.planned_at, t.has_time) : '', t.procedure].filter(Boolean).join(' · '), at: t.created_at, action: 'Принял', task_id: t.id });
  }
  // уведомления (переносы, отмены, замечания, изменения)
  const notes = await db.query('SELECT * FROM notifications WHERE tg_id = $1 AND created_at >= $2 ORDER BY created_at DESC LIMIT 60', [uidS, since]);
  for (const n of notes) {
    // новые заявки, поручения, объявления и вызовы показаны отдельными карточками со своей кнопкой — не дублируем
    if (['task_new', 'job', 'ann', 'call'].includes(n.kind)) continue;
    const item = { key: `note:${n.id}`, type: 'note', kind: n.kind, color: noteColor(n), urgent: noteColor(n) === 'red', title: n.kind === 'remark' ? 'Замечание офиса' : n.kind === 'task_new' ? 'Заявка' : 'От офиса',
      text: n.text, at: n.created_at, action: 'Понял', task_id: n.task_id, visit_id: n.visit_id, author: n.author_name };
    if (!n.read_at) newItems.push(item); else if (Date.now() - new Date(n.read_at).getTime() < 3 * 86400000) done.push({ ...item, done_at: n.read_at });
  }
  // поручения: новые — «Беру», принятые — в работе
  const jobs = await db.query("SELECT * FROM jobs WHERE tg_id = $1 AND status IN ('new', 'in_progress', 'returned')", [uidS]);
  for (const j of jobs) {
    const item = { key: `job:${j.id}`, type: 'job', color: j.status === 'returned' ? 'red' : 'blue', title: j.status === 'returned' ? `Поручение на доработку № ${j.job_no}` : `Поручение № ${j.job_no}`,
      text: `${j.title}${j.due_at ? ` · до ${fmtDue(j.due_at)}${j.due_time ? `, ${j.due_time}` : ''}` : ''} · +${ptsRu(j.points)} б`, at: j.created_at, action: 'Беру', job_id: j.id };
    if (!j.ack_at) newItems.push(item); else work.push({ ...item, action: '', steps: [{ label: 'прочитал', ok: true }, { label: 'принял', ok: true }, { label: 'сдал', ok: false }] });
  }
  // объявления
  const f = annActive();
  const anns = await db.query(`SELECT a.*, (SELECT at FROM announcement_acks k WHERE k.ann_id = a.id AND k.tg_id = $3) AS acked_at FROM announcements a WHERE ${f.sql} ORDER BY created_at DESC LIMIT 20`, [...f.args, uidS]);
  for (const a of anns.filter((x) => (x.audience === 'everyone' || x.audience === user.role || (x.audience === 'all' && user.role !== 'admin')) && String(x.author_id) !== uidS)) {
    const item = { key: `ann:${a.id}`, type: 'ann', color: { info: 'orange', boost: 'purple', alert: 'red', good: 'green' }[a.color] || 'orange', title: a.title, text: a.body || 'Объявление офиса', at: a.created_at, action: 'Понятно', author: a.author_name };
    if (!a.acked_at) newItems.push(item); else if (Date.now() - new Date(a.acked_at).getTime() < 3 * 86400000) done.push({ ...item, done_at: a.acked_at });
  }
  // в работе: принятые заявки, по которым ещё не закончен выезд
  for (const t of tasks.filter((x) => x.ack_at)) {
    const steps = [{ label: 'принял', ok: true }, { label: 'позвонил', ok: Boolean(t.call_status) }, { label: 'выехал', ok: Boolean(t.en_route_at) }, { label: 'начал', ok: Boolean(t.visit_id) }];
    work.push({ key: `task:${t.id}`, type: 'task', color: taskMult(t).mult_eff > 1 ? 'purple' : 'orange', title: `Заявка № ${t.task_no} · ${t.company_name || t.address}`,
      text: [t.planned_at ? fmtTaskDate(t.planned_at, t.has_time) : '', t.address].filter(Boolean).join(' · '), at: t.ack_at, action: '', task_id: t.id, visit_id: t.visit_id || null, steps });
  }
  const pr = (i) => (i.type === 'call' ? 0 : i.urgent ? 1 : i.type === 'task' ? 2 : i.type === 'job' ? 3 : i.type === 'ann' ? 4 : 5);
  newItems.sort((a, b) => pr(a) - pr(b) || String(b.at).localeCompare(String(a.at)));
  done.sort((a, b) => String(b.done_at).localeCompare(String(a.done_at)));
  return { new: newItems, work, done: done.slice(0, 20), counts: { new: newItems.length, work: work.length } };
}
route('GET', '/api/inbox', async ({ user }) => inboxFor(user));
route('POST', '/api/inbox/ack', async ({ body, user }) => {
  const key = str(body.key, 120);
  const [type, id] = [key.split(':')[0], key.slice(key.indexOf(':') + 1)];
  must(id && ['call', 'task', 'note', 'job', 'ann'].includes(type), 400, 'Неизвестное уведомление');
  if (type === 'call') { const r = await ackOfficeCall(id, user.id); must(r.ok || r.reason === 'done', 404, 'Вызов не найден'); }
  if (type === 'task') {
    const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    must(t && t.tech_tg_id === user.id, 404, 'Заявка не найдена');
    if (!t.ack_at) await ackTask(t, user.name);
    await db.query('UPDATE notifications SET read_at = COALESCE(read_at, $1) WHERE tg_id = $2 AND task_id = $3', [now(), user.id, t.id]);
  }
  if (type === 'note') await db.query('UPDATE notifications SET read_at = COALESCE(read_at, $1) WHERE id = $2 AND tg_id = $3', [now(), id, user.id]);
  if (type === 'job') { const j = await getJob(id); must(j.tg_id === user.id, 403, 'Это поручение другого сотрудника'); await ackJob(j); }
  if (type === 'ann') await ackAnnouncement(id, user.id);
  const xp = (await awardXp(user.id, 'ack', XP.ack, `ack:${key}`, 'ответил офису')) ? XP.ack : 0;
  return { ok: true, xp };
});

async function handleUpdate(u) {
  const mcm = u.my_chat_member;
  if (mcm) {
    const st = mcm.new_chat_member?.status;
    if (st === 'left' || st === 'kicked') await db.query('DELETE FROM tg_chats WHERE id = $1', [String(mcm.chat.id)]);
    else if (mcm.chat.type !== 'private') await rememberChat(mcm.chat);
    return;
  }
  if (u.callback_query) return handleCallback(u.callback_query);
  if (u.edited_message?.location && u.edited_message.chat?.type === 'private') return handleLocation(u.edited_message, true);
  if (u.edited_message) return handleTaskEdit(u.edited_message);
  if (u.message?.location && u.message.chat?.type === 'private') return handleLocation(u.message, false);

  const m = u.message || u.channel_post;
  if (!m?.chat) return;
  const c = m.chat;
  if (c.type !== 'private') await rememberChat(c);
  const text = String(m.text || m.caption || '').trim();
  const cmd = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  const threadId = m.is_topic_message ? m.message_thread_id : undefined;
  lastUpdateAt = now();
  if (c.type !== 'private') await rememberTopicName(m).catch(() => {});
  // написал боту в личку — значит, бот запущен
  if (c.type === 'private' && m.from?.id) await db.query('UPDATE users SET bot_blocked_at = NULL, bot_warned_at = NULL WHERE tg_id = $1 AND bot_blocked_at IS NOT NULL', [String(m.from.id)]).catch(() => {});
  const log = (result) => logTg({ chat: chatTitle(c), chat_id: String(c.id), thread: threadId || null, from: m.from?.first_name || '', text, result });

  // /status — проверка прямо в теме: привязана ли, видит ли бот сообщения
  if ((cmd === '/status' || cmd === '/check') && c.type !== 'private') {
    const tech = (await topicBindings())[topicKey(c.id, threadId)];
    const [u] = tech ? await db.query('SELECT name FROM users WHERE tg_id = $1', [tech]) : [];
    let me = null; let member = null;
    try { me = await getMe(); member = await getChatMember(c.id, me.id); } catch { /* ignore */ }
    const isAdm = member && ['administrator', 'creator'].includes(member.status);
    const office = await officeChat();
    const L = [
      '🔎 <b>Проверка</b>',
      `Чат: <code>${escHtml(String(c.id))}</code>${threadId ? ` · тема <code>${threadId}</code>` : ' · без темы'}`,
      tech ? `✅ Тема привязана к <b>${escHtml(u?.name || tech)}</b>` : '❌ Тема не привязана — отправьте здесь /tech и выберите сотрудника',
      isAdm ? '✅ Бот — администратор группы' : (me?.can_read_all_group_messages ? '✅ Бот видит все сообщения (privacy off)' : '❌ Бот не администратор — он не видит обычные сообщения. Сделайте его админом группы'),
      office && String(office.id) === String(c.id) ? '📄 Сюда же приходят PDF-акты' : '',
    ].filter(Boolean);
    await sendMessage(c.id, L.join('\n'), { threadId });
    log('команда /status');
    return;
  }

  if (cmd === '/office' && c.type !== 'private') {
    if (!(await isAdminTg(m.from?.id))) {
      await sendMessage(c.id, '⛔️ Подключить чат может только администратор приложения.', { threadId });
      return;
    }
    const chat = { id: String(c.id), title: chatTitle(c) + (threadId ? ' · тема' : ''), ...(threadId ? { thread_id: String(threadId) } : {}) };
    await setSetting('office_chat', chat);
    await sendMessage(c.id, `✅ ${threadId ? 'Эта тема подключена' : 'Чат подключён'}. Сюда будут приходить отчёты о выездах.`, { threadId });
    log('чат офиса подключён');
    return;
  }

  // /tech — привязать тему к технику: сообщения в теме станут его заявками
  if (cmd === '/tech' && c.type !== 'private') {
    if (!(await isAdminTg(m.from?.id))) {
      await sendMessage(c.id, '⛔️ Привязать тему может только администратор приложения.', { threadId });
      return;
    }
    // выездов у администраторов/менеджеров нет — в списке только специалисты
    const techs = await db.query("SELECT tg_id, name, role FROM users WHERE status = 'active' AND role NOT IN ('admin', 'manager') ORDER BY name");
    const current = (await topicBindings())[topicKey(c.id, threadId)];
    const cur = techs.find((t) => t.tg_id === current);
    const kb = techs.map((t) => [{ text: `${t.tg_id === current ? '✅ ' : ''}${t.name}${t.role === 'admin' ? ' (админ)' : ''}`, callback_data: `bind:${t.tg_id}` }]);
    kb.push([{ text: 'Отвязать тему', callback_data: 'bind:-' }]);
    await sendMessage(c.id, `👷 Чьи заявки пишутся в этой теме?${cur ? `\nСейчас: <b>${escHtml(cur.name)}</b>` : ''}`, { threadId, replyMarkup: { inline_keyboard: kb } });
    log('команда /tech');
    return;
  }

  if ((cmd === '/help' || cmd === '/zayavka' || cmd === '/шаблон') && c.type !== 'private') {
    await sendMessage(c.id, `📝 <b>Как написать заявку</b>\nПросто сообщением в теме техника. Можно по шаблону:\n\n<code>${escHtml(TASK_TEMPLATE)}</code>\n\nИли свободно: «SRL Beta, str. Ismail 33, клопы, завтра 11:00».\nОтменить — ответьте на заявку словом «отмена».`, { threadId });
    return;
  }

  if (cmd === '/start' && c.type === 'private' && /^\/start\s+applogin_/.test(text)) {
    await handleAppLoginStart(c.id, m.from, text.split(/\s+/)[1].slice('applogin_'.length));
    return;
  }
  if (cmd === '/start' && c.type === 'private') {
    const base = publicBase();
    await sendMessage(c.id, '👋 Приложение для учёта обработок.\nНажмите кнопку ниже или «Заявки» слева от поля ввода.',
      base ? { replyMarkup: { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: base } }]] } } : {});
    return;
  }

  // ответ на PDF-акт в чате офиса → замечание технику
  if (c.type !== 'private' && text && !text.startsWith('/') && !m.from?.is_bot && m.reply_to_message?.message_id) {
    const [v] = await db.query('SELECT id, tech_tg_id, tech_name FROM visits WHERE office_msg_id = $1', [String(m.reply_to_message.message_id)]);
    const office = await officeChat();
    if (v && office && String(office.id) === String(c.id)) {
      const author = { id: String(m.from?.id || ''), name: [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || 'Офис' };
      await createRemark({ techId: v.tech_tg_id, text, visitId: v.id, author });
      await sendMessage(c.id, `📌 Замечание отправлено: <b>${escHtml(v.tech_name)}</b>`, { threadId, replyTo: m.message_id });
      log(`замечание → ${v.tech_name}`);
      return;
    }
  }

  // сообщение в теме техника → заявка
  if (c.type === 'private' || !text || text.startsWith('/') || m.from?.is_bot) {
    if (c.type !== 'private' && !m.from?.is_bot) log(text ? 'команда — пропущено' : 'без текста — пропущено');
    return;
  }
  let tech = (await topicBindings())[topicKey(c.id, threadId)];
  // тема «Заявки Артем» → ответственный Артем: привязываем автоматически (и перепривязываем, если тема была на админе)
  if (threadId) {
    const auto = await autoBindTopic(c, threadId, m, tech);
    if (auto) tech = auto;
  }
  if (!tech) { log(threadId ? 'тема не привязана (/tech)' : 'сообщение вне темы — пропущено'); return; }
  if (await isAdminTg(tech)) {
    if (parseTask(text)) {
      await sendMessage(c.id, '⚠️ Тема привязана к администратору, а у администраторов выездов нет. Привяжите тему к специалисту: /tech — и отправьте заявку заново (или отредактируйте сообщение).', { threadId, replyTo: m.message_id }).catch(() => {});
    }
    log('тема привязана к администратору — заявка не создана');
    return;
  }

  // «отмена» ответом на заявку
  const replyId = m.reply_to_message && m.reply_to_message.message_id !== threadId ? String(m.reply_to_message.message_id) : null;
  if (replyId && /^(отмена|отменить|отменяем|cancel|anulat|anulare|anulează)([\s!.,]|$)/i.test(text)) {
    const [t] = await db.query('SELECT * FROM tasks WHERE chat_id = $1 AND (message_id = $2 OR confirm_id = $2)', [String(c.id), replyId]);
    if (t) await cancelTask(t, m.from?.first_name || 'офис');
    log(t ? `отмена заявки № ${t.task_no}` : 'отмена — заявка не найдена');
    return;
  }

  const parsed = parseTask(text);
  if (!parsed) {
    if (looksLikeTask(text)) {
      await sendMessage(c.id, '⚠️ Не понял заявку: не нашёл адрес. Добавьте строку «Адрес: …» или отредактируйте сообщение. Шаблон — /help', { threadId, replyTo: m.message_id }).catch(() => {});
      log('не распознано: нет адреса');
    } else log('обычная переписка — пропущено');
    return;
  }
  const created = await createTask({ parsed, tech, chatId: String(c.id), threadId, messageId: String(m.message_id), author: [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' '), authorId: m.from?.id });
  log(created ? `заявка № ${created.task_no} → ${created.tech_name}` : 'сотрудник темы не найден — привяжите заново (/tech)');
}

// ---------- «кто заберёт»: задача/поручение для категории сотрудников ----------
const AUDIENCE_LABEL = { all: 'все сотрудники', tech: 'дезинсекторы', specialist: 'специалисты', manager: 'менеджеры' };
/** Кто входит в категорию: для обработок — только выездные (без менеджеров). */
async function audienceUsers(aud, { forJob = false, except = [] } = {}) {
  const roles = aud === 'all' ? (forJob ? ['tech', 'specialist', 'manager'] : ['tech', 'specialist']) : [aud];
  const rows = await db.query(`SELECT tg_id, name, role FROM users WHERE status = 'active' AND role IN (${roles.map((_, i) => `$${i + 1}`).join(',')})`, roles);
  return rows.filter((u) => !except.includes(u.tg_id));
}
const audienceOk = (aud, role) => aud === 'all' ? role !== 'admin' : aud === role;
/** Рассылка «🙋 Забрать» всем из категории; id сообщений сохраняем, чтобы потом отметить «Забрал …». */
async function broadcastClaim(table, id, users, html, cb) {
  const sent = [];
  for (const u of users) {
    addNotification(u.tg_id, 'info', html.replace(/<[^>]+>/g, ''), {}).catch(() => {});
    if (!botEnabled || !/^\d+$/.test(u.tg_id)) continue;
    try {
      const m = await sendMessage(u.tg_id, html, { replyMarkup: { inline_keyboard: [[{ text: '🙋 Забрать', callback_data: `${cb}:${id}` }], ...(publicBase() ? [[{ text: 'Открыть приложение', web_app: { url: publicBase() } }]] : [])] } });
      if (m?.message_id) sent.push({ chat: u.tg_id, msg: String(m.message_id) });
    } catch (e) { botSendFailed(u.tg_id, e, { about: 'рассылка «кто заберёт»' }).catch(() => {}); }
  }
  await db.query(`UPDATE ${table} SET bcast = $1 WHERE id = $2`, [JSON.stringify(sent), id]);
}
async function closeBroadcast(row, text) {
  let list = []; try { list = JSON.parse(row.bcast || '[]'); } catch { /* пусто */ }
  for (const b of list) editMessage(b.chat, b.msg, text).catch(() => {});
}

// ---------- объявления (собрание, повышенный коэффициент и т. п.) ----------
const ANN_COLORS = ['info', 'boost', 'alert', 'good'];
route('POST', '/api/admin/announcements', async ({ body, user }) => {
  const title = str(body.title, 200);
  must(title.length >= 3, 400, 'Напишите заголовок объявления');
  const color = ANN_COLORS.includes(body.color) ? body.color : 'info';
  const audience = ['all', 'tech', 'specialist', 'manager', 'everyone'].includes(body.audience) ? body.audience : 'all';
  const expires = body.expires_at ? str(body.expires_at, 10) : null;
  must(!expires || /^\d{4}-\d{2}-\d{2}$/.test(expires), 400, 'Некорректная дата');
  const a = { id: uid(), title, body: str(body.body, 3000), color, audience, author_id: user.id, author_name: user.name, expires_at: expires, created_at: now() };
  await db.query('INSERT INTO announcements (id, title, body, color, audience, author_id, author_name, expires_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [a.id, a.title, a.body, a.color, a.audience, a.author_id, a.author_name, a.expires_at, a.created_at]);
  await audit(user, 'Объявление', title, AUDIENCE_LABEL[audience] || 'все, включая администраторов');
  const icon = { info: '📣', boost: '⚡', alert: '❗️', good: '🎉' }[color];
  const users = audience === 'everyone'
    ? await db.query("SELECT tg_id, name FROM users WHERE status = 'active'")
    : await audienceUsers(audience, { forJob: true });
  const html = `${icon} <b>${escHtml(title)}</b>${a.body ? `\n\n${escHtml(a.body)}` : ''}\n\n— ${escHtml(user.name)}`;
  for (const u of users) {
    if (u.tg_id === user.id) continue;
    addNotification(u.tg_id, 'ann', `${icon} ${title}${a.body ? ` — ${a.body}` : ''}`, {}).catch(() => {});
    if (botEnabled && /^\d+$/.test(u.tg_id)) sendMessage(u.tg_id, html, { replyMarkup: { inline_keyboard: [[{ text: '👍 Понятно', callback_data: `annok:${a.id}` }]] } })
      .catch((e) => botSendFailed(u.tg_id, e, { about: 'объявление' }).catch(() => {}));
  }
  return { ok: true, id: a.id, sent: users.length };
}, { access: 'admin' });
async function ackAnnouncement(id, tgId) {
  await db.query('INSERT INTO announcement_acks (ann_id, tg_id, at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, String(tgId), now()]);
}
const annActive = () => ({ sql: '(expires_at IS NULL OR expires_at >= $1) AND created_at >= $2', args: [todayLocal(), new Date(Date.now() - 30 * 86400000).toISOString()] });
route('GET', '/api/announcements', async ({ user }) => {
  const f = annActive();
  const rows = await db.query(`SELECT a.*, (SELECT at FROM announcement_acks k WHERE k.ann_id = a.id AND k.tg_id = $3) AS acked_at FROM announcements a WHERE ${f.sql} ORDER BY created_at DESC LIMIT 20`, [...f.args, user.id]);
  const role = user.role;
  const mine = rows.filter((a) => a.audience === 'everyone' || a.audience === role || (a.audience === 'all' && role !== 'admin')).filter((a) => String(a.author_id) !== String(user.id));
  return { items: mine.map((a) => ({ id: a.id, title: a.title, body: a.body, color: a.color, author_name: a.author_name, created_at: a.created_at, expires_at: a.expires_at, acked: Boolean(a.acked_at) })) };
});
route('POST', '/api/announcements/:id/ack', async ({ params, user }) => {
  await ackAnnouncement(params.id, user.id);
  return { ok: true };
});
route('GET', '/api/admin/announcements', async () => {
  const rows = await db.query('SELECT a.*, (SELECT COUNT(*) FROM announcement_acks k WHERE k.ann_id = a.id) AS acks FROM announcements a ORDER BY created_at DESC LIMIT 30');
  const out = [];
  for (const a of rows) {
    const users = a.audience === 'everyone' ? await db.query("SELECT tg_id, name FROM users WHERE status = 'active'") : await audienceUsers(a.audience, { forJob: true });
    const acked = new Set((await db.query('SELECT tg_id FROM announcement_acks WHERE ann_id = $1', [a.id])).map((r) => r.tg_id));
    const target = users.filter((u) => u.tg_id !== a.author_id);
    out.push({ id: a.id, title: a.title, body: a.body, color: a.color, audience: a.audience, author_name: a.author_name, created_at: a.created_at, expires_at: a.expires_at,
      total: target.length, read: target.filter((u) => acked.has(u.tg_id)).length, unread: target.filter((u) => !acked.has(u.tg_id)).map((u) => u.name) });
  }
  return { items: out };
}, { access: 'admin' });
route('DELETE', '/api/admin/announcements/:id', async ({ params, user }) => {
  await db.query('DELETE FROM announcements WHERE id = $1', [params.id]);
  await db.query('DELETE FROM announcement_acks WHERE ann_id = $1', [params.id]);
  await audit(user, 'Объявление удалено', params.id);
  return { ok: true };
}, { access: 'admin' });

// ---------- поручения специалистам (не обработки): «снять 10 рекламных видео» и т. п. ----------
// Ставит администратор в админ-панели, назначает стоимость в баллах. Специалист отмечает прогресс и сдаёт,
// администратор принимает (баллы идут в KPI как бонус) или возвращает на доработку.
const JOB_OPEN = ['open', 'new', 'in_progress', 'returned', 'submitted'];
const todayLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: TZN });
const fmtDue = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '');
const ptsRu = (n) => String(r2(Number(n) || 0)).replace('.', ',');

/** Срок поручения: дата + время (по умолчанию конец рабочего дня 18:00), в часовом поясе компании. */
const JOB_DEFAULT_TIME = '18:00';
function jobDeadline(j) {
  if (!j.due_at) return null;
  const [y, m, d] = j.due_at.split('-').map(Number);
  const [hh, mm] = (j.due_time || JOB_DEFAULT_TIME).split(':').map(Number);
  return new Date(zonedIso(y, m, d, hh, mm));
}
function shapeJob(j) {
  const dl = jobDeadline(j);
  return {
    ...j, points: Number(j.points) || 0, target: j.target == null ? null : Number(j.target), done_count: Number(j.done_count) || 0,
    awarded: j.awarded == null ? null : Number(j.awarded), due_time: j.due_time || '',
    penalty: Number(j.penalty) || 0, penalized: Boolean(j.penalized_at),
    late: Boolean(dl && j.submitted_at && new Date(j.submitted_at) > dl),
    overdue: Boolean(dl && JOB_OPEN.includes(j.status) && j.status !== 'submitted' && dl < new Date()),
  };
}
function jobSummary(j, name) {
  return [
    `🎯 <b>Поручение № ${j.job_no}</b>${name ? ` → ${escHtml(name)}` : ''}`,
    `<b>${escHtml(j.title)}</b>`,
    j.descr && escHtml(j.descr),
    j.target ? `📊 Нужно: ${j.target} шт.` : '',
    j.due_at ? `🗓 Срок: до ${escHtml(fmtDue(j.due_at))}, ${escHtml(j.due_time || JOB_DEFAULT_TIME)}` : '',
    `⭐ Бонус: <b>+${ptsRu(j.points)} б</b> в KPI${j.due_at ? ' — если сдать в срок' : ''}`,
    Number(j.penalty) > 0 && j.due_at ? `⚠️ Не сдано в срок — штраф <b>−${ptsRu(j.penalty)} б</b>` : '',
  ].filter(Boolean).join('\n');
}
async function getJob(id) {
  const [j] = await db.query('SELECT j.*, u.name AS tech_name, r.name AS reviewer_name FROM jobs j LEFT JOIN users u ON u.tg_id = j.tg_id LEFT JOIN users r ON r.tg_id = j.reviewer_id WHERE j.id = $1', [id]);
  must(j, 404, 'Поручение не найдено');
  return j;
}
function jobKb(j) {
  const kb = [];
  if (!j.ack_at) kb.push([{ text: '✅ Принял в работу', callback_data: `jack:${j.id}` }]);
  const base = publicBase();
  if (base) kb.push([{ text: 'Открыть приложение', web_app: { url: base } }]);
  return kb.length ? { inline_keyboard: kb } : undefined;
}
const jobDecideKb = (j) => ({ inline_keyboard: [[{ text: `👍 Принять +${ptsRu(j.points)} б`, callback_data: `jok:${j.id}` }, { text: '↩️ На доработку', callback_data: `jret:${j.id}` }]] });

route('GET', '/api/jobs', async ({ user, query }) => {
  const all = user.isAdmin && query.get('all') !== '0';
  const tech = query.get('tech') || '';
  const where = [];
  const args = [];
  if (!all) {
    args.push(user.id); const me = args.length;
    args.push(user.role); const role = args.length;
    where.push(`(j.tg_id = $${me} OR j.reviewer_id = $${me} OR (j.status = 'open' AND (j.audience = $${role} OR (j.audience = 'all' AND $${role} <> 'admin'))))`);
  }
  else if (tech) { args.push(tech); where.push(`j.tg_id = $${args.length}`); }
  // открытые + закрытые за последние 45 дней
  args.push(new Date(Date.now() - 45 * 86400000).toISOString());
  where.push(`(j.status IN ('open','new','in_progress','returned','submitted') OR j.updated_at >= $${args.length})`);
  const rows = await db.query(`SELECT j.*, u.name AS tech_name, u.bot_blocked_at AS tech_bot_blocked, r.name AS reviewer_name FROM jobs j LEFT JOIN users u ON u.tg_id = j.tg_id LEFT JOIN users r ON r.tg_id = j.reviewer_id
    WHERE ${where.join(' AND ')} ORDER BY CASE j.status WHEN 'open' THEN -1 WHEN 'submitted' THEN 0 WHEN 'returned' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'new' THEN 3 ELSE 4 END, COALESCE(j.due_at, '9999') , j.created_at DESC LIMIT 200`, args);
  const files = rows.length ? await db.query(`SELECT * FROM job_files WHERE ready = 1 AND job_id IN (${rows.map((_, i) => `$${i + 1}`).join(',')}) ORDER BY created_at`, rows.map((r) => r.id)) : [];
  const byJob = {};
  for (const f of files) (byJob[f.job_id] ||= []).push(shapeJobFile(f));
  return { items: rows.map((r) => ({ ...shapeJob(r), files: byJob[r.id] || [], tech_bot_blocked: Boolean(r.tech_bot_blocked) })) };
});

// ---------- файлы к поручению (видео, фото, документы) — хранятся в Telegram ----------
const jobFilePath = (id) => `/r/jobfile/${id}?${signLink(`jobfile:${id}`, 3600 * 24 * 30)}`;
function shapeJobFile(f) {
  return { id: f.id, name: f.name, mime: f.mime, size: Number(f.size) || 0, kind: f.kind, tg_id: f.tg_id, created_at: f.created_at, url: jobFilePath(f.id), download_url: `${jobFilePath(f.id)}&dl=1`, stored: Boolean(f.storage_key) };
}
/** Куда отправить файл поручения: проверяющему, иначе в чат офиса / администраторам. */
async function jobFileTargets(j, user) {
  const office = await officeChat();
  const targets = [
    ...(j.reviewer_id && j.reviewer_id !== user.id ? [{ id: j.reviewer_id }] : []),
    ...(office ? [{ id: office.id, thread: office.thread_id }] : (await adminIds(db)).filter((a) => a !== user.id).map((a) => ({ id: a }))),
  ];
  must(targets.length, 400, 'Нет чата офиса и администраторов — некуда сохранить файл');
  return targets;
}
async function jobForFiles(id, user) {
  const j = await getJob(id);
  must(j.tg_id === user.id || j.reviewer_id === user.id || user.isAdmin, 403, 'Это поручение другого сотрудника');
  must(!['accepted', 'cancelled'].includes(j.status), 400, 'Поручение уже закрыто');
  return j;
}
/** Отправить файл в Telegram (buf) или ссылкой на хранилище (большой файл). */
async function postJobFile(j, user, { buf, mime, name, fileRowId, sizeBytes }) {
  const cap = `📎 Файл к поручению № ${j.job_no} «${escHtml(j.title)}» · ${escHtml(user.name)}`;
  let sent = null;
  for (const t of await jobFileTargets(j, user)) {
    try {
      const m = buf ? await sendMedia(t.id, buf, { mime, filename: name, caption: cap, threadId: t.thread })
        : await sendMessage(t.id, `${cap}\n📦 ${escHtml(name)} · ${mb(sizeBytes)}`, { threadId: t.thread, replyMarkup: publicBase() ? { inline_keyboard: [[{ text: '⬇️ Открыть / скачать', url: publicBase() + jobFilePath(fileRowId) + '&dl=1' }]] } : undefined });
      if (!sent) sent = m;
    } catch (e) { console.error('job file:', e.message); }
  }
  must(sent, 502, 'Telegram не принял файл — попробуйте ещё раз');
  return {
    fileId: sent.video?.file_id || sent.photo?.[sent.photo.length - 1]?.file_id || sent.document?.file_id || sent.audio?.file_id || '',
    kind: sent.video ? 'video' : sent.photo ? 'photo' : 'document',
  };
}
route('POST', '/api/jobs/:id/files', async ({ req, params, user }) => {
  must(botEnabled, 400, 'Бот не настроен — файлы некуда сохранить');
  const j = await jobForFiles(params.id, user);
  const mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const buf = await readRaw(req, MEDIA_MAX);
  must(buf.length > 0, 400, 'Пустой файл');
  const name = decodeURIComponent(String(req.headers['x-file-name'] || '')).slice(0, 120) || 'file';
  const id = uid();
  const r = await postJobFile(j, user, { buf, mime, name, fileRowId: id, sizeBytes: buf.length });
  await db.query('INSERT INTO job_files (id, job_id, tg_id, name, mime, size, file_id, kind, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, j.id, user.id, name, mime, buf.length, r.fileId, r.kind, now()]);
  await audit(user, 'Файл к поручению', `№ ${j.job_no} · ${j.title}`, `${name}, ${Math.round(buf.length / 1024)} КБ`);
  return { ok: true, id };
}, { raw: true });
/** Большой файл к поручению: ссылка на загрузку прямо в хранилище → complete. */
route('POST', '/api/jobs/:id/files/start', async ({ params, body, user }) => {
  if (!storageOn()) return { mode: 'telegram', max: MEDIA_MAX };
  must(botEnabled, 400, 'Бот не настроен — файлы некуда сохранить');
  const j = await jobForFiles(params.id, user);
  const size = Number(body.size) || 0;
  must(size > 0, 400, 'Пустой файл');
  must(size <= uploadMaxBytes(), 413, `Файл больше ${mb(uploadMaxBytes())}`);
  const id = uid();
  const name = str(body.name, 120) || 'file';
  const mime = str(body.mime, 100).toLowerCase() || 'application/octet-stream';
  const key = objectKey('jobs', id, name);
  const kind = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'photo' : 'document';
  await db.query('INSERT INTO job_files (id, job_id, tg_id, name, mime, size, file_id, kind, created_at, storage_key, ready) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0)',
    [id, j.id, user.id, name, mime, size, '', kind, now(), key]);
  return { mode: 's3', id, put_url: presign('PUT', key, 6 * 3600) };
});
route('POST', '/api/jobs/:id/files/:fid/complete', async ({ params, user }) => {
  const [f] = await db.query('SELECT * FROM job_files WHERE id = $1 AND job_id = $2', [params.fid, params.id]);
  must(f && f.tg_id === user.id, 404, 'Файл не найден');
  if (Number(f.ready)) return { ok: true, id: f.id };
  const j = await getJob(params.id);
  const head = await headObject(f.storage_key);
  must(head && head.size > 0, 400, 'Файл не дошёл до хранилища — загрузите ещё раз');
  let buf = null;
  if (head.size <= TG_INLINE_MAX) { try { buf = await getObject(f.storage_key); } catch (e) { console.error('job file get:', e.message); } }
  const r = await postJobFile(j, user, { buf, mime: f.mime, name: f.name, fileRowId: f.id, sizeBytes: head.size });
  await db.query('UPDATE job_files SET ready = 1, size = $1, file_id = $2, kind = $3, created_at = $4 WHERE id = $5', [head.size, r.fileId, buf ? r.kind : f.kind, now(), f.id]);
  await audit(user, 'Файл к поручению', `№ ${j.job_no} · ${j.title}`, `${f.name}, ${mb(head.size)}`);
  return { ok: true, id: f.id };
});
route('DELETE', '/api/jobs/:id/files/:fid/upload', async ({ params, user }) => {
  const [f] = await db.query('SELECT * FROM job_files WHERE id = $1 AND job_id = $2 AND ready = 0', [params.fid, params.id]);
  if (!f || f.tg_id !== user.id) return { ok: true };
  await db.query('DELETE FROM job_files WHERE id = $1', [f.id]);
  deleteObject(f.storage_key);
  return { ok: true };
});
route('DELETE', '/api/jobs/:id/files/:fid', async ({ params, user }) => {
  const [f] = await db.query('SELECT * FROM job_files WHERE id = $1 AND job_id = $2', [params.fid, params.id]);
  must(f, 404, 'Файл не найден');
  must(f.tg_id === user.id || user.isAdmin, 403, 'Удалить может тот, кто загрузил');
  await db.query('DELETE FROM job_files WHERE id = $1', [f.id]);
  if (f.storage_key) deleteObject(f.storage_key);
  return { ok: true };
});
route('POST', '/api/jobs/:id/files/:fid/send-me', async ({ params, user }) => {
  const [f] = await db.query('SELECT * FROM job_files WHERE id = $1 AND job_id = $2', [params.fid, params.id]);
  must(f && (f.file_id || f.storage_key), 404, 'Файл не найден');
  if (!f.file_id) {
    await sendMessage(user.id, `📎 ${escHtml(f.name)} · ${mb(f.size)}`, { replyMarkup: { inline_keyboard: [[{ text: '⬇️ Открыть / скачать', url: objectUrl(f.storage_key, { download: f.name, expires: 7 * 86400 }) }]] } });
    return { ok: true };
  }
  const method = f.kind === 'video' ? 'sendVideo' : f.kind === 'photo' ? 'sendPhoto' : 'sendDocument';
  await tgCall(method, { chat_id: user.id, [f.kind === 'video' ? 'video' : f.kind === 'photo' ? 'photo' : 'document']: f.file_id, caption: `📎 ${f.name}`.slice(0, 1000) });
  return { ok: true };
});

route('GET', '/api/admin/assignees', async () => {
  // менеджеры — только для поручений (на обработки их не назначают)
  const rows = await db.query("SELECT tg_id, name, role, bot_blocked_at FROM users WHERE status = 'active' AND role <> 'admin' ORDER BY name");
  return { items: rows.map((r) => ({ id: r.tg_id, name: r.name, role: r.role, bot_blocked: Boolean(r.bot_blocked_at) })) };
}, { access: 'admin' });

function jobFields(body, partial = false) {
  const out = {};
  if (!partial || body.title !== undefined) { out.title = str(body.title, 200); must(out.title.length >= 3, 400, 'Опишите задачу — хотя бы пару слов'); }
  if (!partial || body.descr !== undefined) out.descr = str(body.descr, 3000);
  if (!partial || body.due_at !== undefined) {
    out.due_at = body.due_at ? str(body.due_at, 10) : null;
    must(!out.due_at || /^\d{4}-\d{2}-\d{2}$/.test(out.due_at), 400, 'Некорректный срок');
  }
  if (!partial || body.due_time !== undefined) {
    out.due_time = body.due_time ? str(body.due_time, 5) : '';
    must(!out.due_time || /^([01]\d|2[0-3]):[0-5]\d$/.test(out.due_time), 400, 'Некорректное время срока');
  }
  if (!partial || body.penalty !== undefined) {
    const p = Number(String(body.penalty ?? 0).replace(',', '.'));
    must(Number.isFinite(p) && p >= 0 && p <= 100, 400, 'Штраф — от 0 до 100 баллов');
    out.penalty = r2(p);
  }
  if (!partial || body.points !== undefined) {
    const n = Number(String(body.points ?? 0).replace(',', '.'));
    must(Number.isFinite(n) && n >= 0 && n <= 100, 400, 'Бонус — от 0 до 100 баллов');
    out.points = r2(n);
  }
  if (!partial || body.target !== undefined) {
    const t = body.target === '' || body.target == null ? null : Math.round(Number(body.target));
    must(t == null || (Number.isFinite(t) && t >= 1 && t <= 10000), 400, 'Количество — от 1');
    out.target = t;
  }
  return out;
}

route('POST', '/api/admin/jobs', async ({ body, user }) => {
  const ids = (Array.isArray(body.tg_ids) ? body.tg_ids : [body.tg_id]).map((x) => str(x, 40)).filter(Boolean);
  const audience = ['all', 'tech', 'specialist', 'manager'].includes(body.audience) ? body.audience : '';
  must(ids.length || audience, 400, 'Выберите сотрудника или категорию «кто заберёт»');
  const f = jobFields(body);
  if (audience) {
    // поручение «кто заберёт»: первый нажавший «Забрать» становится исполнителем
    const [r] = await db.query('SELECT MAX(job_no) AS m FROM jobs');
    const j = { id: uid(), job_no: (Number(r?.m) || 0) + 1, tg_id: '', ...f, status: 'open', author_id: user.id, author_name: user.name, created_at: now(), updated_at: now(), reviewer_id: str(body.reviewer_id, 40), audience };
    await db.query(`INSERT INTO jobs (id, job_no, tg_id, title, descr, due_at, points, target, status, author_id, author_name, created_at, updated_at, reviewer_id, due_time, ack_alert_count, penalty, audience)
      VALUES ($1,$2,'',$3,$4,$5,$6,$7,'open',$8,$9,$10,$10,$11,$12,0,$13,$14)`,
    [j.id, j.job_no, j.title, j.descr, j.due_at, j.points, j.target, j.author_id, j.author_name, j.created_at, j.reviewer_id, j.due_time || '', j.penalty || 0, audience]);
    await audit(user, 'Поручение «кто заберёт»', `№ ${j.job_no} · ${j.title}`, `${AUDIENCE_LABEL[audience]} · +${j.points} б`);
    const users = await audienceUsers(audience, { forJob: true, except: [user.id, j.reviewer_id] });
    broadcastClaim('jobs', j.id, users, `🙋 <b>Кто заберёт?</b> Поручение для: ${escHtml(AUDIENCE_LABEL[audience])}\n${jobSummary(j)}\n\nПервый, кто нажмёт «Забрать», получает поручение и награду.`, 'jclaim').catch(() => {});
    return { items: [shapeJob({ ...j, tech_name: '' })] };
  }
  const reviewer = str(body.reviewer_id, 40);
  let reviewerName = '';
  if (reviewer) {
    must((await features()).job_reviewer, 400, 'Проверяющие для поручений выключены в настройках');
    const [r] = await db.query("SELECT name, role FROM users WHERE tg_id = $1 AND status = 'active'", [reviewer]);
    must(r && r.role !== 'admin', 400, 'Принимать работу может сотрудник или менеджер');
    must(!ids.includes(reviewer), 400, 'Проверяющий не может принимать своё поручение');
    reviewerName = r.name;
  }
  const created = [];
  for (const tg of ids) {
    const [u] = await db.query("SELECT tg_id, name, role FROM users WHERE tg_id = $1 AND status = 'active'", [tg]);
    must(u && u.role !== 'admin', 400, 'Поручения ставятся сотрудникам и менеджерам, не главному администратору');
    must(u.tg_id !== user.id, 400, 'Нельзя поставить поручение самому себе');
    const [r] = await db.query('SELECT MAX(job_no) AS m FROM jobs');
    const j = { id: uid(), job_no: (Number(r?.m) || 0) + 1, tg_id: u.tg_id, ...f, status: 'new', author_id: user.id, author_name: user.name, created_at: now(), updated_at: now(), reviewer_id: reviewer, reviewer_name: reviewerName };
    await db.query(`INSERT INTO jobs (id, job_no, tg_id, title, descr, due_at, points, target, status, author_id, author_name, created_at, updated_at, reviewer_id, due_time, ack_alert_at, ack_alert_count, penalty)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$12,1,$16)`,
    [j.id, j.job_no, j.tg_id, j.title, j.descr, j.due_at, j.points, j.target, j.status, j.author_id, j.author_name, j.created_at, j.updated_at, j.reviewer_id, j.due_time || '', j.penalty || 0]);
    await audit(user, 'Новое поручение', `№ ${j.job_no} · ${j.title}`, `для: ${u.name} · +${j.points} б`);
    addNotification(u.tg_id, 'job', `Новое поручение № ${j.job_no}: ${j.title} · +${ptsRu(j.points)} б`, {}).catch(() => {});
    if (botEnabled && /^\d+$/.test(u.tg_id)) {
      sendMessage(u.tg_id, `🆕 ${jobSummary(j)}\n\nПоставил: ${escHtml(user.name)}${reviewerName ? `\nПринимает работу: <b>${escHtml(reviewerName)}</b>` : ''}\n\nНажмите «Принял в работу» — иначе напоминание придёт через 5 мин.`, { replyMarkup: jobKb(j) })
        .then((m) => m?.message_id && db.query('UPDATE jobs SET ack_msg_id = $1 WHERE id = $2', [String(m.message_id), j.id]))
        .catch((e) => { console.error('job send:', e.message); botSendFailed(u.tg_id, e, { extra: [user.id, reviewer], about: `поручение № ${j.job_no}` }).catch(() => {}); });
    }
    if (reviewer) notifyTech(reviewer, `🧑‍⚖️ Вы принимаете работу по поручению № ${j.job_no} «${escHtml(j.title)}» (исполнитель — ${escHtml(u.name)}). Когда он сдаст, придёт сообщение с кнопками.`, { kind: 'info' });
    created.push({ ...j, tech_name: u.name });
  }
  return { items: created.map(shapeJob) };
}, { access: 'admin' });

route('PATCH', '/api/admin/jobs/:id', async ({ params, body, user }) => {
  const j = await getJob(params.id);
  must(!['accepted', 'cancelled'].includes(j.status), 400, 'Поручение уже закрыто');
  const f = jobFields(body, true);
  const keys = Object.keys(f);
  if (keys.length) {
    await db.query(`UPDATE jobs SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = $${keys.length + 1} WHERE id = $${keys.length + 2}`, [...keys.map((k) => f[k]), now(), j.id]);
    if (f.due_at !== undefined || f.due_time !== undefined) await db.query('UPDATE jobs SET due_alert_at = NULL, due_alert_count = 0 WHERE id = $1', [j.id]);
    // срок перенесли после штрафа — штраф снимаем (его заново начислят, если опять не успеют)
    if ((f.due_at !== undefined || f.due_time !== undefined) && j.penalized_at) {
      if (j.penalty_adjust_id) await db.query('DELETE FROM kpi_adjust WHERE id = $1', [j.penalty_adjust_id]);
      await db.query('UPDATE jobs SET penalized_at = NULL, penalty_adjust_id = NULL WHERE id = $1', [j.id]);
    }
    await audit(user, 'Поручение изменено', `№ ${j.job_no} · ${f.title || j.title}`);
    const nj = { ...j, ...f };
    if (botEnabled && /^\d+$/.test(j.tg_id)) sendMessage(j.tg_id, `✏️ Поручение изменено\n${jobSummary(nj)}`).catch(() => {});
  }
  return { ok: true };
}, { access: 'admin' });

route('POST', '/api/admin/jobs/:id/cancel', async ({ params, user }) => {
  const j = await getJob(params.id);
  must(j.status !== 'accepted', 400, 'Поручение уже принято — баллы начислены');
  await db.query("UPDATE jobs SET status = 'cancelled', updated_at = $1 WHERE id = $2", [now(), j.id]);
  await audit(user, 'Поручение отменено', `№ ${j.job_no} · ${j.title}`);
  if (botEnabled && /^\d+$/.test(j.tg_id)) sendMessage(j.tg_id, `❌ Поручение № ${j.job_no} «${escHtml(j.title)}» отменено.`).catch(() => {});
  return { ok: true };
}, { access: 'admin' });

async function ackJob(j) {
  if (j.ack_at) return false;
  await db.query("UPDATE jobs SET ack_at = $1, seen_at = COALESCE(seen_at, $1), status = CASE WHEN status = 'new' THEN 'in_progress' ELSE status END, updated_at = $1 WHERE id = $2", [now(), j.id]);
  // последнее напоминание в боте — отметить как принятое (без кнопки)
  if (j.ack_msg_id && botEnabled && /^\d+$/.test(j.tg_id)) editMessage(j.tg_id, j.ack_msg_id, `${jobSummary(j)}\n\n✅ Принято в работу`).catch(() => {});
  return true;
}
/** Забрать поручение «кто заберёт» (первый успел — его). */
async function claimJob(jobId, tgId) {
  const [u] = await db.query("SELECT tg_id, name, role FROM users WHERE tg_id = $1 AND status = 'active'", [String(tgId)]);
  if (!u) return { error: 'Нет доступа' };
  const [j0] = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  if (!j0) return { error: 'Поручение не найдено' };
  if (j0.status !== 'open') return { error: j0.tg_id === u.tg_id ? 'Вы уже забрали это поручение' : 'Уже забрали' };
  if (!audienceOk(j0.audience, u.role)) return { error: 'Это поручение для другой категории сотрудников' };
  if (j0.reviewer_id === u.tg_id) return { error: 'Вы проверяете это поручение' };
  await db.query("UPDATE jobs SET tg_id = $1, status = 'in_progress', claimed_at = $2, ack_at = $2, seen_at = $2, updated_at = $2 WHERE id = $3 AND status = 'open'", [u.tg_id, now(), jobId]);
  const [j] = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  if (j.tg_id !== u.tg_id) return { error: 'Уже забрали' };
  await audit({ id: u.tg_id, name: u.name }, 'Забрал поручение', `№ ${j.job_no} · ${j.title}`);
  await closeBroadcast(j, `🙋 Поручение № ${j.job_no} «${escHtml(j.title)}» забрал(а) <b>${escHtml(u.name)}</b>`);
  notifyTech(u.tg_id, `✅ Поручение ваше!\n${jobSummary(j)}`, { kind: 'info' });
  if (j.author_id && j.author_id !== u.tg_id) notifyTech(j.author_id, `🙋 ${escHtml(u.name)} забрал(а) поручение № ${j.job_no} «${escHtml(j.title)}»`, { kind: 'info' });
  return { ok: true, name: u.name };
}
route('POST', '/api/jobs/:id/claim', async ({ params, user }) => {
  const r = await claimJob(params.id, user.id);
  must(!r.error, 409, r.error);
  return r;
});

/** Исполнитель открыл поручение в приложении — «прочитано» (вторая галочка у офиса). */
route('POST', '/api/jobs/:id/seen', async ({ params, user }) => {
  const j = await getJob(params.id);
  if (j.tg_id === user.id && !j.seen_at) await db.query('UPDATE jobs SET seen_at = $1 WHERE id = $2', [now(), j.id]);
  return { ok: true };
});

route('POST', '/api/jobs/:id/ack', async ({ params, user }) => {
  const j = await getJob(params.id);
  must(j.tg_id === user.id, 403, 'Это поручение другого сотрудника');
  await ackJob(j);
  return { ok: true };
});

route('POST', '/api/jobs/:id/progress', async ({ params, body, user }) => {
  const j = await getJob(params.id);
  must(j.tg_id === user.id, 403, 'Это поручение другого сотрудника');
  must(['new', 'in_progress', 'returned'].includes(j.status), 400, 'Поручение уже сдано');
  const n = Math.max(0, Math.min(Math.round(Number(body.done_count) || 0), 100000));
  await db.query("UPDATE jobs SET done_count = $1, status = CASE WHEN status = 'new' THEN 'in_progress' ELSE status END, ack_at = COALESCE(ack_at, $2), updated_at = $2 WHERE id = $3", [n, now(), j.id]);
  return { ok: true, done_count: n };
});

route('POST', '/api/jobs/:id/submit', async ({ params, body, user }) => {
  const j = await getJob(params.id);
  must(j.tg_id === user.id, 403, 'Это поручение другого сотрудника');
  must(['new', 'in_progress', 'returned'].includes(j.status), 400, 'Поручение уже сдано');
  const report = str(body.report, 3000);
  const done = body.done_count != null ? Math.max(0, Math.round(Number(body.done_count) || 0)) : Number(j.done_count) || 0;
  await db.query("UPDATE jobs SET status = 'submitted', report = $1, done_count = $2, submitted_at = $3, ack_at = COALESCE(ack_at, $3), updated_at = $3, rev_alert_at = $3, rev_alert_count = 0 WHERE id = $4", [report, done, now(), j.id]);
  if (j.due_msg_id && /^\d+$/.test(j.tg_id)) deleteMessage(j.tg_id, j.due_msg_id).catch(() => {});
  await audit(user, 'Поручение сдано', `№ ${j.job_no} · ${j.title}`);
  const nj = { ...j, report, done_count: done };
  const html = `📬 <b>Сдано поручение № ${j.job_no}</b> · ${escHtml(user.name)}\n<b>${escHtml(j.title)}</b>${j.target ? `\n📊 Выполнено: ${done} из ${j.target}` : ''}${report ? `\n💬 ${escHtml(report)}` : ''}\n\nПроверьте и примите — бонус +${ptsRu(j.points)} б уйдёт в KPI.`;
  if (botEnabled) {
    const office = await officeChat();
    if (j.reviewer_id) {
      // проверяет назначенный специалист; офису — только для сведения
      if (/^\d+$/.test(j.reviewer_id)) sendMessage(j.reviewer_id, `${html}\n\n🧑‍⚖️ Работу принимаете вы.`, { replyMarkup: jobDecideKb(nj) }).catch(() => {});
      addNotification(j.reviewer_id, 'info', `Сдано поручение № ${j.job_no} (${user.name}) — примите или верните`, {}).catch(() => {});
      if (office) sendMessage(office.id, `${html.split('\n\nПроверьте')[0]}\n\nПринимает: ${escHtml(j.reviewer_name || '')}`, { threadId: office.thread_id }).catch(() => {});
    } else if (office) sendMessage(office.id, html, { threadId: office.thread_id, replyMarkup: jobDecideKb(nj) }).catch(() => {});
    else for (const aid of await adminIds(db)) sendMessage(aid, html, { replyMarkup: jobDecideKb(nj) }).catch(() => {});
  }
  return { ok: true };
});

async function decideJob(j, accept, actor, { points, note } = {}) {
  must(!actor?.id || String(actor.id) !== String(j.tg_id), 403, 'Своё поручение принять нельзя — его принимает другой администратор или проверяющий');
  must(j.status === 'submitted' || (accept && ['new', 'in_progress', 'returned'].includes(j.status)), 400, 'Поручение уже закрыто');
  if (j.rev_msg_id && j.reviewer_id && botEnabled) editMessage(j.reviewer_id, j.rev_msg_id, `🎯 Поручение № ${j.job_no} · ${escHtml(j.title)}\n${accept ? '✅ Принято' : '↩️ Возвращено на доработку'}`).catch(() => {});
  if (!accept) {
    await db.query("UPDATE jobs SET status = 'returned', admin_note = $1, updated_at = $2 WHERE id = $3", [note || '', now(), j.id]);
    await audit(actor, 'Поручение на доработку', `№ ${j.job_no} · ${j.title}`, note || '');
    const text = `↩️ Поручение № ${j.job_no} «${j.title}» вернули на доработку${note ? `: ${note}` : ''}.`;
    addNotification(j.tg_id, 'info', text, {}).catch(() => {});
    if (botEnabled && /^\d+$/.test(j.tg_id)) sendMessage(j.tg_id, escHtml(text)).catch(() => {});
    return { points: 0 };
  }
  // награда — только если сдано до срока (просрочка уже оштрафована); офис может указать баллы вручную
  const dl0 = jobDeadline(j);
  const lateSubmit = Boolean(dl0 && new Date(j.submitted_at || now()) > dl0);
  const pts = points != null ? r2(Math.max(0, Math.min(Number(String(points).replace(',', '.')) || 0, 100))) : (lateSubmit ? 0 : Number(j.points) || 0);
  let aid = null;
  if (pts > 0) {
    aid = uid();
    await db.query("INSERT INTO kpi_adjust (id, month, tg_id, rule, points, reason, status, created_at, decided_at, decided_by) VALUES ($1,$2,$3,'job',$4,$5,'applied',$6,$6,$7)",
      [aid, curMonth(), j.tg_id, pts, `Поручение № ${j.job_no}: ${j.title}`.slice(0, 300), now(), actor?.name || '']);
  }
  await db.query("UPDATE jobs SET status = 'accepted', awarded = $1, adjust_id = $2, admin_note = $3, decided_at = $4, decided_by = $5, updated_at = $4 WHERE id = $6",
    [pts, aid, note || '', now(), actor?.name || '', j.id]);
  await audit(actor, 'Поручение принято', `№ ${j.job_no} · ${j.title}`, `+${pts} б`);
  const text = `✅ Поручение № ${j.job_no} «${j.title}» принято${pts > 0 ? `: +${ptsRu(pts)} б в KPI` : ''}${note ? `. ${note}` : ''}. Спасибо!`;
  addNotification(j.tg_id, 'info', text, {}).catch(() => {});
  if (botEnabled && /^\d+$/.test(j.tg_id)) sendMessage(j.tg_id, escHtml(text)).catch(() => {});
  return { points: pts };
}

route('POST', '/api/admin/jobs/:id/decide', async ({ params, body, user }) => {
  const j = await getJob(params.id);
  const r = await decideJob(j, Boolean(body.accept), user, { points: body.points, note: str(body.note, 500) });
  return { ok: true, ...r };
}, { access: 'admin' });

/** Проверяющий специалист принимает или возвращает поручение (баллы — как назначил офис). */
route('POST', '/api/jobs/:id/review', async ({ params, body, user }) => {
  const j = await getJob(params.id);
  must(j.reviewer_id === user.id, 403, 'Это поручение принимает другой сотрудник');
  must(j.status === 'submitted', 400, 'Поручение ещё не сдано или уже проверено');
  const r = await decideJob(j, Boolean(body.accept), { id: user.id, name: `${user.name} (проверяющий)` }, { note: str(body.note, 500) });
  if (botEnabled) {
    const office = await officeChat();
    if (office) sendMessage(office.id, `🧑‍⚖️ ${escHtml(user.name)} ${body.accept ? `принял поручение № ${j.job_no} · +${ptsRu(r.points)} б для ${escHtml(j.tech_name || '')}` : `вернул поручение № ${j.job_no} на доработку`}`, { threadId: office.thread_id }).catch(() => {});
  }
  return { ok: true, ...r };
});

// принятое по ошибке — вернуть «на проверку» и снять баллы
route('POST', '/api/admin/jobs/:id/reopen', async ({ params, user }) => {
  const j = await getJob(params.id);
  must(['accepted', 'cancelled'].includes(j.status), 400, 'Поручение и так открыто');
  if (j.adjust_id) await db.query('DELETE FROM kpi_adjust WHERE id = $1', [j.adjust_id]);
  await db.query("UPDATE jobs SET status = $1, awarded = NULL, adjust_id = NULL, decided_at = NULL, updated_at = $2 WHERE id = $3", [j.submitted_at ? 'submitted' : 'in_progress', now(), j.id]);
  await audit(user, 'Поручение снова открыто', `№ ${j.job_no} · ${j.title}`, j.awarded ? `снято ${j.awarded} б` : '');
  return { ok: true };
}, { access: 'admin' });

// ---------- напоминания по поручениям (каждые 5 минут) ----------
// 1) исполнитель не нажал «Принял в работу»; 2) за 1 час до срока и позже — пока не сдаст;
// 3) сдано и назначен проверяющий — проверяющему, пока не примет или не вернёт.
const JOB_ALERT_MS = Number(process.env.JOB_ALERT_MINUTES || 5) * 60000;
const JOB_ALERT_MAX = 144; // не дольше ~12 часов подряд
async function jobResend(chatId, oldMsgId, html, replyMarkup, j) {
  if (oldMsgId) await deleteMessage(chatId, oldMsgId).catch(() => {});
  const m = await sendMessage(chatId, html, { replyMarkup }).catch((e) => {
    botSendFailed(chatId, e, { extra: j ? [j.author_id, j.reviewer_id, j.tg_id] : [], about: j ? `поручение № ${j.job_no}` : '' }).catch(() => {});
    return null;
  });
  return m?.message_id ? String(m.message_id) : null;
}
async function jobAlertTick() {
  if (!botEnabled) return;
  const nowMs = Date.now();
  const due = (at, fallback) => nowMs - new Date(at || fallback).getTime() >= JOB_ALERT_MS;
  const rows = await db.query("SELECT j.*, u.name AS tech_name, r.name AS reviewer_name FROM jobs j LEFT JOIN users u ON u.tg_id = j.tg_id LEFT JOIN users r ON r.tg_id = j.reviewer_id WHERE j.status IN ('new','in_progress','returned','submitted')");
  for (const j of rows) {
    // 1) подтверждение получения
    if (!j.ack_at && j.status === 'new' && /^\d+$/.test(j.tg_id) && Number(j.ack_alert_count) < JOB_ALERT_MAX && due(j.ack_alert_at, j.created_at)) {
      const n = Number(j.ack_alert_count || 0) + 1;
      const id = await jobResend(j.tg_id, j.ack_msg_id,
        `🔔 <b>Напоминание ${n}</b> · подтвердите получение поручения\n${jobSummary(j)}\n\nНажмите «Принял в работу», иначе напоминание придёт снова через ${Math.round(JOB_ALERT_MS / 60000)} мин.`, jobKb(j), j);
      await db.query('UPDATE jobs SET ack_alert_at = $1, ack_alert_count = $2, ack_msg_id = $3 WHERE id = $4', [now(), n, id, j.id]);
      continue;
    }
    // 2) за 1 час до срока — одно уведомление исполнителю и проверяющему
    const dl = jobDeadline(j);
    if (dl && ['new', 'in_progress', 'returned'].includes(j.status) && !Number(j.due_alert_count)
      && nowMs >= dl.getTime() - 3600000 && nowMs < dl.getTime()) {
      await db.query('UPDATE jobs SET due_alert_at = $1, due_alert_count = 1 WHERE id = $2', [now(), j.id]);
      const left = Math.max(1, Math.round((dl.getTime() - nowMs) / 60000));
      const pen = Number(j.penalty) > 0 ? `\nНе успеете — штраф −${ptsRu(j.penalty)} б.` : '';
      notifyTech(j.tg_id, `⏰ <b>До срока поручения ${left} мин</b>\n${jobSummary(j)}\n\nСдайте на проверку до ${escHtml(j.due_time || JOB_DEFAULT_TIME)} — получите +${ptsRu(j.points)} б.${pen}`, { kind: 'info' });
      if (j.reviewer_id) notifyTech(j.reviewer_id, `⏰ Через ${left} мин срок поручения № ${j.job_no} «${escHtml(j.title)}» (исполнитель — ${escHtml(j.tech_name || '')}). Вы принимаете работу.`, { kind: 'info' });
    }
    // срок прошёл, не сдано — штраф (один раз)
    if (dl && ['new', 'in_progress', 'returned'].includes(j.status) && !j.penalized_at && nowMs >= dl.getTime()) {
      let aid = null;
      if (Number(j.penalty) > 0) {
        aid = uid();
        await db.query("INSERT INTO kpi_adjust (id, month, tg_id, rule, points, reason, status, created_at, decided_at, decided_by, ref) VALUES ($1,$2,$3,'job_penalty',$4,$5,'applied',$6,$6,'авто',$7)",
          [aid, curMonth(), j.tg_id, -Number(j.penalty), `Поручение № ${j.job_no} не сдано в срок: ${j.title}`.slice(0, 300), now(), `job:${j.id}`]);
      }
      await db.query('UPDATE jobs SET penalized_at = $1, penalty_adjust_id = $2 WHERE id = $3', [now(), aid, j.id]);
      const pen = Number(j.penalty) > 0 ? ` Штраф: <b>−${ptsRu(j.penalty)} б</b> в KPI.` : '';
      notifyTech(j.tg_id, `🔴 <b>Срок поручения прошёл</b> — № ${j.job_no} «${escHtml(j.title)}» не сдано.${pen}\nВсё равно сдайте работу — офис решит по баллам.`, { kind: 'info' });
      if (j.reviewer_id) notifyTech(j.reviewer_id, `🔴 Поручение № ${j.job_no} «${escHtml(j.title)}» не сдано в срок (${escHtml(j.tech_name || '')}).${pen}`, { kind: 'info' });
      notifyAdmins(`🔴 Поручение № ${j.job_no} «${escHtml(j.title)}» не сдано в срок — ${escHtml(j.tech_name || '')}.${pen}`);
      continue;
    }
    // 3) проверяющий не принял сданное
    if (j.status === 'submitted' && j.reviewer_id && /^\d+$/.test(j.reviewer_id) && Number(j.rev_alert_count) < JOB_ALERT_MAX && due(j.rev_alert_at, j.submitted_at)) {
      const n = Number(j.rev_alert_count || 0) + 1;
      const id = await jobResend(j.reviewer_id, j.rev_msg_id,
        `🔔 <b>Напоминание ${n}</b> · проверьте поручение № ${j.job_no}\n<b>${escHtml(j.title)}</b> · исполнитель: ${escHtml(j.tech_name || '')}${j.report ? `\n💬 ${escHtml(j.report)}` : ''}\n\nПримите или верните на доработку — напоминание повторяется каждые ${Math.round(JOB_ALERT_MS / 60000)} мин.`,
        jobDecideKb(j), j);
      await db.query('UPDATE jobs SET rev_alert_at = $1, rev_alert_count = $2, rev_msg_id = $3 WHERE id = $4', [now(), n, id, j.id]);
    }
  }
}
setInterval(() => { jobAlertTick().catch((e) => console.error('job alert tick:', e.message)); }, 60000).unref?.();

/** Забрать заявку «кто заберёт». */
async function claimTask(taskId, tgId) {
  const [u] = await db.query("SELECT tg_id, name, role FROM users WHERE tg_id = $1 AND status = 'active'", [String(tgId)]);
  if (!u || ['admin', 'manager'].includes(u.role)) return { error: 'Заявки забирают дезинсекторы и специалисты' };
  const [t0] = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  if (!t0) return { error: 'Заявка не найдена' };
  if (t0.status !== 'open') return { error: t0.tech_tg_id === u.tg_id ? 'Вы уже забрали эту заявку' : 'Уже забрали' };
  if (!audienceOk(t0.audience, u.role)) return { error: 'Эта заявка для другой категории сотрудников' };
  await db.query("UPDATE tasks SET tech_tg_id = $1, status = 'new', claimed_at = $2, ack_at = $2, updated_at = $2 WHERE id = $3 AND status = 'open'", [u.tg_id, now(), taskId]);
  const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  if (t.tech_tg_id !== u.tg_id) return { error: 'Уже забрали' };
  await audit({ id: u.tg_id, name: u.name }, 'Забрал заявку', `№ ${t.task_no} · ${t.company_name || t.address}`);
  await closeBroadcast(t, `🙋 Заявку № ${t.task_no} (${escHtml(t.address || '')}) забрал(а) <b>${escHtml(u.name)}</b>`);
  notifyTech(u.tg_id, `✅ Заявка ваша!\n${taskSummary(t)}${Number(t.claim_bonus) > 0 ? `\n\n🎁 Бонус за то, что забрали: +${ptsRu(t.claim_bonus)} б (после выполнения)` : ''}`, { kind: 'task_new', task_id: t.id });
  await notifyOffice(t, `🙋 <b>${escHtml(u.name)}</b> забрал(а) заявку № ${t.task_no}`).catch(() => {});
  await boostCongrats(t);
  return { ok: true, name: u.name };
}
route('POST', '/api/tasks/:id/claim', async ({ params, user }) => {
  const r = await claimTask(params.id, user.id);
  must(!r.error, 409, r.error);
  return r;
});

// ---------- обработка из админ-панели (без сообщения в чате) ----------
route('POST', '/api/admin/tasks', async ({ body, user }) => {
  const tech = str(body.tech, 40);
  const audience = ['all', 'tech', 'specialist'].includes(body.audience) ? body.audience : '';
  const [u] = audience ? [{ tg_id: '', name: '', role: 'tech' }] : await db.query("SELECT tg_id, name, role FROM users WHERE tg_id = $1 AND status = 'active'", [tech]);
  must(u && !['admin', 'manager'].includes(u.role), 400, 'Выберите дезинсектора или специалиста');
  const address = str(body.address, 300);
  must(address.length >= 3, 400, 'Укажите адрес');
  let planned = null; let hasTime = false;
  if (body.date) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(body.date, 10));
    must(d, 400, 'Некорректная дата');
    const t = /^(\d{1,2}):(\d{2})$/.exec(str(body.time, 5));
    hasTime = Boolean(t);
    planned = zonedIso(+d[1], +d[2], +d[3], t ? +t[1] : 9, t ? +t[2] : 0);
  }
  const pests = Array.isArray(body.pests) ? body.pests.map((p) => str(p, 60)).filter(Boolean).slice(0, 20) : [];
  const price = body.price === '' || body.price == null ? null : Number(String(body.price).replace(',', '.'));
  must(price == null || (Number.isFinite(price) && price >= 0), 400, 'Некорректная цена');
  const rooms = body.rooms === '' || body.rooms == null ? null : Math.round(Number(body.rooms));
  const sotki = body.sotki === '' || body.sotki == null ? null : Number(String(body.sotki).replace(',', '.'));
  must(sotki == null || (Number.isFinite(sotki) && sotki > 0 && sotki <= 10000), 400, 'Некорректное количество соток');
  const mult = body.mult === '' || body.mult == null ? null : Number(String(body.mult).replace(',', '.'));
  must(mult == null || (Number.isFinite(mult) && mult > 0 && mult <= 10), 400, 'Коэффициент — от 0,1 до 10');
  const pcfg = await pointsConfig();
  const pointCat = str(body.point_cat, 30);
  const pc = pcfg.cats.find((c) => c.id === pointCat);
  must(!pointCat || pc, 400, 'Неизвестный тип помещения');
  const pointZone = pc?.zones ? (POINT_ZONES.some((z) => z.id === body.point_zone) ? body.point_zone : 'city') : '';
  let team = [];
  if (Array.isArray(body.team) && body.team.length) {
    must((await features()).team, 400, 'Командные заявки выключены в настройках');
    team = [...new Set(body.team.map((x) => str(x, 40)))].filter((x) => x && x !== u.tg_id).slice(0, 10);
    for (const id of team) {
      const [m] = await db.query("SELECT role FROM users WHERE tg_id = $1 AND status = 'active'", [id]);
      must(m && !['admin', 'manager'].includes(m.role), 400, 'В команду добавляются только дезинсекторы и специалисты');
    }
  }
  const parsed = {
    team,
    point_cat: pointCat, point_zone: pointZone, sotki,
    mult: mult && mult !== 1 ? mult : null,
    company: str(body.company, 200), address, planned_at: planned, has_time: hasTime, procedure: str(body.procedure, 120), pests,
    phone: str(body.phone, 40), comment: str(body.comment, 1000), area: '', rooms: Number.isFinite(rooms) && rooms > 0 ? rooms : null, stage: str(body.stage, 10), price,
  };
  // сообщение о заявке — в тему этого сотрудника, если она привязана, иначе в чат офиса
  let chatId = null; let threadId = null;
  const binding = Object.entries(await topicBindings()).find(([, v]) => String(v) === u.tg_id);
  if (binding) { const [c, th] = binding[0].split(':'); chatId = c; threadId = th && th !== '0' ? th : null; }
  else { const office = await officeChat(); if (office) { chatId = String(office.id); threadId = office.thread_id || null; } }
  if (audience) {
    const bonus = Math.max(0, Math.min(Number(String(body.claim_bonus ?? 0).replace(',', '.')) || 0, 100));
    const office = await officeChat();
    const t = await createOpenTask({ parsed, audience, bonus, author: user.name, authorId: user.id, chatId: office ? String(office.id) : null, threadId: office?.thread_id || null });
    return { ok: true, id: t.id, task_no: t.task_no, open: true };
  }
  const t = await createTask({ parsed, tech: u.tg_id, chatId, threadId, messageId: null, author: user.name, authorId: user.id });
  must(t, 400, 'Не удалось создать заявку');
  return { ok: true, id: t.id, task_no: t.task_no };
}, { access: 'admin' });

// ---------- заявки ----------

const fmtTaskDate = (iso, hasTime) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: process.env.TZ_DISPLAY || 'Europe/Chisinau', day: 'numeric', month: 'long', ...(Number(hasTime) ? { hour: '2-digit', minute: '2-digit' } : {}) }) : '';
const taskPests = (t) => { try { return JSON.parse(t.pests || '[]'); } catch { return []; } };

function taskSummary(t, techName) {
  const pests = taskPests(t);
  return [
    `📋 <b>Заявка № ${t.task_no}</b>${techName ? ` → ${escHtml(techName)}` : ''}`,
    t.company_name ? `🏢 ${escHtml(t.company_name)}` : '👤 Физлицо',
    t.address && `📍 ${escHtml(t.address)}`,
    t.planned_at ? `🗓 ${escHtml(fmtTaskDate(t.planned_at, t.has_time))}` : '🗓 <i>дата не указана</i>',
    (t.procedure || pests.length) && `🐞 ${escHtml([t.procedure, pests.join(', ')].filter(Boolean).join(' · '))}`,
    t.phone && `📞 ${escHtml(intlPhone(t.phone))}`,
    (t.stage || t.rooms || t.price) && `🧾 ${[t.stage && `этап ${t.stage.replace('/', ' из ')}`, t.rooms && `${t.rooms} комн.`, t.price != null && `${t.price} лей`].filter(Boolean).join(' · ')}`,
    t.comment && `💬 ${escHtml(t.comment)}`,
    t.point_cat && `🏠 ${escHtml(pointCatLabel(t))}`,
    Number(t.mult) > 1 && `⚡ Повышенный коэффициент <b>${multRu(Number(t.mult))}</b> к баллам`,
  ].filter(Boolean).join('\n');
}

/** Заявка «кто заберёт»: без исполнителя, рассылка категории с кнопкой «🙋 Забрать». */
async function createOpenTask({ parsed, audience, bonus, author, authorId, chatId, threadId }) {
  const [r] = await db.query('SELECT MAX(task_no) AS m FROM tasks');
  const t = {
    id: uid(), task_no: (Number(r?.m) || 0) + 1, tech_tg_id: '', company_name: parsed.company, address: parsed.address,
    planned_at: parsed.planned_at, has_time: parsed.has_time ? 1 : 0, procedure: parsed.procedure, pests: JSON.stringify(parsed.pests),
    phone: parsed.phone, comment: parsed.comment, area: '', status: 'open', chat_id: chatId, thread_id: threadId ? String(threadId) : null,
    author, created_at: now(), updated_at: now(), rooms: parsed.rooms || null, stage: parsed.stage || '', price: parsed.price ?? null,
    mult: parsed.mult || null, point_cat: parsed.point_cat || '', point_zone: parsed.point_zone || '', sotki: parsed.sotki ?? null,
  };
  await db.query(`INSERT INTO tasks (id, task_no, tech_tg_id, company_name, address, planned_at, has_time, procedure, pests, phone, comment, area, status, chat_id, thread_id, message_id, author, created_at, updated_at, rooms, stage, price, mult, point_cat, point_zone, team, sotki, audience, claim_bonus)
    VALUES ($1,$2,'',$3,$4,$5,$6,$7,$8,$9,$10,'','open',$11,$12,NULL,$13,$14,$14,$15,$16,$17,$18,$19,$20,'[]',$21,$22,$23)`,
  [t.id, t.task_no, t.company_name, t.address, t.planned_at, t.has_time, t.procedure, t.pests, t.phone, t.comment, t.chat_id, t.thread_id, t.author, t.created_at,
    t.rooms, t.stage, t.price, t.mult, t.point_cat, t.point_zone, t.sotki, audience, bonus]);
  if (authorId) { await db.query('UPDATE tasks SET author_id = $1 WHERE id = $2', [String(authorId), t.id]); sales.onTaskSaved(t.id).catch(() => {}); }
  await audit({ id: 'bot', name: author || 'Офис' }, 'Заявка «кто заберёт»', `№ ${t.task_no} · ${t.company_name || t.address}`, `${AUDIENCE_LABEL[audience]}${bonus ? ` · бонус +${bonus}` : ''}`);
  await pointsConfig();
  const users = await audienceUsers(audience);
  const b = taskMult(t);
  const html = `🙋 <b>Кто заберёт заявку?</b> Для: ${escHtml(AUDIENCE_LABEL[audience])}\n${taskSummary(t)}${bonus ? `\n🎁 Бонус тому, кто заберёт: <b>+${ptsRu(bonus)} б</b>` : ''}${b.mult_eff > 1 ? `\n⚡ Повышенный коэффициент ${multRu(b.mult_eff)}` : ''}\n\nПервый, кто нажмёт «Забрать», получает заявку.`;
  await broadcastClaim('tasks', t.id, users, html, 'tclaim');
  if (chatId) sendMessage(chatId, `${taskSummary(t)}\n\n🙋 Разослано: ${escHtml(AUDIENCE_LABEL[audience])} — ждём, кто заберёт.`, { threadId }).catch(() => {});
  return t;
}

async function createTask({ parsed, tech, chatId, threadId, messageId, author, authorId }) {
  const [u] = await db.query('SELECT tg_id, name FROM users WHERE tg_id = $1', [tech]);
  if (!u) return null;
  const [r] = await db.query('SELECT MAX(task_no) AS m FROM tasks');
  const t = {
    id: uid(), task_no: (Number(r?.m) || 0) + 1, tech_tg_id: tech, company_name: parsed.company, address: parsed.address,
    planned_at: parsed.planned_at, has_time: parsed.has_time ? 1 : 0, procedure: parsed.procedure, pests: JSON.stringify(parsed.pests),
    phone: parsed.phone, comment: parsed.comment, area: parsed.area || '', status: 'new', chat_id: chatId,
    // заявку от не-админа сначала подтверждает администратор (настройка «Подтверждение заявок»)
    ...((await taskApprovalOn()) && !(await isAdminTg(authorId)) ? { status: 'pending' } : {}),
    thread_id: threadId ? String(threadId) : null, message_id: messageId, author, created_at: now(), updated_at: now(),
  };
  t.rooms = parsed.rooms || null; t.stage = parsed.stage || ''; t.price = parsed.price ?? null; t.mult = parsed.mult && parsed.mult !== 1 ? parsed.mult : null; t.point_cat = parsed.point_cat || ''; t.point_zone = parsed.point_zone || ''; t.sotki = parsed.sotki ?? null; t.team = JSON.stringify((parsed.team || []).filter((x) => x !== tech));
  await db.query(
    `INSERT INTO tasks (id, task_no, tech_tg_id, company_name, address, planned_at, has_time, procedure, pests, phone, comment, area, status, chat_id, thread_id, message_id, author, created_at, updated_at, rooms, stage, price, mult, point_cat, point_zone, team, sotki)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
    [t.id, t.task_no, t.tech_tg_id, t.company_name, t.address, t.planned_at, t.has_time, t.procedure, t.pests, t.phone, t.comment, t.area,
      t.status, t.chat_id, t.thread_id, t.message_id, t.author, t.created_at, t.updated_at, t.rooms, t.stage, t.price, t.mult, t.point_cat, t.point_zone, t.team, t.sotki],
  );
  if (authorId) { t.author_id = String(authorId); await db.query('UPDATE tasks SET author_id = $1 WHERE id = $2', [t.author_id, t.id]); sales.onTaskSaved(t.id).catch(() => {}); }
  await audit({ id: 'bot', name: author || 'Офис' }, 'Новая заявка', `№ ${t.task_no} · ${t.company_name || t.address}`, `для: ${u.name}`);
  if (t.status === 'pending') {
    try {
      const sent = await sendMessage(chatId, `${taskSummary(t, u.name)}\n\n⏳ Ждёт подтверждения администратора — после него уйдёт технику.`,
        { threadId, replyTo: messageId, replyMarkup: { inline_keyboard: [[{ text: '✅ Подтвердить', callback_data: `tok:${t.id}` }, { text: '❌ Отменить', callback_data: `cancel:${t.id}` }]] } });
      if (sent?.message_id) await db.query('UPDATE tasks SET confirm_id = $1 WHERE id = $2', [String(sent.message_id), t.id]);
    } catch (e) { console.error('task confirm:', e.message); }
    const kb = { inline_keyboard: [[{ text: '✅ Подтвердить', callback_data: `tok:${t.id}` }, { text: '❌ Отменить', callback_data: `cancel:${t.id}` }]] };
    if (botEnabled) for (const aid of await adminIds(db)) sendMessage(aid, `🟠 <b>Новая заявка ждёт подтверждения</b>\n${taskSummary(t, u.name)}\nНаписал: ${escHtml(author || '—')}`, { replyMarkup: kb }).catch(() => {});
    return { ...t, tech_name: u.name };
  }
  try {
    if (!chatId) throw new Error('нет чата для копии заявки');
    const sent = await sendMessage(chatId, `${taskSummary(t, u.name)}\n\n${messageId ? '✅ Отправлено технику. Если что-то не так — исправьте своё сообщение.' : `✅ Создана в админ-панели (${escHtml(author || '')}) · отправлено сотруднику.`}`,
      { threadId, replyTo: messageId, replyMarkup: { inline_keyboard: [[{ text: '❌ Отменить заявку', callback_data: `cancel:${t.id}` }]] } });
    if (sent?.message_id) await db.query('UPDATE tasks SET confirm_id = $1 WHERE id = $2', [String(sent.message_id), t.id]);
  } catch (e) { console.error('task confirm:', e.message); }
  addNotification(u.tg_id, 'task_new', `Заявка № ${t.task_no} · ${t.company_name || 'Физлицо'} · ${t.address}`, { task_id: t.id }).catch(() => {});
  await sendTaskAlert(t);
  await boostCongrats(t);
  await notifyTeam(t, u.name);
  return { ...t, tech_name: u.name };
}

/** Уведомление технику: запись в панель уведомлений + сообщение в личку от бота. */
// ---------- Уведомление о новой заявке: повтор каждые 5 минут, пока техник не нажмёт «Уведомлен» ----------
const ALERT_EVERY_MS = Number(process.env.TASK_ALERT_MINUTES || 5) * 60000;
const ALERT_MAX = Number(process.env.TASK_ALERT_MAX || 144); // не дольше ~12 часов

/**
 * Поздравление сотруднику: у него заявка с повышенным коэффициентом (воскресенье, особый период или назначен офисом).
 * Отправляется один раз на заявку и сотрудника (boost_sent = tg_id) — без повторов; при переназначении — новому.
 */
/** Сообщение участникам командной заявки: кто ответственный (ведёт акт и получает оплату), как делятся баллы. */
async function notifyTeam(t, leadName, ids = null) {
  const team = ids || taskTeam(t);
  if (!team.length) return;
  const n = team.length + 1;
  const share = t.price != null ? Math.round((Number(t.price) || 0) / n) : null;
  for (const id of team) {
    notifyTech(id, `👥 <b>Вы в команде</b> по заявке № ${t.task_no}\n${escHtml(t.company_name || 'Физлицо')} · ${escHtml(t.address || '')}${t.planned_at ? `\n🗓 ${escHtml(fmtTaskDate(t.planned_at, t.has_time))}` : ''}\n\nОтветственный: <b>${escHtml(leadName || '')}</b> — ведёт акт и получает оплату.\nБаллы за объект — каждому полностью.${share != null ? `\nСтоимость заказа делится на ${n}: по ${share} лей.` : ''}`,
      { kind: 'task_new', task_id: t.id });
  }
}

async function boostCongrats(t) {
  if (!t || !['new', 'in_progress'].includes(t.status) || t.visit_id) return;
  if (String(t.boost_sent || '') === String(t.tech_tg_id)) return;
  await pointsConfig();
  const b = taskMult(t);
  if (!(b.mult_eff > 1)) return;
  await db.query('UPDATE tasks SET boost_sent = $1 WHERE id = $2', [String(t.tech_tg_id), t.id]);
  const why = b.mult_why === 'назначен офисом' ? '' : ` (${b.mult_why})`;
  notifyTech(t.tech_tg_id,
    `🎉 <b>Поздравляем!</b> У вас заявка с повышенным коэффициентом <b>${multRu(b.mult_eff)}</b>${escHtml(why)} — баллы за неё умножатся.\n\n📋 Заявка № ${t.task_no} · ${escHtml(t.company_name || 'Физлицо')}\n📍 ${escHtml(t.address || '')}${t.planned_at ? `\n🗓 ${escHtml(fmtTaskDate(t.planned_at, t.has_time))}` : ''}`,
    { kind: 'info', task_id: t.id });
}

async function sendTaskAlert(t) {
  if (!botEnabled || !/^\d+$/.test(String(t.tech_tg_id))) return;
  const n = Number(t.alert_count || 0);
  const base = publicBase();
  const kb = [[{ text: '✅ Уведомлен', callback_data: `ack:${t.id}` }]];
  if (base) kb.push([{ text: 'Открыть заявки', web_app: { url: base } }]);
  // старое напоминание удаляем — новое снова «всплывает» со звуком
  if (t.alert_msg_id) await deleteMessage(t.tech_tg_id, t.alert_msg_id).catch(() => {});
  try {
    const sent = await sendMessage(t.tech_tg_id,
      `${n ? `🔔 <b>Напоминание ${n + 1}</b> · подтвердите получение\n` : '🆕 '}${taskSummary(t)}\n\nНажмите «Уведомлен», иначе напоминание придёт снова через ${Math.round(ALERT_EVERY_MS / 60000)} мин.`,
      { replyMarkup: { inline_keyboard: kb } });
    await db.query('UPDATE tasks SET alert_msg_id = $1, alert_at = $2, alert_count = $3, sent_at = COALESCE(sent_at, $2) WHERE id = $4', [String(sent?.message_id || ''), now(), n + 1, t.id]);
  } catch (e) {
    console.error('task alert:', e.message);
    botSendFailed(t.tech_tg_id, e, { about: `заявка № ${t.task_no}` }).catch(() => {});
    await db.query('UPDATE tasks SET alert_at = $1, alert_count = $2 WHERE id = $3', [now(), n + 1, t.id]);
  }
}

async function ackTask(t, who) {
  if (t.ack_at) return false;
  const at = now();
  await db.query('UPDATE tasks SET ack_at = $1 WHERE id = $2', [at, t.id]);
  if (t.alert_msg_id && botEnabled) {
    editMessage(t.tech_tg_id, t.alert_msg_id, `${taskSummary(t)}\n\n✅ Вы подтвердили получение · ${escHtml(fmtRu(at))}`,
      publicBase() ? { inline_keyboard: [[{ text: 'Открыть заявки', web_app: { url: publicBase() } }]] } : undefined).catch(() => {});
  }
  const [u] = await db.query('SELECT name FROM users WHERE tg_id = $1', [t.tech_tg_id]);
  if (t.confirm_id) {
    editMessage(t.chat_id, t.confirm_id, `${taskSummary(t, u?.name)}\n\n✅ Отправлено технику · 👀 ${escHtml(who || u?.name || '')} получил ${escHtml(new Date(at).toLocaleTimeString('ru-RU', { timeZone: TZN, hour: '2-digit', minute: '2-digit' }))}`,
      { inline_keyboard: [[{ text: '❌ Отменить заявку', callback_data: `cancel:${t.id}` }]] }).catch(() => {});
  }
  return true;
}

async function taskAlertTick() {
  if (!botEnabled) return;
  const due = new Date(Date.now() - ALERT_EVERY_MS + 15000).toISOString();
  const rows = await db.query(
    `SELECT * FROM tasks WHERE status = 'new' AND ack_at IS NULL AND visit_id IS NULL AND alert_count > 0 AND alert_count < $1
       AND (alert_at IS NULL OR alert_at <= $2) ORDER BY created_at LIMIT 50`, [ALERT_MAX, due],
  );
  for (const t of rows) await sendTaskAlert(t);
}
setInterval(() => { taskAlertTick().catch((e) => console.error('alert tick:', e.message)); }, 60000).unref?.();

// ---------- «Скоро заявка»: за 30 мин до времени — напоминание каждые 2 мин, пока специалист не нажмёт «Увидел» ----------
const SOON_MIN = Number(process.env.SOON_MINUTES || 30);
const SOON_EVERY_MS = Number(process.env.SOON_EVERY_MINUTES || 2) * 60000;
const SOON_MAX = Number(process.env.SOON_MAX || 30); // не больше 30 повторов (~1 час)

async function sendSoonAlert(t) {
  if (!botEnabled || !/^\d+$/.test(String(t.tech_tg_id))) return;
  const fresh = t.soon_for !== t.planned_at; // время заявки поменялось — считаем заново
  const n = fresh ? 0 : Number(t.soon_count || 0);
  const mins = Math.round((new Date(t.planned_at).getTime() - Date.now()) / 60000);
  const when = mins > 0 ? `через ${mins} мин` : mins === 0 ? 'сейчас' : `${-mins} мин назад`;
  const base = publicBase();
  const kb = [[{ text: '👀 Увидел', callback_data: `soon:${t.id}` }]];
  if (base) kb.push([{ text: 'Открыть заявку', web_app: { url: base } }]);
  if (t.soon_msg_id) await deleteMessage(t.tech_tg_id, t.soon_msg_id).catch(() => {});
  let msgId = '';
  try {
    const sent = await sendMessage(t.tech_tg_id,
      `⏰ <b>Заявка ${when}</b>${n ? ` · напоминание ${n + 1}` : ''}\n${taskSummary(t)}\n\nНажмите «Увидел», иначе напомню снова через ${Math.round(SOON_EVERY_MS / 60000)} мин.`,
      { replyMarkup: { inline_keyboard: kb } });
    msgId = String(sent?.message_id || '');
  } catch (e) { console.error('soon alert:', e.message); }
  await db.query('UPDATE tasks SET soon_at = $1, soon_count = $2, soon_msg_id = $3, soon_for = $4, soon_ack_at = NULL WHERE id = $5',
    [now(), n + 1, msgId, t.planned_at, t.id]);
}

async function soonTick() {
  if (!botEnabled) return;
  const nowMs = Date.now();
  const until = new Date(nowMs + SOON_MIN * 60000).toISOString();
  const since = new Date(nowMs - 30 * 60000).toISOString(); // после времени заявки ещё полчаса, если так и не подтвердил
  const rows = await db.query(
    `SELECT * FROM tasks WHERE status IN ('new', 'in_progress') AND visit_id IS NULL AND en_route_at IS NULL AND has_time = 1
       AND planned_at IS NOT NULL AND planned_at <= $1 AND planned_at >= $2 ORDER BY planned_at LIMIT 50`, [until, since],
  );
  for (const t of rows) {
    const fresh = t.soon_for !== t.planned_at;
    if (!fresh) {
      if (t.soon_ack_at || Number(t.soon_count) >= SOON_MAX) continue;
      if (t.soon_at && nowMs - new Date(t.soon_at).getTime() < SOON_EVERY_MS - 15000) continue;
    }
    await sendSoonAlert(t);
  }
}
setInterval(() => { soonTick().catch((e) => console.error('soon tick:', e.message)); }, 60000).unref?.();

async function soonSeen(t, who) {
  if (t.soon_ack_at && t.soon_for === t.planned_at) return false;
  const at = now();
  await db.query('UPDATE tasks SET soon_ack_at = $1, soon_for = $2 WHERE id = $3', [at, t.planned_at, t.id]);
  if (!t.ack_at) await ackTask(t, who);
  if (t.soon_msg_id && botEnabled) {
    editMessage(t.tech_tg_id, t.soon_msg_id, `${taskSummary(t)}\n\n👀 Вы подтвердили напоминание · ${escHtml(new Date(at).toLocaleTimeString('ru-RU', { timeZone: TZN, hour: '2-digit', minute: '2-digit' }))}`,
      publicBase() ? { inline_keyboard: [[{ text: 'Открыть заявку', web_app: { url: publicBase() } }]] } : undefined).catch(() => {});
  }
  return true;
}

function notifyTech(tgId, html, meta = {}) {
  addNotification(tgId, meta.kind || 'info', html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"'), meta)
    .catch((e) => console.error('notification:', e.message));
  if (!botEnabled || !/^\d+$/.test(String(tgId))) return;
  const base = publicBase();
  sendMessage(tgId, html, base ? { replyMarkup: { inline_keyboard: [[{ text: 'Открыть заявки', web_app: { url: base } }]] } } : {})
    .catch((e) => { console.error('notify tech:', e.message); botSendFailed(tgId, e, { extra: meta.responsible || [], about: meta.about || '' }).catch(() => {}); });
}

async function handleTaskEdit(m) {
  const [t] = await db.query('SELECT * FROM tasks WHERE chat_id = $1 AND message_id = $2', [String(m.chat.id), String(m.message_id)]);
  const parsed = parseTask(String(m.text || m.caption || ''));
  if (!t) {
    // сообщение не распознали как заявку, а после правки оно стало заявкой → создаём
    const threadId = m.is_topic_message ? m.message_thread_id : undefined;
    const tech = (await topicBindings())[topicKey(m.chat.id, threadId)];
    if (!parsed || !tech || m.from?.is_bot || m.chat.type === 'private' || (await isAdminTg(tech))) return;
    const created = await createTask({ parsed, tech, chatId: String(m.chat.id), threadId, messageId: String(m.message_id), author: [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' '), authorId: m.from?.id });
    logTg({ chat: chatTitle(m.chat), chat_id: String(m.chat.id), thread: threadId || null, from: m.from?.first_name || '', text: m.text || '', result: created ? `заявка № ${created.task_no} (после правки)` : 'сотрудник темы не найден' });
    return;
  }
  if (!['new', 'pending'].includes(t.status) || !parsed) return;
  await db.query(
    'UPDATE tasks SET company_name = $1, address = $2, planned_at = $3, has_time = $4, procedure = $5, pests = $6, phone = $7, comment = $8, updated_at = $9, reschedule_req = 0, rooms = $11, stage = $12, price = $13, mult = COALESCE($14, mult) WHERE id = $10',
    [parsed.company, parsed.address, parsed.planned_at, parsed.has_time ? 1 : 0, parsed.procedure, JSON.stringify(parsed.pests), parsed.phone, parsed.comment, now(), t.id,
      parsed.rooms || null, parsed.stage || '', parsed.price ?? null, parsed.mult || null],
  );
  sales.onTaskSaved(t.id).catch(() => {});
  const [nt] = await db.query('SELECT * FROM tasks WHERE id = $1', [t.id]);
  const [u] = await db.query('SELECT name FROM users WHERE tg_id = $1', [t.tech_tg_id]);
  if (t.confirm_id) {
    editMessage(t.chat_id, t.confirm_id, `${taskSummary(nt, u?.name)}\n\n✏️ Заявка обновлена.`,
      { inline_keyboard: [[{ text: '❌ Отменить заявку', callback_data: `cancel:${t.id}` }]] }).catch(() => {});
  }
  notifyTech(t.tech_tg_id, `✏️ Заявка изменена\n${taskSummary(nt)}`, { kind: 'task_update', task_id: t.id });
  if (nt.status === 'new') await boostCongrats(nt);
}

async function cancelTask(t, who) {
  if (!['new', 'in_progress', 'pending'].includes(t.status) || t.visit_id) {
    await sendMessage(t.chat_id, `ℹ️ Заявку № ${t.task_no} уже нельзя отменить — выезд начат или завершён.`, { threadId: t.thread_id, replyTo: t.message_id }).catch(() => {});
    return false;
  }
  await db.query("UPDATE tasks SET status = 'cancelled', cancel_reason = 'office', reschedule_req = 0, updated_at = $1 WHERE id = $2", [now(), t.id]);
  await audit({ id: 'bot', name: who }, 'Заявка отменена', `№ ${t.task_no} · ${t.company_name || t.address}`);
  if (t.confirm_id) editMessage(t.chat_id, t.confirm_id, `${taskSummary(t)}\n\n❌ Отменена (${escHtml(who)}).`, restoreKb(t)).catch(() => {});
  notifyTech(t.tech_tg_id, `❌ Заявка № ${t.task_no} отменена\n${escHtml(t.company_name || '')} ${escHtml(t.address || '')}`, { kind: 'task_cancel', task_id: t.id });
  return true;
}

/** Сообщение офису по заявке: ответом на исходное сообщение в теме + в чат офиса, если это другой чат/тема. */
async function notifyOffice(t, html, replyMarkup) {
  if (!botEnabled) return;
  const sent = [];
  if (t.chat_id) {
    sent.push(`${t.chat_id}:${t.thread_id || ''}`);
    await sendMessage(t.chat_id, html, { threadId: t.thread_id, replyTo: t.message_id, replyMarkup }).catch((e) => console.error('office notify:', e.message));
  }
  const office = await officeChat();
  if (office && !sent.includes(`${office.id}:${office.thread_id || ''}`)) {
    await sendMessage(office.id, html, { threadId: office.thread_id, replyMarkup }).catch((e) => console.error('office notify:', e.message));
  }
}

async function taskEvent(t, kind, note = '') {
  await db.query('INSERT INTO task_events (id, task_id, tech_tg_id, kind, note, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [uid(), t.id, t.tech_tg_id, kind, String(note).slice(0, 500), now()]);
}

/** Открытый пустой выезд по заявке можно убрать (клиент отказал на месте); с осмотрами/фото — нельзя. */
async function dropOpenVisit(t) {
  if (!t.visit_id) return;
  const [v] = await db.query('SELECT id, status FROM visits WHERE id = $1', [t.visit_id]);
  if (!v) return;
  must(v.status === 'open', 400, 'Акт по заявке уже завершён');
  const [o] = await db.query('SELECT (SELECT COUNT(*) FROM observations WHERE visit_id = $1) + (SELECT COUNT(*) FROM inspections WHERE visit_id = $1) AS n', [v.id]);
  must(Number(o.n) === 0, 400, 'В выезде уже есть осмотры или фото — удалите выезд или завершите его');
  await db.query('DELETE FROM visits WHERE id = $1', [v.id]);
  await db.query('UPDATE tasks SET visit_id = NULL WHERE id = $1', [t.id]);
}

async function confirmReschedule(t, who) {
  await db.query("UPDATE tasks SET planned_at = $1, has_time = $2, reschedule_req = 0, status = $3, updated_at = $4, call_status = '', en_route_at = NULL, call_undo = 0, route_undo = 0, start_undo = 0 WHERE id = $5",
    [t.reschedule_to, Number(t.reschedule_has_time) ? 1 : 0, 'new', now(), t.id]);
  const [nt] = await db.query('SELECT * FROM tasks WHERE id = $1', [t.id]);
  const [u] = await db.query('SELECT name FROM users WHERE tg_id = $1', [t.tech_tg_id]);
  await audit({ id: 'bot', name: who }, 'Заявка перенесена', `№ ${t.task_no} → ${fmtTaskDate(t.reschedule_to, t.reschedule_has_time)}`);
  if (t.confirm_id) {
    editMessage(t.chat_id, t.confirm_id, `${taskSummary(nt, u?.name)}\n\n🔁 Перенесена по просьбе клиента.`,
      { inline_keyboard: [[{ text: '❌ Отменить заявку', callback_data: `cancel:${t.id}` }]] }).catch(() => {});
  }
  notifyTech(t.tech_tg_id, `📅 Заявка № ${t.task_no} перенесена на <b>${escHtml(fmtTaskDate(t.reschedule_to, t.reschedule_has_time))}</b>\n${escHtml(t.company_name || '')} ${escHtml(t.address || '')}`,
    { kind: 'task_update', task_id: t.id });
  await boostCongrats(nt);
}

/** Восстановить отменённую заявку: снова «новая», технику и офису — уведомление. */
async function restoreTask(t, who) {
  if (t.status !== 'cancelled') return false;
  await db.query("UPDATE tasks SET status = 'new', cancel_reason = '', cancel_note = '', reschedule_req = 0, visit_id = NULL, updated_at = $1, ack_at = NULL, alert_count = 0, call_status = '', en_route_at = NULL, call_undo = 0, route_undo = 0, start_undo = 0 WHERE id = $2", [now(), t.id]);
  await taskEvent(t, 'restore', who);
  await audit({ id: 'bot', name: who }, 'Заявка восстановлена', `№ ${t.task_no} · ${t.company_name || t.address}`);
  const [nt] = await db.query('SELECT * FROM tasks WHERE id = $1', [t.id]);
  const [u] = await db.query('SELECT name FROM users WHERE tg_id = $1', [t.tech_tg_id]);
  if (t.confirm_id) {
    editMessage(t.chat_id, t.confirm_id, `${taskSummary(nt, u?.name)}\n\n♻️ Восстановлена (${escHtml(who)}).`,
      { inline_keyboard: [[{ text: '❌ Отменить заявку', callback_data: `cancel:${t.id}` }]] }).catch(() => {});
  }
  addNotification(t.tech_tg_id, 'task_new', `Заявка № ${t.task_no} восстановлена`, { task_id: t.id }).catch(() => {});
  await sendTaskAlert(nt);
  await boostCongrats(nt);
  return true;
}
const restoreKb = (t) => ({ inline_keyboard: [[{ text: '♻️ Восстановить заявку', callback_data: `restore:${t.id}` }]] });

const CANCEL_REASONS = ['Передумал', 'Обратился в другую компанию', 'Дорого', 'Не открыл / не отвечает', 'Проблема решена', 'Другое'];

async function handleCallback(q) {
  const data = String(q.data || '');
  const chatId = q.message?.chat?.id;
  const threadId = q.message?.is_topic_message ? q.message.message_thread_id : undefined;
  if (data.startsWith('rmok:') || data.startsWith('rmset:')) {
    const [who] = await db.query("SELECT tg_id AS id, name, role FROM users WHERE tg_id = $1 AND status = 'active'", [String(q.from?.id)]);
    if (!who || !['admin', 'manager'].includes(who.role)) return answerCallback(q.id, 'Только менеджер или администратор');
    const [, id, n] = data.split(':');
    const r = await decideRooms(id, data.startsWith('rmok:') ? null : Number(n), who);
    return answerCallback(q.id, r.text);
  }
  if (await car.handleCallback(q)) return;
  if (data.startsWith('anok:') || data.startsWith('anno:')) {
    if (!(await isAdminTg(q.from?.id))) return answerCallback(q.id, 'Только администратор');
    const [v] = await db.query('SELECT * FROM visits WHERE id = $1', [data.slice(5)]);
    if (!v || !Number(v.annul_req)) {
      await answerCallback(q.id, 'Уже решено');
      await editMessage(chatId, q.message.message_id, `${escHtml(q.message.text || '')}\n\n— уже решено`).catch(() => {});
      return;
    }
    const [who] = await db.query('SELECT tg_id AS id, name FROM users WHERE tg_id = $1', [String(q.from.id)]);
    const actor = who || { id: String(q.from.id), name: q.from.first_name || 'админ' };
    if (data.startsWith('anok:')) await annulVisit(v, actor, v.annul_reason);
    else await rejectAnnul(v, actor);
    await answerCallback(q.id, 'Готово');
    await editMessage(chatId, q.message.message_id,
      `${escHtml(q.message.text || '')}\n\n${data.startsWith('anok:') ? '🗑 Аннулировано' : '↩️ Оставлено как выполненное'} · ${escHtml(actor.name)}`).catch(() => {});
    return;
  }
  if (data.startsWith('bind:')) {
    if (!(await isAdminTg(q.from?.id))) return answerCallback(q.id, 'Только администратор');
    const tech = data.slice(5);
    const b = await topicBindings();
    const key = topicKey(chatId, threadId);
    let text;
    if (tech === '-') {
      delete b[key];
      text = '🔓 Тема отвязана. Сообщения здесь больше не создают заявки.';
    } else {
      const [u] = await db.query("SELECT name, role FROM users WHERE tg_id = $1 AND status = 'active'", [tech]);
      if (!u) return answerCallback(q.id, 'Сотрудник не найден');
      if (['admin', 'manager'].includes(u.role)) return answerCallback(q.id, 'Заявки назначаются только специалистам');
      b[key] = tech;
      text = `✅ Тема привязана к <b>${escHtml(u.name)}</b>.\nКаждое сообщение с адресом здесь станет его заявкой. Шаблон — /help`;
    }
    await setSetting('topic_bindings', b);
    await answerCallback(q.id, 'Готово');
    await editMessage(chatId, q.message.message_id, text).catch(() => {});
    return;
  }
  if (data.startsWith('resched_ok:')) {
    const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [data.slice(11)]);
    if (!t) return answerCallback(q.id, 'Заявка не найдена');
    if (!Number(t.reschedule_req) || !t.reschedule_to) return answerCallback(q.id, 'Перенос уже обработан');
    const who = [q.from?.first_name, q.from?.last_name].filter(Boolean).join(' ') || 'офис';
    await confirmReschedule(t, who);
    await answerCallback(q.id, 'Перенос подтверждён');
    await editMessage(chatId, q.message.message_id,
      `${q.message.text ? escHtml(q.message.text.split('\n')[0]) : '🔁 Перенос'}\n\n✅ Перенесено на <b>${escHtml(fmtTaskDate(t.reschedule_to, t.reschedule_has_time))}</b> (${escHtml(who)})`).catch(() => {});
    return;
  }
  if (data.startsWith('tok:')) {
    if (!(await isAdminTg(q.from?.id))) return answerCallback(q.id, 'Подтверждает только администратор');
    const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [data.slice(4)]);
    if (!t) return answerCallback(q.id, 'Заявка не найдена');
    const who = [q.from?.first_name, q.from?.last_name].filter(Boolean).join(' ') || 'админ';
    const ok = await approveTask(t, who);
    if (ok && q.message?.text && String(q.message.message_id) !== String(t.confirm_id)) {
      editMessage(chatId, q.message.message_id, `${escHtml(q.message.text)}\n\n✅ Подтверждено · ${escHtml(who)}`).catch(() => {});
    }
    return answerCallback(q.id, ok ? 'Заявка отправлена технику' : 'Уже решено');
  }
  if (data.startsWith('vok:') || data.startsWith('vno:')) {
    if (!(await isAdminTg(q.from?.id))) return answerCallback(q.id, 'Только администратор');
    const [v] = await db.query('SELECT * FROM visits WHERE id = $1', [data.slice(4)]);
    if (!v) return answerCallback(q.id, 'Выезд не найден (удалён)');
    const ok = data.startsWith('vok:');
    const who = [q.from?.first_name, q.from?.last_name].filter(Boolean).join(' ') || 'админ';
    const done = await decideVisit(v, ok, who);
    if (done && q.message?.text) editMessage(chatId, q.message.message_id, `${escHtml(q.message.text)}\n\n${ok ? '✅ Подтверждено' : '❌ Отклонено'} · ${escHtml(who)}`).catch(() => {});
    return answerCallback(q.id, done ? (ok ? 'Подтверждено' : 'Отклонено') : 'Уже решено');
  }
  if (data.startsWith('jclaim:')) {
    const r = await claimJob(data.slice(7), q.from?.id);
    return answerCallback(q.id, r.error || 'Поручение ваше!');
  }
  if (data.startsWith('tclaim:')) {
    const r = await claimTask(data.slice(7), q.from?.id);
    return answerCallback(q.id, r.error || 'Заявка ваша!');
  }
  if (data.startsWith('pgok:')) {
    if (!(await isAdminTg(q.from?.id))) return answerCallback(q.id, 'Только администратор');
    const [actor] = await db.query('SELECT * FROM users WHERE tg_id = $1', [String(q.from.id)]);
    try { await decideFlag(data.slice(5), 'ok', '', actor); } catch (e) { return answerCallback(q.id, e.message); }
    await answerCallback(q.id, 'Отмечено: всё в порядке');
    if (q.message) await editMessage(chatId, q.message.message_id, `${escHtml(q.message.text || '')}\n\n✅ Проверено: всё в порядке · ${escHtml(actor?.name || '')}`).catch(() => {});
    return;
  }
  if (data.startsWith('annok:')) {
    await ackAnnouncement(data.slice(6), q.from?.id);
    await answerCallback(q.id, 'Отмечено');
    await editMessage(chatId, q.message.message_id, `${escHtml(q.message.text || '')}\n\n✅ Прочитано`).catch(() => {});
    return;
  }
  if (data.startsWith('alok:') || data.startsWith('alno:')) {
    const ok = data.startsWith('alok:');
    const code = data.slice(5);
    const [l] = await db.query('SELECT * FROM app_logins WHERE code = $1', [code]);
    if (!l || l.status !== 'pending' || Date.now() - new Date(l.created_at).getTime() > APP_LOGIN_TTL) return answerCallback(q.id, 'Запрос устарел');
    await db.query('UPDATE app_logins SET status = $1, tg_id = $2 WHERE code = $3', [ok ? 'approved' : 'denied', String(q.from.id), code]);
    await answerCallback(q.id, ok ? 'Вход подтверждён' : 'Вход отклонён');
    await editMessage(chatId, q.message.message_id, ok ? '✅ Вход подтверждён — вернитесь в приложение.' : '🚫 Вход отклонён. Если это были не вы — ничего делать не нужно.').catch(() => {});
    if (ok) { const [u] = await db.query('SELECT tg_id, name FROM users WHERE tg_id = $1', [String(q.from.id)]); if (u) await audit({ id: u.tg_id, name: u.name }, 'Вход в приложение (вне Telegram)', l.device || ''); }
    return;
  }
  if (data.startsWith('jack:')) {
    const [j] = await db.query('SELECT * FROM jobs WHERE id = $1', [data.slice(5)]);
    if (!j || String(q.from?.id) !== j.tg_id) return answerCallback(q.id, 'Не найдено');
    await ackJob(j);
    await answerCallback(q.id, 'Принято в работу');
    await editMessage(chatId, q.message.message_id, `${jobSummary(j)}\n\n✅ Принято в работу`, jobKb({ ...j, ack_at: 'x' })).catch(() => {});
    return;
  }
  if (data.startsWith('jok:') || data.startsWith('jret:')) {
    const accept = data.startsWith('jok:');
    const [j] = await db.query('SELECT * FROM jobs WHERE id = $1', [data.slice(accept ? 4 : 5)]);
    if (!(await isAdminTg(q.from?.id)) && !(j && j.reviewer_id && j.reviewer_id === String(q.from?.id))) return answerCallback(q.id, 'Принимает администратор или назначенный проверяющий');
    if (!j || j.status !== 'submitted') return answerCallback(q.id, 'Уже решено');
    const [who] = await db.query('SELECT tg_id AS id, name FROM users WHERE tg_id = $1', [String(q.from.id)]);
    const actor = who || { id: String(q.from.id), name: q.from?.first_name || 'админ' };
    const r = await decideJob(j, accept, actor);
    await answerCallback(q.id, accept ? `Принято, +${r.points} б` : 'Возвращено на доработку');
    await editMessage(chatId, q.message.message_id, `🎯 Поручение № ${j.job_no} · ${escHtml(j.title)}\n${accept ? `✅ Принято · +${ptsRu(r.points)} б` : '↩️ Возвращено на доработку'} · ${escHtml(actor.name)}`).catch(() => {});
    return;
  }
  if (data.startsWith('medok:') || data.startsWith('medno:')) {
    if (!(await isAdminTg(q.from?.id))) return answerCallback(q.id, 'Оценивает только администратор');
    const [m] = await db.query('SELECT * FROM media_posts WHERE id = $1', [data.slice(6)]);
    if (!m || m.status !== 'proposed') return answerCallback(q.id, 'Уже оценено');
    const [who] = await db.query('SELECT tg_id AS id, name FROM users WHERE tg_id = $1', [String(q.from.id)]);
    const r = await decideMedia(m, data.startsWith('medok:'), who || { name: q.from?.first_name || 'админ' });
    return answerCallback(q.id, data.startsWith('medok:') ? `Начислено +${r.points}${r.note}` : 'Без баллов');
  }
  if (data.startsWith('coachall:')) {
    if (!(await isAdminTg(q.from?.id))) return answerCallback(q.id, 'Только администратор');
    const rows = await db.query("SELECT * FROM coach_msgs WHERE week = $1 AND status = 'proposed'", [data.slice(9)]);
    const [who] = await db.query('SELECT tg_id AS id, name FROM users WHERE tg_id = $1', [String(q.from.id)]);
    for (const m of rows) await sendCoach(m, who || { name: q.from?.first_name || 'админ' });
    await answerCallback(q.id, rows.length ? `Отправлено: ${rows.length}` : 'Уже отправлено');
    await editMessage(chatId, q.message.message_id, `🤖 Разбор недели\n\n✅ Отправлено сотрудникам: ${rows.length}`).catch(() => {});
    return;
  }
  if (data.startsWith('ocall:')) {
    const r = await ackOfficeCall(data.slice(6), q.from?.id);
    return answerCallback(q.id, r.ok ? 'Спасибо! Офис знает, что вы получили' : 'Уже подтверждено');
  }
  if (data.startsWith('planok:')) {
    const ok = await ackPlan(data.slice(7), q.from?.id);
    return answerCallback(q.id, ok ? 'Спасибо! План подтверждён' : 'Уже подтверждено');
  }
  if (data.startsWith('soon:')) {
    const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [data.slice(5)]);
    if (!t) return answerCallback(q.id, 'Заявка не найдена');
    if (String(q.from?.id) !== String(t.tech_tg_id)) return answerCallback(q.id, 'Это заявка другого сотрудника');
    const ok = await soonSeen(t, [q.from?.first_name, q.from?.last_name].filter(Boolean).join(' '));
    return answerCallback(q.id, ok ? 'Отлично! Больше не напомню' : 'Уже подтверждено');
  }
  if (data.startsWith('ack:')) {
    const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [data.slice(4)]);
    if (!t) return answerCallback(q.id, 'Заявка не найдена');
    if (String(q.from?.id) !== String(t.tech_tg_id)) return answerCallback(q.id, 'Это заявка другого сотрудника');
    const ok = await ackTask(t, [q.from?.first_name, q.from?.last_name].filter(Boolean).join(' '));
    return answerCallback(q.id, ok ? 'Спасибо! Напоминаний больше не будет' : 'Уже подтверждено');
  }
  if (data.startsWith('restore:')) {
    const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [data.slice(8)]);
    if (!t) return answerCallback(q.id, 'Заявка не найдена');
    const who = [q.from?.first_name, q.from?.last_name].filter(Boolean).join(' ') || 'офис';
    const ok = await restoreTask(t, who);
    await answerCallback(q.id, ok ? 'Заявка восстановлена' : 'Заявка не отменена');
    if (ok && q.message?.text) {
      editMessage(chatId, q.message.message_id, `${escHtml(q.message.text)}\n\n♻️ Восстановлена (${escHtml(who)})`).catch(() => {});
    }
    return;
  }
  if (data.startsWith('cancel:')) {
    const [t] = await db.query('SELECT * FROM tasks WHERE id = $1', [data.slice(7)]);
    if (!t) return answerCallback(q.id, 'Заявка не найдена');
    const who = [q.from?.first_name, q.from?.last_name].filter(Boolean).join(' ') || 'офис';
    const ok = await cancelTask(t, who);
    if (ok && q.message?.text && String(q.message.message_id) !== String(t.confirm_id)) {
      editMessage(chatId, q.message.message_id, `${escHtml(q.message.text)}\n\n❌ Отменена (${escHtml(who)})`, restoreKb(t)).catch(() => {});
    }
    return answerCallback(q.id, ok ? 'Заявка отменена' : 'Уже нельзя отменить');
  }
  return answerCallback(q.id);
}

function shapeTask(t, techName) {
  return {
    id: t.id, task_no: Number(t.task_no), tech_id: t.tech_tg_id, tech_name: techName || '', company_name: t.company_name, address: t.address,
    planned_at: t.planned_at, has_time: Boolean(Number(t.has_time)), procedure: t.procedure, pests: taskPests(t), phone: t.phone,
    comment: t.comment, status: t.status, visit_id: t.visit_id || null, created_at: t.created_at, author: t.author,
    call_url: t.phone ? callUrl(t.phone) : null,
    cancel_reason: t.cancel_reason || '',
    reschedule: Number(t.reschedule_req)
      ? { to: t.reschedule_to || null, has_time: Boolean(Number(t.reschedule_has_time)), note: t.reschedule_note || '' }
      : null,
    reschedule_count: Number(t.reschedule_count || 0),
    ack_at: t.ack_at || null,
    alert_count: Number(t.alert_count || 0),
    call_status: t.call_status || '',
    en_route_at: t.en_route_at || null,
    call_undo: Boolean(Number(t.call_undo)),
    rooms: t.rooms == null ? null : Number(t.rooms),
    stage: t.stage || '',
    price: t.price == null ? null : Number(t.price),
    route_undo: Boolean(Number(t.route_undo)),
    point_cat: t.point_cat || '', point_zone: t.point_zone || '', sotki: t.sotki == null ? null : Number(t.sotki),
    team: taskTeam(t).map((id) => ({ id, name: userNames[id] || id })),
    audience: t.audience || '', claimed_at: t.claimed_at || null, claim_bonus: Number(t.claim_bonus) || 0,
    crm_lead_id: t.crm_lead_id || '',
    ...taskMult(t),
  };
}
/** Команда заявки/выезда (кроме ответственного): JSON-массив tg_id. */
function taskTeam(t) { try { const a = JSON.parse(t.team || '[]'); return Array.isArray(a) ? a.map(String).filter((x) => x && x !== String(t.tech_tg_id)) : []; } catch { return []; } }
let userNames = {};
async function refreshUserNames() { userNames = Object.fromEntries((await db.query('SELECT tg_id, name FROM users')).map((u) => [u.tg_id, u.name])); }
/** Коэффициент заявки: заданный вручную или по дню (воскресенье, особый период) — для фиолетовой подсветки. */
function taskMult(t) {
  const cfg = lastPointsCfg || { weekday: DEFAULT_WEEKDAY, special: [], windows: [] };
  const manual = t.mult == null ? null : Number(t.mult);
  const m = t.planned_at || manual ? visitMult({ started_at: t.planned_at || new Date().toISOString(), mult: manual }, t.planned_at ? cfg : { weekday: [1, 1, 1, 1, 1, 1, 1], special: [] }) : { m: 1, why: '' };
  return { mult: manual, mult_eff: m.m, mult_why: m.why };
}

/** Ссылка на страницу-звонилку: Telegram на iPhone не открывает tel: из мини-приложения, а браузер — открывает. */
function callUrl(phone) {
  const n = intlPhone(phone);
  return n ? `/r/call?n=${encodeURIComponent(n)}&${signLink(`call:${n}`, 3600 * 24 * 14)}` : null;
}

async function taskReply(t, html) {
  if (!t?.chat_id || !botEnabled) return;
  sendMessage(t.chat_id, html, { threadId: t.thread_id, replyTo: t.message_id }).catch((e) => console.error('task reply:', e.message));
}

// ---------- печатные страницы (подписанные ссылки) ----------

async function handlePrintable(req, res, url) {
  if (await car.handleRaw(url, res)) return true;
  let m = url.pathname.match(/^\/r\/visit\/([\w-]+)\.pdf$/);
  if (m) {
    if (!verifyLink(`visit:${m[1]}`, url.searchParams.get('exp'), url.searchParams.get('sig'))) return sendText(res, 403, 'Ссылка недействительна');
    const visit = await getVisit(m[1]);
    const pdf = await buildVisitPdf(visit);
    res.writeHead(200, {
      'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Cache-Control': 'no-store',
      'Content-Disposition': `inline; filename="act.pdf"; filename*=UTF-8''${encodeURIComponent(pdfName(visit))}`,
    });
    res.end(pdf);
    return true;
  }
  m = url.pathname.match(/^\/r\/jobfile\/([\w-]+)$/);
  if (m) {
    if (!verifyLink(`jobfile:${m[1]}`, url.searchParams.get('exp'), url.searchParams.get('sig'))) return sendText(res, 403, 'Ссылка недействительна');
    const [f] = await db.query('SELECT * FROM job_files WHERE id = $1', [m[1]]);
    if (f && f.storage_key) {
      res.writeHead(302, { Location: objectUrl(f.storage_key, { download: url.searchParams.get('dl') ? (f.name || 'file') : '' }), 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
    if (!f || !f.file_id) return sendText(res, 404, 'Файл не найден');
    if (Number(f.size) > 20 * 1024 * 1024) return sendText(res, 413, 'Файл больше 20 МБ — откройте его через «В Telegram»');
    try {
      const r = await fetch(await fileUrl(f.file_id));
      if (!r.ok) return sendText(res, 502, 'Telegram не отдал файл');
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(200, {
        'Content-Type': f.mime || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=3600',
        ...(url.searchParams.get('dl') ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name || 'file')}` } : {}),
      });
      res.end(buf);
    } catch (e) { return sendText(res, 502, `Не удалось загрузить: ${e.message}`); }
    return true;
  }
  m = url.pathname.match(/^\/r\/media\/([\w-]+)$/);
  if (m) {
    if (!verifyLink(`media:${m[1]}`, url.searchParams.get('exp'), url.searchParams.get('sig'))) return sendText(res, 403, 'Ссылка недействительна');
    const [p] = await db.query('SELECT file_id, mime, size, storage_key, name FROM media_posts WHERE id = $1', [m[1]]);
    if (p) p.mime = p.mime || '';
    if (p && p.storage_key) { // большой файл — прямо из хранилища, без лимита 20 МБ
      res.writeHead(302, { Location: objectUrl(p.storage_key, { download: url.searchParams.get('dl') ? (p.name || `insectprotect-${m[1].slice(0, 8)}`) : '' }), 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
    if (!p || !p.file_id) return sendText(res, 404, 'Файл не найден');
    if (Number(p.size) > 20 * 1024 * 1024) return sendText(res, 413, 'Файл больше 20 МБ — посмотрите его в Telegram (чат офиса)');
    try {
      const r = await fetch(await fileUrl(p.file_id));
      if (!r.ok) return sendText(res, 502, 'Telegram не отдал файл');
      const buf = Buffer.from(await r.arrayBuffer());
      const ext = (p.mime.split('/')[1] || 'bin').replace('quicktime', 'mov').replace('jpeg', 'jpg');
      res.writeHead(200, {
        'Content-Type': p.mime || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=3600',
        ...(url.searchParams.get('dl') ? { 'Content-Disposition': `attachment; filename="insectprotect-${m[1].slice(0, 8)}.${ext}"` } : {}),
      });
      res.end(buf);
    } catch (e) { return sendText(res, 502, `Не удалось загрузить: ${e.message}`); }
    return true;
  }
  m = url.pathname.match(/^\/r\/act\/([\w-]+)\.pdf$/);
  if (m) {
    if (!verifyLink(`act:${m[1]}`, url.searchParams.get('exp'), url.searchParams.get('sig'))) return sendText(res, 403, 'Ссылка недействительна или устарела — попросите новую');
    const [v] = await db.query('SELECT * FROM visits WHERE id = $1', [m[1]]);
    if (!v || v.status !== 'done') return sendText(res, 404, 'Документ не найден');
    const pdf = await buildVisitPdf(v, clientDocs(v));
    res.writeHead(200, {
      'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Cache-Control': 'no-store',
      'Content-Disposition': `inline; filename="act.pdf"; filename*=UTF-8''${encodeURIComponent(pdfName(v))}`,
    });
    res.end(pdf);
    return true;
  }
  m = url.pathname.match(/^\/r\/journal\/([\w-]+)\.pdf$/);
  if (m) {
    if (!verifyLink(`journal:${m[1]}`, url.searchParams.get('exp'), url.searchParams.get('sig'))) return sendText(res, 403, 'Ссылка недействительна');
    const [v] = await db.query('SELECT * FROM visits WHERE id = $1', [m[1]]);
    if (!v) return sendText(res, 404, 'Выезд не найден');
    const buf = journalPdf(await journalData(v));
    const name = `Jurnal monitorizare ${actNumber(v)} ${v.company_name}.pdf`.replace(/[\\/:*?"<>|]/g, ' ');
    res.writeHead(200, {
      'Content-Type': 'application/pdf', 'Content-Length': buf.length, 'Cache-Control': 'no-store',
      'Content-Disposition': `inline; filename="journal.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
    res.end(buf);
    return true;
  }
  if (url.pathname === '/r/call') {
    const n = url.searchParams.get('n') || '';
    if (!/^\+\d{8,15}$/.test(n) || !verifyLink(`call:${n}`, url.searchParams.get('exp'), url.searchParams.get('sig'))) return sendText(res, 403, 'Ссылка недействительна');
    const pretty = n.replace(/^\+373(\d{2})(\d{3})(\d{3})$/, '+373 $1 $2 $3');
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Звонок ${pretty}</title><style>
:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#1D1D1F}
@media(prefers-color-scheme:dark){body{background:#000;color:#F5F5F7}.hint{color:#98989D}}
main{width:100%;max-width:420px;padding:32px 24px;text-align:center}
h1{font-size:34px;font-weight:600;letter-spacing:-.02em;margin:0 0 28px}
a{display:flex;align-items:center;justify-content:center;gap:10px;height:56px;border-radius:12px;background:#34C759;color:#fff;font-size:19px;font-weight:600;text-decoration:none}
.hint{margin-top:18px;font-size:15px;color:#6E6E73;line-height:1.4}</style></head><body><main>
<h1>${pretty}</h1><a id="c" href="tel:${n}">📞 Позвонить</a>
<p class="hint">Если вызов не начался сам — нажмите кнопку.<br>После звонка вернитесь в Telegram.</p>
</main><script>setTimeout(function(){location.href='tel:${n}'},150)</script></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return true;
  }
  if (url.pathname === '/r/kpi.csv') {
    const months = url.searchParams.get('months') || '12';
    if (!verifyLink(`kpi:${months}`, url.searchParams.get('exp'), url.searchParams.get('sig'))) return sendText(res, 403, 'Ссылка недействительна');
    const k = await kpiHistory({ months });
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Месяц', 'Сотрудник', 'Получено заявок', 'Выполнено заявок', 'В срок', 'С опозданием', '% в срок', 'Отменил клиент', 'Отменил офис', 'Переносы по просьбе клиента', 'Всего актов', 'Замечаний', 'Ср. время выполнения, ч', 'Сумма по выполненным заявкам, лей', 'Баллы'];
    const lines = [head.map(cell).join(';')];
    for (const key of [...k.months].reverse()) {
      for (const t of k.techs) {
        const x = t.months.find((mm) => mm.month === key);
        lines.push([key, t.name, x.received, x.done, x.on_time, x.late, x.on_time_pct ?? '', x.client_cancelled, x.cancelled, x.reschedules, x.visits, x.remarks, x.avg_hours ?? '', x.revenue, String(x.points).replace('.', ',')].map(cell).join(';'));
      }
    }
    const buf = Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="kpi.csv"; filename*=UTF-8''${encodeURIComponent(`KPI ${k.months[0]} — ${k.current}.csv`)}`,
    });
    res.end(buf);
    return true;
  }
  if (url.pathname === '/r/export.csv') {
    const qs = new URLSearchParams(url.searchParams);
    const exp = qs.get('exp'); const sig = qs.get('sig');
    qs.delete('exp'); qs.delete('sig');
    if (!verifyLink(`export:${qs.toString()}`, exp, sig)) return sendText(res, 403, 'Ссылка недействительна');
    const { from, to, items } = await adminVisits(qs);
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Дата', 'Акт №', 'Юрлицо', 'Адрес', 'Обработка', 'Специалист', 'Вредители', 'Заселённость', 'Подготовка',
      'Замечаний', 'Фото', 'Ловушек проверено', 'Ловушек всего', 'С активностью', 'Заключение', 'Статус', 'Редакция', 'Отправлено в офис'];
    const lines = [head.map(cell).join(';')];
    for (const v of items) {
      lines.push([
        fmtRu(v.finished_at || v.started_at), v.act_no, v.company_name, v.address, v.procedure, v.tech_name, v.pests.join(', '),
        labelOf(INFESTATION, v.infestation), labelOf(PREPARATION, v.preparation), v.notes, v.photos, v.traps_checked, v.traps_total,
        v.traps_activity, v.comment, v.status === 'done' ? 'Завершён' : 'В работе', v.revision, v.office_sent_at ? fmtRu(v.office_sent_at) : '',
      ].map(cell).join(';'));
    }
    const buf = Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="acts.csv"; filename*=UTF-8''${encodeURIComponent(`Акты ${from} — ${to}.csv`)}`,
    });
    res.end(buf);
    return true;
  }
  m = url.pathname.match(/^\/r\/visit\/([\w-]+)$/);
  if (m) {
    if (!verifyLink(`visit:${m[1]}`, url.searchParams.get('exp'), url.searchParams.get('sig'))) return sendText(res, 403, 'Ссылка недействительна');
    const visit = await getVisit(m[1]);
    const rows = await visitRows(visit);
    const observations = (await loadObservations(visit.id)).map((o) => ({ ...o, photos: o.photos.map((p) => p.url) }));
    const assessment = { infestation: labelOf(INFESTATION, visit.infestation), preparation: labelOf(PREPARATION, visit.preparation) };
    return sendHtml(res, visitReportHtml({ visit, rows, observations, assessment }));
  }
  m = url.pathname.match(/^\/r\/photo\/([\w-]+)$/);
  if (m) {
    if (!verifyLink(`photo:${m[1]}`, url.searchParams.get('exp'), url.searchParams.get('sig'))) return sendText(res, 403, 'Ссылка недействительна');
    const [p] = await db.query('SELECT mime, data FROM photos WHERE id = $1', [m[1]]);
    if (!p) return sendText(res, 404, 'Фото не найдено');
    const buf = Buffer.from(p.data, 'base64');
    res.writeHead(200, { 'Content-Type': p.mime, 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400' });
    res.end(buf);
    return true;
  }
  m = url.pathname.match(/^\/r\/labels\/(\d+)$/);
  if (m) {
    if (!verifyLink(`labels:${m[1]}`, url.searchParams.get('exp'), url.searchParams.get('sig'))) return sendText(res, 403, 'Ссылка недействительна');
    const items = Array.from({ length: Number(m[1]) }, () => {
      const code = newTrapCode();
      return { code, payload: qrPayload(code) };
    });
    return sendHtml(res, labelsHtml(items));
  }
  return false;
}

// ---------- HTTP ----------

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
  return true;
}
function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
  return true;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 20_000_000) throw new HttpError(413, 'Слишком большой запрос');
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Некорректный JSON'); }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function serveStatic(req, res, pathname) {
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(WEB_DIST, safe);
  if (!file.startsWith(WEB_DIST)) return sendText(res, 403, 'Forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB_DIST, 'index.html'); // SPA
  if (!fs.existsSync(file)) return sendText(res, 404, 'Фронтенд не собран: выполните npm run build');
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': safe.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/r/')) {
      if ((await handlePrintable(req, res, url)) !== false) return;
      return sendText(res, 404, 'Не найдено');
    }
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      let user = null;
      let row = null;
      let session = false;
      if (r.access !== 'public') {
        const a = authenticate(req);
        if (a.error) return sendJson(res, a.error, { error: a.message, ...(a.code ? { code: a.code } : {}) });
        const resolved = await resolveUser(db, a.identity);
        if (resolved.error) return sendJson(res, 401, { error: 'Вход устарел — войдите через Telegram заново', code: 'app_login' });
        ({ user, row } = resolved);
        if (resolved.invited) {
          await audit(user, 'Вход по приглашению', user.name);
          notifyAdmins(`✅ По приглашению вошёл сотрудник: <b>${escHtml(user.name)}</b>`);
        }
        session = checkSession(req.headers['x-session'], row);
        if (r.access !== 'any') {
          if (user.status === 'pending') return sendJson(res, 403, { error: 'Доступ ещё не подтверждён администратором', code: 'pending' });
          if (user.status === 'blocked') return sendJson(res, 403, { error: 'Доступ закрыт', code: 'blocked' });
          if (r.pin && !session) return sendJson(res, 401, { error: 'Введите PIN-код', code: 'pin' });
          if (r.access === 'admin' && !user.isAdmin) return sendJson(res, 403, { error: 'Только для администратора' });
          if (user.isAdmin && !user.isOwner) {
            const need = permFor(req.method, url.pathname);
            if (need && !need.split('|').some((p) => user.perms.includes(p))) return sendJson(res, 403, { error: `Нет прав: ${PERM_LABEL[need.split('|')[0]] || need}. Их выдаёт главный администратор.` });
          }
        }
      }
      const body = !r.raw && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {};
      const data = await r.handler({ req, params, query: url.searchParams, body, user, row, session });
      return sendJson(res, 200, data);
    }
    sendJson(res, 404, { error: 'Не найдено' });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    if (!res.headersSent) sendJson(res, status, { error: status >= 500 && !e.status ? 'Внутренняя ошибка сервера' : e.message, ...(e.extra || {}) });
  }
});

server.listen(PORT, async () => {
  console.log(`Server on :${PORT} · db=${db.kind} · amoCRM=${amoEnabled ? process.env.AMO_DOMAIN : 'off'}`);
  if (botEnabled && !botUsername) {
    try { botUsername = (await getMe()).username || ''; } catch (e) { console.error('getMe:', e.message); }
  }
  const base = publicBase();
  if (botEnabled && base) {
    try {
      await setWebhook(`${base}/api/tg/webhook`);
      webhookActive = true;
      console.log(`Telegram webhook: ${base}/api/tg/webhook`);
    } catch (e) {
      console.error('Telegram webhook не установлен:', e.message);
    }
  }
  startKeepAlive(base);
});

/**
 * Render Free усыпляет сервис после 15 минут без входящих запросов — тогда не приходят заявки
 * из Telegram и повторные напоминания. Сервис сам «стучится» к себе через публичный адрес каждые 10 минут.
 * Отключить: KEEP_ALIVE=0. Интервал: KEEP_ALIVE_MINUTES (по умолчанию 10, максимум 14).
 */
let keepAlive = { last_at: null, last_ok: null, fails: 0 };
function startKeepAlive(base) {
  if (!base || process.env.KEEP_ALIVE === '0' || !process.env.RENDER_EXTERNAL_URL && process.env.KEEP_ALIVE !== '1') return;
  const minutes = Math.min(14, Math.max(1, Number(process.env.KEEP_ALIVE_MINUTES) || 10));
  const ping = async () => {
    try {
      const r = await fetch(`${base}/api/health?ping=1`, { signal: AbortSignal.timeout(20000) });
      keepAlive = { last_at: new Date().toISOString(), last_ok: r.ok, fails: r.ok ? 0 : keepAlive.fails + 1 };
    } catch (e) {
      keepAlive = { last_at: new Date().toISOString(), last_ok: false, fails: keepAlive.fails + 1 };
      console.error('keep-alive:', e.message);
    }
  };
  setInterval(ping, minutes * 60000);
  console.log(`Keep-alive: ${base}/api/health каждые ${minutes} мин`);
}
