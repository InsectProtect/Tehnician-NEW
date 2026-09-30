import crypto from 'node:crypto';

const BOT_TOKEN = process.env.BOT_TOKEN;
const DEV_AUTH = process.env.DEV_AUTH === '1';
const MAX_AGE_SEC = 7 * 24 * 3600;

// Проверка подписи initData по алгоритму Telegram:
// secret = HMAC_SHA256("WebAppData", bot_token); hash = HMAC_SHA256(secret, data_check_string)
export function validateInitData(raw, botToken = BOT_TOKEN) {
  if (!raw || !botToken) return null;
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SEC) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    if (!user?.id) return null;
    return {
      id: String(user.id),
      name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id),
      username: user.username || '',
      start_param: params.get('start_param') || '',
    };
  } catch {
    return null;
  }
}

// Возвращает Telegram-личность пользователя (проверенную подписью). Права — в users.js.
export function authenticate(req) {
  const header = req.headers['authorization'] || '';
  // отдельное приложение (APK / браузер): токен, выданный после подтверждения входа в Telegram-боте
  if (header.startsWith('app ')) {
    const t = verifyAppToken(header.slice(4));
    if (!t) return { error: 401, message: 'Вход устарел — войдите через Telegram заново', code: 'app_login' };
    return { identity: { id: t.id, name: '', username: '', start_param: '', app: true, ver: t.ver } };
  }
  const raw = header.startsWith('tma ') ? header.slice(4) : '';
  let identity = validateInitData(raw);
  if (!identity && DEV_AUTH) identity = { id: req.headers['x-dev-user'] || 'dev', name: 'Тестовый техник', username: '', start_param: req.headers['x-dev-start'] || '' };
  if (!identity) return { error: 401, message: 'Откройте приложение из Telegram', code: 'app_login' };
  return { identity };
}

// Токен отдельного приложения: app.<tg_id>.<exp>.<ver>.<sig> (ver — чтобы «выйти на всех устройствах»).
const APP_SECRET = (process.env.REPORT_SECRET || BOT_TOKEN || 'dev-secret') + ':app';
export function makeAppToken(tgId, ver = 0, ttlSec = 3600 * 24 * 180) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = `${tgId}.${exp}.${ver}`;
  const sig = crypto.createHmac('sha256', APP_SECRET).update(body).digest('base64url').slice(0, 43);
  return `${body}.${sig}`;
}
export function verifyAppToken(tok) {
  const p = String(tok || '').split('.');
  if (p.length !== 4) return null;
  const [id, exp, ver, sig] = p;
  if (!/^\d+$/.test(id) || Number(exp) < Date.now() / 1000) return null;
  const calc = crypto.createHmac('sha256', APP_SECRET).update(`${id}.${exp}.${ver}`).digest('base64url').slice(0, 43);
  if (calc.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(sig))) return null;
  return { id, ver: Number(ver) };
}

// Подписанные ссылки для печатных страниц (акт, этикетки), которые открываются во внешнем браузере.
const LINK_SECRET = process.env.REPORT_SECRET || BOT_TOKEN || 'dev-secret';

export function signLink(payload, ttlSec = 3600 * 24 * 30) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto.createHmac('sha256', LINK_SECRET).update(`${payload}|${exp}`).digest('base64url').slice(0, 32);
  return `exp=${exp}&sig=${sig}`;
}

export function verifyLink(payload, exp, sig) {
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const calc = crypto.createHmac('sha256', LINK_SECRET).update(`${payload}|${exp}`).digest('base64url').slice(0, 32);
  return calc.length === sig.length && crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(sig));
}
