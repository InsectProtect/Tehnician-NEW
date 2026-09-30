import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert, RotateCw, XCircle } from 'lucide-react';
import { api } from '../api';
import { haptic } from '../telegram';
import type { BotStatus } from '../types';
import { Button, SectionTitle, Sheet, Spinner, cx, useToast } from '../components/ui';

type Level = 'ok' | 'warn' | 'bad';

const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Check({ level, title, children }: { level: Level; title: string; children?: ReactNode }) {
  const Icon = level === 'ok' ? CheckCircle2 : level === 'warn' ? CircleAlert : XCircle;
  return (
    <div className="flex gap-3 py-3">
      <Icon size={20} strokeWidth={1.75} className={cx('mt-0.5 shrink-0',
        level === 'ok' && 'text-[#248A3D] dark:text-[#30D158]',
        level === 'warn' && 'text-[#C93400] dark:text-[#FF9F0A]',
        level === 'bad' && 'text-[#D70015] dark:text-[#FF453A]')} />
      <div className="min-w-0">
        <div className="text-[15px] font-semibold leading-snug">{title}</div>
        {children && <div className="mt-0.5 text-[14px] leading-snug text-muted">{children}</div>}
      </div>
    </div>
  );
}

const isAdminStatus = (s: string) => s === 'administrator' || s === 'creator';

/** Диагностика: webhook, права бота в группе, привязка тем, последние входящие сообщения. */
export function BotStatusSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [s, setS] = useState<BotStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setS(null);
    api.botStatus().then(setS).catch((e: Error) => toast(e.message, 'error'));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function resetWebhook() {
    setBusy(true);
    try {
      await api.resetWebhook();
      haptic.success();
      toast('Webhook установлен');
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const w = s?.webhook;
  const whOk = Boolean(w?.url) && (!s?.expected_url || w?.url === s.expected_url);
  const recentError = w?.last_error && w.last_error_at && Date.now() - new Date(w.last_error_at).getTime() < 6 * 3600000;

  return (
    <Sheet open onClose={onClose} title="Проверка бота">
      {!s ? <Spinner /> : !s.enabled ? (
        <Check level="bad" title="Бот не настроен">В Render не задана переменная BOT_TOKEN.</Check>
      ) : (
        <>
          {s.error && <Check level="bad" title="Telegram не отвечает">{s.error}</Check>}

          <div className="divide-y divide-black/[0.06] rounded-2xl bg-card px-4 dark:divide-white/10">
            <Check level={whOk ? 'ok' : 'bad'} title={whOk ? 'Webhook установлен' : w?.url ? 'Webhook указывает на другой адрес' : 'Webhook не установлен'}>
              {w?.url || 'Telegram не знает, куда присылать сообщения.'}
              {!whOk && s.expected_url && <div className="mt-1">Нужен: {s.expected_url}</div>}
            </Check>
            {recentError && (
              <Check level="warn" title="Недавняя ошибка доставки">
                {w!.last_error} · {fmt(w!.last_error_at!)}. Обычно это «засыпание» бесплатного сервера Render: Telegram повторит доставку сам.
              </Check>
            )}
            {w && w.pending > 0 && (
              <Check level="warn" title={`В очереди ${w.pending} сообщ.`}>Telegram ещё не доставил их серверу — подождите минуту и обновите.</Check>
            )}
            <Check level={s.bindings.length ? 'ok' : 'bad'} title={s.bindings.length ? `Привязано тем: ${s.bindings.length}` : 'Ни одна тема не привязана'}>
              {!s.bindings.length && 'Откройте тему «Заявки …» в группе, отправьте /tech и нажмите на имя сотрудника.'}
            </Check>
            <Check level={s.last_update_at ? 'ok' : 'warn'} title={s.last_update_at ? `Последнее сообщение: ${fmt(s.last_update_at)}` : 'С момента запуска сервер не получил ни одного сообщения'}>
              {!s.last_update_at && 'Напишите что-нибудь в теме и нажмите «Обновить». Если пусто — бот не админ группы или webhook не работает.'}
            </Check>
          </div>

          {!whOk && (
            <Button className="mt-4" loading={busy} onClick={resetWebhook} icon={<RotateCw size={18} strokeWidth={1.75} />}>Установить webhook</Button>
          )}

          {s.bindings.length > 0 && (
            <>
              <SectionTitle>Темы заявок</SectionTitle>
              <div className="space-y-2.5">
                {s.bindings.map((b) => {
                  const adm = isAdminStatus(b.bot_status) || s.bot?.can_read_all_group_messages;
                  return (
                    <div key={b.key} className="rounded-2xl bg-card px-4 py-1">
                      <div className="pt-3 text-[15px] font-semibold">{b.topic || (b.thread_id ? `Тема #${b.thread_id}` : 'Весь чат')}</div>
                      <div className="text-[13px] text-muted">{b.chat_title}</div>
                      <div className="divide-y divide-black/[0.06] dark:divide-white/10">
                        <Check level={b.tech_exists ? 'ok' : 'bad'} title={b.tech_exists ? `Сотрудник: ${b.tech_name}` : 'Сотрудник не найден'}>
                          {!b.tech_exists && 'Привяжите тему заново: /tech в этой теме.'}
                        </Check>
                        <Check level={adm ? 'ok' : 'bad'} title={adm ? 'Бот видит сообщения' : 'Бот не администратор группы'}>
                          {!adm && 'Без прав админа бот видит только команды. Группа → Управление → Администраторы → добавить бота.'}
                          {b.bot_status.startsWith('ошибка') && ` ${b.bot_status}`}
                        </Check>
                        <Check level="ok" title={`Заявок из темы: ${b.tasks}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <SectionTitle>Последние сообщения в группах</SectionTitle>
          {s.recent.length === 0 ? (
            <div className="rounded-2xl bg-card p-4 text-[14px] text-muted">
              Пусто. Журнал хранится с последнего перезапуска сервера.
            </div>
          ) : (
            <div className="space-y-2">
              {s.recent.map((r, i) => {
                const good = r.result.startsWith('заявка') || r.result.startsWith('замечание') || r.result.startsWith('команда /');
                return (
                  <div key={i} className="rounded-2xl bg-card p-3 text-[14px]">
                    <div className="flex justify-between gap-2 text-[12px] text-muted">
                      <span className="truncate">{r.chat}{r.thread ? ` · тема #${r.thread}` : ''}{r.from ? ` · ${r.from}` : ''}</span>
                      <span className="shrink-0">{fmt(r.at)}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 break-words">{r.text || '—'}</div>
                    <div className={cx('mt-1 text-[13px] font-medium', good ? 'text-[#248A3D] dark:text-[#30D158]' : 'text-[#C93400] dark:text-[#FF9F0A]')}>
                      {r.result}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <Button variant="secondary" className="mt-5" onClick={load} icon={<RotateCw size={18} strokeWidth={1.75} />}>Обновить</Button>
          <p className="mt-3 text-center text-[13px] text-muted">В любой теме можно отправить /status — бот ответит, привязана ли она.</p>
        </>
      )}
    </Sheet>
  );
}
