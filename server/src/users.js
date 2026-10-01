// Аккаунты сотрудников: вход через Telegram, подтверждение администратором или приглашение, PIN-код.
import crypto from 'node:crypto';

const list = (name) => (process.env[name] || '').split(',').map((x) => x.trim()).filter(Boolean);
const ADMINS = list('ADMIN_TG_IDS'); // всегда администраторы
const AUTO_APPROVE = list('ALLOWED_TG_IDS'); // подтверждаются автоматически
const SECRET = process.env.REPORT_SECRET || process.env.BOT_TOKEN || 'dev-secret';
const SESSION_TTL = 12 * 3600; // PIN спрашивается не реже раза в 12 часов
const MAX_FAILS = 5;
const LOCK_MIN = 15;

async function validInvite(db, identity) {
  const sp = identity.start_param || '';
  if (!sp.startsWith('inv_')) return null;
  const [inv] = await db.query('SELECT * FROM invites WHERE code = $1', [sp.slice(4)]);
  if (!inv || inv.used_by || inv.expires_at < new Date().toISOString()) return null;
  return inv;
}

async function useInvite(db, inv, tgId) {
  await db.query('UPDATE invites SET used_by = $1, used_at = $2 WHERE code = $3', [tgId, new Date().toISOString(), inv.code]);
}

/** Возвращает { user, row, created, invited } */
export async function resolveUser(db, identity) {
  const now = new Date().toISOString();
  let [row] = await db.query('SELECT * FROM users WHERE tg_id = $1', [identity.id]);
  // вход из отдельного приложения — только для уже существующих сотрудников и с актуальной версией токена
  if (identity.app) {
    if (!row || Number(row.app_ver || 0) !== Number(identity.ver || 0)) return { error: 'app_login' };
    await db.query('UPDATE users SET last_seen = $1 WHERE tg_id = $2', [now, row.tg_id]);
    return { user: shape(row), row, created: false, invited: null };
  }
  const forceAdmin = ADMINS.includes(identity.id) || identity.id === 'dev';
  let invited = null;

  if (row) {
    if (forceAdmin && (row.role !== 'admin' || row.status !== 'active')) {
      await db.query("UPDATE users SET role = 'admin', status = 'active' WHERE tg_id = $1", [row.tg_id]);
      row = { ...row, role: 'admin', status: 'active' };
    } else if (row.status === 'pending') {
      const inv = await validInvite(db, identity);
      if (inv) {
        await db.query("UPDATE users SET status = 'active', role = $1, name = $2 WHERE tg_id = $3", [inv.role, inv.name, row.tg_id]);
        await useInvite(db, inv, row.tg_id);
        row = { ...row, status: 'active', role: inv.role, name: inv.name };
        invited = inv;
      }
    }
    await db.query('UPDATE users SET last_seen = $1, tg_name = $2, username = $3 WHERE tg_id = $4',
      [now, identity.name, identity.username || '', row.tg_id]);
    return { user: shape(row), row, created: false, invited };
  }

  const [{ n }] = await db.query('SELECT COUNT(*) AS n FROM users');
  const first = Number(n) === 0; // первый вошедший — администратор
  const inv = first || forceAdmin ? null : await validInvite(db, identity);
  const role = first || forceAdmin ? 'admin' : inv ? inv.role : 'tech';
  const status = role === 'admin' || inv || AUTO_APPROVE.includes(identity.id) ? 'active' : 'pending';
  const u = {
    tg_id: identity.id, name: inv ? inv.name : identity.name, tg_name: identity.name, username: identity.username || '',
    phone: '', role, status, created_at: now, last_seen: now, pin_hash: '', pin_fails: 0, pin_locked_until: null,
  };
  await db.query(
    'INSERT INTO users (tg_id, name, tg_name, username, phone, role, status, created_at, last_seen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [u.tg_id, u.name, u.tg_name, u.username, u.phone, u.role, u.status, u.created_at, u.last_seen],
  );
  if (inv) await useInvite(db, inv, u.tg_id);
  return { user: shape(u), row: u, created: true, invited: inv };
}

export const ALL_PERMS = ['tasks', 'jobs', 'media', 'kpi', 'reports', 'staff', 'settings', 'audit', 'cash'];
export const DEFAULT_MANAGER_PERMS = ['tasks', 'jobs', 'media', 'reports'];
export function parsePerms(v) {
  if (v == null || v === '') return DEFAULT_MANAGER_PERMS;
  try { const a = JSON.parse(v); return Array.isArray(a) ? a.filter((x) => ALL_PERMS.includes(x)) : DEFAULT_MANAGER_PERMS; } catch { return DEFAULT_MANAGER_PERMS; }
}

export function shape(r) {
  return {
    id: r.tg_id, name: r.name, tg_name: r.tg_name, username: r.username, phone: r.phone,
    role: r.role, status: r.status,
    // «admin» — полный доступ; «manager» — администратор с ограниченными правами (perms)
    isAdmin: (r.role === 'admin' || r.role === 'manager') && r.status === 'active',
    isOwner: r.role === 'admin' && r.status === 'active',
    perms: r.role === 'admin' ? ALL_PERMS : r.role === 'manager' ? parsePerms(r.perms) : [],
    pin_set: Boolean(r.pin_hash), created_at: r.created_at, last_seen: r.last_seen,
    bot_blocked: Boolean(r.bot_blocked_at),
    lang: r.lang === 'ro' ? 'ro' : 'ru',
  };
}

export async function adminIds(db) {
  const rows = await db.query("SELECT tg_id FROM users WHERE role IN ('admin', 'manager') AND status = 'active'");
  return rows.map((r) => r.tg_id).filter((id) => /^\d+$/.test(id));
}

/* ======================= PIN и сессии ======================= */

export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto.scryptSync(pin, salt, 32).toString('hex')}`;
}

function checkPinHash(pin, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(pin, Buffer.from(salt, 'hex'), 32);
  return crypto.timingSafeEqual(calc, Buffer.from(hash, 'hex'));
}

const sign = (id, exp, pinHash) =>
  crypto.createHmac('sha256', SECRET).update(`${id}|${exp}|${String(pinHash).slice(0, 24)}`).digest('base64url').slice(0, 32);

export function issueSession(row) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  return `${exp}.${sign(row.tg_id, exp, row.pin_hash)}`;
}

/** Сессия привязана к пользователю и текущему PIN: смена или сброс PIN разлогинивает. */
export function checkSession(token, row) {
  if (!token || !row?.pin_hash) return false;
  const [exp, sig] = String(token).split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const calc = sign(row.tg_id, exp, row.pin_hash);
  return calc.length === sig.length && crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(sig));
}

/** Проверка PIN с блокировкой после 5 ошибок. */
export async function verifyPin(db, row, pin) {
  const now = new Date();
  if (row.pin_locked_until && new Date(row.pin_locked_until) > now) {
    const min = Math.ceil((new Date(row.pin_locked_until) - now) / 60000);
    return { ok: false, error: `Слишком много попыток. Попробуйте через ${min} мин.`, locked_until: row.pin_locked_until };
  }
  if (checkPinHash(pin, row.pin_hash)) {
    await db.query('UPDATE users SET pin_fails = 0, pin_locked_until = NULL WHERE tg_id = $1', [row.tg_id]);
    return { ok: true, token: issueSession(row) };
  }
  const fails = Number(row.pin_fails || 0) + 1;
  if (fails >= MAX_FAILS) {
    const until = new Date(now.getTime() + LOCK_MIN * 60000).toISOString();
    await db.query('UPDATE users SET pin_fails = 0, pin_locked_until = $1 WHERE tg_id = $2', [until, row.tg_id]);
    return { ok: false, error: `Неверный PIN. Вход заблокирован на ${LOCK_MIN} минут.`, locked_until: until };
  }
  await db.query('UPDATE users SET pin_fails = $1 WHERE tg_id = $2', [fails, row.tg_id]);
  return { ok: false, error: `Неверный PIN. Осталось попыток: ${MAX_FAILS - fails}` };
}
