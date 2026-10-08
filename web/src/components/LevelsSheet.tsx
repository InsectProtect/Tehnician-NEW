import { LEVEL_TITLES, MAX_LEVEL, PestMask, levelFromXp } from './PestMask';
import { Sheet, cx } from './ui';

/** Все 20 уровней с масками: пройденные — цветные, будущие — тёмные. */
export function LevelsSheet({ level, xp, onClose }: { level: number; xp: number; onClose: () => void }) {
  const fmt = (n: number) => n.toLocaleString('ru-RU');
  return (
    <Sheet open onClose={onClose} title="Уровни">
      <p className="-mt-3 mb-4 text-[14.5px] leading-relaxed text-muted">
        Всего {MAX_LEVEL} уровней. Каждые два — новый вредитель, и чем выше, тем он страшнее. У вас {fmt(xp)} XP
        {level >= MAX_LEVEL ? ' — максимальный уровень, вы Чума! 👑' : `, до ${level + 1}-го уровня ещё ${fmt(Math.max(0, levelFromXp(level + 1) - xp))} XP.`}
      </p>
      <div className="grid grid-cols-3 gap-2.5">
        {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((lv) => (
          <div key={lv} className={cx('flex flex-col items-center rounded-xl p-2 text-center', lv === level ? 'bg-accent/15 ring-2 ring-accent' : 'bg-card')}>
            <PestMask level={lv} size={72} locked={lv > level} />
            <div className={cx('mt-1.5 text-[12.5px] font-bold leading-tight', lv > level && 'text-muted')}>{lv} · {LEVEL_TITLES[lv - 1]}</div>
            <div className="mt-0.5 font-mono text-[10.5px] text-muted">{lv === 1 ? 'старт' : `${fmt(levelFromXp(lv))} XP`}</div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
