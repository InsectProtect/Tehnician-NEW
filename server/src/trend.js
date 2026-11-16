// v99: Analiza de tendință — анализ тенденций по станциям мониторинга объекта за период (RO PDF).
// Данные: осмотры (inspections) завершённых выездов объекта; зона станции — traps.zone или угадывается.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfDoc } from './pdf.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');
let LOGO = null;
try { LOGO = fs.readFileSync(path.join(ASSETS, 'logo.jpg')); } catch { /* без логотипа */ }

const TZ = process.env.TZ_DISPLAY || 'Europe/Chisinau';
const RODENTICIDE = 'Родентицидная станция';
export const ZONES = ['exterior', 'interior', 'depozit'];
export const ZONE_RO = { exterior: 'Exterior', interior: 'Interior', depozit: 'Depozit' };
const MONTHS_RO = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'noi', 'dec'];
const MONTHS_RO_FULL = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
/** Пороги по умолчанию: доля станций с активностью, выше которой нужна реакция. */
export const DEFAULT_TREND = { thr: { exterior: 0.3, interior: 0, depozit: 0.1 } };

const C = {
  ink: '#1D1D1F', muted: '#6B6B6B', line: '#E3DDD5', soft: '#FAF7F3', accent: '#F27B21', accentDark: '#C9600F',
  dark: '#111111', c25: '#FBD7B8', c50: '#F6A86A', c100: '#E2671B', fa: '#FFE08A', nl: '#E3E0DB', empty: '#F1EEE9',
  red: '#F4B6B0', redInk: '#8B1A1A', amber: '#FBC59A', grey: '#9A9A9A',
};

/** Зона станции: явная (traps.zone) или по подписи/месту/устройству. */
export function zoneOf(t) {
  if (ZONES.includes(t.zone)) return t.zone;
  const s = `${t.location || ''} ${t.label || ''}`.toLowerCase();
  if (/(depozit|склад|рамп|rampă|rampa|recep[țt]i|приёмк|приемк)/.test(s)) return 'depozit';
  if (/(exterior|afar|perimetr|периметр|снаруж|улиц|двор|gard|забор|ограж|fasad|фасад|curte)/.test(s)) return 'exterior';
  if (/(interior|внутр|кухн|buc[ăa]t|зал|sal[ăa]|офис|birou)/.test(s)) return 'interior';
  return t.kind === RODENTICIDE ? 'exterior' : 'interior';
}

const ym = (iso) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).formatToParts(new Date(iso));
  return `${p.find((x) => x.type === 'year').value}-${p.find((x) => x.type === 'month').value}`;
};
/** Список месяцев 'YYYY-MM' от from до to включительно (не больше 24). */
export function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 24) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
const mLabel = (k) => MONTHS_RO[Number(k.slice(5)) - 1];
const mFull = (k) => `${MONTHS_RO_FULL[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

const BLOCKED = new Set(['no_access']);
const condOf = (i) => i.condition || (['damaged', 'missing', 'no_access', 'replaced'].includes(i.status) ? i.status : '');
const isActive = (i) => i.bait_eaten === 'partial' || i.bait_eaten === 'full' || Number(i.count) > 0 || (!i.condition && i.status === 'activity');
const baitPct = (i) => (i.bait_eaten === 'full' ? 100 : i.bait_eaten === 'partial' ? 50 : 0);

/**
 * Собирает данные анализа. db — общий адаптер; objectId; from/to — 'YYYY-MM'.
 * Возвращает всё, что нужно и для PDF, и для JSON.
 */
export async function trendData(db, { objectId, from, to, cfg = DEFAULT_TREND }) {
  const [obj] = await db.query('SELECT * FROM objects WHERE id = $1', [objectId]);
  if (!obj) return null;
  const months = monthsBetween(from, to);
  const traps = await db.query(
    `SELECT id, number, kind, target, location, label, zone, active, prepared FROM traps
      WHERE object_id = $1 AND COALESCE(prepared, 0) = 0 ORDER BY number, created_at`, [objectId]);
  const visits = await db.query(
    `SELECT id, finished_at, started_at, tech_name FROM visits WHERE object_id = $1 AND status = 'done'
      ORDER BY COALESCE(finished_at, started_at)`, [objectId]);
  const inRange = visits.filter((v) => { const k = ym(v.finished_at || v.started_at); return k >= months[0] && k <= months[months.length - 1]; });
  const ids = inRange.map((v) => v.id);
  const insp = ids.length
    ? await db.query(`SELECT visit_id, trap_id, status, condition, bait_eaten, count, pest, bait_replaced FROM inspections WHERE visit_id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`, ids)
    : [];
  const vMonth = Object.fromEntries(inRange.map((v) => [v.id, ym(v.finished_at || v.started_at)]));

  // станции: активные + неактивные, но с осмотрами в периоде
  const seen = new Set(insp.map((i) => i.trap_id));
  const st = traps.filter((t) => Number(t.active) === 1 || seen.has(t.id)).map((t) => ({
    id: t.id, n: Number(t.number), kind: t.kind, target: t.target || '', location: t.location || '', zone: zoneOf(t), zoneSet: ZONES.includes(t.zone),
    cells: {}, // month -> {checked, active, bait, count, na, nl}
  }));
  const byId = Object.fromEntries(st.map((s) => [s.id, s]));
  for (const i of insp) {
    const s = byId[i.trap_id]; if (!s) continue;
    const k = vMonth[i.visit_id];
    const c = s.cells[k] || (s.cells[k] = { visits: 0, checked: 0, active: 0, bait: 0, count: 0, na: 0, nl: 0 });
    const cond = condOf(i);
    c.visits += 1;
    if (BLOCKED.has(cond)) { c.na += 1; continue; }
    c.checked += 1;
    if (isActive(i)) c.active += 1;
    c.bait = Math.max(c.bait, baitPct(i));
    c.count += Number(i.count) || 0;
    if (cond === 'damaged' || cond === 'missing' || cond === 'replaced') c.nl += 1;
  }

  // помесячно по зонам (единица — станция в месяце: проверена хотя бы раз / была активность хотя бы раз)
  const zones = ZONES.filter((z) => st.some((s) => s.zone === z));
  const series = {};
  for (const z of [...zones, 'total']) {
    series[z] = months.map((k) => {
      const list = st.filter((s) => (z === 'total' || s.zone === z));
      let checked = 0; let active = 0; let count = 0; let na = 0; let nl = 0;
      for (const s of list) {
        const c = s.cells[k]; if (!c) continue;
        if (c.checked) checked += 1; else if (c.na) na += 1;
        if (c.active) active += 1;
        count += c.count; nl += c.nl;
      }
      return { k, checked, active, idx: checked ? active / checked : null, count, na, nl };
    });
  }
  const sum = (z, f) => series[z].reduce((a, r) => a + r[f], 0);
  const year = Object.fromEntries([...zones, 'total'].map((z) => {
    const checked = sum(z, 'checked'); const active = sum(z, 'active');
    return [z, { checked, active, idx: checked ? active / checked : null, count: sum(z, 'count'), na: sum(z, 'na'), nl: sum(z, 'nl') }];
  }));

  // точки внимания по станциям
  const monthsWithData = months.filter((k) => st.some((s) => s.cells[k]?.checked)).length;
  for (const s of st) {
    const cs = Object.values(s.cells);
    s.actMonths = months.filter((k) => s.cells[k]?.active).length;
    s.capt = cs.reduce((a, c) => a + c.count, 0);
    s.capMonths = months.filter((k) => s.cells[k]?.count).length;
    s.naMonths = months.filter((k) => s.cells[k]?.na && !s.cells[k]?.checked).length;
    s.nl = cs.reduce((a, c) => a + c.nl, 0);
    const hotExt = s.zone === 'exterior' && monthsWithData >= 3 && s.actMonths >= Math.max(3, Math.ceil(monthsWithData * 0.66));
    const hotIn = s.zone !== 'exterior' && (s.capMonths >= 2 || s.capt >= 3);
    s.status = hotExt || hotIn ? 'critic' : s.naMonths >= 2 ? 'acces' : s.capt > 0 ? 'capturi' : '';
  }
  const thr = { ...DEFAULT_TREND.thr, ...(cfg?.thr || {}) };
  return {
    object: obj, months, from: months[0], to: months[months.length - 1], visits: inRange.length,
    techs: [...new Set(inRange.map((v) => v.tech_name).filter(Boolean))],
    stations: st, zones, series, year, thr, monthsWithData,
    zonesGuessed: st.some((s) => !s.zoneSet),
    counts: Object.fromEntries(zones.map((z) => [z, st.filter((s) => s.zone === z).length])),
  };
}

/* ======================= выводы и меры ======================= */

function conclusions(D) {
  const out = []; const recs = [];
  const { series, year, thr } = D;
  if (!D.visits) return { out: [['Rezultat', 'în perioada selectată nu au fost efectuate vizite de monitorizare pe acest obiect.']], recs };
  const z = (id) => series[id] || [];
  if (D.zones.includes('exterior')) {
    const s = z('exterior').filter((r) => r.idx != null);
    if (s.length) {
      const mx = s.reduce((a, r) => (r.idx > a.idx ? r : a)); const mn = s.reduce((a, r) => (r.idx < a.idx ? r : a));
      const over = s.filter((r) => r.idx > thr.exterior).map((r) => mLabel(r.k));
      out.push(['Exterior', `indice de activitate pe perioadă ${pct(year.exterior.idx)}; maxim în ${mFull(mx.k)} (${pct(mx.idx)}), minim în ${mFull(mn.k)} (${pct(mn.idx)}). `
        + (over.length ? `Pragul de ${pct(thr.exterior)} a fost depășit în: ${over.join(', ')}.` : `Pragul de ${pct(thr.exterior)} nu a fost depășit.`)]);
      if (over.length) recs.push(['Exterior', `Activitate peste prag (${over.join(', ')})`, 'Cantitate mărită de raticid în stațiile active, vizite mai dese în lunile cu activitate ridicată, inspecția căilor de acces.', 'Prestator']);
    }
  }
  for (const id of ['interior', 'depozit']) {
    if (!D.zones.includes(id)) continue;
    const s = z(id); const cap = s.filter((r) => r.count > 0);
    if (cap.length) {
      out.push([ZONE_RO[id], `${year[id].count} dăunători capturați (${cap.map((r) => `${mLabel(r.k)} — ${r.count}`).join(', ')}); indice de activitate ${pct(year[id].idx)}.`]);
      const sts = D.stations.filter((x) => x.zone === id && x.capt > 0).map((x) => x.n);
      recs.push([`${ZONE_RO[id]}, st. ${sts.join(', ')}`, 'Capturi în zona protejată', 'Inspecție suplimentară, căutarea punctelor de pătrundere, etanșarea golurilor tehnice, capcane adezive suplimentare.', 'Ambele']);
    } else {
      out.push([ZONE_RO[id], `fără capturi pe perioadă; indice de activitate ${pct(year[id].idx)}.`]);
    }
  }
  const na = D.stations.filter((s) => s.naMonths > 0);
  if (na.length) {
    out.push(['Fără acces', `stațiile ${na.map((s) => s.n).join(', ')} nu au putut fi verificate (${year.total.na} verificări ratate). Asigurarea accesului la stații este responsabilitatea Beneficiarului.`]);
    recs.push([`St. ${na.map((s) => s.n).join(', ')}`, 'Stații blocate (marfă, utilaj)', 'Eliberarea accesului la stații; în caz de blocare repetată — reamplasarea stației conform planului.', 'Beneficiar']);
  }
  if (year.total.nl) out.push(['Întreținere', `${year.total.nl} stații / capcane deteriorate, lipsă sau neconforme au fost înlocuite.`]);
  if (!out.length) out.push(['Rezultat', 'nu au fost înregistrate date de monitorizare în perioada selectată.']);
  return { out, recs };
}

/* ======================= PDF ======================= */

export function trendPdf(D, { company = {}, reportNo = '' } = {}) {
  const d = new PdfDoc({ margin: 36 });
  const M = d.m; const CW = d.cw;
  const period = `${mFull(D.from)} – ${mFull(D.to)}`;
  d.footer = (n, total) => {
    d.text(`Insect Protect · ${company.name || 'GARNET-LUX S.R.L.'} · Analiza de tendință · ${D.object.company_name}`.slice(0, 120), M, d.H - M + 8, { size: 6.5, color: C.muted });
    d.textRight(`pag. ${n} / ${total}`, M + CW, d.H - M + 8, { size: 6.5, color: C.muted });
  };
  const top = () => {
    d.rect(0, 0, d.W, 12, { stroke: null, fill: C.dark });
    d.rect(0, 0, 170, 12, { stroke: null, fill: C.accent });
    d.y = 30;
    if (LOGO) d.image(LOGO, M, d.y, 86, 38, 0, 'contain');
    d.textRight('ANALIZA DE TENDINȚĂ', M + CW, d.y + 2, { size: 14, font: 'B' });
    d.textRight(`Raport nr. ${reportNo}   ·   ${period}`, M + CW, d.y + 22, { size: 8, color: C.muted });
    d.y += 46;
    d.line(M, d.y, M + CW, d.y, C.dark, 1.2);
    d.y += 12;
  };
  const card = (x, y, w, h, fill = '#FFFFFF') => { d.roundRect(x, y, w, h, 7, C.line); d.roundRect(x + 0.7, y + 0.7, w - 1.4, h - 1.4, 6.4, fill); };
  const label = (t, x, y) => d.text(t.toUpperCase(), x, y, { size: 6.4, font: 'B', color: C.accentDark });
  const h2 = (num, t) => {
    d.text(num, M, d.y, { size: 10, font: 'B', color: C.accent });
    d.text(t, M + 20, d.y - 1, { size: 11.5, font: 'B' });
    d.y += 19;
  };

  /* -------- страница 1 -------- */
  top();
  // паспорт + система
  const pw = CW * 0.58; const sw = CW - pw - 10; const ph = 92;
  card(M, d.y, pw, ph, C.soft);
  label('Obiectul monitorizat', M + 11, d.y + 10);
  const kv = [['Beneficiar', D.object.company_name], ['Adresa', D.object.address], ['Prestator', `${company.name || 'GARNET-LUX S.R.L.'} (Insect Protect)`],
    ['Specialiști', D.techs.join(', ') || '—'], ['Vizite în perioadă', String(D.visits)]];
  let ky = d.y + 24;
  for (const [k, v] of kv) {
    d.text(k, M + 11, ky, { size: 7.3, color: C.muted });
    const lines = d.wrap(v || '—', 7.6, 'B', pw - 100);
    lines.slice(0, 2).forEach((l, i) => d.text(l, M + 84, ky + i * 9.5, { size: 7.6, font: 'B' }));
    ky += Math.min(2, lines.length) * 9.5 + 3;
  }
  const sx = M + pw + 10;
  card(sx, d.y, sw, ph);
  label('Sistemul de monitorizare', sx + 11, d.y + 10);
  const zs = D.zones.length ? D.zones : ['interior'];
  const bw = (sw - 22 - (zs.length - 1) * 5) / zs.length;
  zs.forEach((z, i) => {
    const x = sx + 11 + i * (bw + 5);
    card(x, d.y + 22, bw, 40);
    const n = String(D.counts[z] || 0);
    d.text(n, x + (bw - d.width(n, 15, 'B')) / 2, d.y + 27, { size: 15, font: 'B' });
    const l = ZONE_RO[z]; d.text(l, x + (bw - d.width(l, 6.6)) / 2, d.y + 48, { size: 6.6, color: C.muted });
  });
  const cardTop = d.y;
  d.y = cardTop + 67;
  d.para(`Total ${D.stations.length} stații. Amplasarea conform planului obiectului.${D.zonesGuessed ? ' Zona unor stații a fost determinată automat după amplasare și tip.' : ''}`,
    { x: sx + 11, w: sw - 22, size: 6.4, color: C.muted, lh: 1.35 });
  d.y = cardTop + ph + 12; // под карточками паспорта
  return finishPdf(d, D, { M, CW, card, label, h2, top, company });
}

function finishPdf(d, D, { M, CW, card, label, h2, top, company }) {
  // KPI
  const kp = [
    [pct(D.year.exterior?.idx ?? null), 'indice de activitate, exterior', 'dark'],
    [pct(D.year.interior?.idx ?? null), 'indice de activitate, interior', 'accent'],
    [String((D.year.interior?.count || 0) + (D.year.depozit?.count || 0)), 'dăunători capturați în interior și depozit', ''],
    [String(D.year.total.na), 'verificări ratate — stații fără acces', ''],
    [String(D.year.total.nl), 'stații / capcane înlocuite', ''],
  ];
  const kw = (CW - 4 * 7) / 5;
  kp.forEach(([v, t, tone], i) => {
    const x = M + i * (kw + 7);
    if (tone === 'dark') d.roundRect(x, d.y, kw, 50, 7, C.dark); else card(x, d.y, kw, 50);
    d.text(v, x + 9, d.y + 8, { size: 17, font: 'B', color: tone === 'dark' ? '#FFFFFF' : tone === 'accent' ? C.accent : C.ink });
    d.wrap(t, 6.3, 'R', kw - 16).slice(0, 2).forEach((l, j) => d.text(l, x + 9, d.y + 31 + j * 7.8, { size: 6.3, color: tone === 'dark' ? '#BBBBBB' : C.muted }));
  });
  d.y += 64;

  // графики
  h2('01', 'Dinamica activității pe zone');
  const gw = (CW - 10) / 2; const gh = 170; const gy = d.y;
  card(M, gy, gw, gh); card(M + gw + 10, gy, gw, gh);
  label('Indice de activitate, %', M + 10, gy + 10);
  label('Dăunători capturați pe luni', M + gw + 20, gy + 10);
  const zc = { exterior: C.accent, interior: C.dark, depozit: C.grey };
  // линия
  {
    const L = M + 30; const R = M + gw - 10; const T = gy + 28; const B = gy + gh - 34;
    const n = D.months.length; const x = (j) => L + (n > 1 ? (R - L) * j / (n - 1) : (R - L) / 2); const y = (v) => B - (B - T) * v;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) { d.line(L, y(t), R, y(t), '#ECE7E0', 0.5); d.textRight(`${t * 100}%`, L - 4, y(t) - 3, { size: 5.8, color: C.muted }); }
    if (D.zones.includes('exterior')) {
      const ty = y(Math.min(1, D.thr.exterior));
      for (let xx = L; xx < R; xx += 6) d.line(xx, ty, Math.min(R, xx + 3), ty, C.accent, 0.7);
      d.textRight(`prag exterior ${pct(D.thr.exterior)}`, R, ty - 8, { size: 5.6, color: C.accentDark });
    }
    D.months.forEach((k, j) => { const s = mLabel(k); d.text(s, x(j) - d.width(s, 5.6) / 2, B + 5, { size: 5.6, color: C.muted }); });
    for (const z of D.zones) {
      const pts = D.series[z].map((r, j) => (r.idx == null ? null : [x(j), y(r.idx)]));
      for (let j = 1; j < pts.length; j++) if (pts[j - 1] && pts[j]) d.line(pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1], zc[z], 1.6);
      for (const p of pts) if (p) d.roundRect(p[0] - 1.8, p[1] - 1.8, 3.6, 3.6, 1.8, zc[z]);
    }
    let lx = M + 10;
    for (const z of D.zones) { d.roundRect(lx, gy + gh - 15, 6, 6, 1.5, zc[z]); d.text(ZONE_RO[z], lx + 9, gy + gh - 16, { size: 6.2, color: C.muted }); lx += 50; }
  }
  // столбцы
  {
    const X0 = M + gw + 10; const L = X0 + 24; const R = X0 + gw - 10; const T = gy + 30; const B = gy + gh - 34;
    const n = D.months.length;
    const tot = D.months.map((_, j) => D.zones.reduce((a, z) => a + (z === 'exterior' ? 0 : D.series[z][j].count), 0));
    let mx = Math.max(1, ...tot); mx = Math.ceil(mx / 2) * 2;
    const y = (v) => B - (B - T) * v / mx;
    const step = Math.max(1, Math.ceil(mx / 4));
    for (let t = 0; t <= mx; t += step) { d.line(L, y(t), R, y(t), '#ECE7E0', 0.5); d.textRight(String(t), L - 4, y(t) - 3, { size: 5.8, color: C.muted }); }
    const cw = (R - L) / n; const bw = Math.min(14, cw * 0.55);
    D.months.forEach((k, j) => {
      const cx = L + cw * (j + 0.5); let base = 0;
      for (const z of ['interior', 'depozit']) {
        if (!D.zones.includes(z)) continue;
        const v = D.series[z][j].count; if (!v) continue;
        d.rect(cx - bw / 2, y(base + v), bw, y(base) - y(base + v), { stroke: null, fill: zc[z] });
        base += v;
      }
      if (base) { const s = String(base); d.text(s, cx - d.width(s, 6, 'B') / 2, y(base) - 9, { size: 6, font: 'B' }); }
      const s = mLabel(k); d.text(s, cx - d.width(s, 5.6) / 2, B + 5, { size: 5.6, color: C.muted });
    });
    let lx = X0 + 10;
    for (const z of ['interior', 'depozit']) { if (!D.zones.includes(z)) continue; d.roundRect(lx, gy + gh - 15, 6, 6, 1.5, zc[z]); d.text(ZONE_RO[z], lx + 9, gy + gh - 16, { size: 6.2, color: C.muted }); lx += 50; }
  }
  d.y = gy + gh + 16;

  // таблица по месяцам
  h2('02', 'Indicatori lunari pe zone');
  const rowsT = [];
  for (const z of D.zones) {
    rowsT.push([`${ZONE_RO[z]} · indice`, D.series[z].map((r) => ({ t: pct(r.idx), hot: r.idx != null && r.idx > (D.thr[z] ?? 1) })), pct(D.year[z].idx)]);
    if (z !== 'exterior') rowsT.push([`${ZONE_RO[z]} · capturi`, D.series[z].map((r) => ({ t: r.count ? String(r.count) : '0', hot: r.count > 0 })), String(D.year[z].count)]);
  }
  rowsT.push(['Fără acces', D.series.total.map((r) => ({ t: String(r.na), warn: r.na > 0 })), String(D.year.total.na)]);
  rowsT.push(['Înlocuite', D.series.total.map((r) => ({ t: String(r.nl) })), String(D.year.total.nl)]);
  {
    const lw = 92; const tw = 36; const n = D.months.length; const cw = (CW - lw - tw) / n; const rh = 13;
    let x = M;
    d.roundRect(M, d.y, CW, rh, 3, C.dark);
    d.text('Indicator', x + 6, d.y + 3.4, { size: 6.4, font: 'B', color: '#FFFFFF' });
    D.months.forEach((k, j) => { const s = mLabel(k); d.text(s, M + lw + cw * j + (cw - d.width(s, 6.2, 'B')) / 2, d.y + 3.4, { size: 6.2, font: 'B', color: '#FFFFFF' }); });
    d.text('Total', M + lw + cw * n + (tw - d.width('Total', 6.2, 'B')) / 2, d.y + 3.4, { size: 6.2, font: 'B', color: '#FFFFFF' });
    d.y += rh;
    rowsT.forEach(([name, cells, total], ri) => {
      if (ri % 2) d.rect(M, d.y, CW, rh, { stroke: null, fill: C.soft });
      d.text(name, M + 6, d.y + 3.4, { size: 6.6, font: 'B' });
      cells.forEach((c, j) => {
        const cx = M + lw + cw * j;
        if (c.hot) d.roundRect(cx + 2, d.y + 1.5, cw - 4, rh - 3, 2, C.red);
        else if (c.warn) d.roundRect(cx + 2, d.y + 1.5, cw - 4, rh - 3, 2, C.fa);
        d.text(c.t, cx + (cw - d.width(c.t, 6.4, c.hot ? 'B' : 'R')) / 2, d.y + 3.4, { size: 6.4, font: c.hot ? 'B' : 'R', color: c.hot ? C.redInk : C.ink });
      });
      d.text(total, M + lw + cw * n + (tw - d.width(total, 6.6, 'B')) / 2, d.y + 3.4, { size: 6.6, font: 'B' });
      d.line(M, d.y + rh, M + CW, d.y + rh, C.line, 0.4);
      d.y += rh;
    });
    d.y += 5;
    d.text('Indice de activitate = stații cu consum de momeală sau capturi ÷ stații verificate în lună. Roșu — peste pragul de intervenție '
      + `(exterior ${pct(D.thr.exterior)}, interior — orice activitate, depozit ${pct(D.thr.depozit)}).`, M, d.y, { size: 6, color: C.muted });
  }

  /* -------- страница 2 -------- */
  d.addPage();
  top();
  h2('03', 'Harta activității pe stații și luni');
  {
    const per = Math.ceil(D.stations.length / 3) || 1;
    const colW = (CW - 2 * 10) / 3; const n = D.months.length; const nw = 16; const cw = (colW - nw) / n; const rh = Math.max(6.5, Math.min(9, 330 / Math.max(per, 1)));
    const y0 = d.y; let maxY = y0;
    for (let c = 0; c < 3; c++) {
      const list = D.stations.slice(c * per, (c + 1) * per); if (!list.length) continue;
      const x0 = M + c * (colW + 10); let y = y0;
      D.months.forEach((k, j) => { const s = mLabel(k)[0].toUpperCase(); d.text(s, x0 + nw + cw * j + (cw - d.width(s, 5.2)) / 2, y, { size: 5.2, color: C.muted }); });
      y += 8; let prev = null;
      for (const s of list) {
        if (s.zone !== prev) { d.text(ZONE_RO[s.zone].toUpperCase(), x0, y + 0.5, { size: 5.4, font: 'B', color: C.accentDark }); y += 8; prev = s.zone; }
        d.textRight(String(s.n), x0 + nw - 3, y + 0.6, { size: 5.4, font: 'B', color: C.muted });
        D.months.forEach((k, j) => {
          const cc = s.cells[k]; const cx = x0 + nw + cw * j;
          let fill = C.empty; let txt = ''; let ink = C.ink;
          if (cc) {
            if (cc.count) { fill = C.dark; txt = String(cc.count); ink = '#FFFFFF'; }
            else if (cc.bait >= 100) fill = C.c100;
            else if (cc.bait >= 50) fill = C.c50;
            else if (cc.active) fill = C.c25;
            else if (!cc.checked && cc.na) { fill = C.fa; txt = 'FA'; ink = '#6B5000'; }
            else if (cc.nl) { fill = C.nl; txt = 'Î'; ink = C.muted; }
            else fill = '#E8F5EA';
          }
          d.roundRect(cx + 0.6, y, cw - 1.2, rh - 1.2, 1.2, fill);
          if (txt) d.text(txt, cx + (cw - d.width(txt, 4.6, 'B')) / 2, y + (rh - 1.2) / 2 - 2.6, { size: 4.6, font: 'B', color: ink });
        });
        y += rh;
      }
      maxY = Math.max(maxY, y);
    }
    d.y = maxY + 6;
    const leg = [[C.c50, 'consum de momeală'], [C.c100, 'consum integral'], [C.dark, 'captură (nr.)'], [C.fa, 'fără acces'], [C.nl, 'înlocuită'], ['#E8F5EA', 'verificată, fără activitate'], [C.empty, 'neverificată']];
    let lx = M;
    for (const [c, t] of leg) { d.roundRect(lx, d.y, 7, 7, 1.5, c); d.text(t, lx + 10, d.y - 0.5, { size: 6, color: C.muted }); lx += 14 + d.width(t, 6) + 8; }
    d.y += 18;
  }

  // точки внимания + выводы
  const { out, recs } = conclusions(D);
  const hot = D.stations.filter((s) => s.status).sort((a, b) => ({ critic: 0, capturi: 1, acces: 2 }[a.status] - { critic: 0, capturi: 1, acces: 2 }[b.status]) || b.capt - a.capt || a.n - b.n).slice(0, 14);
  const lw = CW * 0.46; const rw = CW - lw - 12; const y0 = d.y;
  d.y = y0; h2('04', 'Puncte critice');
  {
    const cols = [['St.', 24], ['Zona', 54], ['Luni act.', 42], ['Capt.', 34], ['FA', 26], ['Statut', lw - 180]];
    let x = M; const rh = 13;
    d.roundRect(M, d.y, lw, rh, 3, C.dark);
    for (const [t, w] of cols) { d.text(t.toUpperCase(), x + 5, d.y + 3.6, { size: 5.8, font: 'B', color: '#FFFFFF' }); x += w; }
    d.y += rh;
    if (!hot.length) { d.text('Nu au fost identificate puncte critice.', M + 5, d.y + 4, { size: 7, color: C.muted }); d.y += 16; }
    hot.forEach((s, i) => {
      if (i % 2) d.rect(M, d.y, lw, rh, { stroke: null, fill: C.soft });
      const vals = [String(s.n), ZONE_RO[s.zone], String(s.actMonths), String(s.capt), String(s.naMonths)];
      let xx = M;
      vals.forEach((v, j) => { d.text(v, xx + 5, d.y + 3.4, { size: 6.8, font: j === 0 ? 'B' : 'R' }); xx += cols[j][1]; });
      const tag = { critic: ['Punct critic', C.red, C.redInk], capturi: ['Capturi', C.amber, '#7A3A05'], acces: ['Acces blocat', C.fa, '#6B5000'] }[s.status];
      const tw = d.width(tag[0], 6, 'B') + 10;
      d.roundRect(xx + 4, d.y + 2.2, tw, rh - 4.4, 4, tag[1]);
      d.text(tag[0], xx + 9, d.y + 3.6, { size: 6, font: 'B', color: tag[2] });
      d.line(M, d.y + rh, M + lw, d.y + rh, C.line, 0.4);
      d.y += rh;
    });
  }
  const yL = d.y;
  d.y = y0;
  {
    const X = M + lw + 12;
    d.text('05', X, d.y, { size: 10, font: 'B', color: C.accent });
    d.text('Concluzii', X + 20, d.y - 1, { size: 11.5, font: 'B' });
    d.y += 19;
    out.forEach(([k, t], i) => {
      d.roundRect(X, d.y + 0.5, 9, 9, 4.5, C.accent);
      const s = String(i + 1); d.text(s, X + (9 - d.width(s, 6, 'B')) / 2, d.y + 2, { size: 6, font: 'B', color: '#FFFFFF' });
      const lines = d.wrap(`${k}: ${t}`, 7.2, 'R', rw - 14);
      lines.forEach((l, j) => {
        if (j === 0) { d.text(`${k}:`, X + 14, d.y + j * 10, { size: 7.2, font: 'B' }); d.text(l.slice(k.length + 1), X + 14 + d.width(`${k}:`, 7.2, 'B'), d.y + j * 10, { size: 7.2, color: '#333333' }); } else d.text(l, X + 14, d.y + j * 10, { size: 7.2, color: '#333333' });
      });
      d.y += lines.length * 10 + 4;
    });
  }
  d.y = Math.max(yL, d.y) + 12;

  // меры
  d.ensure(120);
  h2('06', 'Măsuri corective recomandate');
  {
    const cols = [['Zona / stații', 110], ['Constatare', 130], ['Măsura', CW - 110 - 130 - 70], ['Responsabil', 70]];
    const rh0 = 13;
    d.roundRect(M, d.y, CW, rh0, 3, C.dark);
    let x = M; for (const [t, w] of cols) { d.text(t.toUpperCase(), x + 5, d.y + 3.6, { size: 5.8, font: 'B', color: '#FFFFFF' }); x += w; }
    d.y += rh0;
    const list = recs.length ? recs : [['—', 'Activitate sub pragurile de intervenție', 'Continuarea monitorizării conform graficului contractual.', 'Prestator']];
    list.forEach((r, i) => {
      const hs = r.map((v, j) => d.wrap(v, 6.8, j === 3 ? 'B' : 'R', cols[j][1] - 10).length);
      const rh = Math.max(...hs) * 9 + 6;
      d.ensure(rh + 4);
      if (i % 2) d.rect(M, d.y, CW, rh, { stroke: null, fill: C.soft });
      let xx = M;
      r.forEach((v, j) => { d.wrap(v, 6.8, j === 3 ? 'B' : 'R', cols[j][1] - 10).forEach((l, k) => d.text(l, xx + 5, d.y + 3 + k * 9, { size: 6.8, font: j === 3 ? 'B' : 'R' })); xx += cols[j][1]; });
      d.line(M, d.y + rh, M + CW, d.y + rh, C.line, 0.4);
      d.y += rh;
    });
  }

  // подписи
  d.ensure(80);
  d.y += 16;
  const half = (CW - 14) / 2;
  for (const [i, [t, who, role]] of [['Prestator', `${(company.name || 'GARNET-LUX S.R.L.')}`, `${company.rep || ''}, ${company.func || ''}`], ['Beneficiar', D.object.company_name, 'Responsabil HACCP / calitate']].entries()) {
    const x = M + i * (half + 14);
    card(x, d.y, half, 62);
    label(t, x + 10, d.y + 9);
    d.text(d.wrap(who, 8.5, 'B', half - 20)[0] || '', x + 10, d.y + 20, { size: 8.5, font: 'B' });
    d.text(role, x + 10, d.y + 31, { size: 7, color: C.muted });
    d.line(x + 10, d.y + 52, x + half - 60, d.y + 52, C.dark, 0.6);
    d.line(x + half - 50, d.y + 52, x + half - 10, d.y + 52, C.dark, 0.6);
    d.text('Semnătura', x + 10, d.y + 54, { size: 5.8, color: C.muted });
    d.text('L.Ș.', x + half - 50, d.y + 54, { size: 5.8, color: C.muted });
  }
  d.y += 70;
  return d.toBuffer();
}

