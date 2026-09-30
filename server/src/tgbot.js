// Отправка сообщений через Telegram Bot API (отчёты в офис, уведомления).
import crypto from 'node:crypto';
const TOKEN = process.env.BOT_TOKEN;
export const botEnabled = Boolean(TOKEN);

export const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function parse(res) {
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram: ${data.description || res.status}`);
  return data.result;
}

async function call(method, payload) {
  if (!TOKEN) throw new Error('Не задан BOT_TOKEN');
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parse(res);
}

async function callForm(method, form) {
  if (!TOKEN) throw new Error('Не задан BOT_TOKEN');
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: 'POST', body: form });
  return parse(res);
}

export async function sendMessage(chatId, html, { threadId, replyMarkup, replyTo } = {}) {
  const text = html.length > 4000 ? html.slice(0, 3990) + '…' : html;
  return call('sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
    ...(threadId ? { message_thread_id: Number(threadId) } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    ...(replyTo ? { reply_parameters: { message_id: Number(replyTo), allow_sending_without_reply: true } } : {}),
  });
}

export async function editMessage(chatId, messageId, html, replyMarkup) {
  return call('editMessageText', {
    chat_id: chatId, message_id: Number(messageId), text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function deleteMessage(chatId, messageId) {
  return call('deleteMessage', { chat_id: chatId, message_id: Number(messageId) });
}

export async function answerCallback(id, text) {
  return call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) });
}

// ---------- webhook: бот получает события (добавили в группу, команды) ----------
export const webhookSecret = TOKEN ? crypto.createHash('sha256').update(`wh:${TOKEN}`).digest('hex').slice(0, 48) : '';

export async function getMe() {
  return call('getMe', {});
}

export async function getWebhookInfo() {
  return call('getWebhookInfo', {});
}

export async function getChatMember(chatId, userId) {
  return call('getChatMember', { chat_id: chatId, user_id: Number(userId) });
}

export async function setWebhook(url) {
  return call('setWebhook', {
    url, secret_token: webhookSecret,
    allowed_updates: ['message', 'edited_message', 'callback_query', 'my_chat_member', 'channel_post'],
  });
}

/** Один файл (PDF-акт) с подписью. */
export async function sendDocument(chatId, buf, filename, caption, threadId) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (threadId) form.append('message_thread_id', String(threadId));
  form.append('document', new Blob([buf], { type: 'application/pdf' }), filename);
  if (caption) { form.append('caption', caption.slice(0, 1024)); form.append('parse_mode', 'HTML'); }
  return callForm('sendDocument', form);
}

/** photos: [{ buf: Buffer, mime, caption }] — отправляются альбомами по 10. */
export async function sendPhotos(chatId, photos, threadId) {
  for (let i = 0; i < photos.length; i += 10) {
    const chunk = photos.slice(i, i + 10);
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (threadId) form.append('message_thread_id', String(threadId));
    if (chunk.length === 1) {
      const p = chunk[0];
      form.append('photo', new Blob([p.buf], { type: p.mime }), 'photo.jpg');
      if (p.caption) { form.append('caption', p.caption.slice(0, 1000)); form.append('parse_mode', 'HTML'); }
      await callForm('sendPhoto', form);
    } else {
      const media = chunk.map((p, j) => ({
        type: 'photo', media: `attach://p${j}`,
        ...(p.caption ? { caption: p.caption.slice(0, 1000), parse_mode: 'HTML' } : {}),
      }));
      form.append('media', JSON.stringify(media));
      chunk.forEach((p, j) => form.append(`p${j}`, new Blob([p.buf], { type: p.mime }), `p${j}.jpg`));
      await callForm('sendMediaGroup', form);
    }
  }
}

export const chatTitle = (c) => c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id);

/** Запасной способ без webhook: чаты из getUpdates. */
export async function discoverChats() {
  const updates = await call('getUpdates', { limit: 100, allowed_updates: ['message', 'my_chat_member', 'channel_post'] });
  const chats = new Map();
  for (const u of updates) {
    const c = u.my_chat_member?.chat || u.message?.chat || u.channel_post?.chat;
    if (!c) continue;
    const title = c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id);
    chats.set(String(c.id), { id: String(c.id), title, type: c.type });
  }
  return [...chats.values()].sort((a, b) => (a.type === 'private') - (b.type === 'private'));
}

/** Видео / фото / файл в чат с кнопками. Возвращает сообщение Telegram (в нём file_id). */
export async function sendMedia(chatId, buf, { mime = '', filename = 'file', caption = '', threadId, replyMarkup } = {}) {
  const isVideo = mime.startsWith('video/');
  const isPhoto = mime.startsWith('image/') && buf.length < 10_000_000;
  const method = isVideo ? 'sendVideo' : isPhoto ? 'sendPhoto' : 'sendDocument';
  const field = isVideo ? 'video' : isPhoto ? 'photo' : 'document';
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (threadId) form.append('message_thread_id', String(threadId));
  form.append(field, new Blob([buf], { type: mime || 'application/octet-stream' }), filename);
  if (isVideo) form.append('supports_streaming', 'true');
  if (caption) { form.append('caption', caption.slice(0, 1024)); form.append('parse_mode', 'HTML'); }
  if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
  return callForm(method, form);
}

export async function editCaption(chatId, messageId, html, replyMarkup) {
  return call('editMessageCaption', {
    chat_id: chatId, message_id: Number(messageId), caption: html.slice(0, 1024), parse_mode: 'HTML',
    ...(replyMarkup ? { reply_markup: replyMarkup } : { reply_markup: { inline_keyboard: [] } }),
  });
}

/** Ссылка на скачивание файла из Telegram (бот может скачать файлы до 20 МБ). */
export async function fileUrl(fileId) {
  const f = await call('getFile', { file_id: fileId });
  return `https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`;
}

/** Прямой вызов Bot API (для редких методов). */
export const tgCall = (method, payload) => call(method, payload);
