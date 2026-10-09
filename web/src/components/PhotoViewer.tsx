import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { haptic } from '../telegram';

/* ================================================================================================
 * Просмотр фото внутри приложения (v72): openPhotos(['url1','url2'], 1) — полноэкранная галерея поверх всего,
 * листание свайпом/стрелками, увеличение двойным тапом или щипком, закрытие — ✕, свайп вниз, Esc.
 * Хост <PhotoViewerHost /> подключён один раз в main.tsx.
 * ================================================================================================ */

type State = { urls: string[]; index: number } | null;
let push: ((s: State) => void) | null = null;

export function openPhotos(urls: (string | null | undefined)[], index = 0) {
  const list = urls.filter((u): u is string => Boolean(u));
  if (!list.length) return;
  haptic.tap();
  push?.({ urls: list, index: Math.max(0, Math.min(index, list.length - 1)) });
}

export const openPhoto = (url: string | null | undefined) => openPhotos([url]);

const dist = (t: TouchEvent['touches']) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

export function PhotoViewerHost() {
  const [s, setS] = useState<State>(null);
  useEffect(() => { push = setS; return () => { push = null; }; }, []);
  if (!s) return null;
  return <Viewer key={s.urls.join('|')} urls={s.urls} start={s.index} onClose={() => setS(null)} />;
}

function Viewer({ urls, start, onClose }: { urls: string[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const g = useRef<{ x: number; y: number; d: number; z: number; px: number; py: number; t: number; lastTap: number; pinch: boolean }>({ x: 0, y: 0, d: 0, z: 1, px: 0, py: 0, t: 0, lastTap: 0, pinch: false });
  const many = urls.length > 1;

  const go = (d: number) => {
    if (!many) return;
    setI((x) => (x + d + urls.length) % urls.length);
    setZoom(1); setPan({ x: 0, y: 0 }); setLoaded(false);
    haptic.tap();
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  });

  const onStart = (e: TouchEvent) => {
    const c = g.current;
    if (e.touches.length === 2) { c.pinch = true; c.d = dist(e.touches); c.z = zoom; return; }
    c.pinch = false;
    c.x = e.touches[0].clientX; c.y = e.touches[0].clientY; c.px = pan.x; c.py = pan.y; c.t = Date.now();
  };
  const onMove = (e: TouchEvent) => {
    const c = g.current;
    if (e.touches.length === 2 && c.pinch) {
      setZoom(Math.max(1, Math.min(5, c.z * (dist(e.touches) / (c.d || 1)))));
      return;
    }
    if (e.touches.length !== 1 || c.pinch) return;
    const dx = e.touches[0].clientX - c.x;
    const dy = e.touches[0].clientY - c.y;
    if (zoom > 1) setPan({ x: c.px + dx, y: c.py + dy });
    else setDrag({ x: dx, y: dy });
  };
  const onEnd = (e: TouchEvent) => {
    const c = g.current;
    if (c.pinch) {
      if (e.touches.length === 0) { c.pinch = false; if (zoom <= 1.05) { setZoom(1); setPan({ x: 0, y: 0 }); } }
      return;
    }
    const { x, y } = drag;
    setDrag({ x: 0, y: 0 });
    if (zoom > 1) return;
    if (Math.abs(x) > 60 && Math.abs(x) > Math.abs(y)) { go(x < 0 ? 1 : -1); return; }
    if (y > 110 && Math.abs(y) > Math.abs(x)) { onClose(); return; }
    // двойной тап — увеличить/вернуть
    if (Math.abs(x) < 8 && Math.abs(y) < 8 && Date.now() - c.t < 250) {
      const now = Date.now();
      if (now - c.lastTap < 300) { setZoom((z) => (z > 1 ? 1 : 2.5)); setPan({ x: 0, y: 0 }); c.lastTap = 0; }
      else c.lastTap = now;
    }
  };

  const fade = drag.y > 0 ? Math.max(0.35, 1 - drag.y / 400) : 1;
  return (
    <div className="fixed inset-0 z-[60] flex select-none items-center justify-center animate-fade" style={{ background: `rgba(0,0,0,${fade})`, touchAction: 'none' }}
      onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
      onDoubleClick={() => { setZoom((z) => (z > 1 ? 1 : 2.5)); setPan({ x: 0, y: 0 }); }}>
      {!loaded && <div className="absolute h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
      <img key={urls[i]} src={urls[i]} alt="" draggable={false} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)}
        className="max-h-full max-w-full object-contain"
        style={{
          transform: `translate(${pan.x + drag.x}px, ${pan.y + drag.y}px) scale(${zoom})`,
          transition: drag.x || drag.y || g.current.pinch ? 'none' : 'transform .2s ease',
          opacity: loaded ? 1 : 0,
        }} />
      <div className="top-safe absolute inset-x-0 flex items-center justify-between px-4">
        <span className="rounded-full bg-white/15 px-3 py-1 font-mono text-[12.5px] text-white">{many ? `${i + 1} / ${urls.length}` : ''}</span>
        <button aria-label="Закрыть" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white">
          <X size={20} strokeWidth={2} />
        </button>
      </div>
      {many && (
        <>
          <button aria-label="Назад" onClick={() => go(-1)} className="absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white md:flex"><ChevronLeft size={24} /></button>
          <button aria-label="Дальше" onClick={() => go(1)} className="absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white md:flex"><ChevronRight size={24} /></button>
          <div className="absolute inset-x-0 bottom-6 flex justify-center gap-1.5" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {urls.map((u, k) => <span key={u + k} className={k === i ? 'h-1.5 w-4 rounded-full bg-white' : 'h-1.5 w-1.5 rounded-full bg-white/40'} />)}
          </div>
        </>
      )}
    </div>
  );
}
