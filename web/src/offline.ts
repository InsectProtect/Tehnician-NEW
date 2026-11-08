import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { InspectionInput, Trap } from './types';

/* ================================================================================================
 * v94: офлайн-обход. Нет связи (подвал, склад) — осмотры станций и фото к ним сохраняются в телефоне
 * (IndexedDB, переживает закрытие приложения) и уходят на сервер сами, когда связь появится.
 * Повторная отправка безопасна: осмотр на сервере — upsert по (выезд, станция), у замечания свой client_id.
 * ================================================================================================ */

export type OutItem = {
  id: string;
  visitId: string;
  kind: 'inspection' | 'observation';
  data: Record<string, unknown>;
  at: string;
  error?: string;
};

const DB = 'ip_offline';
const STORE = 'outbox';
let items: OutItem[] = [];
let loaded = false;
let flushing = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function tx(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<unknown> {
  const db = await idb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => { resolve(req ? req.result : null); db.close(); };
      t.onerror = () => { resolve(null); db.close(); };
    } catch { resolve(null); }
  });
}

async function loadAll() {
  if (loaded) return;
  loaded = true;
  const all = (await tx('readonly', (s) => s.getAll())) as OutItem[] | null;
  if (all?.length) {
    const have = new Set(items.map((i) => i.id));
    items = [...items, ...all.filter((i) => !have.has(i.id))].sort((a, b) => a.at.localeCompare(b.at));
    emit();
  }
}
const put = (it: OutItem) => tx('readwrite', (s) => s.put(it));
const del = (id: string) => tx('readwrite', (s) => s.delete(id));

const rid = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Ошибка связи (а не «сервер сказал нет»): fetch упал, таймаут, сервер спит (5xx). */
export function isNetError(e: unknown) {
  if (e instanceof ApiError) return !e.status || e.status >= 500 || e.status === 408;
  return true;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function send(it: OutItem) {
  if (it.kind === 'inspection') return api.saveInspection(it.visitId, { ...(it.data as unknown as InspectionInput), at: it.at });
  return api.addObservation(it.visitId, { ...(it.data as unknown as { category: string; comment: string; photos: string[] }), client_id: it.id, at: it.at });
}

async function enqueue(it: OutItem) {
  // тот же осмотр станции заменяет предыдущий из очереди
  if (it.kind === 'inspection') {
    const old = items.find((x) => x.kind === 'inspection' && x.visitId === it.visitId && x.data.trap_id === it.data.trap_id);
    if (old) { items = items.filter((x) => x !== old); await del(old.id); }
  }
  items = [...items, it];
  await put(it);
  emit();
}

/** Отправить сразу; нет связи — положить в очередь. Ошибку сервера (400/409…) пробрасывает как раньше. */
export async function saveOrQueue(kind: OutItem['kind'], visitId: string, data: Record<string, unknown>): Promise<'sent' | 'queued'> {
  await loadAll();
  const it: OutItem = { id: rid(), visitId, kind, data, at: new Date().toISOString() };
  // пока в очереди есть записи этого выезда, новые встают за ними (порядок осмотров сохраняется)
  const behind = items.some((x) => x.visitId === visitId && !x.error);
  if (!behind && navigator.onLine !== false) {
    try {
      await withTimeout(send(it), 20000);
      return 'sent';
    } catch (e) {
      if (!isNetError(e)) throw e;
    }
  }
  await enqueue(it);
  return 'queued';
}

/** Отправить всё, что накопилось. Останавливается на первой ошибке связи. */
export async function flushOutbox(): Promise<number> {
  await loadAll();
  if (flushing || !items.some((x) => !x.error)) return 0;
  flushing = true;
  emit();
  let sent = 0;
  try {
    for (const it of [...items]) {
      if (it.error) continue;
      try {
        await withTimeout(send(it), 25000);
        items = items.filter((x) => x.id !== it.id);
        await del(it.id);
        sent++;
        emit();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) break; // ждём PIN
        if (isNetError(e)) break;
        // сервер отказал (выезд завершён, станция удалена…) — не крутим бесконечно, показываем
        const bad = { ...it, error: (e as Error).message };
        items = items.map((x) => (x.id === it.id ? bad : x));
        await put(bad);
        emit();
      }
    }
  } finally {
    flushing = false;
    emit();
  }
  return sent;
}

export async function dropOutboxItem(id: string) {
  items = items.filter((x) => x.id !== id);
  await del(id);
  emit();
}

let started = false;
/** Фоновая отправка: при появлении сети и раз в 20 с. */
export function startOutbox() {
  if (started) return;
  started = true;
  loadAll().then(() => flushOutbox());
  window.addEventListener('online', () => { flushOutbox(); });
  setInterval(() => { if (items.some((x) => !x.error)) flushOutbox(); }, 20000);
}

export function useOutbox(visitId?: string) {
  const [, tick] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    loadAll();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { subs.delete(f); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const list = visitId ? items.filter((x) => x.visitId === visitId) : items;
  return { items: list, waiting: list.filter((x) => !x.error), failed: list.filter((x) => x.error), flushing, online };
}

/** Станции с осмотрами из очереди поверх ответа сервера (статус считается так же, как на сервере). */
export function withPending(traps: Trap[], list: OutItem[], rodenticide: string): Trap[] {
  const byTrap = new Map<string, OutItem>();
  for (const it of list) if (it.kind === 'inspection' && !it.error) byTrap.set(String(it.data.trap_id), it);
  if (!byTrap.size) return traps;
  return traps.map((t) => {
    const it = byTrap.get(t.id);
    if (!it) return t;
    const d = it.data as unknown as InspectionInput & { condition: string };
    const blocked = ['damaged', 'missing', 'no_access'].includes(d.condition);
    const bait = !blocked && t.kind === rodenticide ? String(d.bait_eaten || '') : '';
    const count = blocked ? 0 : Number(d.count) || 0;
    const status = blocked ? d.condition : (count || ['partial', 'full'].includes(bait)) ? 'activity' : d.condition === 'replaced' ? 'replaced' : 'ok';
    return {
      ...t,
      pending: true,
      inspection: {
        status, condition: d.condition, bait_eaten: bait, pest: count ? String(d.pest || '') : '', count,
        bait_replaced: Boolean(d.bait_replaced), comment: String(d.comment || ''), checked_at: it.at,
      },
    };
  });
}
