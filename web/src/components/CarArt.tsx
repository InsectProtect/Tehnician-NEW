import { useId } from 'react';

/* ================================================================================================
 * Иллюстрация служебной машины (v67) в неоновом стиле 80-х (Hotline Miami): закатное небо, полосатое солнце,
 * сетка до горизонта, чёрный силуэт с розовым контуром и бирюзовым «сдвигом цвета», фары, номер.
 * Силуэт — по типу кузова (определяется по модели на сервере или выбирается вручную). Рисунок свой, без фото и логотипов.
 * ================================================================================================ */

type Body = 'van' | 'bigvan' | 'sedan' | 'hatch' | 'wagon' | 'suv' | 'pickup';

// корпус (вид сбоку, морда слева), окна и центры колёс; земля — y = 146
const SHAPES: Record<Body, { body: string; win: string[]; wheels: [number, number]; r: number; rear: number }> = {
  van: {
    body: 'M34 142 L34 120 Q36 110 48 106 L86 100 L116 66 Q120 62 128 62 L262 62 Q274 62 278 72 L282 104 L282 142 Z',
    win: ['M92 98 L118 68 L124 68 L112 98 Z', 'M128 70 L180 70 L180 98 L118 98 Z', 'M186 70 L238 70 L238 98 L186 98 Z'],
    wheels: [86, 238], r: 21, rear: 282,
  },
  bigvan: {
    body: 'M28 142 L28 116 Q30 106 42 102 L70 96 L96 52 Q100 46 110 46 L284 46 Q292 46 292 56 L294 142 Z',
    win: ['M74 94 L98 56 L106 56 L90 94 Z', 'M112 56 L160 56 L160 92 L96 92 Z'],
    wheels: [80, 248], r: 22, rear: 294,
  },
  sedan: {
    body: 'M28 142 L28 122 Q30 114 42 112 L98 104 L130 80 Q136 76 146 76 L206 76 Q216 76 224 84 L244 102 L282 106 Q294 108 294 120 L294 142 Z',
    win: ['M106 102 L132 82 L170 82 L170 102 Z', 'M176 82 L206 82 Q214 82 220 88 L234 102 L176 102 Z'],
    wheels: [86, 244], r: 20, rear: 294,
  },
  hatch: {
    body: 'M34 142 L34 122 Q36 114 48 112 L102 104 L132 78 Q138 74 148 74 L230 74 Q240 74 246 84 L266 112 L268 142 Z',
    win: ['M110 102 L134 80 L178 80 L178 102 Z', 'M184 80 L230 80 Q236 80 240 86 L252 102 L184 102 Z'],
    wheels: [88, 232], r: 20, rear: 268,
  },
  wagon: {
    body: 'M28 142 L28 122 Q30 114 42 112 L98 104 L130 78 Q136 74 146 74 L268 74 Q280 74 284 86 L290 110 L292 142 Z',
    win: ['M106 102 L132 80 L176 80 L176 102 Z', 'M182 80 L230 80 L230 102 L182 102 Z', 'M236 80 L266 80 Q274 80 276 88 L280 102 L236 102 Z'],
    wheels: [86, 246], r: 20, rear: 292,
  },
  suv: {
    body: 'M28 142 L28 114 Q30 104 42 100 L96 92 L120 62 Q124 58 134 58 L248 58 Q262 58 270 70 L282 98 L284 142 Z',
    win: ['M102 90 L122 64 L172 64 L172 92 Z', 'M178 64 L246 64 Q256 64 262 72 L272 92 L178 92 Z'],
    wheels: [86, 242], r: 24, rear: 284,
  },
  pickup: {
    body: 'M28 142 L28 116 Q30 106 42 102 L94 96 L118 64 Q122 60 132 60 L182 60 Q190 60 192 70 L194 96 L284 96 Q292 96 292 104 L292 142 Z',
    win: ['M100 94 L120 66 L150 66 L150 94 Z', 'M156 66 L182 66 Q186 66 186 72 L186 94 L156 94 Z'],
    wheels: [84, 244], r: 23, rear: 292,
  },
};

const isBody = (b: string): b is Body => b in SHAPES;

export function CarArt({ body, title, plate, className }: { body?: string; title?: string; plate?: string; className?: string }) {
  const uid = useId().replace(/:/g, '');
  const s = SHAPES[isBody(body || '') ? (body as Body) : 'van'];
  const [w1, w2] = s.wheels;
  const ground = 146;
  const rearX = s.rear;
  const silhouette = (
    <>
      <path d={s.body} />
      <circle cx={w1} cy={ground - s.r + 4} r={s.r + 3} />
      <circle cx={w2} cy={ground - s.r + 4} r={s.r + 3} />
    </>
  );
  return (
    <svg viewBox="0 0 320 180" className={className} role="img" aria-label={title || 'Машина'} preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`sky${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#140528" /><stop offset="0.55" stopColor="#5B0F8F" /><stop offset="1" stopColor="#FF2E88" />
        </linearGradient>
        <linearGradient id={`sun${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD319" /><stop offset="1" stopColor="#FF2E88" />
        </linearGradient>
        <linearGradient id={`glass${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2DE2E6" stopOpacity="0.9" /><stop offset="0.5" stopColor="#7B2CBF" stopOpacity="0.85" /><stop offset="1" stopColor="#FF2E88" stopOpacity="0.9" />
        </linearGradient>
        <clipPath id={`sunclip${uid}`}>
          <rect x="0" y="0" width="320" height="88" /><rect x="0" y="91" width="320" height="6" /><rect x="0" y="100" width="320" height="5" /><rect x="0" y="108" width="320" height="4" /><rect x="0" y="115" width="320" height="3" />
        </clipPath>
      </defs>
      {/* небо и солнце */}
      <rect width="320" height="122" fill={`url(#sky${uid})`} />
      {[[24, 18], [62, 34], [150, 12], [290, 26], [262, 10], [110, 40]].map(([x, y]) => <circle key={`${x}`} cx={x} cy={y} r="0.9" fill="#FFFFFF" opacity="0.8" />)}
      <circle cx="226" cy="110" r="52" fill={`url(#sun${uid})`} clipPath={`url(#sunclip${uid})`} />
      {/* горы */}
      <path d="M0 122 L40 98 L70 112 L104 90 L140 122 Z M180 122 L214 104 L240 116 L276 94 L320 118 L320 122 Z" fill="#2A0845" />
      {/* пальма */}
      <g fill="#0B0014">
        <path d="M296 122 Q300 92 293 66 L297 66 Q305 92 301 122 Z" />
        <path d="M295 66 Q280 56 262 62 Q280 58 295 68 Z M295 66 Q300 50 316 46 Q302 54 297 68 Z M295 66 Q284 70 274 84 Q286 72 297 68 Z M295 66 Q310 66 318 78 Q306 70 296 68 Z M295 66 Q290 54 278 46 Q292 52 297 66 Z" />
      </g>
      {/* пол-сетка */}
      <rect y="122" width="320" height="58" fill="#0B0014" />
      <g stroke="#FF2E88" strokeWidth="1" opacity="0.75">
        <line x1="0" y1="122" x2="320" y2="122" strokeWidth="1.6" />
        {[128, 136, 146, 158, 174].map((y) => <line key={y} x1="0" y1={y} x2="320" y2={y} opacity={0.4 + (y - 122) / 100} />)}
        {Array.from({ length: 13 }, (_, i) => -120 + i * 47).map((x) => <line key={x} x1={160} y1={122} x2={x + (x - 160) * 0.6} y2={180} opacity="0.55" />)}
      </g>
      {/* скорость */}
      <g stroke="#2DE2E6" strokeWidth="2" strokeLinecap="round" opacity="0.8">
        <line x1="296" y1="104" x2="318" y2="104" /><line x1="300" y1="116" x2="320" y2="116" /><line x1="292" y1="128" x2="312" y2="128" />
      </g>
      {/* тень */}
      <ellipse cx="160" cy={ground + 3} rx="140" ry="6" fill="#000" opacity="0.6" />
      {/* сдвиг цвета: бирюзовый и розовый контуры */}
      <g transform="translate(-2.4 0)" fill="none" stroke="#2DE2E6" strokeWidth="2.4" opacity="0.85">{silhouette}</g>
      <g transform="translate(2 1)" fill="none" stroke="#FF2E88" strokeWidth="2" opacity="0.7">{silhouette}</g>
      {/* корпус */}
      <path d={s.body} fill="#0D0414" stroke="#FF2E88" strokeWidth="1.6" strokeLinejoin="round" />
      {/* молдинг */}
      <path d={`M40 118 L${Math.max(260, rearX - 6)} 118`} stroke="#FF2E88" strokeWidth="1.2" opacity="0.7" />
      {/* окна */}
      {s.win.map((d, i) => <path key={i} d={d} fill={`url(#glass${uid})`} stroke="#0D0414" strokeWidth="1.2" />)}
      {s.win.map((d, i) => <path key={`r${i}`} d={d} fill="none" stroke="#FFFFFF" strokeWidth="0.6" opacity="0.35" />)}
      {/* фары, фонарь */}
      <rect x="31" y="112" width="10" height="6" rx="2" fill="#FFD319" />
      <path d="M31 115 L0 108 L0 124 Z" fill="#FFD319" opacity="0.18" />
      <rect x={rearX - 5} y="104" width="5" height="10" rx="1.5" fill="#FF003C" />
      <rect x={rearX - 9} y="102" width="12" height="14" rx="3" fill="#FF003C" opacity="0.25" />
      {/* колёса */}
      {[w1, w2].map((x) => (
        <g key={x}>
          <circle cx={x} cy={ground - s.r + 4} r={s.r} fill="#0D0414" stroke="#2DE2E6" strokeWidth="1.6" />
          <circle cx={x} cy={ground - s.r + 4} r={s.r * 0.5} fill="none" stroke="#2DE2E6" strokeWidth="2.4" />
          <circle cx={x} cy={ground - s.r + 4} r={2} fill="#FF2E88" />
        </g>
      ))}
      {/* номер */}
      {plate && (
        <g>
          <rect x="132" y="150" width="56" height="16" rx="3" fill="#F5F5F5" stroke="#0D0414" strokeWidth="1" />
          <rect x="132" y="150" width="7" height="16" rx="2" fill="#2148C0" />
          <text x="163" y="161.5" textAnchor="middle" fontFamily="ui-monospace, Menlo, monospace" fontSize="9" fontWeight="700" fill="#0D0414">{plate.slice(0, 9)}</text>
        </g>
      )}
      {/* название — неоновой надписью */}
      {title && (
        <g fontFamily="'Arial Black', 'Helvetica Neue', Arial, sans-serif" fontStyle="italic" fontWeight="900" fontSize="17" letterSpacing="0.5">
          <text x="14" y="28" fill="#2DE2E6" opacity="0.9">{title.toUpperCase().slice(0, 24)}</text>
          <text x="16" y="29.5" fill="#FF2E88">{title.toUpperCase().slice(0, 24)}</text>
          <text x="15" y="28.8" fill="#FFF5FB">{title.toUpperCase().slice(0, 24)}</text>
        </g>
      )}
      {/* сканлайны */}
      <g opacity="0.12">{Array.from({ length: 45 }, (_, i) => <rect key={i} y={i * 4} width="320" height="1" fill="#000" />)}</g>
    </svg>
  );
}
