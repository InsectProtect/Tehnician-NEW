// Интеграция с amoCRM (API v4) через долгосрочный токен приватной интеграции.
// Без AMO_DOMAIN/AMO_TOKEN работает демо-режим с тестовыми юрлицами.

const DOMAIN = process.env.AMO_DOMAIN; // например: mycompany.amocrm.ru
const TOKEN = process.env.AMO_TOKEN;
// Код/ID поля адреса у компании. У компаний amoCRM есть стандартное поле с кодом ADDRESS.
const ADDRESS_FIELD = process.env.AMO_ADDRESS_FIELD || 'ADDRESS';

export const amoEnabled = Boolean(DOMAIN && TOKEN);

const DEMO = [
  { id: '1001', name: 'ООО «Хлебозавод №3»', addresses: ['г. Москва, ул. Складочная, 1с4'] },
  { id: '1002', name: 'ИП Смирнов А. В. (кафе «Вкусно»)', addresses: ['г. Москва, Ленинский пр-т, 45'] },
  { id: '1003', name: 'АО «СкладЛогистик»', addresses: ['МО, г. Подольск, Индустриальная ул., 7', 'МО, г. Климовск, Заводская ул., 2'] },
];

async function amo(pathname, init = {}) {
  const res = await fetch(`https://${DOMAIN}/api/v4${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (res.status === 204) return null; // amoCRM отдаёт 204, если ничего не найдено
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`amoCRM ${res.status}: ${text.slice(0, 300)}`);
    err.status = 502;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

function extractAddresses(company) {
  const out = [];
  for (const f of company.custom_fields_values || []) {
    const match = f.field_code === ADDRESS_FIELD || String(f.field_id) === ADDRESS_FIELD;
    if (!match) continue;
    for (const v of f.values || []) if (v.value) out.push(String(v.value).trim());
  }
  return out;
}

export async function searchCompanies(query) {
  if (!amoEnabled) {
    const q = (query || '').toLowerCase();
    return DEMO.filter((c) => c.name.toLowerCase().includes(q));
  }
  const params = new URLSearchParams({ limit: '50', order: 'updated_at' });
  if (query) params.set('query', query);
  const data = await amo(`/companies?${params}`);
  const list = data?._embedded?.companies || [];
  return list.map((c) => ({ id: String(c.id), name: c.name, addresses: extractAddresses(c) }));
}

export async function getCompany(id) {
  if (!amoEnabled) return DEMO.find((c) => c.id === String(id)) || null;
  const c = await amo(`/companies/${encodeURIComponent(id)}`);
  return c ? { id: String(c.id), name: c.name, addresses: extractAddresses(c) } : null;
}

// Примечание в карточку компании — отчёт о выезде.
export async function addCompanyNote(companyId, text) {
  if (!amoEnabled) {
    console.log(`[amo demo] note for company ${companyId}:\n${text}`);
    return 'demo';
  }
  const data = await amo('/companies/notes', {
    method: 'POST',
    body: JSON.stringify([{ entity_id: Number(companyId), note_type: 'common', params: { text } }]),
  });
  const id = data?._embedded?.notes?.[0]?.id;
  return id ? String(id) : null;
}

// ======================= Заявки (сделки) =======================
// Менеджер создаёт сделку, привязывает компанию, заполняет адрес/процедуру/дату,
// назначает техника ответственным и ставит этап «Назначено технику».
// Техник видит такие сделки в приложении; при завершении выезда сделка уходит в этап «Выполнено».

const PIPELINE = process.env.AMO_PIPELINE_ID;
const ST_ASSIGNED = process.env.AMO_STATUS_ASSIGNED;
const ST_PROGRESS = process.env.AMO_STATUS_IN_PROGRESS;
const ST_DONE = process.env.AMO_STATUS_DONE;
const LEAD_ADDRESS = process.env.AMO_LEAD_ADDRESS_FIELD;
const LEAD_PROCEDURE = process.env.AMO_LEAD_PROCEDURE_FIELD;
const LEAD_DATE = process.env.AMO_LEAD_DATE_FIELD;
// Сопоставление техников: "tgId:amoUserId,tgId:amoUserId"
const TECH_MAP = Object.fromEntries(
  (process.env.TECH_MAP || '')
    .split(',')
    .map((p) => p.split(':').map((s) => s.trim()))
    .filter(([a, b]) => a && b),
);

export const leadsEnabled = Boolean(amoEnabled && PIPELINE && ST_ASSIGNED); // заявки — только с подключённой amoCRM

function fieldValue(entity, idOrCode) {
  if (!idOrCode) return null;
  const f = (entity.custom_fields_values || []).find(
    (x) => String(x.field_id) === String(idOrCode) || x.field_code === idOrCode,
  );
  const v = f?.values?.[0];
  if (!v) return null;
  return v.value ?? v.enum ?? null;
}

const toIso = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n * 1000) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ---- демо-заявки ----
const day = 24 * 3600 * 1000;
const DEMO_LEADS = [
  { id: '5001', name: 'Ежемесячный мониторинг', company: DEMO[0], address: DEMO[0].addresses[0], procedure: 'Мониторинг ловушек', planned_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString() },
  { id: '5002', name: 'Жалоба на тараканов на кухне', company: DEMO[1], address: DEMO[1].addresses[0], procedure: 'Дезинсекция', planned_at: new Date(Date.now() + 5 * 3600 * 1000).toISOString() },
  { id: '5003', name: 'Дератизация склада №2', company: DEMO[2], address: DEMO[2].addresses[1], procedure: '', planned_at: new Date(Date.now() + day).toISOString() },
];
const demoStatus = {}; // leadId -> 'assigned' | 'in_progress' | 'done'

function shapeLead(l, companies) {
  const companyId = l._embedded?.companies?.[0]?.id;
  const company = companyId ? companies[String(companyId)] : null;
  const stage = String(l.status_id) === String(ST_PROGRESS) ? 'in_progress' : String(l.status_id) === String(ST_DONE) ? 'done' : 'assigned';
  return {
    id: String(l.id),
    name: l.name || `Сделка #${l.id}`,
    company_id: company ? company.id : `lead-${l.id}`,
    company_name: company ? company.name : l.name || `Сделка #${l.id}`,
    address: (fieldValue(l, LEAD_ADDRESS) && String(fieldValue(l, LEAD_ADDRESS)).trim()) || company?.addresses?.[0] || '',
    procedure: fieldValue(l, LEAD_PROCEDURE) ? String(fieldValue(l, LEAD_PROCEDURE)) : '',
    planned_at: toIso(fieldValue(l, LEAD_DATE)),
    stage,
  };
}

async function companiesByIds(ids) {
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  if (!uniq.length) return {};
  const params = new URLSearchParams({ limit: '250' });
  uniq.forEach((id) => params.append('filter[id][]', id));
  const data = await amo(`/companies?${params}`);
  const out = {};
  for (const c of data?._embedded?.companies || []) out[String(c.id)] = { id: String(c.id), name: c.name, addresses: extractAddresses(c) };
  return out;
}

export async function listLeads(tgId) {
  if (!amoEnabled) {
    return DEMO_LEADS.filter((l) => demoStatus[l.id] !== 'done').map((l) => ({
      id: l.id, name: l.name, company_id: l.company.id, company_name: l.company.name, address: l.address,
      procedure: l.procedure, planned_at: l.planned_at, stage: demoStatus[l.id] || 'assigned',
    }));
  }
  const params = new URLSearchParams({ limit: '100', with: 'contacts' });
  [ST_ASSIGNED, ST_PROGRESS].filter(Boolean).forEach((st, i) => {
    params.set(`filter[statuses][${i}][pipeline_id]`, PIPELINE);
    params.set(`filter[statuses][${i}][status_id]`, st);
  });
  const amoUser = TECH_MAP[String(tgId)];
  if (amoUser) params.append('filter[responsible_user_id][]', amoUser);
  const data = await amo(`/leads?${params}`);
  const leads = data?._embedded?.leads || [];
  const companies = await companiesByIds(leads.map((l) => l._embedded?.companies?.[0]?.id));
  return leads.map((l) => shapeLead(l, companies));
}

export async function getLead(id) {
  if (!amoEnabled) {
    const l = DEMO_LEADS.find((x) => x.id === String(id));
    return l ? { id: l.id, name: l.name, company_id: l.company.id, company_name: l.company.name, address: l.address, procedure: l.procedure, planned_at: l.planned_at, stage: demoStatus[l.id] || 'assigned' } : null;
  }
  const l = await amo(`/leads/${encodeURIComponent(id)}?with=contacts`);
  if (!l) return null;
  const companies = await companiesByIds([l._embedded?.companies?.[0]?.id]);
  return shapeLead(l, companies);
}

export async function moveLead(id, stage) {
  if (!amoEnabled) {
    demoStatus[id] = stage;
    return;
  }
  const statusId = stage === 'done' ? ST_DONE : stage === 'in_progress' ? ST_PROGRESS : null;
  if (!statusId) return; // этап не настроен — сделку не двигаем
  await amo(`/leads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status_id: Number(statusId), pipeline_id: Number(PIPELINE) }),
  });
}

export async function addLeadNote(id, text) {
  if (!amoEnabled) {
    console.log(`[amo demo] note for lead ${id}:\n${text}`);
    return 'demo';
  }
  const data = await amo('/leads/notes', {
    method: 'POST',
    body: JSON.stringify([{ entity_id: Number(id), note_type: 'common', params: { text } }]),
  });
  const noteId = data?._embedded?.notes?.[0]?.id;
  return noteId ? String(noteId) : null;
}

// Справка для настройки: воронки/этапы, поля сделок, пользователи — чтобы узнать ID для переменных Render.
export async function setupInfo() {
  if (!amoEnabled) return { demo: true };
  const [p, f, u] = await Promise.all([
    amo('/leads/pipelines'),
    amo('/leads/custom_fields?limit=250'),
    amo('/users?limit=250'),
  ]);
  return {
    pipelines: (p?._embedded?.pipelines || []).map((x) => ({
      id: x.id, name: x.name, statuses: (x._embedded?.statuses || []).map((s) => ({ id: s.id, name: s.name })),
    })),
    lead_fields: (f?._embedded?.custom_fields || []).map((x) => ({ id: x.id, name: x.name, type: x.type })),
    users: (u?._embedded?.users || []).map((x) => ({ id: x.id, name: x.name })),
    current: { AMO_PIPELINE_ID: PIPELINE, AMO_STATUS_ASSIGNED: ST_ASSIGNED, AMO_STATUS_IN_PROGRESS: ST_PROGRESS, AMO_STATUS_DONE: ST_DONE, AMO_LEAD_ADDRESS_FIELD: LEAD_ADDRESS, AMO_LEAD_PROCEDURE_FIELD: LEAD_PROCEDURE, AMO_LEAD_DATE_FIELD: LEAD_DATE, TECH_MAP },
  };
}
