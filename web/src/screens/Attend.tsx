import { useCallback, useEffect, useState } from 'react';
import { CalendarOff, Check, Clock, LogOut, MapPin, Trash2 } from 'lucide-react';
import { api } from '../api';
import { getLocation, haptic } from '../telegram';
import type { AttendAdmin, AttendDay, AttendMe, AttendSchedule, AttendStats } from '../types';
import { Button, Chips, Field, Input, Sheet, Spinner, Toggle, cx, useToast } from '../components/ui';
import { GameButton } from '../components/game';
import { LOC } from '../locale';

/* ================================================================================================
 * Пунктуальность менеджеров (v89): отметка «Я на работе» / «Ухожу» по геопозиции офиса,
 * календарь месяца, причина опоздания. Главный администратор — табло дня, календари, график, выходные, настройки.
 * ================================================================================================ */

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const hhmm = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Chisinau' }) : '—');
const dm = (day: string) => `${day.slice(8)}.${day.slice(5, 7)}`;
const hm = (s: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s); return m ? +m[1] * 60 + +m[2] : 0; };
const curMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Chisinau' }).slice(0, 7);
const shiftMonth = (ym: string, d: number) => { let [y, m] = ym.split('-').map(Number); m += d; while (m < 1) { m += 12; y -= 1; } while (m > 12) { m -= 12; y += 1; } return `${y}-${String(m).padStart(2, '0')}`; };

/** Цвет дня в календаре. */
const DAY_TONE: Record<string, string> = {
  ok: 'bg-[#34C759] text-white', late: 'bg-[#FF9500] text-white', absent: 'bg-[#FF3B30] text-white', off: 'bg-[#5AC8FA]/30 text-ink',
  rest: 'bg-transparent text-muted/50', future: 'bg-fill text-muted', waiting: 'bg-fill text-ink ring-2 ring-inset ring-accent', before: 'bg-transparent text-muted/40',
};
const toneOf = (d: AttendDay) => (d.excused && (d.status === 'late' || d.status === 'absent') ? 'bg-[#34C759]/40 text-ink' : DAY_TONE[d.status] || 'bg-fill');
const STATUS_TEXT: Record<string, string> = { ok: 'вовремя', late: 'опоздание', absent: 'неявка', off: 'выходной', rest: 'не рабочий день', future: 'впереди', waiting: 'ждём отметку', before: 'до начала учёта' };

function Calendar({ days, onDay }: { days: AttendDay[]; onDay?: (d: AttendDay) => void }) {
  const pad = (days[0]?.wd ?? 1) - 1;
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center font-mono text-[10px] uppercase text-muted">{WD.map((w) => <span key={w}>{w}</span>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: pad }, (_, i) => <span key={`p${i}`} />)}
        {days.map((d) => (
          <button key={d.day} disabled={!onDay} onClick={() => { haptic.tap(); onDay?.(d); }}
            className={cx('relative flex aspect-square items-center justify-center rounded-lg font-mono text-[12.5px] font-semibold', toneOf(d))}>
            {Number(d.day.slice(8))}
            {d.status === 'late' && !d.excused && (d.late_min ?? 0) > 0 && <span className="absolute bottom-0.5 text-[8px] font-bold leading-none">+{d.late_min}</span>}
            {d.reason && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-white" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatsLine({ s }: { s: AttendStats }) {
  return (
    <div className="grid grid-cols-4 gap-2 text-center">
      {[['вовремя', s.pct == null ? '—' : `${s.pct}%`, 'text-[#248A3D] dark:text-[#30D158]'], ['опозданий', String(s.late), s.late ? 'text-[#C93400] dark:text-[#FF9F0A]' : ''], ['неявок', String(s.absent), s.absent ? 'text-[#D70015] dark:text-[#FF453A]' : ''], ['серия', String(s.streak), '']].map(([l, v, c]) => (
        <div key={l} className="rounded-xl bg-fill px-1 py-2"><div className={cx('font-dot text-[20px] leading-none', c)}>{v}</div><div className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">{l}</div></div>
      ))}
    </div>
  );
}

/* ---------------- Менеджер: карточка на «Обзоре» ---------------- */

export function AttendCard() {
  const toast = useToast();
  const [d, setD] = useState<AttendMe | null>(null);
  const [busy, setBusy] = useState<'' | 'in' | 'out' | 'reason'>('');
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api.attendMe().then(setD).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  if (!d || !d.on || d.today.skip) return null;
  const t = d.today;
  const r = t.row;

  async function mark(kind: 'in' | 'out') {
    setBusy(kind); haptic.tap();
    try {
      const pos = await getLocation();
      if (!pos && !t.remote) { toast('Нет доступа к геопозиции — разрешите её для Telegram в настройках телефона', 'error'); return; }
      if (kind === 'in') {
        const x = await api.attendIn(pos?.lat ?? null, pos?.lon ?? null);
        haptic.success();
        toast(x.already ? 'Уже отмечено' : x.status === 'late' ? `Отмечено · опоздание ${x.late_min} мин — напишите причину` : `Отмечено вовремя 👍${x.xp ? ` +${x.xp} XP` : ''}`, x.status === 'late' ? 'error' : 'ok');
      } else {
        const x = await api.attendOut(pos?.lat ?? null, pos?.lon ?? null);
        haptic.success();
        toast(x.early_min > d!.grace ? `Уход отмечен · раньше на ${x.early_min} мин` : 'Уход отмечен. Хорошего вечера!');
      }
      load();
    } catch (e) { haptic.error(); toast((e as Error).message, 'error'); } finally { setBusy(''); }
  }
  async function sendReason() {
    setBusy('reason');
    try { await api.attendReason(reason.trim()); haptic.success(); toast('Причина отправлена руководителю'); setReason(''); load(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  }
  const lateNow = t.work && !r?.in_at ? t.now_min - hm(t.from) : 0;

  return (
    <div className="mb-4 rounded-[22px] bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted"><Clock size={13} />Рабочий день</span>
        <button onClick={() => { haptic.tap(); setOpen(true); }} className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-accent-ink">
          вовремя {d.stats.pct == null ? '—' : `${d.stats.pct}%`} · календарь
        </button>
      </div>
      {!t.work && !r?.in_at ? (
        <div className="text-[15px] text-muted">{t.off ? `🌴 Сегодня: ${t.off.label.toLowerCase()}` : 'Сегодня не рабочий день по графику'}</div>
      ) : !r?.in_at ? (
        <>
          <div className="mb-3 text-[15px]">
            Начало в <b>{t.from}</b>{t.remote ? ' · можно удалённо' : ''}
            {lateNow > d.grace && <div className="mt-0.5 font-semibold text-[#D70015] dark:text-[#FF453A]">Вы опаздываете на {lateNow} мин</div>}
            {r?.status === 'absent' && <div className="mt-0.5 font-semibold text-[#D70015] dark:text-[#FF453A]">Отмечена неявка — отметьтесь и напишите причину</div>}
          </div>
          <GameButton loading={busy === 'in'} icon={<MapPin size={20} strokeWidth={2.2} />} onClick={() => mark('in')}>Я на работе</GameButton>
          {!d.office && !t.remote && <div className="mt-2 text-[12.5px] text-muted">Место офиса ещё не задано — попросите руководителя.</div>}
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[16px] font-semibold">
              {r.status === 'late' ? (r.excused ? '✅ Опоздание засчитано' : `🟠 Опоздание ${r.late_min} мин`) : '✅ Вовремя'}
            </div>
            <div className="font-dot text-[15px] text-muted">{hhmm(r.in_at)}{r.out_at ? ` – ${hhmm(r.out_at)}` : ''}</div>
          </div>
          {r.in_mode === 'remote' && <div className="text-[12.5px] text-muted">удалённо</div>}
          {r.status === 'late' && !r.excused && (r.reason ? (
            <div className="mt-2 rounded-xl bg-fill px-3 py-2 text-[13.5px]">Причина: «{r.reason}» — ждёт решения руководителя</div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); sendReason(); }} className="mt-3 flex gap-2">
              <Input placeholder="Причина опоздания (пробка, у клиента…)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button type="submit" disabled={reason.trim().length < 3 || busy === 'reason'} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-black disabled:opacity-40"><Check size={20} /></button>
            </form>
          ))}
          {!r.out_at && (
            <Button variant="secondary" className="mt-3 h-[44px] text-[14px]" loading={busy === 'out'} onClick={() => mark('out')} icon={<LogOut size={17} />}>Ухожу · конец в {t.to}</Button>
          )}
        </>
      )}
      {open && (
        <Sheet open onClose={() => setOpen(false)} title="Моя пунктуальность">
          <div className="-mt-2 mb-3 text-[14px] text-muted">{MONTHS[Number(d.month.slice(5)) - 1]} · график {d.schedule.days.map((x) => WD[x - 1]).join(', ')} · {d.schedule.from}–{d.schedule.to} · допуск {d.grace} мин</div>
          <StatsLine s={d.stats} />
          <div className="mt-4"><Calendar days={d.days} /></div>
          <Legend />
        </Sheet>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
      {[['bg-[#34C759]', 'вовремя'], ['bg-[#FF9500]', 'опоздание'], ['bg-[#FF3B30]', 'неявка'], ['bg-[#34C759]/40', 'засчитано'], ['bg-[#5AC8FA]/30', 'выходной / отпуск']].map(([c, l]) => (
        <span key={l} className="flex items-center gap-1"><i className={cx('inline-block h-2.5 w-2.5 rounded-sm', c)} />{l}</span>
      ))}
    </div>
  );
}

/* ---------------- Главный администратор ---------------- */

const STATE_CHIP: Record<string, [string, string]> = {
  ok: ['вовремя', 'bg-[#34C759]/15 text-[#248A3D] dark:text-[#30D158]'], late: ['опоздал', 'bg-[#FF9500]/15 text-[#C93400] dark:text-[#FF9F0A]'],
  missing: ['нет отметки', 'bg-[#FF3B30]/15 text-[#D70015] dark:text-[#FF453A]'], absent: ['неявка', 'bg-[#FF3B30]/15 text-[#D70015] dark:text-[#FF453A]'],
  waiting: ['ещё рано', 'bg-fill text-muted'], off: ['выходной', 'bg-[#5AC8FA]/15 text-ink'], rest: ['не по графику', 'bg-fill text-muted'],
};

export function AttendAdminPanel() {
  const toast = useToast();
  const [month, setMonth] = useState(curMonth());
  const [d, setD] = useState<AttendAdmin | null>(null);
  const [day, setDay] = useState<{ tg: string; name: string; d: AttendDay } | null>(null);
  const [sched, setSched] = useState<{ tg: string; name: string; sc: AttendSchedule } | null>(null);
  const load = useCallback(() => api.adminAttend(month).then(setD).catch((e: Error) => toast(e.message, 'error')), [month, toast]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Spinner />;
  return (
    <>
      <div className="mb-3 flex items-center justify-center gap-2">
        <button onClick={() => setMonth(shiftMonth(month, -1))} className="h-10 w-10 rounded-full bg-card text-[18px] ring-1 ring-inset ring-line">‹</button>
        <div className="min-w-[150px] text-center text-[15px] font-semibold capitalize">{MONTHS[Number(month.slice(5)) - 1]} {month.slice(0, 4)}</div>
        <button disabled={month >= curMonth()} onClick={() => setMonth(shiftMonth(month, 1))} className="h-10 w-10 rounded-full bg-card text-[18px] ring-1 ring-inset ring-line disabled:opacity-30">›</button>
      </div>

      {!d.office && (
        <div className="mb-3 rounded-2xl bg-[#FF9500]/12 p-4 text-[14px]">📍 Место офиса не задано — менеджеры не смогут отметиться. Задайте его ниже в «Настройках» (встаньте в офисе и нажмите «Офис здесь»).</div>
      )}

      {d.today.length > 0 && month === curMonth() && (
        <div className="rounded-[22px] bg-card p-4">
          <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">Сегодня</div>
          <div className="divide-y divide-dashed divide-line">
            {d.today.map((b) => {
              const [label, cls] = b.state === 'late' && b.row?.excused ? ['засчитано', STATE_CHIP.ok[1]] : STATE_CHIP[b.state] || ['', ''];
              return (
                <div key={b.tg_id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold">{b.name}</div>
                    <div className="text-[12.5px] text-muted">
                      {b.off || `${b.from}–${b.to}`}
                      {b.row?.in_at ? ` · пришёл ${hhmm(b.row.in_at)}` : ''}{b.row?.out_at ? ` · ушёл ${hhmm(b.row.out_at)}` : ''}
                      {b.row?.in_mode === 'remote' ? ' · удалённо' : ''}
                      {b.row?.reason ? ` · «${b.row.reason}»` : ''}
                    </div>
                  </div>
                  <span className={cx('shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-bold', cls)}>
                    {label}{b.state === 'late' && b.row && !b.row.excused ? ` +${b.row.late_min}` : b.state === 'missing' ? ` +${b.late_now}` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {d.items.length === 0 && <div className="mt-3 rounded-2xl bg-card p-4 text-[14.5px] text-muted">Менеджеров пока нет — назначьте сотруднику роль «Менеджер».</div>}
      {d.items.map((m) => (
        <div key={m.tg_id} className="mt-3 rounded-[22px] bg-card p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[17px] font-semibold">{m.name}</div>
              <div className="text-[12.5px] text-muted">{m.schedule.skip ? 'не контролируется' : `${m.schedule.days.map((x) => WD[x - 1]).join(', ')} · ${m.schedule.from}–${m.schedule.to}${m.schedule.remote ? ' · можно удалённо' : ''}`}</div>
            </div>
            <button onClick={() => { haptic.tap(); setSched({ tg: m.tg_id, name: m.name, sc: m.schedule }); }} className="shrink-0 rounded-full bg-fill px-3 py-1.5 text-[12.5px] font-medium">График · отпуск</button>
          </div>
          <StatsLine s={m.stats} />
          {m.stats.late_min > 0 && <div className="mt-2 text-[12.5px] text-muted">Всего опозданий: {m.stats.late_min} мин{m.stats.early ? ` · ранних уходов: ${m.stats.early}` : ''}</div>}
          <div className="mt-3"><Calendar days={m.days} onDay={(x) => setDay({ tg: m.tg_id, name: m.name, d: x })} /></div>
        </div>
      ))}
      {d.items.length > 0 && <Legend />}

      <AttendSettingsCard d={d} onSaved={load} />

      {day && <DaySheet x={day} onClose={() => setDay(null)} onSaved={() => { setDay(null); load(); }} />}
      {sched && <ScheduleSheet x={sched} d={d} onClose={() => setSched(null)} onSaved={load} />}
    </>
  );
}

function DaySheet({ x, onClose, onSaved }: { x: { tg: string; name: string; d: AttendDay }; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const d = x.d;
  async function act(action: 'excuse' | 'unexcuse' | 'off' | 'clear') {
    setBusy(action);
    try { await api.attendDay(x.tg, d.day, action); haptic.success(); toast('Сохранено'); onSaved(); } catch (e) { toast((e as Error).message, 'error'); setBusy(''); }
  }
  const bad = d.status === 'late' || d.status === 'absent';
  return (
    <Sheet open onClose={onClose} title={`${x.name} · ${dm(d.day)}`}>
      <div className="-mt-2 mb-4 rounded-2xl bg-card p-4 text-[15px]">
        <div className="font-semibold">{d.excused && bad ? 'Засчитано' : STATUS_TEXT[d.status] || d.status}{d.status === 'late' ? ` · ${d.late_min} мин` : ''}{d.off ? ` · ${d.off.label}` : ''}</div>
        {d.in_at && <div className="mt-1 text-[14px] text-muted">Пришёл {hhmm(d.in_at)}{d.in_mode === 'remote' ? ' (удалённо)' : d.in_dist != null ? ` · ${d.in_dist} м от офиса` : ''}{d.out_at ? ` · ушёл ${hhmm(d.out_at)}` : ''}{(d.early_min ?? 0) > 0 ? ` (раньше на ${d.early_min} мин)` : ''}</div>}
        {d.reason && <div className="mt-2 rounded-xl bg-fill px-3 py-2 text-[14px]">«{d.reason}»</div>}
        {d.decided_by && <div className="mt-1 text-[12px] text-muted">решение: {d.decided_by}</div>}
      </div>
      <div className="space-y-2">
        {bad && !d.excused && <Button loading={busy === 'excuse'} onClick={() => act('excuse')} icon={<Check size={18} />}>Засчитать — без штрафа</Button>}
        {bad && d.excused && <Button variant="secondary" loading={busy === 'unexcuse'} onClick={() => act('unexcuse')}>Не засчитывать</Button>}
        {d.work && !d.in_at && <Button variant="secondary" loading={busy === 'off'} onClick={() => act('off')} icon={<CalendarOff size={18} />}>Сделать выходным</Button>}
        {d.in_at && <Button variant="plain" loading={busy === 'clear'} onClick={() => act('clear')}><span className="text-[#D70015] dark:text-[#FF453A]">Удалить отметку дня</span></Button>}
      </div>
    </Sheet>
  );
}

function DaysPick({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {WD.map((w, i) => {
        const on = value.includes(i + 1);
        return <button key={w} data-chip={on ? 'on' : ''} onClick={() => { haptic.tap(); onChange(on ? value.filter((x) => x !== i + 1) : [...value, i + 1].sort()); }}
          className={cx('h-10 rounded-xl text-[13px] font-semibold', on ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line text-muted')}>{w}</button>;
      })}
    </div>
  );
}

function ScheduleSheet({ x, d, onClose, onSaved }: { x: { tg: string; name: string; sc: AttendSchedule }; d: AttendAdmin; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const per = d.settings.per[x.tg] || {};
  const [own, setOwn] = useState(Boolean(per.days || per.from || per.to));
  const [days, setDays] = useState<number[]>(x.sc.days);
  const [from, setFrom] = useState(x.sc.from);
  const [to, setTo] = useState(x.sc.to);
  const [remote, setRemote] = useState(x.sc.remote);
  const [skip, setSkip] = useState(x.sc.skip);
  const [offFrom, setOffFrom] = useState('');
  const [offTo, setOffTo] = useState('');
  const [kind, setKind] = useState('vacation');
  const [busy, setBusy] = useState(false);
  const offs = d.offs.filter((o) => o.tg_id === x.tg);
  async function save() {
    setBusy(true);
    try {
      await api.attendSettings({ tg: x.tg, per: { ...(own ? { days, from, to } : {}), remote, skip } });
      haptic.success(); toast('График сохранён'); onSaved(); onClose();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  async function addOff() {
    try { await api.attendOff(x.tg, { from: offFrom, to: offTo || offFrom, kind }); haptic.success(); toast('Добавлено'); setOffFrom(''); setOffTo(''); onSaved(); } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function delOff(id: string) {
    try { await api.attendOffDelete(id); onSaved(); } catch (e) { toast((e as Error).message, 'error'); }
  }
  return (
    <Sheet open onClose={onClose} title={x.name}>
      <div className="space-y-3">
        <Toggle label="Свой график (не общий)" checked={own} onChange={setOwn} />
        {own && (
          <>
            <DaysPick value={days} onChange={setDays} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Начало"><Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="Конец"><Input type="time" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
          </>
        )}
        <Toggle label="Можно отмечаться удалённо (не из офиса)" checked={remote} onChange={setRemote} />
        <Toggle label="Не контролировать этого менеджера" checked={skip} onChange={setSkip} />
        <Button loading={busy} onClick={save}>Сохранить график</Button>
      </div>
      <div className="mb-2 mt-7 px-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Отпуск, больничный, выходные</div>
      <div className="space-y-2 rounded-2xl bg-card p-4">
        <Chips columns={2} value={kind} onChange={setKind} options={Object.entries(d.off_kinds).map(([id, label]) => ({ id, label }))} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="С"><Input type="date" value={offFrom} onChange={(e) => setOffFrom(e.target.value)} /></Field>
          <Field label="По"><Input type="date" value={offTo} onChange={(e) => setOffTo(e.target.value)} /></Field>
        </div>
        <Button variant="secondary" disabled={!offFrom} onClick={addOff}>Добавить</Button>
      </div>
      {offs.length > 0 && (
        <div className="mt-3 space-y-2">
          {offs.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 rounded-2xl bg-fill px-3 py-2.5 text-[14px]">
              <span>{o.label} · {dm(o.from)}{o.to !== o.from ? `–${dm(o.to)}` : ''}{o.note ? ` · ${o.note}` : ''}</span>
              <button onClick={() => delOff(o.id)} className="p-1 text-muted"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function AttendSettingsCard({ d, onSaved }: { d: AttendAdmin; onSaved: () => void }) {
  const toast = useToast();
  const s = d.settings;
  const [on, setOn] = useState(s.on);
  const [days, setDays] = useState(s.schedule.days);
  const [from, setFrom] = useState(s.schedule.from);
  const [to, setTo] = useState(s.schedule.to);
  const [grace, setGrace] = useState(String(s.grace));
  const [remind, setRemind] = useState(String(s.remind_min));
  const [absent, setAbsent] = useState(String(s.absent_after));
  const [strike, setStrike] = useState(String(s.strike_after));
  const [xp, setXp] = useState(String(s.xp));
  const [digest, setDigest] = useState(s.digest);
  const [radius, setRadius] = useState(String(d.office?.radius ?? 150));
  const [busy, setBusy] = useState('');
  async function save() {
    setBusy('save');
    try {
      await api.attendSettings({ on, schedule: { days, from, to }, grace, remind_min: remind, absent_after: absent, strike_after: strike, xp, digest, ...(d.office ? { radius } : {}) });
      haptic.success(); toast('Настройки сохранены'); onSaved();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  }
  async function officeHere() {
    setBusy('office');
    try {
      const pos = await getLocation();
      if (!pos) { toast('Нет доступа к геопозиции', 'error'); return; }
      await api.attendSettings({ office: { lat: pos.lat, lon: pos.lon, radius } });
      haptic.success(); toast('Офис сохранён по вашей геопозиции'); onSaved();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  }
  const num = (_v: string, set: (v: string) => void) => (e: { target: { value: string } }) => set(e.target.value.replace(/\D/g, '').slice(0, 3));
  return (
    <div className="mt-6 rounded-[22px] bg-card p-4">
      <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">Настройки пунктуальности</div>
      <div className="space-y-3">
        <Toggle label="Отметка прихода включена" checked={on} onChange={setOn} />
        <Field label="Общий график (дни)"><DaysPick value={days} onChange={setDays} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Начало"><Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Конец"><Input type="time" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Допуск, мин"><Input inputMode="numeric" value={grace} onChange={num(grace, setGrace)} /></Field>
          <Field label="Напомнить за, мин"><Input inputMode="numeric" value={remind} onChange={num(remind, setRemind)} /></Field>
          <Field label="Неявка через, мин"><Input inputMode="numeric" value={absent} onChange={num(absent, setAbsent)} /></Field>
          <Field label="Предупр. каждые N"><Input inputMode="numeric" value={strike} onChange={num(strike, setStrike)} /></Field>
          <Field label="XP вовремя"><Input inputMode="numeric" value={xp} onChange={num(xp, setXp)} /></Field>
          <Field label="Радиус офиса, м"><Input inputMode="numeric" value={radius} onChange={num(radius, setRadius)} /></Field>
        </div>
        <div className="px-1 text-[12px] leading-snug text-muted">«Неявка через» — нет отметки спустя столько минут после начала. «Предупр. каждые N» — каждое N-е опоздание или неявка за месяц даёт предупреждение KPI (0 — выключено).</div>
        <Toggle label="Утренняя сводка мне в Telegram" checked={digest} onChange={setDigest} />
        <Button loading={busy === 'save'} onClick={save}>Сохранить</Button>
        <Button variant="secondary" loading={busy === 'office'} onClick={officeHere} icon={<MapPin size={18} />}>
          {d.office ? 'Переставить офис сюда (я сейчас в офисе)' : 'Офис здесь — я сейчас в офисе'}
        </Button>
        <div className="px-1 text-[12.5px] leading-snug text-muted">
          {d.office ? `Офис задан · радиус ${d.office.radius} м (тот же, что в квесте «Кофе в офисе»).` : 'Офис не задан.'} Учёт ведётся с {dm(s.since)}.
          Штрафы за опоздание и неявку включаются у каждого менеджера в «Настройка KPI» → «Штрафы» — пока они выключены, идёт только учёт.
        </div>
      </div>
    </div>
  );
}
