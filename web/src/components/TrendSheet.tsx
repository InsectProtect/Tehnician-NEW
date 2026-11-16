import { useState } from 'react';
import { ChevronRight, TrendingUp } from 'lucide-react';
import { api } from '../api';
import { haptic, openLink } from '../telegram';
import { Sheet, useToast } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');
const ym = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

/** Готовые периоды для анализа: месяцы ГГГГ-ММ включительно. */
function presets(now = new Date()) {
  const y = now.getFullYear();
  const q = Math.floor(now.getMonth() / 3); // текущий квартал 0..3
  const lastQEnd = new Date(y, q * 3, 1); // первый месяц текущего квартала
  return [
    { id: '12m', label: 'Последние 12 месяцев', from: ym(addMonths(now, -11)), to: ym(now) },
    { id: 'year', label: `${y} год (с января)`, from: `${y}-01`, to: ym(now) },
    { id: 'prev', label: `${y - 1} год целиком`, from: `${y - 1}-01`, to: `${y - 1}-12` },
    { id: 'q', label: 'Прошлый квартал', from: ym(addMonths(lastQEnd, -3)), to: ym(addMonths(lastQEnd, -1)) },
    { id: '6m', label: 'Последние 6 месяцев', from: ym(addMonths(now, -5)), to: ym(now) },
  ];
}

/** v99: выбор периода и открытие PDF «Analiza de tendință» по станциям объекта. */
export function TrendSheet({ objectId, onClose }: { objectId: string; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  async function open(p: { id: string; from: string; to: string }) {
    haptic.tap();
    setBusy(p.id);
    try {
      const r = await api.objectTrend(objectId, p.from, p.to);
      if (!r.visits) toast('За этот период выездов на объект нет — отчёт будет пустым');
      openLink(r.url);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }
  return (
    <Sheet open onClose={onClose} title="Анализ тенденций">
      <p className="mb-3 text-[14px] leading-snug text-muted">
        PDF для клиента и аудита (HACCP / ISO 22000): активность по зонам и месяцам, графики, карта станций, критические точки,
        выводы и меры. Зону станции можно уточнить в «Изменить станцию».
      </p>
      <div className="overflow-hidden rounded-2xl bg-card" data-panel>
        {presets().map((p, i) => (
          <button key={p.id} disabled={!!busy} onClick={() => open(p)}
            className={`flex w-full items-center gap-3 px-4 py-3.5 text-left disabled:opacity-50 ${i ? 'border-t border-line' : ''}`}>
            <TrendingUp size={19} strokeWidth={1.75} className="shrink-0 text-accent-ink" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15.5px] font-medium">{p.label}</span>
              <span className="block text-[12.5px] text-muted">{p.from.split('-').reverse().join('.')} — {p.to.split('-').reverse().join('.')}</span>
            </span>
            {busy === p.id ? <span className="text-[13px] text-muted">…</span> : <ChevronRight size={18} className="text-muted" />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
