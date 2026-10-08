// ====================================================================================================
// ПОДКЛЮЧАЕМЫЙ CRM-КОННЕКТОР (v49)
// Архитектура: crm_cfg (setting) хранит { provider: null|'amocrm', enabled, amocrm: { domain, access_token } }.
// Секретов в коде нет — домен и токен задаёт владелец через админ-панель, хранятся в БД (setting), не логируются.
// Провайдер — объект { id, upsertLeadSuccess({ leadId, task, visit, actPdfBuffer, actFilename }) }.
// Заявка (tasks.crm_lead_id) может быть привязана к лиду amoCRM вручную в карточке заявки; если не привязана — CRM
// молча пропускается (никаких ошибок пользователю). Хук: onVisitDone() вызывается из /api/visits/:id/finish
// ПОСЛЕ успешного завершения, best-effort (ошибка не блокирует ответ технику, админам уходит уведомление в Telegram).
// ====================================================================================================
// v62: провайдеры amoCRM, Bitrix24 и «Любая CRM» (исходящий вебхук с подписью HMAC — Pipedrive, HubSpot, Zoho, 1С,
// свой сервер или Make/Zapier/n8n). Плюс входящий вебхук: любая CRM создаёт заявку POST-запросом (маршрут в index.js).
import crypto from 'node:crypto';
import { escHtml } from './tgbot.js';

const DEFAULT_CFG = {
  provider: null, enabled: false,
  amocrm: { domain: '', access_token: '' },
  bitrix24: { webhook_url: '', won_stage: 'WON' },
  webhook: { url: '', secret: '', include_pdf: false },
  inbound: { token: '', enabled: false },
};
export const CRM_PROVIDERS = ['amocrm', 'bitrix24', 'webhook'];

const maskToken = (t) => (t ? `••••${String(t).slice(-4)}` : '');

// ------------------------------ AmoCRM ------------------------------
// Реализация по официальному REST API v4 (https://www.amocrm.ru/developers/content/crm_platform/api-reference).
// Домен вида mycompany.amocrm.ru, токен — долгосрочный токен приватной интеграции (Bearer).
// Часть флоу (загрузка файла в Диск amoCRM — двухшаговый: сессия загрузки → PUT байтов → привязка uuid к сделке)
// не может быть на 100% проверена без реального аккаунта — отмечено ниже, при ошибке файл просто не прикладывается,
// а примечание с итогами (самый надёжный канал) отправляется в любом случае.
function amocrmProvider(cfg) {
  const domain = String(cfg.amocrm?.domain || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const token = String(cfg.amocrm?.access_token || '').trim();

  async function api(pathname, init = {}) {
    const res = await fetch(`https://${domain}${pathname}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`amoCRM ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  /** Переводит сделку в статус «успешно реализовано». amoCRM v4 использует служебный параметр status_id=142 в базовой воронке,
   * либо (надёжнее для кастомных воронок) поле closed_at + жёсткий win-флаг недоступен напрямую в v4 без ID закрывающего этапа —
   * поэтому пробуем стандартный ID 142, а если сделка в другой воронке, откат — просто оставляем примечание. */
  async function markWon(leadId) {
    try {
      await api(`/api/v4/leads/${encodeURIComponent(leadId)}`, { method: 'PATCH', body: JSON.stringify({ status_id: 142 }) });
    } catch (e) {
      console.error('amoCRM markWon (status_id=142 не подошёл — проверьте ID этапа «Успешно реализовано» в воронке):', e.message);
    }
  }

  /** Загрузка файла в Диск amoCRM и привязка к сделке (best-effort, двухшаговый флоу Files API). */
  async function attachFile(leadId, buf, filename) {
    try {
      const session = await api('/v2.0/files/session', {
        method: 'POST',
        body: JSON.stringify({ file_name: filename, file_size: buf.length, content_type: 'application/pdf' }),
      });
      const uploadUrl = session?.upload_url || session?._links?.upload?.href;
      if (!uploadUrl) throw new Error('amoCRM не вернул upload_url (проверьте права токена на Диск)');
      const up = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Range': `bytes 0-${buf.length - 1}/${buf.length}` },
        body: buf,
      });
      if (!up.ok) throw new Error(`amoCRM upload ${up.status}`);
      const meta = await up.json().catch(() => null);
      const uuid = meta?.uuid || session?.uuid;
      if (!uuid) throw new Error('amoCRM не вернул uuid файла');
      await api(`/api/v4/leads/${encodeURIComponent(leadId)}/files`, { method: 'POST', body: JSON.stringify([{ uuid }]) });
    } catch (e) {
      console.error('amoCRM: акт не прикреплён к сделке (некритично):', e.message);
    }
  }

  async function addNote(leadId, text) {
    await api('/api/v4/leads/notes', {
      method: 'POST',
      body: JSON.stringify([{ entity_id: Number(leadId), note_type: 'common', params: { text } }]),
    });
  }

  return {
    id: 'amocrm',
    needsLead: true,
    async test() { if (!domain || !token) throw new Error('Не заданы домен или токен'); await api('/api/v4/account'); return 'amoCRM отвечает, токен рабочий'; },
    async upsertLeadSuccess({ leadId, task, visit, actPdfBuffer, actFilename }) {
      if (!domain || !token) throw new Error('CRM (amoCRM): не заданы домен или токен');
      await markWon(leadId);
      if (actPdfBuffer) await attachFile(leadId, actPdfBuffer, actFilename || 'act.pdf');
      const lines = ['✅ Выезд выполнен успешно'];
      if (task?.task_no) lines.push(`Заявка № ${task.task_no}`);
      if (visit?.address) lines.push(`Адрес: ${visit.address}`);
      if (visit?.procedure) lines.push(`Обработка: ${visit.procedure}`);
      await addNote(leadId, lines.join('\n'));
    },
  };
}

// ------------------------------ Bitrix24 ------------------------------
// Входящий вебхук Bitrix24 (Разработчикам → Другое → Входящий вебхук, права: CRM): https://xxx.bitrix24.ru/rest/1/abc123/
// Сделка → стадия «Сделка успешна» (WON или своя, напр. C2:WON для другой воронки), комментарий в таймлайн с актом PDF.
function bitrix24Provider(cfg) {
  let base = String(cfg.bitrix24?.webhook_url || '').trim();
  if (base && !base.endsWith('/')) base += '/';
  const stage = String(cfg.bitrix24?.won_stage || 'WON').trim() || 'WON';

  async function call(method, params) {
    const res = await fetch(`${base}${method}.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}) });
    const text = await res.text();
    let j = null; try { j = JSON.parse(text); } catch { /* не JSON */ }
    if (!res.ok || j?.error) throw new Error(`Bitrix24 ${res.status}: ${j?.error_description || j?.error || text.slice(0, 300)}`);
    return j?.result;
  }

  return {
    id: 'bitrix24',
    needsLead: true,
    async test() { await call('crm.deal.fields'); return 'Bitrix24 отвечает, доступ к CRM есть'; },
    async upsertLeadSuccess({ leadId, task, visit, actPdfBuffer, actFilename, actUrl }) {
      if (!/^https:\/\/[^/]+\/rest\/\d+\/[^/]+\/$/.test(base)) throw new Error('CRM (Bitrix24): адрес вебхука вида https://xxx.bitrix24.ru/rest/1/код/');
      await call('crm.deal.update', { id: leadId, fields: { STAGE_ID: stage } });
      const text = ['✅ Выезд выполнен успешно', task?.task_no && `Заявка № ${task.task_no}`, visit?.address && `Адрес: ${visit.address}`,
        visit?.procedure && `Обработка: ${visit.procedure}`, actUrl && `Акт: ${actUrl}`].filter(Boolean).join('\n');
      const fields = { ENTITY_ID: Number(leadId), ENTITY_TYPE: 'deal', COMMENT: text };
      if (actPdfBuffer) fields.FILES = [[actFilename || 'act.pdf', actPdfBuffer.toString('base64')]];
      await call('crm.timeline.comment.add', { fields });
    },
  };
}

// ------------------------------ Любая CRM: исходящий вебхук ------------------------------
// POST JSON на заданный URL. Подпись: заголовок X-InsectProtect-Signature: sha256=<hex HMAC-SHA256(secret, тело)>.
// Работает без ID лида: CRM сопоставит заявку по номеру/телефону/адресу; если лид привязан — он тоже в теле.
function webhookProvider(cfg) {
  const url = String(cfg.webhook?.url || '').trim();
  const secret = String(cfg.webhook?.secret || '');
  async function send(payload) {
    if (!/^https?:\/\/\S+$/i.test(url)) throw new Error('CRM (вебхук): укажите адрес https://…');
    const body = JSON.stringify(payload);
    const sig = secret ? `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}` : '';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await fetch(url, {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'InsectProtect-Webhook/1', 'X-InsectProtect-Event': payload.event, ...(sig ? { 'X-InsectProtect-Signature': sig } : {}) },
        body,
      });
      if (!res.ok) throw new Error(`вебхук ответил ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } finally { clearTimeout(timer); }
  }
  return {
    id: 'webhook',
    needsLead: false,
    async test() {
      await send({ event: 'test', sent_at: new Date().toISOString(), message: 'Проверка подключения InsectProtect' });
      return 'Тестовое событие доставлено (ответ 2xx)';
    },
    async upsertLeadSuccess({ leadId, task, visit, actPdfBuffer, actFilename, actUrl }) {
      const pests = (() => { try { return JSON.parse(visit?.pests || task?.pests || '[]'); } catch { return []; } })();
      await send({
        event: 'visit.done',
        sent_at: new Date().toISOString(),
        crm_lead_id: leadId || null,
        task: task ? {
          id: task.id, number: Number(task.task_no), company: task.company_name || '', address: task.address || '', phone: task.phone || '',
          planned_at: task.planned_at || null, procedure: task.procedure || '', price: task.price ?? null, comment: task.comment || '',
        } : null,
        visit: {
          id: visit.id, act_no: visit.act_no || null, finished_at: visit.finished_at || new Date().toISOString(), technician: visit.tech_name || '',
          company: visit.company_name || '', address: visit.address || '', procedure: visit.procedure || '', pests,
          payment: visit.payment || '', pay_amount: visit.pay_amount ?? null, comment: visit.comment || '',
        },
        act_pdf_url: actUrl || null,
        ...(cfg.webhook?.include_pdf && actPdfBuffer ? { act_pdf: { filename: actFilename || 'act.pdf', base64: actPdfBuffer.toString('base64') } } : {}),
      });
    },
  };
}

const PROVIDERS = { amocrm: amocrmProvider, bitrix24: bitrix24Provider, webhook: webhookProvider };

export function initCrm(ctx) {
  const { route, must, str, getSetting, setSetting, audit, notifyAdmins, publicBase } = ctx;

  async function cfg() {
    const c = (await getSetting('crm_cfg')) || {};
    const out = { ...DEFAULT_CFG, ...c };
    for (const k of ['amocrm', 'bitrix24', 'webhook', 'inbound']) out[k] = { ...DEFAULT_CFG[k], ...(c[k] || {}) };
    return out;
  }
  const inboundUrl = (c) => (c.inbound.token ? `${publicBase() || ''}/api/hooks/crm/${c.inbound.token}` : '');

  function providerFor(c) {
    if (!c.enabled || !c.provider) return null;
    const make = PROVIDERS[c.provider];
    return make ? make(c) : null;
  }

  route('GET', '/api/admin/crm', async ({ user }) => {
    must(user.isOwner, 403, 'CRM настраивает главный администратор');
    const c = await cfg();
    return {
      provider: c.provider, enabled: c.enabled,
      amocrm: { domain: c.amocrm.domain, token_set: Boolean(c.amocrm.access_token), token_masked: maskToken(c.amocrm.access_token) },
      bitrix24: { url_set: Boolean(c.bitrix24.webhook_url), url_masked: c.bitrix24.webhook_url ? c.bitrix24.webhook_url.replace(/\/rest\/(\d+)\/[^/]+/, '/rest/$1/••••') : '', won_stage: c.bitrix24.won_stage },
      webhook: { url: c.webhook.url, secret_set: Boolean(c.webhook.secret), secret_masked: maskToken(c.webhook.secret), include_pdf: Boolean(c.webhook.include_pdf) },
      inbound: { enabled: Boolean(c.inbound.enabled), url: inboundUrl(c) },
    };
  }, { access: 'admin' });

  route('PUT', '/api/admin/crm', async ({ user, body }) => {
    must(user.isOwner, 403, 'CRM настраивает главный администратор');
    const c = await cfg();
    if (body.provider !== undefined) c.provider = CRM_PROVIDERS.includes(body.provider) ? body.provider : null;
    if (body.enabled !== undefined) c.enabled = Boolean(body.enabled);
    must(!c.enabled || c.provider, 400, 'Выберите CRM-систему перед включением');
    if (body.amocrm) {
      if (body.amocrm.domain !== undefined) c.amocrm.domain = str(body.amocrm.domain, 200);
      if (body.amocrm.access_token) c.amocrm.access_token = str(body.amocrm.access_token, 4000); // непустое значение — обновляем токен
    }
    if (body.bitrix24) {
      if (body.bitrix24.webhook_url) {
        const u = str(body.bitrix24.webhook_url, 500).replace(/\/(profile|crm\.[\w.]+)(\.json)?\/?$/i, '/');
        must(/^https:\/\/[^/]+\/rest\/\d+\/[^/]+\/?$/.test(u), 400, 'Адрес вебхука Bitrix24 вида https://xxx.bitrix24.ru/rest/1/код/');
        c.bitrix24.webhook_url = u.endsWith('/') ? u : `${u}/`;
      }
      if (body.bitrix24.won_stage !== undefined) c.bitrix24.won_stage = str(body.bitrix24.won_stage, 50) || 'WON';
    }
    if (body.webhook) {
      if (body.webhook.url !== undefined) {
        const u = str(body.webhook.url, 1000);
        must(!u || /^https?:\/\/\S+$/i.test(u), 400, 'Адрес вебхука должен начинаться с https://');
        c.webhook.url = u;
      }
      if (body.webhook.secret) c.webhook.secret = str(body.webhook.secret, 200);
      if (body.webhook.new_secret) c.webhook.secret = crypto.randomBytes(24).toString('base64url');
      if (body.webhook.include_pdf !== undefined) c.webhook.include_pdf = Boolean(body.webhook.include_pdf);
    }
    if (body.inbound) {
      if (body.inbound.enabled !== undefined) c.inbound.enabled = Boolean(body.inbound.enabled);
      if (body.inbound.new_token || (c.inbound.enabled && !c.inbound.token)) c.inbound.token = crypto.randomBytes(24).toString('base64url');
    }
    await setSetting('crm_cfg', c);
    await audit(user, 'CRM: настройки сохранены', c.provider || 'нет', c.enabled ? 'включено' : 'выключено');
    return { ok: true };
  }, { access: 'admin' });

  route('POST', '/api/admin/crm/test', async ({ user }) => {
    must(user.isOwner, 403, 'CRM настраивает главный администратор');
    const c = await cfg();
    must(c.provider && PROVIDERS[c.provider], 400, 'Сначала выберите CRM');
    try {
      return { ok: true, message: await PROVIDERS[c.provider](c).test() };
    } catch (e) {
      return { ok: false, message: String(e.message || e).slice(0, 300) };
    }
  }, { access: 'admin' });

  route('POST', '/api/admin/crm/disconnect', async ({ user }) => {
    must(user.isOwner, 403, 'CRM настраивает главный администратор');
    const keep = (await cfg()).inbound; // входящий вебхук отключается отдельно
    await setSetting('crm_cfg', { ...DEFAULT_CFG, inbound: keep });
    await audit(user, 'CRM: отключено', '');
    return { ok: true };
  }, { access: 'admin' });

  /** Вызывается после успешного завершения выезда. Best-effort: ошибка не должна ломать /finish для техника. */
  async function onVisitDone({ task, visit, buildPdf, filename, actUrl }) {
    if (!task) return;
    const c = await cfg();
    const p = providerFor(c);
    if (!p) return;
    if (p.needsLead && !task.crm_lead_id) return; // amoCRM/Bitrix24: лид не привязан к заявке — молча пропускаем
    try {
      const wantPdf = p.id !== 'webhook' || c.webhook.include_pdf;
      const buf = wantPdf ? await buildPdf() : null;
      await p.upsertLeadSuccess({ leadId: task.crm_lead_id || '', task, visit, actPdfBuffer: buf, actFilename: filename, actUrl });
    } catch (e) {
      console.error('CRM sync error:', e.message);
      notifyAdmins?.(`⚠️ CRM: не удалось передать заявку № ${task.task_no} в ${c.provider}${task.crm_lead_id ? ` (лид ${escHtml(task.crm_lead_id)})` : ''}: ${escHtml(String(e.message).slice(0, 300))}`).catch?.(() => {});
    }
  }

  return { onVisitDone, cfg };
}
