import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { haptic } from '../telegram';
import type { PointsConfig, RecalcRes } from '../types';
import { Button, Input, Spinner, cx, useToast } from './ui';

type Row = { id: string; label: string; points: string; zoned: boolean; city: string; near: string; far: string };
const s = (n: number | undefined | null) => (n == null ? '' : String(n).replace('.', ','));
const n = (x: string) => Number(String(x).replace(',', '.'));

/**
 * Редактор баллов: категории объектов (название, баллы, зависимость от удалённости),
 * добавить / удалить категорию, надбавка за вечер. Используется в Настройках и во вкладке «План KPI».
 */
export function PointsEditor({ onSaved }: { onSaved?: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [night, setNight] = useState('');
  const [from, setFrom] = useState('');
  const [week, setWeek] = useState<string[]>(['1', '1', '1', '1', '1', '1', '2,5']);
  const [pests, setPests] = useState<{ name: string; pts: string }[]>([]);
  const [ex, setEx] = useState({ free_rooms: '1', per_room: '', free_sotki: '0', per_sotka: '' });
  const [special, setSpecial] = useState<{ label: string; from: string; to: string; mult: string }[]>([]);
  const [wins, setWins] = useState<{ days: number[]; from: string; to: string; mult: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.pointsConfig().then(({ config: c, all_pests }) => {
      if (c.extras) setEx({ free_rooms: s(c.extras.free_rooms), per_room: c.extras.per_room ? s(c.extras.per_room) : '', free_sotki: s(c.extras.free_sotki), per_sotka: c.extras.per_sotka ? s(c.extras.per_sotka) : '' });
      const names = [...new Set([...(all_pests || []), ...Object.keys(c.pest_mult || {})])];
      setPests(names.map((name) => ({ name, pts: c.pest_mult?.[name] ? s(c.pest_mult[name]) : '' })));
      setRows(c.cats.map((x) => ({
        id: x.id, label: x.label, points: s(x.points), zoned: Boolean(x.zones),
        city: s(x.zones?.city ?? x.points), near: s(x.zones?.near ?? x.points), far: s(x.zones?.far ?? x.points),
      })));
      setNight(s(c.night)); setFrom(s(c.night_from));
      if (c.weekday?.length === 7) setWeek(c.weekday.map((x) => s(x)));
      setSpecial((c.special || []).map((p) => ({ label: p.label, from: p.from, to: p.to, mult: s(p.mult) })));
      setWins((c.windows || []).map((w) => ({ days: w.days, from: w.from, to: w.to, mult: s(Number(w.mult)), label: w.label || '' })));
    }).catch((e: Error) => toast(e.message, 'error'));
  }, [toast]);

  if (!rows) return <Spinner />;
  const upd = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));

  async function save() {
    setBusy(true);
    try {
      const config: PointsConfig = {
        cats: rows!.map((r) => ({
          id: r.id, label: r.label.trim(), points: n(r.zoned ? r.city : r.points),
          zones: r.zoned ? { city: n(r.city), near: n(r.near), far: n(r.far) } : null,
        })),
        night: n(night), night_from: n(from),
        weekday: week.map((x) => n(x || '1')),
        special: special.map((p) => ({ label: p.label.trim(), from: p.from, to: p.to || p.from, mult: n(p.mult) })),
        windows: wins.map((w) => ({ days: w.days, from: w.from || '00:00', to: w.to || '24:00', mult: n(w.mult), label: w.label.trim() })),
        extras: { free_rooms: n(ex.free_rooms || '0'), per_room: n(ex.per_room || '0'), free_sotki: n(ex.free_sotki || '0'), per_sotka: n(ex.per_sotka || '0') },
        pest_mult: Object.fromEntries(pests.filter((p) => p.name.trim() && n(p.pts || '1') > 0 && n(p.pts || '1') !== 1).map((p) => [p.name.trim(), n(p.pts)])),
      };
      await api.savePoints(config);
      haptic.success();
      toast('Баллы сохранены');
      onSaved?.();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[22px] bg-card p-4">
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.id || i} className="rounded-2xl bg-fill/60 p-3 ring-1 ring-inset ring-line">
            <div className="flex items-center gap-2">
              <Input className="font-semibold" placeholder="Название категории" value={r.label} onChange={(e) => upd(i, { label: e.target.value })} />
              {!r.zoned && (
                <div className="w-[88px] shrink-0">
                  <Input inputMode="decimal" className="text-right font-dot" value={r.points} onChange={(e) => upd(i, { points: e.target.value })} />
                </div>
              )}
              <button aria-label="Удалить" onClick={() => { haptic.tap(); setRows(rows.filter((_, j) => j !== i)); }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#D70015] active:opacity-60 dark:text-[#FF453A]">
                <Trash2 size={18} strokeWidth={1.75} />
              </button>
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 px-1 text-[13px] text-muted">
              <input type="checkbox" className="h-4 w-4 accent-[#F58220]" checked={r.zoned} onChange={(e) => upd(i, { zoned: e.target.checked })} />
              Зависит от удалённости (Кишинёв / до 100 км / дальше)
            </label>
            {r.zoned && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {([['city', 'Кишинёв'], ['near', 'До 100 км'], ['far', 'Дальше']] as const).map(([k, l]) => (
                  <label key={k} className="block">
                    <span className="mb-1 block px-1 text-[11.5px] text-muted">{l}</span>
                    <Input inputMode="decimal" className="text-right font-dot" value={r[k]} onChange={(e) => upd(i, { [k]: e.target.value })} />
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <button onClick={() => { haptic.tap(); setRows([...rows, { id: '', label: '', points: '1', zoned: false, city: '1', near: '2', far: '2,5' }]); }}
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold text-accent-ink ring-1 ring-inset ring-line active:opacity-70">
        <Plus size={18} strokeWidth={2} /> Добавить категорию
      </button>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block px-1 text-[12.5px] text-muted">Надбавка за вечер, баллов</span>
          <Input inputMode="decimal" className="text-right font-dot" value={night} onChange={(e) => setNight(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block px-1 text-[12.5px] text-muted">Вечер начинается с, час</span>
          <Input inputMode="numeric" className="text-right font-dot" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
      </div>
      <div className="mt-5 rounded-2xl bg-fill/60 p-3 ring-1 ring-inset ring-line">
        <div className="px-1 text-[14px] font-semibold">📐 Надбавка за размер объекта</div>
        <div className="mt-0.5 px-1 text-[12.5px] leading-snug text-muted">Добавляется к баллам категории. Пусто или 0 — без надбавки. Комнаты и сотки указываются в заявке или специалистом в акте.</div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {([['free_rooms', 'Комнат включено'], ['per_room', '+ за каждую следующую'], ['free_sotki', 'Соток включено'], ['per_sotka', '+ за каждую следующую']] as const).map(([k, l]) => (
            <label key={k} className="block">
              <span className="mb-1 block px-1 text-[12px] text-muted">{l}</span>
              <Input inputMode="decimal" className="text-right font-dot" placeholder="0" value={ex[k]} onChange={(e) => setEx({ ...ex, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="mt-2 px-1 text-[12px] leading-snug text-muted">
          Пример: включено 1 комната, +0,2 за каждую следующую → квартира на 3 комнаты = 1 + 0,4 = 1,4 б. Включено 6 соток, +0,1 за каждую → участок 10 соток = база + 0,4.
        </div>
      </div>

      <div className="mt-5 rounded-2xl bg-fill/60 p-3 ring-1 ring-inset ring-line">
        <div className="px-1 text-[14px] font-semibold">🐞 Коэффициент за вредителя</div>
        <div className="mt-0.5 px-1 text-[12.5px] leading-snug text-muted">Баллы объекта умножаются на коэффициент вредителя из акта: тараканы ×1 → квартира 1 б; клопы ×1,2 → квартира 1,2 б. Несколько вредителей — берётся наибольший. Пусто = ×1.</div>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
          {pests.map((p, i) => (
            <label key={p.name + i} className="flex items-center gap-2 rounded-xl bg-card px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[14.5px]">{p.name}</span>
              <span className="shrink-0 text-[13px] text-muted">×</span>
              <input inputMode="decimal" placeholder="1" value={p.pts} onChange={(e) => setPests(pests.map((x, j) => (j === i ? { ...x, pts: e.target.value } : x)))}
                className={cx('h-10 w-[76px] shrink-0 rounded-xl text-right font-dot text-[15px] outline-none ring-1 ring-inset ring-line px-3', p.pts && n(p.pts) !== 1 ? 'bg-accent/15' : 'bg-fill')} />
            </label>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-2xl bg-[#AF52DE]/[0.08] p-3 ring-1 ring-inset ring-[#AF52DE]/25">
        <div className="px-1 text-[14px] font-semibold text-[#8E3BB8] dark:text-[#D08CF5]">⚡ Повышенный коэффициент по дням недели</div>
        <div className="mt-2 grid grid-cols-7 gap-1.5">
          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d, i) => (
            <label key={d} className="block text-center">
              <span className="mb-1 block text-[11.5px] text-muted">{d}</span>
              <input inputMode="decimal" value={week[i]} onChange={(e) => setWeek(week.map((x, j) => (j === i ? e.target.value : x)))}
                className={cx('h-11 w-full rounded-xl text-center font-dot text-[15px] outline-none ring-1 ring-inset ring-line',
                  n(week[i]) > 1 ? 'bg-[#AF52DE] text-white' : 'bg-card')} />
            </label>
          ))}
        </div>
        <div className="mt-3 px-1 text-[13px] font-medium">Особые периоды (праздники, сезон)</div>
        <div className="mt-2 space-y-2">
          {special.map((p, i) => {
            const up = (x: Partial<typeof p>) => setSpecial(special.map((q, j) => (j === i ? { ...q, ...x } : q)));
            return (
              <div key={i} className="rounded-xl bg-card p-2.5">
                <div className="flex items-center gap-2">
                  <Input placeholder="Например: Пасха" value={p.label} onChange={(e) => up({ label: e.target.value })} />
                  <div className="w-[76px] shrink-0"><Input inputMode="decimal" className="text-right font-dot" placeholder="×2" value={p.mult} onChange={(e) => up({ mult: e.target.value })} /></div>
                  <button aria-label="Удалить" onClick={() => setSpecial(special.filter((_, j) => j !== i))}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#D70015] dark:text-[#FF453A]"><Trash2 size={18} strokeWidth={1.75} /></button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Input type="date" value={p.from} onChange={(e) => up({ from: e.target.value, to: p.to && p.to >= e.target.value ? p.to : e.target.value })} />
                  <Input type="date" value={p.to} onChange={(e) => up({ to: e.target.value })} />
                </div>
              </div>
            );
          })}
        </div>
        <button onClick={() => { haptic.tap(); setSpecial([...special, { label: '', from: '', to: '', mult: '2' }]); }}
          className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-full text-[14px] font-semibold text-[#8E3BB8] ring-1 ring-inset ring-[#AF52DE]/40 dark:text-[#D08CF5]">
          <Plus size={16} strokeWidth={2} /> Добавить период
        </button>
        <div className="mt-4 px-1 text-[13px] font-medium">По дням и часам</div>
        <div className="px-1 text-[12px] leading-snug text-muted">Например: суббота с 14:00 до 24:00 ×1,5. Если «до» раньше «с» (22:00–06:00) — окно идёт через полночь.</div>
        <div className="mt-2 space-y-2">
          {wins.map((w, i) => {
            const up = (x: Partial<typeof w>) => setWins(wins.map((q, j) => (j === i ? { ...q, ...x } : q)));
            return (
              <div key={i} className="rounded-xl bg-card p-2.5">
                <div className="grid grid-cols-7 gap-1">
                  {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d, di) => {
                    const on = w.days.includes(di);
                    return (
                      <button key={d} onClick={() => { haptic.tap(); up({ days: on ? w.days.filter((x) => x !== di) : [...w.days, di].sort() }); }}
                        className={cx('h-9 rounded-lg text-[13px] font-medium', on ? 'bg-[#AF52DE] text-white' : 'bg-fill')}>{d}</button>
                    );
                  })}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="block min-w-0"><span className="mb-1 block px-1 text-[11.5px] text-muted">с</span>
                    <Input inputMode="numeric" className="text-center font-dot" placeholder="14:00" value={w.from} onChange={(e) => up({ from: e.target.value.replace(/[^\d:]/g, '').slice(0, 5) })} /></label>
                  <label className="block min-w-0"><span className="mb-1 block px-1 text-[11.5px] text-muted">до (24:00 — полночь)</span>
                    <Input inputMode="numeric" className="text-center font-dot" placeholder="24:00" value={w.to} onChange={(e) => up({ to: e.target.value.replace(/[^\d:]/g, '').slice(0, 5) })} /></label>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="min-w-0 flex-1"><Input placeholder="Подпись: суббота вечер" value={w.label} onChange={(e) => up({ label: e.target.value })} /></div>
                  <div className="w-[76px] shrink-0"><Input inputMode="decimal" className="text-right font-dot" placeholder="×1,5" value={w.mult} onChange={(e) => up({ mult: e.target.value })} /></div>
                  <button aria-label="Удалить" onClick={() => setWins(wins.filter((_, k) => k !== i))}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#D70015] dark:text-[#FF453A]"><Trash2 size={18} strokeWidth={1.75} /></button>
                </div>
              </div>
            );
          })}
        </div>
        <button onClick={() => { haptic.tap(); setWins([...wins, { days: [5], from: '14:00', to: '24:00', mult: '1,5', label: '' }]); }}
          className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-full text-[14px] font-semibold text-[#8E3BB8] ring-1 ring-inset ring-[#AF52DE]/40 dark:text-[#D08CF5]">
          <Plus size={16} strokeWidth={2} /> Добавить время
        </button>
        <p className="mt-2 px-1 text-[12px] leading-snug text-muted">
          Баллы выезда умножаются на коэффициент (по дате и времени начала обработки). Если совпало несколько — день недели, время, период, ручной для заявки — берётся наибольший.
          Такие заявки и выезды выделяются фиолетовым.
        </p>
      </div>
      <p className={cx('mt-3 px-1 text-[12.5px] leading-snug text-muted')}>
        Специалист выбирает категорию в каждом выезде. Баллы фиксируются при завершении — изменения здесь действуют на новые выезды;
        старые можно поправить вручную в самом акте. Удалённая категория пропадёт из выбора, но старые баллы сохранятся.
      </p>
      <Button className="mt-4" loading={busy} onClick={save}>Сохранить баллы</Button>
      <PointsRecalc />
    </div>
  );
}

const monthKey = (offset: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Пересчитать баллы завершённых выездов месяца по текущим настройкам (после изменения категорий, вредителей, коэффициентов). */
function PointsRecalc() {
  const toast = useToast();
  const [month, setMonth] = useState(monthKey(0));
  const [preview, setPreview] = useState<RecalcRes | null>(null);
  const [busy, setBusy] = useState<'' | 'dry' | 'run'>('');
  const f = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');
  async function run(dry: boolean) {
    setBusy(dry ? 'dry' : 'run');
    try {
      const r = await api.recalcPoints(month, dry);
      if (dry) setPreview(r);
      else { haptic.success(); toast(r.changed ? `Пересчитано актов: ${r.changed}` : 'Изменений нет'); setPreview(null); }
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  }
  return (
    <div className="mt-5 rounded-2xl bg-fill/60 p-3 ring-1 ring-inset ring-line">
      <div className="px-1 text-[14px] font-semibold">🔄 Пересчитать баллы за месяц</div>
      <div className="mt-0.5 px-1 text-[12.5px] leading-snug text-muted">
        Сначала сохраните изменения выше. Завершённые выезды месяца пересчитаются по новым настройкам (объекты, удалённость, вредители, коэффициенты).
        Акты с баллами, исправленными вручную, не меняются.
      </div>
      <div className="mt-2.5 flex gap-1.5">
        {[{ k: monthKey(0), l: 'Этот месяц' }, { k: monthKey(-1), l: 'Прошлый' }].map((m) => (
          <button key={m.k} onClick={() => { haptic.tap(); setMonth(m.k); setPreview(null); }}
            className={cx('rounded-full px-3.5 py-1.5 text-[14px] font-medium', month === m.k ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>{m.l}</button>
        ))}
      </div>
      {!preview ? (
        <Button variant="secondary" className="mt-3" loading={busy === 'dry'} onClick={() => run(true)}>Проверить, что изменится</Button>
      ) : (
        <div className="mt-3 rounded-xl bg-card p-3">
          <div className="text-[14.5px]">
            <b>{preview.label}</b>: выездов {preview.total}, изменится <b>{preview.changed}</b>{preview.manual ? `, вручную (не трогаем) ${preview.manual}` : ''}.
          </div>
          <div className="mt-1 text-[14px]">Всего баллов: {f(preview.before)} → <b>{f(preview.after)}</b></div>
          {preview.items.length > 0 && (
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {preview.items.map((it) => (
                <div key={it.id} className="flex items-center gap-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-muted">№ {it.act_no} · {it.tech_name} · {it.company_name}</span>
                  <span className="shrink-0 font-dot">{f(it.before)} → <b className={it.after > it.before ? 'text-[#1E7A35] dark:text-[#30D158]' : 'text-[#D70015] dark:text-[#FF453A]'}>{f(it.after)}</b></span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setPreview(null)}>Отмена</Button>
            <Button loading={busy === 'run'} disabled={!preview.changed} onClick={() => run(false)}>Пересчитать</Button>
          </div>
        </div>
      )}
    </div>
  );
}
