import { saveOrQueue } from '../offline';
import { useState } from 'react';
import { ScanLine } from 'lucide-react';
import { haptic } from '../telegram';
import type { Trap } from '../types';
import { Button, Chips, Group, IconBadge, Row, Sheet, useToast } from '../components/ui';

/* ================================================================================================
 * v93: маршрут обхода — следующая непроверенная станция по номеру (после только что сохранённой),
 * точка на мини-плане, «Сканировать № N», список дальше. В конце — сводка и причины по непроверенным
 * (сохраняются как осмотр «нет доступа / отсутствует» и попадают в акт).
 * ================================================================================================ */
const SKIP_REASONS = [
  { id: 'no_access', label: 'Нет доступа', condition: 'no_access', comment: '' },
  { id: 'closed', label: 'Закрыто', condition: 'no_access', comment: 'Закрыто' },
  { id: 'missing', label: 'Нет на месте', condition: 'missing', comment: '' },
];

function MiniPlan({ traps, nextId }: { traps: Trap[]; nextId: string }) {
  const next = traps.find((t) => t.id === nextId);
  if (!next?.plan_id || next.plan_x == null || next.plan_y == null) return null;
  const pts = traps.filter((t) => t.plan_id === next.plan_id && t.plan_x != null && t.plan_y != null);
  if (pts.length < 2) return null;
  const xs = pts.map((t) => Number(t.plan_x)); const ys = pts.map((t) => Number(t.plan_y));
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const W = 300; const H = 140; const pad = 18;
  const sx = (x: number) => pad + ((x - minX) / Math.max(1, maxX - minX)) * (W - pad * 2);
  const sy = (y: number) => pad + ((y - minY) / Math.max(1, maxY - minY)) * (H - pad * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full rounded-xl bg-fill">
      {pts.map((t) => {
        const isNext = t.id === nextId;
        const fill = isNext ? 'var(--accent)' : t.inspection ? (t.inspection.status === 'activity' ? '#FF3B30' : '#34C759') : 'transparent';
        return (
          <g key={t.id}>
            <circle cx={sx(Number(t.plan_x))} cy={sy(Number(t.plan_y))} r={isNext ? 12 : 8.5} fill={fill} stroke={isNext || t.inspection ? 'none' : 'currentColor'} strokeOpacity={0.45} strokeWidth={1.5} />
            <text x={sx(Number(t.plan_x))} y={sy(Number(t.plan_y)) + (isNext ? 4 : 3)} textAnchor="middle" fontSize={isNext ? 11 : 8.5} fontWeight={700} fill={isNext ? '#0A0A0A' : t.inspection ? '#fff' : 'currentColor'}>{t.number}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function RouteSheet({ visitId, traps, after, skipped, showDone, targetLabel, onScan, onOpen, onSkip, onFinishRoute, onPlan, onSaved, onClose }: {
  visitId: string; traps: Trap[]; after?: string; skipped: string[]; showDone: boolean; targetLabel: (id: string) => string;
  onScan: () => void; onOpen: (t: Trap) => void; onSkip: (id: string) => void; onFinishRoute: () => void; onPlan: (id: string) => void; onSaved: () => void; onClose: () => void;
}) {
  const toast = useToast();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const all = traps.filter((t) => !t.prepared);
  // только что сохранённая станция считается проверенной, даже если список ещё не обновился
  const checked = (t: Trap) => Boolean(t.inspection) || t.id === after;
  const todo = all.filter((t) => !checked(t));
  const fresh = todo.filter((t) => !skipped.includes(t.id));
  const cur = all.find((t) => t.id === after);
  const pick = (list: Trap[]) => (cur ? list.find((t) => t.number > cur.number) || list[0] : list[0]);
  const next = pick(fresh);
  const done = all.length - todo.length;
  const activity = all.filter((t) => t.inspection?.status === 'activity');
  const finished = showDone || !next;

  async function saveReasons() {
    const list = todo.filter((t) => reasons[t.id]);
    if (!list.length) { onClose(); return; }
    setBusy(true);
    try {
      for (const t of list) {
        const r = SKIP_REASONS.find((x) => x.id === reasons[t.id])!;
        await saveOrQueue('inspection', visitId, { trap_id: t.id, condition: r.condition, bait_eaten: '', pest: '', count: 0, bait_replaced: false, comment: r.comment });
      }
      haptic.success();
      toast(`Причины записаны: ${list.length}`);
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={finished ? 'Обход закончен' : 'Обход'}>
      <div className="-mt-2 mb-4">
        <div className="flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          <span>Проверено</span><span>{done} / {all.length}</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} /></div>
      </div>

      {!finished && next && (
        <>
          <div className="rounded-[22px] bg-card p-4">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Следующая</div>
            <div className="mt-1 font-display text-[34px] font-semibold leading-none">№ {next.number}</div>
            <div className="mt-2 text-[16px] font-semibold">{next.location || next.kind}</div>
            <div className="text-[13.5px] text-muted">{[targetLabel(next.target), next.location ? next.kind : ''].filter(Boolean).join(' · ')}</div>
            <MiniPlan traps={all} nextId={next.id} />
            {next.plan_id && <button onClick={() => onPlan(next.id)} className="mt-2 text-[13.5px] font-medium text-accent-ink">🗺 Открыть на плане</button>}
          </div>
          <Button className="mt-3 h-[64px] text-[17px]" onClick={onScan} icon={<ScanLine size={22} strokeWidth={1.9} />}>Сканировать № {next.number}</Button>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button variant="secondary" className="h-[46px] text-[14px]" onClick={() => onOpen(next)}>Без скана</Button>
            <Button variant="secondary" className="h-[46px] text-[14px]" onClick={() => { haptic.tap(); onSkip(next.id); }}>Пропустить</Button>
          </div>
          {fresh.length > 1 && (
            <div className="mt-4">
              <div className="mb-1.5 px-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Дальше по маршруту</div>
              <Group>
                {[...fresh.filter((t) => t.number > next.number), ...fresh.filter((t) => t.number < next.number)].slice(0, 4).map((t) => (
                  <Row key={t.id} left={<IconBadge tone="gray"><span className="font-mono">{t.number}</span></IconBadge>} title={t.location || t.kind}
                    subtitle={targetLabel(t.target)} onClick={() => onOpen(t)} />
                ))}
              </Group>
            </div>
          )}
          <button onClick={onFinishRoute} className="mt-4 w-full py-2 text-center text-[14px] font-medium text-muted">Закончить обход</button>
        </>
      )}

      {finished && (
        <>
          <div className="text-[15px]">
            {done - activity.length} чисто
            {activity.length > 0 && <span className="text-[#D70015] dark:text-[#FF453A]"> · {activity.length} активность</span>}
            {todo.length > 0 && <span className="text-[#C93400] dark:text-[#FF9F0A]"> · {todo.length} не проверены</span>}
          </div>
          {todo.length > 0 && (
            <div className="mt-4 rounded-[22px] bg-card p-4">
              <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Не проверены — почему?</div>
              <div className="space-y-4">
                {todo.map((t) => (
                  <div key={t.id}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-[15px] font-semibold">№ {t.number} · {t.location || t.kind}</span>
                      <button onClick={() => onOpen(t)} className="shrink-0 text-[13px] font-medium text-accent-ink">Проверить</button>
                    </div>
                    <Chips options={SKIP_REASONS.map((r) => ({ id: r.id, label: r.label }))} value={reasons[t.id] || ''}
                      onChange={(v) => { haptic.tap(); setReasons((x) => ({ ...x, [t.id]: x[t.id] === v ? '' : v })); }} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {activity.length > 0 && (
            <div className="mt-3 rounded-[22px] bg-card p-4">
              <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Активность</div>
              {activity.map((t) => (
                <div key={t.id} className="py-1 text-[14.5px]">
                  <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#FF3B30] font-mono text-[11px] font-bold text-white">{t.number}</span>
                  {t.location || t.kind}{t.inspection?.count ? ` · ${t.inspection.pest} ×${t.inspection.count}` : ''}
                </div>
              ))}
            </div>
          )}
          <Button className="mt-4" loading={busy} onClick={saveReasons}>
            {Object.values(reasons).some(Boolean) ? 'Записать причины и продолжить акт' : 'Продолжить акт'}
          </Button>
          {todo.length > 0 && (
            <Button variant="plain" className="mt-1" onClick={onScan} icon={<ScanLine size={18} strokeWidth={1.75} />}>Всё-таки сканировать</Button>
          )}
        </>
      )}
    </Sheet>
  );
}

