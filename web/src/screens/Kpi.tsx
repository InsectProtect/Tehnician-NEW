import { useEffect, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { api } from '../api';
import { useConfig } from '../config';
import { haptic, openLink } from '../telegram';
import type { KpiMonth, KpiRes } from '../types';
import { Button, Sheet, Spinner, cx, useToast } from '../components/ui';

const monthLabel = (key: string, long = false) => {
  const s = new Date(`${key}-15T12:00:00`).toLocaleDateString('ru-RU', long ? { month: 'long', year: 'numeric' } : { month: 'short' });
  return (s.charAt(0).toUpperCase() + s.slice(1)).replace(' г.', '').replace('.', '');
};
const hours = (h: number | null) => (h == null ? '—' : h < 1 ? `${Math.round(h * 60)} мин` : h < 48 ? `${h} ч` : `${Math.round(h / 24)} дн`);
const pctTone = (p: number | null) => (p == null ? '' : p >= 90 ? 'text-[#248A3D] dark:text-[#30D158]' : p >= 70 ? 'text-[#C93400] dark:text-[#FF9F0A]' : 'text-[#D70015] dark:text-[#FF453A]');

function Stat({ label, value, className }: { label: string; value: string | number; className?: string }) {
  return (
    <div>
      <div className={cx('font-dot text-[22px] leading-none', className)}>{value}</div>
      <div className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted">{label}</div>
    </div>
  );
}

function MonthStats({ m }: { m: KpiMonth }) {
  return (
    <div className="grid grid-cols-4 gap-x-3 gap-y-3">
      <Stat label="Получено" value={m.received} />
      <Stat label="В срок" value={m.on_time_pct == null ? '—' : `${m.on_time_pct}%`} className={pctTone(m.on_time_pct)} />
      <Stat label="Опоздания" value={m.late} className={m.late ? 'text-[#C93400] dark:text-[#FF9F0A]' : ''} />
      <Stat label="Отменил клиент" value={m.client_cancelled} />
      <Stat label="Переносы" value={m.reschedules} />
      <Stat label="Отменил офис" value={m.cancelled} />
      <Stat label="Всего актов" value={m.visits} />
      <Stat label="Замечания" value={m.remarks} className={m.remarks ? 'text-[#C93400] dark:text-[#FF9F0A]' : ''} />
      <Stat label="Ср. время" value={hours(m.avg_hours)} />
      {m.revenue != null && m.revenue > 0 && <Stat label="Сумма, лей" value={m.revenue.toLocaleString('ru-RU')} />}
      {m.points != null && m.points > 0 && <Stat label="Баллы" value={String(m.points).replace('.', ',')} className="text-accent-ink" />}
    </div>
  );
}

/** Столбики «выполнено» по месяцам; выбранный месяц подсвечен. */
function Spark({ months, selected, onSelect }: { months: KpiMonth[]; selected?: string; onSelect?: (k: string) => void }) {
  const max = Math.max(1, ...months.map((m) => m.done));
  return (
    <div>
      <div className="flex h-16 items-end gap-1">
        {months.map((m) => (
          <div key={m.month} role={onSelect ? 'button' : undefined} onClick={onSelect ? () => { haptic.tap(); onSelect(m.month); } : undefined}
            className="flex h-full flex-1 flex-col items-center justify-end" aria-label={`${monthLabel(m.month, true)}: ${m.done}`}>
            <div className={cx('w-full max-w-[22px] rounded-t-[3px]', m.month === selected ? 'bg-accent' : 'bg-accent/30')}
              style={{ height: m.done ? `${Math.max(8, (m.done / max) * 100)}%` : '3px' }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {months.map((m, i) => (
          <div key={m.month} className={cx('flex-1 text-center text-[10px] text-muted', m.month === selected && 'font-semibold text-ink dark:text-white')}>
            {i % 2 === months.length % 2 || m.month === selected ? monthLabel(m.month) : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Админ: KPI сотрудников ---------------- */

export function KpiPanel() {
  const toast = useToast();
  const [k, setK] = useState<KpiRes | null>(null);
  const [month, setMonth] = useState('');
  const [open, setOpen] = useState<KpiRes['techs'][number] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.kpi({ months: '12' }).then((r) => { setK(r); setMonth(r.current); }).catch((e: Error) => toast(e.message, 'error'));
  }, [toast]);

  if (!k) return <Spinner />;
  const rows = k.techs.map((t) => ({ t, m: t.months.find((x) => x.month === month)! })).sort((a, b) => b.m.done - a.m.done);
  const total = rows.reduce((s, r) => ({ done: s.done + r.m.done, received: s.received + r.m.received }), { done: 0, received: 0 });

  async function exportCsv() {
    setBusy(true);
    try { openLink((await api.exportKpi(12)).url); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {[...k.months].reverse().map((m) => (
          <button key={m} onClick={() => { haptic.tap(); setMonth(m); }}
            className={cx('h-9 shrink-0 rounded-full px-4 text-[14px] font-medium transition',
              m === month ? 'bg-accent text-black' : 'bg-fill text-ink dark:text-white')}>
            {monthLabel(m, true)}
          </button>
        ))}
      </div>

      <div className="mb-3 px-1 text-[15px] text-muted">
        {monthLabel(month, true)}: выполнено <b className="font-semibold text-ink dark:text-white">{total.done}</b> из {total.received} полученных заявок
      </div>

      <div className="grid gap-2.5 md:grid-cols-2">
        {rows.map(({ t, m }, i) => (
          <button key={t.id} onClick={() => { haptic.tap(); setOpen(t); }}
            className="rounded-2xl bg-card p-4 text-left active:opacity-70">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">#{String(i + 1).padStart(2, '0')}</div>
                <div className="truncate text-[17px] font-semibold">{t.name}</div>
              </div>
              <div className="text-right">
                <div className="font-dot text-[48px] leading-none text-accent-ink">{m.done}</div>
                <div className="mt-1 text-[12px] text-muted">выполнено</div>
              </div>
            </div>
            <MonthStats m={m} />
            <div className="mt-4"><Spark months={t.months} selected={month} /></div>
          </button>
        ))}
      </div>

      <Button variant="secondary" className="mt-5" loading={busy} onClick={exportCsv} icon={<Download size={18} strokeWidth={1.75} />}>
        Скачать KPI за 12 месяцев (Excel)
      </Button>
      <p className="mt-3 px-1 text-[13px] leading-snug text-muted">
        Выполненной считается заявка, по которой завершён акт; «в срок» — акт закрыт не позже даты заявки. «Всего актов» включает выезды без заявки.
        История хранится полностью — обнуляется только счётчик на главной у сотрудника.
      </p>

      {open && <KpiHistorySheet title={open.name} months={open.months} onClose={() => setOpen(null)} />}
    </>
  );
}

/* ---------------- История по месяцам (сотрудник и админ) ---------------- */

export function KpiHistorySheet({ title, months, onClose, header }: { title: string; months: KpiMonth[]; onClose: () => void; header?: ReactNode }) {
  const [sel, setSel] = useState(months[months.length - 1]?.month || '');
  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="-mt-3 mb-5 text-[15px] text-muted">История выполненных заявок за {months.length} мес.</div>
      {header}
      <div className="mb-5 rounded-2xl bg-card p-4"><Spark months={months} selected={sel} onSelect={setSel} /></div>
      <div className="space-y-2.5">
        {[...months].reverse().map((m) => (
          <button key={m.month} onClick={() => setSel(m.month)}
            className={cx('w-full rounded-2xl p-4 text-left transition', m.month === sel ? 'bg-accent/[0.08]' : 'bg-card')}>
            <div className="mb-3 flex items-baseline justify-between">
              <div className="text-[17px] font-semibold">{monthLabel(m.month, true)}</div>
              <div className="text-[15px]"><b className="font-dot text-[28px] text-accent-ink">{m.done}</b> <span className="text-muted">выполнено</span></div>
            </div>
            <MonthStats m={m} />
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** Сотрудник: своя история. */
export function MyKpiSheet({ name, onClose }: { name: string; onClose: () => void }) {
  const toast = useToast();
  const cfg = useConfig();
  const [k, setK] = useState<KpiRes | null>(null);
  useEffect(() => {
    api.kpi({ months: '12' }).then(setK).catch((e: Error) => { toast(e.message, 'error'); onClose(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useState(''); // '' — все сотрудники (для администратора)
  if (!k) return <Sheet open onClose={onClose} title="История"><Spinner /></Sheet>;
  // техник получает только себя; администратор — всех: даём выбрать сотрудника
  if (!cfg.isAdmin) {
    const me = k.techs[0];
    return <KpiHistorySheet title={me?.name || name} months={me?.months || []} onClose={onClose} />;
  }
  const cur = k.current;
  const techs = [...k.techs].sort((a, b) => doneIn(b.months, cur) - doneIn(a.months, cur) || a.name.localeCompare(b.name));
  const chosen = techs.find((t) => t.id === pick);
  const months = chosen ? chosen.months : sumMonths(techs.map((t) => t.months));
  const chip = (id: string, label: string, n: number) => (
    <button key={id || 'all'} onClick={() => { haptic.tap(); setPick(id); }}
      className={cx('flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[14.5px] font-medium transition',
        pick === id ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>
      {label}<span className={cx('font-dot text-[15px] font-semibold', pick === id ? '' : 'text-accent-ink')}>{n}</span>
    </button>
  );
  const header = (
    <div className="-mx-4 mb-5 overflow-x-auto px-4 pb-1">
      <div className="flex w-max gap-2">
        {chip('', 'Все', techs.reduce((s, t) => s + doneIn(t.months, cur), 0))}
        {techs.map((t) => chip(t.id, t.name, doneIn(t.months, cur)))}
      </div>
      <div className="mt-2 px-1 text-[12px] text-muted">Число — выполнено в этом месяце. Выберите сотрудника, чтобы увидеть его историю.</div>
    </div>
  );
  return <KpiHistorySheet key={pick || 'all'} title={chosen ? chosen.name : 'Все сотрудники'} months={months} onClose={onClose} header={header} />;
}

const doneIn = (months: KpiMonth[], key: string) => months.find((m) => m.month === key)?.done ?? 0;

/** Сумма по всем сотрудникам помесячно («Все»). */
function sumMonths(lists: KpiMonth[][]): KpiMonth[] {
  const keys = [...new Set(lists.flat().map((m) => m.month))].sort();
  return keys.map((month) => {
    const ms = lists.map((l) => l.find((m) => m.month === month)).filter(Boolean) as KpiMonth[];
    const sum = (f: (m: KpiMonth) => number) => ms.reduce((s, m) => s + (f(m) || 0), 0);
    const onTime = sum((m) => m.on_time);
    const late = sum((m) => m.late);
    const withH = ms.filter((m) => m.avg_hours != null && m.done);
    const hDone = withH.reduce((s, m) => s + m.done, 0);
    return {
      month, received: sum((m) => m.received), done: sum((m) => m.done), on_time: onTime, late, cancelled: sum((m) => m.cancelled),
      client_cancelled: sum((m) => m.client_cancelled), reschedules: sum((m) => m.reschedules), visits: sum((m) => m.visits),
      remarks: sum((m) => m.remarks), revenue: sum((m) => m.revenue ?? 0), points: Math.round(sum((m) => m.points ?? 0) * 100) / 100,
      on_time_pct: onTime + late ? Math.round((onTime / (onTime + late)) * 100) : null,
      avg_hours: hDone ? Math.round((withH.reduce((s, m) => s + (m.avg_hours as number) * m.done, 0) / hDone) * 10) / 10 : null,
    };
  });
}
