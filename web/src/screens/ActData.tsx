import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useConfig } from '../config';
import { haptic } from '../telegram';
import type { Visit } from '../types';
import { Field, Group, Input, MultiChips, Row } from '../components/ui';
import { AddressFields, joinAddress, splitAddress } from '../components/AddressFields';

export type ActPatch = Partial<Pick<Visit, 'area' | 'location' | 'products' | 'client_rep' | 'client_rep_function' | 'locality' | 'address'>>;

/** Данные для бланка акта: помещения, площадь, препараты, представитель заказчика. */
export function ActData({ visit, editable, onPatch }: { visit: Visit; editable: boolean; onPatch: (p: ActPatch) => void }) {
  const [location, setLocation] = useState(visit.location);
  const [area, setArea] = useState(visit.area);
  const [addr, setAddr] = useState(() => splitAddress(visit.address, visit.locality));

  if (!editable) {
    return (
      <Group>
        <Row title={visit.location || '—'} subtitle="Помещения (Locație)" />
        <Row title={visit.area ? `${visit.area} м²` : '—'} subtitle="Площадь" />
        <Row title={visit.locality || '—'} subtitle="Город / село" />
        <Row title={visit.address} subtitle="Адрес объекта" />
        <Row title={visit.products.join(', ') || '—'} subtitle="Препараты" />
      </Group>
    );
  }

  const save = (key: keyof ActPatch, value: string, prev: string) => {
    if (value.trim() !== prev) onPatch({ [key]: value.trim() });
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-[1fr_110px] gap-2.5">
        <Field label="Помещения">
          <Input placeholder="Склад, кухня, офис" value={location}
            onChange={(e) => setLocation(e.target.value)} onBlur={() => save('location', location, visit.location)} />
        </Field>
        <Field label="Площадь, м²">
          <Input inputMode="decimal" placeholder="0" value={area}
            onChange={(e) => setArea(e.target.value.replace(/[^\d.,]/g, ''))} onBlur={() => save('area', area, visit.area)} />
        </Field>
      </div>

      <Field label="Препараты">
        <ProductsPicker visit={visit} onChange={(products) => onPatch({ products })} />
      </Field>

      <div>
        <div className="mb-2.5 px-1 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted">Адрес объекта</div>
        <AddressFields city={addr.city} street={addr.street} onChange={setAddr}
          onBlur={(v) => {
            const full = joinAddress(v.city, v.street);
            const p: ActPatch = {};
            if (v.city.trim() !== visit.locality) p.locality = v.city.trim();
            if (full && full !== visit.address && v.street.trim().length >= 3) p.address = full;
            if (Object.keys(p).length) onPatch(p);
          }} />
      </div>
    </div>
  );
}

const SRC_HINT: Record<string, string> = {
  object: '💡 Подставлено как в прошлый раз на этом объекте — проверьте',
  tech: '💡 Подставлен ваш последний набор для этой обработки — проверьте',
  common: '💡 Подставлен обычный набор для этой обработки — проверьте',
};

/** v97: препараты — отметить из списка (прошлый раз на объекте + справочник) или вписать свой. */
export function ProductsPicker({ visit, onChange }: { visit: Visit; onChange: (products: string[]) => void }) {
  const cfg = useConfig();
  const [custom, setCustom] = useState('');
  const options = [...new Set([...(visit.prev_products || []), ...(cfg.products?.[visit.procedure] ?? []), ...visit.products])];
  function addCustom() {
    const v = custom.trim();
    if (!v) return;
    haptic.tap();
    if (!visit.products.includes(v)) onChange([...visit.products, v]);
    setCustom('');
  }
  return (
    <div>
      {options.length > 0 && (
        <div className="mb-2.5">
          <MultiChips options={options} value={visit.products} onChange={(v) => { haptic.tap(); onChange(v); }} />
        </div>
      )}
      <div className="flex gap-2">
        <div className="flex-1">
          <Input placeholder={options.length ? 'Другой препарат' : 'Название препарата'} value={custom}
            onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCustom()} />
        </div>
        <button onClick={addCustom} disabled={!custom.trim()} aria-label="Добавить"
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl bg-accent text-black disabled:opacity-30">
          <Plus size={20} strokeWidth={2} />
        </button>
      </div>
      {visit.products.length > 0 && visit.products_src && SRC_HINT[visit.products_src] && (
        <div className="mt-2 px-1 text-[12.5px] leading-snug text-muted">{SRC_HINT[visit.products_src]}</div>
      )}
      {!visit.products.length && <div className="mt-2 px-1 text-[12.5px] font-medium leading-snug text-[#D70015] dark:text-[#FF453A]">Обязательно — препараты печатаются в акте</div>}
    </div>
  );
}
