// QR-код в SVG без внешних зависимостей (кодировщик Kazuhiko Arase, MIT — см. vendor/qrcode).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const QRCode = require('./vendor/qrcode/index.js');
const QRErrorCorrectLevel = require('./vendor/qrcode/QRErrorCorrectLevel.js');

/** ASCII-текст (ссылка) → SVG-строка. margin — «тихая зона» в модулях. */
export function qrSvg(text, { margin = 2, dark = '#000000', light = '#FFFFFF' } = {}) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(String(text));
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}

/** Матрица модулей QR (true — тёмный). level: L | M | Q | H — чем выше, тем лучше читается повреждённая этикетка. */
export function qrMatrix(text, level = 'M') {
  const qr = new QRCode(-1, QRErrorCorrectLevel[level] ?? QRErrorCorrectLevel.M);
  qr.addData(String(text));
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}
