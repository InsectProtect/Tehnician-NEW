import { createContext, useContext } from 'react';
import type { Bootstrap } from './types';

export const ConfigCtx = createContext<Bootstrap | null>(null);

export function useConfig(): Bootstrap {
  const cfg = useContext(ConfigCtx);
  if (!cfg) throw new Error('ConfigCtx не инициализирован');
  return cfg;
}

export function plural(n: number, forms: [string, string, string]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
