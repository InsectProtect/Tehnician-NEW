// QR-этикетки для станций (v73): PDF без внешних библиотек — A4 под стандартные листы наклеек,
// QR с повышенной коррекцией ошибок (Q — читается, даже если до 25% этикетки стёрто/порвано).
import { PdfDoc } from './pdf.js';
import { qrMatrix } from './qr.js';

const MM = 72 / 25.4;

// Сетка = стандартные листы самоклеек A4 без полей (печатать «по размеру листа», масштаб 100%)
export const LABEL_SIZES = {
  s: { cols: 3, rows: 8, title: 'Малые', hint: '70×37 мм · 24 на листе — на ловушку' },
  m: { cols: 2, rows: 6, title: 'Средние', hint: '105×49 мм · 12 на листе — на коробку' },
  l: { cols: 2, rows: 3, title: 'Большие', hint: '105×99 мм · 6 на листе — крупная станция, улица' },
};

/** Квадрат QR из прямоугольников (соседние модули склеены в полосы — меньше файл, без «сетки» при печати). */
function drawQr(doc, payload, x, y, size, level) {
  const m = qrMatrix(payload, level);
  const quiet = 2; // «тихая зона» в модулях — без неё сканеры путаются
  const n = m.length + quiet * 2;
  const k = size / n;
  doc.rect(x, y, size, size, { stroke: null, fill: '#FFFFFF' });
  const ops = [];
  for (let r = 0; r < m.length; r++) {
    let c = 0;
    while (c < m.length) {
      if (!m[r][c]) { c++; continue; }
      let e = c;
      while (e < m.length && m[r][e]) e++;
      const rx = x + (c + quiet) * k;
      const ry = y + (r + quiet) * k;
      // +0.02 пт перекрытие — без белых волосков между полосами
      ops.push(`${(rx).toFixed(3)} ${(doc.H - ry - k - 0.02).toFixed(3)} ${((e - c) * k + 0.02).toFixed(3)} ${(k + 0.04).toFixed(3)} re`);
      c = e;
    }
  }
  doc.op(`0 0 0 rg ${ops.join(' ')} f`);
}

/** Самый крупный кегль, при котором строка влезает в ширину w. */
function fit(doc, text, font, max, w) {
  let size = max;
  while (size > 5 && doc.width(text, size, font) > w) size -= 0.5;
  return size;
}

/**
 * items: [{ code, payload, number?, note? }]
 * opts: { size: s|m|l, brand, phone, warn (bool), lines (bool — линии реза) }
 */
export function labelsPdf(items, opts = {}) {
  const L = LABEL_SIZES[opts.size] || LABEL_SIZES.s;
  const doc = new PdfDoc({ margin: 0 });
  const cw = doc.W / L.cols;
  const ch = doc.H / L.rows;
  const per = L.cols * L.rows;
  const pad = 4 * MM; // поля внутри этикетки: принтеры не печатают «в край»
  const vertical = ch > 80 * MM;
  const brand = String(opts.brand || '').trim();
  const phone = String(opts.phone || '').trim();
  const warn = opts.warn ? 'НЕ ТРОГАТЬ · NU ATINGEȚI' : '';

  items.forEach((it, i) => {
    if (i > 0 && i % per === 0) doc.addPage();
    const col = (i % per) % L.cols;
    const row = Math.floor((i % per) / L.cols);
    const x = col * cw;
    const y = row * ch;
    if (opts.lines !== false) doc.rect(x, y, cw, ch, { stroke: '#D2D2D7', width: 0.4 });
    const no = it.number ? `№ ${it.number}` : '№ ______';
    if (vertical) {
      // крупная: QR по центру сверху, текст под ним
      const textH = 30 * MM;
      const q = Math.min(cw - pad * 2, ch - pad * 2 - textH);
      const qx = x + (cw - q) / 2;
      drawQr(doc, it.payload, qx, y + pad, q, opts.level || 'Q');
      let ty = y + pad + q + 2 * MM;
      const tw = cw - pad * 2;
      const center = (t, size, font, color) => { doc.text(t, x + (cw - doc.width(t, size, font)) / 2, ty, { size, font, color }); ty += size * 1.3; };
      if (brand) center(brand.toUpperCase(), fit(doc, brand.toUpperCase(), 'B', 11, tw), 'B', '#6E6E73');
      center(it.code, fit(doc, it.code, 'B', 22, tw), 'B', '#1D1D1F');
      center(`${no}${it.note ? ` · ${it.note}` : ''}`.slice(0, 60), fit(doc, `${no}${it.note ? ` · ${it.note}` : ''}`.slice(0, 60), 'R', 13, tw), 'R', '#1D1D1F');
      if (phone) center(phone, fit(doc, phone, 'R', 11, tw), 'R', '#1D1D1F');
      if (warn) center(warn, fit(doc, warn, 'B', 10, tw), 'B', '#D71921');
      return;
    }
    // горизонтальная: QR слева во всю высоту, текст справа
    const q = ch - pad * 2;
    drawQr(doc, it.payload, x + pad, y + pad, q, opts.level || 'Q');
    const tx = x + pad + q + 2.5 * MM;
    const tw = x + cw - pad + 1.5 * MM - tx;
    const big = ch > 45 * MM;
    const lines = [];
    if (brand) lines.push([brand.toUpperCase(), 'B', big ? 9 : 6.5, '#6E6E73']);
    lines.push([it.code, 'B', big ? 17 : 12.5, '#1D1D1F']);
    const n2 = `${no}${it.note ? ` · ${it.note}` : ''}`.slice(0, 40);
    lines.push([n2, 'R', big ? 12 : 9, '#1D1D1F']);
    if (phone) lines.push([phone, 'R', big ? 10 : 7.5, '#1D1D1F']);
    if (warn) lines.push([warn, 'B', big ? 8.5 : 6, '#D71921']);
    const sized = lines.map(([t, f, s, c]) => [t, f, fit(doc, t, f, s, tw), c]);
    const total = sized.reduce((a, l) => a + l[2] * 1.35, 0);
    let ty = y + (ch - total) / 2;
    for (const [t, f, s, c] of sized) { doc.text(t, tx, ty, { size: s, font: f, color: c }); ty += s * 1.35; }
  });
  return doc.toBuffer();
}
