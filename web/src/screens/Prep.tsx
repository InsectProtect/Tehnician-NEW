import { useEffect, useState } from 'react';
import { Keyboard, MapPin, PackagePlus, ScanLine, X } from 'lucide-react';
import { api } from '../api';
import { useConfig } from '../config';
import { canScanQr, haptic, scanQr } from '../telegram';
import type { PrepState, Task } from '../types';
import { playSound } from '../sounds';
import { GameButton } from '../components/game';
import { Button, Chips, Field, Group, IconBadge, Input, Pill, Row, Sheet, cx, useToast } from '../components/ui';
import { fmtTaskDate } from './Tasks';
import { ManualSheet } from './VisitSheets';

/* ================================================================================================
 * «Подготовить ловушки» на главной (v58): выбираете заявку → сканируете этикетки станций и
 * отмечаете, против кого и какое устройство. Станции привязываются к объекту заявки как «подготовленные».
 * На объекте при скане такой станции специалист отмечает, где именно её поставил.
 * ================================================================================================ */

export function PrepButton() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [task, setTask] = useState<Task | null>(null);

  async function open() {
    haptic.tap();
    setBusy(true);
    try {
      const r = await api.tasks();
      setTasks(r.items.filter((t) => t.status === 'new' || t.status === 'in_progress'));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <GameButton className="mb-5" tone="ghost" loading={busy} icon={<PackagePlus size={20} strokeWidth={2.2} />} onClick={open}>
        Подготовить ловушки
      </GameButton>

      {tasks && !task && (
        <Sheet open onClose={() => setTasks(null)} title="Подготовить ловушки">
          <p className="-mt-3 mb-4 text-[14.5px] leading-relaxed text-muted">
            Выберите заявку — станции привяжутся к её объекту. На месте отсканируете каждую и отметите, где поставили.
          </p>
          {tasks.length ? (
            <Group>
              {tasks.map((t) => (
                <Row
                  key={t.id}
                  left={<IconBadge tone="blue"><span className="font-mono text-[13px]">№{t.task_no}</span></IconBadge>}
                  title={t.company_name || t.address}
                  subtitle={[t.company_name ? t.address : '', t.procedure, fmtTaskDate(t)].filter(Boolean).join(' · ')}
                  onClick={() => { haptic.tap(); setTask(t); }}
                />
              ))}
            </Group>
          ) : (
            <div className="rounded-2xl bg-card p-4 text-[14.5px] leading-relaxed text-muted">
              В вашем списке нет открытых заявок. Сначала объект должен появиться в заявках — попросите офис добавить её, и ловушки можно будет подготовить.
            </div>
          )}
          <Button variant="plain" className="mt-3" onClick={() => setTasks(null)}>Закрыть</Button>
        </Sheet>
      )}

      {task && <PrepSheet task={task} onClose={() => { setTask(null); setTasks(null); }} onBack={() => setTask(null)} />}
    </>
  );
}

function PrepSheet({ task, onClose, onBack }: { task: Task; onClose: () => void; onBack: () => void }) {
  const cfg = useConfig();
  const toast = useToast();
  const [st, setSt] = useState<PrepState | null>(null);
  const [err, setErr] = useState('');
  const [code, setCode] = useState<string | null>(null); // отсканированная, ещё не привязанная этикетка
  const [manual, setManual] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState('');
  // выбор запоминается: обычно готовят партию одинаковых станций
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState('');
  const [number, setNumber] = useState('');

  useEffect(() => {
    api.prepOpen(task.id).then(setSt).catch((e: Error) => setErr(e.message));
  }, [task.id]);

  const tgt = cfg.stationTargets.find((x) => x.id === target);
  const targetLabel = (id: string) => cfg.stationTargets.find((x) => x.id === id)?.label ?? '';
  const prepared = st?.traps.filter((t) => t.prepared) ?? [];
  const installed = st?.traps.filter((t) => !t.prepared) ?? [];

  function gotCode(raw: string) {
    // тот же разбор, что на сервере: PT-XXXXXX (QR может быть ссылкой t.me/…?startapp=trap_PT-XXXXXX)
    const m = raw.toUpperCase().match(/PT-?([A-HJ-NP-Z2-9]{6})/);
    if (!m) { haptic.error(); toast('Это не QR-код ловушки', 'error'); return; }
    const c = `PT-${m[1]}`;
    if (st?.traps.some((t) => t.code === c)) { haptic.error(); toast(`Этикетка ${c} уже в этом объекте`, 'error'); return; }
    haptic.success();
    playSound('qr');
    setCode(c);
    setNumber(String(st?.next_number ?? ''));
  }

  async function scan() {
    haptic.tap();
    if (!canScanQr()) { setManual(true); return; }
    setScanning(true);
    try {
      const text = await scanQr();
      if (text) gotCode(text);
    } finally {
      setScanning(false);
    }
  }

  async function save(next: boolean) {
    if (!code) return;
    setBusy(true);
    try {
      const r = await api.prepAdd(task.id, { code, target, kind, number: Number(number) || undefined });
      haptic.success();
      setSt(r);
      setCode(null);
      toast(`Станция № ${number || r.next_number - 1} подготовлена`);
      if (next) setTimeout(scan, 300);
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (confirmDel !== id) { haptic.tap(); setConfirmDel(id); return; }
    try {
      setSt(await api.prepRemove(id));
      setConfirmDel('');
      haptic.success();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  if (manual) return <ManualSheet onClose={() => setManual(false)} onSubmit={(c) => { setManual(false); gotCode(c); }} />;

  // ---- форма новой этикетки ----
  if (code) {
    return (
      <Sheet open onClose={() => setCode(null)} title="Новая станция">
        <p className="-mt-3 mb-6 text-[15px] leading-relaxed text-muted">
          Этикетка <b className="font-mono font-semibold text-ink">{code}</b> привяжется к объекту «{st?.object.company_name}». Где именно поставить — отметите на месте.
        </p>
        <div className="space-y-6">
          <Field label="Против кого">
            <Chips options={cfg.stationTargets.map((x) => ({ id: x.id, label: x.label }))} value={target}
              onChange={(v) => { haptic.tap(); setTarget(v); if (!cfg.stationTargets.find((x) => x.id === v)?.devices.includes(kind)) setKind(''); }} columns={1} />
          </Field>
          {tgt && (
            <Field label="Устройство">
              <div className="grid gap-2">
                {tgt.devices.map((dv) => (
                  <button key={dv} onClick={() => { haptic.tap(); setKind(dv); }}
                    className={cx('flex min-h-[52px] items-center rounded-xl px-4 py-3 text-left text-[15px] font-medium transition',
                      kind === dv ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>
                    {dv}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Field label="Номер на объекте">
            <Input inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))} className="font-mono" />
          </Field>
        </div>
        <div className="mt-7 space-y-2">
          <Button disabled={!target || !kind} loading={busy} onClick={() => save(true)} icon={<ScanLine size={20} strokeWidth={1.75} />}>
            Сохранить и сканировать следующую
          </Button>
          <Button variant="secondary" disabled={!target || !kind || busy} onClick={() => save(false)}>Сохранить</Button>
        </div>
      </Sheet>
    );
  }

  // ---- объект и список станций ----
  return (
    <Sheet open onClose={onClose} title="Подготовка ловушек">
      <div className="-mt-3 mb-5 rounded-xl bg-card p-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Заявка № {task.task_no} · {fmtTaskDate(task)}</div>
        <div className="mt-1.5 text-[17px] font-semibold leading-snug">{st?.object.company_name || task.company_name || 'Объект'}</div>
        <div className="mt-1 flex items-start gap-1.5 text-[14.5px] leading-snug text-muted">
          <MapPin size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />{st?.object.address || task.address}
        </div>
      </div>

      {err ? (
        <div className="mb-4 rounded-xl bg-[#FF3B30]/10 p-4 text-[14.5px] leading-snug">{err}</div>
      ) : !st ? (
        <div className="mb-4 h-16 animate-pulse rounded-xl bg-card" />
      ) : (
        <>
          <div className="mb-2 flex items-baseline justify-between px-1">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Подготовлено к установке</span>
            <span className="font-dot text-[20px]">{prepared.length}</span>
          </div>
          {prepared.length ? (
            <Group>
              {prepared.map((t) => (
                <Row
                  key={t.id}
                  left={<IconBadge tone="gray"><span className="font-mono">{t.number}</span></IconBadge>}
                  title={t.kind}
                  subtitle={[targetLabel(t.target), t.code].filter(Boolean).join(' · ')}
                  right={confirmDel === t.id
                    ? <span className="rounded-full bg-[#FF3B30]/12 px-3 py-1 text-[13px] font-medium text-[#D70015] dark:text-[#FF453A]">Убрать?</span>
                    : <X size={18} strokeWidth={1.75} className="text-muted" />}
                  chevron={false}
                  onClick={() => remove(t.id)}
                />
              ))}
            </Group>
          ) : (
            <p className="mb-2 px-1 text-[14px] leading-relaxed text-muted">Пока нет. Наклейте этикетку на станцию и отсканируйте её.</p>
          )}
          {installed.length > 0 && (
            <>
              <div className="mb-2 mt-5 px-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Уже стоят на объекте · {installed.length}</div>
              <Group>
                {installed.map((t) => (
                  <Row key={t.id} left={<IconBadge tone="green"><span className="font-mono">{t.number}</span></IconBadge>}
                    title={t.location || t.kind} subtitle={[targetLabel(t.target), t.kind].filter(Boolean).join(' · ')}
                    right={<Pill tone="green">Стоит</Pill>} chevron={false} />
                ))}
              </Group>
            </>
          )}
        </>
      )}

      <div className="mt-5 space-y-2">
        <Button disabled={!st} loading={scanning} onClick={scan} icon={<ScanLine size={20} strokeWidth={1.75} />}>Сканировать этикетку</Button>
        <Button variant="plain" disabled={!st} onClick={() => setManual(true)} icon={<Keyboard size={18} strokeWidth={1.75} />}>Ввести код вручную</Button>
        <Button variant="secondary" onClick={onBack}>Другая заявка</Button>
      </div>
    </Sheet>
  );
}
