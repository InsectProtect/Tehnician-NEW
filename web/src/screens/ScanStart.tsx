import { useState } from 'react';
import { MapPin, ScanLine, Target } from 'lucide-react';
import { api } from '../api';
import { canScanQr, haptic, scanQr } from '../telegram';
import type { ScanLookup, Task } from '../types';
import { setPendingScan } from '../pendingScan';
import { GameButton } from '../components/game';
import { Button, Group, IconBadge, Row, Sheet, cx, useToast } from '../components/ui';
import { fmtTaskDate, TaskSheet } from './Tasks';
import { ManualSheet } from './VisitSheets';

/* ================================================================================================
 * «Сканировать QR» на главной (v56): отсканировали ловушку → видно, кому она принадлежит →
 * выбираете свою заявку (или продолжаете уже начатый выезд) → открывается выезд и обслуживание станций.
 * ================================================================================================ */

export function ScanButton({ onOpenVisit }: { onOpenVisit: (id: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [res, setRes] = useState<{ r: ScanLookup; tasks: Task[] } | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [others, setOthers] = useState(false);

  async function lookup(text: string) {
    setBusy(true);
    try {
      const [r, t] = await Promise.all([api.scanLookup(text), api.tasks()]);
      haptic.success();
      setOthers(false);
      setRes({ r, tasks: t.items });
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function scan() {
    haptic.tap();
    if (!canScanQr()) { setManual(true); return; }
    const text = await scanQr();
    if (text) await lookup(text);
  }

  function openVisit(visitId: string, code: string) {
    setPendingScan(visitId, code);
    setRes(null);
    setTask(null);
    onOpenVisit(visitId);
  }

  const matched = res ? res.tasks.filter((t) => res.r.task_ids.includes(t.id)) : [];
  const rest = res ? res.tasks.filter((t) => !res.r.task_ids.includes(t.id)) : [];

  const taskRow = (t: Task) => (
    <Row
      key={t.id}
      left={<IconBadge tone="blue"><span className="font-mono text-[13px]">№{t.task_no}</span></IconBadge>}
      title={t.company_name || t.address}
      subtitle={[t.company_name ? t.address : '', t.procedure, fmtTaskDate(t)].filter(Boolean).join(' · ')}
      onClick={() => { haptic.tap(); setTask(t); }}
    />
  );

  return (
    <>
      <GameButton className="mb-5" tone="orange" loading={busy} icon={<ScanLine size={20} strokeWidth={2.4} />} onClick={scan}>
        Сканировать QR
      </GameButton>

      {manual && <ManualSheet onClose={() => setManual(false)} onSubmit={(code) => { setManual(false); lookup(code); }} />}

      {res && !task && (
        <Sheet open onClose={() => setRes(null)} title="Ловушка">
          <div className="-mt-3 mb-5 rounded-2xl bg-card p-4">
            {res.r.object && res.r.trap ? (
              <>
                <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                  Станция № {res.r.trap.number}{res.r.trap.kind ? ` · ${res.r.trap.kind}` : ''}
                </div>
                <div className="mt-1.5 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">Принадлежит</div>
                <div className="text-[18px] font-extrabold leading-snug">{res.r.object.company_name}</div>
                <div className="mt-1 flex items-start gap-1.5 text-[14.5px] leading-snug text-muted">
                  <MapPin size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />{res.r.object.address}
                </div>
                {res.r.trap.location && <div className="mt-1.5 text-[13.5px] text-muted">Место: {res.r.trap.location}</div>}
                {res.r.state === 'inactive' && <div className="mt-2 text-[13.5px] font-medium text-[#C93400] dark:text-[#FF9F0A]">Станция снята с обслуживания.</div>}
              </>
            ) : (
              <>
                <div className="text-[17px] font-bold leading-snug">Этикетка {res.r.code} ещё не привязана</div>
                <div className="mt-1 text-[14px] leading-snug text-muted">Выберите заявку — станция привяжется к объекту этого выезда.</div>
              </>
            )}
          </div>

          {res.r.visit_id && (
            <Button className="mb-4" onClick={() => openVisit(res.r.visit_id!, res.r.code)} icon={<Target size={19} strokeWidth={1.75} />}>
              Продолжить выезд на этом объекте
            </Button>
          )}

          {res.r.state !== 'inactive' && (
            <>
              {res.r.state === 'found' && (
                <div className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                  {matched.length ? 'Ваши заявки по этому объекту' : 'По этому объекту у вас нет заявок'}
                </div>
              )}
              {matched.length > 0 && <Group>{matched.map(taskRow)}</Group>}

              {(rest.length > 0 && (res.r.state === 'new' || matched.length === 0 || others)) ? (
                <>
                  <div className={cx('mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted', matched.length > 0 || res.r.state === 'found' ? 'mt-4' : '')}>
                    {res.r.state === 'new' || matched.length === 0 ? 'Выберите заявку из вашего списка' : 'Другие мои заявки'}
                  </div>
                  <Group>{rest.map(taskRow)}</Group>
                </>
              ) : rest.length > 0 ? (
                <button onClick={() => { haptic.tap(); setOthers(true); }} className="mt-3 w-full px-1 py-2 text-left font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink">
                  Другая заявка из моего списка →
                </button>
              ) : null}

              {res.tasks.length === 0 && !res.r.visit_id && (
                <p className="px-1 text-[14px] leading-relaxed text-muted">В вашем списке нет открытых заявок. Когда заявка появится, отсканируйте QR ещё раз.</p>
              )}
            </>
          )}
          <Button variant="plain" className="mt-3" onClick={() => setRes(null)}>Закрыть</Button>
        </Sheet>
      )}

      {res && task && (
        <TaskSheet
          task={task}
          onClose={() => setTask(null)}
          onStarted={(visitId) => openVisit(visitId, res.r.code)}
          onCancelled={() => { setTask(null); setRes(null); }}
        />
      )}
    </>
  );
}
