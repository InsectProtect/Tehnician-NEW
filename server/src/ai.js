// ИИ (Claude API) без зависимостей: распознавание фото машины и чеков, советы по пробегу.
// Работает, только если в Render задан ANTHROPIC_API_KEY; модель — ANTHROPIC_MODEL (по умолчанию claude-sonnet-5).
const KEY = () => process.env.ANTHROPIC_API_KEY || '';
const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

export const aiOn = () => Boolean(KEY());

/**
 * Запрос к модели с картинками; ответ — JSON-объект (модель просим отвечать только JSON).
 * images: [{ mime, data(base64) , label? }]
 */
export async function aiJson(prompt, images = [], { maxTokens = 700, timeoutMs = 60000 } = {}) {
  if (!aiOn()) throw new Error('ИИ не подключён (нет ANTHROPIC_API_KEY)');
  const content = [];
  for (const im of images) {
    if (im.label) content.push({ type: 'text', text: im.label });
    content.push({ type: 'image', source: { type: 'base64', media_type: im.mime || 'image/jpeg', data: im.data } });
  }
  content.push({ type: 'text', text: prompt });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': KEY(), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, messages: [{ role: 'user', content }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || `ИИ: ошибка ${r.status}`);
    const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('ИИ ответил не в формате JSON');
    return JSON.parse(m[0]);
  } finally {
    clearTimeout(t);
  }
}
