import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, Check, Flame, Lightbulb, Phone, PhoneCall, PhoneMissed, PhoneOff, Plus, RotateCcw, Timer, Trash2, Trophy, Undo2 } from 'lucide-react';
import { api } from '../api';
import { useConfig } from '../config';
import { haptic } from '../telegram';
import type { CallOutcome, MgrGame, MgrMe, SalesCfg, SalesCfgKpi, SalesDetail, SalesFull, SalesGap, SalesList, SalesSettings } from '../types';
import { Button, Chips, Collapse, Field, Input, Label, Segmented, Sheet, Spinner, Toggle, cx, useToast } from '../components/ui';
import { FatBar, GameButton, Segments, XpChip } from '../components/game';
import { playOnce } from '../sounds';

/* ================================================================================================
 * «Продажи»: KPI менеджеров как в таблице «KPI менеджера» + игра «Звонилка» + бот-коуч.
 * Менеджер видит свой бонус и сколько всего получит; главный администратор — всех и все настройки.
 * ================================================================================================ */

const lei = (n: number | null | undefined) => `${Math.round(n ?? 0).toLocaleString('ru-RU')} MDL`;
const pctS = (n: number | null | undefined) => `${Math.round(n ?? 0)}%`;
const dec = (n: number | null | undefined, d = 2) => (n ?? 0).toFixed(d).replace('.', ',');
const fmtVal = (v: number | null, unit: string) => (v == null ? '—' : unit === 'MDL' ? lei(v) : `${Math.round(v * 10) / 10}${unit === '%' ? '%' : ` ${unit}`}`);
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_S = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const curMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Chisinau' }).slice(0, 7);
const shiftMonth = (ym: string, d: number) => {
  let [y, m] = ym.split('-').map(Number);
  m += d; while (m < 1) { m += 12; y -= 1; } while (m > 12) { m -= 12; y += 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
};
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
const green = 'text-[#248A3D] dark:text-[#30D158]';
const orange = 'text-[#C93400] dark:text-[#FF9F0A]';
const red = 'text-[#D70015] dark:text-[#FF453A]';
const pctTone = (p: number) => (p >= 100 ? green : p >= 70 ? orange : red);

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mt-4 rounded-[22px] bg-card p-4', className)}>{children}</div>;
}
function Eyebrow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">{children}</span>
      {right}
    </div>
  );
}
function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const cur = curMonth();
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(shiftMonth(value, -1))} className="h-10 w-10 rounded-full bg-card text-[18px] ring-1 ring-inset ring-line active:opacity-60">‹</button>
      <div className="min-w-[150px] text-center text-[15px] font-semibold capitalize">{monthName(value)}</div>
      <button disabled={value >= cur} onClick={() => onChange(shiftMonth(value, 1))} className="h-10 w-10 rounded-full bg-card text-[18px] ring-1 ring-inset ring-line active:opacity-60 disabled:opacity-30">›</button>
    </div>
  );
}

/* ---------------- Выплата: сколько получит ---------------- */

function PayoutCard({ d, title = 'К выплате за месяц' }: { d: SalesFull; title?: string }) {
  const c = d.calc;
  const lines: [string, number, string?][] = [
    ['Оклад', c.salary],
    ['Премия', c.premium, c.below_cutoff ? `ниже порога ${d.cfg.cutoff}% плана — премии нет` : `${lei(c.revenue)} × ${dec(d.cfg.rate, 1)}% × K_KPI ${dec(c.kkpi)} × K ${dec(c.k)}${c.critical ? ` − ${d.cfg.crit.cut}% (критическое недовыполнение)` : ''}`],
  ];
  if (c.bonus) lines.push([`Бонус ≥${d.cfg.bonus.from}% плана`, c.bonus]);
  for (const s of c.supers) lines.push([`🏆 ${s.label}${s.count > 1 ? ` × ${s.count}` : ''}`, s.total, s.note]);
  if (d.cfg.gap_fine > 0 && c.auto.tasks_bad > 0) lines.push(['Штраф: незаполненные заявки', -(d.cfg.gap_fine * c.auto.tasks_bad), `${c.auto.tasks_bad} шт.`]);
  for (const p of c.penalties) lines.push([`Штраф: ${p.label}`, -p.total, `${p.count} шт. × ${lei(p.amount)}`]);
  if (c.strikes.cut > 0) lines.push([`⚠️ ${c.strikes.label}`, -c.strikes.cut, `списано ${c.strikes.pct}% с бонусной части`]);
  return (
    <Card>
      <Eyebrow right={<span className={cx('font-mono text-[11px]', pctTone(c.pct))}>{pctS(c.pct)} плана</span>}>{title}</Eyebrow>
      {c.strikes.count > 0 && (
        <div className={cx('mb-2 rounded-xl px-3 py-2 text-[13px] font-semibold', c.strikes.tier >= 5 ? cx('bg-[#FF453A]/15', red) : 'bg-[#FF9F0A]/15 text-[#C93400] dark:text-[#FF9F0A]')}>
          ⚠️ {c.strikes.label} ({c.strikes.count}/5){c.strikes.pct > 0 ? ` — списание ${c.strikes.pct}%` : ''}
        </div>
      )}
      <div className="font-dot whitespace-nowrap text-[34px] leading-none">{lei(c.total)}</div>
      <div className="mt-1 text-[13.5px] text-muted">
        бонусная часть <b className="text-ink dark:text-white">{lei(Math.max(0, c.premium + c.bonus + c.supers_total - c.fine - c.strikes.cut))}</b>
      </div>
      <div className="mt-4 divide-y divide-dashed divide-line">
        {lines.map(([l, v, hint]) => (
          <div key={l} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[15px]">{l}</div>
              {hint && <div className="text-[12.5px] leading-snug text-muted">{hint}</div>}
            </div>
            <div className={cx('shrink-0 text-[15px] font-semibold', v < 0 && red)}>{v < 0 ? `−${lei(-v)}` : lei(v)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PlanCard({ d }: { d: SalesFull }) {
  const c = d.calc;
  const marks = [{ at: (d.cfg.cutoff / 130) * 100, label: `${d.cfg.cutoff}%` }, { at: (100 / 130) * 100, label: '100%' }, { at: 100, label: '130%' }].filter((m) => m.at > 0);
  return (
    <Card>
      <Eyebrow>План продаж · {d.month_label}</Eyebrow>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className={cx('font-dot text-[34px] leading-none', pctTone(c.pct))}>{pctS(c.pct)}</div>
          <div className="mt-1 text-[13px] text-muted">{lei(c.revenue)} из {lei(c.plan)}</div>
        </div>
        <div className="text-right text-[13px] text-muted">K_KPI <b className="text-ink dark:text-white">{dec(c.kkpi)}</b><br />K(%плана) <b className="text-ink dark:text-white">{dec(c.k)}</b></div>
      </div>
      <div className="mt-4"><FatBar pct={(c.pct / 130) * 100} marks={marks} color={c.pct >= 100 ? 'bg-[#34C759]' : 'bg-accent'} /></div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {c.structure.map((s) => (
          <div key={s.id} className="rounded-2xl bg-fill px-3 py-2">
            <div className="text-[11.5px] leading-tight text-muted">{s.label}</div>
            <div className="mt-1 text-[14px] font-semibold">{lei(s.plan)}</div>
            <div className="text-[11px] text-muted">{s.share}%</div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-[12.5px] text-muted">Из приложения: B2C {lei(c.auto.revenue_b2c)} · B2B {lei(c.auto.revenue_b2b)} · выполнено заявок {c.auto.done}</div>
    </Card>
  );
}

function WhatIfCard({ d }: { d: SalesFull }) {
  return (
    <Card>
      <Eyebrow>Если перевыполнить план</Eyebrow>
      <div className="flex flex-col gap-2">
        {d.what_if.map((w) => (
          <div key={w.pct} className={cx('flex items-center gap-3 rounded-2xl px-3 py-2.5', w.reached ? 'bg-[#34C759]/12' : 'bg-fill')}>
            <div className={cx('font-dot w-14 text-[20px]', w.reached && green)}>{w.pct}%</div>
            <div className="min-w-0 flex-1 text-[13px] text-muted">{w.reached ? 'достигнуто ✓' : `ещё ${lei(w.need)}`}{w.bonus ? ` · +${lei(w.bonus)} бонус` : ''}</div>
            <div className="text-right text-[15px] font-semibold">{lei(w.total)}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-[12px] text-muted">Расчёт с текущим K_KPI {dec(d.calc.kkpi)}: чем лучше показатели ниже, тем больше премия.</div>
    </Card>
  );
}

function KpiList({ d }: { d: SalesFull }) {
  return (
    <Card>
      <Eyebrow right={<span className="font-mono text-[11px] text-muted">K_KPI {dec(d.calc.kkpi)}</span>}>Показатели KPI</Eyebrow>
      <div className="flex flex-col gap-3.5">
        {d.calc.kpis.map((k) => (
          <div key={k.id}>
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0 text-[14.5px] font-medium">{k.label} <span className="text-[12px] text-muted">· вес {k.weight}%</span></div>
              <div className="shrink-0 text-[13.5px]"><b>{fmtVal(k.value, k.unit)}</b> <span className="text-muted">/ {k.dir === 'down' ? 'макс. ' : ''}{fmtVal(k.target, k.unit)}</span></div>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-fill">
              <div className={cx('h-full rounded-full', k.ratio >= 1 ? 'bg-[#34C759]' : k.ratio >= 0.7 ? 'bg-[#FF9F0A]' : 'bg-[#FF453A]')} style={{ width: `${Math.min(100, k.ratio * 100)}%` }} />
            </div>
            <div className="mt-1 text-[11.5px] text-muted">
              {k.dir === 'down' ? 'меньше — лучше' : 'больше — лучше'} · вклад {dec(k.score)}{k.value == null ? ' · нет данных' : ''}{k.src === 'manual' ? ' · вносит офис' : k.manual ? ' · исправлено офисом' : ' · из приложения'}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TipsCard({ tips, title = 'Бот-коуч советует' }: { tips: SalesFull['tips']; title?: string }) {
  if (!tips.length) return null;
  return (
    <Card>
      <Eyebrow>{title}</Eyebrow>
      <div className="flex flex-col gap-3">
        {tips.map((t, i) => (
          <div key={i} className="flex gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-ink"><Lightbulb size={17} strokeWidth={1.75} /></span>
            <div className="min-w-0">
              <div className="text-[14.5px] font-semibold leading-snug">{t.title}</div>
              <div className="mt-0.5 text-[13.5px] leading-snug text-muted">{t.text}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SupersCard({ d }: { d: SalesFull }) {
  const got = new Map(d.calc.supers.map((s) => [s.id, s]));
  return (
    <Card>
      <Eyebrow>Супербонусы за крутые результаты</Eyebrow>
      <div className="flex flex-col gap-2">
        <div className={cx('flex items-center gap-3 rounded-2xl px-3 py-2.5', d.calc.bonus ? 'bg-[#34C759]/12' : 'bg-fill')}>
          <Trophy size={18} strokeWidth={1.75} className={d.calc.bonus ? green : 'text-muted'} />
          <div className="min-w-0 flex-1"><div className="text-[14px] font-medium">План ≥{d.cfg.bonus.from}%</div><div className="text-[12px] text-muted">разовый бонус месяца</div></div>
          <div className="text-[14px] font-semibold">+{lei(d.cfg.bonus.amount)}</div>
        </div>
        {d.cfg.supers.map((s) => {
          const g = got.get(s.id);
          return (
            <div key={s.id} className={cx('flex items-center gap-3 rounded-2xl px-3 py-2.5', g ? 'bg-[#34C759]/12' : 'bg-fill')}>
              <Trophy size={18} strokeWidth={1.75} className={g ? green : 'text-muted'} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium">{s.label}{g && g.count > 1 ? ` × ${g.count}` : ''}</div>
                <div className="text-[12px] leading-snug text-muted">{s.hint.replace(/\bN\b/g, String(s.param ?? '')).replace('от суммы (MDL)', `от ${lei(s.param)}`)}</div>
              </div>
              <div className="text-[14px] font-semibold">{g ? lei(g.total) : `+${lei(s.amount)}`}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------------- «Звонилка» ---------------- */

const OUT: Record<CallOutcome, { label: string; icon: ReactNode; tone: 'green' | 'yellow' | 'red' | 'ghost' }> = {
  deal: { label: 'Сделка', icon: <Check size={20} strokeWidth={2.5} />, tone: 'green' },
  callback: { label: 'Перезвонить', icon: <RotateCcw size={19} strokeWidth={2.25} />, tone: 'yellow' },
  refuse: { label: 'Отказ', icon: <PhoneOff size={19} strokeWidth={2.25} />, tone: 'red' },
  no_answer: { label: 'Не дозвонился', icon: <PhoneMissed size={19} strokeWidth={2.25} />, tone: 'ghost' },
};

function CallSheet({ open, onClose, onSaved, fromCallback }: {
  open: boolean; onClose: () => void; onSaved: (g: MgrGame, events: { kind: string; text: string }[], xp: number) => void; fromCallback?: { id: string; client: string; phone: string } | null;
}) {
  const toast = useToast();
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [amount, setAmount] = useState('');
  const [sub, setSub] = useState(false);
  const [b2b, setB2b] = useState(false);
  const [client, setClient] = useState('');
  const [phone, setPhone] = useState('');
  const [when, setWhen] = useState('2h');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setOutcome(null); setAmount(''); setSub(false); setB2b(false); setWhen('2h');
    setClient(fromCallback?.client || ''); setPhone(fromCallback?.phone || '');
  }, [open, fromCallback]);
  const cbAt = () => {
    const d = new Date();
    if (when === '1h') d.setHours(d.getHours() + 1);
    else if (when === '2h') d.setHours(d.getHours() + 2);
    else if (when === 'eve') d.setHours(17, 0, 0, 0);
    else { d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); }
    return d.toISOString();
  };
  async function save(o: CallOutcome) {
    setBusy(true);
    try {
      const r = await api.mgrCall({ outcome: o, amount, sub, b2b, client, phone, callback_at: o === 'callback' ? cbAt() : undefined, from_callback: fromCallback?.id });
      haptic.success();
      onSaved(r.game, r.events, r.xp);
      onClose();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  const quick = (o: CallOutcome) => { haptic.tap(); if (o === 'deal' || o === 'callback') setOutcome(o); else save(o); };
  return (
    <Sheet open={open} onClose={onClose} title={fromCallback ? `Перезвон: ${fromCallback.client || 'клиент'}` : 'Результат звонка'}>
      {!outcome ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(OUT) as CallOutcome[]).map((o) => (
              <GameButton key={o} tone={OUT[o].tone} icon={OUT[o].icon} onClick={() => quick(o)} loading={busy && !outcome}>{OUT[o].label}</GameButton>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Клиент (необязательно)" value={client} onChange={(e) => setClient(e.target.value)} />
            <Input placeholder="Телефон" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="text-center text-[12.5px] text-muted">Звонок +2 XP · дозвон +3 · сделка +25 · абонент +15</div>
        </div>
      ) : outcome === 'deal' ? (
        <div className="flex flex-col gap-3">
          <Field label="Сумма сделки, MDL"><Input inputMode="decimal" placeholder="например, 1 200" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
          <Toggle label="Абонентский / повторный договор" checked={sub} onChange={setSub} />
          <Toggle label="Юрлицо (B2B)" checked={b2b} onChange={setB2b} />
          <Input placeholder="Клиент" value={client} onChange={(e) => setClient(e.target.value)} />
          <GameButton tone="green" icon={<Check size={20} strokeWidth={2.5} />} loading={busy} onClick={() => save('deal')}>Записать сделку</GameButton>
          <button onClick={() => setOutcome(null)} className="text-[14px] text-muted">Назад</button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Когда перезвонить — бот напомнит">
            <Chips options={[{ id: '1h', label: 'Через час' }, { id: '2h', label: 'Через 2 часа' }, { id: 'eve', label: 'Сегодня в 17:00' }, { id: 'tmr', label: 'Завтра в 10:00' }]} value={when} onChange={setWhen} />
          </Field>
          <Input placeholder="Клиент" value={client} onChange={(e) => setClient(e.target.value)} />
          <Input placeholder="Телефон" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <GameButton tone="yellow" icon={<RotateCcw size={19} strokeWidth={2.25} />} loading={busy} onClick={() => save('callback')}>Запланировать перезвон</GameButton>
          <button onClick={() => setOutcome(null)} className="text-[14px] text-muted">Назад</button>
        </div>
      )}
    </Sheet>
  );
}

function CallGame({ game, setGame }: { game: MgrGame; setGame: (g: MgrGame) => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [cb, setCb] = useState<{ id: string; client: string; phone: string } | null>(null);
  const [flash, setFlash] = useState<{ xp: number; events: { kind: string; text: string }[] } | null>(null);
  const [power, setPower] = useState<{ start: number; base: number } | null>(null);
  const [, tick] = useState(0);
  const timer = useRef<number | null>(null) as { current: number | null };
  useEffect(() => {
    if (!power) return;
    timer.current = window.setInterval(() => tick((x) => x + 1), 1000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [power]);
  useEffect(() => { if (!flash) return; const t = window.setTimeout(() => setFlash(null), 3500); return () => window.clearTimeout(t); }, [flash]);
  const lv = game.level;
  const left = power ? Math.max(0, 3600 - Math.floor((Date.now() - power.start) / 1000)) : 0;
  const powerCalls = power ? game.today.calls - power.base : 0;
  useEffect(() => { if (power && left === 0) { toast(`Час силы окончен: ${powerCalls} звонков!`, 'ok'); setPower(null); } }, [left, power, powerCalls, toast]);
  async function undo(id: string) {
    try { const r = await api.mgrCallUndo(id); setGame(r.game); haptic.tap(); } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function cbDone(id: string) {
    try { await api.mgrCallbackDone(id); setGame({ ...game, callbacks: game.callbacks.filter((c) => c.id !== id) }); } catch (e) { toast((e as Error).message, 'error'); }
  }
  return (
    <Card className="relative overflow-hidden">
      <Eyebrow right={<span className="font-mono text-[11px] text-muted">ур. {lv.level} · {lv.title}</span>}>Звонилка</Eyebrow>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="h-3 overflow-hidden rounded-full bg-fill"><div className="h-full rounded-full bg-[#FFD23F]" style={{ width: `${Math.min(100, ((game.xp - lv.from) / Math.max(1, lv.to - lv.from)) * 100)}%` }} /></div>
          <div className="mt-1 text-[12px] text-muted">{game.xp} / {lv.to} XP · сегодня +{game.xp_today}</div>
        </div>
        {game.combo >= 2 && <span className="flex items-center gap-1 rounded-full bg-[#FF453A]/15 px-2.5 py-1 text-[13px] font-extrabold text-[#FF453A]"><Flame size={14} />×{game.combo}</span>}
        {game.streak > 0 && <span className="rounded-full bg-accent/15 px-2.5 py-1 text-[13px] font-bold text-accent-ink">🔥 {game.streak} дн.</span>}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[['Звонков', game.today.calls], ['Дозвонов', game.today.reached], ['Сделок', game.today.deals]].map(([l, v]) => (
          <div key={l as string} className="rounded-2xl bg-fill py-2.5"><div className="font-dot text-[26px] leading-none">{v}</div><div className="mt-1 text-[11px] text-muted">{l}</div></div>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        {game.quests.map((q) => (
          <div key={q.id}>
            <div className="mb-1 flex items-center justify-between text-[13.5px]">
              <span className={cx('font-medium', q.done && green)}>{q.done ? '✓ ' : ''}Квест: {q.title}</span>
              <span className="text-muted">{Math.min(q.have, q.need)}/{q.need} · <b className="text-[#9A7A00] dark:text-[#FFD23F]">+{q.xp} XP</b></span>
            </div>
            {q.need <= 20 ? <Segments total={q.need} done={Math.min(q.have, q.need)} /> : (
              <div className="h-3 overflow-hidden rounded-[4px] bg-fill"><div className="h-full bg-[#FFD23F]" style={{ width: `${Math.min(100, (q.have / q.need) * 100)}%` }} /></div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        <GameButton icon={<PhoneCall size={20} strokeWidth={2.25} />} onClick={() => { haptic.tap(); setCb(null); setOpen(true); }}>Позвонил — записать результат</GameButton>
        {power ? (
          <div className="flex items-center justify-between rounded-2xl bg-[#FF453A]/12 px-4 py-3">
            <span className="flex items-center gap-2 text-[14.5px] font-bold text-[#FF453A]"><Timer size={18} />Час силы · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>
            <span className="text-[14.5px] font-bold">{powerCalls} зв.</span>
          </div>
        ) : (
          <GameButton small tone="ghost" icon={<Timer size={17} />} onClick={() => { haptic.tap(); setPower({ start: Date.now(), base: game.today.calls }); }}>Час силы: 60 минут без перерыва</GameButton>
        )}
        <div className="text-center text-[12px] text-muted">Рекорд звонков за день: {game.best_day}</div>
      </div>

      {game.callbacks.length > 0 && (
        <div className="mt-4">
          <Label className="mb-2">Перезвонить</Label>
          <div className="flex flex-col gap-2">
            {game.callbacks.map((c) => (
              <div key={c.id} className={cx('flex items-center gap-3 rounded-2xl px-3 py-2.5', c.overdue ? 'bg-[#FF9F0A]/15' : 'bg-fill')}>
                <Phone size={17} className={c.overdue ? orange : 'text-muted'} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{c.client || 'Клиент'}{c.phone ? ` · ${c.phone}` : ''}</div>
                  <div className="text-[12px] text-muted">{new Date(c.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{c.overdue ? ' · пора!' : ''}</div>
                </div>
                <button onClick={() => { setCb({ id: c.id, client: c.client, phone: c.phone }); setOpen(true); }} className="rounded-xl bg-accent px-3 py-2 text-[13px] font-bold text-black">Звоню</button>
                <button onClick={() => cbDone(c.id)} aria-label="Убрать" className="p-1 text-muted"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {game.recent.length > 0 && (
        <div className="mt-4">
          <Label className="mb-2">Последние звонки</Label>
          <div className="flex flex-col divide-y divide-dashed divide-line">
            {game.recent.slice(0, 5).map((c) => (
              <div key={c.id} className="flex items-center gap-2 py-2 text-[13.5px]">
                <span className="w-24 shrink-0 font-medium">{OUT[c.outcome].label}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{[c.client, c.amount ? lei(c.amount) : '', c.sub ? 'абонент' : '', c.b2b ? 'B2B' : ''].filter(Boolean).join(' · ')}</span>
                <span className="text-[12px] text-muted">{new Date(c.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                {Date.now() - Date.parse(c.created_at) < 15 * 60000 && <button onClick={() => undo(c.id)} aria-label="Отменить" className="p-1 text-muted"><Undo2 size={15} /></button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {flash && (
        <div className="pointer-events-none absolute inset-x-4 top-4 flex flex-col items-center gap-1.5 rounded-2xl bg-black/85 px-4 py-3 text-center text-white shadow-lg ring-1 ring-white/10">
          <XpChip xp={flash.xp} />
          {flash.events.map((e, i) => <div key={i} className="text-[14px] font-bold">{e.kind === 'big' ? '💎 ' : e.kind === 'combo' ? '🔥 ' : '🏁 '}{e.text}</div>)}
        </div>
      )}
      <CallSheet open={open} onClose={() => setOpen(false)} fromCallback={cb}
        onSaved={(g, events, xp) => { setGame(g); setFlash({ xp, events }); }} />
    </Card>
  );
}

/* ---------------- незаполненные заявки ---------------- */

function FillSheet({ gap, labels, onClose, onDone }: { gap: SalesGap | null; labels: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const cfg = useConfig();
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!gap) return;
    const dt = gap.planned_at ? new Date(gap.planned_at) : null;
    setF({
      phone: gap.phone || '', address: gap.address || '', price: gap.price == null ? '' : String(gap.price), procedure: gap.procedure || '', point_cat: gap.point_cat || '', company: gap.company || '',
      date: dt ? dt.toLocaleDateString('en-CA', { timeZone: 'Europe/Chisinau' }) : '', time: dt && gap.has_time ? dt.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Chisinau', hour: '2-digit', minute: '2-digit' }) : '',
    });
  }, [gap]);
  if (!gap) return null;
  const need = new Set(gap.fields);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    setBusy(true);
    try {
      const body: Record<string, string> = {};
      for (const k of ['phone', 'address', 'price', 'procedure', 'point_cat', 'company']) if (need.has(k) || (k === 'company' && need.has('company'))) body[k] = f[k] || '';
      if (need.has('date') || need.has('time')) { body.date = f.date || ''; body.time = f.time || ''; }
      const r = await api.taskFill(gap!.task_id, body);
      if (r.missing.length) toast(`Ещё не хватает: ${r.missing.map((m) => labels[m] || m).join(', ')}`, 'error');
      else { haptic.success(); toast('Заявка исправлена — напоминания остановлены', 'ok'); }
      onDone();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={`Исправить заявку № ${gap.task_no}`}>
      <div className="flex flex-col gap-3">
        <div className="text-[13.5px] text-muted">{gap.company || gap.address}</div>
        {need.has('phone') && <Field label="Телефон"><Input inputMode="tel" value={f.phone || ''} onChange={(e) => set('phone', e.target.value)} placeholder="069 123 456" /></Field>}
        {need.has('address') && <Field label="Адрес"><Input value={f.address || ''} onChange={(e) => set('address', e.target.value)} /></Field>}
        {need.has('company') && <Field label="Клиент"><Input value={f.company || ''} onChange={(e) => set('company', e.target.value)} placeholder="SRL … или имя" /></Field>}
        {(need.has('date') || need.has('time')) && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Дата"><Input type="date" value={f.date || ''} onChange={(e) => set('date', e.target.value)} /></Field>
            <Field label="Время"><Input type="time" value={f.time || ''} onChange={(e) => set('time', e.target.value)} /></Field>
          </div>
        )}
        {need.has('price') && <Field label="Цена, лей"><Input inputMode="decimal" value={f.price || ''} onChange={(e) => set('price', e.target.value)} /></Field>}
        {need.has('procedure') && <Field label="Процедура"><Chips options={cfg.procedures.map((p) => ({ id: p, label: p }))} value={f.procedure || ''} onChange={(v) => set('procedure', v)} columns={3} /></Field>}
        {need.has('point_cat') && <Field label="Тип помещения"><Chips options={cfg.pointCats.map((c) => ({ id: c.id, label: c.label }))} value={f.point_cat || ''} onChange={(v) => set('point_cat', v)} columns={3} /></Field>}
        <Button onClick={save} loading={busy}>Сохранить</Button>
      </div>
    </Sheet>
  );
}

function GapsCard({ gaps, labels, onChanged, readOnly }: { gaps: SalesGap[]; labels: Record<string, string>; onChanged: () => void; readOnly?: boolean }) {
  const [open, setOpen] = useState<SalesGap | null>(null);
  if (!gaps.length) return null;
  return (
    <Card className="ring-2 ring-inset ring-[#FF453A]/60">
      <Eyebrow right={<AlertTriangle size={16} className={red} />}>Ошибки в заявках · {gaps.length}</Eyebrow>
      <div className="mb-2 text-[13px] text-muted">В заявке всегда должны быть адрес, дата и время, телефон. Пока не исправлено — бот напоминает каждые 5 минут. Влияет на KPI «CRM».</div>
      <div className="flex flex-col gap-2">
        {gaps.map((g) => (
          <div key={g.task_id} className="flex items-center gap-3 rounded-2xl bg-fill px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14.5px] font-semibold">№ {g.task_no} · {g.company || g.address}</div>
              <div className="text-[12.5px] text-[#C93400] dark:text-[#FF9F0A]">нет: {g.fields.map((f) => labels[f] || f).join(', ')}{g.pings ? ` · напоминаний ${g.pings}` : ''}</div>
            </div>
            {!readOnly && <button onClick={() => setOpen(g)} className="rounded-xl bg-accent px-3 py-2 text-[13px] font-bold text-black">Исправить</button>}
          </div>
        ))}
      </div>
      <FillSheet gap={open} labels={labels} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onChanged(); }} />
    </Card>
  );
}

/* ---------------- Менеджер: «Мои продажи» ---------------- */

export function MySales({ focus }: { focus?: string }) {
  const toast = useToast();
  const [month, setMonth] = useState(curMonth());
  const [d, setD] = useState<MgrMe | null>(null);
  const [sub, setSub] = useState<'money' | 'calls' | 'kpi'>(focus === 'calls' ? 'calls' : 'money');
  const load = useCallback(() => api.mgrMe(month).then(setD).catch((e: Error) => toast(e.message, 'error')), [month, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = window.setInterval(load, 60000); return () => window.clearInterval(t); }, [load]);
  if (!d) return <Spinner />;
  const setGame = (g: MgrGame) => { setD({ ...d, game: g }); };
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <MonthPicker value={month} onChange={setMonth} />
        <div className="w-full max-w-sm"><Segmented options={[{ id: 'money', label: 'Мой бонус' }, { id: 'calls', label: 'Звонилка' }, { id: 'kpi', label: 'KPI и советы' }]} value={sub} onChange={setSub} /></div>
      </div>
      <GapsCard gaps={d.gaps} labels={d.gap_labels} onChanged={load} />
      {sub === 'money' && (
        <div className="md:grid md:grid-cols-2 md:gap-4">
          <div><PayoutCard d={d} title="Получу за месяц" /><WhatIfCard d={d} /></div>
          <div><PlanCard d={d} /><SupersCard d={d} /></div>
        </div>
      )}
      {sub === 'calls' && (
        <div className="md:grid md:grid-cols-2 md:gap-4">
          <CallGame game={d.game} setGame={setGame} />
          <div>
            <Card>
              <Eyebrow>Лига менеджеров · {d.month_label}</Eyebrow>
              <div className="flex flex-col gap-2">
                {d.league.map((l, i) => (
                  <div key={i} className={cx('flex items-center gap-3 rounded-2xl px-3 py-2.5', l.me ? 'bg-accent/15' : 'bg-fill')}>
                    <span className="font-dot w-6 text-[18px]">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{l.name}{l.me ? ' (вы)' : ''}</span>
                    <span className={cx('text-[14px] font-bold', pctTone(l.pct))}>{l.pct}%</span>
                    <span className="w-16 text-right text-[12.5px] text-muted">{l.xp} XP</span>
                  </div>
                ))}
              </div>
            </Card>
            <TipsCard tips={d.tips.slice(0, 3)} />
          </div>
        </div>
      )}
      {sub === 'kpi' && (
        <div className="md:grid md:grid-cols-2 md:gap-4">
          <KpiList d={d} />
          <TipsCard tips={d.tips} />
        </div>
      )}
    </>
  );
}

/** Карточка на «Обзоре» менеджера: сколько получит + быстрый звонок. */
export function MgrHero({ onOpen }: { onOpen: (focus?: string) => void }) {
  const [d, setD] = useState<MgrMe | null>(null);
  useEffect(() => { api.mgrMe().then(setD).catch(() => {}); }, []);
  useEffect(() => {
    if (d && d.calc.pct >= 100) playOnce(`kpi_done_${d.month}`, 'kpi');
  }, [d]);
  if (!d) return null;
  const c = d.calc;
  const q = d.game.quests[0];
  return (
    <div className="mb-4 rounded-[22px] bg-card p-4">
      <div className="flex items-start justify-between gap-3" role="button" onClick={() => onOpen('money')}>
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">Получу за {MONTHS[Number(d.month.slice(5)) - 1]}</div>
          <div className="font-dot mt-1 whitespace-nowrap text-[30px] leading-none">{lei(c.total)}</div>
          <div className="mt-1 text-[13px] text-muted">бонус {lei(Math.max(0, c.premium + c.bonus + c.supers_total - c.fine - c.strikes.cut))} · план <b className={pctTone(c.pct)}>{pctS(c.pct)}</b></div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {d.gaps.length > 0 && <span className="whitespace-nowrap rounded-full bg-[#FF9F0A]/15 px-2.5 py-1 text-[12.5px] font-bold text-[#C93400] dark:text-[#FF9F0A]">🚨 {d.gaps.length}</span>}
          {c.strikes.count > 0 && <span className="whitespace-nowrap rounded-full bg-[#FF453A]/15 px-2.5 py-1 text-[12.5px] font-bold text-[#D70015] dark:text-[#FF453A]">⚠️ {c.strikes.count}/5</span>}
        </div>
      </div>
      <div className="mt-3"><FatBar pct={(c.pct / 130) * 100} color={c.pct >= 100 ? 'bg-[#34C759]' : 'bg-accent'} /></div>
      {q && <div className="mb-3 text-[13px] text-muted">Квест дня: {q.title} — {Math.min(q.have, q.need)}/{q.need}</div>}
      <GameButton small icon={<PhoneCall size={18} />} onClick={() => onOpen('calls')}>Звонилка</GameButton>
    </div>
  );
}

/* ---------------- Администратор ---------------- */

/** Куда открыть «Продажи» (из карточки на «Обзоре» или по кнопке бота ?sales=calls). */
let nextFocus = '';
export const setSalesFocus = (f: string) => { nextFocus = f; };
export function SalesPanel() {
  const cfg = useConfig();
  const [focus] = useState(() => { const f = nextFocus; nextFocus = ''; return f; });
  if (!cfg.user.isOwner) return <MySales focus={focus} />;
  return <AdminSales />;
}

function AdminSales() {
  const toast = useToast();
  const [month, setMonth] = useState(curMonth());
  const [list, setList] = useState<SalesList | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => api.adminSales(month).then(setList).catch((e: Error) => toast(e.message, 'error')), [month, toast]);
  useEffect(() => { load(); }, [load]);
  if (open && list) return <ManagerDetail tg={open} month={month} list={list} onBack={() => { setOpen(null); load(); }} />;
  if (!list) return <Spinner />;
  const sum = (f: 'total' | 'premium' | 'revenue' | 'plan') => list.items.reduce((s, x) => s + x[f], 0);
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3"><MonthPicker value={month} onChange={setMonth} /></div>
      {list.items.length === 0 ? (
        <Card><div className="text-[15px]">Менеджеров пока нет.</div><div className="mt-1 text-[13.5px] text-muted">Назначьте сотруднику роль «Менеджер» в разделе «Сотрудники» — он появится здесь со схемой KPI из вашей таблицы.</div></Card>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2.5 md:grid-cols-4">
            {[['Выручка всех менеджеров', lei(sum('revenue'))], ['План всех менеджеров', lei(sum('plan'))], ['Премии всех', lei(sum('premium'))], ['Выплаты всем', lei(sum('total'))]].map(([l, v]) => (
              <div key={l} className="rounded-2xl bg-card p-3.5"><div className="font-dot text-[20px] leading-none">{v}</div><div className="mt-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted">{l}</div></div>
            ))}
          </div>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            {list.items.map((m) => (
              <button key={m.tg_id} onClick={() => { haptic.tap(); setOpen(m.tg_id); }} className="rounded-[22px] bg-card p-4 text-left active:opacity-70">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[17px] font-semibold">{m.name}</div>
                    <div className="text-[12.5px] text-muted">{list.presets[m.preset] || 'своя схема'}</div>
                  </div>
                  <div className={cx('font-dot text-[28px] leading-none', pctTone(m.pct))}>{pctS(m.pct)}</div>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-fill"><div className={cx('h-full rounded-full', m.pct >= 100 ? 'bg-[#34C759]' : 'bg-accent')} style={{ width: `${Math.min(100, m.pct)}%` }} /></div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[12.5px]">
                  <div><div className="text-muted">Факт</div><b>{lei(m.revenue)}</b></div>
                  <div><div className="text-muted">K_KPI · K</div><b>{dec(m.kkpi)} · {dec(m.k)}</b></div>
                  <div><div className="text-muted">Итого</div><b>{lei(m.total)}</b></div>
                </div>
                <div className="mt-2 text-[12.5px] text-muted">
                  звонков {m.calls} · сделок {m.deals}{m.supers ? ` · супербонусы ${lei(m.supers)}` : ''}{m.gaps ? <span className={orange}> · ⚠ незаполн. {m.gaps}</span> : ''}{m.strikes ? <span className={red}> · ⚠️ предупреждений {m.strikes}/5</span> : ''}{m.weak ? ` · слабое место: ${m.weak}` : ''}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
      <SalesSettingsCard list={list} onSaved={load} />
    </>
  );
}

function SalesSettingsCard({ list, onSaved }: { list: SalesList; onSaved: () => void }) {
  const toast = useToast();
  const [s, setS] = useState<SalesSettings>(list.settings);
  const [busy, setBusy] = useState(false);
  useEffect(() => setS(list.settings), [list.settings]);
  const g = s.gaps;
  const setG = (p: Partial<SalesSettings['gaps']>) => setS({ ...s, gaps: { ...g, ...p } });
  async function save() {
    setBusy(true);
    try { const r = await api.saveSalesSettings(s); setS(r.settings); toast('Сохранено', 'ok'); onSaved(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  const numIn = (v: number, on: (n: number) => void, w = 'w-20') => <Input inputMode="numeric" className={cx('!h-10 text-center', w)} value={String(v)} onChange={(e) => on(Number(e.target.value.replace(/\D/g, '')) || 0)} />;
  return (
    <>
      <Collapse id="sales-gaps" title="🚨 Ошибки в заявках (нет адреса / времени / телефона)" hint={g.on ? `напоминание каждые ${g.every_min} мин` : 'выключено'}>
        <div className="flex flex-col gap-3">
          <Toggle label="Напоминать менеджеру в бот, пока не исправит" checked={g.on} onChange={(v) => setG({ on: v })} />
          <Field label="Что обязательно в заявке (иначе — ошибка)">
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(list.gap_fields).map(([id, l]) => {
                const on = g.fields.includes(id);
                return <button key={id} onClick={() => setG({ fields: on ? g.fields.filter((x) => x !== id) : [...g.fields, id] })} className={cx('min-h-[42px] rounded-2xl px-3 text-[14px]', on ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>{l}</button>;
              })}
            </div>
          </Field>
          <div className="flex flex-wrap items-center gap-2 text-[14px]">Каждые {numIn(g.every_min, (n) => setG({ every_min: n }), 'w-16')} мин, не больше {numIn(g.max_pings, (n) => setG({ max_pings: n }), 'w-16')} раз</div>
          <div className="flex flex-wrap items-center gap-2 text-[14px]">Только с {numIn(g.from_hour, (n) => setG({ from_hour: n }), 'w-16')} до {numIn(g.to_hour, (n) => setG({ to_hour: n }), 'w-16')} ч</div>
          <div className="flex flex-wrap items-center gap-2 text-[14px]">Для KPI «CRM» заявка «вовремя», если дополнена за {numIn(g.grace_min, (n) => setG({ grace_min: n }), 'w-16')} мин</div>
          <div className="text-[12.5px] text-muted">Заявку создал менеджер — напоминания ему. Создал кто-то другой (администратор, чат) — всем менеджерам. Менеджеров нет — администраторам.</div>
        </div>
      </Collapse>
      <Collapse id="sales-coach" title="🤖 Бот-коуч менеджеров" hint={s.coach.on ? `каждое утро в ${s.coach.hour}:00` : 'выключен'}>
        <div className="flex flex-col gap-3">
          <Toggle label="Утром присылать план на день и советы" checked={s.coach.on} onChange={(v) => setS({ ...s, coach: { ...s.coach, on: v } })} />
          <div className="flex items-center gap-2 text-[14px]">Время {numIn(s.coach.hour, (n) => setS({ ...s, coach: { ...s.coach, hour: n } }), 'w-16')}:00</div>
          <Toggle label="Только в будни" checked={s.coach.weekdays} onChange={(v) => setS({ ...s, coach: { ...s.coach, weekdays: v } })} />
        </div>
      </Collapse>
      <Collapse id="sales-game" title="📞 Звонилка: квесты дня" hint={`${s.game.calls_day} звонков · ${s.game.reached_day} дозвонов · ${s.game.deals_day} сделки`}>
        <div className="flex flex-col gap-2 text-[14px]">
          <div className="flex items-center gap-2">Звонков {numIn(s.game.calls_day, (n) => setS({ ...s, game: { ...s.game, calls_day: n } }))}</div>
          <div className="flex items-center gap-2">Дозвонов {numIn(s.game.reached_day, (n) => setS({ ...s, game: { ...s.game, reached_day: n } }))}</div>
          <div className="flex items-center gap-2">Сделок {numIn(s.game.deals_day, (n) => setS({ ...s, game: { ...s.game, deals_day: n } }))}</div>
        </div>
      </Collapse>
      <Collapse id="sales-strikes" title="⚠️ Предупреждения менеджерам" hint={s.strikes.on ? `5 ступеней: ${s.strikes.pct.join(' / ')}%` : 'выключены'}>
        <div className="flex flex-col gap-3">
          <Toggle label="Включить списание с бонусной части по ступеням" checked={s.strikes.on} onChange={(v) => setS({ ...s, strikes: { ...s.strikes, on: v } })} />
          <div className="text-[13px] text-muted">За каждое выданное предупреждение в этом месяце со следующей ступени списывается указанный % бонусной части (премия + бонус + супербонусы). Первое предупреждение — по умолчанию 0% (просто предупреждение).</div>
          <div className="grid grid-cols-5 gap-2">
            {s.strikes.pct.map((p, i) => (
              <div key={i} className="text-center">
                <div className="mb-1 text-[11px] text-muted">{i + 1}-е</div>
                {numIn(p, (n) => setS({ ...s, strikes: { ...s.strikes, pct: s.strikes.pct.map((x, j) => (j === i ? Math.min(100, n) : x)) } }), 'w-full')}
                <div className="mt-0.5 text-[10px] text-muted">%</div>
              </div>
            ))}
          </div>
        </div>
      </Collapse>
      <div className="mt-3"><Button onClick={save} loading={busy} variant="secondary">Сохранить общие настройки</Button></div>
    </>
  );
}

function StrikesPanel({ tg, d, onSaved }: { tg: string; d: SalesDetail; onSaved: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const c = d.calc.strikes;
  async function issue() {
    setBusy(true);
    try {
      const r = await api.addStrike(tg, note, d.month);
      haptic.success();
      toast(r.pct > 0 ? `Выдано: ${r.tier}-е предупреждение, −${r.pct}% бонуса` : `Выдано: ${r.tier}-е предупреждение`, 'ok');
      setNote('');
      onSaved();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    try { await api.removeStrike(tg, id); haptic.success(); toast('Снято', 'ok'); onSaved(); } catch (e) { toast((e as Error).message, 'error'); }
  }
  return (
    <Card>
      <Eyebrow>Предупреждения за {monthName(d.month)}</Eyebrow>
      {c.count > 0 ? (
        <div className={cx('mb-3 rounded-xl px-3 py-2 text-[13px] font-semibold', c.tier >= 5 ? cx('bg-[#FF453A]/15', red) : 'bg-[#FF9F0A]/15 text-[#C93400] dark:text-[#FF9F0A]')}>
          {c.label} ({c.count}/5){c.pct > 0 ? ` — списание ${c.pct}% с бонусной части` : ''}
        </div>
      ) : <div className="mb-3 text-[14px] text-muted">В этом месяце предупреждений нет.</div>}
      <div className="space-y-2">
        {d.strikes_list.map((s, i) => (
          <div key={s.id} className="flex items-start justify-between gap-3 rounded-2xl bg-fill px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[14px] font-semibold">{i + 1}-е предупреждение</div>
              {s.note && <div className="text-[13px] text-muted">{s.note}</div>}
              <div className="text-[11.5px] text-muted">{new Date(s.created_at).toLocaleString('ru-RU')} · {s.created_by}</div>
            </div>
            <button onClick={() => remove(s.id)} className="shrink-0 rounded-full bg-card p-2 text-muted ring-1 ring-inset ring-line active:opacity-60"><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <Field label="Причина (необязательно)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="например: опоздал с отправкой заявки технику" /></Field>
        <Button className="mt-2" onClick={issue} loading={busy} variant="secondary">Выдать предупреждение</Button>
      </div>
    </Card>
  );
}

function ManagerDetail({ tg, month: m0, list, onBack }: { tg: string; month: string; list: SalesList; onBack: () => void }) {
  const toast = useToast();
  const [month, setMonth] = useState(m0);
  const [d, setD] = useState<SalesDetail | null>(null);
  const [tab, setTab] = useState<'month' | 'year' | 'facts' | 'cfg' | 'strikes'>('month');
  const load = useCallback(() => api.adminSalesOne(tg, month).then(setD).catch((e: Error) => toast(e.message, 'error')), [tg, month, toast]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <button onClick={onBack} className="mb-3 flex items-center gap-1.5 text-[15px] text-accent-ink active:opacity-60"><ArrowLeft size={18} />Все менеджеры</button>
      {!d ? <Spinner /> : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[22px] font-semibold">{d.user.name}</div>
            <MonthPicker value={month} onChange={setMonth} />
          </div>
          <Segmented options={[{ id: 'month', label: 'Месяц' }, { id: 'year', label: 'Итоги года' }, { id: 'facts', label: 'Факты' }, { id: 'cfg', label: 'Настройка KPI' }, { id: 'strikes', label: `⚠️ Предупреждения${d.calc.strikes.count ? ` · ${d.calc.strikes.count}` : ''}` }]} value={tab} onChange={setTab} />
          {tab === 'month' && (
            <div className="md:grid md:grid-cols-2 md:gap-4">
              <div><PayoutCard d={d} /><PlanCard d={d} /><WhatIfCard d={d} /></div>
              <div><KpiList d={d} /><TipsCard tips={d.tips} title="Что бот советует менеджеру" /><GapsCard gaps={d.gaps} labels={list.gap_fields} onChanged={load} readOnly /></div>
            </div>
          )}
          {tab === 'year' && <YearView d={d} />}
          {tab === 'facts' && <FactsForm d={d} month={month} onSaved={load} />}
          {tab === 'cfg' && <ConfigEditor tg={tg} d={d} list={list} onSaved={load} />}
          {tab === 'strikes' && <StrikesPanel tg={tg} d={d} onSaved={load} />}
        </>
      )}
    </>
  );
}

function YearView({ d }: { d: SalesDetail }) {
  const y = d.year;
  const th = 'px-2.5 py-2 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-muted whitespace-nowrap';
  const td = 'px-2.5 py-2 whitespace-nowrap text-[13px]';
  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {[['Годовой план', lei(y.plan)], ['Факт', `${lei(y.revenue)} · ${pctS(y.pct)}`], ['Средний K_KPI · K', `${dec(y.kkpi)} · ${dec(y.k)}`], ['Премии', lei(y.premium)], ['Бонусы', lei(y.bonus)], ['Оклад', lei(y.salary)], ['Итого за год', lei(y.total)], ['Мес. ≥100% / ниже порога', `${y.months_100} / ${y.months_below}`]].map(([l, v]) => (
          <div key={l} className="rounded-2xl bg-card p-3.5"><div className="text-[16px] font-semibold leading-tight">{v}</div><div className="mt-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted">{l}</div></div>
        ))}
      </div>
      <div className="mt-4 overflow-x-auto rounded-[22px] bg-card">
        <table className="w-full min-w-[820px] border-collapse">
          <thead><tr className="border-b border-line">
            {['Месяц', 'План', 'Факт', '% плана', ...d.calc.kpis.filter((k) => k.id !== 'plan').map((k) => k.label.split(' ')[0]), 'K_KPI', 'K', 'Бонус', 'Премия', 'Итого'].map((h) => <th key={h} className={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {d.months.map((m) => (
              <tr key={m.month} className={cx('border-b border-dashed border-line last:border-0', m.month === d.month && 'bg-accent/[0.08]', m.future && 'text-muted')}>
                <td className={cx(td, 'font-semibold')}>{m.label}</td>
                <td className={td}>{m.plan.toLocaleString('ru-RU')}</td>
                <td className={td}>{m.future ? '' : (m.revenue ?? 0).toLocaleString('ru-RU')}</td>
                <td className={cx(td, !m.future && pctTone(m.pct ?? 0))}>{m.future ? '' : pctS(m.pct)}</td>
                {d.calc.kpis.filter((k) => k.id !== 'plan').map((k) => <td key={k.id} className={td}>{m.future ? '' : fmtVal(m.values?.[k.id] ?? null, k.unit)}</td>)}
                <td className={td}>{m.future ? '' : dec(m.kkpi)}</td>
                <td className={td}>{m.future ? '' : dec(m.k)}</td>
                <td className={td}>{m.future ? '' : lei((m.bonus ?? 0) + (m.supers ?? 0))}</td>
                <td className={td}>{m.future ? '' : lei(m.premium)}</td>
                <td className={cx(td, 'font-semibold')}>{m.future ? '' : lei(m.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const FACTS: { id: string; label: string; unit: string; autoKey?: string }[] = [
  { id: 'revenue', label: 'Выручка (заменить)', unit: 'MDL', autoKey: 'revenue' },
  { id: 'revenue_extra', label: 'Доп. выручка вне приложения (договоры)', unit: 'MDL' },
  { id: 'conversion', label: 'Конверсия лид → сделка', unit: '%' },
  { id: 'avg_check', label: 'Средний чек', unit: 'MDL' },
  { id: 'subs_share', label: 'Доля абонентских/повторных', unit: '%' },
  { id: 'crm', label: 'CRM своевременность', unit: '%' },
  { id: 'churn', label: 'Отток', unit: '%' },
  { id: 'calls', label: 'Звонков', unit: 'шт', autoKey: 'calls' },
  { id: 'deals', label: 'Сделок', unit: 'шт', autoKey: 'deals' },
  { id: 'b2b_new', label: 'Новые B2B договоры', unit: 'шт', autoKey: 'b2b_new' },
  { id: 'reviews', label: 'Отзывы клиентов', unit: 'шт' },
];

function FactsForm({ d, month, onSaved }: { d: SalesDetail; month: string; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(Object.fromEntries(Object.entries(d.manual).map(([k, v]) => [k, String(v)]))); }, [d]);
  const custom = d.raw_cfg.kpis.filter((k) => k.custom);
  const autoVal = (id: string, autoKey?: string) => {
    if (autoKey) return (d.calc.auto as unknown as Record<string, number>)[autoKey];
    const k = d.calc.kpis.find((x) => x.id === id);
    return k && !k.manual ? k.value : null;
  };
  async function save() {
    setBusy(true);
    try { await api.saveSalesFacts(d.user.tg_id, month, f); toast('Факты сохранены — KPI пересчитан', 'ok'); onSaved(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <Card>
      <Eyebrow>Факты за {monthName(month)}</Eyebrow>
      <div className="mb-3 text-[13px] text-muted">Пустое поле — берётся из приложения (заявки менеджера, «Звонилка», пробелы в заявках). Заполненное — заменяет значение. Как жёлтые ячейки в вашей таблице.</div>
      <div className="grid gap-3 md:grid-cols-2">
        {[...FACTS, ...custom.map((k) => ({ id: k.id, label: k.label, unit: k.unit, autoKey: undefined }))].map((x) => {
          const a = autoVal(x.id, x.autoKey);
          return (
            <Field key={x.id} label={`${x.label}${x.unit ? `, ${x.unit}` : ''}`}>
              <Input inputMode="decimal" value={f[x.id] ?? ''} placeholder={a == null ? 'вносит офис' : `авто: ${Math.round(Number(a) * 10) / 10}`} onChange={(e) => setF({ ...f, [x.id]: e.target.value })} />
            </Field>
          );
        })}
      </div>
      <div className="mt-3"><Field label="Заметка"><Input value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
      {d.manual_at && <div className="mt-2 text-[12px] text-muted">Изменено {new Date(d.manual_at).toLocaleString('ru-RU')} · {d.manual_by}</div>}
      <div className="mt-4"><Button onClick={save} loading={busy}>Сохранить факты</Button></div>
    </Card>
  );
}

function ConfigEditor({ tg, d, list, onSaved }: { tg: string; d: SalesDetail; list: SalesList; onSaved: () => void }) {
  const toast = useToast();
  const [c, setC] = useState<SalesCfg>(d.raw_cfg);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addId, setAddId] = useState('');
  useEffect(() => setC(d.raw_cfg), [d.raw_cfg]);
  const wsum = useMemo(() => c.kpis.reduce((s, k) => s + (Number(k.weight) || 0), 0), [c.kpis]);
  const upd = (p: Partial<SalesCfg>) => setC({ ...c, ...p, preset: 'custom' });
  const n = (v: string) => Number(String(v).replace(',', '.').replace(/\s/g, '')) || 0;
  const numF = (label: string, v: number, on: (x: number) => void, suffix = '') => (
    <Field label={label}><Input inputMode="decimal" value={String(v).replace('.', ',')} onChange={(e) => on(n(e.target.value))} placeholder={suffix} /></Field>
  );
  const setKpi = (i: number, p: Partial<SalesCfgKpi>) => upd({ kpis: c.kpis.map((k, j) => (j === i ? { ...k, ...p } : k)) });
  async function save(preset?: string) {
    if (!preset && Math.abs(wsum - 100) > 0.01) { toast(`Сумма весов должна быть 100% (сейчас ${wsum}%)`, 'error'); return; }
    setBusy(true);
    try {
      await api.saveSalesConfig(tg, preset ? { preset, all } : { cfg: c, all });
      haptic.success(); toast(all ? 'Применено ко всем менеджерам' : 'Настройки KPI сохранены', 'ok'); onSaved();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  const avail = Object.entries(list.catalog).filter(([id]) => !c.kpis.some((k) => k.id === id));
  return (
    <>
      <Card>
        <Eyebrow>Готовые схемы</Eyebrow>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(list.presets).map(([id, label]) => (
            <button key={id} onClick={() => save(id)} className={cx('min-h-[48px] rounded-2xl px-3 py-2 text-left text-[14px] font-medium', c.preset === id ? 'bg-ink text-card' : 'bg-fill active:opacity-70')}>{label}</button>
          ))}
        </div>
        <div className="mt-2 text-[12.5px] text-muted">Схема сразу применяется, потом её можно донастроить ниже. «Стандарт» — ровно ваша таблица.</div>
      </Card>

      <Card>
        <Eyebrow>Деньги</Eyebrow>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {numF('Базовый план, MDL/мес', c.base_plan, (x) => upd({ base_plan: x }))}
          {numF('Ставка премии, % выручки', c.rate, (x) => upd({ rate: x }))}
          {numF('Оклад, MDL/мес', c.salary, (x) => upd({ salary: x }))}
          {numF('Порог отсечки премии, % плана', c.cutoff, (x) => upd({ cutoff: x }))}
          {numF('Макс. коэф. одного KPI', c.cap, (x) => upd({ cap: x }))}
          {numF('Штраф за незаполн. заявку, MDL', c.gap_fine, (x) => upd({ gap_fine: x }))}
        </div>
      </Card>

      <Card>
        <Eyebrow>Сезонность по месяцам</Eyebrow>
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          {c.season.map((k, i) => {
            const ym = `${d.month.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`;
            return (
              <div key={i} className="rounded-2xl bg-fill p-2">
                <div className="text-[12px] font-semibold">{MONTHS_S[i]}</div>
                <input inputMode="decimal" value={String(k).replace('.', ',')} onChange={(e) => upd({ season: c.season.map((x, j) => (j === i ? n(e.target.value) : x)) })}
                  className="mt-1 h-9 w-full rounded-xl bg-card px-2 text-center text-[15px] outline-none ring-1 ring-inset ring-line" />
                <div className="mt-1 text-center text-[11px] text-muted">{(c.plan_override[ym] ?? Math.round(c.base_plan * k)).toLocaleString('ru-RU')}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <Eyebrow right={<span className={cx('font-mono text-[11px]', Math.abs(wsum - 100) < 0.01 ? green : red)}>сумма весов {wsum}%</span>}>Показатели KPI (вес · цель)</Eyebrow>
        <div className="flex flex-col gap-2.5">
          {c.kpis.map((k, i) => (
            <div key={k.id} className="rounded-2xl bg-fill p-3">
              <div className="flex items-center gap-2">
                {k.custom ? <input value={k.label} onChange={(e) => setKpi(i, { label: e.target.value })} className="h-9 min-w-0 flex-1 rounded-xl bg-card px-2 text-[14px] outline-none ring-1 ring-inset ring-line" />
                  : <div className="min-w-0 flex-1 text-[14.5px] font-medium">{k.label}</div>}
                <button onClick={() => upd({ kpis: c.kpis.filter((_, j) => j !== i) })} aria-label="Убрать" className="p-1 text-muted"><Trash2 size={16} /></button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-muted">вес</span>
                <input inputMode="decimal" value={String(k.weight)} onChange={(e) => setKpi(i, { weight: n(e.target.value) })} className="h-9 w-16 rounded-xl bg-card text-center outline-none ring-1 ring-inset ring-line" />%
                <span className="ml-2 text-muted">цель {k.dir === 'down' ? 'макс.' : ''}</span>
                <input inputMode="decimal" value={String(k.target).replace('.', ',')} onChange={(e) => setKpi(i, { target: n(e.target.value) })} className="h-9 w-24 rounded-xl bg-card text-center outline-none ring-1 ring-inset ring-line" />
                {k.custom ? (
                  <>
                    <input value={k.unit} placeholder="ед." onChange={(e) => setKpi(i, { unit: e.target.value })} className="h-9 w-14 rounded-xl bg-card text-center outline-none ring-1 ring-inset ring-line" />
                    <button onClick={() => setKpi(i, { dir: k.dir === 'up' ? 'down' : 'up' })} className="h-9 rounded-xl bg-card px-2.5 ring-1 ring-inset ring-line">{k.dir === 'up' ? 'больше — лучше' : 'меньше — лучше'}</button>
                  </>
                ) : <span className="text-muted">{k.unit} · {k.dir === 'up' ? 'больше — лучше' : 'меньше — лучше'} · {k.src === 'auto' ? 'из приложения' : 'вносит офис'}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <select value={addId} onChange={(e) => setAddId(e.target.value)} className="h-11 min-w-0 flex-1 rounded-2xl bg-card px-3 text-[14px] ring-1 ring-inset ring-line">
            <option value="">+ Добавить показатель…</option>
            {avail.map(([id, k]) => <option key={id} value={id}>{k.label}</option>)}
            <option value="__custom">Свой показатель (вносит офис)</option>
          </select>
          <Button variant="secondary" icon={<Plus size={18} />} disabled={!addId} className="!w-auto px-4" onClick={() => {
            if (addId === '__custom') upd({ kpis: [...c.kpis, { id: `c_${Date.now().toString(36)}`, weight: 0, target: 1, label: 'Свой показатель', unit: 'шт', dir: 'up', src: 'manual', custom: true }] });
            else { const k = list.catalog[addId]; upd({ kpis: [...c.kpis, { id: addId, weight: 0, target: k.target, label: k.label, unit: k.unit, dir: k.dir, src: k.src, custom: false }] }); }
            setAddId('');
          }}>Добавить</Button>
        </div>
      </Card>

      <Card>
        <Eyebrow>Лестница K(% плана)</Eyebrow>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {c.ladder.map(([p, k], i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-2xl bg-fill p-2 text-[13px]">
              <input inputMode="decimal" value={String(p)} onChange={(e) => upd({ ladder: c.ladder.map((x, j) => (j === i ? [n(e.target.value), x[1]] : x)) })} className="h-9 w-14 rounded-xl bg-card text-center outline-none ring-1 ring-inset ring-line" />%→
              <input inputMode="decimal" value={String(k).replace('.', ',')} onChange={(e) => upd({ ladder: c.ladder.map((x, j) => (j === i ? [x[0], n(e.target.value)] : x)) })} className="h-9 w-14 rounded-xl bg-card text-center outline-none ring-1 ring-inset ring-line" />
              <button onClick={() => upd({ ladder: c.ladder.filter((_, j) => j !== i) })} className="ml-auto p-1 text-muted"><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={() => upd({ ladder: [...c.ladder, [140, 1.7]] })} className="rounded-2xl bg-card p-2 text-[13px] ring-1 ring-inset ring-line">+ ступень</button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {numF('Разовый бонус от, % плана', c.bonus.from, (x) => upd({ bonus: { ...c.bonus, from: x } }))}
          {numF('Сумма бонуса, MDL', c.bonus.amount, (x) => upd({ bonus: { ...c.bonus, amount: x } }))}
          {numF('Критическое недовыполнение: ниже, %', c.crit.below, (x) => upd({ crit: { ...c.crit, below: x } }))}
          {numF('…минус от премии, %', c.crit.cut, (x) => upd({ crit: { ...c.crit, cut: x } }))}
        </div>
      </Card>

      <Card>
        <Eyebrow>Структура плана</Eyebrow>
        <div className="flex flex-col gap-2">
          {c.structure.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={s.label} onChange={(e) => upd({ structure: c.structure.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} className="h-10 min-w-0 flex-1 rounded-xl bg-fill px-3 text-[14px] outline-none" />
              <input inputMode="decimal" value={String(s.share)} onChange={(e) => upd({ structure: c.structure.map((x, j) => (j === i ? { ...x, share: n(e.target.value) } : x)) })} className="h-10 w-16 rounded-xl bg-fill text-center outline-none" />%
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <Eyebrow>Супербонусы</Eyebrow>
        <div className="flex flex-col gap-2.5">
          {Object.entries(list.supers).map(([id, s]) => {
            const v = c.supers[id] || { on: true, amount: s.amount, param: s.param };
            const setV = (p: Partial<typeof v>) => upd({ supers: { ...c.supers, [id]: { ...v, ...p } } });
            return (
              <div key={id} className="rounded-2xl bg-fill p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0"><div className="text-[14.5px] font-medium">{s.label}</div><div className="text-[12px] leading-snug text-muted">{s.hint}</div></div>
                  <button onClick={() => setV({ on: !v.on })} className={cx('relative h-[31px] w-[51px] shrink-0 rounded-full transition', v.on ? 'bg-accent' : 'bg-card ring-1 ring-inset ring-line')}>
                    <span className={cx('absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-all', v.on ? 'left-[22px]' : 'left-[2px]')} />
                  </button>
                </div>
                {v.on && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                    <input inputMode="decimal" value={String(v.amount)} onChange={(e) => setV({ amount: n(e.target.value) })} className="h-9 w-24 rounded-xl bg-card text-center outline-none ring-1 ring-inset ring-line" />MDL
                    {v.param != null && <><span className="ml-2 text-muted">N =</span><input inputMode="decimal" value={String(v.param)} onChange={(e) => setV({ param: n(e.target.value) })} className="h-9 w-24 rounded-xl bg-card text-center outline-none ring-1 ring-inset ring-line" /></>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <Eyebrow>Штрафы</Eyebrow>
        <div className="flex flex-col gap-2.5">
          {Object.entries(list.penalties).map(([id, s]) => {
            const v = c.penalties[id] || { on: false, amount: s.amount, param: s.param };
            const setV = (p: Partial<typeof v>) => upd({ penalties: { ...c.penalties, [id]: { ...v, ...p } } });
            return (
              <div key={id} className="rounded-2xl bg-fill p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0"><div className="text-[14.5px] font-medium">{s.label}</div><div className="text-[12px] leading-snug text-muted">{s.hint}</div></div>
                  <button onClick={() => setV({ on: !v.on })} className={cx('relative h-[31px] w-[51px] shrink-0 rounded-full transition', v.on ? 'bg-[#FF453A]' : 'bg-card ring-1 ring-inset ring-line')}>
                    <span className={cx('absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-all', v.on ? 'left-[22px]' : 'left-[2px]')} />
                  </button>
                </div>
                {v.on && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="text-muted">штраф</span>
                    <input inputMode="decimal" value={String(v.amount)} onChange={(e) => setV({ amount: n(e.target.value) })} className="h-9 w-20 rounded-xl bg-card text-center outline-none ring-1 ring-inset ring-line" />MDL
                    {v.param != null && <><span className="ml-2 text-muted">порог, {s.param_unit} =</span><input inputMode="decimal" value={String(v.param)} onChange={(e) => setV({ param: n(e.target.value) })} className="h-9 w-20 rounded-xl bg-card text-center outline-none ring-1 ring-inset ring-line" /></>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="mt-4 flex flex-col gap-3">
        <Toggle label="Применить ко всем менеджерам" checked={all} onChange={setAll} />
        <Button onClick={() => save()} loading={busy}>Сохранить настройки KPI</Button>
      </div>
    </>
  );
}
