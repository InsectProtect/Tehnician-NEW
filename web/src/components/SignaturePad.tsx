import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import { haptic } from '../telegram';
import { Button, Sheet } from './ui';

/** Лист «Подпись клиента»: рисуем пальцем, отдаём JPEG (белый фон, тёмно-синие чернила). */
export function SignatureSheet({ onClose, onDone }: { onClose: () => void; onDone: (jpeg: string) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | undefined>(undefined);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * ratio;
    c.height = h * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1B2A7A';
    ctx.lineWidth = 2.6;
  }, []);

  const pos = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: { clientX: number; clientY: number; preventDefault(): void }) => {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
  };
  const move = (e: { clientX: number; clientY: number; preventDefault(): void }) => {
    if (!drawing.current || !last.current) return;
    e.preventDefault();
    const p = pos(e);
    const ctx = ref.current!.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (empty) setEmpty(false);
  };
  const up = () => { drawing.current = false; last.current = undefined; };

  function clear() {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.restore();
    setEmpty(true);
    haptic.tap();
  }

  return (
    <Sheet open onClose={onClose} title="Подпись клиента">
      <p className="-mt-3 mb-4 text-[14px] leading-snug text-muted">
        Дайте телефон клиенту — пусть распишется пальцем в рамке. Подпись встанет в акт в поле «Beneficiar».
      </p>
      <div className="relative overflow-hidden rounded-2xl ring-1 ring-inset ring-line">
        <canvas
          ref={ref}
          className="block h-[220px] w-full touch-none bg-white"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
          onPointerCancel={up}
        />
        {empty && (
          <div className="pointer-events-none absolute inset-x-6 bottom-12 border-b border-dashed border-black/25 text-center text-[13px] text-black/35">
            подпишите здесь
          </div>
        )}
      </div>
      <div className="mt-4 grid grid-cols-[auto_1fr] gap-2.5">
        <Button variant="secondary" className="h-[50px] w-auto px-5" onClick={clear} icon={<Eraser size={18} strokeWidth={1.75} />}>
          Очистить
        </Button>
        <Button disabled={empty} onClick={() => { haptic.success(); onDone(ref.current!.toDataURL('image/jpeg', 0.85)); }}>
          Готово
        </Button>
      </div>
    </Sheet>
  );
}
