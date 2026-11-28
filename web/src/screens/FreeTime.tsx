import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronDown, ChevronRight, RefreshCw, Zap } from 'lucide-react';
import { api } from '../api';
import { haptic } from '../telegram';
import { Button, Field, Input, Spinner, Toggle, cx, useToast } from '../components/ui';
import type { FreeCfg, FreeDay, FreeTech, FreeTimeRes } from '../types';
import { NewTaskSheet } from './Jobs';

/* ================================================================================================
 * v107: «Свободное время» — менеджер в дороге видит окна техников на сегодня и неделю вперёд.
 * v108: вместо графика-полосок — «Во сколько удобно клиенту?»: день → часть дня → часы, в каждом
 * часе зелёные кнопки свободных техников. Тап — заявка с техником, датой и временем. Ниже — расписание
 * каждого техника списком (занято / свободно).
 * v116: блок «Когда свободны» (утро/день/вечер) убран — окна видны у каждого техника.
 * ================================================================================================ */

const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const dur = (min: number) => (min >= 60 ? `${String(Math.round(min / 6) / 10).replace('.', ',')} ч` : `${min} мин`);
const first = (n: string) => n.split(' ')[0];
const visits = (n: number) => `${n} ${n === 1 ? 'выезд' : n < 5 ? 'выезда' : 'выездов'}`;

type Opt = { tech: FreeTech; at: number; until: number };
type Pick = Opt & { day: FreeDay };

/** Когда в этот час техник может начать выезд (окно вмещает выезд целиком). */
function startIn(t: FreeTech, h: number, need: number): Opt | null {
  for (const f of t.free) {
    const a = toMin(f.from); const b = toMin(f.to);
    const at = Math.max(a, h);
    if (at < h + 60 && at + need <= b) return { tech: t, at, until: b };
  }
  return null;
}

/** Часы дня со свободными техниками. */
function hoursOf(day: FreeDay, cfg: FreeCfg) {
  const out: { h: number; opts: Opt[] }[] = [];
  for (let h = Math.floor(toMin(cfg.from) / 60) * 60; h + cfg.dur <= toMin(cfg.to); h += 60) {
    const opts = day.techs.map((t) => startIn(t, h, cfg.dur)).filter(Boolean) as Opt[];
    out.push({ h, opts });
  }
  return out;
}

export function FreeTimeCard() {
  const toast = useToast();
  const [d, setD] = useState<FreeTimeRes | null>(null);
  const [di, setDi] = useState(0);
  const [openTech, setOpenTech] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [create, setCreate] = useState<{ tech: string; date: string; time: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => { setLoading(true); return api.freeTime().then(setD).catch((e: Error) => toast(e.message, 'error')).finally(() => setLoading(false)); }, [toast]);
  useEffect(() => { load(); const t = setInterval(load, 120000); return () => clearInterval(t); }, [load]);

  const perDay = useMemo(() => (d ? d.days.map((x) => (x.off ? [] : hoursOf(x, d.cfg))) : []), [d]);
  if (!d) return <div data-panel className="mt-4 flex justify-center rounded-[22px] bg-card p-6"><Spinner /></div>;
  const day = d.days[di];
  const freeHours = (i: number) => (perDay[i] || []).filter((x) => x.opts.length).length;
  const choose = (o: Opt, D: FreeDay = day) => { haptic.tap(); setPick({ ...o, day: D }); };
  const best = d.best[0];
  const bestDay = best ? d.days.findIndex((x) => x.day === best.day) : -1;

  return (
    <div data-panel className="mt-4 rounded-[22px] bg-card p-5">
      <div className="flex items-center gap-2.5">
        <CalendarClock size={20} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-semibold leading-tight">Свободное время</div>
          <div className="text-[13px] text-muted">Во сколько удобно клиенту?</div>
        </div>
        <button aria-label="Обновить" onClick={() => { haptic.tap(); load(); }} className="grid h-9 w-9 place-items-center rounded-full bg-fill text-muted active:opacity-60">
          <RefreshCw size={16} className={cx(loading && 'animate-spin')} />
        </button>
      </div>

      {best && (
        <button onClick={() => { const t = d.days[bestDay]?.techs.find((x) => x.tg === best.tg); if (t) choose({ tech: t, at: toMin(best.from), until: toMin(best.to) }, d.days[bestDay]); }}
          className="mt-3.5 flex w-full items-center gap-2.5 rounded-2xl bg-[#34C759]/12 px-3.5 py-3 text-left active:opacity-70">
          <Zap size={18} className="shrink-0 text-[#34C759]" />
          <div className="min-w-0 flex-1 text-[14px] leading-snug">
            <div className="text-[12px] font-medium text-muted">Ближайшее окно</div>
            <b>{best.label}{bestDay > 1 ? ` ${best.date}` : ''}, {best.from}</b> · {first(best.name)}
          </div>
          <ChevronRight size={18} className="shrink-0 text-muted" />
        </button>
      )}

      <div className="no-scrollbar -mx-5 mt-3.5 flex gap-1.5 overflow-x-auto px-5 pb-1">
        {d.days.map((x, i) => {
          const n = freeHours(i);
          return (
            <button key={x.day} data-chip onClick={() => { haptic.tap(); setDi(i); }}
              className={cx('flex-none rounded-2xl px-3 py-2 text-center', i === di ? 'bg-accent text-black' : 'bg-fill')}>
              <span className="block text-[14px] font-semibold">{x.label}</span>
              <span className={cx('block text-[11px] font-medium', i === di ? 'opacity-70' : 'text-muted')}>{x.date}</span>
              <span className={cx('mt-1 block text-[11px] font-semibold', i === di ? 'opacity-80' : x.off ? 'text-muted' : n ? 'text-[#248A3D] dark:text-[#5FE08A]' : 'text-[#FF9500]')}>
                {x.off ? 'выходной' : n ? `${n} ч свободно` : 'занято'}
              </span>
            </button>
          );
        })}
      </div>

      {day.off ? (
        <div className="mt-3 rounded-2xl bg-fill p-4 text-center text-[14px] text-muted">Выходной день — заявки не ставим</div>
      ) : (
        <>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-[13px] font-semibold uppercase tracking-wide text-muted">Заявки у техников</span>
            <span className="text-[13px] font-semibold text-muted">всего {day.techs.reduce((s, t) => s + t.count, 0)}</span>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {day.techs.map((t) => {
              const open = openTech === t.tg;
              const rows = [
                ...t.busy.map((b) => ({ at: toMin(b.from), busy: true as const, b })),
                ...t.free.map((f) => ({ at: toMin(f.from), busy: false as const, f })),
              ].sort((a, b) => a.at - b.at);
              return (
                <div key={t.tg} className="rounded-2xl bg-fill">
                  <button onClick={() => { haptic.tap(); setOpenTech(open ? null : t.tg); }} className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
                    <div className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-[20px] font-bold tabular-nums', t.count === 0 ? 'bg-[#34C759]/15 text-[#1F7A35] dark:text-[#5FE08A]' : t.count >= 4 ? 'bg-[#FF9500]/15 text-[#C26A00] dark:text-[#FFB340]' : 'bg-accent/15 text-accent')}>{t.count}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold">{t.name}</div>
                      <div className="text-[12.5px] leading-snug text-muted">
                        {t.no_time ? `${t.no_time} без времени · ` : ''}
                        {t.free.length ? `свободен ${t.free.map((f) => (toMin(f.to) >= toMin(d.cfg.to) ? `с ${f.from}` : `${f.from}–${f.to}`)).join(', ')}` : 'окон нет'}
                      </div>
                    </div>
                    <ChevronDown size={18} className={cx('shrink-0 text-muted transition-transform', open && 'rotate-180')} />
                  </button>
                  {open && (
                    <div className="border-t border-line px-3.5 pb-3 pt-1">
                      {rows.length === 0 && <div className="py-2 text-[13.5px] text-muted">Окон нет{di === 0 ? ' до конца дня' : ''}</div>}
                      {rows.map((r) => r.busy ? (
                        <div key={`b${r.b.task_no}${r.b.from}`} className="flex items-center gap-3 py-2 text-[14px]">
                          <span className="w-[104px] shrink-0 tabular-nums text-muted">{r.b.from}–{r.b.to}</span>
                          <span className="min-w-0 flex-1 truncate">{r.b.label || 'заявка'}</span>
                          <span className="shrink-0 text-[12px] text-muted">№{r.b.task_no}</span>
                        </div>
                      ) : (
                        <button key={`f${r.f.from}`} onClick={() => choose({ tech: t, at: toMin(r.f.from), until: toMin(r.f.to) })}
                          className="my-1 flex w-full items-center gap-3 rounded-xl bg-[#34C759]/15 px-2.5 py-2 text-left text-[14px] active:opacity-60">
                          <span className="w-[104px] shrink-0 font-semibold tabular-nums text-[#1F7A35] dark:text-[#5FE08A]">{r.f.from}–{r.f.to}</span>
                          <span className="min-w-0 flex-1 truncate text-[#1F7A35] dark:text-[#5FE08A]">{dur(r.f.min)}</span>
                          <span className="shrink-0 text-[13px] font-semibold text-[#1F7A35] dark:text-[#5FE08A]">Поставить</span>
                        </button>
                      ))}
                      {t.no_time > 0 && <div className="pt-1 text-[12.5px] text-[#C26A00] dark:text-[#FFB340]">+ {t.no_time} без времени — уточните у техника</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 text-[12px] leading-snug text-muted">
            Выезд ~{dur(d.cfg.dur)} (большой объект +{dur(d.cfg.big_add)}), дорога между заявками {d.cfg.road} мин — уже учтены.
          </div>
        </>
      )}

      {pick && !create && (() => {
        const prev = pick.tech.busy.filter((b) => toMin(b.to) <= pick.at).pop();
        const next = pick.tech.busy.find((b) => toMin(b.from) >= pick.at);
        return (
          <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setPick(null)}>
            <div data-sheet className="w-full rounded-t-[22px] bg-card px-4 pb-[calc(20px+env(safe-area-inset-bottom))] pt-5" onClick={(e) => e.stopPropagation()}>
              <div className="text-[13px] font-medium text-muted">Новая заявка</div>
              <div className="mt-0.5 text-[22px] font-semibold leading-tight">{pick.day.label}{d.days.indexOf(pick.day) > 1 ? ` ${pick.day.date}` : ''}, {fmt(pick.at)}</div>
              <div className="mt-0.5 text-[15px]">{pick.tech.name}</div>
              <div className="mt-3 divide-y divide-line text-[14.5px]">
                <div className="flex justify-between gap-3 py-2.5"><span className="text-muted">Свободен до</span><b>{fmt(pick.until)}</b></div>
                {prev && <div className="flex justify-between gap-3 py-2.5"><span className="shrink-0 text-muted">Перед этим</span><b className="truncate">{prev.from} {prev.label}</b></div>}
                {next && <div className="flex justify-between gap-3 py-2.5"><span className="shrink-0 text-muted">После</span><b className="truncate">{next.from} {next.label}</b></div>}
              </div>
              <div className="mt-2 text-[12.5px] text-muted">Дальше — обычная форма: адрес, телефон, вредитель, цена. Время можно поменять.</div>
              <Button className="mt-4" icon={<ChevronRight size={18} />} onClick={() => { haptic.tap(); setCreate({ tech: pick.tech.tg, date: pick.day.day, time: fmt(pick.at) }); }}>Поставить заявку</Button>
            </div>
          </div>
        );
      })()}
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
      <div className="flex flex-col gap-2">
        <Toggle label="💡 Подсказка «Кто ближе»" checked={s.geo_on !== false} onChange={(v) => setS({ ...s, geo_on: v })} />
        <div className="px-1 text-[12.5px] leading-snug text-muted">Под новой заявкой в группе бот подсказывает, кому из дезинсекторов ближе по маршруту (время не меняется), и предупреждает, если адрес не нашёлся на карте.</div>
        {s.geo_on !== false && numF('Подсказывать, если экономия от, км', s.geo_min_km ?? 5, (x) => setS({ ...s, geo_min_km: x }))}
      </div>
      <Button variant="secondary" loading={busy} onClick={save}>Сохранить</Button>
    </div>
  );
}
