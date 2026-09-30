import crypto from 'node:crypto';

const fromEnv = (name, fallback) =>
  process.env[name] ? process.env[name].split(',').map((s) => s.trim()).filter(Boolean) : fallback;

export const PROCEDURES = fromEnv('PROCEDURES', ['Дезинсекция', 'Дератизация', 'Дезинфекция']);

// Для каких обработок обязательна оценка объекта (заселённость + подготовка)
export const ASSESS_PROCEDURES = fromEnv('ASSESS_PROCEDURES', ['Дезинсекция']);

export const INFESTATION = [
  { id: 'none', label: 'Не выявлено' },
  { id: 'low', label: 'Низкая' },
  { id: 'medium', label: 'Средняя' },
  { id: 'high', label: 'Высокая' },
  { id: 'critical', label: 'Критическая' },
];
export const PREPARATION = [
  { id: 'done', label: 'Выполнена' },
  { id: 'partial', label: 'Частично' },
  { id: 'none', label: 'Не выполнена' },
];
export const OBS_CATEGORIES = fromEnv('OBS_CATEGORIES', [
  'Подготовка помещения',
  'Степень заражения',
  'Нет доступа',
  'Санитарное состояние',
  'Другое',
]);
export const labelOf = (list, id) => list.find((x) => x.id === id)?.label || '';

// Станции мониторинга: на кого рассчитана → какие устройства → каких вредителей можно отметить в ловушке
export const STATION_TARGETS = [
  { id: 'rodents', label: 'Грызуны', devices: ['Клеевая ловушка', 'Родентицидная станция'], pests: ['Мыши', 'Крысы'] },
  { id: 'crawling', label: 'Тараканы и ползающие', devices: ['Клеевая ловушка', 'Феромонная ловушка'], pests: ['Рыжие тараканы', 'Чёрные тараканы', 'Муравьи', 'Другое'] },
  { id: 'flying', label: 'Летающие (моль, мухи)', devices: ['Клеевая ловушка', 'Феромонная ловушка', 'Инсектицидная лампа'], pests: ['Моль / кожееды', 'Мухи', 'Летающие насекомые', 'Другое'] },
];
export const RODENTICIDE = 'Родентицидная станция';
export const CONDITIONS = [
  { id: 'ok', label: 'В порядке' },
  { id: 'replaced', label: 'Заменена' },
  { id: 'damaged', label: 'Повреждена' },
  { id: 'missing', label: 'Отсутствует' },
  { id: 'no_access', label: 'Нет доступа' },
];
export const BAIT_LEVELS = [
  { id: 'none', label: 'Не тронута' },
  { id: 'partial', label: 'Погрызена частично' },
  { id: 'full', label: 'Съедена полностью' },
];

export const TRAP_KINDS = fromEnv('TRAP_KINDS', [
  'Клеевая ловушка',
  'Родентицидная станция',
  'Механическая ловушка',
  'Клеевая ловушка (грызуны)',
  'Клеевая ловушка (насекомые)',
  'Инсектицидная лампа',
  'Феромонная ловушка',
]);

export const PESTS = fromEnv('PESTS', ['Мыши', 'Крысы', 'Рыжие тараканы', 'Чёрные тараканы', 'Клопы', 'Муравьи', 'Летающие насекомые', 'Моль / кожееды', 'Другое']);

export const STATUSES = [
  { id: 'ok', label: 'Без активности' },
  { id: 'activity', label: 'Активность' },
  { id: 'replaced', label: 'Заменена' },
  { id: 'damaged', label: 'Повреждена' },
  { id: 'missing', label: 'Отсутствует' },
  { id: 'no_access', label: 'Нет доступа' },
];
export const STATUS_IDS = new Set(STATUSES.map((s) => s.id));
export const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label || id;

// Коды ловушек: PT-XXXXXX (без похожих символов 0/O, 1/I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newTrapCode() {
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `PT-${s}`;
}

// Достаёт код из любого содержимого QR: "PT-AB12CD", ссылки t.me/...?startapp=trap_PT-AB12CD и т.п.
export function parseTrapCode(text) {
  const m = String(text || '').toUpperCase().match(/PT-?([A-HJ-NP-Z2-9]{6})/);
  return m ? `PT-${m[1]}` : null;
}

// Содержимое QR. Если задан TMA_LINK (https://t.me/<bot>/<app>), QR откроет приложение и обычной камерой.
export function qrPayload(code) {
  const link = process.env.TMA_LINK;
  return link ? `${link}?startapp=trap_${code}` : code;
}

// ---------- баллы сотрудникам (KPI) ----------
// Категория объекта выбирается в выезде; для квартиры — ещё и удалённость. Значения редактируются в Админке → Настройки.
export const POINT_CATS = [
  { id: 'apartment', label: 'Квартира' },
  { id: 'house', label: 'Дом' },
  { id: 'clinic_s', label: 'Поликлиника S' },
  { id: 'clinic_m', label: 'Поликлиника M' },
  { id: 'hospital_s', label: 'Больница S' },
  { id: 'hospital_m', label: 'Больница M' },
  { id: 'hospital_xl', label: 'Больница XL' },
  { id: 'restaurant', label: 'Ресторан / кафе' },
  { id: 'other', label: 'Другое' },
];
export const POINT_ZONES = [
  { id: 'city', label: 'Кишинёв' },
  { id: 'near', label: 'До 100 км' },
  { id: 'far', label: 'Дальше 100 км' },
];
export const DEFAULT_POINTS = {
  apartment_city: 1, apartment_near: 2, apartment_far: 2.5,
  house: 1, clinic_s: 1, clinic_m: 2, hospital_s: 1.5, hospital_m: 2.5, hospital_xl: 5, restaurant: 2, other: 1,
  night: 0.5, night_from: 20,
};
