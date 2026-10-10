import { useEffect, useState } from 'react';
import { FileDown, History, QrCode, Printer } from 'lucide-react';
import { api } from '../api';
import { fmtDate, plural } from '../config';
import { haptic, openLink } from '../telegram';
import type { LabelBatch, LabelOpts, LabelSize, LabelsInfo } from '../types';
import { Button, Chips, Field, Input, Sheet, Spinner, Toggle, cx, useToast } from '../components/ui';

/* ================================================================================================
 * Генератор QR-этикеток (v73): PDF под стандартные листы наклеек A4, три размера (ловушка / коробка / улица),
 * своё оформление (название, телефон, «Не трогать»), нумерация, история партий — перепечатать те же коды.
 * ================================================================================================ */

const SHEETS = [1, 2, 3, 5];
const sheetsWord = (n: number) => plural(n, ['лист', 'листа', 'листов']);

/** Живой макет этикетки — как она будет выглядеть на листе. */
function LabelPreview({ o, number }: { o: LabelOpts; number: string }) {
  const vertical = o.size === 'l';
  const brand = (o.brand || '').toUpperCase();
  return (
    <div className="flex justify-center rounded-2xl bg-fill/70 p-4">
      <div className={cx('flex bg-white text-[#1D1D1F] shadow-sm', o.lines ? 'ring-1 ring-[#D2D2D7]' : '',
        vertical ? 'w-[150px] flex-col items-center gap-1 p-3 text-center' : o.size === 'm' ? 'h-[92px] w-[200px] items-center gap-2.5 p-2.5' : 'h-[74px] w-[140px] items-center gap-2 p-2')}>
        <QrCode strokeWidth={1.6} className={cx('shrink-0', vertical ? 'h-[100px] w-[100px]' : o.size === 'm' ? 'h-[70px] w-[70px]' : 'h-[56px] w-[56px]')} />
        <div className="min-w-0 leading-tight">
          {brand && <div className={cx('truncate font-semibold text-[#6E6E73]', o.size === 's' ? 'text-[6px]' : 'text-[8px]')}>{brand}</div>}
          <div className={cx('font-semibold', o.size === 's' ? 'text-[10px]' : 'text-[14px]')}>PT-K7M2QX</div>
          <div className={o.size === 's' ? 'text-[7.5px]' : 'text-[10px]'}>№ {number || '______'}</div>
          {o.phone && <div className={cx('truncate', o.size === 's' ? 'text-[6.5px]' : 'text-[9px]')}>{o.phone}</div>}
          {o.warn && <div className={cx('font-semibold text-[#D71921]', o.size === 's' ? 'text-[5px]' : 'text-[7px]')}>НЕ ТРОГАТЬ · NU ATINGEȚI</div>}
        </div>
      </div>
    </div>
  );
}

export function LabelsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [info, setInfo] = useState<LabelsInfo | null>(null);
  const [o, setO] = useState<LabelOpts | null>(null);
  const [sheets, setSheets] = useState('1');
  const [custom, setCustom] = useState('');
  const [numbered, setNumbered] = useState(false);
  const [start, setStart] = useState('1');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<LabelBatch | null>(null);

  useEffect(() => {
    if (!open) return;
    setLast(null);
    api.labelsInfo().then((d) => { setInfo(d); setO(d.opts); }).catch((e: Error) => toast(e.message, 'error'));
  }, [open, toast]);

  const size = info?.sizes.find((s) => s.id === o?.size);
  const per = size?.per_sheet || 24;
  const count = custom ? Math.max(1, Math.min(240, Math.floor(Number(custom)) || 0)) : Number(sheets) * per;

  async function make() {
    if (!o) return;
    setBusy(true);
    try {
      const b = await api.labels({ ...o, count, start: numbered ? Math.max(1, Number(start) || 1) : 0 });
      haptic.success();
      setLast(b);
      setInfo((d) => (d ? { ...d, batches: [b, ...d.batches].slice(0, 12) } : d));
      openLink(b.url);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const set = (p: Partial<LabelOpts>) => setO((x) => (x ? { ...x, ...p } : x));

  return (
    <Sheet open={open} onClose={onClose} title="QR-этикетки">
      {!info || !o ? <Spinner /> : (
        <div className="space-y-5">
          <p className="-mt-3 text-[14.5px] leading-relaxed text-muted">
            Каждая этикетка — уникальный код. Наклейте на станцию и отсканируйте в выезде — она привяжется к объекту. PDF под стандартные листы наклеек A4: печатайте в масштабе 100%.
          </p>

          <LabelPreview o={o} number={numbered ? start : ''} />

          <Field label="Размер">
            <div className="space-y-2">
              {info.sizes.map((s) => (
                <button key={s.id} onClick={() => { haptic.tap(); set({ size: s.id as LabelSize }); }}
                  className={cx('flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left ring-1 ring-inset', o.size === s.id ? 'bg-accent/10 ring-accent' : 'bg-card ring-line')}>
                  <span><span className="text-[16px] font-semibold">{s.title}</span><span className="block text-[13px] text-muted">{s.hint}</span></span>
                  <span className={cx('h-5 w-5 shrink-0 rounded-full ring-2 ring-inset', o.size === s.id ? 'bg-accent ring-accent' : 'ring-line')} />
                </button>
              ))}
            </div>
          </Field>

          <Field label={`Количество · ${count} шт.`}>
            <Chips columns={2} value={custom ? '' : sheets} onChange={(v) => { setCustom(''); setSheets(v); }}
              options={SHEETS.map((n) => ({ id: String(n), label: `${n} ${sheetsWord(n)} · ${n * per}` }))} />
            <Input className="mt-2" inputMode="numeric" placeholder="Или своё число (до 240)" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))} />
          </Field>

          <Field label="Надписи">
            <div className="space-y-2">
              <Input placeholder="Название (компания)" value={o.brand} onChange={(e) => set({ brand: e.target.value })} />
              <Input placeholder="Телефон на этикетке (необязательно)" inputMode="tel" value={o.phone} onChange={(e) => set({ phone: e.target.value })} />
            </div>
          </Field>

          <div className="space-y-2">
            <Toggle label="«Не трогать · Nu atingeți»" checked={o.warn} onChange={(v) => set({ warn: v })} />
            <Toggle label="Линии реза" checked={o.lines} onChange={(v) => set({ lines: v })} />
            <Toggle label="Печатать номера станций" checked={numbered} onChange={setNumbered} />
            {numbered && <Input inputMode="numeric" placeholder="С какого номера" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ''))} />}
          </div>

          <Button onClick={make} loading={busy} disabled={count < 1} icon={<Printer size={20} strokeWidth={1.75} />}>
            Создать PDF · {count} шт.
          </Button>
          {last && (
            <Button variant="secondary" onClick={() => openLink(last.url)} icon={<FileDown size={19} strokeWidth={1.75} />}>Открыть ещё раз</Button>
          )}

          {info.batches.length > 0 && (
            <Field label="Последние партии">
              <div className="divide-y divide-line overflow-hidden rounded-2xl bg-card">
                {info.batches.map((b) => (
                  <button key={b.id} onClick={() => { haptic.tap(); openLink(b.url); }} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-fill">
                    <History size={18} strokeWidth={1.75} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium">{b.kind === 'reprint' ? 'Перепечатка' : 'Новые'} · {b.count} шт. · {info.sizes.find((s) => s.id === b.size)?.title.toLowerCase() || ''}</span>
                      <span className="block truncate text-[12.5px] text-muted">{fmtDate(b.created_at)} · {b.created_by}{b.first ? ` · с ${b.first}` : ''}</span>
                    </span>
                    <FileDown size={18} strokeWidth={1.75} className="shrink-0 text-accent-ink" />
                  </button>
                ))}
              </div>
              <div className="mt-1.5 px-1 text-[12.5px] text-muted">Партия открывается с теми же кодами — можно допечатать, если лист испортился.</div>
            </Field>
          )}
        </div>
      )}
    </Sheet>
  );
}
