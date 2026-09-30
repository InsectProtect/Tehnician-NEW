import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bug, Camera, Clock, Crown, Flag, Lock, MapPin, Star, Video, Zap } from 'lucide-react';
import type { GeoPoint } from '../types';
import { cx } from './ui';

/*
 * «Игровые» элементы в фирменном стиле: толстые кнопки с тенью-подложкой, полоски уровня, значки,
 * путь заявки из 5 шагов и простая карта OpenStreetMap без внешних библиотек.
 */

export const fmtN = (n: number | null | undefined) => String(Math.round((n ?? 0) * 100) / 100).replace('.', ',');

const TONES = {
  orange: 'bg-accent text-black shadow-[0_5px_0_#9C4A08]',
  yellow: 'bg-[#FFD23F] text-black shadow-[0_5px_0_#8A7414]',
  green: 'bg-[#34C759] text-black shadow-[0_5px_0_#1E7A37]',
  red: 'bg-[#FF453A] text-white shadow-[0_5px_0_#8A1C15]',
  ghost: 'bg-card text-ink ring-2 ring-inset ring-line shadow-[0_4px_0_var(--line)]',
} as const;

/** Толстая «игровая» кнопка: нажатие опускает её на подложку. */
export function GameButton({ children, onClick, tone = 'orange', disabled, loading, className, icon, small }: {
  children: ReactNode; onClick?: () => void; tone?: keyof typeof TONES; disabled?: boolean; loading?: boolean; className?: string; icon?: ReactNode; small?: boolean;
}) {
  return (
    <button type="button" disabled={disabled || loading} onClick={onClick}
      className={cx('flex w-full items-center justify-center gap-2 rounded-[18px] font-extrabold transition-transform active:translate-y-[4px] active:shadow-none disabled:opacity-50',
        small ? 'h-11 text-[14px]' : 'h-[56px] text-[16px]', TONES[tone], className)}>
      {loading ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon}
      <span>{children}</span>
    </button>
  );
}

export function XpChip({ xp, className }: { xp: number; className?: string }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-[#FFD23F] bg-[#FFD23F]/10 px-2 py-0.5 text-[12px] font-extrabold text-[#9A7A00] dark:text-[#FFD23F]', className)}>
      <Star size={12} strokeWidth={2.5} />+{xp} XP
    </span>
  );
}

/** Полоса с делениями (часы смены, квест). */
export function Segments({ total, done, partial = 0, className }: { total: number; done: number; partial?: number; className?: string }) {
  return (
    <div className={cx('grid gap-1', className)} style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cx('h-3 rounded-[4px]', i < done ? 'bg-[#FFD23F]' : i === done && partial > 0 ? 'bg-[#FFD23F]/40' : 'bg-fill')} />
      ))}
    </div>
  );
}

/** Толстая полоса прогресса с метками (план месяца). */
export function FatBar({ pct, marks = [], color = 'bg-accent' }: { pct: number; marks?: { at: number; label: string; tone?: string }[]; color?: string }) {
  return (
    <div className="relative pb-5">
      <div className="h-4 overflow-hidden rounded-full border-2 border-line bg-fill">
        <div className={cx('h-full rounded-full transition-all', color)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      {marks.map((m) => (
        <div key={m.label} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${Math.min(97, Math.max(3, m.at))}%` }}>
          <span className={cx('h-6 w-[2px]', m.tone || 'bg-ink')} />
          <span className="whitespace-nowrap text-[10.5px] font-semibold text-muted">{m.label}</span>
        </div>
      ))}
    </div>
  );
}

const BADGE_ICONS: Record<string, typeof Star> = { flag: Flag, clock: Clock, bolt: Zap, camera: Camera, bug: Bug, hundred: Star, pin: MapPin, video: Video, crown: Crown };
const BADGE_TONES = ['bg-accent shadow-[0_4px_0_#9C4A08]', 'bg-[#AF52DE] shadow-[0_4px_0_#6B2A8C]', 'bg-[#34C759] shadow-[0_4px_0_#1E7A37]', 'bg-[#FFD23F] shadow-[0_4px_0_#8A7414]', 'bg-[#64A8FF] shadow-[0_4px_0_#2F5BB7]'];
export function BadgeTile({ icon, title, got, progress, i }: { icon: string; title: string; got: boolean; progress: [number, number] | null; i: number }) {
  const I = BADGE_ICONS[icon] || Star;
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <span className={cx('flex h-14 w-14 items-center justify-center rounded-2xl', got ? `${BADGE_TONES[i % BADGE_TONES.length]} text-black` : 'border-2 border-dashed border-line text-muted')}>
        {got ? <I size={26} strokeWidth={2} /> : <Lock size={20} strokeWidth={2} />}
      </span>
      <span className={cx('text-[11px] font-semibold leading-tight', got ? 'text-ink' : 'text-muted')}>{title}</span>
      {!got && progress && <span className="font-dot text-[10.5px] text-muted">{progress[0]}/{progress[1]}</span>}
    </div>
  );
}

/** Путь заявки: Звонок → В пути → Работа → Акт → Оплата. */
export const QUEST_STEPS = ['Звонок', 'В пути', 'Работа', 'Акт', 'Оплата'];
export function QuestPath({ step, className }: { step: number; className?: string }) {
  const n = QUEST_STEPS.length;
  return (
    <div className={cx('relative h-[58px]', className)}>
      <div className="absolute left-[29px] right-[29px] top-[14px] h-1 rounded-full bg-fill" />
      <div className="absolute left-[29px] top-[14px] h-1 rounded-full bg-[#34C759] transition-all" style={{ width: `calc((100% - 58px) * ${Math.min(step, n - 1) / (n - 1)})` }} />
      <div className="absolute inset-0 flex justify-between">
        {QUEST_STEPS.map((s, i) => {
          const done = i < step; const cur = i === step;
          return (
            <div key={s} className="flex w-[58px] flex-col items-center gap-1.5">
              <span className={cx('flex h-[30px] w-[30px] items-center justify-center rounded-full text-[13px] font-extrabold',
                done ? 'bg-[#34C759] text-black shadow-[0_3px_0_#1E7A37]' : cur ? 'bg-accent text-black shadow-[0_0_0_5px_rgba(245,130,32,0.25),0_3px_0_#9C4A08]' : 'border-2 border-line bg-card text-muted')}>
                {done ? '✓' : i + 1}
              </span>
              <span className={cx('text-[10.5px] font-bold', done ? 'text-[#248A3D] dark:text-[#30D158]' : cur ? 'text-accent-ink' : 'text-muted')}>{s}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Карта OpenStreetMap без библиотек: плитки 256×256 + метки ---------- */

const TILE = 256;
const project = (p: GeoPoint, z: number) => {
  const s = TILE * 2 ** z;
  const sin = Math.sin((p.lat * Math.PI) / 180);
  return { x: ((p.lon + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
};
export type MapMark = GeoPoint & { id: string; label?: string; tone?: 'me' | 'dest' | 'green' | 'red' | 'orange' | 'gray'; text?: string };
const MARK_TONES: Record<string, string> = {
  me: 'bg-[#FFD23F] text-black shadow-[0_0_0_8px_rgba(255,210,63,0.25),0_3px_0_#8A7414]',
  dest: 'bg-accent text-black shadow-[0_3px_0_#9C4A08]',
  green: 'bg-[#34C759] text-black shadow-[0_3px_0_#1E7A37]',
  red: 'bg-[#FF453A] text-white shadow-[0_3px_0_#8A1C15]',
  orange: 'bg-accent text-black shadow-[0_3px_0_#9C4A08]',
  gray: 'bg-[#8E8E93] text-white',
};

export function TileMap({ marks, height = 240, line, className }: { marks: MapMark[]; height?: number; line?: [GeoPoint, GeoPoint] | null; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 340));
    ro.observe(el);
    setW(el.clientWidth || 340);
    return () => ro.disconnect();
  }, []);
  const pts = marks.length ? marks : [{ id: 'c', lat: 47.0105, lon: 28.8638 }];
  const pad = 56;
  let z = 16;
  for (; z > 3; z -= 1) {
    const ps = pts.map((p) => project(p, z));
    const dx = Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x));
    const dy = Math.max(...ps.map((p) => p.y)) - Math.min(...ps.map((p) => p.y));
    if (dx <= w - pad * 2 && dy <= height - pad * 2) break;
  }
  if (pts.length === 1) z = 15;
  const ps = pts.map((p) => project(p, z));
  const cx0 = (Math.max(...ps.map((p) => p.x)) + Math.min(...ps.map((p) => p.x))) / 2;
  const cy0 = (Math.max(...ps.map((p) => p.y)) + Math.min(...ps.map((p) => p.y))) / 2;
  const left = cx0 - w / 2; const top = cy0 - height / 2;
  const tiles: { x: number; y: number; key: string }[] = [];
  const n = 2 ** z;
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx += 1) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty += 1) {
      if (ty < 0 || ty >= n) continue;
      tiles.push({ x: tx, y: ty, key: `${z}/${((tx % n) + n) % n}/${ty}` });
    }
  }
  const at = (p: GeoPoint) => { const q = project(p, z); return { x: q.x - left, y: q.y - top }; };
  const l = line ? [at(line[0]), at(line[1])] : null;
  return (
    <div ref={ref} className={cx('relative overflow-hidden rounded-[22px] border-2 border-line bg-[#dfe7df] dark:bg-[#0E1611]', className)} style={{ height }}>
      <div className="absolute inset-0 dark:[filter:invert(1)_hue-rotate(180deg)_brightness(0.8)_contrast(0.9)_saturate(0.6)]">
        {tiles.map((t) => (
          <img key={t.key + t.x} alt="" draggable={false} src={`https://tile.openstreetmap.org/${t.key}.png`} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
            className="absolute select-none" style={{ left: t.x * TILE - left, top: t.y * TILE - top, width: TILE, height: TILE }} />
        ))}
      </div>
      {l && (
        <svg className="pointer-events-none absolute inset-0" width={w} height={height}>
          <line x1={l[0].x} y1={l[0].y} x2={l[1].x} y2={l[1].y} stroke="#F58220" strokeWidth={5} strokeLinecap="round" strokeDasharray="2 10" />
        </svg>
      )}
      {marks.map((m) => {
        const p = at(m);
        return (
          <div key={m.id} className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ left: p.x, top: p.y }}>
            <span className={cx('flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-black text-[10.5px] font-extrabold', MARK_TONES[m.tone || 'orange'])}>{m.label || ''}</span>
            {m.text && <span className="whitespace-nowrap rounded-lg bg-black/75 px-1.5 py-0.5 text-[10.5px] font-bold text-white">{m.text}</span>}
          </div>
        );
      })}
      <span className="absolute bottom-1 right-2 rounded bg-white/70 px-1 text-[9px] text-black">© OpenStreetMap</span>
    </div>
  );
}
