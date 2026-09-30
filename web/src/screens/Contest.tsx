import { useCallback, useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { api } from '../api';
import { useConfig } from '../config';
import { haptic } from '../telegram';
import type { ContestRes, ContestSettings } from '../types';
import { Button, Field, Input, Spinner, Toggle, cx, useToast } from '../components/ui';

/*
 * Соревнование: рейтинг сотрудников по баллам за текущий месяц.
 * 1-го числа победитель прошлого месяца получает корону 👑 (видна весь месяц рядом с именем) и бонус в KPI.
 */

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
const MEDAL = ['🥇', '🥈', '🥉'];

/** Корона рядом с именем — у победителя прошлого месяца. */
export function useCrown() {
  const cfg = useConfig();
  const crowns = cfg.features?.contest === false ? [] : cfg.crowns || [];
  return (id?: string | null) => (id && crowns.includes(id) ? '👑 ' : '');
}

/** Карточка рейтинга: на главной у сотрудника (топ + его место) и на «Обзоре» у администратора (все). */
export function ContestWidget({ compact }: { compact?: boolean }) {
  const [d, setD] = useState<ContestRes | null>(null);
  const [err, setErr] = useState(false);
  const [all, setAll] = useState(false);
  const load = useCallback(() => { api.contest().then(setD).catch(() => setErr(true)); }, []);
  useEffect(() => { load(); }, [load]);
  if (err) return null;
  if (!d) return compact ? null : <Spinner />;
  const me = d.items.find((x) => x.me);
  const leader = d.items[0];
  const list = all || !compact ? d.items : d.items.slice(0, 3);
  const last = d.history[0];
  return (
    <div className={cx('rounded-[22px] bg-card p-4', compact && 'mb-6')}>
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#FFCC00]/20 text-[22px]">👑</div>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold">Соревнование · {d.label}</div>
          <div className="text-[13px] leading-snug text-muted">
            Победителю — корона{d.settings.bonus > 0 ? ` и +${fmt(d.settings.bonus)} б` : ''} · осталось {d.days_left} дн.
          </div>
        </div>
        {me && <div className="text-right"><div className="font-dot text-[22px] font-semibold text-accent-ink">{me.rank}</div><div className="text-[11px] text-muted">ваше место</div></div>}
      </div>

      {leader && leader.points > 0 ? (
        <div className="mt-3 space-y-1">
          {list.map((r) => (
            <div key={r.id} className={cx('flex items-center gap-3 rounded-xl px-3 py-2', r.me ? 'bg-accent/[0.12]' : r.rank === 1 ? 'bg-[#FFCC00]/[0.12]' : '')}>
              <span className="w-7 shrink-0 text-center font-dot text-[15px]">{MEDAL[r.rank - 1] || r.rank}</span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{r.crown ? '👑 ' : ''}{r.name}{r.me ? ' · вы' : ''}</span>
              <span className="shrink-0 font-dot text-[15px] font-semibold tabular-nums">{fmt(r.points)}</span>
            </div>
          ))}
          {compact && me && me.rank > 3 && !all && (
            <div className="flex items-center gap-3 rounded-xl bg-accent/[0.12] px-3 py-2">
              <span className="w-7 shrink-0 text-center font-dot text-[15px]">{me.rank}</span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{me.name} · вы</span>
              <span className="shrink-0 font-dot text-[15px] font-semibold">{fmt(me.points)}</span>
            </div>
          )}
          {compact && d.items.length > 3 && (
            <button onClick={() => { haptic.tap(); setAll((v) => !v); }} className="w-full pt-1 text-center text-[13px] text-accent-ink">{all ? 'Свернуть' : `Весь рейтинг · ${d.items.length}`}</button>
          )}
          {me && leader && !leader.me && me.points < leader.points && (
            <div className="px-1 pt-1 text-[12.5px] text-muted">До первого места: {fmt(leader.points - me.points)} б</div>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-xl bg-fill px-3 py-2.5 text-[14px] text-muted">В этом месяце баллов пока ни у кого нет — первый выезд выведет в лидеры.</div>
      )}
      {last && last.names.length > 0 && (
        <div className="mt-3 flex items-center gap-2 border-t border-dashed border-line pt-3 text-[13px] text-muted">
          <Trophy size={15} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate">{last.label}: 👑 {last.names.join(', ')} — {fmt(last.points)} б</span>
        </div>
      )}
    </div>
  );
}

/** Настройки соревнования: бонус победителю, минимум баллов, видно ли сотрудникам. */
export function ContestSettingsPanel() {
  const toast = useToast();
  const [s, setS] = useState<ContestSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [bonus, setBonus] = useState('');
  const [min, setMin] = useState('');
  useEffect(() => {
    api.contest().then((r) => { setS(r.settings); setBonus(fmt(r.settings.bonus)); setMin(fmt(r.settings.min_points)); }).catch((e: Error) => toast(e.message, 'error'));
  }, [toast]);
  if (!s) return <Spinner />;
  async function save(patch: Partial<ContestSettings>) {
    setBusy(true);
    try { const r = await api.saveContest(patch); setS(r.settings); haptic.success(); toast('Сохранено'); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Бонус победителю, б"><Input inputMode="decimal" value={bonus} onChange={(e) => setBonus(e.target.value)} /></Field>
        <Field label="Минимум баллов"><Input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></Field>
      </div>
      <div className="rounded-2xl bg-card px-4 py-3">
        <Toggle label="Рейтинг видят сотрудники" checked={s.show_staff} onChange={(v) => save({ show_staff: v })} />
      </div>
      <Button loading={busy} onClick={() => save({ bonus: bonus.replace(',', '.') as unknown as number, min_points: min.replace(',', '.') as unknown as number })}>Сохранить</Button>
      <p className="px-1 text-[12.5px] leading-snug text-muted">
        Рейтинг считается по баллам месяца: выезды, командные доли, поручения, фото/видео, бонусы и штрафы.
        1-го числа лидер прошлого месяца получает 👑 рядом с именем на весь месяц и бонус в KPI (при равенстве — все лидеры).
        Если у лидера меньше минимума — победителя нет.
      </p>
    </div>
  );
}
