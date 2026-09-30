import { cx } from './ui';

export function Tile({ label, value, tone, hint, onClick }: {
  label: string; value: string | number; tone?: 'red' | 'orange' | 'green' | 'blue'; hint?: string; onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={cx('rounded-2xl bg-card p-4 text-left', onClick && 'active:opacity-60')}>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className={cx('mt-1.5 truncate text-[30px] leading-none', typeof value === 'number' || /^[\d\s.,:%—-]+$/.test(String(value)) ? 'font-dot text-[34px]' : 'font-display font-semibold uppercase',
        tone === 'red' && 'text-[#D70015] dark:text-[#FF453A]', tone === 'orange' && 'text-[#C93400] dark:text-[#FF9F0A]',
        tone === 'green' && 'text-[#248A3D] dark:text-[#30D158]', tone === 'blue' && 'text-accent-ink')}>{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
    </Tag>
  );
}

export function Bars({ title, items }: { title: string; items: { name: string; n: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <div className="rounded-2xl bg-card p-4">
      <div className="mb-3 text-[15px] font-semibold">{title}</div>
      {items.length === 0 ? <div className="text-[14px] text-muted">Нет данных</div> : (
        <div className="space-y-2.5">
          {items.slice(0, 8).map((i) => (
            <div key={i.name}>
              <div className="mb-1 flex justify-between gap-3 text-[14px]">
                <span className="truncate">{i.name}</span><span className="font-semibold tabular-nums">{i.n}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(i.n / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Daily({ days, title = 'Выезды по дням' }: { days: { date: string; n: number }[]; title?: string }) {
  const max = Math.max(1, ...days.map((d) => d.n));
  const fmt = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return (
    <div className="rounded-2xl bg-card p-4">
      <div className="mb-3 text-[15px] font-semibold">{title}</div>
      <div className="flex h-28 items-end gap-[3px]">
        {days.map((d) => (
          <div key={d.date} title={`${fmt(d.date)}: ${d.n}`} className="flex h-full flex-1 items-end">
            <div className={cx('w-full rounded-t-[3px]', d.n ? 'bg-accent' : 'bg-black/[0.06] dark:bg-white/10')}
              style={{ height: d.n ? `${Math.max(6, (d.n / max) * 100)}%` : '3px' }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[12px] text-muted">
        <span>{days[0] && fmt(days[0].date)}</span><span>максимум {max} в день</span><span>{days.length > 0 && fmt(days[days.length - 1].date)}</span>
      </div>
    </div>
  );
}

