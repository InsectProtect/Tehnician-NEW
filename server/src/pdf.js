// Минимальный генератор PDF без зависимостей: TrueType-шрифты (кириллица), JPEG-фото,
// скруглённые прямоугольники, перенос строк и автоматические страницы.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fonts');

/* ======================= TrueType ======================= */

class TTF {
  constructor(buf, name) {
    this.buf = buf;
    this.name = name;
    const n = buf.readUInt16BE(4);
    this.tables = {};
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16;
      this.tables[buf.toString('ascii', o, o + 4)] = { off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) };
    }
    const head = this.tables.head.off;
    this.upm = buf.readUInt16BE(head + 18);
    this.bbox = [0, 1, 2, 3].map((i) => buf.readInt16BE(head + 36 + i * 2));
    const hhea = this.tables.hhea.off;
    this.ascent = buf.readInt16BE(hhea + 4);
    this.descent = buf.readInt16BE(hhea + 6);
    const nHM = buf.readUInt16BE(hhea + 34);
    const numGlyphs = buf.readUInt16BE(this.tables.maxp.off + 4);
    this.adv = new Array(numGlyphs);
    const hmtx = this.tables.hmtx.off;
    for (let g = 0; g < numGlyphs; g++) this.adv[g] = buf.readUInt16BE(hmtx + Math.min(g, nHM - 1) * 4);
    const os2 = this.tables['OS/2'];
    this.capHeight = os2 && os2.len >= 90 ? buf.readInt16BE(os2.off + 88) : this.ascent;
    this.cmap = this.#parseCmap();
    this.used = new Map(); // gid -> codepoint
  }

  #parseCmap() {
    const b = this.buf;
    const base = this.tables.cmap.off;
    const n = b.readUInt16BE(base + 2);
    let sub = -1;
    for (let i = 0; i < n; i++) {
      const pid = b.readUInt16BE(base + 4 + i * 8);
      const eid = b.readUInt16BE(base + 6 + i * 8);
      const off = b.readUInt32BE(base + 8 + i * 8);
      if (pid === 3 && eid === 1 && b.readUInt16BE(base + off) === 4) sub = base + off;
    }
    if (sub < 0) throw new Error(`${this.name}: нет cmap format 4`);
    const segX2 = b.readUInt16BE(sub + 6);
    const ends = sub + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    const map = new Map();
    for (let s = 0; s < segX2 / 2; s++) {
      const end = b.readUInt16BE(ends + s * 2);
      const start = b.readUInt16BE(starts + s * 2);
      const delta = b.readInt16BE(deltas + s * 2);
      const roAddr = ranges + s * 2;
      const ro = b.readUInt16BE(roAddr);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          g = b.readUInt16BE(roAddr + ro + (c - start) * 2);
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) map.set(c, g);
      }
    }
    return map;
  }

  gid(cp) {
    const g = this.cmap.get(cp) ?? this.cmap.get(0x3f) ?? 0;
    if (!this.used.has(g)) this.used.set(g, cp);
    return g;
  }

  width(text, size) {
    let w = 0;
    for (const ch of text) w += this.adv[this.cmap.get(ch.codePointAt(0)) ?? this.cmap.get(0x3f) ?? 0];
    return (w / this.upm) * size;
  }

  encode(text) {
    let hex = '';
    for (const ch of text) hex += this.gid(ch.codePointAt(0)).toString(16).padStart(4, '0');
    return hex;
  }
}

let fontCache = null;
function loadFonts() {
  if (!fontCache) {
    fontCache = {
      R: fs.readFileSync(path.join(FONT_DIR, 'Inter-Regular.ttf')),
      B: fs.readFileSync(path.join(FONT_DIR, 'Inter-SemiBold.ttf')),
    };
  }
  return { R: new TTF(fontCache.R, 'Inter-Regular'), B: new TTF(fontCache.B, 'Inter-SemiBold') };
}

/* ======================= JPEG ======================= */

export function jpegInfo(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let p = 2;
  while (p < buf.length) {
    if (buf[p] !== 0xff) { p++; continue; }
    const m = buf[p + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    const len = buf.readUInt16BE(p + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7), comps: buf[p + 9] };
    }
    p += 2 + len;
  }
  return null;
}

/* ======================= Документ ======================= */

const hex2rgb = (h) => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(3)).join(' ');
};
const f2 = (n) => (Math.round(n * 100) / 100).toString();

export class PdfDoc {
  constructor({ margin = 42 } = {}) {
    this.W = 595.28;
    this.H = 841.89;
    this.m = margin;
    this.fonts = loadFonts();
    this.pages = [];
    this.images = [];
    this.footer = null;
    this.addPage();
  }

  get cw() { return this.W - this.m * 2; }

  addPage() {
    this.page = { ops: [] };
    this.pages.push(this.page);
    this.y = this.m;
  }

  /** Гарантирует место под блок высотой h, иначе новая страница. */
  ensure(h) {
    if (this.y + h > this.H - this.m - 18) this.addPage();
  }

  op(s) { this.page.ops.push(s); }

  width(text, size, font = 'R') { return this.fonts[font].width(text, size); }

  text(str, x, y, { size = 10, font = 'R', color = '#1D1D1F' } = {}) {
    if (!str) return;
    const f = this.fonts[font];
    const baseline = this.H - y - (f.ascent / f.upm) * size;
    this.op(`BT ${hex2rgb(color)} rg /F${font} ${f2(size)} Tf 1 0 0 1 ${f2(x)} ${f2(baseline)} Tm <${f.encode(str)}> Tj ET`);
  }

  wrap(str, size, font, maxW) {
    const out = [];
    for (const para of String(str ?? '').split(/\r?\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(''); continue; }
      let line = '';
      for (let w of words) {
        while (this.width(w, size, font) > maxW) {
          // очень длинное слово — режем посимвольно
          let cut = w.length;
          while (cut > 1 && this.width(w.slice(0, cut), size, font) > maxW) cut--;
          if (line) { out.push(line); line = ''; }
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const cand = line ? `${line} ${w}` : w;
        if (this.width(cand, size, font) <= maxW) line = cand;
        else { out.push(line); line = w; }
      }
      if (line) out.push(line);
    }
    return out;
  }

  /** Абзац с переносами и разрывами страниц. Возвращает высоту. */
  para(str, { x = this.m, w = this.cw, size = 10, font = 'R', color = '#1D1D1F', lh = 1.45 } = {}) {
    const lines = this.wrap(str, size, font, w);
    const step = size * lh;
    for (const l of lines) {
      this.ensure(step);
      this.text(l, x, this.y, { size, font, color });
      this.y += step;
    }
    return lines.length * step;
  }

  measure(str, { w = this.cw, size = 10, font = 'R', lh = 1.45 } = {}) {
    return this.wrap(str, size, font, w).length * size * lh;
  }

  roundRect(x, y, w, h, r, color) {
    const k = 0.5523 * r;
    const X = x, Y = this.H - y - h;
    this.op(`${hex2rgb(color)} rg ${this.#rrPath(X, Y, w, h, r, k)} f`);
  }

  #rrPath(x, y, w, h, r, k) {
    return [
      `${f2(x + r)} ${f2(y)} m`,
      `${f2(x + w - r)} ${f2(y)} l`,
      `${f2(x + w - r + k)} ${f2(y)} ${f2(x + w)} ${f2(y + r - k)} ${f2(x + w)} ${f2(y + r)} c`,
      `${f2(x + w)} ${f2(y + h - r)} l`,
      `${f2(x + w)} ${f2(y + h - r + k)} ${f2(x + w - r + k)} ${f2(y + h)} ${f2(x + w - r)} ${f2(y + h)} c`,
      `${f2(x + r)} ${f2(y + h)} l`,
      `${f2(x + r - k)} ${f2(y + h)} ${f2(x)} ${f2(y + h - r + k)} ${f2(x)} ${f2(y + h - r)} c`,
      `${f2(x)} ${f2(y + r)} l`,
      `${f2(x)} ${f2(y + r - k)} ${f2(x + r - k)} ${f2(y)} ${f2(x + r)} ${f2(y)} c h`,
    ].join(' ');
  }

  line(x1, y1, x2, y2, color = '#D2D2D7', width = 0.6) {
    this.op(`${hex2rgb(color)} RG ${f2(width)} w ${f2(x1)} ${f2(this.H - y1)} m ${f2(x2)} ${f2(this.H - y2)} l S`);
  }

  /** Прямоугольник: обводка и/или заливка. */
  rect(x, y, w, h, { stroke = '#2B2B2B', fill = null, width = 0.7 } = {}) {
    const Y = this.H - y - h;
    const ops = [];
    if (fill) ops.push(`${hex2rgb(fill)} rg`);
    if (stroke) ops.push(`${hex2rgb(stroke)} RG ${f2(width)} w`);
    ops.push(`${f2(x)} ${f2(Y)} ${f2(w)} ${f2(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    this.op(ops.join(' '));
  }

  /** Текст по правому краю. */
  textRight(str, xRight, y, opts = {}) {
    this.text(str, xRight - this.width(str, opts.size || 10, opts.font || 'R'), y, opts);
  }

  /** JPEG в рамке: fit = 'cover' (обрезка) или 'contain' (целиком). */
  image(buf, x, y, w, h, r = 6, fit = 'cover') {
    const info = jpegInfo(buf);
    if (!info) return false;
    const name = `Im${this.images.length + 1}`;
    this.images.push({ name, buf, ...info });
    const s = fit === 'contain' ? Math.min(w / info.w, h / info.h) : Math.max(w / info.w, h / info.h);
    const iw = info.w * s, ih = info.h * s;
    const ix = x + (w - iw) / 2, iy = y + (h - ih) / 2;
    const Y = this.H - y - h;
    this.op(`q ${this.#rrPath(x, Y, w, h, r, 0.5523 * r)} W n ${f2(iw)} 0 0 ${f2(ih)} ${f2(ix)} ${f2(this.H - iy - ih)} cm /${name} Do Q`);
    return true;
  }

  /* ---------- сборка файла ---------- */

  toBuffer() {
    if (this.footer) {
      const total = this.pages.length;
      this.pages.forEach((p, i) => {
        this.page = p;
        this.footer(i + 1, total);
      });
    }
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const stream = (dict, data, compress = true) => {
      const d = compress ? zlib.deflateSync(data) : data;
      return { dict: `${dict}${compress ? ' /Filter /FlateDecode' : ''} /Length ${d.length}`, data: d };
    };

    const catalogId = add(null);
    const pagesId = add(null);

    const fontIds = {};
    for (const [key, f] of Object.entries(this.fonts)) {
      const ff = zlib.deflateSync(f.buf);
      const fileId = add({ dict: `/Filter /FlateDecode /Length ${ff.length} /Length1 ${f.buf.length}`, data: ff });
      const sc = 1000 / f.upm;
      const descId = add(`<< /Type /FontDescriptor /FontName /${f.name} /Flags 32 /FontBBox [${f.bbox.map((v) => Math.round(v * sc)).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round(f.ascent * sc)} /Descent ${Math.round(f.descent * sc)} /CapHeight ${Math.round(f.capHeight * sc)} /StemV 80 /FontFile2 ${fileId} 0 R >>`);
      const gids = [...f.used.keys()].sort((a, b) => a - b);
      const W = gids.map((g) => `${g} [${Math.round(f.adv[g] * sc)}]`).join(' ');
      const cidId = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${f.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descId} 0 R /W [${W}] /CIDToGIDMap /Identity >>`);
      const bf = [];
      for (let i = 0; i < gids.length; i += 100) {
        const chunk = gids.slice(i, i + 100);
        bf.push(`${chunk.length} beginbfchar\n${chunk.map((g) => {
          const cp = f.used.get(g);
          const u = cp > 0xffff ? String.fromCodePoint(cp).split('').map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('') : cp.toString(16).padStart(4, '0');
          return `<${g.toString(16).padStart(4, '0')}> <${u}>`;
        }).join('\n')}\nendbfchar`);
      }
      const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n${bf.join('\n')}\nendcmap CMapName currentdict /CMap defineresource pop end end`;
      const tuId = add(stream('', Buffer.from(cmap)));
      fontIds[key] = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${f.name} /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] /ToUnicode ${tuId} 0 R >>`);
    }

    const imgIds = {};
    for (const im of this.images) {
      const cs = im.comps === 1 ? '/DeviceGray' : im.comps === 4 ? '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]' : '/DeviceRGB';
      imgIds[im.name] = add({ dict: `/Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.buf.length}`, data: im.buf });
    }

    const fontRes = Object.entries(fontIds).map(([k, id]) => `/F${k} ${id} 0 R`).join(' ');
    const pageIds = [];
    for (const p of this.pages) {
      const content = stream('', Buffer.from(p.ops.join('\n'), 'latin1'));
      const cId = add(content);
      const used = Object.keys(imgIds).filter((n) => p.ops.some((o) => o.includes(`/${n} Do`)));
      const xo = used.length ? ` /XObject << ${used.map((n) => `/${n} ${imgIds[n]} 0 R`).join(' ')} >>` : '';
      pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << ${fontRes} >>${xo} >> /Contents ${cId} 0 R >>`));
    }
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    objs[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;

    const chunks = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    let size = chunks[0].length;
    const offsets = [];
    objs.forEach((o, i) => {
      offsets.push(size);
      let b;
      if (typeof o === 'string') b = Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
      else b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< ${o.dict} >>\nstream\n`, 'latin1'), o.data, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
      chunks.push(b);
      size += b.length;
    });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${size}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
}
