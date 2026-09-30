import { useEffect, useState } from 'react';
import { Building2, MapPin, Phone } from 'lucide-react';
import { OfficeCallSheet } from './Dashboards';
import { api } from '../api';
import { fmtDate } from '../config';
import { callPhone, haptic, prettyPhone } from '../telegram';
import type { Specialist, SpecialistDetail } from '../types';
import { Button, Group, Pill, Row, SectionTitle, Sheet, Spinner, cx, useToast } from '../components/ui';
import { TaskRow } from './Tasks';

const num = (n: number | null | undefined) => (n == null ? '—' : String(Math.round(n * 100) / 100).replace('.', ','));
const tone = (s: number) => (s >= 100 ? 'text-[#248A3D] dark:text-[#30D158]' : s >= 80 ? 'text-accent-ink' : 'text-[#D70015] dark:text-[#FF453A]');
const bar = (s: number) => (s >= 100 ? 'bg-[#34C759]' : s >= 80 ? 'bg-accent' : 'bg-[#D71921]');
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const shift = (key: string, d: number) => { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + d, 15)).toISOString().slice(0, 7); };

/** Админка → «Специалисты»: карточка на каждого — заявки, KPI, где сейчас. */
export function SpecialistsPanel({ onOpen }: { onOpen: (visitId: string) => void }) {
  const toast = useToast();
  const cur = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(cur);
  const [d, setD] = useState<{ month_label: string; items: Specialist[] } | null>(null);
  const [open, setOpen] = useState<Specialist | null>(null);

  const [tick, setTick] = useState(0);
  const reload = () => setTick((x) => x + 1);
  useEffect(() => {
    setD(null);
    api.specialists(month).then(setD).catch((e: Error) => toast(e.message, 'error'));
  }, [month, toast, tick]);

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {[shift(cur, -2), shift(cur, -1), cur].map((m) => (
          <button key={m} onClick={() => { haptic.tap(); setMonth(m); }}
            className={cx('h-9 rounded-full px-4 text-[14px] font-medium', m === month ? 'bg-accent text-black' : 'bg-fill text-ink dark:text-white')}>
            {MONTHS[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}{m === cur ? ' · сейчас' : ''}
          </button>
        ))}
      </div>
      {!d ? <Spinner /> : d.items.length === 0 ? (
        <div className="rounded-2xl bg-card p-5 text-[15px] text-muted">Специалистов пока нет — пригласите их во вкладке «Сотрудники».</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {d.items.map((s) => <SpecCard key={s.id} s={s} onClick={() => { haptic.tap(); setOpen(s); }} />)}
        </div>
      )}
      {open && <SpecSheet s={open} onClose={() => setOpen(null)} onOpenVisit={(id) => { setOpen(null); onOpen(id); }} onChanged={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function SpecCard({ s, onClick }: { s: Specialist; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col rounded-[22px] bg-card p-4 text-left transition active:opacity-70 md:hover:ring-1 md:hover:ring-inset md:hover:ring-line">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-fill text-[16px] font-semibold">{initials(s.name)}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-semibold">{s.name}</div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {s.on_site ? <span className="text-accent-ink">● на выезде · {s.on_site.company_name}</span>
              : s.last_done_at ? `последний акт ${fmtDate(s.last_done_at)}` : 'актов ещё нет'}
          </div>
        </div>
        <div className="text-right">
          <div className={cx('font-dot text-[30px] font-semibold leading-none', tone(s.score))}>{s.score}%</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">KPI</div>
          {s.below_min && <div className="mt-0.5 text-[10.5px] text-muted">мин. {num(s.min_points)} б</div>}
        </div>
      </div>

      <div className="mt-4 flex items-baseline justify-between text-[13px]">
        <span className="text-muted">План</span>
        <span><b className="font-dot text-[16px] text-accent-ink">{num(s.points)}</b> <span className="text-muted">из {num(s.plan)} баллов · {s.plan_pct}%</span></span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-fill">
        <div className={cx('h-full rounded-full', bar(s.plan_pct))} style={{ width: `${Math.min(100, s.plan_pct)}%` }} />
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
        <Mini v={s.open} l="в работе" />
        <Mini v={s.done} l="выполнено" />
        <Mini v={s.on_time_pct == null ? '—' : `${s.on_time_pct}%`} l="в срок" />
        <Mini v={s.remarks} l="замеч." warn={s.remarks > 0} />
      </div>
      {(s.unacked > 0 || s.overdue > 0 || (s.sent_at && !s.ack_at) || s.office_call) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {s.unacked > 0 && <Pill tone="red">не подтв. заявок {s.unacked}</Pill>}
          {s.overdue > 0 && <Pill tone="orange">просрочено {s.overdue}</Pill>}
          {s.sent_at && !s.ack_at && <Pill tone="orange">план не подтвердил</Pill>}
          {s.office_call && <Pill tone="red">вызван в офис · не подтвердил</Pill>}
        </div>
      )}
    </button>
  );
}

function Mini({ v, l, warn }: { v: number | string; l: string; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-fill px-1 py-2">
      <div className={cx('font-dot text-[18px] font-semibold leading-none', warn && 'text-[#C93400] dark:text-[#FF9F0A]')}>{v}</div>
      <div className="mt-1 text-[10.5px] text-muted">{l}</div>
    </div>
  );
}

function SpecSheet({ s, onClose, onOpenVisit, onChanged }: { s: Specialist; onClose: () => void; onOpenVisit: (id: string) => void; onChanged: () => void }) {
  const toast = useToast();
  const [callOpen, setCallOpen] = useState(false);
  const [d, setD] = useState<SpecialistDetail | null>(null);
  useEffect(() => { api.specialist(s.id).then(setD).catch((e: Error) => toast(e.message, 'error')); }, [s.id, toast]);
  const maxPts = d ? Math.max(1, ...d.months.map((m) => Math.max(m.points, m.plan))) : 1;

  return (
    <Sheet open onClose={onClose} title={s.name}>
      <div className="-mt-3 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-muted">
        {s.username && <span>@{s.username}</span>}
        {s.phone && (
          <button className="flex items-center gap-1 text-accent-ink" onClick={() => callPhone(s.phone)}>
            <Phone size={14} strokeWidth={1.75} />{prettyPhone(s.phone)}
          </button>
        )}
        {s.last_seen && <span>заходил {fmtDate(s.last_seen)}</span>}
      </div>

      {s.office_call ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-[#D71921]/10 p-3.5 text-[14px]">
          <span>🏢 Вызван в офис {fmtDate(s.office_call.created_at)} · напоминаний {s.office_call.count} · ждём «Получил»</span>
          <button className="shrink-0 text-accent-ink" onClick={async () => { try { await api.cancelOfficeCall(s.office_call!.id); onChanged(); } catch (e) { toast((e as Error).message, 'error'); } }}>Отменить</button>
        </div>
      ) : (
        <Button variant="secondary" className="mb-4" icon={<Building2 size={18} strokeWidth={1.75} />} onClick={() => setCallOpen(true)}>Вызвать в офис</Button>
      )}
      {callOpen && <OfficeCallSheet tgId={s.id} name={s.name} onClose={() => setCallOpen(false)} onDone={() => { setCallOpen(false); onChanged(); }} />}
      {s.on_site && (
        <div className="mb-4 flex gap-2 rounded-2xl bg-accent/[0.08] p-3.5 text-[14px]">
          <MapPin size={17} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent-ink" />
          <div><b>Сейчас на выезде</b> · {s.on_site.company_name}<div className="text-muted">{s.on_site.address} · с {fmtDate(s.on_site.started_at)}</div></div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <Big v={`${s.score}%`} l="KPI за месяц" cls={tone(s.score)} />
        <Big v={`${num(s.points)}/${num(s.plan)}`} l="баллы / план" />
        <Big v={s.done} l="выполнено" />
        <Big v={s.open} l="заявок в работе" />
        <Big v={s.total_done} l="актов всего" />
        <Big v={s.revenue ? `${s.revenue.toLocaleString('ru-RU')}` : '—'} l="сумма, лей" />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 px-1 text-[12.5px] text-muted">
        <span>в срок {s.on_time_pct == null ? '—' : `${s.on_time_pct}%`}</span>
        <span>опозданий {s.late}</span>
        <span>замечаний {s.remarks}</span>
        <span>отменил клиент {s.client_cancelled}</span>
        <span>переносов {s.reschedules}</span>
        {s.avg_hours != null && <span>ср. время {num(s.avg_hours)} ч</span>}
      </div>

      {!d ? <Spinner /> : (
        <>
          <SectionTitle>KPI по месяцам</SectionTitle>
          <div className="rounded-2xl bg-card p-4">
            <div className="flex h-28 items-end gap-2">
              {d.months.map((m) => (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                  <div className="relative flex h-24 w-full items-end justify-center">
                    <div className="absolute bottom-0 w-full rounded-md border border-dashed border-line" style={{ height: `${(m.plan / maxPts) * 100}%` }} />
                    <div className={cx('relative w-3/5 rounded-md', bar(m.plan_pct))} style={{ height: `${Math.max(2, (m.points / maxPts) * 100)}%` }} />
                  </div>
                  <div className="font-mono text-[10px] uppercase text-muted">{MONTHS[Number(m.month.slice(5, 7)) - 1]}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="text-left font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                  <th className="py-1.5 font-medium">Месяц</th><th className="text-right font-medium">План</th><th className="text-right font-medium">Баллы</th>
                  <th className="text-right font-medium">Выполн.</th><th className="text-right font-medium">KPI</th><th className="pl-2 text-right font-medium">Ознаком.</th>
                </tr></thead>
                <tbody>
                  {[...d.months].reverse().map((m) => (
                    <tr key={m.month} className="border-t border-dashed border-line">
                      <td className="py-2">{m.label}</td>
                      <td className="text-right font-dot">{num(m.plan)}</td>
                      <td className="text-right font-dot">{num(m.points)}</td>
                      <td className="text-right font-dot">{m.done}</td>
                      <td className={cx('text-right font-dot font-semibold', tone(m.score))}>{m.score}%</td>
                      <td className="pl-2 text-right">{m.ack_at ? '✓' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <SectionTitle>Заявки в работе · {d.tasks.length}</SectionTitle>
          {d.tasks.length === 0 ? <div className="rounded-2xl bg-card p-4 text-[14px] text-muted">Открытых заявок нет</div>
            : <Group>{d.tasks.map((t) => <TaskRow key={t.id} t={t} showTech={false} onClick={() => {}} />)}</Group>}

          <SectionTitle>Последние выезды</SectionTitle>
          {d.visits.length === 0 ? <div className="rounded-2xl bg-card p-4 text-[14px] text-muted">Выездов нет</div> : (
            <Group>
              {d.visits.map((v) => (
                <Row key={v.id} onClick={() => onOpenVisit(v.id)}
                  title={v.company_name}
                  subtitle={`${v.address} · ${v.procedure} · ${fmtDate(v.finished_at || v.started_at)}`}
                  right={v.status === 'open' ? <Pill tone="blue">в работе</Pill> : <span className="font-dot text-[14px] text-accent-ink">{v.points != null ? `${num(v.points)} б` : `№ ${v.act_no}`}</span>} />
              ))}
            </Group>
          )}
        </>
      )}
    </Sheet>
  );
}

function Big({ v, l, cls }: { v: number | string; l: string; cls?: string }) {
  return (
    <div className="rounded-2xl bg-card px-2 py-3">
      <div className={cx('font-dot text-[20px] font-semibold leading-none', cls)}>{v}</div>
      <div className="mt-1.5 text-[11px] text-muted">{l}</div>
    </div>
  );
}
