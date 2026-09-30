// Адрес по координатам («Поделиться адресом»): сначала map.md (если задан MAPMD_TOKEN), иначе OpenStreetMap (Nominatim).
// Возвращает { city, street, full, source } — специалист может поправить перед сохранением.

const MAPMD_TOKEN = process.env.MAPMD_TOKEN || '';
const MAPMD_URL = process.env.MAPMD_REVERSE_URL || 'https://map.md/api/companies/webmap/near';
const UA = process.env.GEO_USER_AGENT || 'InsectProtect-TMA/1.0 (pest control field app)';

const MUNICIPALITIES = ['Chișinău', 'Chisinau', 'Bălți', 'Balti', 'Bender', 'Tighina', 'Comrat', 'Tiraspol', 'Cahul', 'Ungheni', 'Orhei', 'Soroca', 'Edineț', 'Hîncești', 'Ceadîr-Lunga', 'Strășeni'];

/** «Strada Ismail» → «str. Ismail», «Bulevardul Dacia» → «bd. Dacia». */
function shortStreet(name) {
  return String(name || '')
    .replace(/^Strada\s+/i, 'str. ')
    .replace(/^Bulevardul\s+/i, 'bd. ')
    .replace(/^Șoseaua\s+|^Soseaua\s+/i, 'șos. ')
    .replace(/^Aleea\s+/i, 'al. ')
    .replace(/^Piața\s+/i, 'p-ța ')
    .replace(/^Stradela\s+/i, 'str-la ')
    .replace(/^улица\s+/i, 'ул. ')
    .replace(/^проспект\s+/i, 'пр. ')
    .trim();
}

function cityLabel(name, kind) {
  if (!name) return '';
  if (/^(mun\.|or\.|s\.|com\.)/i.test(name)) return name;
  if (MUNICIPALITIES.some((m) => m.toLowerCase() === name.toLowerCase())) return `mun. ${name}`;
  if (kind === 'village') return `s. ${name}`;
  if (kind === 'town') return `or. ${name}`;
  return name;
}

const pick = (o, keys) => { for (const k of keys) if (o && o[k]) return o[k]; return ''; };

async function viaMapMd(lat, lon) {
  if (!MAPMD_TOKEN) return null;
  const url = `${MAPMD_URL}?lat=${lat}&lon=${lon}`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${Buffer.from(`${MAPMD_TOKEN}:`).toString('base64')}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`map.md ${res.status}`);
  const data = await res.json();
  // ответ бывает объектом или списком — берём ближайший объект с адресом
  const list = Array.isArray(data) ? data : data.buildings || data.results || data.items || [data];
  const b = list.find((x) => x && (x.street || x.street_name || x.address)) || list[0];
  if (!b) return null;
  const streetName = pick(b, ['street', 'street_name']) || pick(b.street || {}, ['name']);
  const house = pick(b, ['number', 'house', 'house_number']);
  const city = pick(b, ['city', 'locality', 'location']) || pick(b.city || {}, ['name']);
  const street = [shortStreet(typeof streetName === 'string' ? streetName : ''), house].filter(Boolean).join(' ');
  if (!street && !b.address) return null;
  return { city: cityLabel(typeof city === 'string' ? city : ''), street: street || String(b.address), source: 'map.md' };
}

async function viaNominatim(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=ro&zoom=18&lat=${lat}&lon=${lon}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`OSM ${res.status}`);
  const d = await res.json();
  const a = d.address || {};
  const kind = a.city ? 'city' : a.town ? 'town' : a.village ? 'village' : '';
  const city = cityLabel(a.city || a.town || a.village || a.municipality || a.county || '', kind);
  const street = [shortStreet(a.road || a.pedestrian || a.footway || ''), a.house_number || ''].filter(Boolean).join(' ');
  return { city, street, source: 'openstreetmap' };
}

export async function reverseGeocode(lat, lon) {
  lat = Number(lat); lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Некорректные координаты');
  let r = null;
  try { r = await viaMapMd(lat, lon); } catch (e) { console.error('map.md:', e.message); }
  if (!r) r = await viaNominatim(lat, lon);
  return { ...r, full: [r.city, r.street].filter(Boolean).join(', '), lat, lon };
}

/** Координаты по адресу (для карты «В пути» и времени в дороге). Nominatim: не чаще 1 запроса в секунду. */
let lastForward = 0;
export async function forwardGeocode(address) {
  const q = String(address || '').trim();
  if (q.length < 4) return null;
  const wait = Math.max(0, lastForward + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastForward = Date.now();
  const query = /moldova|chi[sș]in[aă]u|mun\.|or\.|s\./i.test(q) ? q : `${q}, Chișinău`;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=md&accept-language=ro&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error(`OSM ${res.status}`);
  const [d] = await res.json();
  if (!d) return null;
  const lat = Number(d.lat); const lon = Number(d.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}
