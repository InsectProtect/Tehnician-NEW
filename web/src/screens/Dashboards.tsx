import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Bot, Building2, Send, X } from 'lucide-react';
import { api } from '../api';
import { fmtDate } from '../config';
import { haptic } from '../telegram';
import type { CoachMsg, KpiPlanRow, OfficeCall, TimelinessRow } from '../types';
import { Button, Field, Input, Pill, Sheet, Spinner, TextArea, cx, useToast } from '../components/ui';

/** Блоки главной админ-панели — выбираются галочками в Настройках. */
export const OVERVIEW_WIDGETS: { id: string; label: string; hint: string }[] = [
  { id: 'tasks', label: 'Заявки', hint: 'подтверждение, кто не нажал «Уведомлен», заявки по сотрудникам, кто на выезде' },
  { id: 'contest', label: 'Соревнование 👑', hint: 'рейтинг сотрудников по баллам за месяц' },
  { id: 'live', label: 'Кто где (карта)', hint: 'сотрудники на карте: едет, на объекте, опаздывает — по геопозиции из смены в эфире' },
  { id: 'guard', label: 'Контроль баллов (бот)', hint: 'подозрительные акты: быстро закрыт, тип помещения выше заявки, сдвиг на коэффициент…' },
  { id: 'coach', label: 'Разбор недели (бот)', hint: 'сообщения сотрудникам о работе с приложением — отправка после вашего подтверждения' },
  { id: 'media', label: 'Видео и фото от специалистов', hint: 'оценка и баллы за съёмку с объектов' },
  { id: 'tiles', label: 'Показатели выездов', hint: 'выездов, завершено, заселённость, фото' },
  { id: 'efficiency', label: 'Эффективность сотрудников', hint: 'KPI и баллы за месяц' },
  { id: 'timeliness', label: 'Своевременность в приложении', hint: 'реакция на заявки и напоминания' },
  { id: 'office', label: 'Вызовы в офис', hint: 'кто вызван и подтвердил ли' },
  { id: 'daily', label: 'График по дням', hint: 'выезды за период' },
  { id: 'bars', label: 'Разбивки', hint: 'по специалистам, обработкам, вредителям' },
  { id: 'alerts', label: 'Требуют внимания', hint: 'высокая заселённость, без подготовки' },
];

const num = (n: number | null | undefined) => (n == null ? '—' : String(Math.round(n * 10) / 10).replace('.', ','));
const tone = (s: number | null) => (s == null ? 'text-muted' : s >= 90 ? 'text-[#248A3D] dark:text-[#30D158]' : s >= 70 ? 'text-accent-ink' : 'text-[#D70015] dark:text-[#FF453A]');
const barCls = (s: number | null) => (s == null ? 'bg-fill' : s >= 90 ? 'bg-[#34C759]' : s >= 70 ? 'bg-accent' : 'bg-[#D71921]');

function Card({ title, sub, children, right }: { title: string; sub?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="rounded-[22px] bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[16px] font-semibold">{title}</div>
          {sub && <div className="text-[12.5px] text-muted">{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Эффективность: KPI % и выполнение плана по каждому сотруднику за текущий месяц. */
export function EfficiencyDash() {
  const toast = useToast();
  const [d, setD] = useState<{ month_label: string; min_plan_pct: number; items: KpiPlanRow[] } | null>(null);
  useEffect(() => { api.efficiency().then(setD).catch((e: Error) => toast(e.message, 'error')); }, [toast]);
  if (!d) return <Card title="Эффективность сотрудников"><Spinner /></Card>;
  const max = Math.max(120, ...d.items.map((r) => r.plan_pct));
  return (
    <Card title="Эффективность сотрудников" sub={`KPI за ${d.month_label}${d.min_plan_pct ? ` · KPI от ${d.min_plan_pct}% плана` : ''}`}>
      {d.items.length === 0 ? <div className="text-[14px] text-muted">Нет специалистов</div> : (
        <div className="space-y-3">
          {d.items.map((r) => (
            <div key={r.id}>
              <div className="flex items-baseline justify-between gap-2 text-[14px]">
                <span className="truncate font-medium">{r.name}</span>
                <span className="shrink-0 text-[12.5px] text-muted">
                  {num(r.points)}/{num(r.plan)} б · {r.done} вып. · <b className={cx('font-dot text-[15px]', tone(r.score))}>{r.score}%</b>
                </span>
              </div>
              <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-fill">
                <div className={cx('h-full rounded-full', barCls(r.plan_pct >= 100 ? 95 : r.plan_pct >= (d.min_plan_pct || 0) ? 75 : 10))} style={{ width: `${Math.min(100, (r.plan_pct / max) * 100)}%` }} />
                <div className="absolute inset-y-0 w-px bg-ink/40" style={{ left: `${(100 / max) * 100}%` }} title="100% плана" />
              </div>
              <div className="mt-1 text-[11.5px] text-muted">{r.plan_pct}% плана · в срок {r.on_time_pct == null ? '—' : `${r.on_time_pct}%`} · замечаний {r.remarks}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Своевременность: как быстро сотрудник реагирует в приложении и боте. */
export function TimelinessDash() {
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [d, setD] = useState<TimelinessRow[] | null>(null);
  useEffect(() => { setD(null); api.timeliness(days).then((r) => setD(r.items)).catch((e: Error) => toast(e.message, 'error')); }, [days, toast]);
  return (
    <Card title="Своевременность работы с приложением" sub="реакция на заявки, напоминания и вызовы"
      right={(
        <div className="flex gap-1">
          {[7, 30, 90].map((n) => (
            <button key={n} onClick={() => { haptic.tap(); setDays(n); }}
              className={cx('h-7 rounded-full px-2.5 text-[12px] font-medium', n === days ? 'bg-accent text-black' : 'bg-fill')}>{n} дн</button>
          ))}
        </div>
      )}>
      {!d ? <Spinner /> : d.length === 0 ? <div className="text-[14px] text-muted">Нет специалистов</div> : (
        <>
          <div className="space-y-3 md:hidden">
            {d.map((r) => (
              <div key={r.id} className="rounded-2xl bg-fill/60 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">{r.name}</span>
                  <b className={cx('font-dot text-[20px]', tone(r.score))}>{r.score == null ? '—' : `${r.score}%`}</b>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px] text-muted">
                  <span>«Уведомлен» ≤5 мин: <b className="text-ink dark:text-white">{r.ack_fast_pct == null ? '—' : `${r.ack_fast_pct}%`}</b></span>
                  <span>в среднем: <b className="text-ink dark:text-white">{num(r.ack_avg_min)} мин</b></span>
                  <span>«Скоро заявка» увидел: <b className="text-ink dark:text-white">{r.soon_ok_pct == null ? '—' : `${r.soon_ok_pct}%`}</b></span>
                  <span>начал вовремя: <b className="text-ink dark:text-white">{r.start_on_time_pct == null ? '—' : `${r.start_on_time_pct}%`}</b></span>
                  <span>напоминаний на заявку: <b className="text-ink dark:text-white">{num(r.reminders_avg)}</b></span>
                  <span>вызовы в офис: <b className="text-ink dark:text-white">{r.office_calls ? `${r.office_ok_pct}%` : '—'}</b></span>
                </div>
                {r.unacked > 0 && <div className="mt-1.5"><Pill tone="red">не подтвердил заявок: {r.unacked}</Pill></div>}
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                  <th className="py-2 font-medium">Сотрудник</th>
                  <th className="text-right font-medium">Заявок</th>
                  <th className="text-right font-medium">«Уведомлен» ≤5 мин</th>
                  <th className="text-right font-medium">Ср. реакция</th>
                  <th className="text-right font-medium">Напомин./заявку</th>
                  <th className="text-right font-medium">«Увидел» перед выездом</th>
                  <th className="text-right font-medium">Начал вовремя</th>
                  <th className="text-right font-medium">План подтв.</th>
                  <th className="text-right font-medium">Вызовы</th>
                  <th className="text-right font-medium">Итог</th>
                </tr>
              </thead>
              <tbody>
                {d.map((r) => (
                  <tr key={r.id} className="border-t border-dashed border-line">
                    <td className="py-2.5 font-medium">{r.name}{r.unacked > 0 && <span className="ml-2 text-[11px] text-[#D70015]">не подтв. {r.unacked}</span>}</td>
                    <td className="text-right font-dot">{r.tasks}</td>
                    <td className={cx('text-right font-dot', tone(r.ack_fast_pct))}>{r.ack_fast_pct == null ? '—' : `${r.ack_fast_pct}%`}</td>
                    <td className="text-right font-dot">{r.ack_avg_min == null ? '—' : `${num(r.ack_avg_min)} мин`}</td>
                    <td className="text-right font-dot">{num(r.reminders_avg)}</td>
                    <td className={cx('text-right font-dot', tone(r.soon_ok_pct))}>{r.soon_ok_pct == null ? '—' : `${r.soon_ok_pct}%`}</td>
                    <td className={cx('text-right font-dot', tone(r.start_on_time_pct))}>{r.start_on_time_pct == null ? '—' : `${r.start_on_time_pct}%`}</td>
                    <td className="text-right">{r.plan_acked ? `✓${r.plan_ack_hours != null ? ` ${num(r.plan_ack_hours)} ч` : ''}` : r.plan_sent ? <span className="text-[#C93400]">нет</span> : '—'}</td>
                    <td className="text-right font-dot">{r.office_calls ? `${r.office_ok_pct}%` : '—'}</td>
                    <td className={cx('text-right font-dot text-[16px] font-semibold', tone(r.score))}>{r.score == null ? '—' : `${r.score}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-[12px] leading-snug text-muted">
            Итог — среднее из: доля заявок, подтверждённых «Уведомлен» за 5 минут; доля напоминаний «Скоро заявка», на которые нажал «Увидел»;
            доля выездов, начатых не позже 15 минут от времени заявки; доля подтверждённых вызовов в офис.
          </div>
        </>
      )}
    </Card>
  );
}

/** Вызовы в офис: активные и последние. */
export function OfficeCallsWidget() {
  const toast = useToast();
  const [items, setItems] = useState<OfficeCall[] | null>(null);
  const load = useCallback(() => { api.officeCalls().then((r) => setItems(r.items)).catch((e: Error) => toast(e.message, 'error')); }, [toast]);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  return (
    <Card title="Вызовы в офис" sub="вызвать — во вкладке «Специалисты»">
      {!items ? <Spinner /> : items.length === 0 ? <div className="text-[14px] text-muted">Вызовов не было</div> : (
        <div className="space-y-2">
          {items.slice(0, 8).map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-xl bg-fill/60 px-3 py-2.5">
              <Building2 size={18} strokeWidth={1.75} className={c.ack_at ? 'text-[#248A3D]' : 'text-[#D70015]'} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium">{c.name}{c.note ? ` · ${c.note}` : ''}</div>
                <div className="text-[12px] text-muted">
                  {fmtDate(c.created_at)} · {c.ack_at ? `подтвердил ${fmtDate(c.ack_at)}` : `не подтвердил · напоминаний ${c.count}`}
                </div>
              </div>
              {!c.ack_at && (
                <button aria-label="Отменить вызов" onClick={async () => { try { await api.cancelOfficeCall(c.id); load(); } catch (e) { toast((e as Error).message, 'error'); } }}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted active:opacity-60"><X size={16} strokeWidth={2} /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Лист «Вызвать в офис». */
export function OfficeCallSheet({ tgId, name, onClose, onDone }: { tgId: string; name: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title="Вызвать в офис">
      <p className="-mt-3 mb-4 text-[14px] leading-snug text-muted">
        {name} получит сообщение в боте с кнопкой «✅ Получил». Пока не нажмёт — напоминание каждые 2 минуты. Когда подтвердит — вам придёт сообщение.
      </p>
      <Field label="Комментарий (необязательно)"><Input placeholder="Например: забрать препараты, к 15:00" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Button className="mt-4" loading={busy} icon={<Building2 size={18} strokeWidth={1.75} />} onClick={async () => {
        setBusy(true);
        try { await api.officeCall(tgId, note.trim()); haptic.success(); toast('Вызов отправлен'); onDone(); } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
      }}>Вызвать</Button>
    </Sheet>
  );
}

/** Специалист: баннер «Вас вызывают в офис» с кнопкой «Получил». */
export function OfficeCallBanner() {
  const toast = useToast();
  const [c, setC] = useState<{ id: string; note: string; by_name: string; created_at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.myOfficeCall().then((r) => setC(r.call)).catch(() => {}); }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  if (!c) return null;
  return (
    <div className="mb-5 rounded-[22px] bg-[#D71921] p-4 text-white">
      <div className="flex items-center gap-2 text-[18px] font-semibold"><Building2 size={20} strokeWidth={1.75} /> Вас вызывают в офис</div>
      <div className="mt-1 text-[14px] opacity-90">{c.by_name} · {fmtDate(c.created_at)}{c.note ? ` · ${c.note}` : ''}</div>
      <button disabled={busy} onClick={async () => {
        setBusy(true);
        try { await api.ackOfficeCall(c.id); haptic.success(); toast('Офис знает, что вы получили'); setC(null); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
      }} className="mt-3 h-[48px] w-full rounded-full bg-white text-[16px] font-semibold text-[#D71921] active:opacity-80 disabled:opacity-60">
        ✅ Получил
      </button>
    </div>
  );
}

/**
 * Разбор недели: по понедельникам в 10:00 бот готовит сообщения сотрудникам (похвала / что улучшить в работе с приложением).
 * Ничего не уходит без подтверждения администратора — здесь можно поправить текст, отправить или отклонить.
 */
export function CoachPanel() {
  const toast = useToast();
  const [d, setD] = useState<CoachMsg[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [showOld, setShowOld] = useState(false);
  const load = useCallback(() => { api.coach().then((r) => setD(r.items)).catch((e: Error) => toast(e.message, 'error')); }, [toast]);
  useEffect(() => { load(); }, [load]);
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); haptic.success(); if (ok) toast(ok); load(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  };
  const proposed = d?.filter((m) => m.status === 'proposed') ?? [];
  const old = d?.filter((m) => m.status !== 'proposed') ?? [];
  return (
    <Card title="Разбор недели" sub="бот анализирует работу с приложением по понедельникам — отправка только после вашего «Отправить»"
      right={<Bot size={20} strokeWidth={1.75} className="text-accent-ink" />}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" loading={busy === 'prep'} onClick={() => run('prep', async () => { const r = await api.coachPrepare(); toast(r.n ? `Подготовлено: ${r.n}` : 'Все работают в норме — писать некому'); })}>
          Разобрать неделю сейчас
        </Button>
        <Button disabled={!proposed.length} loading={busy === 'all'} icon={<Send size={17} strokeWidth={1.75} />}
          onClick={() => run('all', () => api.coachSendAll(), 'Отправлено')}>Отправить все{proposed.length ? ` · ${proposed.length}` : ''}</Button>
      </div>
      {!d ? <Spinner /> : (
        <div className="mt-3 space-y-2.5">
          {proposed.length === 0 && <div className="text-[13.5px] text-muted">Черновиков нет. Следующий разбор — в понедельник в 10:00.</div>}
          {proposed.map((m) => (
            <div key={m.id} className="rounded-2xl bg-fill/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-semibold">{m.name}</span>
                <Pill tone={m.kind === 'praise' ? 'green' : 'orange'}>{m.kind === 'praise' ? 'похвала' : 'улучшить'} · {m.metrics.score ?? '—'}%</Pill>
              </div>
              <TextArea rows={m.kind === 'praise' ? 2 : 6} value={edits[m.id] ?? m.text} onChange={(e) => setEdits({ ...edits, [m.id]: e.target.value })} />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant="secondary" className="h-[42px] text-[14px]" disabled={!!busy} onClick={() => run(m.id, () => api.coachDecide(m.id, false))}>Не отправлять</Button>
                <Button className="h-[42px] text-[14px]" disabled={!!busy} onClick={() => run(m.id, () => api.coachDecide(m.id, true, edits[m.id] ?? m.text), `Отправлено: ${m.name}`)}>Отправить</Button>
              </div>
            </div>
          ))}
          {old.length > 0 && (
            <button onClick={() => setShowOld(!showOld)} className="px-1 text-[13px] text-accent-ink">{showOld ? 'Скрыть историю' : `История · ${old.length}`}</button>
          )}
          {showOld && old.map((m) => (
            <div key={m.id} className="rounded-xl bg-fill/40 px-3 py-2 text-[12.5px]">
              <b>{m.name}</b> · {m.status === 'sent' ? `отправлено ${m.decided_at ? fmtDate(m.decided_at) : ''}` : 'не отправлено'} · {m.week}
              <div className="mt-0.5 line-clamp-2 whitespace-pre-line text-muted">{m.text}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
