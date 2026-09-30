// Печатные страницы: акт выезда и лист QR-этикеток.
import { statusLabel } from './config.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmt = (iso) =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', { timeZone: process.env.TZ_DISPLAY || 'Europe/Moscow', dateStyle: 'long', timeStyle: 'short' })
    : '—';

const BASE_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1D1D1F; background: #fff; }
  .page { max-width: 960px; margin: 0 auto; padding: 40px 24px; }
  h1 { font-size: 28px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 4px; }
  .muted { color: #6E6E73; }
  .btn { display: inline-block; background: #0066CC; color: #fff; border: 0; border-radius: 12px; padding: 10px 18px; font: inherit; font-weight: 500; cursor: pointer; }
  @media print { .no-print { display: none !important; } .page { padding: 0; } }
`;

export function visitReportHtml({ visit, rows, observations = [], assessment = {} }) {
  const checked = rows.filter((r) => r.status);
  const count = (id) => checked.filter((r) => r.status === id).length;
  const totalPests = checked.reduce((s, r) => s + (Number(r.count) || 0), 0);

  const obsHtml = observations
    .map(
      (o) => `<div class="obs">
        <div class="obs-h"><b>${esc(o.category)}</b><span class="muted small">${esc(fmt(o.created_at))}</span></div>
        ${o.comment ? `<p>${esc(o.comment)}</p>` : ''}
        ${o.photos.length ? `<div class="ph">${o.photos.map((u) => `<a href="${esc(u)}" target="_blank"><img src="${esc(u)}" alt=""></a>`).join('')}</div>` : ''}
      </div>`,
    )
    .join('');

  const tr = rows
    .map(
      (r) => `<tr>
        <td>${esc(r.number)}</td>
        <td>${esc(r.kind)}<div class="muted small">${esc(r.code)}</div></td>
        <td>${esc(r.location)}</td>
        <td><span class="pill ${esc(r.status || 'none')}">${r.status ? esc(statusLabel(r.status)) : 'Не проверена'}</span></td>
        <td>${esc(r.pest)}</td>
        <td class="num">${r.status ? esc(r.count) : ''}</td>
        <td>${r.bait_replaced ? 'Да' : ''}</td>
        <td>${esc(r.comment)}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Акт выезда — ${esc(visit.company_name)}</title>
<style>${BASE_CSS}
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin: 24px 0; }
  .card { background: #F5F5F7; border-radius: 12px; padding: 14px 16px; }
  .card b { display: block; font-size: 22px; font-weight: 600; }
  .label { font-size: 12px; color: #6E6E73; text-transform: uppercase; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-weight: 600; color: #6E6E73; font-size: 12px; padding: 8px 6px; border-bottom: 1px solid #D2D2D7; }
  td { padding: 8px 6px; border-bottom: 1px solid #E8E8ED; vertical-align: top; }
  .num { text-align: right; }
  .small { font-size: 11px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; background: #E8E8ED; white-space: nowrap; }
  .pill.ok { background: #E3F5E8; color: #1B7F3B; }
  .pill.activity { background: #FDECEC; color: #C4291C; }
  .pill.damaged, .pill.missing { background: #FFF2DE; color: #A65A00; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 48px; }
  .sign div { border-top: 1px solid #1D1D1F; padding-top: 6px; font-size: 12px; color: #6E6E73; }
  .overflow { overflow-x: auto; }
  h2 { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; margin: 32px 0 12px; }
  .obs { background: #F5F5F7; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; break-inside: avoid; }
  .obs-h { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .obs p { margin: 6px 0 0; line-height: 1.45; }
  .ph { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; margin-top: 10px; }
  .ph img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 8px; display: block; }
</style></head><body><div class="page">
  <div class="no-print" style="text-align:right;margin-bottom:16px"><button class="btn" onclick="print()">Печать / PDF</button></div>
  <div class="label">Акт выполненных работ</div>
  <h1>${esc(visit.company_name)}</h1>
  <div class="muted">${esc(visit.address)}</div>
  <div class="grid">
    <div class="card"><span class="label">Процедура</span><b style="font-size:17px">${esc(visit.procedure)}</b></div>
    <div class="card"><span class="label">Дата</span><b style="font-size:17px">${esc(fmt(visit.finished_at || visit.started_at))}</b></div>
    <div class="card"><span class="label">Специалист</span><b style="font-size:17px">${esc(visit.tech_name)}</b></div>
    ${assessment.infestation ? `<div class="card"><span class="label">Степень заселённости</span><b style="font-size:17px">${esc(assessment.infestation)}</b></div>` : ''}
    ${assessment.preparation ? `<div class="card"><span class="label">Подготовка помещения</span><b style="font-size:17px">${esc(assessment.preparation)}</b></div>` : ''}
    ${rows.length ? `
    <div class="card"><span class="label">Проверено ловушек</span><b>${checked.length} из ${rows.length}</b></div>
    <div class="card"><span class="label">С активностью</span><b>${count('activity')}</b></div>
    <div class="card"><span class="label">Особей учтено</span><b>${totalPests}</b></div>
    <div class="card"><span class="label">Повреждено / нет</span><b>${count('damaged')} / ${count('missing')}</b></div>` : ''}
  </div>
  ${observations.length ? `<h2>Замечания и фотофиксация</h2>${obsHtml}` : ''}
  ${rows.length ? `<h2>Ловушки</h2>
  <div class="overflow"><table>
    <thead><tr><th>№</th><th>Тип</th><th>Место</th><th>Статус</th><th>Вредитель</th><th class="num">Кол-во</th><th>Приманка заменена</th><th>Комментарий</th></tr></thead>
    <tbody>${tr}</tbody>
  </table></div>` : ''}
  ${visit.comment ? `<p style="margin-top:24px"><span class="label">Заключение</span><br>${esc(visit.comment)}</p>` : ''}
  <div class="sign"><div>Исполнитель: ${esc(visit.tech_name)}</div><div>Представитель заказчика</div></div>
</div></body></html>`;
}

export function labelsHtml(items) {
  const cells = items
    .map(
      ({ code, payload }) => `<div class="lbl">
        <div class="qr" data-qr="${esc(payload)}"></div>
        <div class="txt"><div class="brand">Контроль вредителей</div><div class="code">${esc(code)}</div><div class="no">№ ______</div></div>
      </div>`,
    )
    .join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QR-этикетки для ловушек</title>
<style>${BASE_CSS}
  @page { size: A4; margin: 8mm; }
  .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
  .lbl { display: flex; gap: 3mm; align-items: center; border: 1px dashed #D2D2D7; border-radius: 3mm; padding: 3mm; height: 38mm; break-inside: avoid; }
  .qr { width: 30mm; height: 30mm; flex: none; }
  .qr img, .qr canvas { width: 100% !important; height: 100% !important; }
  .brand { font-size: 8pt; color: #6E6E73; }
  .code { font-size: 13pt; font-weight: 600; letter-spacing: .03em; margin: 1mm 0 3mm; }
  .no { font-size: 10pt; }
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
</head><body><div class="page">
  <div class="no-print" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px">
    <div><h1>QR-этикетки</h1><div class="muted">${items.length} шт. Наклейте на ловушку и отсканируйте в приложении — она привяжется к объекту.</div></div>
    <button class="btn" onclick="print()">Печать</button>
  </div>
  <div class="sheet">${cells}</div>
</div>
<script>
  document.querySelectorAll('[data-qr]').forEach(function (el) {
    new QRCode(el, { text: el.dataset.qr, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.M });
  });
</script>
</body></html>`;
}
