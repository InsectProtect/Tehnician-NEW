import { ArrowLeft, ArrowRight, Check, ListChecks } from 'lucide-react';
import { haptic } from '../telegram';
import { Button, cx } from './ui';

/* ================================================================================================
 * Пошаговое заполнение акта (v87): полоса шагов вверху выезда + «Назад / Далее» внизу.
 * Шаг «готов» — зелёная галочка; обязательные незаполненные шаги показываются на последнем шаге.
 * ================================================================================================ */

export type ActStep = { id: string; label: string; done: boolean; optional?: boolean; hint?: string };

export function ActStepBar({ steps, current, onGo }: { steps: ActStep[]; current: string; onGo: (id: string) => void }) {
  const i = Math.max(0, steps.findIndex((s) => s.id === current));
  return (
    <div className="sticky top-0 z-20 -mx-4 mb-4 bg-page/95 px-4 pb-2 pt-2 backdrop-blur" style={{ top: 'var(--safe-top, 0px)' }}>
      <div className="mb-2 flex items-baseline justify-between px-0.5">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Шаг {i + 1} / {steps.length}</span>
        <span className="text-[15px] font-semibold">{steps[i]?.label}</span>
      </div>
      <div className="flex gap-1">
        {steps.map((s, k) => (
          <button key={s.id} aria-label={s.label} onClick={() => { haptic.tap(); onGo(s.id); }} className="flex-1 py-1.5">
            <span className={cx('block h-1.5 rounded-full transition-colors',
              k === i ? 'bg-accent' : s.done ? 'bg-[#34C759]' : k < i && !s.optional ? 'bg-[#FF9500]' : 'bg-black/10 dark:bg-white/15')} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function ActStepNav({ steps, current, onGo }: { steps: ActStep[]; current: string; onGo: (id: string) => void }) {
  const i = Math.max(0, steps.findIndex((s) => s.id === current));
  const prev = steps[i - 1];
  const next = steps[i + 1];
  if (!next) return null;
  return (
    <div className="mt-8 grid grid-cols-[auto_1fr] gap-2.5">
      <Button variant="secondary" className="w-[56px] px-0" disabled={!prev} onClick={() => prev && onGo(prev.id)}><ArrowLeft size={20} /></Button>
      <Button onClick={() => onGo(next.id)} icon={<ArrowRight size={19} />}>Далее · {next.label}</Button>
    </div>
  );
}

/** Последний шаг: что осталось заполнить. */
export function ActChecklist({ steps, onGo }: { steps: ActStep[]; onGo: (id: string) => void }) {
  const list = steps.filter((s) => s.id !== 'finish');
  const left = list.filter((s) => !s.done && !s.optional);
  return (
    <div className="rounded-[22px] bg-card p-5">
      <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
        <ListChecks size={14} />{left.length ? `Осталось: ${left.length}` : 'Всё заполнено'}
      </div>
      <div className="mt-3 space-y-1">
        {list.map((s) => (
          <button key={s.id} onClick={() => { haptic.tap(); onGo(s.id); }} className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left active:bg-fill">
            <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold',
              s.done ? 'bg-[#34C759] text-white' : s.optional ? 'bg-fill text-muted' : 'bg-[#FF9500] text-white')}>
              {s.done ? <Check size={15} strokeWidth={3} /> : s.optional ? '–' : '!'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15.5px] font-medium">{s.label}</span>
              {s.hint && !s.done && <span className="block truncate text-[12.5px] text-muted">{s.hint}</span>}
            </span>
            <ArrowRight size={16} className="shrink-0 text-muted" />
          </button>
        ))}
      </div>
    </div>
  );
}
