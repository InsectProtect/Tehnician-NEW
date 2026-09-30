import { useCallback, useEffect, useState } from 'react';
import { Award, CheckCircle2, Clock, Send, Settings2 } from 'lucide-react';
import { PointsEditor } from '../components/PointsEditor';
import { KpiAdjustPanel } from './KpiAdjust';
import { api } from '../api';
import { fmtDate } from '../config';
import { haptic } from '../telegram';
import type { KpiPlanRes, KpiPlanRow, KpiSettings, MyPlan } from '../types';
import { Button, ConfirmSheet, Field, Input, Pill, Sheet, Spinner, cx, useToast } from '../components/ui';

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const shift = (key: string, d: number) => {
  const [y, m] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + d, 15));
  return dt.toISOString().slice(0, 7);
};
const num = (n: number | null | undefined) => (n == null ? '—' : String(Math.round(n * 100) / 100).replace('.', ','));
const scoreTone = (s: number) => (s >= 100 ? 'text-[#248A3D] dark:text-[#30D158]' : s >= 80 ? 'text-accent-ink' : 'text-[#D70015] dark:text-[#FF453A]');

/** Админка → «План KPI»: таблица по сотрудникам, план с учётом сезона, рассылка и подтверждения. */
export function KpiPlanPanel() {
  const toast = useToast();
  const [month, setMonth] = useState('');
  const [d, setD] = useState<KpiPlanRes | null>(null);
  const [edit, setEdit] = useState<KpiPlanRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);

  const load = useCallback((m?: string) => {
    api.kpiPlan(m).then((r) => { setD(r); setMonth(r.month); }).catch((e: Error) => toast(e.message, 'error'));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  if (!d) return <Spinner />;
  const cur = new Date().toISOString().slice(0, 7);
  const monthsNav = [shift(cur, -1), cur, shift(cur, 1)];
  const acked = d.rows.filter((r) => r.ack_at).length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {monthsNav.map((m) => (
          <button key={m} onClick={() => { haptic.tap(); setD(null); load(m); }}
            className={cx('h-9 rounded-full px-4 text-[14px] font-medium', m === month ? 'bg-accent text-black' : 'bg-fill text-ink dark:text-white')}>
            {MONTHS[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}{m === cur ? ' · сейчас' : ''}
          </button>
        ))}
        <div className="ml-auto flex gap-1.5">
          <button onClick={() => setPointsOpen(true)} className="flex h-9 items-center gap-1.5 rounded-full bg-card px-4 text-[14px] font-medium ring-1 ring-inset ring-line">
            <Award size={16} strokeWidth={1.75} /> Редактор баллов
          </button>
          <button onClick={() => setSettingsOpen(true)} className="flex h-9 items-center gap-1.5 rounded-full bg-card px-4 text-[14px] font-medium ring-1 ring-inset ring-line">
            <Settings2 size={16} strokeWidth={1.75} /> Настройки KPI
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Box label="Сезонный коэффициент" value={num(d.coef)} hint={MONTHS[Number(d.month.slice(5, 7)) - 1]} />
        <Box label="План по сезону" value={`${d.auto_plan}`} hint={`${d.settings.base_points} × ${num(d.coef)}`} />
        <Box label="Ознакомлены с планом" value={`${acked}/${d.rows.length}`} hint={acked < d.rows.length ? 'бот напоминает каждый час' : 'все подтвердили'} />
        <Box label="Минимальный план" value={`${d.settings.min_plan_pct ?? 0}%`} hint={d.settings.min_plan_pct ? `ниже — KPI = 0 · по сезону от ${Math.round(d.auto_plan * (d.settings.min_plan_pct ?? 0)) / 100} б` : 'порога нет'} />
      </div>

      {/* телефон — карточки */}
      <div className="space-y-2.5 md:hidden">
        {d.rows.map((r) => (
          <div key={r.id} className="rounded-2xl bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[17px] font-semibold">{r.name}</div>
                <div className="mt-1">
                  {r.ack_at ? <Pill tone="green">✓ ознакомлен {fmtDate(r.ack_at)}</Pill>
                    : r.sent_at ? <Pill tone="orange">Не подтвердил{r.remind_count > 1 ? ` · напомнили ${r.remind_count}` : ''}</Pill>
                    : <Pill>План не отправлен</Pill>}
                </div>
              </div>
              <div className="text-right">
                <div className={cx('font-dot text-[30px] font-semibold leading-none', scoreTone(r.score))}>{r.score}%</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">KPI</div>
                {r.below_min && <div className="mt-1 text-[11px] text-muted">минимум {num(r.min_points)} б</div>}
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-dot text-[22px] font-semibold text-accent-ink">{num(r.points)}</span>
              <span className="text-[14px] text-muted">из</span>
              <button onClick={() => setEdit(r)} className="rounded-lg bg-fill px-2.5 py-0.5 font-dot text-[16px] font-semibold">{num(r.plan)}{r.plan_custom ? '*' : ''}</button>
              <span className="text-[14px] text-muted">баллов · {r.plan_pct}%</span>
              {r.adjust ? <span className={cx('text-[12.5px] font-semibold', r.adjust > 0 ? 'text-[#248A3D]' : 'text-[#D70015]')}>({r.adjust > 0 ? '+' : ''}{num(r.adjust)})</span> : null}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-fill">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, r.plan_pct)}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 text-[12.5px] text-muted">
              <span>выполнено {r.done}</span>
              <span>в срок {r.on_time_pct == null ? '—' : `${r.on_time_pct}%`}</span>
              <span className={r.remarks ? 'text-[#C93400] dark:text-[#FF9F0A]' : ''}>замечаний {r.remarks}</span>
            </div>
          </div>
        ))}
      </div>

      {/* планшет/компьютер — таблица */}
      <div className="hidden overflow-x-auto rounded-2xl bg-card md:block">
        <table className="w-full min-w-[760px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-line font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
              <th className="px-4 py-3 font-medium">Сотрудник</th>
              <th className="px-2 py-3 text-right font-medium">План</th>
              <th className="px-2 py-3 text-right font-medium">Баллы</th>
              <th className="px-2 py-3 text-right font-medium">% плана</th>
              <th className="px-2 py-3 text-right font-medium">Выполн.</th>
              <th className="px-2 py-3 text-right font-medium">В срок</th>
              <th className="px-2 py-3 text-right font-medium">Замеч.</th>
              <th className="px-2 py-3 text-right font-medium">KPI</th>
              <th className="px-4 py-3 font-medium">План получен</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.id} className="border-b border-dashed border-line last:border-0">
                <td className="px-4 py-3 font-semibold">{r.name}</td>
                <td className="px-2 py-3 text-right">
                  <button onClick={() => setEdit(r)} className="rounded-lg bg-fill px-2.5 py-1 font-dot font-semibold">
                    {num(r.plan)}{r.plan_custom ? '*' : ''}
                  </button>
                </td>
                <td className="px-2 py-3 text-right font-dot">{num(r.points)}</td>
                <td className={cx('px-2 py-3 text-right font-dot font-semibold', scoreTone(r.plan_pct))}>{r.plan_pct}%</td>
                <td className="px-2 py-3 text-right font-dot">{r.done}</td>
                <td className="px-2 py-3 text-right font-dot">{r.on_time_pct == null ? '—' : `${r.on_time_pct}%`}</td>
                <td className={cx('px-2 py-3 text-right font-dot', r.remarks ? 'text-[#C93400] dark:text-[#FF9F0A]' : '')}>{r.remarks}</td>
                <td className={cx('px-2 py-3 text-right font-dot text-[17px] font-semibold', scoreTone(r.score))} title={r.below_min ? `Минимум ${r.min_points} баллов не набран` : undefined}>
                  {r.score}%{r.below_min && <div className="text-[10.5px] font-normal text-muted">мин. {num(r.min_points)} б</div>}
                </td>
                <td className="px-4 py-3">
                  {r.ack_at ? <Pill tone="green">✓ {fmtDate(r.ack_at)}</Pill>
                    : r.sent_at ? <Pill tone="orange">Не подтвердил{r.remind_count > 1 ? ` · ${r.remind_count}` : ''}</Pill>
                    : <Pill>Не отправлен</Pill>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 px-1 text-[12.5px] text-muted">* — план задан вручную. Нажмите на число плана, чтобы изменить.</div>

      <Button className="mt-5" onClick={() => setConfirmSend(true)} icon={<Send size={18} strokeWidth={1.75} />}>
        Отправить план сотрудникам · {d.month_label}
      </Button>

      <div className="mt-5 rounded-2xl bg-card p-4 text-[13.5px] leading-relaxed text-muted">
        <div className="mb-1 text-[15px] font-semibold text-ink dark:text-white">Как считается KPI</div>
        План в баллах = базовый план ({d.settings.base_points}) × сезонный коэффициент месяца, либо вручную для сотрудника.
        {d.settings.min_plan_pct ? ` KPI начинает считаться только после ${d.settings.min_plan_pct}% плана — пока меньше, KPI = 0. ` : ' '}
        Итог KPI = выполнение плана (учитывается до {d.settings.cap}%) × {d.settings.w_plan}% + работа в срок (норма {d.settings.on_time_target}%) × {d.settings.w_on_time}%
        {' '}+ качество (минус {d.settings.remark_penalty}% за каждое замечание) × {d.settings.w_quality}%.
        1-го числа в 9:00 бот сам рассылает планы; кто не нажал «Ознакомлен» — получает напоминание каждые {d.settings.remind_minutes} мин (с 9:00 до 20:00).
      </div>

      <KpiAdjustPanel month={d.month} rows={d.rows} onChanged={() => load(d.month)} />

      {edit && <PlanEditSheet row={edit} month={d.month} auto={d.auto_plan} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(d.month); }} />}
      {pointsOpen && (
        <Sheet open onClose={() => setPointsOpen(false)} title="Редактор баллов">
          <PointsEditor onSaved={() => { setPointsOpen(false); load(d.month); }} />
        </Sheet>
      )}
      {settingsOpen && <KpiSettingsSheet initial={d.settings} onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); load(d.month); }} />}
      {confirmSend && (
        <ConfirmSheet
          title="Отправить планы?"
          text={`Каждый сотрудник получит в боте свой план на ${d.month_label} с кнопкой «Ознакомлен». Отметки «ознакомлен» за этот месяц сбросятся, напоминания пойдут заново.`}
          confirmLabel="Отправить"
          danger={false}
          onClose={() => setConfirmSend(false)}
          onConfirm={async () => {
            try { const r = await api.sendPlans(d.month); haptic.success(); toast(`Отправлено: ${r.sent}`); setConfirmSend(false); load(d.month); }
            catch (e) { toast((e as Error).message, 'error'); }
          }}
        />
      )}
    </>
  );
}

function Box({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-card p-3.5">
      <div className="font-dot text-[26px] font-semibold leading-none">{value}</div>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
      {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
    </div>
  );
}

function PlanEditSheet({ row, month, auto, onClose, onSaved }: { row: KpiPlanRow; month: string; auto: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(String(row.plan).replace('.', ','));
  const [busy, setBusy] = useState(false);
  const save = async (points: number | null) => {
    setBusy(true);
    try { await api.setPlan(month, row.id, points); haptic.success(); onSaved(); } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} title={row.name}>
      <p className="-mt-3 mb-4 text-[14px] text-muted">План на месяц в баллах. По сезону — {auto}. Для новичка или отпуска можно поставить меньше.</p>
      <Field label="План, баллов"><Input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} /></Field>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Button variant="secondary" disabled={busy} onClick={() => save(null)}>По сезону</Button>
        <Button loading={busy} onClick={() => save(Number(v.replace(',', '.')))}>Сохранить</Button>
      </div>
      <p className="mt-3 text-[12.5px] text-muted">После изменения отправьте план заново — сотрудник подтвердит новый.</p>
    </Sheet>
  );
}

function KpiSettingsSheet({ initial, onClose, onSaved }: { initial: KpiSettings; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const s = (n: number) => String(n).replace('.', ',');
  const [f, setF] = useState<Record<string, string>>({
    base_points: s(initial.base_points), w_plan: s(initial.w_plan), w_on_time: s(initial.w_on_time), w_quality: s(initial.w_quality),
    on_time_target: s(initial.on_time_target), remark_penalty: s(initial.remark_penalty), cap: s(initial.cap), remind_minutes: s(initial.remind_minutes),
    min_plan_pct: s(initial.min_plan_pct ?? 0),
  });
  const [season, setSeason] = useState(initial.season.map(s));
  const [busy, setBusy] = useState(false);
  const n = (x: string) => Number(String(x).replace(',', '.'));
  const inp = (k: string, label: string) => (
    <Field label={label}><Input inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  );
  const wsum = n(f.w_plan) + n(f.w_on_time) + n(f.w_quality);
  return (
    <Sheet open onClose={onClose} title="Настройки KPI">
      <div className="space-y-4">
        {inp('base_points', 'Базовый план, баллов (при коэффициенте 1,0)')}
        <div>
          <div className="mb-2 px-1 text-[13px] font-medium text-muted">Сезонные коэффициенты — план месяца = база × коэффициент</div>
          <div className="grid grid-cols-4 gap-2">
            {season.map((v, i) => (
              <label key={i} className="block">
                <span className="mb-1 block px-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">{MONTHS[i]}</span>
                <Input inputMode="decimal" className="text-center" value={v} onChange={(e) => setSeason(season.map((x, j) => (j === i ? e.target.value : x)))} />
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {inp('w_plan', 'Вес плана, %')}{inp('w_on_time', 'Вес «в срок», %')}{inp('w_quality', 'Вес качества, %')}
        </div>
        {wsum !== 100 && <div className="px-1 text-[13px] text-[#D70015] dark:text-[#FF453A]">Сумма весов сейчас {wsum} — должна быть 100</div>}
        <div className="grid grid-cols-2 gap-2">
          {inp('on_time_target', 'Норма «в срок», %')}{inp('remark_penalty', 'Штраф за замечание, %')}
          {inp('cap', 'Потолок выполнения, %')}{inp('remind_minutes', 'Напоминать о плане, мин')}
        </div>
        <div className="rounded-2xl bg-accent/[0.08] p-3 ring-1 ring-inset ring-accent/40">
          {inp('min_plan_pct', 'Минимальный план, %')}
          <div className="mt-1.5 px-1 text-[12.5px] leading-snug text-muted">Пока сотрудник набрал меньше этого % своего плана — KPI = 0. Поставьте 0, чтобы порога не было.</div>
        </div>
      </div>
      <Button className="mt-5" loading={busy} disabled={wsum !== 100} onClick={async () => {
        setBusy(true);
        try {
          await api.saveKpiSettings({ ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, n(v)])), season: season.map(n) });
          haptic.success(); toast('Настройки KPI сохранены'); onSaved();
        } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
      }}>Сохранить</Button>
    </Sheet>
  );
}

/** Главная специалиста: план месяца, прогресс и «Ознакомлен». */
export function MyPlanCard() {
  const toast = useToast();
  const [p, setP] = useState<MyPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.myPlan().then((r) => setP(r.plan)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  if (!p) return null;
  const pct = Math.min(100, p.plan > 0 ? (p.points / p.plan) * 100 : 0);
  const unacked = p.sent_at && !p.ack_at;
  return (
    <div className={cx('mb-6 rounded-[22px] p-4', unacked ? 'bg-accent/[0.12] ring-2 ring-inset ring-accent' : 'bg-card')}>
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />План KPI · {p.month_label}
        </div>
        <div className={cx('font-dot text-[15px] font-semibold', scoreTone(p.score))}>KPI {p.score}%</div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-dot text-[40px] font-semibold leading-none text-accent-ink">{num(p.points)}</span>
        <span className="text-[16px] text-muted">из {num(p.plan)} баллов</span>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-fill">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      {p.min_points ? (
        <div className="relative h-0">
          <div className="absolute -top-[14px] h-[18px] w-[2px] bg-ink/60" style={{ left: `${Math.min(100, (p.min_points / (p.plan || 1)) * 100)}%` }} title="минимальный план" />
        </div>
      ) : null}
      {p.below_min && (
        <div className="mt-2 rounded-xl bg-[#D71921]/10 px-3 py-2 text-[13px]">
          KPI начнёт считаться с <b>{num(p.min_points)}</b> баллов — осталось {num(Math.max(0, (p.min_points ?? 0) - p.points))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-3 text-[12.5px] text-muted">
        <span>{p.plan_pct}% плана</span>
        {p.adjust ? <span className={p.adjust > 0 ? 'text-[#248A3D] dark:text-[#30D158]' : 'text-[#D70015] dark:text-[#FF453A]'}>{p.adjust > 0 ? 'бонусы' : 'штрафы'} {p.adjust > 0 ? '+' : ''}{num(p.adjust)}</span> : null}
        <span>в срок {p.on_time_pct == null ? '—' : `${p.on_time_pct}%`}</span>
        <span>замечаний {p.remarks}</span>
      </div>
      {unacked ? (
        <Button className="mt-4" loading={busy} icon={<CheckCircle2 size={18} strokeWidth={1.75} />} onClick={async () => {
          setBusy(true);
          try { await api.ackPlan(); haptic.success(); toast('План подтверждён'); load(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
        }}>Ознакомлен с планом</Button>
      ) : p.ack_at ? (
        <div className="mt-3 flex items-center gap-1.5 text-[12.5px] text-muted"><CheckCircle2 size={14} strokeWidth={1.75} /> Ознакомлен {fmtDate(p.ack_at)}</div>
      ) : (
        <div className="mt-3 flex items-center gap-1.5 text-[12.5px] text-muted"><Clock size={14} strokeWidth={1.75} /> План пришлют 1-го числа</div>
      )}
    </div>
  );
}
