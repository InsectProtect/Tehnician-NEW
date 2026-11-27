import { useCallback, useEffect, useState } from 'react';
import { BellRing, CheckCircle2, Clock3, MessageSquareWarning, Send } from 'lucide-react';
import { api } from '../api';
import { haptic } from '../telegram';
import { GameButton } from '../components/game';
import { Button, Sheet, TextArea, cx, useToast } from '../components/ui';
import type { IssueTask, TechIssue } from '../types';

/* ================================================================================================
 * v117: «Сообщить менеджеру об ошибке». Дезинсектор — кнопка на главной; менеджеру бот напоминает
 * каждые 5 минут, пока не нажмёт «Уведомлен». На «Обзоре» офиса — карточка с той же кнопкой.
 * ================================================================================================ */

const QUICK = ['Неверный адрес', 'Неверное время', 'Нет телефона клиента', 'Клиент не отвечает', 'Не тот вредитель / обработка', 'Неверная цена'];
const hm = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Кнопка на главной дезинсектора. */
export function IssueButton() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<IssueTask[]>([]);
  const [mine, setMine] = useState<TechIssue[]>([]);
  const [taskId, setTaskId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const waiting = mine.filter((m) => m.status === 'new').length;

  const load = useCallback(() => api.issueForm().then((r) => { setTasks(r.tasks); setMine(r.mine); }).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  async function send() {
    if (text.trim().length < 3) { toast('Напишите, в чём ошибка', 'error'); return; }
    setBusy(true);
    try {
      await api.sendIssue({ text: text.trim(), task_id: taskId || undefined });
      haptic.success();
      toast('Отправлено — менеджеру будет напоминать, пока не ответит', 'ok');
      setText(''); setTaskId(''); setOpen(false); load();
    } catch (e) { haptic.error(); toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  return (
    <>
      <GameButton className="mb-5" tone="ghost" icon={<MessageSquareWarning size={20} strokeWidth={2.2} />} onClick={() => { haptic.tap(); load(); setOpen(true); }}>
        Сообщить об ошибке{waiting ? ` · ждёт ${waiting}` : ''}
      </GameButton>
      {open && (
        <Sheet open onClose={() => setOpen(false)} title="Сообщить менеджеру">
          <p className="-mt-3 mb-4 text-[14px] leading-relaxed text-muted">Менеджер получит сообщение сразу, бот будет напоминать каждые 5 минут, пока он не нажмёт «Уведомлен».</p>

          {tasks.length > 0 && (
            <>
              <div className="mb-1.5 text-[13px] font-semibold text-muted">По какой заявке (необязательно)</div>
              <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
                <button data-chip onClick={() => setTaskId('')} className={cx('flex-none rounded-xl px-3 py-2 text-[13.5px] font-semibold', !taskId ? 'bg-accent text-black' : 'bg-fill text-muted')}>Без заявки</button>
                {tasks.map((t) => (
                  <button key={t.id} data-chip onClick={() => { haptic.tap(); setTaskId(t.id); }}
                    className={cx('max-w-[220px] flex-none rounded-xl px-3 py-2 text-left text-[13.5px] font-semibold', taskId === t.id ? 'bg-accent text-black' : 'bg-fill')}>
                    № {t.task_no}{t.when ? ` · ${t.when}` : ''}
                    <span className={cx('block truncate text-[12px] font-medium', taskId === t.id ? 'opacity-75' : 'text-muted')}>{t.title}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="mb-1.5 text-[13px] font-semibold text-muted">Что не так</div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button key={q} data-chip onClick={() => { haptic.tap(); setText((x) => (x.includes(q) ? x : [x.trim(), q].filter(Boolean).join('. '))); }}
                className="rounded-xl bg-fill px-3 py-1.5 text-[13px] font-medium active:opacity-60">{q}</button>
            ))}
          </div>
          <TextArea rows={3} placeholder="Например: адрес в заявке Dacia 47, а клиент живёт на Dacia 74" value={text} onChange={(e) => setText(e.target.value)} />
          <Button className="mt-4" loading={busy} icon={<Send size={18} />} onClick={send}>Отправить менеджеру</Button>

          {mine.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">Мои сообщения</div>
              <div className="flex flex-col gap-2">
                {mine.map((m) => (
                  <div key={m.id} className="rounded-2xl bg-fill px-3.5 py-2.5">
                    <div className="text-[14px] leading-snug">{m.task ? <b>№ {m.task.task_no} · </b> : null}{m.text}</div>
                    <div className={cx('mt-1 flex items-center gap-1.5 text-[12.5px] font-medium', m.status === 'ack' ? 'text-[#1F7A35] dark:text-[#5FE08A]' : 'text-[#C26A00] dark:text-[#FFB340]')}>
                      {m.status === 'ack' ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
                      {m.status === 'ack' ? `${m.ack_name || 'Менеджер'} уведомлен · ${m.ack_at ? hm(m.ack_at) : ''}` : `Ждём ответа · отправлено ${hm(m.created_at)}${m.pings > 1 ? ` · напомнили ${m.pings - 1} раз` : ''}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}

/** Карточка на «Обзоре» офиса: неотвеченные сообщения дезинсекторов. */
export function IssuesCard() {
  const toast = useToast();
  const [items, setItems] = useState<TechIssue[]>([]);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => api.adminIssues().then((r) => setItems(r.items)).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  const open = items.filter((i) => i.status === 'new');
  if (!open.length) return null;

  async function ack(id: string) {
    setBusy(id);
    try { await api.ackIssue(id); haptic.success(); toast('Дезинсектор получит ответ', 'ok'); load(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  }

  return (
    <div data-panel className="mt-4 rounded-[22px] bg-[#FF453A]/10 p-5 ring-1 ring-inset ring-[#FF453A]/30">
      <div className="flex items-center gap-2.5">
        <BellRing size={20} className="shrink-0 text-[#FF453A]" />
        <div className="min-w-0">
          <div className="text-[18px] font-semibold leading-tight">Ошибки от дезинсекторов</div>
          <div className="text-[13px] text-muted">Бот напоминает каждые 5 минут, пока не нажмёте «Уведомлен»</div>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {open.map((i) => (
          <div key={i.id} className="rounded-2xl bg-card px-3.5 py-3">
            <div className="text-[13px] font-semibold text-muted">{i.tech} · {hm(i.created_at)}{i.task ? ` · заявка № ${i.task.task_no}${i.task.when ? `, ${i.task.when}` : ''}` : ''}</div>
            {i.task?.title && <div className="truncate text-[13px] text-muted">{i.task.title}</div>}
            <div className="mt-1 text-[15px] leading-snug">{i.text}</div>
            <Button className="mt-2.5" variant="secondary" loading={busy === i.id} icon={<CheckCircle2 size={18} />} onClick={() => ack(i.id)}>Уведомлен</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
