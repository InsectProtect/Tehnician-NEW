// Собственная база клиентов (юрлиц) — импорт из Excel (.xlsx) или CSV.
// Разбор .xlsx без сторонних библиотек: это zip-архив с XML внутри.
import zlib from 'node:zlib';
import crypto from 'node:crypto';

/* ======================= Разбор файлов ======================= */

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Файл повреждён или это не .xlsx');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compSize);
    files[name] = () => (method === 8 ? zlib.inflateRawSync(raw) : raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decodeXml = (s) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => {
    const map = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
    if (map[e.toLowerCase()]) return map[e.toLowerCase()];
    return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });

const textOf = (xml) => decodeXml([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

const colIndex = (ref) => {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function parseXlsx(buf) {
  const files = unzip(buf);
  const shared = files['xl/sharedStrings.xml']
    ? [...files['xl/sharedStrings.xml']().toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
    : [];

  // первый лист книги
  let sheetPath = 'xl/worksheets/sheet1.xml';
  try {
    const wb = files['xl/workbook.xml']().toString('utf8');
    const rels = files['xl/_rels/workbook.xml.rels']().toString('utf8');
    const rid = wb.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
    const target = rid && rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
      || rid && rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1];
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  } catch { /* берём sheet1 */ }
  if (!files[sheetPath]) sheetPath = Object.keys(files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort()[0];
  if (!sheetPath) throw new Error('В книге нет листов');

  const xml = files[sheetPath]().toString('utf8');
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] || '';
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/t="(\w+)"/)?.[1];
      let v = '';
      if (type === 's') v = shared[Number(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1])] ?? '';
      else if (type === 'inlineStr') v = textOf(inner);
      else v = decodeXml(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      row[ref ? colIndex(ref) : row.length] = v;
    }
    rows.push(Array.from(row, (x) => String(x ?? '').trim()));
  }
  return rows;
}

function parseCsv(buf) {
  let text = buf.toString('utf8');
  if (text.includes('�')) text = new TextDecoder('windows-1251').decode(buf); // CSV из русского Excel
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = [';', ',', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

export function parseTable(buf, filename = '') {
  const isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  if (/\.xls$/i.test(filename) && !isZip) throw new Error('Старый формат .xls не поддерживается — сохраните файл как .xlsx');
  return isZip ? parseXlsx(buf) : parseCsv(buf);
}

/* ======================= Сопоставление колонок ======================= */

const has = (h, words) => words.some((w) => h.includes(w));

function detectColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cols = { name: -1, inn: -1, phone: -1, contact: -1, func: -1, legal: -1, address: [] };
    rows[r].forEach((raw, i) => {
      const h = raw.toLowerCase();
      if (!h) return;
      if (has(h, ['инн', 'idno', 'cod fiscal', 'codul fiscal', 'фискальн'])) cols.inn = i;
      else if (has(h, ['телефон', 'тел.', 'phone', 'telefon'])) cols.phone = i;
      else if (has(h, ['должност', 'funcți', 'functi'])) cols.func = i;
      else if (has(h, ['контакт', 'фио', 'представител', 'reprezentant', 'persoana de contact'])) cols.contact = i;
      else if (has(h, ['юрид', 'jurid', 'sediu'])) cols.legal = i;
      else if (has(h, ['адрес', 'address', 'adres', 'locați', 'locati', 'obiect'])) cols.address.push(i);
      else if (cols.name < 0 && has(h, ['юрлиц', 'юр. лиц', 'юр лиц', 'наименован', 'название', 'клиент', 'компани', 'организац', 'заказчик', 'name', 'denumire', 'beneficiar', 'client', 'companie'])) cols.name = i;
    });
    const extra = cols.address.length || cols.inn >= 0 || cols.phone >= 0 || cols.contact >= 0 || cols.legal >= 0;
    if (cols.name >= 0 && extra) return { header: r, cols };
  }
  // заголовков нет: A — юрлицо, B — адрес
  return { header: -1, cols: { name: 0, inn: -1, phone: -1, contact: -1, func: -1, legal: -1, address: [1] } };
}

/* ======================= Работа с БД ======================= */

const norm = (s) => String(s || '').toLowerCase().replace(/[«»"'`]/g, '').replace(/\s+/g, ' ').trim();
const now = () => new Date().toISOString();

export async function importClients(db, buf, filename) {
  const rows = parseTable(buf, filename);
  const { header, cols } = detectColumns(rows);
  const existing = await db.query('SELECT * FROM clients');
  const byKey = new Map();
  for (const c of existing) {
    if (c.inn) byKey.set(`inn:${c.inn}`, c);
    byKey.set(`name:${norm(c.name)}`, c);
  }
  const objects = await db.query('SELECT company_id, address FROM objects');
  const objKeys = new Set(objects.map((o) => `${o.company_id}|${norm(o.address)}`));

  const stats = { created: 0, updated: 0, addresses: 0, skipped: 0, total: 0 };
  const touched = new Set();
  for (let r = header + 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[cols.name] || '').trim();
    if (!name) { if (row.some(Boolean)) stats.skipped++; continue; }
    stats.total++;
    const inn = cols.inn >= 0 ? String(row[cols.inn] || '').replace(/\D/g, '') : '';
    const phone = cols.phone >= 0 ? row[cols.phone] || '' : '';
    const contact = cols.contact >= 0 ? row[cols.contact] || '' : '';
    const func = cols.func >= 0 ? row[cols.func] || '' : '';
    const legal = cols.legal >= 0 ? row[cols.legal] || '' : '';
    let client = (inn && byKey.get(`inn:${inn}`)) || byKey.get(`name:${norm(name)}`);
    if (!client) {
      client = { id: crypto.randomUUID(), name, inn, phone, contact };
      await db.query('INSERT INTO clients (id, name, inn, phone, contact, rep_function, legal_address, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [client.id, name, inn, phone, contact, func, legal, now()]);
      stats.created++;
    } else if (!touched.has(client.id)) {
      await db.query('UPDATE clients SET name = $1, inn = $2, phone = $3, contact = $4, rep_function = $5, legal_address = $6 WHERE id = $7',
        [name, inn || client.inn || '', phone || client.phone || '', contact || client.contact || '',
          func || client.rep_function || '', legal || client.legal_address || '', client.id]);
      stats.updated++;
    }
    touched.add(client.id);
    if (inn) byKey.set(`inn:${inn}`, client);
    byKey.set(`name:${norm(name)}`, client);

    for (const ai of cols.address) {
      const address = (row[ai] || '').trim();
      if (address.length < 3) continue;
      const key = `${client.id}|${norm(address)}`;
      if (objKeys.has(key)) continue;
      objKeys.add(key);
      await db.query('INSERT INTO objects (id, company_id, company_name, address, created_at) VALUES ($1,$2,$3,$4,$5)',
        [crypto.randomUUID(), client.id, name, address, now()]);
      stats.addresses++;
    }
  }
  if (!stats.total) throw new Error('Не нашёл клиентов в файле. Нужна колонка «Юрлицо» или «Наименование»');
  return stats;
}

export async function searchLocalClients(db, q) {
  const clients = await db.query('SELECT * FROM clients');
  const objects = await db.query('SELECT company_id, address FROM objects');
  const addr = {};
  for (const o of objects) (addr[o.company_id] ||= []).push(o.address);
  const needle = norm(q);
  return clients
    .map((c) => ({ id: c.id, name: c.name, inn: c.inn, addresses: addr[c.id] || [] }))
    .filter((c) => !needle || norm(c.name).includes(needle) || (c.inn && c.inn.includes(needle)) || c.addresses.some((a) => norm(a).includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .slice(0, 50);
}

export async function getLocalClient(db, id) {
  const [c] = await db.query('SELECT * FROM clients WHERE id = $1', [id]);
  if (!c) return null;
  const objects = await db.query('SELECT address FROM objects WHERE company_id = $1', [id]);
  return {
    id: c.id, name: c.name, addresses: objects.map((o) => o.address),
    inn: c.inn, legal_address: c.legal_address || '', contact: c.contact || '', rep_function: c.rep_function || '',
  };
}

export async function createClient(db, { name, inn = '', phone = '', contact = '', rep_function = '', legal_address = '' }) {
  const id = crypto.randomUUID();
  await db.query('INSERT INTO clients (id, name, inn, phone, contact, rep_function, legal_address, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, name, inn, phone, contact, rep_function, legal_address, now()]);
  return { id, name, addresses: [] };
}
