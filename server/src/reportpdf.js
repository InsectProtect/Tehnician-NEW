// PDF-акт выезда: реквизиты, оценка, замечания с фото, ловушки, рекомендации заказчику.
import { PdfDoc } from './pdf.js';
import { statusLabel } from './config.js';

const C = { ink: '#1D1D1F', muted: '#6E6E73', card: '#F5F5F7', line: '#E5E5EA', accent: '#0066CC', red: '#D70015', orange: '#C93400', green: '#248A3D', redBg: '#FDECEC' };
const TZ = process.env.TZ_DISPLAY || 'Europe/Moscow';
export const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtShort = (iso) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

const statusColor = (s) => (s === 'ok' ? C.green : s === 'activity' ? C.red : s === 'damaged' || s === 'missing' ? C.orange : s ? C.accent : C.muted);

/**
 * visit — строка visits; rows — ловушки с осмотрами; observations — [{category, comment, created_at, photos: [Buffer]}];
 * assessment — { infestation, preparation } (подписи); pests — [строки]; recs — [{title, items, accent}]
 */
export function visitPdf({ visit, rows, observations, assessment, pests, recs, brand }) {
  const d = new PdfDoc({ margin: 42 });
  const M = d.m;
  const CW = d.cw;
  const actNo = visit.id.slice(0, 8).toUpperCase();

  d.footer = (n, total) => {
    const left = `${brand ? `${brand} · ` : ''}Акт № ${actNo} · ${visit.company_name}`;
    const right = `стр. ${n} из ${total}`;
    const leftMax = CW - d.width(right, 7.5) - 20;
    let l = left;
    while (d.width(l, 7.5) > leftMax && l.length > 10) l = `${l.slice(0, -2)}…`;
    d.text(l, M, d.H - M + 6, { size: 7.5, color: C.muted });
    d.text(right, M + CW - d.width(right, 7.5), d.H - M + 6, { size: 7.5, color: C.muted });
  };

  // ---------- шапка ----------
  if (brand) d.text(brand, M, d.y, { size: 10, font: 'B', color: C.accent });
  const no = `Акт № ${actNo}`;
  d.text(no, M + CW - d.width(no, 9), d.y + 1, { size: 9, color: C.muted });
  d.y += brand ? 26 : 18;
  d.text('АКТ ВЫПОЛНЕННЫХ РАБОТ', M, d.y, { size: 8, font: 'B', color: C.muted });
  d.y += 14;
  d.para(visit.company_name, { size: 20, font: 'B', lh: 1.2 });
  d.y += 2;
  d.para(visit.address, { size: 10.5, color: C.muted });
  d.y += 14;

  // ---------- карточки ----------
  const cards = [
    ['Обработка', visit.procedure],
    ['Дата и время', fmtDateTime(visit.finished_at || visit.started_at)],
    ['Специалист', visit.tech_name],
  ];
  if (pests.length) cards.push(['Вредители', pests.join(', ')]);
  if (assessment.infestation) cards.push(['Степень заселённости', assessment.infestation, ['Высокая', 'Критическая'].includes(assessment.infestation) ? C.red : null]);
  if (assessment.preparation) cards.push(['Подготовка помещения', assessment.preparation, assessment.preparation !== 'Выполнена' ? C.orange : null]);
  if (rows.length) {
    const checked = rows.filter((r) => r.status);
    cards.push(['Проверено ловушек', `${checked.length} из ${rows.length}`]);
    const act = checked.filter((r) => r.status === 'activity');
    cards.push(['С активностью', String(act.length), act.length ? C.red : null]);
  }
  const gap = 8;
  const cwCard = (CW - gap * 2) / 3;
  for (let i = 0; i < cards.length; i += 3) {
    const row = cards.slice(i, i + 3);
    const h = Math.max(...row.map(([, v]) => d.measure(v, { w: cwCard - 20, size: 10.5, font: 'B', lh: 1.3 }))) + 32;
    d.ensure(h);
    row.forEach(([label, value, color], j) => {
      const x = M + j * (cwCard + gap);
      d.roundRect(x, d.y, cwCard, h, 8, C.card);
      d.text(label.toUpperCase(), x + 10, d.y + 10, { size: 6.8, font: 'B', color: C.muted });
      const lines = d.wrap(value, 10.5, 'B', cwCard - 20);
      lines.forEach((l, k) => d.text(l, x + 10, d.y + 22 + k * 13.65, { size: 10.5, font: 'B', color: color || C.ink }));
    });
    d.y += h + gap;
  }

  const section = (title) => {
    d.ensure(60);
    d.y += 16;
    d.text(title, M, d.y, { size: 13.5, font: 'B' });
    d.y += 24;
  };

  // ---------- замечания и фото ----------
  if (observations.length) {
    section('Замечания и фотофиксация');
    for (const o of observations) {
      const commentH = o.comment ? d.measure(o.comment, { w: CW - 24, size: 10 }) : 0;
      const h = 34 + commentH + (o.comment ? 4 : 0);
      const firstRow = o.photos.length ? ((CW - gap * 2) / 3) * 0.75 + gap + 8 : 0;
      d.ensure(Math.min(h + firstRow, 420)); // карточка не отрывается от первого ряда фото
      const top = d.y;
      if (h < d.H - d.m * 2) d.roundRect(M, top, CW, h, 8, C.card);
      d.text(o.category, M + 12, top + 11, { size: 11, font: 'B' });
      const t = fmtShort(o.created_at);
      d.text(t, M + CW - 12 - d.width(t, 8), top + 13, { size: 8, color: C.muted });
      d.y = top + 30;
      if (o.comment) d.para(o.comment, { x: M + 12, w: CW - 24, size: 10 });
      d.y = Math.max(d.y, top + h) + 8;
      if (o.photos.length) {
        const pw = (CW - gap * 2) / 3;
        const ph = pw * 0.75;
        for (let i = 0; i < o.photos.length; i += 3) {
          d.ensure(ph);
          o.photos.slice(i, i + 3).forEach((buf, j) => d.image(buf, M + j * (pw + gap), d.y, pw, ph, 6));
          d.y += ph + gap;
        }
      }
      d.y += 6;
    }
  }

  // ---------- ловушки ----------
  if (rows.length) {
    section('Ловушки');
    const cols = [
      ['№', 22], ['Тип', 120], ['Место', 112], ['Состояние', 84], ['Вредитель', 88], ['Приманка', CW - 22 - 120 - 112 - 84 - 88],
    ];
    const drawHead = () => {
      let x = M;
      cols.forEach(([t, w]) => { d.text(t, x, d.y, { size: 7.5, font: 'B', color: C.muted }); x += w; });
      d.y += 13;
      d.line(M, d.y, M + CW, d.y, C.line);
      d.y += 5;
    };
    drawHead();
    for (const r of rows) {
      const cells = [
        String(r.number),
        r.kind,
        r.location || '—',
        r.status ? statusLabel(r.status) : 'Не проверена',
        r.status === 'activity' ? `${r.pest || '—'}${Number(r.count) ? ` × ${r.count}` : ''}` : '',
        Number(r.bait_replaced) ? 'Заменена' : '',
      ];
      const lines = cells.map((c, i) => d.wrap(c, 8.8, i === 0 ? 'B' : 'R', cols[i][1] - 8));
      const h = Math.max(...lines.map((l) => l.length)) * 12 + 6;
      if (d.y + h > d.H - d.m - 18) { d.addPage(); drawHead(); }
      let x = M;
      lines.forEach((ls, i) => {
        ls.forEach((l, k) => d.text(l, x, d.y + k * 12, { size: 8.8, font: i === 0 || i === 3 ? 'B' : 'R', color: i === 3 ? statusColor(r.status) : C.ink }));
        x += cols[i][1];
      });
      d.y += h;
      d.line(M, d.y - 3, M + CW, d.y - 3, C.line, 0.4);
      d.y += 2;
    }
  }

  // ---------- рекомендации ----------
  if (recs.length) {
    section('Рекомендации заказчику');
    for (const b of recs) {
      const itemsH = b.items.reduce((s, it) => s + d.measure(it, { w: CW - 38, size: 9.5 }) + 3, 0);
      const h = 26 + itemsH + 6;
      d.ensure(Math.min(h, 160));
      if (b.accent && h < 400) d.roundRect(M, d.y, CW, h, 8, C.redBg);
      const px = b.accent ? M + 12 : M;
      d.text(b.title, px, d.y + (b.accent ? 10 : 0), { size: 10.5, font: 'B', color: b.accent ? C.red : C.ink });
      d.y += b.accent ? 28 : 18;
      for (const it of b.items) {
        d.ensure(14);
        d.text('•', px + 2, d.y, { size: 9.5, color: b.accent ? C.red : C.accent });
        d.para(it, { x: px + 14, w: CW - (px - M) - 26, size: 9.5 });
        d.y += 3;
      }
      d.y += b.accent ? 12 : 8;
    }
  }

  // ---------- заключение и подписи ----------
  if (visit.comment) {
    section('Заключение специалиста');
    d.para(visit.comment, { size: 10.5 });
  }
  d.ensure(80);
  d.y += 44;
  const half = (CW - 40) / 2;
  d.line(M, d.y, M + half, d.y, C.ink, 0.6);
  d.line(M + half + 40, d.y, M + CW, d.y, C.ink, 0.6);
  d.text(`Исполнитель: ${visit.tech_name}`, M, d.y + 5, { size: 8, color: C.muted });
  d.text('Представитель заказчика', M + half + 40, d.y + 5, { size: 8, color: C.muted });

  return d.toBuffer();
}
