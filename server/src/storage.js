// Хранилище больших файлов: любое S3-совместимое (Cloudflare R2, Backblaze B2, AWS S3).
// Телефон загружает файл НАПРЯМУЮ в хранилище по подписанной ссылке (сервер файл не пропускает через себя),
// поэтому размер ограничен только MAX_UPLOAD_MB (по умолчанию 2 ГБ), а не лимитами Telegram (50 МБ / 20 МБ).
// Без переменных S3_* всё работает как раньше — через Telegram.
import crypto from 'node:crypto';

const cfg = () => ({
  endpoint: (process.env.S3_ENDPOINT || '').replace(/\/$/, ''), // https://<account_id>.r2.cloudflarestorage.com
  bucket: process.env.S3_BUCKET || '',
  key: process.env.S3_ACCESS_KEY_ID || '',
  secret: process.env.S3_SECRET_ACCESS_KEY || '',
  region: process.env.S3_REGION || 'auto',
});
export const storageOn = () => { const c = cfg(); return Boolean(c.endpoint && c.bucket && c.key && c.secret); };
export const uploadMaxBytes = () => (storageOn() ? Number(process.env.MAX_UPLOAD_MB || 2048) : 50) * 1024 * 1024;

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s, 'utf8').digest();
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * Подписанная ссылка (AWS Signature V4, query string). opts.virtualHost — для проверки на эталоне AWS.
 * extra — дополнительные параметры (например, response-content-disposition для скачивания).
 */
export function presign(method, objectKey, expires = 3600, extra = {}, opts = {}) {
  const c = { ...cfg(), ...(opts.cfg || {}) };
  const d = opts.date || new Date();
  const amzDate = d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const u = new URL(c.endpoint);
  const host = opts.virtualHost ? `${c.bucket}.${u.host}` : u.host;
  const path = `${opts.virtualHost ? '' : `/${c.bucket}`}/${objectKey.split('/').map(enc).join('/')}`;
  const scope = `${day}/${c.region}/s3/aws4_request`;
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${c.key}/${scope}`, 'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.min(604800, Math.max(1, Math.round(expires)))), 'X-Amz-SignedHeaders': 'host', ...extra,
  };
  const cq = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join('&');
  const creq = [method, path, cq, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, sha(creq)].join('\n');
  const kSign = hmac(hmac(hmac(hmac(`AWS4${c.secret}`, day), c.region), 's3'), 'aws4_request');
  const sig = crypto.createHmac('sha256', kSign).update(sts, 'utf8').digest('hex');
  return `${u.protocol}//${host}${path}?${cq}&X-Amz-Signature=${sig}`;
}

/** Ключ объекта: папка/дата/id-имя (латиница, чтобы ссылки были простыми). */
export function objectKey(folder, id, name) {
  const ext = (String(name || '').match(/\.([a-z0-9]{1,8})$/i)?.[1] || 'bin').toLowerCase();
  return `${folder}/${new Date().toISOString().slice(0, 7)}/${id}.${ext}`;
}

/** Размер загруженного объекта (или null, если его нет). */
export async function headObject(objectKey) {
  const r = await fetch(presign('HEAD', objectKey, 300), { method: 'HEAD' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`хранилище ответило ${r.status}`);
  return { size: Number(r.headers.get('content-length')) || 0, type: r.headers.get('content-type') || '' };
}
export async function getObject(objectKey) {
  const r = await fetch(presign('GET', objectKey, 300));
  if (!r.ok) throw new Error(`хранилище ответило ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
export async function deleteObject(objectKey) {
  try { await fetch(presign('DELETE', objectKey, 300), { method: 'DELETE' }); } catch { /* не критично */ }
}
/** Ссылка на просмотр/скачивание (по умолчанию на 1 час). */
export function objectUrl(objectKey, { download = '', expires = 3600 } = {}) {
  return presign('GET', objectKey, expires, download ? { 'response-content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(download)}` } : {});
}
