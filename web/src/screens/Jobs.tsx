import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Check, CheckCheck, ClipboardList, Hand, Paperclip, Plus, Target, Undo2 } from 'lucide-react';
import { api, uploadJobFileAny } from '../api';
import { useConfig } from '../config';
import { haptic, openLink } from '../telegram';
import { MULT_PRESETS } from './Tasks';
import { useCrown } from './Contest';
import { openPhotos } from '../components/PhotoViewer';
import type { AdminTaskInput, Assignee, Audience, BoostWindow, Job, JobFile, JobInput, JobStatus } from '../types';
import {
  Button, Chips, ConfirmSheet, Field, Input, MultiChips, Pill, SectionTitle, Segmented, Sheet, Spinner, Stepper, TextArea, cx, useToast,
} from '../components/ui';

/*
 * Поручения — задачи, которые не являются обработкой: «снять 10 рекламных видео», «развезти ловушки» и т. п.
 * Ставит администратор, назначает бонус в баллах. Сотрудник отмечает прогресс и сдаёт; администратор принимает
 * (баллы уходят в KPI) или возвращает на доработку. Обработки из чата офиса — как и раньше, это заявки.
 */

const pts = (x: number | null | undefined) => String(Math.round((x ?? 0) * 100) / 100).replace('.', ',');
const fmtDue = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '');
const STATUS: Record<JobStatus, { label: string; tone: 'blue' | 'gray' | 'green' | 'red' | 'orange' }> = {
  open: { label: 'Свободно', tone: 'orange' },
  new: { label: 'Новое', tone: 'blue' },
  in_progress: { label: 'В работе', tone: 'blue' },
  returned: { label: 'На доработке', tone: 'red' },
  submitted: { label: 'На проверке', tone: 'orange' },
  accepted: { label: 'Принято', tone: 'green' },
  cancelled: { label: 'Отменено', tone: 'gray' },
};
const isOpen = (j: Job) => ['open', 'new', 'in_progress', 'returned', 'submitted'].includes(j.status);
/** Категории сотрудников для «кто заберёт». */
export const AUDIENCE_LABEL: Record<Audience, string> = { all: 'Все', tech: 'Дезинсекторы', specialist: 'Специалисты', manager: 'Менеджеры' };
export const audienceText = (a?: string | null) => (a === 'all' ? 'все сотрудники' : a ? (AUDIENCE_LABEL[a as Audience] || a).toLowerCase() : '');
const hhmm = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Progress({ j }: { j: Job }) {
  if (!j.target) return null;
  const p = Math.min(1, j.done_count / j.target);
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
        <div className={cx('h-full rounded-full', p >= 1 ? 'bg-[#34C759]' : 'bg-accent')} style={{ width: `${Math.round(p * 100)}%` }} />
      </div>
      <span className="font-mono text-[12px] tabular-nums text-muted">{j.done_count}/{j.target}</span>
    </div>
  );
}

/** Как в мессенджере: ✓ отправлено · ✓✓ серые — прочитано (открыл) · ✓✓ цветные — принял в работу. */
const minsAgo = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m} мин` : m < 1440 ? `${Math.floor(m / 60)} ч ${m % 60} м` : `${Math.floor(m / 1440)} дн`;
};
export function ReadTicks({ j }: { j: Job }) {
  if (j.tech_bot_blocked && !j.ack_at && ['new', 'in_progress', 'returned'].includes(j.status)) {
    return <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#D70015] dark:text-[#FF453A]">🤖 бот не запущен — уведомления не доходят</span>;
  }
  if (!['new', 'in_progress', 'returned'].includes(j.status) && j.ack_at) {
    return <span className="inline-flex items-center gap-1 text-[12.5px] text-[#248A3D] dark:text-[#30D158]"><CheckCheck size={15} strokeWidth={2} /></span>;
  }
  if (j.ack_at) return <span className="inline-flex items-center gap-1 text-[12.5px] text-[#248A3D] dark:text-[#30D158]"><CheckCheck size={15} strokeWidth={2} />принял</span>;
  if (j.seen_at) return <span className="inline-flex items-center gap-1 text-[12.5px] text-muted"><CheckCheck size={15} strokeWidth={2} />прочитал · не принял</span>;
  return <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#D70015] dark:text-[#FF453A]"><Check size={15} strokeWidth={2} />не прочитал · {minsAgo(j.created_at)}</span>;
}

export function JobRow({ j, showTech, onClick }: { j: Job; showTech?: boolean; onClick: () => void }) {
  const st = STATUS[j.status];
  return (
    <button onClick={() => { haptic.tap(); onClick(); }} className="block w-full min-w-0 max-w-full overflow-hidden rounded-2xl bg-card p-4 text-left active:opacity-70">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-ink"><Target size={18} strokeWidth={1.75} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="line-clamp-2 break-words text-[16px] font-semibold leading-snug">{j.title}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-[13px] text-muted">
            {showTech && (j.status === 'open'
              ? <span className="font-medium text-[#C93400] dark:text-[#FF9F0A]">🙋 заберёт: {audienceText(j.audience)}</span>
              : <span className="font-medium text-ink">{j.tech_name}{j.claimed_at ? ' · забрал(а)' : ''}</span>)}
            <span>№ {j.job_no}</span>
            {j.due_at && <span className={cx(j.overdue && 'text-[#D70015] dark:text-[#FF453A]')}>· до {fmtDue(j.due_at)}, {j.due_time || '18:00'}</span>}
          </div>
          {showTech && isOpen(j) && j.status !== 'open' && <div className="mt-1"><ReadTicks j={j} /></div>}
        </div>
        <div className="shrink-0 text-right">
          <div className="font-dot text-[18px] font-semibold text-accent-ink">+{pts(j.status === 'accepted' ? j.awarded : j.points)}</div>
          <div className="mt-1"><Pill tone={j.overdue ? 'red' : st.tone}>{j.overdue ? 'Просрочено' : st.label}</Pill></div>
        </div>
      </div>
      <Progress j={j} />
    </button>
  );
}

/* ---------------- Сотрудник: «Мои поручения» на главной ---------------- */

export function MyJobs() {
  const [items, setItems] = useState<Job[] | null>(null);
  const [open, setOpen] = useState<Job | null>(null);
  const load = useCallback(() => { api.jobs(false).then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);
  const cfgMe = useConfig().user.id;
  if (!items) return null;
  const review = items.filter((j) => j.reviewer_id === cfgMe && j.tg_id !== cfgMe && j.status === 'submitted');
  const mine = items.filter((j) => j.tg_id === cfgMe);
  const active = mine.filter(isOpen);
  const done = mine.filter((j) => j.status === 'accepted').slice(0, 5);
  if (!active.length && !done.length && !review.length) return null;
  return (
    <div className="mb-5">
      {review.length > 0 && (
        <>
          <SectionTitle>Принять работу · {review.length}</SectionTitle>
          <div className="mb-4 space-y-2.5">{review.map((j) => <JobRow key={j.id} j={j} showTech onClick={() => setOpen(j)} />)}</div>
        </>
      )}
      <SectionTitle>Поручения{active.length ? ` · ${active.length}` : ''}</SectionTitle>
      <div className="space-y-2.5">
        {active.map((j) => <JobRow key={j.id} j={j} onClick={() => setOpen(j)} />)}
        {!active.length && <div className="rounded-2xl bg-card p-4 text-[15px] text-muted">Открытых поручений нет</div>}
      </div>
      {done.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 px-1">
          {done.map((j) => <Pill key={j.id} tone="green">✓ {j.title.slice(0, 22)} · +{pts(j.awarded)}</Pill>)}
        </div>
      )}
      {open && <JobSheet job={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); load(); }} />}
    </div>
  );
}

/* ---------------- Карточка поручения (и для сотрудника, и для администратора) ---------------- */

export function JobSheet({ job, onClose, onChanged }: { job: Job; onClose: () => void; onChanged: () => void }) {
  const cfg = useConfig();
  const toast = useToast();
  const mine0 = job.tg_id === cfg.user.id;
  const admin = cfg.isAdmin && !mine0; // своё поручение менеджер сдаёт, а не принимает
  const mine = job.tg_id === cfg.user.id;
  const [count, setCount] = useState(job.done_count);
  const [report, setReport] = useState(job.report || '');
  const [award, setAward] = useState(job.late ? '0' : pts(job.points));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const canWork = mine && ['new', 'in_progress', 'returned'].includes(job.status);
  const free = job.status === 'open';
  useEffect(() => { if (mine && !job.seen_at) api.seenJob(job.id).catch(() => {}); }, [mine, job.id, job.seen_at]);

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await fn(); haptic.success(); toast(ok); onChanged(); } catch (e) { haptic.error(); toast((e as Error).message, 'error'); } finally { setBusy(''); }
  }

  return (
    <Sheet open onClose={onClose} title={`Поручение № ${job.job_no}`}>
      <div className="-mt-2 mb-4 flex flex-wrap items-center gap-2">
        <Pill tone={job.overdue ? 'red' : STATUS[job.status].tone}>{job.overdue ? 'Просрочено' : STATUS[job.status].label}</Pill>
        <Pill tone="blue">+{pts(job.status === 'accepted' ? job.awarded : job.points)} б в KPI</Pill>
        {job.due_at && <Pill tone={job.overdue ? 'red' : 'gray'}>до {fmtDue(job.due_at)}, {job.due_time || '18:00'}</Pill>}
        {job.due_at && (job.penalty ?? 0) > 0 && <Pill tone={job.penalized ? 'red' : 'gray'}>{job.penalized ? 'штраф' : 'просрочка'} −{pts(job.penalty)} б</Pill>}
      </div>
      <div className="text-[20px] font-semibold leading-snug">{job.title}</div>
      {job.descr && <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{job.descr}</p>}
      <div className="mt-2 text-[13px] text-muted">
        {free ? <>Для: <b className="text-ink">{audienceText(job.audience)}</b> · </> : admin && <>Исполнитель: <b className="text-ink">{job.tech_name}</b> · </>}Поставил: {job.author_name || '—'}
        {free ? ' · ждёт, кто заберёт' : job.claimed_at ? ` · забрал(а) ${hhmm(job.claimed_at)}` : job.ack_at ? ' · принято в работу' : job.seen_at ? ' · прочитал, не принял' : ' · ещё не открыл'}
        {job.reviewer_name && <> · принимает: <b className="text-ink">{job.reviewer_name}</b></>}
      </div>

      {free && !cfg.isAdmin && (
        <div className="mt-5 rounded-2xl bg-[#FF9500]/12 p-4">
          <div className="text-[14.5px]">Поручение свободно — кто первый заберёт, тот и выполняет и получает <b>+{pts(job.points)} б</b>.</div>
          <Button className="mt-3" icon={<Hand size={19} strokeWidth={1.75} />} loading={busy === 'cl'}
            onClick={() => run('cl', () => api.claimJob(job.id), 'Забрали — поручение ваше')}>Забрать</Button>
        </div>
      )}
      {free && cfg.isAdmin && (
        <div className="mt-4 rounded-2xl bg-[#FF9500]/12 p-3.5 text-[14.5px]">🙋 Ждёт, кто заберёт ({audienceText(job.audience)}). Как только кто-то нажмёт «Забрать» — вы получите уведомление, а здесь появится его имя.</div>
      )}
      {job.status === 'returned' && job.admin_note && (
        <div className="mt-4 rounded-2xl bg-[#FF3B30]/10 p-3.5 text-[14.5px]"><b>На доработку:</b> {job.admin_note}</div>
      )}
      {job.status === 'accepted' && (
        <div className="mt-4 rounded-2xl bg-[#34C759]/12 p-3.5 text-[14.5px]">✅ Принято{job.decided_by ? ` · ${job.decided_by}` : ''}{job.awarded ? ` · +${pts(job.awarded)} б` : ''}{job.admin_note ? ` · ${job.admin_note}` : ''}</div>
      )}

      {/* прогресс */}
      {job.target != null && (
        <div className="mt-5">
          <Field label={`Сделано из ${job.target}`}>
            {canWork ? (
              <div className="flex items-center justify-between gap-3">
                <Stepper value={count} onChange={setCount} />
                <Button variant="secondary" className="h-12 w-auto px-5 text-[15px]" loading={busy === 'p'} disabled={count === job.done_count}
                  onClick={() => run('p', () => api.jobProgress(job.id, count), 'Прогресс сохранён')}>Сохранить</Button>
              </div>
            ) : <Progress j={job} />}
          </Field>
        </div>
      )}

      {/* отчёт */}
      {canWork ? (
        <div className="mt-5">
          <Field label="Отчёт (что сделано, ссылки)">
            <TextArea rows={3} placeholder="Например: 10 видео загружены в чат офиса / ссылка на папку" value={report} onChange={(e) => setReport(e.target.value)} />
          </Field>
          {!job.ack_at && (
            <Button variant="secondary" className="mt-3" loading={busy === 'a'} onClick={() => run('a', () => api.ackJob(job.id), 'Принято в работу')}>Принял в работу</Button>
          )}
          <Button className="mt-3" icon={<Check size={19} strokeWidth={2} />} loading={busy === 's'}
            onClick={() => run('s', () => api.submitJob(job.id, report.trim(), job.target != null ? count : undefined), 'Сдано — офис проверит')}>
            Сдать задачу
          </Button>
          {job.target != null && count < job.target && <div className="mt-2 text-center text-[12.5px] text-muted">Сделано {count} из {job.target} — можно сдать и так, офис решит.</div>}
        </div>
      ) : job.report ? (
        <div className="mt-5 rounded-2xl bg-card p-3.5 text-[14.5px]"><div className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Отчёт</div><div className="whitespace-pre-wrap">{job.report}</div></div>
      ) : null}
      {mine && job.status === 'submitted' && <div className="mt-4 text-center text-[14px] text-muted">Сдано — ждёт проверки офиса.</div>}

      <JobFiles job={job} canUpload={isOpen(job) && !free && (mine || job.reviewer_id === cfg.user.id || cfg.isAdmin)} />

      {/* назначенный проверяющий (сотрудник или менеджер) */}
      {!mine && job.reviewer_id === cfg.user.id && job.status === 'submitted' && (
        <div className="mt-6 border-t border-dashed border-line pt-5">
          <div className="mb-2 text-[14.5px]">
            Работу принимаете вы. {job.late
              ? <>Сдано после срока — бонуса нет{job.penalized && job.penalty ? `, штраф −${pts(job.penalty)} б уже списан` : ''}.</>
              : <>После «Принять» исполнитель получит <b>+{pts(job.points)} б</b>.</>}
          </div>
          <TextArea rows={2} placeholder="Комментарий (при возврате — что доделать)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <Button variant="secondary" icon={<Undo2 size={18} strokeWidth={1.75} />} loading={busy === 'r'}
              onClick={() => run('r', () => api.reviewJob(job.id, false, note.trim()), 'Возвращено на доработку')}>На доработку</Button>
            <Button icon={<Check size={19} strokeWidth={2} />} loading={busy === 'ok'}
              onClick={() => run('ok', () => api.reviewJob(job.id, true, note.trim()), 'Принято — баллы начислены')}>Принять</Button>
          </div>
        </div>
      )}

      {/* администратор */}
      {admin && isOpen(job) && job.reviewer_id !== cfg.user.id && (
        <div className="mt-6 border-t border-dashed border-line pt-5">
          <div className={cx('grid grid-cols-[1fr_auto] items-end gap-3', free && 'hidden')}>
            <Field label="Начислить баллов">
              <Input inputMode="decimal" value={award} onChange={(e) => setAward(e.target.value)} />
            </Field>
            <div className="pb-3 text-[13px] text-muted">назначено {pts(job.points)}</div>
          </div>
          <div className={cx('mt-3', free && 'hidden')}><TextArea rows={2} placeholder="Комментарий (необязательно; при возврате — что доделать)" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <div className={cx('mt-3 grid grid-cols-2 gap-2.5', free && 'hidden')}>
            <Button variant="secondary" icon={<Undo2 size={18} strokeWidth={1.75} />} loading={busy === 'r'} disabled={job.status !== 'submitted'}
              onClick={() => run('r', () => api.decideJob(job.id, false, undefined, note.trim()), 'Возвращено на доработку')}>На доработку</Button>
            <Button icon={<Check size={19} strokeWidth={2} />} loading={busy === 'ok'}
              onClick={() => run('ok', () => api.decideJob(job.id, true, award, note.trim()), 'Принято, баллы начислены')}>Принять</Button>
          </div>
          {job.status !== 'submitted' && !free && <div className="mt-2 text-center text-[12.5px] text-muted">Ещё не сдано — «Принять» закроет поручение досрочно.</div>}
          <div className="mt-4 flex justify-center gap-6 text-[14px]">
            <button className="text-accent-ink" onClick={() => setEdit(true)}>Изменить</button>
            <button className="text-[#D70015] dark:text-[#FF453A]" onClick={() => setConfirmCancel(true)}>Отменить поручение</button>
          </div>
        </div>
      )}
      {admin && !isOpen(job) && (
        <Button variant="secondary" className="mt-6" loading={busy === 'o'} onClick={() => run('o', () => api.reopenJob(job.id), 'Поручение снова открыто')}>
          {job.status === 'accepted' ? 'Переоценить (снять баллы и открыть)' : 'Открыть снова'}
        </Button>
      )}

      {edit && <JobEditSheet job={job} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); onChanged(); }} />}
      {confirmCancel && (
        <ConfirmSheet title="Отменить поручение?" text="Сотрудник получит сообщение, баллы не начисляются." confirmLabel="Отменить поручение"
          onClose={() => setConfirmCancel(false)} onConfirm={() => run('c', () => api.cancelJob(job.id), 'Поручение отменено')} />
      )}
    </Sheet>
  );
}

/* ---------------- Поля поручения ---------------- */

const POINT_PRESETS = ['0,5', '1', '2', '3', '5'];

function JobFields({ v, set }: { v: JobInput; set: (p: Partial<JobInput>) => void }) {
  return (
    <div className="space-y-4">
      <Field label="Задача">
        <Input placeholder="Например: снять 10 рекламных видео" value={v.title} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Подробности (необязательно)">
        <TextArea rows={3} placeholder="Что именно, где, требования к результату" value={v.descr} onChange={(e) => set({ descr: e.target.value })} />
      </Field>
      <Field label="Количество, шт.">
        <Input inputMode="numeric" placeholder="не считать" value={v.target ?? ''} onChange={(e) => set({ target: e.target.value.replace(/\D/g, '') })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Срок — дата">
          <Input type="date" value={v.due_at ?? ''} onChange={(e) => set({ due_at: e.target.value || null })} />
        </Field>
        <Field label="Время">
          <Input type="time" value={v.due_time ?? ''} onChange={(e) => set({ due_time: e.target.value })} />
        </Field>
      </div>
      {v.due_at && <div className="-mt-2 px-1 text-[12.5px] text-muted">Без времени срок — до 18:00. За 1 час до срока бот каждые 5 мин напоминает сдать поручение.</div>}
      <Field label="Стоимость в бонусных баллах">
        <Input inputMode="decimal" value={String(v.points)} onChange={(e) => set({ points: e.target.value })} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {POINT_PRESETS.map((p) => (
            <button key={p} onClick={() => { haptic.tap(); set({ points: p }); }}
              className={cx('rounded-full px-3.5 py-1.5 text-[14px] font-medium', String(v.points) === p ? 'bg-accent text-black' : 'bg-fill')}>+{p}</button>
          ))}
        </div>
      </Field>
      {v.due_at && (
        <Field label="Штраф, если не сдано в срок">
          <Input inputMode="decimal" placeholder="0 — без штрафа" value={String(v.penalty ?? '')} onChange={(e) => set({ penalty: e.target.value })} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {['0', '0,5', '1', '2'].map((p) => (
              <button key={p} onClick={() => { haptic.tap(); set({ penalty: p }); }}
                className={cx('rounded-full px-3.5 py-1.5 text-[14px] font-medium', String(v.penalty ?? '') === p ? 'bg-[#D70015] text-white' : 'bg-fill')}>{p === '0' ? 'Без штрафа' : `−${p}`}</button>
            ))}
          </div>
          <div className="mt-1.5 px-1 text-[12.5px] text-muted">Сдал до срока — получает бонус. Не сдал к сроку — штраф списывается автоматически, бонуса нет.</div>
        </Field>
      )}
    </div>
  );
}

function JobEditSheet({ job, onClose, onSaved }: { job: Job; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<JobInput>({ title: job.title, descr: job.descr, due_at: job.due_at, due_time: job.due_time || '', penalty: job.penalty ? pts(job.penalty) : '', points: pts(job.points), target: job.target ?? '' });
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title="Изменить поручение">
      <JobFields v={v} set={(p) => setV((x) => ({ ...x, ...p }))} />
      <Button className="mt-6" loading={busy} onClick={async () => {
        setBusy(true);
        try { await api.updateJob(job.id, v); toast('Сохранено'); onSaved(); } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
      }}>Сохранить</Button>
    </Sheet>
  );
}

/* ---------------- Администратор: «Новая задача» — обработка или поручение ---------------- */

type Kind = 'task' | 'job';
const ROLE_SHORT: Record<string, string> = { tech: 'дезинсектор', specialist: 'специалист', manager: 'менеджер' };

export function NewTaskSheet({ initialKind = 'task', onClose, onCreated }: { initialKind?: Kind; onClose: () => void; onCreated: (kind: Kind) => void }) {
  const cfg = useConfig();
  const toast = useToast();
  // менеджеру доступны только разрешённые виды задач
  const perm = (p: string) => Boolean(cfg.user.isOwner) || (cfg.user.perms || []).includes(p);
  const canTask = perm('tasks');
  const canJob = perm('jobs') || perm('tasks');
  const [kind, setKind] = useState<Kind>(!canTask ? 'job' : initialKind);
  const [people, setPeople] = useState<Assignee[] | null>(null);
  const [who, setWho] = useState<string[]>([]);
  const [lead, setLead] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [busy, setBusy] = useState(false);
  // «Конкретным» — выбрать людей; «Кто заберёт» — отправить категории, первый нажавший «Забрать» становится исполнителем
  const [mode, setMode] = useState<'pick' | 'open'>('pick');
  const [aud, setAud] = useState<Audience>('all');
  const [bonus, setBonus] = useState('');
  const teamOn = cfg.features?.team !== false;
  const reviewerOn = cfg.features?.job_reviewer !== false;
  const [job, setJob] = useState<JobInput>({ title: '', descr: '', due_at: null, due_time: '', points: '1', target: '' });
  const [t, setT] = useState<AdminTaskInput>({ tech: '', company: '', address: '', phone: '', date: '', time: '', procedure: '', pests: [], comment: '', rooms: '', stage: '', price: '', mult: '', point_cat: '', point_zone: 'city', team: [] });
  const setTask = (p: Partial<AdminTaskInput>) => setT((x) => ({ ...x, ...p }));

  useEffect(() => { api.assignees().then((r) => setPeople(r.items)).catch(() => setPeople([])); }, []);
  // специалисты — первыми: поручения обычно им
  // поручения: сначала специалисты, менеджеры — в конце; обработки — без менеджеров; себе поручение не ставим
  const order = { specialist: 0, tech: 1, manager: 2 } as Record<string, number>;
  const sorted = useMemo(() => [...(people || [])]
    .filter((p) => p.id !== cfg.user.id && (kind === 'job' || p.role !== 'manager'))
    .sort((a, b) => (order[a.role] - order[b.role]) || a.name.localeCompare(b.name)), [people, kind, cfg.user.id]);
  const pests = t.procedure ? cfg.pestsByProcedure?.[t.procedure] || [] : [];
  const crown = useCrown();

  function toggle(id: string) {
    haptic.tap();
    if (kind === 'task' && !teamOn) { setWho([id]); setLead(id); return; }
    setWho((w) => {
      const next = w.includes(id) ? w.filter((x) => x !== id) : [...w, id];
      // ответственный — первый выбранный, пока его не сменили вручную
      setLead((l) => (next.includes(l) ? l : next[0] || ''));
      if (next.includes(reviewer)) setReviewer('');
      return next;
    });
  }

  async function submit() {
    if (mode === 'pick' && !who.length) { toast('Выберите сотрудника', 'error'); return; }
    setBusy(true);
    try {
      if (mode === 'open') {
        if (kind === 'job') await api.createJob([], { ...job, reviewer_id: reviewer || undefined }, aud);
        else await api.createAdminTask({ ...t, tech: '', team: [], audience: aud === 'manager' ? 'all' : aud, claim_bonus: bonus });
        toast(`Отправлено: ${audienceText(aud)} — ждём, кто заберёт`);
      } else if (kind === 'job') {
        await api.createJob(who, { ...job, reviewer_id: reviewer || undefined });
        toast(who.length > 1 ? `Поручение отправлено: ${who.length} сотрудникам` : 'Поручение отправлено');
      } else {
        const main = who.includes(lead) ? lead : who[0];
        const r = await api.createAdminTask({ ...t, tech: main, team: who.filter((x) => x !== main) });
        toast(who.length > 1 ? `Заявка № ${r.task_no} · команда из ${who.length}` : `Заявка № ${r.task_no} отправлена`);
      }
      haptic.success();
      onCreated(kind);
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Новая задача">
      <div className="-mt-2 mb-5">
        {canTask && canJob && (
          <Segmented<Kind> options={[{ id: 'task', label: 'Обработка' }, { id: 'job', label: 'Поручение' }]} value={kind}
            onChange={(k) => {
              setKind(k);
              // менеджеров нельзя назначить на обработку
              if (k === 'task') setWho((w) => (teamOn ? w : w.slice(0, 1)).filter((id) => people?.find((p) => p.id === id)?.role !== 'manager'));
              if (k === 'task' && aud === 'manager') setAud('all');
            }} />
        )}
        <div className="mt-2">
          <Segmented<'pick' | 'open'> options={[{ id: 'pick', label: 'Конкретным' }, { id: 'open', label: '🙋 Кто заберёт' }]} value={mode} onChange={(m) => { haptic.tap(); setMode(m); }} />
        </div>
        <div className="mt-2 px-1 text-[12.5px] leading-snug text-muted">
          {kind === 'task'
            ? 'Выезд на объект — как заявка из чата офиса: придёт сотруднику с напоминаниями, копия — в его тему или чат офиса.'
            : 'Любая другая работа (видео, реклама, доставка…) со стоимостью в бонусных баллах. Можно выбрать нескольких — каждому своё.'}
        </div>
      </div>

      {mode === 'open' && (
        <div className="rounded-2xl bg-[#FF9500]/[0.1] p-3.5">
          <Field label="Категория сотрудников">
            <Chips options={(Object.keys(AUDIENCE_LABEL) as Audience[]).filter((a) => kind === 'job' || a !== 'manager').map((a) => ({ id: a, label: AUDIENCE_LABEL[a] }))}
              value={aud} onChange={(a) => setAud(a as Audience)} columns={kind === 'job' ? 2 : 3} />
          </Field>
          {kind === 'task' && (
            <div className="mt-3">
              <Field label="Бонус тому, кто заберёт, б">
                <Input inputMode="decimal" placeholder="0 — без бонуса" value={bonus} onChange={(e) => setBonus(e.target.value)} />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {['0,5', '1', '2'].map((b) => (
                    <button key={b} onClick={() => { haptic.tap(); setBonus(b); }}
                      className={cx('rounded-full px-3.5 py-1.5 text-[14px] font-medium', bonus === b ? 'bg-accent text-black' : 'bg-card')}>+{b}</button>
                  ))}
                </div>
              </Field>
            </div>
          )}
          <div className="mt-2 px-1 text-[12.5px] leading-snug text-muted">
            Всем из категории придёт сообщение с кнопкой «🙋 Забрать». Кто первый нажмёт — тот исполнитель{kind === 'task' ? ' (бонус начислится после завершения выезда)' : ` и получит +${String(job.points || 0)} б после приёмки`}. Вы увидите, кто забрал, у остальных сообщение обновится.
          </div>
        </div>
      )}

      {mode === 'pick' && <Field label={kind === 'job' ? 'Кому (можно несколько)' : teamOn ? 'Кто едет (можно несколько — команда)' : 'Кому'}>
        {!people ? <Spinner /> : sorted.length === 0 ? (
          <div className="rounded-2xl bg-card p-3.5 text-[14px] text-muted">Нет активных сотрудников</div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {sorted.map((p) => {
              const on = who.includes(p.id);
              return (
                <button key={p.id} onClick={() => toggle(p.id)}
                  className={cx('min-h-[52px] rounded-2xl px-3 py-2 text-left transition', on ? 'bg-accent text-black' : 'bg-card ring-1 ring-inset ring-line')}>
                  <div className="truncate text-[15px] font-medium">{crown(p.id)}{p.name}</div>
                  <div className={cx('text-[11.5px]', on ? 'text-black/70' : 'text-muted')}>{ROLE_SHORT[p.role] || p.role}{kind === 'task' && on && who.length > 1 && lead === p.id ? ' · ответственный' : ''}{p.bot_blocked ? ' · 🤖 бот не запущен' : ''}</div>
                </button>
              );
            })}
          </div>
        )}
        {kind === 'task' && who.length > 1 && (
          <div className="mt-3 rounded-2xl bg-accent/[0.08] p-3">
            <div className="mb-2 px-1 text-[13px] font-medium">Ответственный — ведёт акт и получает оплату наличными</div>
            <div className="flex flex-wrap gap-1.5">
              {who.map((id) => {
                const p = sorted.find((x) => x.id === id);
                return (
                  <button key={id} onClick={() => { haptic.tap(); setLead(id); }}
                    className={cx('rounded-full px-3.5 py-1.5 text-[14px] font-medium', lead === id ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>{p?.name || id}</button>
                );
              })}
            </div>
            <div className="mt-2 px-1 text-[12.5px] text-muted">
              Баллы за объект — каждому полностью. Стоимость заказа делится поровну на {who.length}{t.price ? `: по ${Math.round(Number(t.price.replace(',', '.')) / who.length)} лей` : ''}. Остальным придёт сообщение «Вы в команде».
            </div>
          </div>
        )}
      </Field>}
      {kind === 'job' && reviewerOn && people && (
        <div className={cx(mode === 'open' && 'mt-4')}>
          <div className="mt-3">
            <div className="mb-2 px-1 text-[13px] font-medium">Кто принимает работу</div>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => { haptic.tap(); setReviewer(''); }}
                className={cx('rounded-full px-3.5 py-1.5 text-[14px] font-medium', !reviewer ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>Офис</button>
              {sorted.filter((p) => !who.includes(p.id)).map((p) => (
                <button key={p.id} onClick={() => { haptic.tap(); setReviewer(p.id); }}
                  className={cx('rounded-full px-3.5 py-1.5 text-[14px] font-medium', reviewer === p.id ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>{p.name}</button>
              ))}
            </div>
            <div className="mt-1.5 px-1 text-[12.5px] text-muted">{reviewer ? 'Сотрудник сдаёт ему; когда он нажмёт «Принять» — баллы идут в зачёт. Офис видит всё.' : 'Работу принимает офис (кнопки в чате офиса или здесь).'}</div>
          </div>
        </div>
      )}
      {mode === 'pick' && <div>
        {kind === 'job' && people && !people.some((p) => p.role === 'specialist') && (
          <div className="mt-2 px-1 text-[12.5px] text-muted">Роль «Специалист» пока никому не назначена — это можно сделать в «Сотрудники».</div>
        )}
      </div>}

      <div className="mt-5">
        {kind === 'job' ? <JobFields v={job} set={(p) => setJob((x) => ({ ...x, ...p }))} /> : (
          <div className="space-y-4">
            <Field label="Адрес"><Input placeholder="Город, улица, дом, кв." value={t.address} onChange={(e) => setTask({ address: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Клиент / компания"><Input placeholder="Физлицо" value={t.company} onChange={(e) => setTask({ company: e.target.value })} /></Field>
              <Field label="Телефон"><Input inputMode="tel" placeholder="060…" value={t.phone} onChange={(e) => setTask({ phone: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Дата"><Input type="date" value={t.date} onChange={(e) => setTask({ date: e.target.value })} /></Field>
              <Field label="Время"><Input type="time" value={t.time} onChange={(e) => setTask({ time: e.target.value })} /></Field>
            </div>
            <PointCatPicker t={t} setTask={setTask} people={who.length} />
            <Field label="Обработка">
              <Chips options={(cfg.procedures || []).map((p) => ({ id: p, label: p }))} value={t.procedure} onChange={(p) => setTask({ procedure: p === t.procedure ? '' : p, pests: [] })} />
            </Field>
            {pests.length > 0 && (
              <Field label="Вредители"><MultiChips options={pests} value={t.pests} onChange={(v) => setTask({ pests: v })} columns={3} /></Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Комнат"><Input inputMode="numeric" value={t.rooms} onChange={(e) => setTask({ rooms: e.target.value.replace(/\D/g, '') })} /></Field>
              <Field label="Соток"><Input inputMode="decimal" placeholder="—" value={t.sotki ?? ''} onChange={(e) => setTask({ sotki: e.target.value })} /></Field>
              <Field label="Этап"><Input placeholder="1/2" value={t.stage} onChange={(e) => setTask({ stage: e.target.value })} /></Field>
              <Field label="Цена, лей"><Input inputMode="decimal" value={t.price} onChange={(e) => setTask({ price: e.target.value })} /></Field>
            </div>
            <Field label="Комментарий"><TextArea rows={2} placeholder="Контакт, подъезд, особенности" value={t.comment} onChange={(e) => setTask({ comment: e.target.value })} /></Field>
            <Field label="Повышенный коэффициент">
              <div className="flex flex-wrap gap-1.5">
                {['', ...MULT_PRESETS].map((m) => (
                  <button key={m || 'none'} onClick={() => { haptic.tap(); setTask({ mult: m }); }}
                    className={cx('rounded-full px-3.5 py-1.5 text-[14px] font-medium', t.mult === m ? (m ? 'bg-[#AF52DE] text-white' : 'bg-ink text-card') : 'bg-fill')}>{m ? `×${m}` : 'Нет'}</button>
                ))}
              </div>
              <div className="mt-1.5 px-1 text-[12.5px] text-muted">Баллы за выезд умножаются, заявка выделяется фиолетовым. Воскресенье — ×2,5 автоматически.</div>
            </Field>
          </div>
        )}
      </div>

      <Button className="mt-6" loading={busy} icon={<Check size={19} strokeWidth={2} />} onClick={submit}>
        {mode === 'open' ? `Отправить: ${AUDIENCE_LABEL[aud].toLowerCase()}` : kind === 'job' ? (who.length > 1 ? `Поставить ${who.length} сотрудникам` : 'Поставить поручение') : 'Отправить заявку'}
      </Button>
    </Sheet>
  );
}

/* ---------------- Администратор: кнопка «Новая задача» ---------------- */

export function NewTaskButton({ onCreated, kind }: { onCreated?: (k: Kind) => void; kind?: Kind }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={<Plus size={20} strokeWidth={2} />} onClick={() => { haptic.tap(); setOpen(true); }}>Новая задача</Button>
      {open && <NewTaskSheet initialKind={kind} onClose={() => setOpen(false)} onCreated={(k) => { setOpen(false); onCreated?.(k); }} />}
    </>
  );
}

/* ---------------- Администратор: обзор — поручения на проверке ---------------- */

export function JobsReviewWidget({ onAll, refreshKey = 0 }: { onAll: () => void; refreshKey?: number }) {
  const [items, setItems] = useState<Job[] | null>(null);
  const [open, setOpen] = useState<Job | null>(null);
  const load = useCallback(() => { api.jobs(true).then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  useEffect(() => { load(); }, [load, refreshKey]);
  if (!items) return null;
  const act = items.filter(isOpen);
  const review = act.filter((j) => j.status === 'submitted');
  const overdue = act.filter((j) => j.overdue);
  return (
    <div className="mt-4 rounded-[22px] bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-ink"><ClipboardList size={20} strokeWidth={1.75} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold">Поручения</div>
          <div className="text-[13px] text-muted">
            в работе {act.length - review.length} · на проверке {review.length}{overdue.length ? ` · просрочено ${overdue.length}` : ''}
            {act.some((j) => !j.ack_at && j.status !== 'submitted' && j.status !== 'open') && <span className="text-[#D70015] dark:text-[#FF453A]"> · не приняли {act.filter((j) => !j.ack_at && j.status !== 'submitted' && j.status !== 'open').length}</span>}
          </div>
        </div>
        <button onClick={onAll} className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink">Все →</button>
      </div>
      {review.length > 0 && <div className="mt-3 space-y-2">{review.map((j) => <JobRow key={j.id} j={j} showTech onClick={() => setOpen(j)} />)}</div>}
      {open && <JobSheet job={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); load(); }} />}
    </div>
  );
}

/* ---------------- Администратор: вкладка «Поручения» ---------------- */

type Filter = 'open' | 'review' | 'closed';

export function JobsPanel() {
  const [items, setItems] = useState<Job[] | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [tech, setTech] = useState('');
  const [open, setOpen] = useState<Job | null>(null);
  const load = useCallback(() => { api.jobs(true).then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  useEffect(() => { load(); }, [load]);

  const techs = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of items || []) if (j.tg_id) m.set(j.tg_id, j.tech_name || '—');
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [items]);
  const list = (items || []).filter((j) => (!tech || j.tg_id === tech) && (
    filter === 'open' ? ['open', 'new', 'in_progress', 'returned'].includes(j.status) : filter === 'review' ? j.status === 'submitted' : !isOpen(j)));
  const count = (f: Filter) => (items || []).filter((j) => (!tech || j.tg_id === tech) && (f === 'open' ? ['open', 'new', 'in_progress', 'returned'].includes(j.status) : f === 'review' ? j.status === 'submitted' : !isOpen(j))).length;
  const awarded = (items || []).filter((j) => j.status === 'accepted' && (!tech || j.tg_id === tech)).reduce((s, j) => s + (j.awarded || 0), 0);

  return (
    <div>
      <div className="mb-5 grid gap-3 md:grid-cols-[1fr_260px] md:items-center">
        <p className="text-[14px] leading-snug text-muted">
          Обработки из чата офиса — это заявки. Здесь — поручения со стоимостью в бонусных баллах: сотрудник сдаёт, вы принимаете, баллы идут в KPI.
        </p>
        <NewTaskButton kind="job" onCreated={load} />
      </div>
      <div className="mb-3"><Segmented<Filter> options={[
        { id: 'open', label: `В работе · ${count('open')}` }, { id: 'review', label: `На проверке · ${count('review')}` }, { id: 'closed', label: `Закрытые · ${count('closed')}` },
      ]} value={filter} onChange={setFilter} /></div>
      {(() => {
        const unread = (items || []).filter((j) => isOpen(j) && j.status !== 'open' && !j.ack_at && (!tech || j.tg_id === tech));
        if (!unread.length) return null;
        return (
          <div className="mb-4 rounded-2xl bg-[#D71921]/10 px-4 py-3 text-[14px]">
            <b>Не приняли в работу · {unread.length}</b>
            <div className="mt-1 space-y-0.5 text-[13px]">
              {unread.map((j) => (
                <button key={j.id} onClick={() => setOpen(j)} className="flex w-full items-center gap-2 text-left">
                  <span className="min-w-0 flex-1 truncate">{j.tech_name} — «{j.title}»</span>
                  <ReadTicks j={j} />
                </button>
              ))}
            </div>
          </div>
        );
      })()}
      {techs.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {[{ id: '', name: 'Все' }, ...techs].map((t) => (
            <button key={t.id} onClick={() => { haptic.tap(); setTech(t.id); }}
              className={cx('rounded-full px-3.5 py-1.5 text-[14px] font-medium', tech === t.id ? 'bg-accent text-black' : 'bg-card ring-1 ring-inset ring-line')}>{t.name}</button>
          ))}
        </div>
      )}
      {filter === 'closed' && awarded > 0 && <div className="mb-3 px-1 text-[13px] text-muted">Начислено за принятые (45 дней): <b className="text-ink">+{pts(awarded)} б</b></div>}
      {!items ? <Spinner /> : list.length === 0 ? (
        <div className="rounded-2xl bg-card p-6 text-center text-[15px] text-muted">
          <CalendarClock size={32} strokeWidth={1.25} className="mx-auto mb-2" />
          {filter === 'review' ? 'Нечего проверять' : filter === 'open' ? 'Открытых поручений нет' : 'Закрытых поручений пока нет'}
        </div>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">{list.map((j) => <JobRow key={j.id} j={j} showTech onClick={() => setOpen(j)} />)}</div>
      )}
      {open && <JobSheet job={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); load(); }} />}
    </div>
  );
}

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
/** Попадает ли день/время в окно повышенного коэффициента (как на сервере). */
export function inBoostWindow(w: BoostWindow, wd: number, hm: string) {
  const from = w.from || '00:00'; const to = w.to || '24:00';
  if (from < to) return w.days.includes(wd) && hm >= from && hm < to;
  return (w.days.includes(wd) && hm >= from) || (w.days.includes((wd + 6) % 7) && hm < to);
}
export const windowText = (w: BoostWindow) => `${w.days.map((d) => WD[d]).join(', ')} ${w.from}–${w.to}`;

/** Тип помещения (категория баллов) + удалённость и прогноз баллов с учётом коэффициента. */
function PointCatPicker({ t, setTask, people = 1 }: { t: AdminTaskInput; setTask: (p: Partial<AdminTaskInput>) => void; people?: number }) {
  const cfg = useConfig();
  const cat = cfg.pointCats.find((c) => c.id === t.point_cat);
  const base = cat ? (cat.zones ? Number(cat.zones[(t.point_zone || 'city') as keyof typeof cat.zones] ?? cat.points) : cat.points) : 0;
  // коэффициент: вручную или по дню недели / особому периоду выбранной даты — берётся наибольший
  let mult = t.mult ? Number(t.mult.replace(',', '.')) : 1;
  let why = t.mult ? 'вручную' : '';
  if (t.date && cfg.multCfg) {
    const wd = (new Date(`${t.date}T12:00:00Z`).getUTCDay() + 6) % 7;
    const w = Number(cfg.multCfg.weekday?.[wd]) || 1;
    if (w > mult) { mult = w; why = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'][wd]; }
    for (const sp of cfg.multCfg.special || []) if (t.date >= sp.from && t.date <= (sp.to || sp.from) && sp.mult > mult) { mult = sp.mult; why = sp.label; }
    const hm = t.time || '12:00';
    for (const w of cfg.multCfg.windows || []) if (inBoostWindow(w, wd, hm) && Number(w.mult) > mult) { mult = Number(w.mult); why = w.label || windowText(w); }
  }
  const pestTop = t.pests.map((p) => ({ p, k: Number(cfg.pestMult?.[p]) || 1 })).reduce((a, b) => (b.k > a.k ? b : a), { p: '', k: 1 });
  const ex = cfg.pointExtras;
  const rooms = Number(t.rooms) || 0; const sotki = Number(String(t.sotki || '').replace(',', '.')) || 0;
  const extra = (ex && ex.per_room > 0 && rooms > ex.free_rooms ? (rooms - ex.free_rooms) * ex.per_room : 0)
    + (ex && ex.per_sotka > 0 && sotki > ex.free_sotki ? (sotki - ex.free_sotki) * ex.per_sotka : 0);
  const total = Math.round((base + extra) * pestTop.k * mult * 100) / 100;
  const fmt = (x: number) => String(x).replace('.', ',');
  return (
    <>
      <Field label="Тип помещения (для баллов)">
        <Chips options={cfg.pointCats.map((c) => ({ id: c.id, label: c.label }))} value={t.point_cat}
          onChange={(id) => setTask({ point_cat: id === t.point_cat ? '' : id })} columns={3} />
      </Field>
      {cat?.zones && (
        <Field label="Удалённость">
          <Chips options={cfg.pointZones} value={t.point_zone || 'city'} onChange={(z) => setTask({ point_zone: z })} columns={3} />
        </Field>
      )}
      {cat && (
        <div className={cx('rounded-2xl px-4 py-3 text-[14px]', mult > 1 ? 'bg-[#AF52DE]/12 dark:bg-[#BF5AF2]/15' : 'bg-accent/[0.08]')}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted">
              {cat.label}: {fmt(base)}{extra ? ` + ${fmt(Math.round(extra * 100) / 100)} (размер)` : ''}{pestTop.k !== 1 ? ` × ${fmt(pestTop.k)} (${pestTop.p.toLowerCase()})` : ''}{mult > 1 ? ` × ${fmt(mult)} (${why})` : ''}
              <span className="block text-[12px]">Сотрудник увидит тип в заявке; вечерняя надбавка добавится при завершении.</span>
            </span>
            <span className={cx('shrink-0 font-dot text-[22px] font-semibold', mult > 1 ? 'text-[#8E3BB8] dark:text-[#D08CF5]' : 'text-accent-ink')}>{fmt(total)} б</span>
          </div>
          {people > 1 && <div className="mt-1 text-[13px] font-medium">👥 каждому из {people} — {fmt(total)} б{t.price ? ` · стоимость по ${Math.round(Number(t.price.replace(',', '.')) / people)} лей` : ''}</div>}
        </div>
      )}
    </>
  );
}

/* ---------------- Файлы к поручению ---------------- */

const fmtSize = (b: number) => (b >= 1073741824 ? `${String(Math.round((b / 1073741824) * 10) / 10).replace('.', ',')} ГБ` : b > 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`);
const fileIcon = (f: JobFile) => (f.kind === 'video' ? '🎬' : f.kind === 'photo' ? '📷' : '📄');

function JobFiles({ job, canUpload }: { job: Job; canUpload: boolean }) {
  const cfg = useConfig();
  const toast = useToast();
  const [files, setFiles] = useState<JobFile[]>(job.files || []);
  const [progress, setProgress] = useState<number | null>(null);
  const [current, setCurrent] = useState('');
  const input = useRef<HTMLInputElement | null>(null);
  const maxMb = cfg.uploadMaxMb || 50;
  if (!files.length && !canUpload) return null;
  async function pick(list: FileList | null) {
    if (!list?.length) return;
    const all = Array.from(list);
    let ok = 0;
    for (const [i, f] of all.entries()) {
      if (f.size > maxMb * 1024 * 1024) { toast(`${f.name}: больше ${fmtSize(maxMb * 1024 * 1024)}`, 'error'); continue; }
      setProgress(0);
      setCurrent(all.length > 1 ? `${i + 1} из ${all.length} · ${f.name}` : f.name);
      try {
        const r = await uploadJobFileAny(job.id, f, f.name || 'file', setProgress);
        ok += 1;
        setFiles((x) => [...x, { id: r.id, name: f.name, mime: f.type, size: f.size, kind: f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'photo' : 'document', tg_id: cfg.user.id, created_at: new Date().toISOString(), url: '', download_url: '' }]);
        haptic.success();
      } catch (e) { toast((e as Error).message, 'error'); }
    }
    setProgress(null); setCurrent('');
    if (ok) toast(ok > 1 ? `Прикреплено файлов: ${ok} — каждый ушёл отдельно` : 'Файл прикреплён — офис его видит');
  }
  return (
    <div className="mt-5">
      <div className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Файлы · {files.length}</div>
      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded-xl bg-card px-3 py-2">
              <span className="text-[18px]">{fileIcon(f)}</span>
              <div className="min-w-0 flex-1">
                {f.kind === 'photo'
                  ? <button onClick={() => { const ph = files.filter((x) => x.kind === 'photo'); openPhotos(ph.map((x) => x.url), ph.indexOf(f)); }} className="block max-w-full truncate text-left text-[14px] font-medium text-accent-ink">{f.name}</button>
                  : <div className="truncate text-[14px] font-medium">{f.name}</div>}
                <div className="text-[11.5px] text-muted">{fmtSize(f.size)}</div>
              </div>
              {f.download_url && (f.stored || f.size <= 20 * 1024 * 1024) && (
                <button onClick={() => openLink(f.download_url)} className="shrink-0 rounded-full bg-fill px-3 py-1.5 text-[12.5px] font-medium">⬇</button>
              )}
              <button onClick={async () => { try { await api.jobFileSendMe(job.id, f.id); toast('Отправлено вам в Telegram'); } catch (e) { toast((e as Error).message, 'error'); } }}
                className="shrink-0 rounded-full bg-fill px-3 py-1.5 text-[12.5px] font-medium">✈</button>
              {(f.tg_id === cfg.user.id || cfg.isAdmin) && isOpen(job) && (
                <button onClick={async () => { try { await api.deleteJobFile(job.id, f.id); setFiles((x) => x.filter((y) => y.id !== f.id)); } catch (e) { toast((e as Error).message, 'error'); } }}
                  className="shrink-0 px-1.5 text-[16px] text-muted">×</button>
              )}
            </div>
          ))}
        </div>
      )}
      {canUpload && (
        <>
          <input ref={input} type="file" multiple className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
          {progress !== null ? (
            <div className="mt-2">
              <div className="h-2 overflow-hidden rounded-full bg-fill"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
              <div className="mt-1 truncate text-center text-[12.5px] text-muted">{current ? `${current} · ` : 'Загрузка… '}{Math.round(progress * 100)}%</div>
            </div>
          ) : (
            <Button variant="secondary" className="mt-2 h-11 text-[15px]" icon={<Paperclip size={17} strokeWidth={1.75} />} onClick={() => input.current?.click()}>
              Прикрепить файл (видео, фото, документ)
            </Button>
          )}
          <div className="mt-1 px-1 text-[12px] text-muted">До {fmtSize(maxMb * 1024 * 1024)} каждый, можно выбрать сразу несколько. Каждый файл уходит проверяющему / в чат офиса отдельно и остаётся в поручении.</div>
        </>
      )}
    </div>
  );
}
