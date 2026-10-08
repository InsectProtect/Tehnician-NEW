import { useId, type ReactNode } from 'react';

/* ================================================================================================
 * Маски уровней (v64): 20 уровней, каждые 2 — новый вредитель, чем выше — тем страшнее.
 * Стиль — неон 80-х: закатный градиент, жирные чёрные силуэты, сдвиг цветов (розовый/бирюзовый) как на VHS,
 * сканлайны. Чётный уровень — «усиленная» версия той же маски (вторая неоновая рамка + деталь).
 * Всё нарисовано вручную в SVG 64×64 — без внешних картинок и библиотек.
 * ================================================================================================ */

export const MAX_LEVEL = 20;

export const PEST_TIERS = [
  { name: 'Муравей', from: '#2DE2E6', to: '#6A00F4' },
  { name: 'Моль', from: '#9B5DE5', to: '#FF2E88' },
  { name: 'Блоха', from: '#FF6C11', to: '#FF2E88' },
  { name: 'Таракан', from: '#FFD319', to: '#FF2E88' },
  { name: 'Клоп', from: '#FF2E88', to: '#6A00F4' },
  { name: 'Комар', from: '#FF2E88', to: '#2A0845' },
  { name: 'Оса', from: '#FFD319', to: '#2A0845' },
  { name: 'Паук', from: '#7B2CBF', to: '#0B0014' },
  { name: 'Крыса', from: '#FF003C', to: '#1B0B2E' },
  { name: 'Чума', from: '#FF003C', to: '#000000' },
] as const;

/** Титулы уровней — те же, что на сервере (LEVEL_TITLES). */
export const LEVEL_TITLES = [
  'Муравей', 'Муравей-солдат', 'Моль', 'Ночная моль', 'Блоха', 'Блоха-прыгун', 'Таракан', 'Таракан-громила', 'Клоп', 'Клоп-кровопийца',
  'Комар', 'Комар-вампир', 'Оса', 'Шершень', 'Паук', 'Чёрная вдова', 'Крыса', 'Крыса-мутант', 'Король крыс', 'Чума',
];
/** XP, с которого начинается уровень (как levelNeed на сервере). */
export const levelFromXp = (level: number) => 50 * (level - 1) * level;

const INK = '#0D0414';

type Draw = (p: { eye: string; alt: boolean; tier: number }) => ReactNode;

const Eyes = ({ pts, r = 1.6, color }: { pts: [number, number][]; r?: number; color: string }) => (
  <>{pts.map(([x, y]) => (
    <g key={`${x}-${y}`}>
      <circle cx={x} cy={y} r={r * 2.2} fill={color} opacity={0.28} />
      <circle cx={x} cy={y} r={r} fill={color} />
    </g>
  ))}</>
);

const leg = (d: string) => <path d={d} fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />;

const PESTS: Draw[] = [
  // 1 — муравей; alt: солдат с жвалами
  ({ eye, alt }) => (
    <>
      {leg('M28 28 L18 21 M28 31 L16 32 M28 34 L18 43 M36 28 L46 21 M36 31 L48 32 M36 34 L46 43')}
      {leg('M30 16 L25 9 L21 10 M34 16 L39 9 L43 10')}
      <ellipse cx={32} cy={44} rx={7.5} ry={9.5} fill={INK} />
      <ellipse cx={32} cy={31} rx={4.2} ry={5.2} fill={INK} />
      <circle cx={32} cy={20} r={alt ? 6.2 : 5.4} fill={INK} />
      {alt && leg('M28 24 Q25 28 28 29 M36 24 Q39 28 36 29')}
      <Eyes pts={[[29.8, 19], [34.2, 19]]} r={1.2} color={eye} />
    </>
  ),
  // 2 — моль; глазки-«совы» на крыльях; alt: луна за спиной
  ({ eye, alt }) => (
    <>
      {alt && <circle cx={32} cy={30} r={17} fill="#FFD319" opacity={0.22} />}
      <path d="M31 28 C19 12 5 18 9 31 C12 39 23 37 31 34 Z" fill={INK} />
      <path d="M33 28 C45 12 59 18 55 31 C52 39 41 37 33 34 Z" fill={INK} />
      <path d="M31 36 C23 40 16 50 22 53 C27 55 30 46 31.5 41 Z" fill={INK} />
      <path d="M33 36 C41 40 48 50 42 53 C37 55 34 46 32.5 41 Z" fill={INK} />
      <circle cx={18} cy={27} r={3.6} fill="none" stroke="#FF2E88" strokeWidth={1.6} />
      <circle cx={46} cy={27} r={3.6} fill="none" stroke="#FF2E88" strokeWidth={1.6} />
      <circle cx={18} cy={27} r={1.3} fill="#2DE2E6" /><circle cx={46} cy={27} r={1.3} fill="#2DE2E6" />
      <ellipse cx={32} cy={36} rx={3.4} ry={12} fill={INK} />
      {leg('M31 25 Q26 16 22 15 M33 25 Q38 16 42 15')}
      <Eyes pts={[[30.5, 26], [33.5, 26]]} r={1} color={eye} />
    </>
  ),
  // 3 — блоха (профиль); alt: в прыжке со следом
  ({ eye, alt }) => (
    <g transform={alt ? 'rotate(-14 32 34)' : undefined}>
      {alt && <path d="M6 50 L18 44 M8 56 L20 49" stroke="#2DE2E6" strokeWidth={2} strokeLinecap="round" />}
      <ellipse cx={34} cy={33} rx={14} ry={10.5} fill={INK} />
      <circle cx={20} cy={30} r={5.4} fill={INK} />
      {leg('M15 32 L10 38')}
      {leg('M38 41 L47 50 L41 55 M30 42 L28 51 L24 53 M24 40 L20 48')}
      <path d="M28 25 L30 42 M34 23 L36 43 M40 24 L41 42" stroke="#FF6C11" strokeWidth={1} opacity={0.7} />
      <Eyes pts={[[19, 28.5]]} r={1.4} color={eye} />
    </g>
  ),
  // 4 — таракан; alt: громила (шире, с шипами)
  ({ eye, alt }) => (
    <>
      {leg('M24 4 Q26 14 30 18 M40 4 Q38 14 34 18')}
      {leg('M23 30 L13 25 L9 27 M22 37 L11 38 L8 42 M23 44 L14 51 L13 56 M41 30 L51 25 L55 27 M42 37 L53 38 L56 42 M41 44 L50 51 L51 56')}
      <ellipse cx={32} cy={38} rx={alt ? 13 : 11} ry={15.5} fill={INK} />
      <ellipse cx={32} cy={25} rx={alt ? 10.5 : 9} ry={5.4} fill={INK} />
      <circle cx={32} cy={19.5} r={4.6} fill={INK} />
      <path d="M32 28 L32 52" stroke="#FFD319" strokeWidth={1.2} opacity={0.8} />
      {alt && <path d="M21 33 L18 31 M43 33 L46 31 M21 41 L18 40 M43 41 L46 40" stroke="#FFD319" strokeWidth={1.6} strokeLinecap="round" />}
      <Eyes pts={[[29.8, 19], [34.2, 19]]} r={1.3} color={eye} />
    </>
  ),
  // 5 — клоп; alt: напился крови
  ({ eye, alt }) => (
    <>
      {leg('M20 33 L12 29 M19 39 L10 41 M21 45 L13 51 M44 33 L52 29 M45 39 L54 41 M43 45 L51 51 M30 21 L26 14 M34 21 L38 14')}
      <ellipse cx={32} cy={39} rx={alt ? 15 : 13.5} ry={alt ? 13 : 11.5} fill={INK} />
      {alt && <ellipse cx={32} cy={41} rx={10} ry={7.5} fill="#B5001F" />}
      <path d="M20 36 Q32 32 44 36 M19.5 41 Q32 37 44.5 41 M21 46 Q32 43 43 46" stroke="#FF2E88" strokeWidth={1} fill="none" opacity={0.75} />
      <ellipse cx={32} cy={27} rx={8} ry={3.8} fill={INK} />
      <circle cx={32} cy={23} r={3.8} fill={INK} />
      <Eyes pts={[[29.6, 22.5], [34.4, 22.5]]} r={1.3} color={eye} />
    </>
  ),
  // 6 — комар; жало с каплей; alt: вампир с клыками
  ({ eye, alt }) => (
    <>
      <ellipse cx={20} cy={24} rx={11} ry={5} fill="#2DE2E6" opacity={0.35} transform="rotate(-25 20 24)" />
      <ellipse cx={44} cy={24} rx={11} ry={5} fill="#2DE2E6" opacity={0.35} transform="rotate(25 44 24)" />
      {leg('M29 32 L14 26 L6 30 M29 35 L12 41 L5 50 M30 38 L20 52 L18 60 M35 32 L50 26 L58 30 M35 35 L52 41 L59 50 M34 38 L44 52 L46 60')}
      <ellipse cx={32} cy={42} rx={3.2} ry={12} fill={INK} />
      <ellipse cx={32} cy={30} rx={4.6} ry={4.4} fill={INK} />
      <circle cx={32} cy={22} r={4.4} fill={INK} />
      <ellipse cx={32} cy={44} rx={2} ry={6} fill="#B5001F" />
      <path d="M30.6 18.5 L23 4.5" stroke={INK} strokeWidth={1.7} strokeLinecap="round" />
      <path d="M22.4 3.4 Q20.6 6.4 22.4 7.8 Q24.2 6.4 22.4 3.4 Z" fill="#FF003C" />
      {alt && <path d="M30 26 L30.6 29.5 L31.2 26 M32.8 26 L33.4 29.5 L34 26" fill="#F5F5F5" />}
      <Eyes pts={[[29.8, 21], [34.2, 21]]} r={1.5} color={eye} />
    </>
  ),
  // 7 — оса; полоски и жало; alt: шершень (крупнее, длиннее жало)
  ({ eye, alt }) => (
    <>
      <ellipse cx={20} cy={26} rx={10} ry={4.6} fill="#F5F5F5" opacity={0.3} transform="rotate(-30 20 26)" />
      <ellipse cx={44} cy={26} rx={10} ry={4.6} fill="#F5F5F5" opacity={0.3} transform="rotate(30 44 26)" />
      {leg('M28 32 L19 38 L17 44 M36 32 L45 38 L47 44 M29 35 L23 46 M35 35 L41 46')}
      <ellipse cx={32} cy={44} rx={alt ? 8.6 : 7.4} ry={alt ? 11.5 : 10} fill={INK} />
      <path d={alt ? 'M24 40 L40 40 M23.6 45 L40.4 45 M25 50 L39 50' : 'M25.2 40 L38.8 40 M25 45 L39 45 M26.4 50 L37.6 50'} stroke="#FFD319" strokeWidth={2.4} />
      <path d={alt ? 'M32 63 L29.6 54 L34.4 54 Z' : 'M32 59 L30 53 L34 53 Z'} fill={INK} />
      <circle cx={32} cy={30} r={6} fill={INK} />
      <circle cx={32} cy={19.5} r={5.6} fill={INK} />
      {leg('M29 23.5 L27 27 M35 23.5 L37 27 M30 15 L26 8 M34 15 L38 8')}
      <Eyes pts={[[29.4, 18.5], [34.6, 18.5]]} r={1.6} color={eye} />
    </>
  ),
  // 8 — паук; много глаз; alt: чёрная вдова (красные «песочные часы»)
  ({ eye, alt }) => (
    <>
      {leg('M27 27 L17 15 L9 19 M26 30 L12 25 L5 31 M26 33 L12 39 L6 48 M28 36 L18 47 L15 57 M37 27 L47 15 L55 19 M38 30 L52 25 L59 31 M38 33 L52 39 L58 48 M36 36 L46 47 L49 57')}
      <circle cx={32} cy={42} r={alt ? 12.5 : 11} fill={INK} />
      {alt && <path d="M28.5 37 L35.5 37 L32 42 L35.5 47 L28.5 47 L32 42 Z" fill="#FF003C" />}
      <circle cx={32} cy={27} r={7.4} fill={INK} />
      <path d="M29.5 32 L28.6 35.6 M34.5 32 L35.4 35.6" stroke="#F5F5F5" strokeWidth={1.4} strokeLinecap="round" />
      <Eyes pts={[[29, 24.5], [35, 24.5], [30.8, 22], [33.2, 22], [27.6, 27.4], [36.4, 27.4]]} r={0.95} color={eye} />
    </>
  ),
  // 9 — крыса (анфас); резцы, усы; alt: мутант — шрам со швами и потёки
  ({ eye, alt }) => (
    <>
      <circle cx={17.5} cy={18} r={8} fill={INK} /><circle cx={46.5} cy={18} r={8} fill={INK} />
      <circle cx={17.5} cy={18} r={4} fill="#FF2E88" opacity={0.55} /><circle cx={46.5} cy={18} r={4} fill="#FF2E88" opacity={0.55} />
      <path d="M13 31 C13 17 51 17 51 31 C51 41 39 52 32 55 C25 52 13 41 13 31 Z" fill={INK} />
      <path d="M8 43 L24 45 M7 49 L25 47.5 M56 43 L40 45 M57 49 L39 47.5" stroke={INK} strokeWidth={1.2} />
      <path d="M8 43 L24 45 M56 43 L40 45" stroke="#2DE2E6" strokeWidth={0.6} opacity={0.6} />
      <circle cx={32} cy={48} r={2.4} fill="#FF2E88" />
      <rect x={29.6} y={51.5} width={2.2} height={5} rx={0.6} fill="#F5F0E6" /><rect x={32.2} y={51.5} width={2.2} height={5} rx={0.6} fill="#F5F0E6" />
      {alt && <path d="M38 22 L43 36 M37.6 25 L41.4 24 M38.8 29 L42.6 28 M40 33 L43.6 32" stroke="#2DE2E6" strokeWidth={1.2} strokeLinecap="round" />}
      <Eyes pts={[[25, 33], [39, 33]]} r={alt ? 2.2 : 1.8} color={eye} />
    </>
  ),
  // 10 — чума: череп крысы в короне; alt (ур. 20) — нимб-аура и трещины
  ({ alt }) => (
    <>
      {alt && <circle cx={32} cy={33} r={24} fill="none" stroke="#FFD319" strokeWidth={1.2} strokeDasharray="2 3" opacity={0.8} />}
      <path d="M18 17 L22 7 L27 14 L32 4 L37 14 L42 7 L46 17 Z" fill="#FFD319" stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={32} cy={7.5} r={1.4} fill="#FF003C" />
      <path d="M14 31 C14 18 50 18 50 31 C50 41 39 52 32 56 C25 52 14 41 14 31 Z" fill="#EDE6DA" stroke={INK} strokeWidth={2} />
      <path d="M21 29 C21 25 29 25 29 30 C29 35 21 35 21 29 Z M43 29 C43 25 35 25 35 30 C35 35 43 35 43 29 Z" fill={INK} />
      <circle cx={25} cy={30} r={1.8} fill="#FF003C" /><circle cx={39} cy={30} r={1.8} fill="#FF003C" />
      <circle cx={25} cy={30} r={3.6} fill="#FF003C" opacity={0.3} /><circle cx={39} cy={30} r={3.6} fill="#FF003C" opacity={0.3} />
      <path d="M30.5 41 L32 38.5 L33.5 41 Z" fill={INK} />
      <path d="M27 47 L37 47 M29 45 L29 50 M32 45 L32 51 M35 45 L35 50" stroke={INK} strokeWidth={1.4} strokeLinecap="round" />
      {alt && <path d="M32 19 L30 24 L33 27 L31 31 M46 26 L42 28 L43 32" stroke={INK} strokeWidth={1.1} fill="none" />}
    </>
  ),
];

/** Маска уровня. level 1…20; size — px. */
export function PestMask({ level, size = 58, className, locked }: { level: number; size?: number; className?: string; locked?: boolean }) {
  const uid = useId().replace(/:/g, '');
  const lv = Math.max(1, Math.min(MAX_LEVEL, Math.round(level) || 1));
  const tier = Math.ceil(lv / 2); // 1…10
  const alt = lv % 2 === 0;
  const t = PEST_TIERS[tier - 1];
  // чем выше — тем злее взгляд: бирюзовый → жёлтый → красный
  const eye = tier <= 2 ? '#2DE2E6' : tier <= 4 ? '#FFD319' : '#FF003C';
  const shift = tier >= 9 ? 1.8 : tier >= 6 ? 1.3 : 0.9; // сдвиг цветов VHS
  const pest = PESTS[tier - 1]({ eye, alt, tier });
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} role="img" aria-label={`Уровень ${lv}: ${LEVEL_TITLES[lv - 1]}`}
      style={locked ? { filter: 'grayscale(1) brightness(0.55)', opacity: 0.7 } : undefined}>
      <defs>
        <linearGradient id={`bg${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={t.from} /><stop offset="1" stopColor={t.to} />
        </linearGradient>
        <pattern id={`sl${uid}`} width="4" height="3" patternUnits="userSpaceOnUse">
          <rect width="4" height="1" fill="#000" opacity="0.16" />
        </pattern>
        <clipPath id={`cl${uid}`}><rect x="0" y="0" width="64" height="64" rx="14" /></clipPath>
      </defs>
      <g clipPath={`url(#cl${uid})`}>
        <rect width="64" height="64" fill={`url(#bg${uid})`} />
        {/* закатное солнце с полосами */}
        <circle cx="32" cy="64" r="22" fill="#FFD319" opacity={tier >= 8 ? 0.12 : 0.22} />
        <path d="M8 52 H56 M4 57 H60 M0 61.5 H64" stroke={t.to} strokeWidth="2" opacity="0.6" />
        {/* сдвиг цветов: бирюзовая и розовая «тени» силуэта (перекрашиваются стилем, форма та же) */}
        <style>{`.c${uid} [fill]:not([fill="none"]){fill:#2DE2E6}.c${uid} [stroke]:not([stroke="none"]){stroke:#2DE2E6}`
          + `.p${uid} [fill]:not([fill="none"]){fill:#FF2E88}.p${uid} [stroke]:not([stroke="none"]){stroke:#FF2E88}`}</style>
        <g className={`c${uid}`} transform={`translate(${-shift} 0)`} opacity="0.8">{pest}</g>
        <g className={`p${uid}`} transform={`translate(${shift} ${shift / 2})`} opacity="0.7">{pest}</g>
        {pest}
        {/* потёки крови с 6-й маски */}
        {tier >= 6 && (
          <path d={tier >= 9 ? 'M6 0 V7 Q6 10 7.6 10 Q9 10 9 7 V0 M48 0 V11 Q48 14 49.6 14 Q51 14 51 11 V0 M56 0 V5 Q56 8 57.4 8 Q58.6 8 58.6 5 V0'
            : 'M50 0 V7 Q50 10 51.6 10 Q53 10 53 7 V0'} fill="#C8001E" />
        )}
        <rect width="64" height="64" fill={`url(#sl${uid})`} />
      </g>
      <rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke={tier >= 9 ? '#FF003C' : '#FF2E88'} strokeWidth="2" />
      {alt && <rect x="3.5" y="3.5" width="57" height="57" rx="10.5" fill="none" stroke="#2DE2E6" strokeWidth="1.2" opacity="0.9" />}
    </svg>
  );
}
