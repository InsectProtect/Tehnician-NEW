import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { haptic } from '../telegram';
import type { RemarkType } from '../types';
import { Button, Input, Sheet, cx, useToast } from './ui';

const pts = (n: number) => String(n).replace('.', ',');

/** Выбор типа замечания: название и сколько баллов снимется. */
export function RemarkTypePicker({ types, value, onChange }: { types: RemarkType[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {types.map((t) => (
        <button key={t.id} onClick={() => { haptic.tap(); onChange(value === t.id ? '' : t.id); }}
          className={cx('rounded-2xl px-3 py-2.5 text-left transition', value === t.id ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>
          <div className="text-[14px] font-medium leading-snug">{t.label}</div>
          <div className={cx('mt-0.5 font-dot text-[12.5px]', value === t.id ? 'text-accent' : 'text-[#D70015] dark:text-[#FF453A]')}>
            {t.points ? `−${pts(t.points)} балл.` : 'без штрафа'}
          </div>
        </button>
      ))}
    </div>
  );
}

/** Редактор типов замечаний и штрафов. */
export function RemarkTypesSheet({ types, onClose, onSaved }: { types: RemarkType[]; onClose: () => void; onSaved: (t: RemarkType[]) => void }) {
  const toast = useToast();
  const [list, setList] = useState(types.map((t) => ({ ...t, p: pts(t.points) })));
  const [busy, setBusy] = useState(false);
  const upd = (i: number, x: Partial<(typeof list)[number]>) => setList(list.map((r, j) => (j === i ? { ...r, ...x } : r)));
  return (
    <Sheet open onClose={onClose} title="Типы замечаний">
      <p className="-mt-3 mb-4 text-[13.5px] leading-snug text-muted">
        При замечании с типом у сотрудника сразу снимаются баллы в KPI текущего месяца. Удалите замечание — баллы вернутся.
      </p>
      <div className="space-y-2">
        {list.map((t, i) => (
          <div key={t.id || i} className="flex items-center gap-2">
            <Input placeholder="Название" value={t.label} onChange={(e) => upd(i, { label: e.target.value })} />
            <div className="w-[92px] shrink-0">
              <Input inputMode="decimal" className="text-right font-dot" value={t.p} onChange={(e) => upd(i, { p: e.target.value })} />
            </div>
            <button aria-label="Удалить" onClick={() => setList(list.filter((_, j) => j !== i))}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#D70015] dark:text-[#FF453A]"><Trash2 size={17} strokeWidth={1.75} /></button>
          </div>
        ))}
      </div>
      <div className="mt-1 px-1 text-[12px] text-muted">Справа — сколько баллов снимается (0 — без штрафа).</div>
      <button onClick={() => setList([...list, { id: '', label: '', points: 1, p: '1' }])}
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold text-accent-ink ring-1 ring-inset ring-line">
        <Plus size={18} strokeWidth={2} /> Добавить тип
      </button>
      <Button className="mt-4" loading={busy} onClick={async () => {
        setBusy(true);
        try {
          const r = await api.saveRemarkTypes(list.map((t) => ({ id: t.id, label: t.label.trim(), points: Number(t.p.replace(',', '.')) })));
          haptic.success(); toast('Типы сохранены'); onSaved(r.types);
        } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
      }}>Сохранить</Button>
    </Sheet>
  );
}
