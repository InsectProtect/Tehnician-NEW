// Электронный журнал мониторинга станций (RO): результаты текущего обслуживания + история по объекту.
// Используется как «Anexa nr. 2» внутри акта и как отдельный PDF.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfDoc } from './pdf.js';
import { roTrapKind, roTrapStatus, roPest, roTarget, roCondition, roBait } from './ro.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');
let LOGO = null;
try { LOGO = fs.readFileSync(path.join(ASSETS, 'logo.jpg')); } catch { /* без логотипа */ }

const C = { ink: '#2B2B2B', muted: '#6B6B6B', line: '#2B2B2B', soft: '#F4F4F4', accent: '#F28121', act: '#FBE3E1', warn: '#FFF1D6', ok: '#E8F5EA' };
const TZ = process.env.TZ_DISPLAY || 'Europe/Chisinau';
const dmy = (iso) => (iso ? new Date(iso).toLocaleDateString('ro-RO', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const dm = (iso) => (iso ? new Date(iso).toLocaleDateString('ro-RO', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit' }) : '');
const dmyhm = (iso) => (iso ? new Date(iso).toLocaleString('ro-RO', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const actNo = (v) => (v.act_seq ? String(v.act_seq).padStart(4, '0') : v.id.slice(0, 8).toUpperCase());

const BLOCKED = new Set(['damaged', 'missing', 'no_access']);

/** Короткий код ячейки истории: OK, MP/MT (momeală parțial/total), C3 (capturați 3), D, L, NA, ÎNL. */
function histCode(i) {
  if (!i) return { t: '—', fill: null };
  const cond = i.condition || (BLOCKED.has(i.status) || i.status === 'replaced' ? i.status : '');
  if (cond === 'damaged') return { t: 'D', fill: C.warn };
  if (cond === 'missing') return { t: 'L', fill: C.warn };
  if (cond === 'no_access') return { t: 'NA', fill: C.warn };
  const parts = [];
  if (i.bait_eaten === 'partial') parts.push('MP');
  if (i.bait_eaten === 'full') parts.push('MT');
  if (Number(i.count) > 0) parts.push(`C${i.count}`);
  if (!parts.length && i.status === 'activity') parts.push('A');
  if (parts.length) return { t: parts.join(' '), fill: C.act };
  if (cond === 'replaced') return { t: 'ÎNL', fill: null };
  return { t: 'OK', fill: C.ok };
}

function helpers(d) {
  const M = d.m;
  const CW = d.cw;
  const cellH = (str, w, size, font = 'R', lh = 1.3) => Math.max(1, d.wrap(str || '', size, font, w).length) * size * lh;
  const cellText = (str, x, y, w, { size = 7, font = 'R', color = C.ink, lh = 1.3, align = 'left' } = {}) => {
    d.wrap(str || '', size, font, w).forEach((l, i) => {
      const lx = align === 'center' ? x + (w - d.width(l, size, font)) / 2 : x;
      d.text(l, lx, y + i * size * lh, { size, font, color });
    });
  };
  /** cols: [{w,label,align}], data: [[{t, fill?, bold?} | string]] */
  const table = (cols, data, { size = 7, pad = 4.5 } = {}) => {
    const headRow = cols.map((c) => ({ t: c.label, head: true }));
    const drawRow = (r, isHead) => {
      const cells = r.map((c) => (typeof c === 'string' ? { t: c } : c));
      const h = Math.max(...cells.map((c, i) => cellH(c.t, cols[i].w - pad * 2, size, isHead || c.bold ? 'B' : 'R'))) + pad * 2;
      return { cells, h };
    };
    const head = drawRow(headRow, true);
    const paint = ({ cells, h }, isHead) => {
      let x = M;
      cells.forEach((c, i) => {
        const w = cols[i].w;
        d.rect(x, d.y, w, h, { stroke: C.line, fill: isHead ? C.soft : c.fill || null, width: 0.5 });
        cellText(c.t, x + pad, d.y + pad, w - pad * 2, { size, font: isHead || c.bold ? 'B' : 'R', align: cols[i].align || 'left' });
        x += w;
      });
      d.y += h;
    };
    d.ensure(head.h + 20);
    paint(head, true);
    for (const r of data) {
      const row = drawRow(r, false);
      if (d.y + row.h > d.H - d.m - 18) { d.addPage(); paint(head, true); }
      paint(row, false);
    }
  };
  const heading = (t, size = 10) => {
    d.ensure(80);
    d.y += 12;
    d.text(t, M, d.y, { size, font: 'B', color: C.ink });
    d.y += size + 7;
  };
  return { M, CW, table, heading, cellText, cellH };
}

/**
 * Рисует журнал в документ d (с новой страницы).
 * visit — выезд; rows — станции объекта с результатами этого выезда; history — { visits:[{id,date}], cells:{trapId:{visitId:insp}} }.
 */
export function renderJournal(d, { visit, rows, history, annexTitle = 'ANEXA NR. 2' }) {
  const { M, CW, table, heading } = helpers(d);
  const no = actNo(visit);
  const date = dmy(visit.finished_at || visit.started_at);

  d.addPage();
  if (LOGO) d.image(LOGO, M, d.y, 74, 32, 0, 'contain');
  if (annexTitle) d.textRight(annexTitle, M + CW, d.y + 2, { size: 11, font: 'B' });
  d.textRight(`la procesul-verbal nr. ${no} din ${date}`, M + CW, d.y + (annexTitle ? 18 : 6), { size: 8, color: C.muted });
  d.y += 44;
  d.line(M, d.y, M + CW, d.y, C.accent, 1.4);
  d.y += 12;
  d.text('Jurnal electronic de monitorizare a stațiilor', M, d.y, { size: 12, font: 'B' });
  d.y += 20;

  // сведения
  const info = [
    ['Beneficiar', visit.company_name], ['Adresa obiectului', visit.address],
    ['Data vizitei', dmyhm(visit.finished_at || visit.started_at)], ['Specialist', visit.tech_name],
  ];
  for (const [k, v] of info) {
    d.text(k, M, d.y, { size: 7.5, font: 'B', color: C.muted });
    d.text(v || '—', M + 110, d.y, { size: 8 });
    d.y += 12;
  }
  d.y += 6;

  // сводка
  const checked = rows.filter((r) => r.status);
  const act = checked.filter((r) => r.status === 'activity').length;
  const issues = checked.filter((r) => BLOCKED.has(r.status)).length;
  const boxes = [
    ['Stații total', rows.length], ['Verificate', checked.length], ['Cu activitate', act], ['Probleme', issues],
  ];
  const bw = (CW - 18) / 4;
  boxes.forEach(([label, n], i) => {
    const x = M + i * (bw + 6);
    d.rect(x, d.y, bw, 40, { stroke: C.line, width: 0.5, fill: i === 2 && n ? C.act : i === 3 && n ? C.warn : null });
    d.text(String(n), x + 8, d.y + 8, { size: 15, font: 'B' });
    d.text(label.toUpperCase(), x + 8, d.y + 28, { size: 6, font: 'B', color: C.muted });
  });
  d.y += 52;

  // по назначению
  const byTarget = {};
  for (const r of rows) byTarget[r.target || '—'] = (byTarget[r.target || '—'] || 0) + 1;
  const tLine = Object.entries(byTarget).map(([t, n]) => `${t === '—' ? 'Fără țintă' : roTarget(t)}: ${n}`).join('   ·   ');
  if (tLine) { d.text(tLine, M, d.y, { size: 7.5, color: C.muted }); d.y += 14; }

  // результаты этого обслуживания
  heading('Rezultatele verificării', 10);
  const cols = [
    { w: 24, label: 'Nr.', align: 'center' }, { w: 66, label: 'Țintă' }, { w: 78, label: 'Dispozitiv' }, { w: 92, label: 'Locație' },
    { w: 58, label: 'Stare' }, { w: 70, label: 'Momeală' }, { w: 80, label: 'Captură' },
  ];
  cols.push({ w: CW - cols.reduce((s, c) => s + c.w, 0), label: 'Acțiuni' });
  table(cols, rows.map((r) => {
    const h = histCode(r.status ? r : null);
    const cond = r.condition ? roCondition(r.condition) : r.status ? roTrapStatus(r.status) : 'Neverificată';
    return [
      { t: String(r.number), bold: true }, r.target ? roTarget(r.target) : '—', roTrapKind(r.kind), r.location || '—',
      { t: cond, fill: r.status ? (BLOCKED.has(r.status) ? C.warn : null) : C.soft },
      { t: r.bait_eaten ? roBait(r.bait_eaten) : '—', fill: ['partial', 'full'].includes(r.bait_eaten) ? C.act : null },
      { t: Number(r.count) > 0 ? `${roPest(r.pest || '') || 'dăunător'} × ${r.count}` : r.status ? 'Nimic' : '—', fill: Number(r.count) > 0 ? C.act : null },
      Number(r.bait_replaced) ? 'Momeală / placă înlocuită' : h.t === 'ÎNL' ? 'Stație înlocuită' : '—',
    ];
  }));
  const notes = rows.filter((r) => r.comment);
  if (notes.length) {
    d.y += 8;
    d.text('Observații', M, d.y, { size: 8, font: 'B' });
    d.y += 12;
    for (const r of notes) d.para(`Nr. ${r.number}: ${r.comment}`, { size: 7.5, lh: 1.35, color: C.ink });
  }

  // история
  const hv = history?.visits || [];
  if (hv.length) {
    heading(`Istoric pe obiect (ultimele ${hv.length} vizite)`, 10);
    const lead = [{ w: 24, label: 'Nr.', align: 'center' }, { w: 70, label: 'Țintă' }, { w: 100, label: 'Locație' }];
    const rest = CW - lead.reduce((s, c) => s + c.w, 0);
    const hcols = [...lead, ...hv.map((x) => ({ w: rest / hv.length, label: `${dm(x.date)}${x.id === visit.id ? ' *' : ''}`, align: 'center' }))];
    table(hcols, rows.map((r) => [
      { t: String(r.number), bold: true }, r.target ? roTarget(r.target) : '—', r.location || '—',
      ...hv.map((x) => { const c = histCode(history.cells?.[r.id]?.[x.id]); return { t: c.t, fill: c.fill }; }),
    ]), { size: 7 });
    d.y += 6;
    d.para('Legendă: OK — fără activitate; MP — momeală consumată parțial; MT — momeală consumată integral; C3 — 3 dăunători capturați; '
      + 'D — deteriorată; L — lipsă; NA — fără acces; ÎNL — stație înlocuită; — — neverificată. * — vizita curentă.', { size: 6.8, lh: 1.4, color: C.muted });
  }

  d.ensure(60);
  d.y += 26;
  const half = (CW - 22) / 2;
  d.line(M, d.y, M + half, d.y, '#9A9A9A', 0.6);
  d.line(M + half + 22, d.y, M + CW, d.y, '#9A9A9A', 0.6);
  d.text(`Specialist: ${visit.tech_name}`, M, d.y + 4, { size: 6.5, color: C.muted });
  d.text(`Beneficiar: ${visit.client_rep || ''}`, M + half + 22, d.y + 4, { size: 6.5, color: C.muted });
}

/** Отдельный PDF журнала. */
export function journalPdf({ visit, rows, history }) {
  const d = new PdfDoc({ margin: 36 });
  const no = actNo(visit);
  d.footer = (n, total) => {
    d.text(`Jurnal de monitorizare · proces-verbal nr. ${no} · ${visit.company_name}`.slice(0, 110), d.m, d.H - d.m + 8, { size: 6.5, color: C.muted });
    d.textRight(`pag. ${n} / ${total}`, d.m + d.cw, d.H - d.m + 8, { size: 6.5, color: C.muted });
  };
  renderJournal(d, { visit, rows, history, annexTitle: '' });
  d.pages.shift(); // renderJournal начинает с новой страницы — первая пустая
  return d.toBuffer();
}
