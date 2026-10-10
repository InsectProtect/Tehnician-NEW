import { useEffect, useState } from 'react';
import { Archive, Ban, Check, Keyboard, MapPin, Minus, PackagePlus, Plus, ScanLine, Trash2 } from 'lucide-react';
import { api } from '../api';
import { plural, useConfig } from '../config';
import { canScanQr, haptic, scanQr } from '../telegram';
import type { PrepState, PrepTask, PrepTrap, Task } from '../types';
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
  const [tasks, setTasks] = useState<PrepTask[] | null>(null);
  const [stock, setStock] = useState(0);
  const [stockOpen, setStockOpen] = useState(false);
  const [task, setTask] = useState<Task | null>(null);

  async function open() {
    haptic.tap();
    setBusy(true);
    try {
      const r = await api.prepTasks();
      setTasks(r.items);
      setStock(r.stock);
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

      {tasks && !task && !stockOpen && (
        <Sheet open onClose={() => setTasks(null)} title="Подготовить ловушки">
          <p className="-mt-3 mb-4 text-[14.5px] leading-relaxed text-muted">
            Выберите заявку — станции привяжутся к её объекту. Можно готовить и для коллеги, или просто на склад — без объекта.
          </p>
          <div className="mb-5">
            <Group>
              <Row left={<IconBadge tone="orange"><Archive size={18} strokeWidth={1.75} /></IconBadge>}
                title={stock > 0 ? `На склад · в запасе ${stock} ${plural(stock, ['станция', 'станции', 'станций'])}` : 'На склад — без объекта'}
                subtitle="Подготовить станции заранее, не назначая на объект — потом забрать на любую заявку"
                onClick={() => { haptic.tap(); setStockOpen(true); }} />
            </Group>
          </div>
          {tasks.length ? (
            <>
              {[{ title: 'Мои заявки', list: tasks.filter((t) => t.mine) }, { title: 'Заявки коллег', list: tasks.filter((t) => !t.mine) }]
                .filter((g) => g.list.length)
                .map((g, i) => (
                  <div key={g.title} className={i ? 'mt-5' : undefined}>
                    <div className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{g.title} · {g.list.length}</div>
                    <Group>
                      {g.list.map((t) => (
                        <Row
                          key={t.id}
                          left={<IconBadge tone="blue"><span className="font-mono text-[13px]">№{t.task_no}</span></IconBadge>}
                          title={t.company_name || t.address}
                          subtitle={
                            <>
                              <div className="truncate">{[t.company_name ? t.address : '', fmtTaskDate(t)].filter(Boolean).join(' · ')}</div>
                              <div className="mt-0.5 truncate">{[!t.mine && t.tech_name ? `👷 ${t.tech_name}` : '', t.prepared ? `📦 готово ${t.prepared}` : ''].filter(Boolean).join(' · ') || t.procedure}</div>
                            </>
                          }
                          onClick={() => { haptic.tap(); setTask(t); }}
                        />
                      ))}
                    </Group>
                  </div>
                ))}
            </>
          ) : (
            <div className="rounded-2xl bg-card p-4 text-[14.5px] leading-relaxed text-muted">
              Открытых заявок нет. Можно подготовить станции на склад (выше) — а когда появится заявка, забрать их на объект.
            </div>
          )}
          <Button variant="plain" className="mt-3" onClick={() => setTasks(null)}>Закрыть</Button>
        </Sheet>
      )}

      {stockOpen && <StockSheet onClose={() => { setStockOpen(false); open(); }} />}
      {task && <PrepSheet task={task} onClose={() => { setTask(null); setTasks(null); }} onBack={() => { setTask(null); open(); }} />}
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
  const [action, setAction] = useState<PrepTrap | null>(null); // станция, по которой открыто меню «в запас / удалить»
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pickStock, setPickStock] = useState(false);
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

  async function gotCode(raw: string) {
    // тот же разбор, что на сервере: PT-XXXXXX (QR может быть ссылкой t.me/…?startapp=trap_PT-XXXXXX)
    const m = raw.toUpperCase().match(/PT-?([A-HJ-NP-Z2-9]{6})/);
    if (!m) { haptic.error(); toast('Это не QR-код ловушки', 'error'); return; }
    const c = `PT-${m[1]}`;
    if (st?.traps.some((t) => t.code === c)) { haptic.error(); toast(`Этикетка ${c} уже в этом объекте`, 'error'); return; }
    try {
      // станция из запаса забирается сразу; занятая другим объектом — ошибка; новая — форма
      const r = await api.prepAdd(task.id, { code: c, check: true });
      if (r.from_stock) { haptic.success(); playSound('qr'); setSt(r); toast(`${c} взята из запаса`); return; }
      if (!r.new_code) { haptic.error(); toast(`Этикетка ${c} уже привязана: ${r.busy}`, 'error'); return; }
      setSt(r);
      haptic.success();
      playSound('qr');
      setCode(c);
      setNumber(String(r.next_number ?? ''));
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
    }
  }

  async function run(p: Promise<PrepState>, done?: (r: PrepState) => void) {
    setBusy(true);
    try {
      const r = await p;
      haptic.success();
      setSt(r);
      done?.(r);
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // «−» — последняя станция уходит в запас; «+» — берём из запаса, а если пусто — сканируем новую
  function changeCount(delta: number) {
    haptic.tap();
    if (delta > 0 && !st?.stock) { scan(); return; }
    run(api.prepCount(task.id, prepared.length + delta), (r) => {
      if (r.moved) toast(`${r.moved} → в запас`);
      if (r.taken) toast(`${r.taken} из запаса`);
    });
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

  if (pickStock) {
    return <StockSheet pick onClose={() => setPickStock(false)}
      onPick={(ids) => run(api.prepFromStock(task.id, ids), (r) => { setPickStock(false); toast(`Взято из запаса: ${r.taken}`); })} />;
  }

  if (action) {
    return (
      <Sheet open onClose={() => setAction(null)} title={`Станция № ${action.number}`}>
        <div className="-mt-3 mb-5 rounded-xl bg-card px-4 py-3.5">
          <div className="text-[16px] font-semibold">{action.kind}</div>
          <div className="mt-0.5 text-[14px] text-muted">{[targetLabel(action.target), action.code].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="space-y-2">
          <Button loading={busy} onClick={() => run(api.prepToStock(action.id), () => { setAction(null); toast('Станция в запасе'); })}
            icon={<Archive size={19} strokeWidth={1.75} />}>Вернуть в запас</Button>
          <p className="px-1 pb-2 text-[13px] leading-snug text-muted">Станция останется готовой — её можно забрать на другую заявку или другого клиента.</p>
          <Button variant="danger" disabled={busy} onClick={() => run(api.prepRemove(action.id), () => { setAction(null); toast('Станция удалена'); })}
            icon={<Trash2 size={18} strokeWidth={1.75} />}>Удалить совсем</Button>
          <p className="px-1 text-[13px] leading-snug text-muted">Если этикетка испорчена или станцию разобрали. Код этикетки освободится.</p>
          <Button variant="plain" onClick={() => setAction(null)}>Отмена</Button>
        </div>
      </Sheet>
    );
  }

  if (cancelOpen) {
    return (
      <Sheet open onClose={() => setCancelOpen(false)} title="Клиент отказался от ловушек">
        <p className="-mt-3 mb-5 text-[14.5px] leading-relaxed text-muted">
          Подготовлено {prepared.length} {plural(prepared.length, ['станция', 'станции', 'станций'])}. Что с ними сделать?
        </p>
        <div className="space-y-3">
          <button disabled={busy} onClick={() => run(api.prepCancel(task.id, 'stock'), (r) => { setCancelOpen(false); toast(`В запас: ${r.moved}`); })}
            className="w-full rounded-xl bg-card p-4 text-left ring-1 ring-inset ring-line active:opacity-70 disabled:opacity-50">
            <div className="flex items-center gap-2 text-[16px] font-semibold"><Archive size={18} strokeWidth={1.75} />Вернуть в запас</div>
            <div className="mt-1 text-[13.5px] leading-snug text-muted">Станции освободятся — их можно забрать на любую другую заявку.</div>
          </button>
          <button disabled={busy} onClick={() => run(api.prepCancel(task.id, 'keep'), () => { setCancelOpen(false); toast('Оставлены за клиентом'); })}
            className="w-full rounded-xl bg-card p-4 text-left ring-1 ring-inset ring-line active:opacity-70 disabled:opacity-50">
            <div className="flex items-center gap-2 text-[16px] font-semibold"><MapPin size={18} strokeWidth={1.75} />Оставить за клиентом — на другой раз</div>
            <div className="mt-1 text-[13.5px] leading-snug text-muted">Станции останутся привязаны к этому объекту. На этом выезде мониторинг не включится сам; поставить их можно в следующий раз.</div>
          </button>
        </div>
        <Button variant="plain" className="mt-3" onClick={() => setCancelOpen(false)}>Отмена</Button>
      </Sheet>
    );
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
        {task.tech_name && <div className="mt-1 text-[13.5px] text-muted">👷 Поедет: {task.tech_name}</div>}
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
          {st.skip && prepared.length > 0 && (
            <div className="mb-3 rounded-xl bg-[#FF9500]/12 px-4 py-3 text-[14px] leading-snug">
              Клиент отказался — станции оставлены за ним на другой раз. Мониторинг на выезде сам не включится.
            </div>
          )}
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-3">
            <div className="min-w-0">
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Подготовлено к установке</div>
              <div className="mt-0.5 text-[12.5px] text-muted">{st.stock ? `в запасе ещё ${st.stock}` : 'запас пуст — «+» сканирует новую'}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button aria-label="Меньше" disabled={busy || prepared.length === 0} onClick={() => changeCount(-1)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-fill active:opacity-70 disabled:opacity-30">
                <Minus size={18} strokeWidth={2} />
              </button>
              <span className="w-10 text-center font-dot text-[26px] leading-none">{prepared.length}</span>
              <button aria-label="Больше" disabled={busy} onClick={() => changeCount(1)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-fill active:opacity-70 disabled:opacity-30">
                <Plus size={18} strokeWidth={2} />
              </button>
            </div>
          </div>
          {prepared.length ? (
            <Group>
              {prepared.map((t) => (
                <Row
                  key={t.id}
                  left={<IconBadge tone="gray"><span className="font-mono">{t.number}</span></IconBadge>}
                  title={t.kind}
                  subtitle={[targetLabel(t.target), t.code, t.prepared_by ? `готовил ${t.prepared_by}` : ''].filter(Boolean).join(' · ')}
                  onClick={() => { haptic.tap(); setAction(t); }}
                />
              ))}
            </Group>
          ) : (
            <p className="mb-2 px-1 text-[14px] leading-relaxed text-muted">Пока нет. Наклейте этикетку на станцию и отсканируйте её{st.stock ? ' или возьмите готовые из запаса' : ''}.</p>
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
        {(st?.stock ?? 0) > 0 && (
          <Button variant="secondary" onClick={() => { haptic.tap(); setPickStock(true); }} icon={<Archive size={18} strokeWidth={1.75} />}>
            Взять из запаса · {st!.stock}
          </Button>
        )}
        <Button variant="plain" disabled={!st} onClick={() => setManual(true)} icon={<Keyboard size={18} strokeWidth={1.75} />}>Ввести код вручную</Button>
        <Button variant="secondary" onClick={onBack}>Другая заявка</Button>
        {prepared.length > 0 && (
          <Button variant="plain" onClick={() => { haptic.tap(); setCancelOpen(true); }} icon={<Ban size={18} strokeWidth={1.75} />}>
            <span className="text-[#D70015] dark:text-[#FF453A]">Клиент отказался от ловушек</span>
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/** Запас: подготовленные станции без объекта. pick — выбрать и забрать на заявку; иначе — просмотр и удаление. */
function StockSheet({ pick, onPick, onClose }: { pick?: boolean; onPick?: (ids: string[]) => void; onClose: () => void }) {
  const cfg = useConfig();
  const toast = useToast();
  const [list, setList] = useState<PrepTrap[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [confirmDel, setConfirmDel] = useState('');
  const load = () => api.prepStock().then((r) => setList(r.traps)).catch((e: Error) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const targetLabel = (id: string) => cfg.stationTargets.find((x) => x.id === id)?.label ?? '';

  // v74: подготовка на склад — скан этикетки → против кого/устройство (запоминаются для следующей)
  const [code, setCode] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [target, setTarget] = useState(() => { try { return localStorage.getItem('stock_target') || ''; } catch { return ''; } });
  const [kind, setKind] = useState(() => { try { return localStorage.getItem('stock_kind') || ''; } catch { return ''; } });
  const [busy, setBusy] = useState(false);
  const tgt = cfg.stationTargets.find((x) => x.id === target);

  async function gotCode(text: string) {
    try {
      const r = await api.stockCheck(text);
      if (!r.new_code) { haptic.error(); toast(`${r.code}: ${r.busy}`, 'error'); return; }
      haptic.success(); playSound('qr');
      setCode(r.code);
    } catch (e) { haptic.error(); toast((e as Error).message, 'error'); }
  }
  async function scan() {
    if (!canScanQr()) { setManual(true); return; }
    const t = await scanQr();
    if (t) await gotCode(t);
  }
  async function save(next: boolean) {
    if (!code) return;
    setBusy(true);
    try {
      const r = await api.stockAdd(code, target, kind);
      try { localStorage.setItem('stock_target', target); localStorage.setItem('stock_kind', kind); } catch { /* не критично */ }
      haptic.success();
      setList(r.traps);
      setCode(null);
      toast(`На складе: ${r.traps.length}`);
      if (next) setTimeout(scan, 300);
    } catch (e) { haptic.error(); toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (confirmDel !== id) { haptic.tap(); setConfirmDel(id); return; }
    try { await api.prepRemove(id); haptic.success(); setConfirmDel(''); load(); } catch (e) { toast((e as Error).message, 'error'); }
  }

  if (manual) return <ManualSheet onClose={() => setManual(false)} onSubmit={(c) => { setManual(false); gotCode(c); }} />;

  if (code) {
    return (
      <Sheet open onClose={() => setCode(null)} title="Станция на склад">
        <p className="-mt-3 mb-6 text-[15px] leading-relaxed text-muted">
          Этикетка <b className="font-mono font-semibold text-ink">{code}</b> уйдёт в запас без объекта. Номер станции присвоится, когда её заберут на заявку.
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
        </div>
        <div className="mt-7 space-y-2">
          <Button disabled={!tgt || !tgt.devices.includes(kind)} loading={busy} onClick={() => save(true)} icon={<ScanLine size={20} strokeWidth={1.75} />}>
            На склад и сканировать следующую
          </Button>
          <Button variant="secondary" disabled={!tgt || !tgt.devices.includes(kind) || busy} onClick={() => save(false)}>На склад</Button>
        </div>
      </Sheet>
    );
  }

  // сводка запаса: назначение · устройство → сколько
  const summary = Object.entries((list || []).reduce<Record<string, number>>((a, t) => {
    const k = [targetLabel(t.target), t.kind].filter(Boolean).join(' · ');
    a[k] = (a[k] || 0) + 1; return a;
  }, {}));

  return (
    <Sheet open onClose={onClose} title={pick ? 'Взять из запаса' : 'Склад станций'}>
      <p className="-mt-3 mb-4 text-[14.5px] leading-relaxed text-muted">
        {pick ? 'Отметьте станции — они привяжутся к объекту заявки. Можно и просто отсканировать этикетку станции из запаса.'
          : 'Готовые станции без объекта. Готовьте заранее — потом заберите на заявку в «Подготовке ловушек» или просто отсканируйте станцию на объекте.'}
      </p>
      {!pick && (
        <div className="mb-4 space-y-2">
          <Button onClick={scan} icon={<ScanLine size={20} strokeWidth={1.75} />}>Подготовить на склад — сканировать</Button>
          <Button variant="plain" onClick={() => setManual(true)} icon={<Keyboard size={18} strokeWidth={1.75} />}>Ввести код вручную</Button>
        </div>
      )}
      {!pick && summary.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {summary.map(([k, n]) => <Pill key={k}>{k}: {n}</Pill>)}
        </div>
      )}
      {!list ? <div className="h-16 animate-pulse rounded-xl bg-card" /> : list.length === 0 ? (
        <div className="rounded-xl bg-card p-4 text-[14.5px] text-muted">{pick ? 'Запас пуст.' : 'На складе пока пусто — наклейте этикетку на станцию и отсканируйте.'}</div>
      ) : (
        <>
          {pick && (
            <button onClick={() => { haptic.tap(); setSel(sel.length === list.length ? [] : list.map((t) => t.id)); }}
              className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink">
              {sel.length === list.length ? 'Снять все' : `Выбрать все · ${list.length}`}
            </button>
          )}
          <Group>
            {list.map((t) => (
              <Row
                key={t.id}
                left={<IconBadge tone={sel.includes(t.id) ? 'blue' : 'gray'}>{sel.includes(t.id) ? <Check size={18} strokeWidth={2} /> : <Archive size={17} strokeWidth={1.75} />}</IconBadge>}
                title={t.kind}
                subtitle={[targetLabel(t.target), t.code, t.prepared_by ? `готовил ${t.prepared_by}` : ''].filter(Boolean).join(' · ')}
                selected={sel.includes(t.id)}
                chevron={false}
                right={!pick ? (confirmDel === t.id
                  ? <span className="rounded-full bg-[#FF3B30]/12 px-3 py-1 text-[13px] font-medium text-[#D70015] dark:text-[#FF453A]">Удалить?</span>
                  : <Trash2 size={17} strokeWidth={1.75} className="text-muted" />) : undefined}
                onClick={() => (pick ? (haptic.tap(), setSel((s) => (s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id]))) : remove(t.id))}
              />
            ))}
          </Group>
        </>
      )}
      <div className="mt-4 space-y-2">
        {pick && <Button disabled={!sel.length} onClick={() => onPick?.(sel)}>Забрать {sel.length || ''}</Button>}
        <Button variant="plain" onClick={onClose}>{pick ? 'Отмена' : 'Закрыть'}</Button>
      </div>
    </Sheet>
  );
}
