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

export function CarArt({ body, title, plate, className, model }: { body?: string; title?: string; plate?: string; className?: string; /** марка/модель — для силуэта (Caddy, Transit Connect), если title не показываем */ model?: string }) {
  const uid = useId().replace(/:/g, '');
  // v91: в оформлении «Battlefield» — военная машина в камуфляже на фоне поля боя
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('bf')) return <CarArtBF uid={uid} body={body} title={title} model={model} plate={plate} className={className} />;
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

/* ================================================================================================
 * v91: «Battlefield» — служебная машина в камуфляже (стиль Battlefield V): пасмурное небо, дым и зарево
 * над руинами, грязь с колеёй, мешки с песком; кузов залит камуфляжем, трафаретный номер, багажник
 * с канистрами. Отдельные силуэты VW Caddy и Ford Transit Connect (по названию машины), иначе — по кузову.
 * ================================================================================================ */

type Mil = { body: string; win: string[]; wheels: [number, number]; r: number; rear: number; roof: number; front: number; doors: string[]; star?: number; van?: boolean };

const MIL: Record<'caddy' | 'connect', Mil> = {
  // VW Caddy: низкий длинный капот, ровная крыша, вертикальная корма
  caddy: {
    body: 'M28 142 L28 119 Q29 110 39 107 L84 99 Q93 97 99 89 L121 64 Q125 60 133 60 L276 60 Q287 60 288 71 L291 132 Q291 142 283 142 Z',
    win: ['M101 96 L123 66 L129 66 L115 96 Z', 'M133 66 L178 66 L178 97 L118 97 Z'],
    wheels: [84, 244], r: 21, rear: 291, roof: 60, front: 28,
    doors: ['M182 64 L182 136', 'M118 99 L118 136', 'M188 104 L284 104'], star: 236, van: true,
  },
  // Ford Transit Connect: округлая морда, крыша чуть выше и уходит назад
  connect: {
    body: 'M26 142 L26 117 Q28 106 41 103 L80 96 Q89 94 95 86 L115 60 Q121 54 131 54 L279 56 Q291 57 291 69 L293 132 Q293 142 285 142 Z',
    win: ['M97 94 L117 62 L125 62 L111 94 Z', 'M129 62 L174 62 L174 95 L114 95 Z'],
    wheels: [82, 246], r: 22, rear: 293, roof: 55, front: 26,
    doors: ['M178 60 L178 136', 'M114 97 L114 136', 'M184 100 L286 100'], star: 236, van: true,
  },
};

function milShape(body?: string, title?: string): Mil {
  const t = title || '';
  if (/caddy/i.test(t)) return MIL.caddy;
  if (/connect/i.test(t)) return MIL.connect;
  const s = SHAPES[isBody(body || '') ? (body as Body) : 'van'];
  const roof = Math.min(...s.body.match(/\d+(\.\d+)?/g)!.map(Number).filter((n, i) => i % 2 === 1));
  return { ...s, roof, front: 30, doors: [], van: body === 'van' || body === 'bigvan' || !isBody(body || '') };
}

function CarArtBF({ uid, body, title, model, plate, className }: { uid: string; body?: string; title?: string; model?: string; plate?: string; className?: string }) {
  const s = milShape(body, `${title || ''} ${model || ''}`);
  const [w1, w2] = s.wheels;
  const ground = 146;
  const wy = ground - s.r + 4;
  const id = (n: string) => `${n}${uid}`;
  const rackY = s.roof - 7;
  return (
    <svg viewBox="0 0 320 180" className={className} role="img" aria-label={title || 'Машина'} preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={id('sky')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#23262A" /><stop offset="0.55" stopColor="#4A4A42" /><stop offset="0.85" stopColor="#8A6F4E" /><stop offset="1" stopColor="#C9733A" />
        </linearGradient>
        <radialGradient id={id('fire')} cx="0.5" cy="1" r="0.6">
          <stop offset="0" stopColor="#FF7A1A" stopOpacity="0.85" /><stop offset="0.5" stopColor="#FF5A1F" stopOpacity="0.25" /><stop offset="1" stopColor="#FF5A1F" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('mud')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3A3226" /><stop offset="1" stopColor="#17140F" />
        </linearGradient>
        <linearGradient id={id('shade')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.16" /><stop offset="0.45" stopColor="#FFFFFF" stopOpacity="0" /><stop offset="1" stopColor="#000000" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id={id('glass')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9DB0A8" stopOpacity="0.85" /><stop offset="0.5" stopColor="#2E3A38" /><stop offset="1" stopColor="#131917" />
        </linearGradient>
        {/* камуфляж: олива, хаки, коричневый, чёрные «рваные» пятна */}
        <pattern id={id('camo')} width="90" height="64" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)">
          <rect width="90" height="64" fill="#5B5E36" />
          <path d="M0 6 Q14 0 26 8 Q34 14 30 24 Q20 30 8 26 Q-4 20 0 6 Z" fill="#8C7B55" />
          <path d="M44 2 Q60 -2 70 8 Q80 18 68 26 Q54 30 46 20 Q38 10 44 2 Z" fill="#3E3A24" />
          <path d="M30 30 Q46 26 56 36 Q62 46 50 52 Q36 56 28 46 Q22 36 30 30 Z" fill="#8C7B55" />
          <path d="M66 34 Q80 30 90 40 L90 58 Q78 62 70 54 Q60 44 66 34 Z" fill="#2A2A1C" />
          <path d="M2 40 Q12 36 20 44 Q24 54 14 60 Q4 62 0 54 Z" fill="#3E3A24" />
          <path d="M20 14 Q26 12 30 18 Q28 22 22 21 Z M58 46 Q64 44 66 50 Q62 54 57 52 Z M76 14 Q82 12 86 18 Q82 22 77 20 Z" fill="#1C1C14" />
          <path d="M34 2 Q40 0 42 6 Q38 10 33 7 Z M10 30 Q16 28 18 34 Q14 37 10 35 Z" fill="#A08E64" />
        </pattern>
        <filter id={id('blur')} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
        <filter id={id('soft')} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.4" /></filter>
        <clipPath id={id('bodyclip')}><path d={s.body} /></clipPath>
      </defs>

      {/* небо, зарево, дым */}
      <rect width="320" height="124" fill={`url(#${id('sky')})`} />
      <ellipse cx="70" cy="124" rx="120" ry="44" fill={`url(#${id('fire')})`} />
      <g filter={`url(#${id('blur')})`} fill="#1B1B19" opacity="0.75">
        <circle cx="64" cy="84" r="16" /><circle cx="58" cy="62" r="20" /><circle cx="70" cy="38" r="24" /><circle cx="92" cy="18" r="26" />
        <circle cx="250" cy="92" r="12" opacity="0.6" /><circle cx="258" cy="72" r="16" opacity="0.5" /><circle cx="272" cy="50" r="20" opacity="0.4" />
      </g>
      {/* руины и столбы */}
      <path d="M0 124 L0 98 L12 98 L12 90 L22 90 L24 104 L34 104 L36 84 L44 80 L48 96 L58 96 L60 112 L74 112 L76 100 L86 100 L88 124 Z" fill="#1A1A17" />
      <path d="M170 124 L172 108 L186 108 L186 96 L194 92 L198 102 L210 102 L212 90 L222 90 L224 110 L238 110 L240 124 Z" fill="#24241F" />
      <path d="M300 124 L300 70 L303 70 L303 124 Z M292 76 L312 72 L312 74 L292 78 Z" fill="#1A1A17" />
      {/* искры */}
      {[[40, 70], [52, 88], [84, 76], [30, 96], [96, 92], [62, 104]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="0.9" fill="#FFB060" opacity="0.9" />)}

      {/* земля: грязь, колея, лужа */}
      <rect y="122" width="320" height="58" fill={`url(#${id('mud')})`} />
      <path d="M0 150 Q160 140 320 152 M0 162 Q160 152 320 166" stroke="#0E0C09" strokeWidth="3" fill="none" opacity="0.6" />
      <ellipse cx="236" cy="168" rx="40" ry="4" fill="#C9733A" opacity="0.18" />
      {/* мешки с песком и колючка */}
      <g fill="#6E6249" stroke="#2A251B" strokeWidth="0.8">
        <rect x="292" y="118" width="18" height="8" rx="4" /><rect x="302" y="110" width="18" height="8" rx="4" /><rect x="282" y="126" width="18" height="8" rx="4" /><rect x="300" y="126" width="18" height="8" rx="4" />
      </g>
      <g stroke="#2A2A24" strokeWidth="1" fill="none" opacity="0.8">
        <path d="M0 120 L0 108 M18 120 L18 110" strokeWidth="2" />
        <path d="M0 112 Q9 116 18 112 M0 116 Q9 112 18 116" />
      </g>

      {/* тень */}
      <ellipse cx="160" cy={ground + 3} rx="142" ry="6" fill="#000" opacity="0.7" />

      {/* багажник на крыше: канистры и запаска (у фургонов) */}
      {s.van && <g>
        <rect x={s.front + 108} y={rackY + 4} width={s.rear - s.front - 120} height="3" fill="#1C1C16" />
        {[0.22, 0.48, 0.74].map((k) => <rect key={k} x={s.front + 108 + (s.rear - s.front - 120) * k - 1} y={rackY + 4} width="2" height="6" fill="#1C1C16" />)}
        <rect x={s.front + 116} y={rackY - 9} width="14" height="13" rx="1.5" fill="#4E5232" stroke="#11110C" strokeWidth="0.8" />
        <rect x={s.front + 132} y={rackY - 9} width="14" height="13" rx="1.5" fill="#4E5232" stroke="#11110C" strokeWidth="0.8" />
        <path d={`M${s.front + 118} ${rackY - 6} l10 8 M${s.front + 128} ${rackY - 6} l-10 8 M${s.front + 134} ${rackY - 6} l10 8 M${s.front + 144} ${rackY - 6} l-10 8`} stroke="#2E301E" strokeWidth="1" />
        <rect x={s.rear - 70} y={rackY - 5} width="40" height="9" rx="2" fill="#5B5440" stroke="#11110C" strokeWidth="0.8" />
        <path d={`M${s.rear - 70} ${rackY - 1} h40`} stroke="#3B3628" strokeWidth="1" />
        {/* антенна */}
        <path d={`M${s.rear - 12} ${s.roof} Q${s.rear - 18} ${s.roof - 40} ${s.rear - 4} ${s.roof - 58}`} stroke="#11110C" strokeWidth="1.2" fill="none" />
        <rect x={s.rear - 14} y={s.roof - 4} width="5" height="4" fill="#11110C" />
      </g>}

      {/* кузов в камуфляже */}
      <path d={s.body} fill={`url(#${id('camo')})`} />
      <g clipPath={`url(#${id('bodyclip')})`}>
        <rect width="320" height="180" fill={`url(#${id('shade')})`} />
        {/* грязь снизу */}
        <path d={`M0 128 Q40 122 80 130 Q130 124 180 131 Q240 124 320 130 L320 180 L0 180 Z`} fill="#3A3226" opacity="0.75" filter={`url(#${id('soft')})`} />
        {/* двери, рейка сдвижной двери */}
        {s.doors.map((d, i) => <path key={i} d={d} stroke="#15150F" strokeWidth="1.1" fill="none" opacity="0.8" />)}
        {/* трафарет: звезда и номер */}
        <g transform={`translate(${s.star ?? (s.front + s.rear) / 2 + 40} ${s.star ? 84 : 116})`}>
          <circle r="13" fill="none" stroke="#E9E4D4" strokeWidth="2" opacity="0.85" />
          <path d="M0 -10 L2.4 -3.2 L9.5 -3.1 L3.8 1.2 L5.9 8.1 L0 4 L-5.9 8.1 L-3.8 1.2 L-9.5 -3.1 L-2.4 -3.2 Z" fill="#E9E4D4" opacity="0.85" />
        </g>
        <text x={s.front + 96} y="124" fontFamily="Oswald, Impact, 'Arial Narrow', sans-serif" fontWeight="700" fontSize="11" letterSpacing="1.5" fill="#E9E4D4" opacity="0.8">IP-PEST</text>
      </g>
      <path d={s.body} fill="none" stroke="#0B0B08" strokeWidth="1.8" strokeLinejoin="round" />
      {/* бампер, решётка, фары-щели */}
      <rect x={s.front - 2} y="124" width="22" height="10" rx="2" fill="#1A1A14" />
      <rect x={s.rear - 8} y="124" width="10" height="10" rx="2" fill="#1A1A14" />
      <path d={`M${s.front + 2} 112 h14`} stroke="#11110C" strokeWidth="3" />
      <rect x={s.front + 1} y="106" width="12" height="5" rx="1.5" fill="#F2C14E" />
      <path d={`M${s.front + 1} 108.5 h12`} stroke="#2A2410" strokeWidth="1.4" />
      <path d={`M${s.front + 1} 108 L0 100 L0 118 Z`} fill="#F2C14E" opacity="0.14" />
      <rect x={s.rear - 4} y="96" width="4" height="12" rx="1" fill="#B3261E" />
      {/* зеркало, ручки */}
      <path d={`M${s.win[0] ? 118 : 120} 90 l-8 -3 l-1 6 z`} fill="#1A1A14" />
      <rect x="150" y="104" width="10" height="2.4" rx="1" fill="#15150F" />
      {/* окна */}
      {s.win.map((d, i) => <path key={i} d={d} fill={`url(#${id('glass')})`} stroke="#0B0B08" strokeWidth="1.2" />)}
      {s.win.map((d, i) => <path key={`g${i}`} d={d} fill="none" stroke="#FFFFFF" strokeWidth="0.5" opacity="0.25" />)}
      {/* колёса: грязные шины, стальные диски */}
      {[w1, w2].map((x) => (
        <g key={x}>
          <circle cx={x} cy={wy} r={s.r + 3} fill="#0B0B08" />
          <circle cx={x} cy={wy} r={s.r} fill="#1B1A16" stroke="#3A3226" strokeWidth="2.5" strokeDasharray="3 2" />
          <circle cx={x} cy={wy} r={s.r * 0.55} fill="#4B4E2E" stroke="#11110C" strokeWidth="1" />
          {[0, 72, 144, 216, 288].map((a) => <circle key={a} cx={x + Math.cos((a * Math.PI) / 180) * s.r * 0.33} cy={wy + Math.sin((a * Math.PI) / 180) * s.r * 0.33} r="1.3" fill="#11110C" />)}
          <circle cx={x} cy={wy} r={2.4} fill="#2A2A1C" />
        </g>
      ))}

      {/* номер — военный трафарет */}
      {plate && (
        <g>
          <rect x="128" y="151" width="64" height="15" rx="1" fill="#111" stroke="#E9E4D4" strokeWidth="1" />
          <text x="160" y="162" textAnchor="middle" fontFamily="ui-monospace, Menlo, monospace" fontSize="9" fontWeight="700" letterSpacing="1" fill="#E9E4D4">{plate.slice(0, 9).toUpperCase()}</text>
        </g>
      )}
      {/* название — как в HUD */}
      {title && (
        <g>
          <rect x="12" y="12" width="4" height="18" fill="#FF5A1F" />
          <text x="22" y="27" fontFamily="Oswald, Impact, 'Arial Narrow', sans-serif" fontWeight="700" fontSize="17" letterSpacing="1.2" fill="#F2EEE4">{title.toUpperCase().slice(0, 24)}</text>
          <text x="22" y="38" fontFamily="ui-monospace, Menlo, monospace" fontSize="6.5" letterSpacing="1.6" fill="#FF8A4C">UNIT · INSECT PROTECT</text>
        </g>
      )}
      {/* виньетка и зерно */}
      <rect width="320" height="180" fill="none" stroke="#000" strokeWidth="26" opacity="0.35" filter={`url(#${id('blur')})`} />
      <g opacity="0.08">{Array.from({ length: 45 }, (_, i) => <rect key={i} y={i * 4} width="320" height="1" fill="#000" />)}</g>
    </svg>
  );
}
