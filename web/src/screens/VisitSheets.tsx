import { useRef, useState, useEffect } from 'react';
import { AlertTriangle, Camera, Image as ImageIcon, Keyboard, Loader2, PenLine, Send, X } from 'lucide-react';
import { SignatureSheet } from '../components/SignaturePad';
import { api } from '../api';
import { RemarkTypePicker } from '../components/RemarkTypes';
import { plural, useConfig } from '../config';
import { canScanQr, haptic } from '../telegram';
import type { Observation, Reward, Trap, Visit, RemarkType } from '../types';
import { QuestPath } from '../components/game';
import { openPhotos } from '../components/PhotoViewer';
import { compressImage } from '../image';
import { PaymentPicker, defaultPayNote, defaultPayment, type PayState } from '../components/Payment';
import { Button, Chips, Field, Input, Sheet, Stepper, TextArea, Toggle, cx, useToast } from '../components/ui';

/* ---------- Осмотр станции (электронный журнал) ---------- */

const BLOCKED = ['damaged', 'missing', 'no_access'];

export function InspectSheet({ visitId, trap, onClose, onSaved, onQr }: {
  visitId: string; trap: Trap; onClose: () => void; onSaved: (scanNext: boolean) => void; onQr?: () => void;
}) {
  const cfg = useConfig();
  const toast = useToast();
  const prev = trap.inspection;
  const target = cfg.stationTargets.find((t) => t.id === trap.target);
  const isBait = trap.kind === cfg.rodenticide;
  const [condition, setCondition] = useState(prev?.condition || (prev ? (BLOCKED.includes(prev.status) || prev.status === 'replaced' ? prev.status : 'ok') : 'ok'));
  const [bait, setBait] = useState(prev?.bait_eaten ?? '');
  const [caught, setCaught] = useState<'' | 'no' | 'yes'>(prev ? (prev.count > 0 ? 'yes' : 'no') : '');
  const [pest, setPest] = useState(prev?.pest ?? (target?.pests.length === 1 ? target.pests[0] : ''));
  const [count, setCount] = useState(prev?.count || 1);
  const [replaced, setReplaced] = useState(prev?.bait_replaced ?? false);
  const [comment, setComment] = useState(prev?.comment ?? '');
  const [busy, setBusy] = useState<'save' | 'next' | null>(null);
  const blocked = BLOCKED.includes(condition);
  const pestOptions = target?.pests ?? cfg.pests;
  // грызун в станции: можно сделать фото и прикрепить файл — уйдёт в замечания выезда (и в акт)
  const isRodent = /мыш|крыс|грызун/i.test(pest);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [shots, setShots] = useState<{ key: string; data: string }[]>([]);
  const [processing, setProcessing] = useState(false);
  const MAX_SHOTS = 5;

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list).slice(0, MAX_SHOTS - shots.length);
    setProcessing(true);
    try {
      const out: { key: string; data: string }[] = [];
      for (const f of files) out.push({ key: `${Date.now()}-${Math.random()}`, data: await compressImage(f) });
      setShots((all) => [...all, ...out].slice(0, MAX_SHOTS));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setProcessing(false);
      if (camera.current) camera.current.value = '';
      if (gallery.current) gallery.current.value = '';
    }
  }

  async function save(next: boolean) {
    setBusy(next ? 'next' : 'save');
    try {
      await api.saveInspection(visitId, {
        trap_id: trap.id, condition, bait_eaten: isBait && !blocked ? bait : '',
        pest: !blocked && caught === 'yes' ? pest : '', count: !blocked && caught === 'yes' ? count : 0,
        bait_replaced: !blocked && replaced, comment,
      });
      if (!blocked && caught === 'yes' && isRodent && shots.length) {
        try {
          await api.addObservation(visitId, {
            category: 'Грызун в станции',
            comment: `Станция №${trap.number}${trap.location ? ` · ${trap.location}` : ''}: ${pest} × ${count}${comment.trim() ? `. ${comment.trim()}` : ''}`,
            photos: shots.map((x) => x.data),
          });
        } catch (e) {
          toast(`Станция записана, но фото не загрузилось: ${(e as Error).message}`, 'error');
        }
      }
      haptic.success();
      toast(`Станция №${trap.number} записана в журнал`);
      onSaved(next);
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
      setBusy(null);
    }
  }

  const invalid = processing || !condition || (!blocked && ((isBait && !bait) || !caught || (caught === 'yes' && !pest)));

  return (
    <Sheet open onClose={onClose} title={`Станция №${trap.number}`}>
      <div className="-mt-3 mb-6 text-[15px] text-muted">
        {[target?.label, trap.kind, trap.location].filter(Boolean).join(' · ')}
        <span className="ml-1 font-mono text-[12px] opacity-60">· {trap.code}</span>
      </div>

      <div className="space-y-6">
        <Field label="Состояние станции">
          <Chips options={cfg.conditions} value={condition} onChange={(v) => { haptic.tap(); setCondition(v); }} />
        </Field>

        {!blocked && (
          <>
            {isBait && (
              <Field label="Приманка погрызена?">
                <Chips options={cfg.baitLevels} value={bait} onChange={(v) => { haptic.tap(); setBait(v); }} columns={1} />
              </Field>
            )}
            <Field label={isBait ? 'Есть кто-то в станции?' : 'Есть кто-то в ловушке?'}>
              <Chips options={[{ id: 'no', label: 'Пусто' }, { id: 'yes', label: 'Да, есть' }]} value={caught}
                onChange={(v) => { haptic.tap(); setCaught(v as 'no' | 'yes'); }} />
            </Field>
            {caught === 'yes' && (
              <>
                <Field label="Кто">
                  <Chips options={pestOptions.map((p) => ({ id: p, label: p }))} value={pest} onChange={(v) => { haptic.tap(); setPest(v); }} />
                </Field>
                <Field label="Количество">
                  <Stepper value={count} onChange={setCount} min={1} />
                </Field>
                {isRodent && (
                  <Field label={`Фото грызуна${shots.length ? ` · ${shots.length}` : ''}`}>
                    {shots.length > 0 && (
                      <div className="mb-3 grid grid-cols-3 gap-2">
                        {shots.map((x) => (
                          <div key={x.key} className="relative">
                            <img src={x.data} alt="" onClick={() => openPhotos(shots.map((y) => y.data), shots.indexOf(x))} className="aspect-square w-full rounded-2xl object-cover" />
                            <button onClick={() => setShots((all) => all.filter((y) => y.key !== x.key))} aria-label="Убрать"
                              className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white">
                              <X size={15} strokeWidth={2.25} />
                            </button>
                          </div>
                        ))}
                        {processing && <div className="flex aspect-square items-center justify-center rounded-2xl bg-fill text-muted"><Loader2 size={22} className="animate-spin" /></div>}
                      </div>
                    )}
                    <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addFiles(e.target.files)} />
                    <input ref={gallery} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="secondary" className="text-[15px]" disabled={shots.length >= MAX_SHOTS} loading={processing && !shots.length}
                        onClick={() => camera.current?.click()} icon={<Camera size={18} strokeWidth={1.75} />}>Сделать фото</Button>
                      <Button variant="secondary" className="text-[15px]" disabled={shots.length >= MAX_SHOTS}
                        onClick={() => gallery.current?.click()} icon={<ImageIcon size={18} strokeWidth={1.75} />}>Прикрепить файл</Button>
                    </div>
                    <div className="mt-1.5 px-1 text-[12.5px] leading-snug text-muted">Необязательно. Фото попадёт в замечания выезда и в акт.</div>
                  </Field>
                )}
              </>
            )}
            <Toggle label={isBait ? 'Приманка заменена / добавлена' : 'Клеевая пластина / вкладыш заменены'} checked={replaced} onChange={setReplaced} />
          </>
        )}

        <Field label="Комментарий">
          <TextArea placeholder={blocked ? 'Что случилось со станцией' : 'Необязательно: следы, помёт, погрызы рядом'} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </div>

      <div className="mt-7 space-y-2.5">
        {canScanQr() && (
          <Button disabled={invalid} loading={busy === 'next'} onClick={() => save(true)}>
            Записать и сканировать следующую
          </Button>
        )}
        <Button variant={canScanQr() ? 'secondary' : 'primary'} disabled={invalid} loading={busy === 'save'} onClick={() => save(false)}>
          Записать
        </Button>
        {onQr && (
          <button onClick={onQr} className="w-full py-2 text-center text-[14px] font-medium text-accent-ink">
            QR на станции повреждён? Заменить этикетку
          </button>
        )}
      </div>
    </Sheet>
  );
}

/* ---------- Новая станция: назначение, устройство, место ---------- */

export function RegisterSheet({ visitId, code, nextNumber, onClose, onRegistered }: {
  visitId: string; code: string; nextNumber: number; onClose: () => void; onRegistered: (t: Trap) => void;
}) {
  const cfg = useConfig();
  const toast = useToast();
  const [number, setNumber] = useState(String(nextNumber));
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const t = cfg.stationTargets.find((x) => x.id === target);

  async function submit() {
    setBusy(true);
    try {
      const { trap } = await api.registerTrap(visitId, { code, number: Number(number) || nextNumber, kind, location: location.trim(), target });
      haptic.success();
      onRegistered(trap);
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  const deviceHint: Record<string, string> = {
    'Клеевая ловушка': 'ловит, фиксируем пойманных',
    'Родентицидная станция': 'приманка-яд, фиксируем поедание',
    'Феромонная ловушка': 'привлекает запахом',
    'Инсектицидная лампа': 'для летающих',
  };

  return (
    <Sheet open onClose={onClose} title="Новая станция">
      <p className="-mt-3 mb-6 text-[15px] leading-relaxed text-muted">
        Код <b className="font-mono font-semibold text-ink">{code}</b> ещё не привязан. Станция закрепится за этим юрлицом и адресом и будет в журнале при каждом обслуживании.
      </p>
      <div className="space-y-6">
        <Field label="Против кого">
          <Chips options={cfg.stationTargets.map((x) => ({ id: x.id, label: x.label }))} value={target}
            onChange={(v) => { haptic.tap(); setTarget(v); setKind(''); }} columns={1} />
        </Field>
        {t && (
          <Field label="Устройство">
            <div className="grid gap-2">
              {t.devices.map((dv) => (
                <button key={dv} onClick={() => { haptic.tap(); setKind(dv); }}
                  className={cx('flex min-h-[52px] items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition',
                    kind === dv ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>
                  <span className="text-[15px] font-medium">{dv}</span>
                  <span className={cx('text-[12px]', kind === dv ? 'opacity-70' : 'text-muted')}>{deviceHint[dv] ?? ''}</span>
                </button>
              ))}
            </div>
          </Field>
        )}
        <div className="grid grid-cols-[96px_1fr] gap-2.5">
          <Field label="№">
            <Input inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))} className="font-mono" />
          </Field>
          <Field label="Место установки">
            <Input placeholder="Склад, у ворот №2" value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
        </div>
      </div>
      <Button className="mt-7" disabled={!target || !kind || location.trim().length < 2} loading={busy} onClick={submit}>
        Привязать и записать осмотр
      </Button>
    </Sheet>
  );
}

/* ---------- Ручной ввод кода ---------- */

export function ManualSheet({ onClose, onSubmit }: { onClose: () => void; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState('PT-');
  return (
    <Sheet open onClose={onClose} title="Ввести код">
      <p className="-mt-3 mb-5 text-[15px] text-muted">
        {canScanQr() ? 'Если QR-код повреждён — введите код, напечатанный под ним.' : 'Сканер доступен только в Telegram. Введите код с этикетки.'}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(code);
        }}
        className="space-y-4"
      >
        <Input
          icon={<Keyboard size={18} strokeWidth={1.75} />}
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="PT-XXXXXX"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="font-mono tracking-wider"
        />
        <Button type="submit" disabled={code.replace(/[^A-Z0-9]/g, '').length < 8}>Найти ловушку</Button>
      </form>
    </Sheet>
  );
}

/* ---------- Завершение выезда ---------- */

export function FinishSheet({ visitId, traps, visit, observations, fromLead, onClose, onFinished }: {
  visitId: string; traps: Trap[]; visit: Visit; observations: Observation[]; fromLead: boolean;
  onClose: () => void; onFinished: (reward?: Reward | null) => void;
}) {
  const cfg = useConfig();
  const toast = useToast();
  const [comment, setComment] = useState(visit.comment || '');
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState({ proces: true, anexa: true, obs: true, traps: true });
  const [signature, setSignature] = useState('');
  const [signing, setSigning] = useState(false);
  const [pay, setPay] = useState<PayState>(() => {
    const p = defaultPayment(visit);
    return { payment: p, amount: visit.pay_amount != null ? String(visit.pay_amount).replace('.', ',') : p === 'cash' && visit.price ? String(visit.price) : '', note: defaultPayNote(visit, p) };
  });
  const payRef = useRef<HTMLDivElement>(null);
  const unchecked = traps.filter((t) => !t.inspection);
  const checkedTraps = traps.filter((t) => t.inspection);
  const pestOptions = cfg.pestsByProcedure?.[visit.procedure] ?? [];
  const missingAssessment = visit.needs_assessment && (!visit.infestation || !visit.preparation || (pestOptions.length > 0 && !visit.pests.length));
  const photoCount = observations.reduce((n, o) => n + o.photos.length, 0);
  const softWarnings = [
    !visit.products.length && 'не указаны препараты',
    !visit.area && 'не указана площадь',
    !visit.client_rep && 'не указан представитель заказчика',
  ].filter(Boolean) as string[];

  async function submit() {
    if (!pay.payment) {
      haptic.error(); toast('Отметьте оплату', 'error');
      payRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (pay.payment === 'cash' && !(Number(pay.amount.replace(',', '.').replace(/\s/g, '')) > 0)) { haptic.error(); toast('Укажите, сколько наличных получено', 'error'); return; }
    setBusy(true);
    try {
      const r = await api.finish(visitId, comment, { docs, signature: signature || undefined, payment: pay.payment, pay_amount: pay.amount, pay_note: pay.note.trim() });
      haptic.success();
      if (r.office_none) toast('Выезд завершён · документы в офис не отправлялись');
      else if (r.office_error) toast(r.office_error, 'error');
      else if (r.amo_error) toast(r.amo_error, 'error');
      else if (r.office_sent) toast('Отчёт отправлен в офис');
      else toast(fromLead ? 'Заявка закрыта в amoCRM' : 'Выезд завершён');
      onFinished(r.reward);
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={fromLead ? 'Закрыть заявку' : 'Завершить выезд'}>
      {!cfg.isAdmin && !visit.revision && <QuestPath step={pay.payment ? 4 : 3} className="-mt-2 mb-4" />}
      {missingAssessment && (
        <div className="mb-5 flex gap-3 rounded-2xl bg-[#FF3B30]/10 p-4 text-[15px]">
          <AlertTriangle size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[#D70015] dark:text-[#FF453A]" />
          <div>Отметьте вредителей, степень заселённости и подготовку помещения в блоке «Оценка объекта».</div>
        </div>
      )}
      <div className="mb-5 grid grid-cols-2 gap-2.5">
        <div className="rounded-2xl bg-card p-3.5">
          <div className="text-[13px] text-muted">Замечаний</div>
          <div className="text-[22px] font-semibold">{observations.length}</div>
        </div>
        <div className="rounded-2xl bg-card p-3.5">
          <div className="text-[13px] text-muted">Фото</div>
          <div className="text-[22px] font-semibold">{photoCount}</div>
        </div>
      </div>
      {softWarnings.length > 0 && !missingAssessment && (
        <div className="mb-5 flex gap-3 rounded-2xl bg-[#FF9500]/12 p-4 text-[15px]">
          <AlertTriangle size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[#C93400] dark:text-[#FF9F0A]" />
          <div>В акте {softWarnings.join(', ')}. <span className="text-muted">Заполните блок «Данные для акта» или завершите так.</span></div>
        </div>
      )}
      {unchecked.length > 0 && (
        <div className="mb-5 flex gap-3 rounded-2xl bg-[#FF9500]/12 p-4 text-[15px]">
          <AlertTriangle size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[#C93400] dark:text-[#FF9F0A]" />
          <div>
            Не записано в журнал: {unchecked.length} {plural(unchecked.length, ['станция', 'станции', 'станций'])}
            <span className="text-muted"> (№{unchecked.map((t) => t.number).join(', №')}). Они будут отмечены в акте.</span>
          </div>
        </div>
      )}
      <div ref={payRef} className="mb-6">
        <Field label="Оплата">
          <PaymentPicker v={pay} set={(p) => setPay((x) => ({ ...x, ...p }))} price={visit.price} />
        </Field>
      </div>
      <Field label="Заключение и рекомендации">
        <TextArea rows={4} placeholder="Например: рекомендована заделка технологических отверстий" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      {visit.quick && (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl bg-accent/[0.08] px-4 py-3 text-[13.5px] leading-snug">
            ⚡ Быстрый акт: клиент и офис получат страницу с адресом, вредителями, подписью и печатью.
            {(observations.length > 0 || checkedTraps.length > 0) && ' Ниже можно добавить приложения к акту.'}
          </div>
          {(observations.length > 0 || checkedTraps.length > 0) && (
            <Field label="Что приложить к акту">
              <div className="grid grid-cols-1 gap-2">
                {observations.length > 0 && (
                  <button onClick={() => { haptic.tap(); setDocs((d) => ({ ...d, obs: !d.obs })); }}
                    className={cx('relative rounded-2xl p-3.5 text-left transition', docs.obs ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>
                    <span className={cx('absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-md text-[12px]',
                      docs.obs ? 'bg-accent text-black' : 'ring-1 ring-inset ring-line')}>{docs.obs ? '✓' : ''}</span>
                    <div className="pr-6 text-[15px] font-semibold">Замечания с фото</div>
                    <div className={cx('mt-0.5 text-[12px] leading-snug', docs.obs ? 'opacity-70' : 'text-muted')}>
                      {observations.length} {plural(observations.length, ['замечание', 'замечания', 'замечаний'])} · {photoCount} фото
                    </div>
                  </button>
                )}
                {checkedTraps.length > 0 && (
                  <button onClick={() => { haptic.tap(); setDocs((d) => ({ ...d, traps: !d.traps })); }}
                    className={cx('relative rounded-2xl p-3.5 text-left transition', docs.traps ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>
                    <span className={cx('absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-md text-[12px]',
                      docs.traps ? 'bg-accent text-black' : 'ring-1 ring-inset ring-line')}>{docs.traps ? '✓' : ''}</span>
                    <div className="pr-6 text-[15px] font-semibold">Журнал ловушек</div>
                    <div className={cx('mt-0.5 text-[12px] leading-snug', docs.traps ? 'opacity-70' : 'text-muted')}>
                      Проверено {checkedTraps.length} из {traps.length}
                    </div>
                  </button>
                )}
              </div>
            </Field>
          )}
        </div>
      )}
      {visit.office_configured && !visit.quick && (
        <div className="mt-6">
          <Field label="Что отправить в офис">
            <div className="grid grid-cols-2 gap-2">
              {([['proces', 'Proces-verbal', 'акт приёмки, стр. 1'], ['anexa', 'Anexa', 'отчёт, фото, рекомендации, журнал']] as const).map(([k, title, hint]) => {
                const on = docs[k];
                return (
                  <button key={k} onClick={() => { haptic.tap(); setDocs((d) => ({ ...d, [k]: !d[k] })); }}
                    className={cx('relative rounded-2xl p-3.5 text-left transition', on ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>
                    <span className={cx('absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-md text-[12px]',
                      on ? 'bg-accent text-black' : 'ring-1 ring-inset ring-line')}>{on ? '✓' : ''}</span>
                    <div className="pr-6 text-[15px] font-semibold">{title}</div>
                    <div className={cx('mt-0.5 text-[12px] leading-snug', on ? 'opacity-70' : 'text-muted')}>{hint}</div>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 px-1 text-[12.5px] text-muted">
              {docs.proces && docs.anexa ? 'Уйдут оба документа одним PDF.' : docs.proces || docs.anexa ? 'Уйдёт только выбранный документ.' : 'В офис ничего не отправится — акт сохранится в приложении.'}
            </div>
          </Field>
        </div>
      )}

      <div className="mt-6">
        <Field label="Подпись клиента">
          {signature ? (
            <div className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-inset ring-line">
              <img src={signature} alt="Подпись" className="h-14 w-32 rounded-lg bg-white object-contain" />
              <div className="flex-1 text-[14px] text-muted">Подпись добавлена в акт</div>
              <button className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink" onClick={() => setSigning(true)}>Заново</button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setSigning(true)} icon={<PenLine size={18} strokeWidth={1.75} />}>
              Расписаться клиенту
            </Button>
          )}
          <div className="mt-2 px-1 text-[12.5px] text-muted">Необязательно. Наша печать и подпись уже стоят в акте.</div>
        </Field>
      </div>
      {signing && <SignatureSheet onClose={() => setSigning(false)} onDone={(img) => { setSignature(img); setSigning(false); }} />}

      <p className="mt-4 text-[14px] text-muted">
        {fromLead
          ? 'Заявка в amoCRM перейдёт в этап «Выполнено», в неё добавится примечание с итогами осмотра и ссылкой на акт.'
          : cfg.amo
            ? 'В карточку юрлица в amoCRM добавится примечание с итогами осмотра и ссылкой на акт.'
            : 'Будет сформирован PDF-акт с фото и рекомендациями заказчику.'}
        {visit.office_configured && (docs.proces || docs.anexa) && ' Бот отправит выбранное в чат офиса.'}
      </p>
      <Button className="mt-6" loading={busy} disabled={missingAssessment} onClick={submit} icon={<Send size={18} strokeWidth={1.75} />}>
        {fromLead ? 'Закрыть заявку' : cfg.amo ? 'Завершить и отправить' : 'Завершить выезд'}
      </Button>
    </Sheet>
  );
}

/* ---------- Сообщение ---------- */

export function MessageSheet({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title={title}>
      <p className="mb-6 text-[16px] leading-relaxed text-muted">{text}</p>
      <Button variant="secondary" onClick={onClose}>Понятно</Button>
    </Sheet>
  );
}

/* ---------- Замечание с фото ---------- */

type Shot = { key: string; data: string };

export function ObservationSheet({ visitId, onClose, onSaved }: {
  visitId: string; onClose: () => void; onSaved: (obs: Observation[]) => void;
}) {
  const cfg = useConfig();
  const toast = useToast();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState('');
  const [comment, setComment] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const MAX = 10;

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list).slice(0, MAX - shots.length);
    if (list.length > files.length) toast(`Не больше ${MAX} фото в одном замечании`, 'error');
    setProcessing(true);
    try {
      const out: Shot[] = [];
      for (const f of files) out.push({ key: `${Date.now()}-${Math.random()}`, data: await compressImage(f) });
      setShots((s) => [...s, ...out].slice(0, MAX));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setProcessing(false);
      if (camera.current) camera.current.value = '';
      if (gallery.current) gallery.current.value = '';
    }
  }

  async function save() {
    setBusy(true);
    try {
      const r = await api.addObservation(visitId, { category, comment: comment.trim(), photos: shots.map((s) => s.data) });
      haptic.success();
      toast('Замечание сохранено');
      onSaved(r.observations);
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Замечание">
      <div className="space-y-6">
        <Field label="Что зафиксировать">
          <Chips options={cfg.obsCategories.map((c) => ({ id: c, label: c }))} value={category} onChange={(v) => { haptic.tap(); setCategory(v); }} />
        </Field>

        <Field label={`Фото${shots.length ? ` · ${shots.length}` : ''}`}>
          {shots.length > 0 && (
            <div className="mb-3 grid grid-cols-3 gap-2">
              {shots.map((s) => (
                <div key={s.key} className="relative">
                  <img src={s.data} alt="" onClick={() => openPhotos(shots.map((y) => y.data), shots.indexOf(s))} className="aspect-square w-full rounded-2xl object-cover" />
                  <button onClick={() => setShots((all) => all.filter((x) => x.key !== s.key))} aria-label="Убрать"
                    className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white">
                    <X size={15} strokeWidth={2.25} />
                  </button>
                </div>
              ))}
              {processing && (
                <div className="flex aspect-square items-center justify-center rounded-2xl bg-fill text-muted">
                  <Loader2 size={22} className="animate-spin" />
                </div>
              )}
            </div>
          )}
          <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addFiles(e.target.files)} />
          <input ref={gallery} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="text-[15px]" disabled={shots.length >= MAX} loading={processing && !shots.length}
              onClick={() => camera.current?.click()} icon={<Camera size={18} strokeWidth={1.75} />}>Камера</Button>
            <Button variant="secondary" className="text-[15px]" disabled={shots.length >= MAX}
              onClick={() => gallery.current?.click()} icon={<ImageIcon size={18} strokeWidth={1.75} />}>Галерея</Button>
          </div>
        </Field>

        <Field label="Комментарий">
          <TextArea rows={4} placeholder="Опишите ситуацию: что не подготовлено, где скопления, рекомендации клиенту"
            value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </div>
      <Button className="mt-7" loading={busy} disabled={!category || processing || (!comment.trim() && !shots.length)} onClick={save}>
        Сохранить замечание
      </Button>
    </Sheet>
  );
}

/** Замечание офиса технику по конкретному акту (для админа). */
export function RemarkSheet({ visitId, techName, onClose }: { visitId: string; techName: string; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [type, setType] = useState('');
  const [types, setTypes] = useState<RemarkType[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.remarks().then((r) => setTypes(r.types ?? [])).catch(() => {}); }, []);

  async function send() {
    setBusy(true);
    try {
      await api.addRemark({ visit_id: visitId, text: text.trim(), type });
      haptic.success();
      toast(`Замечание отправлено: ${techName}`);
      onClose();
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Замечание технику">
      <p className="-mt-3 mb-5 text-[15px] leading-relaxed text-muted">
        {techName} увидит его в панели уведомлений и получит сообщение от бота. Замечания за месяц обнуляются 1-го числа.
      </p>
      {types.length > 0 && <div className="mb-4"><RemarkTypePicker types={types} value={type} onChange={setType} /></div>}
      <TextArea rows={3} placeholder={type ? 'Комментарий (необязательно)' : 'Например: нет фото подготовки кухни'} value={text} onChange={(e) => setText(e.target.value)} />
      <Button className="mt-5" loading={busy} disabled={!type && text.trim().length < 3} onClick={send} icon={<Send size={18} strokeWidth={1.75} />}>
        Отправить
      </Button>
    </Sheet>
  );
}
