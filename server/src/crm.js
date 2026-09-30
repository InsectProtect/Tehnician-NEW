// ====================================================================================================
// ПОДКЛЮЧАЕМЫЙ CRM-КОННЕКТОР (v49)
// Архитектура: crm_cfg (setting) хранит { provider: null|'amocrm', enabled, amocrm: { domain, access_token } }.
// Секретов в коде нет — домен и токен задаёт владелец через админ-панель, хранятся в БД (setting), не логируются.
// Провайдер — объект { id, upsertLeadSuccess({ leadId, task, visit, actPdfBuffer, actFilename }) }.
// Заявка (tasks.crm_lead_id) может быть привязана к лиду amoCRM вручную в карточке заявки; если не привязана — CRM
// молча пропускается (никаких ошибок пользователю). Хук: onVisitDone() вызывается из /api/visits/:id/finish
// ПОСЛЕ успешного завершения, best-effort (ошибка не блокирует ответ технику, админам уходит уведомление в Telegram).
// ====================================================================================================
import { escHtml } from './tgbot.js';

const DEFAULT_CFG = { provider: null, enabled: false, amocrm: { domain: '', access_token: '' } };

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

const PROVIDERS = { amocrm: amocrmProvider };

export function initCrm(ctx) {
  const { route, must, str, getSetting, setSetting, audit, notifyAdmins } = ctx;

  async function cfg() {
    const c = (await getSetting('crm_cfg')) || {};
    return { ...DEFAULT_CFG, ...c, amocrm: { ...DEFAULT_CFG.amocrm, ...(c.amocrm || {}) } };
  }

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
    };
  }, { access: 'admin' });

  route('PUT', '/api/admin/crm', async ({ user, body }) => {
    must(user.isOwner, 403, 'CRM настраивает главный администратор');
    const c = await cfg();
    if (body.provider !== undefined) c.provider = body.provider === 'amocrm' ? 'amocrm' : null;
    if (body.enabled !== undefined) c.enabled = Boolean(body.enabled);
    must(!c.enabled || c.provider, 400, 'Выберите CRM-систему перед включением');
    if (body.amocrm) {
      if (body.amocrm.domain !== undefined) c.amocrm.domain = str(body.amocrm.domain, 200);
      if (body.amocrm.access_token) c.amocrm.access_token = str(body.amocrm.access_token, 4000); // непустое значение — обновляем токен
    }
    await setSetting('crm_cfg', c);
    await audit(user, 'CRM: настройки сохранены', c.provider || 'нет', c.enabled ? 'включено' : 'выключено');
    return { ok: true };
  }, { access: 'admin' });

  route('POST', '/api/admin/crm/disconnect', async ({ user }) => {
    must(user.isOwner, 403, 'CRM настраивает главный администратор');
    await setSetting('crm_cfg', DEFAULT_CFG);
    await audit(user, 'CRM: отключено', '');
    return { ok: true };
  }, { access: 'admin' });

  /** Вызывается после успешного завершения выезда. Best-effort: ошибка не должна ломать /finish для техника. */
  async function onVisitDone({ task, visit, buildPdf, filename }) {
    if (!task || !task.crm_lead_id) return; // лид не привязан к заявке — молча пропускаем
    const c = await cfg();
    const p = providerFor(c);
    if (!p) return;
    try {
      const buf = await buildPdf();
      await p.upsertLeadSuccess({ leadId: task.crm_lead_id, task, visit, actPdfBuffer: buf, actFilename: filename });
    } catch (e) {
      console.error('CRM sync error:', e.message);
      notifyAdmins?.(`⚠️ CRM: не удалось передать заявку № ${task.task_no} в ${c.provider} (лид ${escHtml(task.crm_lead_id)}): ${escHtml(String(e.message).slice(0, 300))}`).catch?.(() => {});
    }
  }

  return { onVisitDone, cfg };
}
