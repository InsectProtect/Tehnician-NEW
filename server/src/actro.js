// PDF по фирменному бланку «Proces de recepție a lucrărilor» (RO) + Anexa nr. 1 с фото и рекомендациями.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfDoc } from './pdf.js';
import { renderJournal } from './journal.js';
import {
  DEFAULT_COMPANY, roProcedure, roPest, roInfestation, roPreparation, roCategory, roTrapKind, roTrapStatus,
} from './ro.js';
import { reentryOf } from './premises.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');
let LOGO = null;
try { LOGO = fs.readFileSync(path.join(ASSETS, 'logo.jpg')); } catch { /* без логотипа */ }
let STAMP = null;
try { STAMP = fs.readFileSync(path.join(ASSETS, 'stamp.jpg')); } catch { /* без печати */ }

const C = { ink: '#2B2B2B', muted: '#6B6B6B', line: '#2B2B2B', soft: '#F4F4F4', accent: '#F28121', red: '#C4291C' };
const TZ = process.env.TZ_DISPLAY || 'Europe/Chisinau';
const dmy = (iso) => (iso ? new Date(iso).toLocaleDateString('ro-RO', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const dmyhm = (iso) => (iso ? new Date(iso).toLocaleString('ro-RO', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export const actNumber = (visit) => (visit.act_seq ? String(visit.act_seq).padStart(4, '0') : visit.id.slice(0, 8).toUpperCase());

/**
 * visit — строка visits (+ act_seq, area, location, client_rep…); client — { inn, legal_address };
 * company — реквизиты исполнителя; products — [строки]; rows — ловушки; observations — [{category, comment, created_at, photos:[Buffer]}];
 * pests — [строки RU]; recs — блоки рекомендаций (RO)
 */
/**
 * parts — какие документы собрать: { proces, anexa } (anexa включает журнал станций);
 * clientSign — JPEG подписи клиента из приложения; stamp — JPEG печати+подписи исполнителя (null — без печати).
 */
export function actRoPdf({ visit, client = {}, company, products = [], rows = [], observations = [], pests = [], recs = [], journal = null,
  parts = { proces: true, anexa: true }, clientSign = null, stamp = STAMP, quick = false }) {
  const d = new PdfDoc({ margin: 36 });
  const M = d.m;
  const CW = d.cw;
  const no = actNumber(visit);
  const date = dmy(visit.finished_at || visit.started_at);

  d.footer = (n, total) => {
    const left = `Proces-verbal nr. ${no} din ${date} · ${visit.company_name}`;
    let l = left;
    while (d.width(l, 6.5) > CW - 80 && l.length > 10) l = `${l.slice(0, -2)}…`;
    d.text(l, M, d.H - M + 8, { size: 6.5, color: C.muted });
    d.textRight(`pag. ${n} / ${total}`, M + CW, d.H - M + 8, { size: 6.5, color: C.muted });
  };

  /** Ячейка с переносом текста. Возвращает высоту строк. */
  const cellText = (str, x, y, w, { size = 7.5, font = 'R', color = C.ink, lh = 1.35, align = 'left' } = {}) => {
    const lines = d.wrap(str || '', size, font, w);
    lines.forEach((l, i) => {
      const lx = align === 'center' ? x + (w - d.width(l, size, font)) / 2 : align === 'right' ? x + w - d.width(l, size, font) : x;
      d.text(l, lx, y + i * size * lh, { size, font, color });
    });
    return Math.max(1, lines.length) * size * lh;
  };
  const cellH = (str, w, size = 7.5, font = 'R', lh = 1.35) => Math.max(1, d.wrap(str || '', size, font, w).length) * size * lh;

  /** Таблица с рамками. cols: [{w, label?, align?}], rows: [[...ячейки]] */
  const table = (cols, data, { head = false, size = 7.5, pad = 6, boldFirst = false, headBold = true } = {}) => {
    const all = head ? [cols.map((c) => c.label), ...data] : data;
    all.forEach((r, ri) => {
      const isHead = head && ri === 0;
      const h = Math.max(...r.map((v, i) => cellH(v, cols[i].w - pad * 2, size, isHead || (boldFirst && i === 0) || cols[i].bold ? 'B' : 'R'))) + pad * 2;
      d.ensure(h);
      let x = M;
      r.forEach((v, i) => {
        const w = cols[i].w;
        if (isHead) d.rect(x, d.y, w, h, { fill: C.soft, stroke: C.line });
        else d.rect(x, d.y, w, h, { stroke: C.line });
        const bold = (isHead && headBold) || (boldFirst && i === 0) || cols[i].bold;
        cellText(v, x + pad, d.y + pad, w - pad * 2, { size, font: bold ? 'B' : 'R', align: isHead ? (cols[i].align || 'left') : cols[i].align || 'left' });
        x += w;
      });
      d.y += h;
    });
  };

  const heading = (t, size = 10) => {
    d.ensure(90); // заголовок не остаётся один внизу страницы
    d.y += 12;
    d.text(t, M, d.y, { size, font: 'B', color: C.ink });
    d.y += size + 7;
  };

  /** Замечания с фото — используется и в Anexa nr. 1 полного акта, и в приложении к быстрому акту. */
  const renderObsBlock = () => {
    heading('Constatări și fotografii', 11);
    const gap = 6;
    const pw = (CW - gap * 2) / 3;
    const ph = pw * 0.75;
    for (const o of observations) {
      const title = roCategory(o.category);
      const commentH = o.comment ? d.measure(o.comment, { w: CW - 20, size: 8.5, lh: 1.4 }) : 0;
      const blockH = 26 + commentH + (o.photos.length ? ph + gap : 0);
      d.ensure(Math.min(blockH, 360));
      const top = d.y;
      d.rect(M, top, CW, 22 + commentH + (o.comment ? 4 : 0), { fill: C.soft, stroke: null });
      d.rect(M, top, 3, 22 + commentH + (o.comment ? 4 : 0), { fill: C.accent, stroke: null });
      d.text(title, M + 10, top + 7, { size: 9, font: 'B' });
      d.textRight(dmyhm(o.created_at), M + CW - 8, top + 8, { size: 7, color: C.muted });
      d.y = top + 22;
      if (o.comment) d.para(o.comment, { x: M + 10, w: CW - 20, size: 8.5, lh: 1.4, color: C.ink });
      d.y += 6;
      for (let i = 0; i < o.photos.length; i += 3) {
        d.ensure(ph + gap);
        o.photos.slice(i, i + 3).forEach((buf, j) => d.image(buf, M + j * (pw + gap), d.y, pw, ph, 2));
        d.y += ph + gap;
      }
      d.y += 8;
    }
  };

  /** Простая таблица ловушек (когда нет полного журнала истории) — тоже общая для обоих актов. */
  const renderTrapRows = () => {
    heading('Capcane și stații de monitorizare', 11);
    table(
      [
        { w: 26, label: 'Nr.', align: 'center' }, { w: 128, label: 'Tip' }, { w: 120, label: 'Locație' },
        { w: 84, label: 'Stare' }, { w: 90, label: 'Dăunător / nr.' }, { w: CW - 26 - 128 - 120 - 84 - 90, label: 'Momeală' },
      ],
      rows.map((r) => [
        String(r.number), roTrapKind(r.kind), r.location || '—', r.status ? roTrapStatus(r.status) : 'Neverificată',
        r.status === 'activity' ? `${roPest(r.pest || '') || '—'}${Number(r.count) ? ` × ${r.count}` : ''}` : '',
        Number(r.bait_replaced) ? 'Înlocuită' : '',
      ]),
      { head: true, size: 7.2, pad: 5 },
    );
  };

  // ================= Быстрый акт: одна страница — адрес, вредители, подписи =================
  if (quick) {
    d.footer = (n, total) => {
      d.text(`Act nr. ${no} din ${date} · ${visit.company_name}`.slice(0, 110), M, d.H - M + 8, { size: 6.5, color: C.muted });
      d.textRight(`pag. ${n} / ${total}`, M + CW, d.H - M + 8, { size: 6.5, color: C.muted });
    };
    if (LOGO) d.image(LOGO, M, d.y, 90, 38, 0, 'contain');
    d.textRight(company.name || '', M + CW, d.y + 2, { size: 9, font: 'B' });
    d.textRight([company.fiscal && `IDNO ${company.fiscal}`, company.seat].filter(Boolean).join(' · '), M + CW, d.y + 15, { size: 7, color: C.muted });
    d.textRight(company.tagline || '', M + CW, d.y + 26, { size: 7, color: C.accent, font: 'B' });
    d.y += 52;
    d.line(M, d.y, M + CW, d.y, C.accent, 1.4);
    d.y += 18;
    d.text(`ACT DE EXECUTARE A LUCRĂRILOR nr. ${no}`, M, d.y, { size: 14, font: 'B' });
    d.y += 20;
    d.text(`din ${date}`, M, d.y, { size: 9, color: C.muted });
    d.y += 20;
    const info = [
      ['Beneficiar', visit.company_name],
      ['Adresa obiectului', visit.address],
      ['Serviciu', roProcedure(visit.procedure)],
      ['Dăunători', pests.length ? pests.map(roPest).join(', ') : '—'],
      ['Data și ora', dmyhm(visit.finished_at || visit.started_at)],
      ['Specialist', visit.tech_name],
    ];
    const re = reentryOf(visit.reentry)?.ro;
    if (re) info.push(['Nu se intră în încăpere', re]);
    if (visit.comment) info.push(['Mențiuni', visit.comment]);
    table([{ w: 150, bold: true }, { w: CW - 150 }], info, { size: 9, pad: 8 });
    d.y += 16;
    d.para('Lucrările de dezinsecție / deratizare / dezinfecție au fost executate la adresa indicată. Beneficiarul a fost informat despre măsurile de siguranță și recomandările post-tratament, confirmă executarea lucrărilor și nu are obiecții privind calitatea și cantitatea serviciilor prestate.',
      { size: 8.2, lh: 1.45, color: C.ink });
    d.ensure(110);
    d.y += 78;
    const half = (CW - 22) / 2;
    if (stamp) d.image(stamp, M + half - 130, d.y - 66, 130, 60, 0, 'contain');
    if (clientSign) d.image(clientSign, M + CW - 125, d.y - 60, 125, 56, 0, 'contain');
    d.line(M, d.y, M + half, d.y, '#9A9A9A', 0.6);
    d.line(M + half + 22, d.y, M + CW, d.y, '#9A9A9A', 0.6);
    d.text(`Prestator: ${company.name || ''} · ${visit.tech_name}`, M, d.y + 4, { size: 6.8, color: C.muted });
    d.text(`Beneficiar: ${visit.client_rep || ''}`, M + half + 22, d.y + 4, { size: 6.8, color: C.muted });

    // Приложение к быстрому акту: замечания с фото и/или журнал ловушек, если они были и не отключены специалистом
    const wantObs = parts.obs !== false && observations.length > 0;
    const wantTrapsTable = parts.traps !== false && rows.length > 0 && !journal;
    const wantJournal = parts.traps !== false && Boolean(journal);
    if (wantObs || wantTrapsTable) {
      d.addPage();
      if (LOGO) d.image(LOGO, M, d.y, 74, 32, 0, 'contain');
      d.textRight('ANEXĂ', M + CW, d.y + 2, { size: 11, font: 'B' });
      d.textRight(`la actul nr. ${no} din ${date}`, M + CW, d.y + 18, { size: 8, color: C.muted });
      d.y += 44;
      d.line(M, d.y, M + CW, d.y, C.accent, 1.4);
      d.y += 12;
      if (wantObs) renderObsBlock();
      if (wantTrapsTable) renderTrapRows();
    }
    if (wantJournal) renderJournal(d, { visit, rows, history: journal, annexTitle: wantObs || wantTrapsTable ? 'ANEXA NR. 2' : 'ANEXA NR. 1' });
    return d.toBuffer();
  }

  // ================= Страница 1: Proces de recepție =================

  const hasAnnex = true; // Anexa nr. 1 всегда есть: в ней обязательная «Declarația beneficiarului»
  if (parts.proces) {
  // шапка
  const hh = 78;
  d.rect(M, d.y, CW, hh, { stroke: C.line, width: 0.9 });
  if (LOGO) d.image(LOGO, M + 14, d.y + 10, 118, 51, 0, 'contain');
  d.text(company.tagline || '', M + 14, d.y + hh - 16, { size: 6.2, color: C.muted });
  d.textRight('PROCES DE RECEPȚIE', M + CW - 16, d.y + 25, { size: 13, font: 'B' });
  d.textRight('A LUCRĂRILOR', M + CW - 16, d.y + 42, { size: 13, font: 'B' });
  d.y += hh + 12;

  // номер / дата / населённый пункт
  const third = CW / 3;
  const infoCells = [['NR. PROCES-VERBAL', no], ['DATA', date], ['LOCALITATE', visit.locality || '']];
  const infoH = 38;
  infoCells.forEach(([label, value], i) => {
    const x = M + i * third;
    d.rect(x, d.y, third, infoH, { stroke: C.line });
    d.text(label, x + 8, d.y + 7, { size: 6.3, font: 'B' });
    cellText(value, x + 8, d.y + 19, third - 16, { size: 8.5, font: 'B' });
  });
  d.y += infoH + 16;

  // Prestator / Beneficiar
  const colW = (CW - 22) / 2;
  const kw = 72;
  const side = (x, title, pairs) => {
    let y = d.y;
    d.text(title, x, y, { size: 6.3, font: 'B', color: C.muted });
    y += 12;
    for (const [k, v] of pairs) {
      const h = Math.max(cellH(k, kw - 12, 7, 'B'), cellH(v, colW - kw - 12, 7.2)) + 10;
      d.rect(x, y, kw, h, { stroke: C.line });
      d.rect(x + kw, y, colW - kw, h, { stroke: C.line });
      cellText(k, x + 6, y + 5, kw - 12, { size: 7, font: 'B' });
      cellText(v, x + kw + 6, y + 5, colW - kw - 12, { size: 7.2 });
      y += h;
    }
    return y;
  };
  const yA = side(M, 'PRESTATOR', [
    ['Denumirea', company.name], ['Cod fiscal', company.fiscal], ['Sediul', company.seat], ['Reprezentant', company.rep], ['Funcția', company.func],
  ]);
  const yB = side(M + colW + 22, 'BENEFICIAR', [
    ['Denumirea', visit.company_name], ['Cod fiscal', client.inn || ''], ['Adresa juridică', client.legal_address || ''],
    ['Reprezentant', visit.client_rep || ''], ['Funcția', visit.client_rep_function || ''],
  ]);
  d.y = Math.max(yA, yB) + 6;

  // Lucrări efectuate
  heading('Lucrări efectuate');
  const service = roProcedure(visit.procedure) + (pests.length ? ` (${pests.map(roPest).join(', ')})` : '');
  table(
    [{ w: 34, label: 'Nr.', align: 'center' }, { w: 150, label: 'Serviciu' }, { w: CW - 34 - 150 - 60, label: 'Locație' }, { w: 60, label: 'M²', align: 'center' }],
    [['1', service, [visit.location, visit.address].filter(Boolean).join(' — '), visit.area || '']],
    { head: true },
  );
  d.y += 5;
  d.text(`Executant: ${visit.tech_name}`, M, d.y, { size: 6.8, color: C.muted });
  d.y += 8;

  // Produse utilizate
  heading('Produse utilizate');
  const cur = roProcedure(visit.procedure);
  const prodRow = (label) => [label, cur === label ? products.join(', ') || '—' : '—'];
  table([{ w: 100, bold: true }, { w: CW - 100 }], [prodRow('Dezinsecție'), prodRow('Deratizare'), prodRow('Dezinfecție')]);

  // Declarații
  heading('Declarații și obligații');
  d.para(company.declarations || '', { size: 6.6, font: 'B', color: C.ink, lh: 1.42 });

  if (hasAnnex) {
    d.y += 4;
    d.para(journal
      ? 'Anexa nr. 1 (raport de inspecție, fotografii și recomandări) și Anexa nr. 2 (jurnalul electronic de monitorizare a stațiilor) sunt parte integrantă a prezentului proces-verbal.'
      : 'Anexa nr. 1 (raport de inspecție, fotografii și recomandări) este parte integrantă a prezentului proces-verbal.', { size: 6.6, color: C.muted });
  }

  // Act de recepție finală
  d.y += 10;
  const boxText = 'Prezentul proces-verbal reprezintă act de recepție finală și face dovada îndeplinirii obligațiilor contractuale de către Prestator.';
  const boxH = 22 + cellH(boxText, CW - 24, 7, 'B') + 8;
  d.ensure(boxH + 90);
  d.rect(M, d.y, CW, boxH, { stroke: C.line, width: 0.9 });
  d.text('ACT DE RECEPȚIE FINALĂ', M + 12, d.y + 9, { size: 10, font: 'B' });
  cellText(boxText, M + 12, d.y + 24, CW - 24, { size: 7, font: 'B' });
  d.y += boxH + 22;

  // подписи
  const sig = (x, title, who, img, imgW, imgH) => {
    d.text(title, x, d.y, { size: 6.3, font: 'B', color: C.muted });
    cellText(who, x, d.y + 16, colW - (img ? imgW * 0.55 : 0), { size: 7.5, font: 'B' });
    if (img) d.image(img, x + colW - imgW, d.y + 12, imgW, imgH, 0, 'contain');
    d.line(x, d.y + 82, x + colW, d.y + 82, '#9A9A9A', 0.6);
    d.text('semnătura / ștampila', x, d.y + 86, { size: 6, color: C.muted });
  };
  d.ensure(104);
  sig(M, 'PRESTATOR', `${company.name} — ${company.rep}`, stamp, 150, 69);
  sig(M + colW + 22, 'BENEFICIAR', [visit.company_name, visit.client_rep].filter(Boolean).join(' - '), clientSign, 130, 62);
  d.y += 102;
  }

  // пустую первую страницу (если Proces-verbal не выбран) убираем перед сборкой
  const finish = () => {
    if (d.pages.length > 1 && !d.pages[0].ops.length) d.pages.shift();
    return d.toBuffer();
  };
  if (!parts.anexa) return finish();

  // ================= Anexa nr. 1 =================
  if (!hasAnnex) {
    if (journal) renderJournal(d, { visit, rows, history: journal, annexTitle: 'ANEXA NR. 1' });
    return finish();
  }

  if (parts.proces) d.addPage();
  if (LOGO) d.image(LOGO, M, d.y, 74, 32, 0, 'contain');
  d.textRight(`ANEXA NR. 1`, M + CW, d.y + 2, { size: 11, font: 'B' });
  d.textRight(`la procesul-verbal nr. ${no} din ${date}`, M + CW, d.y + 18, { size: 8, color: C.muted });
  d.y += 44;
  d.line(M, d.y, M + CW, d.y, C.accent, 1.4);
  d.y += 12;
  d.text('Raport de inspecție, fotografii și recomandări', M, d.y, { size: 12, font: 'B' });
  d.y += 22;

  const info = [
    ['Beneficiar', visit.company_name],
    ['Adresa obiectului', visit.address],
    ['Serviciu', roProcedure(visit.procedure)],
    ['Specialist', visit.tech_name],
    ['Data și ora', dmyhm(visit.finished_at || visit.started_at)],
  ];
  if (pests.length) info.push(['Dăunători', pests.map(roPest).join(', ')]);
  if (visit.infestation) info.push(['Gradul de infestare', roInfestation(visit.infestation)]);
  if (visit.preparation) info.push(['Pregătirea spațiului', roPreparation(visit.preparation)]);
  table([{ w: 130, bold: true }, { w: CW - 130 }], info, { size: 8 });

  // Замечания и фото
  if (observations.length) renderObsBlock();

  // Ловушки (если ведётся журнал станций — он идёт отдельным приложением)
  if (rows.length && !journal) renderTrapRows();

  // Рекомендации
  if (recs.length) {
    heading('Recomandări pentru beneficiar', 11);
    for (const b of recs) {
      d.ensure(40);
      if (b.accent) {
        const itemsH = b.items.reduce((s, it) => s + d.measure(it, { w: CW - 36, size: 8, lh: 1.4 }) + 2, 0);
        const h = 24 + itemsH + 6;
        d.rect(M, d.y, CW, h, { fill: '#FDF0E6', stroke: null });
        d.rect(M, d.y, 3, h, { fill: C.accent, stroke: null });
        d.text(b.title.toUpperCase(), M + 12, d.y + 8, { size: 8, font: 'B', color: C.accent });
        d.y += 24;
        for (const it of b.items) { d.text('•', M + 14, d.y, { size: 8 }); d.para(it, { x: M + 24, w: CW - 36, size: 8, lh: 1.4, color: C.ink }); d.y += 2; }
        d.y += 10;
        continue;
      }
      d.text(b.title, M, d.y, { size: 8.8, font: 'B' });
      d.y += 14;
      for (const it of b.items) {
        d.ensure(12);
        d.text('•', M + 2, d.y, { size: 8, color: C.accent });
        d.para(it, { x: M + 12, w: CW - 12, size: 8, lh: 1.4, color: C.ink });
        d.y += 2;
      }
      d.y += 6;
    }
  }

  if (visit.comment) {
    heading('Concluzia specialistului', 11);
    d.para(visit.comment, { size: 8.8, lh: 1.45, color: C.ink });
  }

  // Обязательная декларация клиента — прямо над подписями, на одной странице с ними
  const declItems = String(company.annex_declaration || DEFAULT_COMPANY.annex_declaration || '')
    .replace(/\{ore\}/g, reentryOf(visit.reentry)?.ro || visit.reentry || '4–6 ore')
    .split(/\n+/).map((x) => x.trim()).filter(Boolean);
  if (declItems.length) {
    const itemsH = declItems.reduce((s, it) => s + d.measure(it, { w: CW - 38, size: 7.8, lh: 1.4 }) + 3, 0);
    const boxH = 40 + itemsH + 8;
    d.ensure(boxH + 110);
    d.y += 8;
    const top = d.y;
    d.rect(M, top, CW, boxH, { fill: C.soft, stroke: null });
    d.rect(M, top, 3, boxH, { fill: C.accent, stroke: null });
    d.text('DECLARAȚIA BENEFICIARULUI', M + 12, top + 9, { size: 8.6, font: 'B' });
    d.text('Prin semnarea prezentei anexe, Beneficiarul declară pe propria răspundere că:', M + 12, top + 23, { size: 7.4, color: C.muted });
    d.y = top + 38;
    declItems.forEach((it, i) => {
      d.text(`${i + 1}.`, M + 12, d.y, { size: 7.8, font: 'B' });
      d.para(it, { x: M + 26, w: CW - 38, size: 7.8, lh: 1.4, color: C.ink });
      d.y += 3;
    });
    d.y = top + boxH;
  }

  d.ensure(100);
  d.y += 66;
  const half = (CW - 22) / 2;
  if (stamp) d.image(stamp, M + half - 120, d.y - 58, 120, 55, 0, 'contain');
  if (clientSign) d.image(clientSign, M + CW - 120, d.y - 56, 120, 52, 0, 'contain');
  d.line(M, d.y, M + half, d.y, '#9A9A9A', 0.6);
  d.line(M + half + 22, d.y, M + CW, d.y, '#9A9A9A', 0.6);
  d.text(`Specialist: ${visit.tech_name}`, M, d.y + 4, { size: 6.5, color: C.muted });
  d.text(`Beneficiar: ${visit.client_rep || ''}`, M + half + 22, d.y + 4, { size: 6.5, color: C.muted });

  if (journal) renderJournal(d, { visit, rows, history: journal, annexTitle: 'ANEXA NR. 2' });
  return finish();
}
