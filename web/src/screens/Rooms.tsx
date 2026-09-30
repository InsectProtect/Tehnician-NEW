import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { haptic } from '../telegram';
import type { RoomsDispute } from '../types';
import { useToast } from '../components/ui';

/** Менеджер / администратор: дезинсектор нажал «Ошибка» в количестве комнат — подтвердить или исправить. */
export function RoomsDisputesWidget() {
  const toast = useToast();
  const [items, setItems] = useState<RoomsDispute[]>([]);
  const [edit, setEdit] = useState<Record<string, number>>({});
  const load = useCallback(() => api.roomsDisputes().then((r) => setItems(r.items)).catch(() => {}), []);
  useEffect(() => { load(); const t = window.setInterval(load, 60000); return () => window.clearInterval(t); }, [load]);
  if (!items.length) return null;
  async function decide(d: RoomsDispute, ok: boolean) {
    try { await api.decideRooms(d.id, ok ? { ok: true } : { rooms: edit[d.id] ?? d.claimed }); haptic.success(); toast('Готово', 'ok'); load(); }
    catch (e) { toast((e as Error).message, 'error'); }
  }
  return (
    <div className="mb-4 rounded-[22px] bg-card p-4 ring-2 ring-inset ring-[#FF9F0A]/60">
      <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">🏠 Ошибка в количестве комнат · {items.length}</div>
      <div className="flex flex-col gap-2.5">
        {items.map((d) => {
          const n = edit[d.id] ?? d.claimed;
          return (
            <div key={d.id} className="rounded-2xl bg-fill p-3">
              <div className="text-[14.5px] font-semibold">№ {d.task_no} · {d.client}</div>
              <div className="text-[13px] text-muted">{d.tech_name} · в заявке <b className="text-ink dark:text-white">{d.task_rooms}</b>, на объекте <b className="text-ink dark:text-white">{d.claimed}</b>{d.note ? ` · «${d.note}»` : ''}</div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button onClick={() => decide(d, true)} className="rounded-xl bg-[#34C759] px-3 py-2 text-[13.5px] font-bold text-black">✅ Всё верно: {d.task_rooms}</button>
                <div className="flex items-center gap-1.5 rounded-xl bg-card px-1.5 py-1 ring-1 ring-inset ring-line">
                  <button onClick={() => setEdit({ ...edit, [d.id]: Math.max(1, n - 1) })} className="h-8 w-8 text-[18px]">−</button>
                  <span className="font-dot w-7 text-center text-[18px]">{n}</span>
                  <button onClick={() => setEdit({ ...edit, [d.id]: Math.min(50, n + 1) })} className="h-8 w-8 text-[18px]">+</button>
                </div>
                <button onClick={() => decide(d, false)} className="rounded-xl bg-accent px-3 py-2 text-[13.5px] font-bold text-black">Исправить на {n}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
