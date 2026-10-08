import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, Car as CarIcon, Fuel, Gauge, Plus, Receipt, Sparkles, Trash2, Wrench, X } from 'lucide-react';
import { api } from '../api';
import { useConfig } from '../config';
import { compressImage } from '../image';
import { haptic, openLink } from '../telegram';
import type { CarCheck, CarDetail, CarDoc, CarExpense, CarFleet, CarRes, CarServiceCosts, CarSettings } from '../types';
import { CarArt } from '../components/CarArt';
import { Button, Chips, Collapse, ConfirmSheet, Field, Input, Screen, Sheet, Spinner, Toggle, cx, useToast } from '../components/ui';
import { GameButton, XpChip } from '../components/game';

/* ================================================================================================
 * «Мой авто»: пробег, до ТО, топливо, заправки с фото чека, регламент ТО,
 * фотопроверка 1–2 раза в неделю. Для администратора — «Автопарк»: все машины и проверка фото.
 * ================================================================================================ */

const km = (n: number | null | undefined) => `${Math.round(n ?? 0).toLocaleString('ru-RU')} км`;
const lei = (n: number | null | undefined) => `${Math.round(n ?? 0).toLocaleString('ru-RU')} лей`;
const dt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const ZONES: { id: 'ext' | 'int' | 'box'; label: string; hint: string }[] = [
  { id: 'ext', label: 'Снаружи', hint: 'спереди, сзади, с боков' },
  { id: 'int', label: 'Салон', hint: 'сиденья, панель, пол' },
  { id: 'box', label: 'Будка', hint: 'грузовой отсек с препаратами' },
];
const CHECK_STATUS: Record<CarCheck['status'], [string, string]> = {
  requested: ['Ждём фото', 'bg-[#FF9F0A]/15 text-[#C93400] dark:text-[#FF9F0A]'],
  checking: ['Проверяется', 'bg-fill text-muted'],
  review: ['У менеджера', 'bg-[#FF9F0A]/15 text-[#C93400] dark:text-[#FF9F0A]'],
  flagged: ['Нужно проверить', 'bg-[#FF453A]/12 text-[#D70015] dark:text-[#FF453A]'],
  ok: ['Чисто ✓', 'bg-[#34C759]/15 text-[#1E7A35] dark:text-[#30D158]'],
  rejected: ['Не засчитано', 'bg-[#FF453A]/12 text-[#D70015] dark:text-[#FF453A]'],
  missed: ['Пропущено', 'bg-[#FF453A]/12 text-[#D70015] dark:text-[#FF453A]'],
};

function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'orange' | 'red' | 'green' }) {
  return (
    <div className="rounded-[20px] bg-card p-3.5">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className={cx('mt-1.5 font-dot text-[24px] leading-none', tone === 'red' && 'text-[#D70015] dark:text-[#FF453A]', tone === 'orange' && 'text-[#C93400] dark:text-[#FF9F0A]', tone === 'green' && 'text-[#1E7A35] dark:text-[#30D158]')}>{value}</div>
      {sub && <div className="mt-1 text-[12px] leading-snug text-muted">{sub}</div>}
    </div>
  );
}
function Block({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-4 rounded-[22px] bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2"><span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{title}</span>{right}</div>
      {children}
    </div>
  );
}

/* ---------------- сотрудник ---------------- */

export function CarScreen() {
  const toast = useToast();
  const [d, setD] = useState<CarRes | null>(null);
  const [sheet, setSheet] = useState<'' | 'car' | 'fuel' | 'km' | 'service' | 'check' | 'expense'>('');
  const [doc, setDoc] = useState<CarDoc | 'new' | null>(null);
  const [flash, setFlash] = useState(0);
  const [delConfirm, setDelConfirm] = useState(false);
  const load = useCallback(() => api.car().then(setD).catch((e: Error) => toast(e.message, 'error')), [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!flash) return; const t = window.setTimeout(() => setFlash(0), 2500); return () => window.clearTimeout(t); }, [flash]);
  useEffect(() => { if (d?.pending && new URLSearchParams(window.location.search).get('car') === 'check') setSheet('check'); }, [d?.pending]);
  const done = (r: CarRes & { xp?: number }) => { setD(r); setSheet(''); haptic.success(); if (r.xp) setFlash(r.xp); };

  if (!d) return <Screen><Spinner /></Screen>;
  const head = (
    <>
      <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Служебная машина</div>
      <h1 className="mb-4 text-[34px] font-extrabold uppercase leading-none tracking-tight">Мой авто</h1>
    </>
  );
  if (!d.on) return <Screen>{head}<div className="rounded-[22px] border-2 border-dashed border-line p-6 text-center text-muted">Раздел выключен администратором.</div></Screen>;
  if (!d.car) {
    return (
      <Screen>
        {head}
        <div className="rounded-[22px] bg-card p-5 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-accent-ink"><CarIcon size={30} strokeWidth={1.6} /></div>
          <div className="text-[18px] font-bold">Добавьте свою машину</div>
          <div className="mt-1 text-[14px] text-muted">Марка, год и пробег — и приложение подскажет, когда ТО, посчитает расходы на топливо и даст опыт за регулярные записи.</div>
          <div className="mt-4"><GameButton onClick={() => setSheet('car')}>Добавить авто · +30 XP</GameButton></div>
        </div>
        <CarSheet open={sheet === 'car'} d={d} onClose={() => setSheet('')} onDone={done} />
      </Screen>
    );
  }
  const c = d.car; const s = d.stats!; const to = d.to;
  return (
    <Screen>
      {head}
      {d.pending && (
        <button onClick={() => setSheet('check')} className="mb-4 w-full rounded-[22px] bg-[#FF9F0A]/15 p-4 text-left ring-2 ring-inset ring-[#FF9F0A]/60 active:opacity-70">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#FF9F0A] text-black"><Camera size={21} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-extrabold">Фотопроверка авто сегодня</div>
              <div className="text-[13px] text-muted">до {new Date(d.pending.due_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · снаружи {d.photos_need.ext[0]}–{d.photos_need.ext[1]}, салон {d.photos_need.int[0]}–{d.photos_need.int[1]}, будка {d.photos_need.box[0]}–{d.photos_need.box[1]}</div>
            </div>
          </div>
        </button>
      )}

      <DocsAlert docs={d.docs || []} onOpen={(x) => setDoc(x)} />
      <div className="overflow-hidden rounded-[22px] bg-card">
        <CarArt body={c.body} title={`${c.make} ${c.model}`} plate={c.plate} className="block aspect-[16/9] w-full" />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[19px] font-extrabold">{c.make} {c.model}</div>
            <div className="text-[13px] text-muted">{[c.year, c.plate, d.fuels[c.fuel]].filter(Boolean).join(' · ')}</div>
          </div>
          <button onClick={() => setSheet('car')} className="shrink-0 text-[13px] font-semibold text-accent-ink">Изменить</button>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">Пробег</div>
            <div className="font-dot text-[40px] leading-none">{Math.round(c.mileage).toLocaleString('ru-RU')}</div>
            <div className="mt-1 text-[12px] text-muted">обновлён {dt(c.mileage_at)}</div>
          </div>
          <button onClick={() => setSheet('km')} className="rounded-xl bg-fill px-3 py-2 text-[13.5px] font-bold">Новый пробег</button>
        </div>
      </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <Tile label="До ТО (масло)" value={to ? (to.left < 0 ? `−${km(-to.left)}` : km(to.left)) : '—'} tone={to?.state === 'overdue' ? 'red' : to?.state === 'soon' ? 'orange' : 'green'} sub={to ? `на ${km(to.next_km)} · каждые ${km(to.interval)}` : undefined} />
        <Tile label={`Топливо · ${s.month_label || 'месяц'}`} value={lei(s.fuel_month)}
          sub={`${s.refuels_month} заправ.${s.liters_month ? ` · ${String(s.liters_month).replace('.', ',')} л` : ''}${s.fuel_prev_month ? ` · ${s.prev_month_label}: ${lei(s.fuel_prev_month)}` : ''}`} />
        <Tile label={`Пробег · ${s.month_label || 'месяц'}`} value={km(s.km_month)} sub={s.cost_km != null ? `${String(s.cost_km).replace('.', ',')} лей / км` : 'после заправок будет цена км'} />
        <Tile label="Расход" value={s.per100 != null ? `${String(s.per100).replace('.', ',')} л` : '—'} sub={s.per100 != null ? 'на 100 км' : 'укажите литры в 2+ заправках'} />
      </div>
      <SpendCard d={d} />

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <GameButton icon={<Fuel size={19} />} onClick={() => setSheet('fuel')}>Заправка</GameButton>
        <GameButton tone="ghost" icon={<Wrench size={18} />} onClick={() => setSheet('service')}>Сделал ТО</GameButton>
      </div>
      <GameButton className="mt-2.5" tone="yellow" small icon={<Receipt size={17} />} onClick={() => setSheet('expense')}>Расход: мойка, AdBlue, парковка…</GameButton>
      <div className="mt-1.5 text-center text-[12px] text-muted">Заправка с чеком +10 XP · первая за неделю ещё +20 · пробег +5 · ТО +10 · фотопроверка до +30</div>

      {!!d.tips?.length && (
        <Block title="Что сделать по пробегу" right={d.ai ? <span className="flex items-center gap-1 text-[11px] font-bold text-accent-ink"><Sparkles size={13} />ИИ</span> : undefined}>
          <div className="flex flex-col gap-3">
            {d.tips.map((t, i) => (
              <div key={i} className="flex gap-3">
                <span className={cx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', t.ai ? 'bg-[#AF52DE]/15 text-[#8E3BB8] dark:text-[#D08CF5]' : 'bg-accent/15 text-accent-ink')}>{t.ai ? <Sparkles size={16} /> : <Wrench size={16} />}</span>
                <div className="min-w-0"><div className="text-[14.5px] font-semibold leading-snug">{t.title}</div><div className="text-[13.5px] leading-snug text-muted">{t.text}</div></div>
              </div>
            ))}
          </div>
        </Block>
      )}

      <Block title="Страховки и документы" right={<button onClick={() => { haptic.tap(); setDoc('new'); }} className="flex items-center gap-1 text-[13px] font-semibold text-accent-ink"><Plus size={15} />Добавить</button>}>
        <DocsList docs={d.docs || []} onOpen={(x) => setDoc(x)} />
      </Block>

      <Block title="Регламент ТО">
        <ServiceList service={d.service || []} />
      </Block>

      {d.service_costs && <ServiceCostsCard c={d.service_costs} />}

      <Block title="Заправки" right={<span className="text-[12px] text-muted">всего {lei(s.fuel_total)}</span>}>
        {!d.fuel?.length ? <div className="text-[14px] text-muted">Пока нет. Каждую заправку — с фото чека.</div> : (
          <div className="flex flex-col divide-y divide-dashed divide-line">
            {d.fuel.map((f) => (
              <div key={f.id} className="flex items-center gap-3 py-2">
                {f.photo ? <button onClick={() => openLink(f.photo!)} className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-fill"><img src={f.photo} alt="чек" className="h-full w-full object-cover" /></button> : <span className="h-11 w-11 rounded-lg bg-fill" />}
                <div className="min-w-0 flex-1"><div className="text-[14.5px] font-semibold">{f.amount != null ? lei(f.amount) : 'сумма —'}{f.liters ? ` · ${String(f.liters).replace('.', ',')} л` : ''}</div><div className="text-[12px] text-muted">{dt(f.created_at)} · {km(f.km)}{f.ai_note ? ` · ${f.ai_note}` : ''}</div></div>
              </div>
            ))}
          </div>
        )}
      </Block>

      <Block title="Другие расходы" right={<span className="text-[12px] text-muted">{s.month_label}: {lei(s.expenses_month)}</span>}>
        <ExpenseList d={d} items={d.expenses || []} onChanged={setD} />
      </Block>

      {!!d.checks?.length && (
        <Block title="Фотопроверки">
          <div className="flex flex-col gap-2">
            {d.checks.map((k) => (
              <div key={k.id} className="flex items-center gap-3 rounded-2xl bg-fill px-3 py-2.5">
                <div className="min-w-0 flex-1"><div className="text-[14px] font-semibold">{new Date(k.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div>{k.ai_note && <div className="line-clamp-2 text-[12px] text-muted">{k.ai_note}</div>}</div>
                <span className={cx('shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold', CHECK_STATUS[k.status][1])}>{CHECK_STATUS[k.status][0]}{k.points ? ` +${k.points} б` : ''}</span>
              </div>
            ))}
          </div>
        </Block>
      )}

      {d.delete_request?.status === 'pending' ? (
        <div className="mt-5 rounded-[20px] bg-[#FF9500]/12 px-4 py-3.5 text-[13.5px] text-[#C93400] dark:text-[#FF9F0A]">Запрос на удаление авто отправлен — ждите решения администратора.</div>
      ) : (
        <button onClick={() => setDelConfirm(true)} className="mt-5 w-full text-center text-[13.5px] font-semibold text-[#D70015] dark:text-[#FF453A]">Удалить авто</button>
      )}

      {flash > 0 && <div className="pointer-events-none fixed inset-x-0 top-24 z-50 flex justify-center"><XpChip xp={flash} className="scale-150 bg-black/80" /></div>}
      <CarSheet open={sheet === 'car'} d={d} onClose={() => setSheet('')} onDone={done} />
      <FuelSheet open={sheet === 'fuel'} d={d} onClose={() => setSheet('')} onDone={done} />
      <KmSheet open={sheet === 'km'} d={d} onClose={() => setSheet('')} onDone={done} />
      <ServiceSheet open={sheet === 'service'} d={d} onClose={() => setSheet('')} onDone={done} />
      <ExpenseSheet open={sheet === 'expense'} d={d} onClose={() => setSheet('')} onDone={done} />
      {doc && <DocSheet d={d} doc={doc === 'new' ? null : doc} onClose={() => setDoc(null)} onDone={(r) => { setD(r); setDoc(null); haptic.success(); }} />}
      {d.pending && <CheckSheet open={sheet === 'check'} d={d} onClose={() => setSheet('')} onDone={(xp) => { setSheet(''); haptic.success(); setFlash(xp); toast('Фото отправлены менеджеру на проверку', 'ok'); load(); }} />}
      {delConfirm && (
        <ConfirmSheet title="Удалить авто?" confirmLabel="Отправить запрос" danger={false}
          text="Машину и её данные удалят после подтверждения администратором или менеджером — заявка уйдёт им в бот."
          onClose={() => setDelConfirm(false)}
          onConfirm={async () => { try { await api.carDeleteRequest(); haptic.success(); toast('Запрос отправлен — ждите решения', 'ok'); setDelConfirm(false); load(); } catch (e) { toast((e as Error).message, 'error'); } }} />
      )}
    </Screen>
  );
}

type SheetP = { open: boolean; d: CarRes; onClose: () => void; onDone: (r: CarRes & { xp?: number }) => void };

function CarSheet({ open, d, onClose, onDone }: SheetP) {
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const c = d.car;
    setF({ make: c?.make || '', model: c?.model || '', year: c?.year ? String(c.year) : '', plate: c?.plate || '', fuel: c?.fuel || 'petrol', mileage: c ? String(c.mileage) : '', service_interval: String(c?.service_interval || 10000), body: c && !c.body_auto ? c.body || '' : '' });
  }, [open, d.car]);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    setBusy(true);
    try { onDone(await api.saveCar(f)); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onClose={onClose} title={d.car ? 'Моя машина' : 'Добавить авто'}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Марка"><Input value={f.make || ''} onChange={(e) => set('make', e.target.value)} placeholder="Renault" /></Field>
          <Field label="Модель"><Input value={f.model || ''} onChange={(e) => set('model', e.target.value)} placeholder="Kangoo" /></Field>
          <Field label="Год"><Input inputMode="numeric" value={f.year || ''} onChange={(e) => set('year', e.target.value.replace(/\D/g, ''))} placeholder="2017" /></Field>
          <Field label="Номер"><Input value={f.plate || ''} onChange={(e) => set('plate', e.target.value)} placeholder="ABC 123" /></Field>
        </div>
        <Field label="Пробег, км"><Input inputMode="numeric" value={f.mileage || ''} onChange={(e) => set('mileage', e.target.value.replace(/\D/g, ''))} placeholder="184 500" /></Field>
        <Field label="Топливо"><Chips options={Object.entries(d.fuels).map(([id, label]) => ({ id, label }))} value={f.fuel || 'petrol'} onChange={(v) => set('fuel', v)} columns={3} /></Field>
        {d.bodies && (
          <Field label="Кузов (для картинки)">
            <Chips options={[{ id: '', label: 'Авто по модели' }, ...Object.entries(d.bodies).map(([id, label]) => ({ id, label }))]} value={f.body || ''} onChange={(v) => set('body', v)} columns={2} />
          </Field>
        )}
        <Field label="Замена масла каждые, км"><Chips options={['7000', '10000', '15000'].map((x) => ({ id: x, label: `${Number(x).toLocaleString('ru-RU')}` }))} value={f.service_interval || '10000'} onChange={(v) => set('service_interval', v)} columns={3} /></Field>
        <Button onClick={save} loading={busy}>Сохранить</Button>
      </div>
    </Sheet>
  );
}

function PhotoPick({ label, onPick, preview, busy }: { label: string; onPick: (f: File) => void; preview?: string; busy?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
      <button onClick={() => ref.current?.click()} className="flex h-40 w-full items-center justify-center overflow-hidden rounded-2xl bg-fill text-muted ring-1 ring-inset ring-line">
        {busy ? <Spinner /> : preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <span className="flex flex-col items-center gap-1.5 text-[14px]"><Camera size={28} strokeWidth={1.5} />{label}</span>}
      </button>
    </>
  );
}

function FuelSheet({ open, d, onClose, onDone }: SheetP) {
  const toast = useToast();
  const [photo, setPhoto] = useState('');
  const [kmV, setKm] = useState('');
  const [amount, setAmount] = useState('');
  const [liters, setLiters] = useState('');
  const [busy, setBusy] = useState(false);
  const [pb, setPb] = useState(false);
  useEffect(() => { if (open) { setPhoto(''); setKm(''); setAmount(''); setLiters(''); } }, [open]);
  async function save() {
    setBusy(true);
    try { onDone(await api.carFuel({ km: kmV, amount, liters, photo })); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Заправка">
      <div className="flex flex-col gap-3">
        <PhotoPick label="Сфотографировать чек" preview={photo} busy={pb} onPick={async (f) => { setPb(true); try { setPhoto(await compressImage(f, 1400, 0.8)); } catch (e) { toast((e as Error).message, 'error'); } finally { setPb(false); } }} />
        <Field label={`Пробег сейчас, км (было ${km(d.car?.mileage)})`}><Input inputMode="numeric" value={kmV} onChange={(e) => setKm(e.target.value.replace(/\D/g, ''))} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Сумма, лей"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="например, 750" /></Field>
          <Field label="Литров"><Input inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value)} placeholder="например, 30" /></Field>
        </div>
        <Button onClick={save} loading={busy} disabled={!photo || !kmV || !amount || !liters}>Сохранить · +10 XP</Button>
      </div>
    </Sheet>
  );
}

function KmSheet({ open, d, onClose, onDone }: SheetP) {
  const toast = useToast();
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setV(''); }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Новый пробег">
      <div className="flex flex-col gap-3">
        <Field label={`Сейчас на одометре, км (было ${km(d.car?.mileage)})`}><Input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} autoFocus /></Field>
        <Button loading={busy} disabled={!v} onClick={async () => { setBusy(true); try { onDone(await api.carMileage(v)); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); } }}>Сохранить · +5 XP</Button>
      </div>
    </Sheet>
  );
}

function ServiceSheet({ open, d, onClose, onDone }: SheetP) {
  const toast = useToast();
  const [item, setItem] = useState('oil');
  const [v, setV] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setItem(d.service?.[0]?.id || 'oil'); setV(String(d.car?.mileage ?? '')); setAmount(''); } }, [open, d]);
  return (
    <Sheet open={open} onClose={onClose} title="Сделал ТО">
      <div className="flex flex-col gap-3">
        <Field label="Что сделано"><Chips options={(d.service || []).map((x) => ({ id: x.id, label: x.label }))} value={item} onChange={setItem} columns={2} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="На каком пробеге, км"><Input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Стоимость, лей"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="необязательно" /></Field>
        </div>
        <Button loading={busy} onClick={async () => { setBusy(true); try { onDone(await api.carService({ item, km: v, amount })); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); } }}>Отметить · +10 XP</Button>
      </div>
    </Sheet>
  );
}

const DOC_TONE: Record<CarDoc['state'], [string, string]> = {
  ok: ['bg-[#34C759]/15 text-[#1E7A35] dark:text-[#30D158]', '#34C759'],
  soon: ['bg-[#FF9F0A]/15 text-[#C93400] dark:text-[#FF9F0A]', '#FF9F0A'],
  urgent: ['bg-[#FF453A]/15 text-[#D70015] dark:text-[#FF453A]', '#FF453A'],
  expired: ['bg-[#FF453A] text-white', '#FF453A'],
};
const daysRu = (n: number) => { const a = Math.abs(n); const w = a % 10 === 1 && a % 100 !== 11 ? 'день' : [2, 3, 4].includes(a % 10) && ![12, 13, 14].includes(a % 100) ? 'дня' : 'дней'; return `${a} ${w}`; };
const docLeft = (x: CarDoc) => (x.days_left < 0 ? `истекло ${daysRu(x.days_left)} назад` : x.days_left === 0 ? 'истекает сегодня' : `ещё ${daysRu(x.days_left)}`);
const ddmm = (d: string | null) => (d ? d.split('-').reverse().join('.') : '');

/** Баннер: страховка/документ истёк или истекает в ближайшие 7 дней. */
function DocsAlert({ docs, onOpen }: { docs: CarDoc[]; onOpen?: (x: CarDoc) => void }) {
  const bad = docs.filter((x) => x.state === 'urgent' || x.state === 'expired');
  if (!bad.length) return null;
  return (
    <div className="mb-3 flex flex-col gap-2">
      {bad.map((x) => (
        <button key={x.id} onClick={() => onOpen?.(x)} className="flex items-center gap-3 rounded-[20px] bg-[#FF453A] px-4 py-3 text-left text-white shadow-[0_4px_0_#8A1C15] active:translate-y-[2px]">
          <span className="text-[24px]">{x.icon}</span>
          <div className="min-w-0 flex-1"><div className="text-[15px] font-extrabold">{x.label}: {docLeft(x)}</div><div className="text-[12.5px] text-white/85">до {ddmm(x.expires)} — продлите и обновите срок</div></div>
        </button>
      ))}
    </div>
  );
}

function DocsList({ docs, onOpen }: { docs: CarDoc[]; onOpen?: (x: CarDoc) => void }) {
  if (!docs.length) return <div className="text-[14px] text-muted">Добавьте RCA, CASCO, Carte Verde, техосмотр — приложение напомнит за 30, 7 и 1 день до окончания.</div>;
  return (
    <div className="flex flex-col gap-2">
      {docs.map((x) => {
        const total = x.starts ? Math.max(1, (Date.parse(x.expires) - Date.parse(x.starts)) / 86400000) : 365;
        const pct = Math.max(0, Math.min(100, (x.days_left / total) * 100));
        return (
          <button key={x.id} onClick={() => onOpen?.(x)} className="rounded-2xl bg-fill p-3 text-left active:opacity-80">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card text-[20px]">{x.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-semibold">{x.label}{x.company ? ` · ${x.company}` : ''}</div>
                <div className="text-[12px] text-muted">до {ddmm(x.expires)}{x.number ? ` · № ${x.number}` : ''}{x.amount ? ` · ${lei(x.amount)}` : ''}</div>
              </div>
              <span className={cx('shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold', DOC_TONE[x.state][0])}>{docLeft(x)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: DOC_TONE[x.state][1] }} /></div>
          </button>
        );
      })}
    </div>
  );
}

function DocSheet({ d, doc, tg, onClose, onDone }: { d: CarRes; doc: CarDoc | null; tg?: string; onClose: () => void; onDone: (r: CarRes) => void }) {
  const toast = useToast();
  const kinds = d.doc_kinds || {};
  const [f, setF] = useState<Record<string, string>>({ kind: doc?.kind || 'rca', number: doc?.number || '', company: doc?.company || '', starts: doc?.starts || '', expires: doc?.expires || '', amount: doc?.amount != null ? String(doc.amount) : '', note: doc?.note || '' });
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  // «на год» — от даты начала (или сегодня)
  const plusYear = () => { const base = f.starts || new Date().toISOString().slice(0, 10); const dt0 = new Date(`${base}T00:00:00Z`); dt0.setUTCFullYear(dt0.getUTCFullYear() + 1); dt0.setUTCDate(dt0.getUTCDate() - 1); set('expires', dt0.toISOString().slice(0, 10)); if (!f.starts) set('starts', base); };
  return (
    <Sheet open onClose={onClose} title={doc ? 'Документ' : 'Страховка / документ'}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(kinds).map(([id, x]) => (
            <button key={id} onClick={() => { haptic.tap(); set('kind', id); }} className={cx('flex flex-col items-center gap-1 rounded-2xl px-1.5 py-2.5 text-center text-[12px] font-semibold leading-tight', f.kind === id ? 'bg-ink text-card' : 'bg-fill')}>
              <span className="text-[20px]">{x.icon}</span>{x.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Действует с"><Input type="date" value={f.starts} onChange={(e) => set('starts', e.target.value)} /></Field>
          <Field label="Действует до"><Input type="date" value={f.expires} onChange={(e) => set('expires', e.target.value)} /></Field>
        </div>
        <button onClick={plusYear} className="-mt-1 self-start text-[13px] font-semibold text-accent-ink">+ на год</button>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Номер полиса"><Input value={f.number} onChange={(e) => set('number', e.target.value)} placeholder="необязательно" /></Field>
          <Field label="Стоимость, лей"><Input inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="необязательно" /></Field>
        </div>
        <Field label="Страховая / где делали"><Input value={f.company} onChange={(e) => set('company', e.target.value)} placeholder="например, Moldasig" /></Field>
        {f.kind === 'other' && <Field label="Что за документ"><Input value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>}
        <Button loading={busy} disabled={!f.expires} onClick={async () => { setBusy(true); try { onDone(await api.carDocSave({ ...f, id: doc?.id }, tg)); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); } }}>Сохранить</Button>
        {doc && (del
          ? <Button variant="danger" onClick={async () => { try { onDone(await api.carDocDelete(doc.id)); } catch (e) { toast((e as Error).message, 'error'); } }}>Точно удалить</Button>
          : <Button variant="plain" onClick={() => setDel(true)}><span className="text-[#D70015] dark:text-[#FF453A]">Удалить документ</span></Button>)}
      </div>
    </Sheet>
  );
}

function ServiceList({ service }: { service: NonNullable<CarRes['service']> }) {
  return (
    <div className="flex flex-col divide-y divide-dashed divide-line">
      {service.map((x) => {
        const done = Math.max(0, Math.min(100, ((x.interval - Math.max(0, x.left)) / x.interval) * 100));
        const color = x.state === 'overdue' ? '#FF453A' : x.state === 'soon' ? '#FF9F0A' : '#34C759';
        return (
          <div key={x.id} className="py-2">
            <div className="flex items-center gap-3">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
              <div className="min-w-0 flex-1 text-[14px]">{x.label}<div className="text-[11.5px] text-muted">каждые {km(x.interval)}{x.last_km != null ? ` · делали на ${km(x.last_km)}` : ' · ещё не отмечали'}</div></div>
              <div className={cx('shrink-0 text-right text-[13px] font-semibold', x.state === 'overdue' && 'text-[#D70015] dark:text-[#FF453A]')}>{x.left < 0 ? `просрочено ${km(-x.left)}` : `через ${km(x.left)}`}<div className="text-[11px] font-normal text-muted">на {km(x.next_km)}</div></div>
            </div>
            <div className="ml-5 mt-1.5 h-1 overflow-hidden rounded-full bg-fill"><div className="h-full rounded-full" style={{ width: `${x.left < 0 ? 100 : done}%`, background: color }} /></div>
          </div>
        );
      })}
    </div>
  );
}

function ServiceCostsCard({ c }: { c: CarServiceCosts }) {
  if (!c.count && !c.docs_year) return null;
  const max = Math.max(1, ...c.by_item.map((x) => x.amount));
  return (
    <Block title="Затраты на ТО и страховки">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-fill p-2.5"><div className="text-[11px] text-muted">ТО за месяц</div><div className="font-dot text-[18px] leading-tight">{lei(c.month)}</div></div>
        <div className="rounded-2xl bg-fill p-2.5"><div className="text-[11px] text-muted">ТО за год</div><div className="font-dot text-[18px] leading-tight">{lei(c.year)}</div></div>
        <div className="rounded-2xl bg-fill p-2.5"><div className="text-[11px] text-muted">Страховки за год</div><div className="font-dot text-[18px] leading-tight">{lei(c.docs_year)}</div></div>
      </div>
      {c.by_item.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {c.by_item.slice(0, 8).map((x) => (
            <div key={x.id} className="text-[12.5px]">
              <div className="flex justify-between gap-2"><span className="truncate">{x.label}</span><b className="shrink-0">{lei(x.amount)}</b></div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-fill"><div className="h-full rounded-full bg-[#34C759]" style={{ width: `${(x.amount / max) * 100}%` }} /></div>
            </div>
          ))}
          <div className="mt-1 text-[11.5px] text-muted">Всего на ТО за всё время: {lei(c.total)} · записей: {c.count}</div>
        </div>
      )}
    </Block>
  );
}

const EXP_COLORS: Record<string, string> = { wash: '#2DA8E6', adblue: '#0A84FF', parking: '#AF52DE', repair: '#FF9F0A', other: '#8E8E93' };

/** Все траты на авто за месяц: топливо + расходы + ТО — полоской по долям. */
function SpendCard({ d }: { d: CarRes }) {
  const s = d.stats!;
  const kinds = d.expense_kinds || {};
  const parts = [
    { label: '⛽ Топливо', v: s.fuel_month, c: '#F58220' },
    ...Object.entries(s.expenses_by_kind || {}).map(([k, v]) => ({ label: `${kinds[k]?.icon || '🧾'} ${kinds[k]?.label || k}`, v, c: EXP_COLORS[k] || '#8E8E93' })),
    ...(s.service_month ? [{ label: '🔧 ТО', v: s.service_month, c: '#34C759' }] : []),
    ...(s.docs_month ? [{ label: '🛡 Страховки', v: s.docs_month, c: '#FF2E88' }] : []),
  ].filter((p) => p.v > 0);
  const total = s.spend_month ?? parts.reduce((a, p) => a + p.v, 0);
  if (!total) return null;
  return (
    <div className="mt-2.5 rounded-[20px] bg-card p-3.5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">Все траты · {s.month_label}</span>
        <span className="font-dot text-[22px] leading-none">{lei(total)}</span>
      </div>
      <div className="mt-2.5 flex h-3 overflow-hidden rounded-full bg-fill">
        {parts.map((p) => <div key={p.label} style={{ width: `${(p.v / total) * 100}%`, background: p.c }} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
        {parts.map((p) => <span key={p.label} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: p.c }} />{p.label} <b>{lei(p.v)}</b></span>)}
      </div>
    </div>
  );
}

function ExpenseList({ d, items, onChanged, admin }: { d: CarRes; items: CarExpense[]; onChanged?: (r: CarRes) => void; admin?: boolean }) {
  const toast = useToast();
  const [del, setDel] = useState('');
  const kinds = d.expense_kinds || {};
  if (!items.length) return <div className="text-[14px] text-muted">Пока нет. Мойка, AdBlue, парковка, ремонт — всё сюда, чтобы видеть полные расходы на машину.</div>;
  return (
    <div className="flex flex-col divide-y divide-dashed divide-line">
      {items.map((e) => {
        const fresh = admin || Date.now() - new Date(e.created_at).getTime() < 86400000;
        return (
          <div key={e.id} className="flex items-center gap-3 py-2">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[19px]" style={{ background: `${EXP_COLORS[e.kind] || '#8E8E93'}22` }}>{kinds[e.kind]?.icon || '🧾'}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-semibold">{kinds[e.kind]?.label || e.kind} · {lei(e.amount)}{e.liters ? ` · ${String(e.liters).replace('.', ',')} л` : ''}</div>
              <div className="truncate text-[12px] text-muted">{dt(e.created_at)}{e.km ? ` · ${km(e.km)}` : ''}{e.note ? ` · ${e.note}` : ''}</div>
            </div>
            {fresh && onChanged && (
              del === e.id
                ? <button onClick={async () => { try { onChanged(await api.carExpenseDelete(e.id)); haptic.success(); setDel(''); } catch (err) { toast((err as Error).message, 'error'); } }} className="shrink-0 rounded-full bg-[#FF3B30]/12 px-3 py-1 text-[13px] font-medium text-[#D70015] dark:text-[#FF453A]">Удалить?</button>
                : <button onClick={() => setDel(e.id)} aria-label="Удалить" className="shrink-0 p-1 text-muted"><Trash2 size={16} /></button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ExpenseSheet({ open, d, onClose, onDone }: SheetP) {
  const toast = useToast();
  const kinds = d.expense_kinds || {};
  const [kind, setKind] = useState('wash');
  const [amount, setAmount] = useState('');
  const [liters, setLiters] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setKind('wash'); setAmount(''); setLiters(''); setNote(''); } }, [open]);
  const k = kinds[kind];
  return (
    <Sheet open={open} onClose={onClose} title="Расход на авто">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(kinds).map(([id, x]) => (
            <button key={id} onClick={() => { haptic.tap(); setKind(id); }}
              className={cx('flex flex-col items-center gap-1 rounded-2xl px-2 py-3 text-[13px] font-semibold transition', kind === id ? 'text-white' : 'bg-fill')}
              style={kind === id ? { background: EXP_COLORS[id] || '#8E8E93' } : undefined}>
              <span className="text-[22px]">{x.icon}</span>{x.label}
            </button>
          ))}
        </div>
        <div className={cx('grid gap-2', k?.liters ? 'grid-cols-2' : 'grid-cols-1')}>
          <Field label="Сумма, лей"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="например, 150" autoFocus /></Field>
          {k?.liters && <Field label="Литров"><Input inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value)} placeholder="например, 10" /></Field>}
        </div>
        <Field label={kind === 'other' ? 'На что потрачено' : 'Комментарий (необязательно)'}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'repair' ? 'например, лампа фары' : kind === 'parking' ? 'например, платная стоянка' : ''} />
        </Field>
        <Button loading={busy} disabled={!amount || (kind === 'other' && note.trim().length < 2)}
          onClick={async () => { setBusy(true); try { onDone(await api.carExpense({ kind, amount, liters, note })); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); } }}>
          Сохранить
        </Button>
      </div>
    </Sheet>
  );
}

function CheckSheet({ open, d, onClose, onDone }: { open: boolean; d: CarRes; onClose: () => void; onDone: (xp: number) => void }) {
  const toast = useToast();
  const [ph, setPh] = useState<Record<'ext' | 'int' | 'box', string[]>>({ ext: [], int: [], box: [] });
  const [busy, setBusy] = useState(false);
  const [pb, setPb] = useState('');
  const refs = { ext: useRef<HTMLInputElement>(null), int: useRef<HTMLInputElement>(null), box: useRef<HTMLInputElement>(null) };
  const need = d.photos_need;
  const ready = ZONES.every((z) => ph[z.id].length >= need[z.id][0]);
  async function add(z: 'ext' | 'int' | 'box', files: FileList | null) {
    if (!files?.length) return;
    setPb(z);
    try {
      const room = need[z][1] - ph[z].length;
      const list: string[] = [];
      for (const f of Array.from(files).slice(0, room)) list.push(await compressImage(f, 1024, 0.72));
      setPh((x) => ({ ...x, [z]: [...x[z], ...list] }));
    } catch (e) { toast((e as Error).message, 'error'); } finally { setPb(''); }
  }
  async function send() {
    setBusy(true);
    try { const r = await api.carCheckSubmit(d.pending!.id, ph); onDone(r.xp); setPh({ ext: [], int: [], box: [] }); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Фотопроверка авто">
      <div className="flex flex-col gap-4">
        {ZONES.map((z) => (
          <div key={z.id}>
            <div className="mb-2 flex items-baseline justify-between"><span className="text-[15px] font-bold">{z.label} <span className="text-[12.5px] font-normal text-muted">· {z.hint}</span></span><span className={cx('text-[13px] font-bold', ph[z.id].length >= need[z.id][0] ? 'text-[#1E7A35] dark:text-[#30D158]' : 'text-muted')}>{ph[z.id].length}/{need[z.id][0]}–{need[z.id][1]}</span></div>
            <input ref={refs[z.id]} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={(e) => { add(z.id, e.target.files); e.target.value = ''; }} />
            <div className="grid grid-cols-4 gap-2">
              {ph[z.id].map((src, i) => (
                <div key={i} className="relative aspect-square overflow-hidden rounded-xl bg-fill">
                  <img src={src} alt="" className="h-full w-full object-cover" />
                  <button onClick={() => setPh((x) => ({ ...x, [z.id]: x[z.id].filter((_, j) => j !== i) }))} className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"><X size={12} /></button>
                </div>
              ))}
              {ph[z.id].length < need[z.id][1] && (
                <button onClick={() => refs[z.id].current?.click()} className="flex aspect-square items-center justify-center rounded-xl bg-fill text-muted ring-1 ring-inset ring-line">{pb === z.id ? <Spinner /> : <Camera size={22} />}</button>
              )}
            </div>
          </div>
        ))}
        <div className="text-[12.5px] text-muted">Фото проверит менеджер или администратор: чистая машина — до +3 балла KPI.</div>
        <GameButton loading={busy} disabled={!ready} onClick={send}>Отправить фото</GameButton>
      </div>
    </Sheet>
  );
}

/* ---------------- администратор: «Автопарк» ---------------- */

export function CarsPanel() {
  const toast = useToast();
  const cfg = useConfig();
  const canSettings = Boolean(cfg.user.isOwner) || (cfg.user.perms || []).includes('kpi');
  const [d, setD] = useState<CarFleet | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => api.adminCars().then(setD).catch((e: Error) => toast(e.message, 'error')), [toast]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Spinner />;
  return (
    <>
      {d.delete_requests.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Запросы на удаление авто · {d.delete_requests.length}</div>
          <div className="flex flex-col gap-2">
            {d.delete_requests.map((r) => (
              <div key={r.id} className="rounded-[20px] bg-card p-4">
                <div className="text-[15px] font-semibold">{r.name}</div>
                <div className="text-[13px] text-muted">{r.label || 'без данных'}</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="danger" className="h-10 text-[14px]" onClick={async () => { try { await api.decideCarDelete(r.id, true); haptic.success(); load(); } catch (e) { toast((e as Error).message, 'error'); } }}>Удалить</Button>
                  <Button variant="secondary" className="h-10 text-[14px]" onClick={async () => { try { await api.decideCarDelete(r.id, false); haptic.success(); load(); } catch (e) { toast((e as Error).message, 'error'); } }}>Оставить</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {d.queue.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Проверить фото · {d.queue.length}</div>
          <div className="grid gap-3 md:grid-cols-2">{d.queue.map((q) => <ReviewCard key={q.id} q={q} settings={d.settings} onDone={load} />)}</div>
        </div>
      )}
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Машины сотрудников</div>
      <div className="grid gap-2.5 md:grid-cols-2">
        {d.items.map((i) => (
          <button key={i.tg_id} disabled={!i.car} onClick={() => setOpen(i.tg_id)} className="overflow-hidden rounded-[20px] bg-card text-left active:opacity-70 disabled:active:opacity-100">
            {i.car && <CarArt body={i.body} plate={i.plate} className="block aspect-[16/7] w-full" />}
            <div className="p-4">
            {i.docs_alert && (
              <div className={cx('mb-2 inline-flex rounded-full px-2.5 py-1 text-[11.5px] font-bold', DOC_TONE[i.docs_alert.state as CarDoc['state']]?.[0] || 'bg-fill')}>
                🛡 {i.docs_alert.label}: {i.docs_alert.days_left < 0 ? 'истекло' : i.docs_alert.days_left === 0 ? 'сегодня' : `${daysRu(i.docs_alert.days_left)}`}{i.docs_alert.count > 1 ? ` · ещё ${i.docs_alert.count - 1}` : ''}
              </div>
            )}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="truncate text-[16px] font-semibold">{i.name}</div><div className="text-[13px] text-muted">{i.car ? [i.car, i.year, i.plate].filter(Boolean).join(' · ') : 'машина не добавлена'}</div></div>
              {i.last_check && <span className={cx('shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold', CHECK_STATUS[i.last_check.status as CarCheck['status']]?.[1] || 'bg-fill')}>{CHECK_STATUS[i.last_check.status as CarCheck['status']]?.[0] || i.last_check.status}</span>}
            </div>
            {i.car && (
              <div className="mt-3 grid grid-cols-3 gap-2 text-[12.5px]">
                <div><div className="text-muted">Пробег</div><b>{km(i.mileage)}</b></div>
                <div><div className="text-muted">До ТО</div><b className={cx((i.to_left ?? 1) < 0 && 'text-[#D70015] dark:text-[#FF453A]')}>{i.to_left == null ? '—' : i.to_left < 0 ? `−${km(-i.to_left)}` : km(i.to_left)}</b></div>
                <div><div className="text-muted">Траты с 1-го</div><b>{lei(i.spend_month ?? i.fuel_month)}</b>{!!i.expenses_month && <div className="text-[11px] text-muted">⛽ {lei(i.fuel_month)} · прочее {lei(i.expenses_month)}</div>}</div>
              </div>
            )}
            </div>
          </button>
        ))}
      </div>
      {canSettings && <CarSettingsCard s={d.settings} items={d.service_items || []} onSaved={load} />}
      {open && <FleetCarSheet tg={open} settings={d.settings} onClose={() => { setOpen(null); load(); }} />}
    </>
  );
}

function ReviewCard({ q, settings, onDone }: { q: CarCheck; settings: CarSettings; onDone: () => void }) {
  const toast = useToast();
  const [pts, setPts] = useState(Math.round((settings.points_min + settings.points_max) / 2));
  async function decide(ok: boolean) {
    try { await api.decideCarCheck(q.id, ok ? { ok: true, points: pts } : { ok: false }); haptic.success(); onDone(); } catch (e) { toast((e as Error).message, 'error'); }
  }
  return (
    <div className="rounded-[22px] bg-card p-4">
      <div className="flex items-center justify-between gap-2"><div className="text-[16px] font-semibold">{q.name}</div><span className={cx('rounded-full px-2.5 py-1 text-[11.5px] font-bold', CHECK_STATUS[q.status][1])}>{CHECK_STATUS[q.status][0]}</span></div>
      <div className="text-[12.5px] text-muted">{dt(q.submitted_at)}</div>
      {q.ai_note && <div className="mt-2 whitespace-pre-line rounded-xl bg-fill px-3 py-2 text-[13px]">{q.ai_note}</div>}
      <PhotoGrid photos={q.photos || []} />
      {q.status !== 'checking' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-fill p-1">
            {Array.from({ length: Math.max(1, settings.points_max - settings.points_min + 1) }, (_, i) => settings.points_min + i).map((p) => (
              <button key={p} onClick={() => setPts(p)} className={cx('h-8 min-w-8 rounded-lg px-2 text-[14px] font-bold', pts === p ? 'bg-ink text-card' : '')}>+{p}</button>
            ))}
          </div>
          <button onClick={() => decide(true)} className="rounded-xl bg-[#34C759] px-3 py-2 text-[13.5px] font-bold text-black">✅ Чисто</button>
          <button onClick={() => decide(false)} className="rounded-xl bg-[#FF453A] px-3 py-2 text-[13.5px] font-bold text-white">❌ Грязно</button>
        </div>
      )}
    </div>
  );
}

function PhotoGrid({ photos }: { photos: { id: string; zone: string; url: string }[] }) {
  if (!photos.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {ZONES.map((z) => {
        const list = photos.filter((p) => p.zone === z.id);
        if (!list.length) return null;
        return (
          <div key={z.id}>
            <div className="mb-1 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted">{z.label}</div>
            <div className="grid grid-cols-5 gap-1.5">{list.map((p) => <button key={p.id} onClick={() => openLink(p.url)} className="aspect-square overflow-hidden rounded-lg bg-fill"><img src={p.url} alt="" className="h-full w-full object-cover" /></button>)}</div>
          </div>
        );
      })}
    </div>
  );
}

function FleetCarSheet({ tg, settings, onClose }: { tg: string; settings: CarSettings; onClose: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<CarDetail | null>(null);
  const [delConfirm, setDelConfirm] = useState(false);
  const [doc, setDoc] = useState<CarDoc | 'new' | null>(null);
  const [more, setMore] = useState(false);
  const load = useCallback(() => api.adminCar(tg).then(setD).catch((e: Error) => toast(e.message, 'error')), [tg, toast]);
  useEffect(() => { load(); }, [load]);
  const overdue = d?.service?.filter((x) => x.state === 'overdue') || [];
  return (
    <Sheet open onClose={onClose} title={d?.user.name || 'Машина'}>
      {!d?.car ? <Spinner /> : (
        <div className="flex flex-col gap-3">
          <div className="-mt-2 overflow-hidden rounded-[22px] bg-card">
            <CarArt body={d.car.body} title={`${d.car.make} ${d.car.model}`} plate={d.car.plate} className="block aspect-[16/9] w-full" />
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 text-[13px] text-muted">{[d.car.year, d.fuels[d.car.fuel], d.car.plate].filter(Boolean).join(' · ')}</div>
              <div className="shrink-0 text-right"><div className="font-dot text-[22px] leading-none">{Math.round(d.car.mileage).toLocaleString('ru-RU')}</div><div className="text-[11px] text-muted">км · обновлён {dt(d.car.mileage_at)}</div></div>
            </div>
          </div>

          <DocsAlert docs={d.docs || []} onOpen={(x) => setDoc(x)} />
          {overdue.length > 0 && (
            <div className="rounded-[20px] bg-[#FF9F0A]/15 px-4 py-3 text-[13.5px] leading-snug ring-1 ring-inset ring-[#FF9F0A]/50">
              <b className="text-[#C93400] dark:text-[#FF9F0A]">🔧 Просрочено ТО ({overdue.length}):</b> {overdue.map((x) => `${x.label} (${km(-x.left)})`).join(', ')}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Tile label="До ТО (масло)" value={d.to ? (d.to.left < 0 ? `−${km(-d.to.left)}` : km(d.to.left)) : '—'} tone={d.to?.state === 'overdue' ? 'red' : d.to?.state === 'soon' ? 'orange' : 'green'} sub={d.to ? `на ${km(d.to.next_km)}` : undefined} />
            <Tile label={`Пробег · ${d.stats!.month_label || 'месяц'}`} value={km(d.stats!.km_month)} sub={`с начала учёта ${km(d.stats!.km_total)}`} />
            <Tile label={`Топливо · ${d.stats!.month_label || 'месяц'}`} value={lei(d.stats!.fuel_month)}
              sub={`${d.stats!.fuel_prev_month ? `${d.stats!.prev_month_label}: ${lei(d.stats!.fuel_prev_month)} · ` : ''}всего ${lei(d.stats!.fuel_total)}`} />
            <Tile label="Цена км" value={d.stats!.cost_km != null ? `${String(d.stats!.cost_km).replace('.', ',')} лей` : '—'} sub={d.stats!.per100 != null ? `${String(d.stats!.per100).replace('.', ',')} л/100 км` : undefined} />
          </div>
          <SpendCard d={d} />

          <Block title="Страховки и документы" right={<button onClick={() => { haptic.tap(); setDoc('new'); }} className="flex items-center gap-1 text-[13px] font-semibold text-accent-ink"><Plus size={15} />Добавить</button>}>
            <DocsList docs={d.docs || []} onOpen={(x) => setDoc(x)} />
          </Block>
          <Block title="Регламент ТО"><ServiceList service={d.service || []} /></Block>
          {d.service_costs && <ServiceCostsCard c={d.service_costs} />}
          {!!d.service_log.length && (
            <Block title="История ТО">
              <div className="flex flex-col divide-y divide-dashed divide-line">
                {d.service_log.map((s2, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 text-[13.5px]">
                    <Wrench size={15} className="shrink-0 text-muted" />
                    <div className="min-w-0 flex-1"><b>{s2.label}</b><div className="text-[12px] text-muted">{km(s2.km)} · {dt(s2.created_at)}{s2.note ? ` · ${s2.note}` : ''}</div></div>
                    {s2.amount ? <b className="shrink-0">{lei(s2.amount)}</b> : <span className="shrink-0 text-[12px] text-muted">без суммы</span>}
                  </div>
                ))}
              </div>
            </Block>
          )}
          <Block title={`Другие расходы · ${d.stats!.month_label}: ${lei(d.stats!.expenses_month)}`}>
            <ExpenseList d={d} items={d.expenses || []} admin onChanged={() => load()} />
          </Block>
          <Block title="Заправки (чеки)">
            <div className="grid grid-cols-4 gap-2">
              {(d.fuel || []).slice(0, more ? 40 : 8).map((f) => (
                <button key={f.id} onClick={() => f.photo && openLink(f.photo)} className="overflow-hidden rounded-xl bg-fill text-left">
                  {f.photo && <img src={f.photo} alt="" className="aspect-square w-full object-cover" />}
                  <div className="px-1.5 py-1 text-[11px] leading-tight">{f.amount != null ? lei(f.amount) : '—'}<br /><span className="text-muted">{km(f.km)}</span></div>
                </button>
              ))}
            </div>
            {(d.fuel || []).length > 8 && !more && <button onClick={() => setMore(true)} className="mt-2 text-[13px] font-semibold text-accent-ink">Показать все</button>}
          </Block>
          <Block title="Фотопроверки">
            <Button variant="secondary" icon={<Camera size={17} />} onClick={async () => { try { await api.requestCarCheck(tg); toast('Запрос отправлен сотруднику', 'ok'); load(); } catch (e) { toast((e as Error).message, 'error'); } }}>Запросить фото машины сейчас</Button>
            <div className="mt-2 flex flex-col gap-2">
              {(d.checks || []).map((k) => (
                <div key={k.id} className="rounded-2xl bg-fill p-3">
                  <div className="flex items-center justify-between"><b className="text-[14px]">{new Date(k.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</b><span className={cx('rounded-full px-2.5 py-1 text-[11.5px] font-bold', CHECK_STATUS[k.status][1])}>{CHECK_STATUS[k.status][0]}{k.points ? ` +${k.points} б` : ''}</span></div>
                  {k.ai_note && <div className="mt-1 whitespace-pre-line text-[12.5px] text-muted">{k.ai_note}</div>}
                  <PhotoGrid photos={k.photos || []} />
                </div>
              ))}
            </div>
            <div className="mt-2 text-[12px] text-muted">Баллы за чистую машину: {settings.points_min}–{settings.points_max}.</div>
          </Block>
          <Button variant="danger" icon={<Trash2 size={17} strokeWidth={1.9} />} onClick={() => setDelConfirm(true)}>Удалить машину</Button>
        </div>
      )}
      {doc && d && <DocSheet d={d} tg={tg} doc={doc === 'new' ? null : doc} onClose={() => setDoc(null)} onDone={() => { setDoc(null); haptic.success(); load(); }} />}
      {delConfirm && (
        <ConfirmSheet title="Удалить машину?" confirmLabel="Удалить" danger
          text="Машина и её записи (заправки, ТО, фотопроверки) будут удалены немедленно."
          onClose={() => setDelConfirm(false)}
          onConfirm={async () => { try { await api.adminCarDelete(tg); haptic.success(); toast('Машина удалена', 'ok'); setDelConfirm(false); onClose(); } catch (e) { toast((e as Error).message, 'error'); } }} />
      )}
    </Sheet>
  );
}

function CarSettingsCard({ s: s0, items, onSaved }: { s: CarSettings; items: NonNullable<CarFleet['service_items']>; onSaved: () => void }) {
  const toast = useToast();
  const [s, setS] = useState(s0);
  const [busy, setBusy] = useState(false);
  useEffect(() => setS(s0), [s0]);
  const n = (v: string) => Number(v.replace(',', '.')) || 0;
  const inp = (v: number, on: (x: number) => void) => <input inputMode="decimal" value={String(v)} onChange={(e) => on(n(e.target.value))} className="h-9 w-14 rounded-xl bg-card text-center ring-1 ring-inset ring-line" />;
  return (
    <Collapse id="car-settings" title="🚗 Настройки «Мой авто»" hint={s.on ? `${s.checks_per_week} проверки в неделю · ${s.points_min}–${s.points_max} б` : 'выключено'}>
      <div className="flex flex-col gap-3 text-[14px]">
        <Toggle label="Вкладка «Мой авто» у сотрудников" checked={s.on} onChange={(v) => setS({ ...s, on: v })} />
        <Field label="Фотопроверок в неделю"><Chips options={[{ id: '1', label: '1 раз' }, { id: '2', label: '2 раза' }]} value={String(s.checks_per_week)} onChange={(v) => setS({ ...s, checks_per_week: Number(v) })} /></Field>
        <div className="flex flex-wrap items-center gap-2">Запрос в случайное время с {inp(s.from_hour, (x) => setS({ ...s, from_hour: x }))} до {inp(s.to_hour, (x) => setS({ ...s, to_hour: x }))} ч, прислать до {inp(s.deadline_hour, (x) => setS({ ...s, deadline_hour: x }))} ч</div>
        <div className="flex flex-wrap items-center gap-2">Баллы за чистую машину: от {inp(s.points_min, (x) => setS({ ...s, points_min: x }))} до {inp(s.points_max, (x) => setS({ ...s, points_max: x }))}</div>
        {ZONES.map((z) => (
          <div key={z.id} className="flex flex-wrap items-center gap-2">{z.label}: фото от {inp(s.photos[z.id][0], (x) => setS({ ...s, photos: { ...s.photos, [z.id]: [x, s.photos[z.id][1]] } }))} до {inp(s.photos[z.id][1], (x) => setS({ ...s, photos: { ...s.photos, [z.id]: [s.photos[z.id][0], x] } }))}</div>
        ))}
        <div className="flex flex-wrap items-center gap-2"><Gauge size={16} />Замена масла по умолчанию каждые <input inputMode="numeric" value={String(s.service_interval)} onChange={(e) => setS({ ...s, service_interval: n(e.target.value) })} className="h-9 w-24 rounded-xl bg-card text-center ring-1 ring-inset ring-line" /> км</div>
        {items.length > 0 && (
          <div className="rounded-2xl bg-fill p-3">
            <div className="mb-1 text-[14px] font-semibold">Регламент ТО по пробегу</div>
            <div className="mb-2 text-[12px] leading-snug text-muted">Интервал в км для всех машин. 0 — пункт выключен. Пусто — по умолчанию. Сотрудник видит, когда пора, и отмечает «Сделал ТО».</div>
            <div className="flex flex-col gap-1.5">
              {items.map((it) => {
                const cur = s.service_km?.[it.id];
                return (
                  <div key={it.id} className="flex items-center gap-2">
                    <span className={cx('min-w-0 flex-1 text-[13px] leading-snug', cur === 0 && 'text-muted line-through')}>{it.label}{it.fuels ? <span className="text-muted"> · {it.fuels.map((f) => ({ petrol: 'бензин', diesel: 'дизель', gas: 'ГБО', hybrid: 'гибрид' } as Record<string, string>)[f] || f).join('/')}</span> : null}</span>
                    <input inputMode="numeric" placeholder={String(it.km)} value={cur == null ? '' : String(cur)}
                      onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); const next = { ...(s.service_km || {}) }; if (v === '') delete next[it.id]; else next[it.id] = Number(v); setS({ ...s, service_km: next }); }}
                      className="h-8 w-20 shrink-0 rounded-lg bg-card text-center text-[13px] ring-1 ring-inset ring-line" />
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <Button loading={busy} onClick={async () => { setBusy(true); try { await api.saveCarSettings({ ...s, service_km: Object.fromEntries(items.map((it) => [it.id, s.service_km?.[it.id] ?? null])) as unknown as Record<string, number> }); toast('Сохранено', 'ok'); onSaved(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); } }}>Сохранить</Button>
      </div>
    </Collapse>
  );
}
