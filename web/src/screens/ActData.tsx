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
  const cfg = useConfig();
  const [location, setLocation] = useState(visit.location);
  const [area, setArea] = useState(visit.area);
  const [rep, setRep] = useState(visit.client_rep);
  const [func, setFunc] = useState(visit.client_rep_function);
  const [addr, setAddr] = useState(() => splitAddress(visit.address, visit.locality));
  const [custom, setCustom] = useState('');

  const listed = cfg.products?.[visit.procedure] ?? [];
  const options = [...listed, ...visit.products.filter((p) => !listed.includes(p))];

  if (!editable) {
    return (
      <Group>
        <Row title={visit.location || '—'} subtitle="Помещения (Locație)" />
        <Row title={visit.area ? `${visit.area} м²` : '—'} subtitle="Площадь" />
        <Row title={visit.locality || '—'} subtitle="Город / село" />
        <Row title={visit.address} subtitle="Адрес объекта" />
        <Row title={visit.products.join(', ') || '—'} subtitle="Препараты" />
        <Row title={[visit.client_rep, visit.client_rep_function].filter(Boolean).join(', ') || '—'} subtitle="Представитель заказчика" />
      </Group>
    );
  }

  const save = (key: keyof ActPatch, value: string, prev: string) => {
    if (value.trim() !== prev) onPatch({ [key]: value.trim() });
  };

  function addCustom() {
    const v = custom.trim();
    if (!v) return;
    haptic.tap();
    if (!visit.products.includes(v)) onPatch({ products: [...visit.products, v] });
    setCustom('');
  }

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
        {options.length > 0 && (
          <div className="mb-2.5">
            <MultiChips options={options} value={visit.products} onChange={(v) => { haptic.tap(); onPatch({ products: v }); }} />
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
      </Field>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Представитель">
          <Input placeholder="ФИО" value={rep}
            onChange={(e) => setRep(e.target.value)} onBlur={() => save('client_rep', rep, visit.client_rep)} />
        </Field>
        <Field label="Должность">
          <Input value={func}
            onChange={(e) => setFunc(e.target.value)} onBlur={() => save('client_rep_function', func, visit.client_rep_function)} />
        </Field>
      </div>
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
