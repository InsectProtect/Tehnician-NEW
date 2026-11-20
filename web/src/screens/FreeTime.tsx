import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, ChevronRight, Zap } from 'lucide-react';
import { api } from '../api';
import { haptic } from '../telegram';
import { Button, Field, Input, Spinner, cx, useToast } from '../components/ui';
import type { FreeCfg, FreeSlot, FreeTech, FreeTimeRes } from '../types';
import { NewTaskSheet } from './Jobs';

/* ================================================================================================
 * v107: «Свободное время» — менеджер в дороге видит окна техников на сегодня и неделю вперёд
 * и ставит заявку тапом по окну (техник, дата, время подставлены в форму новой заявки).
 * ================================================================================================ */

const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const dur = (min: number) => (min >= 60 ? `${String(Math.round(min / 6) / 10).replace('.', ',')} ч` : `${min} мин`);

export function FreeTimeCard() {
  const toast = useToast();
  const [d, setD] = useState<FreeTimeRes | null>(null);
  const [di, setDi] = useState(0);
  const [pick, setPick] = useState<{ tech: FreeTech; slot: FreeSlot; day: string; dayLabel: string } | null>(null);
  const [create, setCreate] = useState<{ tech: string; date: string; time: string } | null>(null);
  const load = useCallback(() => api.freeTime().then(setD).catch((e: Error) => toast(e.message, 'error')), [toast]);
  useEffect(() => { load(); const t = setInterval(load, 120000); return () => clearInterval(t); }, [load]);

  if (!d) return <div data-panel className="mt-4 flex justify-center rounded-[22px] bg-card p-6"><Spinner /></div>;
  const day = d.days[di];
  const start = toMin(d.cfg.from); const end = toMin(d.cfg.to); const span = Math.max(1, end - start);
  const pos = (s: string) => `${Math.max(0, Math.min(100, ((toMin(s) - start) / span) * 100))}%`;
  const width = (a: string, b: string) => `${Math.max(1.5, ((Math.min(end, toMin(b)) - Math.max(start, toMin(a))) / span) * 100)}%`;
  const ticks: number[] = [];
  for (let h = Math.ceil(start / 60); h <= Math.floor(end / 60); h += 2) ticks.push(h);
  const nowIn = di === 0 && toMin(d.now) > start && toMin(d.now) < end;

  return (
    <div data-panel className="mt-4 rounded-[22px] bg-card p-5">
      <div className="flex items-center gap-2.5">
        <CalendarClock size={20} className="text-accent" />
        <div className="min-w-0">
          <div className="text-[18px] font-semibold leading-tight">Свободное время</div>
          <div className="text-[13px] text-muted">Куда поставить заявку, пока клиент на линии</div>
        </div>
      </div>

      <div className="-mx-1 mt-3.5 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {d.days.map((x, i) => (
          <button key={x.day} data-chip onClick={() => { haptic.tap(); setDi(i); }}
            className={cx('flex-none rounded-xl px-3 py-2 text-center text-[13px] font-semibold', i === di ? 'bg-accent text-black' : 'bg-fill text-muted', x.off && i !== di && 'opacity-50')}>
            {x.label}<span className="block text-[11px] font-medium opacity-70">{x.date}</span>
          </button>
        ))}
      </div>

      {di === 0 && d.best.length > 0 && (
        <div className="mt-3 flex items-start gap-2.5 rounded-2xl bg-[#34C759]/12 px-3.5 py-3 text-[14px]">
          <Zap size={17} className="mt-0.5 shrink-0 text-[#34C759]" />
          <div className="min-w-0">
            <b>Ближайшее окно:</b> {d.best[0].name.split(' ')[0]} — {d.best[0].label.toLowerCase()} {d.best[0].from}–{d.best[0].to}
            {d.best.slice(1, 3).map((b) => <div key={b.tg} className="text-[12.5px] text-muted">{b.name.split(' ')[0]} — {b.label.toLowerCase()} {b.from}–{b.to}</div>)}
          </div>
        </div>
      )}

      {day.off ? (
        <div className="mt-4 rounded-2xl bg-fill p-4 text-center text-[14px] text-muted">Выходной день — заявки не ставим</div>
      ) : day.techs.map((t) => (
        <div key={t.tg} className="mt-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-semibold">{t.name}</span>
            <span className="shrink-0 text-[12.5px] text-muted">{t.count ? `${t.count} ${t.count === 1 ? 'выезд' : t.count < 5 ? 'выезда' : 'выездов'}${t.busy_min ? ` · ~${dur(t.busy_min)}` : ''}` : 'свободен весь день'}</span>
          </div>
          <div className="relative mt-2 h-[30px] overflow-hidden rounded-lg bg-black/5 dark:bg-black/30">
            {t.busy.map((b) => (
              <div key={`${b.task_no}${b.from}`} className="absolute bottom-[3px] top-[3px] overflow-hidden whitespace-nowrap rounded-[5px] bg-black/15 px-1 text-[10px] leading-[24px] text-ink dark:bg-white/20 dark:text-white"
                style={{ left: pos(b.from), width: width(b.from, b.to) }}>{b.from.replace(':00', '')} {b.label}</div>
            ))}
            {nowIn && <div className="absolute bottom-0 top-0 w-[2px] bg-[#FF453A]" style={{ left: pos(d.now) }} />}
          </div>
          <div className="mt-0.5 flex justify-between px-px text-[10px] text-muted">{ticks.map((h) => <span key={h}>{h}</span>)}</div>
          {t.free.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {t.free.map((f) => (
                <button key={f.from} data-chip onClick={() => { haptic.tap(); setPick({ tech: t, slot: f, day: day.day, dayLabel: `${day.label}, ${day.date}` }); }}
                  className="rounded-[10px] bg-[#34C759]/15 px-2.5 py-1.5 text-[13.5px] font-semibold text-[#248A3D] active:opacity-70 dark:text-[#5FE08A]">
                  {t.busy.length === 0 && t.free.length === 1 ? `с ${f.from} до ${f.to}` : `${f.from}–${f.to}`}
                  <span className="ml-1 text-[11.5px] font-medium opacity-75">{dur(f.min)}</span>
                </button>
              ))}
            </div>
          ) : <div className="mt-2 text-[13px] text-[#FF9500]">Окон нет{di === 0 ? ' до конца дня' : ''}</div>}
          {t.no_time > 0 && <div className="mt-1 text-[12px] text-muted">+ {t.no_time} без времени — уточните у техника</div>}
        </div>
      ))}
      <div className="mt-4 text-[12px] leading-snug text-muted">
        Серым — заявки (выезд ~{dur(d.cfg.dur)}, большой объект +{dur(d.cfg.big_add)}), между ними дорога {d.cfg.road} мин{nowIn ? ', красная линия — сейчас' : ''}. Тап по зелёному окну — новая заявка.
      </div>

      {pick && !create && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setPick(null)}>
          <div data-sheet className="w-full rounded-t-[22px] bg-card px-4 pb-[calc(20px+env(safe-area-inset-bottom))] pt-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-[17px] font-semibold">Новая заявка · {pick.tech.name}</div>
            <div className="mt-2 divide-y divide-line text-[14.5px]">
              <div className="flex justify-between py-2.5"><span className="text-muted">Дата и время</span><b>{pick.dayLabel} · {pick.slot.from}</b></div>
              <div className="flex justify-between py-2.5"><span className="text-muted">Свободно до</span><b>{pick.slot.to} ({dur(pick.slot.min)})</b></div>
              {pick.slot.prev && <div className="flex justify-between gap-3 py-2.5"><span className="shrink-0 text-muted">Перед этим</span><b className="truncate">{pick.slot.prev}</b></div>}
            </div>
            <div className="mt-2 text-[12.5px] text-muted">Дальше — обычная форма: адрес, телефон, вредитель, цена. Время можно поменять.</div>
            <Button className="mt-4" icon={<ChevronRight size={18} />} onClick={() => { haptic.tap(); setCreate({ tech: pick.tech.tg, date: pick.day, time: pick.slot.from }); }}>Продолжить</Button>
          </div>
        </div>
      )}
      {create && (
        <NewTaskSheet preset={create} onClose={() => { setCreate(null); setPick(null); }}
          onCreated={() => { setCreate(null); setPick(null); toast('Заявка создана', 'ok'); load(); }} />
      )}
    </div>
  );
}

/** Настройки расчёта (владелец). */
export function FreeSettingsPanel() {
  const toast = useToast();
  const [s, setS] = useState<FreeCfg | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.freeSettings().then((r) => setS(r.settings)).catch((e: Error) => toast(e.message, 'error')); }, [toast]);
  if (!s) return <div className="flex justify-center py-4"><Spinner /></div>;
  const n = (v: string) => Number(String(v).replace(',', '.')) || 0;
  const numF = (label: string, v: number, on: (x: number) => void) => (
    <Field label={label}><Input inputMode="numeric" value={String(v)} onChange={(e) => on(n(e.target.value))} /></Field>
  );
  const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
  async function save() {
    setBusy(true);
    try { const r = await api.saveFreeSettings(s!); setS(r.settings); haptic.success(); toast('Сохранено', 'ok'); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Рабочий день с"><Input type="time" value={s.from} onChange={(e) => setS({ ...s, from: e.target.value })} /></Field>
        <Field label="до"><Input type="time" value={s.to} onChange={(e) => setS({ ...s, to: e.target.value })} /></Field>
      </div>
      <div>
        <div className="mb-1.5 text-[13px] text-muted">Выходные</div>
        <div className="grid grid-cols-7 gap-1.5">
          {WD.map((w, i) => {
            const on = s.off.includes(i + 1);
            return <button key={w} data-chip onClick={() => setS({ ...s, off: on ? s.off.filter((x) => x !== i + 1) : [...s.off, i + 1] })}
              className={cx('rounded-xl py-2 text-[13px] font-semibold', on ? 'bg-[#FF9500] text-black' : 'bg-fill text-muted')}>{w}</button>;
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {numF('Выезд, мин', s.dur, (x) => setS({ ...s, dur: x }))}
        {numF('Дорога между, мин', s.road, (x) => setS({ ...s, road: x }))}
        {numF('Большой объект от, м²', s.big_m2, (x) => setS({ ...s, big_m2: x }))}
        {numF('…добавить, мин', s.big_add, (x) => setS({ ...s, big_add: x }))}
        {numF('Самое короткое окно, мин', s.min_slot, (x) => setS({ ...s, min_slot: x }))}
        {numF('Дней вперёд', s.days, (x) => setS({ ...s, days: x }))}
      </div>
      <Button variant="secondary" loading={busy} onClick={save}>Сохранить</Button>
    </div>
  );
}
