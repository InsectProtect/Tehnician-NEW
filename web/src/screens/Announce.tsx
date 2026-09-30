import { useCallback, useEffect, useState } from 'react';
import { Hand, Megaphone, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useConfig } from '../config';
import { haptic } from '../telegram';
import type { AnnColor, Announcement, AnnouncementAdmin, AnnouncementInput, Audience, Job, Task } from '../types';
import { Button, Chips, ConfirmSheet, Field, Input, SectionTitle, Sheet, TextArea, cx, multLabel, useToast } from '../components/ui';
import { JobSheet, audienceText } from './Jobs';

/*
 * Объявления (собрание, «в воскресенье ×2,5» …) — цветной баннер у сотрудников до нажатия «Понятно»,
 * и «Свободные задачи» — заявки/поручения для категории сотрудников: кто первый нажал «Забрать», тот исполнитель.
 */

export const ANN_COLORS: Record<AnnColor, { label: string; box: string; dot: string }> = {
  info: { label: '🟠 Инфо', box: 'bg-[#FF9500]/[0.14] ring-[#FF9500]/40', dot: 'bg-[#FF9500]' },
  boost: { label: '🟣 Коэффициент', box: 'bg-[#AF52DE]/[0.14] ring-[#AF52DE]/45 dark:bg-[#BF5AF2]/[0.18]', dot: 'bg-[#AF52DE]' },
  alert: { label: '🔴 Важно', box: 'bg-[#FF3B30]/[0.12] ring-[#FF3B30]/40', dot: 'bg-[#FF3B30]' },
  good: { label: '🟢 Хорошее', box: 'bg-[#34C759]/[0.14] ring-[#34C759]/40', dot: 'bg-[#34C759]' },
};
const AUD_OPTS: { id: Audience | 'everyone'; label: string }[] = [
  { id: 'all', label: 'Все сотрудники' }, { id: 'tech', label: 'Дезинсекторы' }, { id: 'specialist', label: 'Специалисты' },
  { id: 'manager', label: 'Менеджеры' }, { id: 'everyone', label: 'Все, включая админов' },
];
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const pts = (x?: number | null) => String(Math.round((x ?? 0) * 100) / 100).replace('.', ',');

/* ---------------- Сотрудник: цветные объявления на главной ---------------- */

export function AnnouncementBanners() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => { api.announcements().then((r) => setItems(r.items)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);
  const list = items.filter((a) => !a.acked);
  if (!list.length) return null;
  return (
    <div className="mb-5 space-y-2.5">
      {list.map((a) => {
        const c = ANN_COLORS[a.color] || ANN_COLORS.info;
        return (
          <div key={a.id} className={cx('rounded-[22px] p-4 ring-1 ring-inset', c.box)}>
            <div className="flex items-start gap-3">
              <div className={cx('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white', c.dot)}><Megaphone size={18} strokeWidth={1.75} /></div>
              <div className="min-w-0 flex-1">
                <div className="break-words text-[17px] font-semibold leading-snug">{a.title}</div>
                {a.body && <div className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed">{a.body}</div>}
                <div className="mt-1.5 text-[12.5px] text-muted">{a.author_name} · {when(a.created_at)}{a.expires_at ? ` · до ${new Date(`${a.expires_at}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}` : ''}</div>
              </div>
            </div>
            <Button variant="secondary" className="mt-3 h-11 text-[15px]" loading={busy === a.id} onClick={async () => {
              setBusy(a.id); haptic.success();
              try { await api.ackAnnouncement(a.id); setItems((x) => x.map((y) => (y.id === a.id ? { ...y, acked: true } : y))); } catch { /* повторим позже */ } finally { setBusy(''); }
            }}>Понятно</Button>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Администратор: кнопка и форма объявления ---------------- */

export function AnnounceSheet({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<AnnouncementInput>({ title: '', body: '', color: 'info', audience: 'all', expires_at: null });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<AnnouncementInput>) => setV((x) => ({ ...x, ...p }));
  const c = ANN_COLORS[v.color];
  return (
    <Sheet open onClose={onClose} title="Объявление">
      <div className="-mt-2 mb-4 flex flex-wrap gap-1.5">
        {['Собрание', 'В воскресенье повышенный коэффициент', 'Выходной день'].map((p) => (
          <button key={p} onClick={() => { haptic.tap(); set({ title: p, color: p.includes('коэффициент') ? 'boost' : v.color }); }}
            className="rounded-full bg-fill px-3.5 py-1.5 text-[13.5px] font-medium">{p}</button>
        ))}
      </div>
      <div className="space-y-4">
        <Field label="Заголовок"><Input placeholder="Например: собрание в пятницу в 10:00" value={v.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Текст (необязательно)"><TextArea rows={3} placeholder="Подробности: где, что взять с собой…" value={v.body} onChange={(e) => set({ body: e.target.value })} /></Field>
        <Field label="Цвет"><Chips options={(Object.keys(ANN_COLORS) as AnnColor[]).map((k) => ({ id: k, label: ANN_COLORS[k].label }))} value={v.color} onChange={(x) => set({ color: x as AnnColor })} /></Field>
        <Field label="Кому"><Chips options={AUD_OPTS} value={v.audience} onChange={(x) => set({ audience: x as AnnouncementInput['audience'] })} /></Field>
        <Field label="Показывать до (необязательно)"><Input type="date" value={v.expires_at ?? ''} onChange={(e) => set({ expires_at: e.target.value || null })} /></Field>
        {v.title.trim() && (
          <div className={cx('rounded-[22px] p-4 ring-1 ring-inset', c.box)}>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Так увидят сотрудники</div>
            <div className="mt-1 text-[17px] font-semibold">{v.title}</div>
            {v.body && <div className="mt-1 whitespace-pre-wrap text-[15px]">{v.body}</div>}
          </div>
        )}
      </div>
      <Button className="mt-6" icon={<Megaphone size={19} strokeWidth={1.75} />} loading={busy} onClick={async () => {
        if (v.title.trim().length < 3) { toast('Введите заголовок', 'error'); return; }
        setBusy(true);
        try { const r = await api.createAnnouncement({ ...v, title: v.title.trim(), body: v.body.trim() }); haptic.success(); toast(`Отправлено: ${r.sent}`); onSent(); } catch (e) { haptic.error(); toast((e as Error).message, 'error'); setBusy(false); }
      }}>Отправить объявление</Button>
      <p className="mt-2 px-1 text-center text-[12.5px] text-muted">Придёт в бота и появится цветным баннером на главной, пока сотрудник не нажмёт «Понятно».</p>
    </Sheet>
  );
}

export function AnnounceButton({ onSent }: { onSent?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" icon={<Megaphone size={19} strokeWidth={1.75} />} onClick={() => { haptic.tap(); setOpen(true); }}>Объявление</Button>
      {open && <AnnounceSheet onClose={() => setOpen(false)} onSent={() => { setOpen(false); onSent?.(); }} />}
    </>
  );
}

/** Обзор: последние объявления — кто прочитал, кто нет. */
export function AnnouncementsWidget({ refreshKey = 0 }: { refreshKey?: number }) {
  const toast = useToast();
  const [items, setItems] = useState<AnnouncementAdmin[] | null>(null);
  const [del, setDel] = useState<AnnouncementAdmin | null>(null);
  const [openId, setOpenId] = useState('');
  const load = useCallback(() => { api.adminAnnouncements().then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  useEffect(() => { load(); }, [load, refreshKey]);
  const list = (items || []).slice(0, 5);
  if (!list.length) return null;
  return (
    <div className="mt-4 rounded-[22px] bg-card p-4">
      <div className="mb-2 flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#FF9500]/15 text-[#C93400] dark:text-[#FF9F0A]"><Megaphone size={20} strokeWidth={1.75} /></div>
        <div className="text-[16px] font-semibold">Объявления</div>
      </div>
      <div className="space-y-2">
        {list.map((a) => {
          const c = ANN_COLORS[a.color] || ANN_COLORS.info;
          const all = a.total > 0 && a.read >= a.total;
          return (
            <div key={a.id} className={cx('rounded-2xl p-3 ring-1 ring-inset', c.box)}>
              <button className="block w-full min-w-0 text-left" onClick={() => setOpenId(openId === a.id ? '' : a.id)}>
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug">{a.title}</span>
                  <span className={cx('shrink-0 text-[13px] font-medium', all ? 'text-[#248A3D] dark:text-[#30D158]' : 'text-[#D70015] dark:text-[#FF453A]')}>
                    {all ? '✓✓ все' : `✓✓ ${a.read} из ${a.total}`}
                  </span>
                </div>
                <div className="mt-0.5 text-[12.5px] text-muted">{AUD_OPTS.find((x) => x.id === a.audience)?.label} · {when(a.created_at)}</div>
              </button>
              {openId === a.id && (
                <div className="mt-2 border-t border-dashed border-line pt-2 text-[13.5px]">
                  {a.body && <div className="mb-1.5 whitespace-pre-wrap">{a.body}</div>}
                  {a.unread.length > 0 ? <div><b>Не прочитали:</b> {a.unread.join(', ')}</div> : <div className="text-muted">Прочитали все.</div>}
                  <button className="mt-2 inline-flex items-center gap-1 text-[#D70015] dark:text-[#FF453A]" onClick={() => setDel(a)}><Trash2 size={14} strokeWidth={1.75} /> Удалить</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {del && (
        <ConfirmSheet title="Удалить объявление?" text={`«${del.title}» исчезнет у всех сотрудников.`} confirmLabel="Удалить"
          onClose={() => setDel(null)} onConfirm={async () => {
            try { await api.deleteAnnouncement(del.id); toast('Удалено'); setDel(null); load(); } catch (e) { toast((e as Error).message, 'error'); }
          }} />
      )}
    </div>
  );
}

/* ---------------- Сотрудник: свободные задачи «кто заберёт» ---------------- */

const fmtWhen = (t: Task) => (t.planned_at ? new Date(t.planned_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', ...(t.has_time ? { hour: '2-digit', minute: '2-digit' } : {}) }) : 'дата не указана');

export function OpenWork({ refreshKey = 0, onClaimed }: { refreshKey?: number; onClaimed?: () => void }) {
  const cfg = useConfig();
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const load = useCallback(() => {
    api.tasks().then((r) => setTasks(r.open_tasks || [])).catch(() => {});
    api.jobs(false).then((r) => setJobs(r.items.filter((j) => j.status === 'open'))).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);
  if (!tasks.length && !jobs.length) return null;

  async function claim(kind: 'task' | 'job', id: string) {
    setBusy(id);
    try {
      if (kind === 'task') await api.claimTask(id); else await api.claimJob(id);
      haptic.success(); toast(kind === 'task' ? 'Заявка ваша — она появилась в списке' : 'Поручение ваше');
      load(); onClaimed?.();
    } catch (e) { haptic.error(); toast((e as Error).message, 'error'); load(); } finally { setBusy(''); }
  }

  return (
    <div className="mb-5">
      <SectionTitle>🙋 Свободные задачи · {tasks.length + jobs.length}</SectionTitle>
      <div className="space-y-2.5">
        {tasks.map((t) => {
          const boost = (t.mult_eff ?? 1) > 1;
          return (
            <div key={t.id} className={cx('rounded-2xl p-4 ring-1 ring-inset', boost ? 'bg-[#AF52DE]/[0.12] ring-[#AF52DE]/40' : 'bg-[#FF9500]/[0.1] ring-[#FF9500]/35')}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Обработка · № {t.task_no}</div>
                  <div className="mt-0.5 break-words text-[16px] font-semibold leading-snug">{t.company_name || t.address}</div>
                  {t.company_name && <div className="break-words text-[14px] text-muted">{t.address}</div>}
                  <div className="mt-1 text-[13px] text-muted">{fmtWhen(t)}{t.procedure ? ` · ${t.procedure}` : ''}{t.pests?.length ? ` · ${t.pests.join(', ')}` : ''}</div>
                </div>
                <div className="shrink-0 text-right">
                  {(t.claim_bonus ?? 0) > 0 && <div className="font-dot text-[18px] font-semibold text-accent-ink">+{pts(t.claim_bonus)} б</div>}
                  {boost && <div className="mt-1 rounded-full bg-[#AF52DE] px-2 py-0.5 text-[12px] font-semibold text-white">{multLabel(t.mult_eff ?? 1)}</div>}
                </div>
              </div>
              <Button className="mt-3 h-11 text-[15px]" icon={<Hand size={18} strokeWidth={1.75} />} loading={busy === t.id} onClick={() => claim('task', t.id)}>Забрать</Button>
            </div>
          );
        })}
        {jobs.map((j) => (
          <div key={j.id} className="rounded-2xl bg-[#FF9500]/[0.1] p-4 ring-1 ring-inset ring-[#FF9500]/35">
            <button className="block w-full min-w-0 text-left" onClick={() => setJob(j)}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Поручение · № {j.job_no}</div>
                  <div className="mt-0.5 line-clamp-2 break-words text-[16px] font-semibold leading-snug">{j.title}</div>
                  <div className="mt-1 text-[13px] text-muted">для: {audienceText(j.audience)}{j.due_at ? ` · до ${new Date(`${j.due_at}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${j.due_time || '18:00'}` : ''}</div>
                </div>
                <div className="shrink-0 font-dot text-[18px] font-semibold text-accent-ink">+{pts(j.points)}</div>
              </div>
            </button>
            <Button className="mt-3 h-11 text-[15px]" icon={<Hand size={18} strokeWidth={1.75} />} loading={busy === j.id} onClick={() => claim('job', j.id)}>Забрать</Button>
          </div>
        ))}
      </div>
      <div className="mt-1.5 px-1 text-[12.5px] text-muted">Кто первый нажмёт «Забрать» — тот исполнитель{cfg.isAdmin ? '' : ', награда — ему'}.</div>
      {job && <JobSheet job={job} onClose={() => setJob(null)} onChanged={() => { setJob(null); load(); onClaimed?.(); }} />}
    </div>
  );
}
