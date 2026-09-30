import { useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { api } from '../api';
import { getLocation, haptic } from '../telegram';
import { Field, Input, cx, useToast } from './ui';

/**
 * Город и улица отдельными полями + «Поделиться адресом»: берём координаты телефона,
 * сервер подбирает адрес (map.md / OpenStreetMap), специалист правит, если нужно.
 */
export function AddressFields({ city, street, onChange, onBlur }: {
  city: string; street: string;
  onChange: (v: { city: string; street: string }) => void;
  onBlur?: (v: { city: string; street: string }) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');

  async function locate() {
    haptic.tap();
    setBusy(true);
    setHint('');
    try {
      const pos = await getLocation();
      if (!pos) {
        toast('Нет доступа к геолокации — разрешите её для Telegram', 'error');
        return;
      }
      const r = await api.geoReverse(pos.lat, pos.lon);
      const next = { city: r.city || city, street: r.street || street };
      onChange(next);
      onBlur?.(next);
      haptic.success();
      setHint(r.street ? `Найдено: ${r.full}. Проверьте номер дома и квартиру.` : 'Улица не найдена — впишите вручную.');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button onClick={locate} disabled={busy}
        className="flex h-[48px] w-full items-center justify-center gap-2 rounded-full bg-card text-[15px] font-semibold text-ink ring-1 ring-inset ring-line active:opacity-70 disabled:opacity-50">
        <LocateFixed size={18} strokeWidth={1.75} className={cx(busy && 'animate-spin', 'text-accent-ink')} />
        {busy ? 'Определяю адрес…' : 'Поделиться адресом'}
      </button>
      {hint && <div className="px-1 text-[12.5px] leading-snug text-muted">{hint}</div>}
      <div className="grid grid-cols-[1fr_1.4fr] gap-2.5">
        <Field label="Город / село">
          <Input placeholder="mun. Chișinău" value={city}
            onChange={(e) => onChange({ city: e.target.value, street })} onBlur={() => onBlur?.({ city, street })} />
        </Field>
        <Field label="Улица, дом, кв.">
          <Input placeholder="str. Ismail 33, ap. 5" value={street}
            onChange={(e) => onChange({ city, street: e.target.value })} onBlur={() => onBlur?.({ city, street })} />
        </Field>
      </div>
    </div>
  );
}

/** «mun. Chișinău, str. Ismail 33» → { city, street } (первая часть — населённый пункт, если в ней нет цифр). */
export function splitAddress(full: string, locality = '') {
  const parts = full.split(',').map((x) => x.trim()).filter(Boolean);
  if (locality && full.toLowerCase().startsWith(locality.toLowerCase())) {
    return { city: locality, street: full.slice(locality.length).replace(/^[,\s]+/, '') };
  }
  if (parts.length > 1 && !/\d/.test(parts[0])) return { city: parts[0], street: parts.slice(1).join(', ') };
  return { city: locality, street: full };
}

export const joinAddress = (city: string, street: string) => [city.trim(), street.trim()].filter(Boolean).join(', ');
