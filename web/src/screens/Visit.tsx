import { useCallback, useEffect, useState } from 'react';
import { Camera, CheckCircle2, MessageSquareWarning, Phone, ChevronDown, FileText, Keyboard, Lightbulb, MapPin, Pencil, ScanLine, Send, Share2, Target, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { fmtDate, plural, useConfig } from '../config';
import { callPhone, canScanQr, getLocation, haptic, openLink, prettyPhone, scanQr, useBackButton } from '../telegram';
import type { Observation, Reward, Task, Trap, Visit } from '../types';
import { QuestPath } from '../components/game';
import { RewardSheet } from './Play';
import { ClientActions, dealLabel, fmtTaskDate, MULT_PRESETS, PhoneSheet } from './Tasks';
import {
  Button, Chips, ConfirmSheet, Empty, Field, Group, IconBadge, Input, LargeTitle, MultPill, MultiChips, Pill, Row, Screen, SectionTitle, Segmented, Sheet, Spinner, cx, statusTone, useToast,
} from '../components/ui';
import { PaymentBadge } from '../components/Payment';
import { ActData, type ActPatch } from './ActData';
import { ShareSheet } from '../components/ShareSheet';
import { MediaCard } from '../components/MediaUpload';
import { FinishSheet, InspectSheet, ManualSheet, MessageSheet, ObservationSheet, RegisterSheet, RemarkSheet } from './VisitSheets';
import { playSound } from '../sounds';
import { takePendingScan } from '../pendingScan';

type SheetState =
  | null
  | { type: 'inspect'; trap: Trap; back?: boolean }
  | { type: 'scanned'; trap: Trap } // отсканирована станция этого объекта: пока не подтверждено «я на объекте» — спрашиваем
  | { type: 'service'; focusId?: string } // список всех станций объекта к обслуживанию
  | { type: 'register'; code: string; next: number }
  | { type: 'manual' }
  | { type: 'finish' }
  | { type: 'observation' }
  | { type: 'message'; title: string; text: string };

export function VisitScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const [reward, setReward] = useState<Reward | null>(null);
  const cfg = useConfig();
  const toast = useToast();
  const [data, setData] = useState<{ visit: Visit; traps: Trap[]; observations: Observation[]; task: Task | null } | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState('');
  const [sending, setSending] = useState(false);
  const [recsOpen, setRecsOpen] = useState(false);
  const [confirm, setConfirm] = useState<'reopen' | 'delete' | 'undo' | 'annul' | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [scanning, setScanning] = useState(false);
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  // «Я на объекте» подтверждён при первом скане станции — запоминаем на выезд, чтобы не спрашивать каждый раз
  const [onSiteOk, setOnSiteOk] = useState(() => { try { return localStorage.getItem(`onsite:${id}`) === '1'; } catch { return false; } });

  useBackButton(onBack);

  const [loadErr, setLoadErr] = useState('');
  const [slow, setSlow] = useState(false);
  const load = useCallback(
    () => api.visit(id).then((d) => { setData(d); setLoadErr(''); }).catch((e: Error) => { setLoadErr(e.message); toast(e.message, 'error'); }),
    [id, toast],
  );
  useEffect(() => { load(); }, [load]);
  // сервер на бесплатном Render мог «проснуться» не сразу — через 12 с показываем «Повторить» вместо бесконечной загрузки
  useEffect(() => { const t = setTimeout(() => setSlow(true), 12000); return () => clearTimeout(t); }, []);

  const handleCode = useCallback(async (text: string) => {
    setScanning(true);
    try {
      const r = await api.scan(id, text);
      haptic.success();
      if (r.state === 'found' || r.state === 'new') playSound('qr');
      if (r.state === 'found') setSheet({ type: 'scanned', trap: r.trap });
      else if (r.state === 'new') setSheet({ type: 'register', code: r.code, next: r.next_number });
      else if (r.state === 'other_object')
        setSheet({ type: 'message', title: 'Ловушка другого объекта', text: `Этикетка ${r.code} привязана к адресу: ${r.object?.company_name ?? ''}, ${r.object?.address ?? ''}. Вы оформляете выезд по другому адресу — сверьте объект.` });
      else setSheet({ type: 'message', title: 'Ловушка снята', text: `Ловушка ${r.code} отключена на этом объекте.` });
    } catch (e) {
      haptic.error();
      setSheet(null);
      toast((e as Error).message, 'error');
    } finally {
      setScanning(false);
    }
  }, [id, toast]);

  const startScan = useCallback(async () => {
    if (!canScanQr()) {
      setSheet({ type: 'manual' });
      return;
    }
    const text = await scanQr();
    if (text) await handleCode(text);
  }, [handleCode]);

  // код, отсканированный на главной до старта выезда — сразу обрабатываем (вопрос «Вы на объекте?» → список станций)
  useEffect(() => {
    if (!data) return;
    const c = takePendingScan(id);
    if (c) handleCode(c);
  }, [data, id, handleCode]);

  if (!data) {
    if (!loadErr && !slow) return <Spinner />;
    return (
      <Screen>
        <LargeTitle title="Выезд" onBack={onBack} />
        <div className="rounded-2xl bg-card p-5">
          <div className="text-[17px] font-semibold">{loadErr ? 'Не удалось открыть выезд' : 'Сервер отвечает долго'}</div>
          <div className="mt-1 text-[14px] leading-snug text-muted">{loadErr || 'Проверьте интернет и попробуйте ещё раз.'}</div>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Button variant="secondary" onClick={onBack}>Назад</Button>
            <Button onClick={() => { setLoadErr(''); setSlow(false); load(); setTimeout(() => setSlow(true), 12000); }}>Повторить</Button>
          </div>
        </div>
      </Screen>
    );
  }
  const { visit, traps, observations } = data;
  const isOpen = visit.status === 'open';

  // Выезд без заявки ждёт решения администратора — работать с ним пока нельзя
  if (isOpen && visit.approval) {
    const pending = visit.approval === 'pending';
    return (
      <Screen>
        <LargeTitle eyebrow={`Выезд без заявки · ${visit.procedure}`} title={visit.company_name} onBack={onBack}
          subtitle={<span className="flex items-start gap-1.5"><MapPin size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />{visit.address}</span>} />
        <div className={cx('rounded-[22px] p-5', pending ? 'bg-accent/12' : 'bg-[#D71921]/10')}>
          <div className="text-[18px] font-semibold">{pending ? '⏳ Ждёт подтверждения администратора' : '❌ Выезд отклонён'}</div>
          <div className="mt-1.5 text-[14.5px] leading-snug text-muted">
            {pending
              ? cfg.isAdmin ? `Запросил ${visit.tech_name}.` : 'Администратор получил запрос в Telegram. Как только он подтвердит, придёт уведомление — и можно работать.'
              : `${visit.approved_by ? `${visit.approved_by}: ` : ''}${visit.approval_note || 'без комментария'}`}
          </div>
          <div className="mt-3 space-y-1 rounded-2xl bg-card px-4 py-3 text-[14.5px]">
            <div>🐞 {[visit.procedure, visit.pests.join(', ')].filter(Boolean).join(' · ')}</div>
            {visit.premises.length > 0 && (
              <div>🏠 {visit.premises.map((pid) => cfg.premises.find((p) => p.id === pid)?.label ?? pid).join(', ')}{visit.rooms ? ` · ${visit.rooms} комн.` : ''}</div>
            )}
            {visit.unplanned_reason && <div>💬 {visit.unplanned_reason}</div>}
          </div>
          {visit.can_approve && (
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <Button variant="danger" className="h-[48px] text-[15px]" onClick={async () => {
                try { await api.approveVisit(visit.id, false); haptic.success(); load(); } catch (e) { toast((e as Error).message, 'error'); }
              }}>Отклонить</Button>
              <Button className="h-[48px] text-[15px]" onClick={async () => {
                try { await api.approveVisit(visit.id, true); haptic.success(); toast('Выезд подтверждён'); load(); } catch (e) { toast((e as Error).message, 'error'); }
              }}>Подтвердить</Button>
            </div>
          )}
          {pending && !cfg.isAdmin && (
            <Button variant="secondary" className="mt-4 h-[48px] text-[15px]" onClick={() => { haptic.tap(); load(); }}>Проверить</Button>
          )}
        </div>
        {visit.can_delete && (
          <Button className="mt-4" variant="plain" onClick={async () => {
            try { await api.deleteVisit(visit.id, pending ? 'отменён до подтверждения' : 'отклонён'); toast('Удалено'); onBack(); } catch (e) { toast((e as Error).message, 'error'); }
          }}>
            <span className="text-[#D71921] dark:text-[#FF4D4D]">{pending ? 'Отменить запрос' : 'Удалить выезд'}</span>
          </Button>
        )}
      </Screen>
    );
  }
  const checked = traps.filter((t) => t.inspection);
  const activity = checked.filter((t) => t.inspection?.status === 'activity').length;
  const issues = checked.filter((t) => ['damaged', 'missing'].includes(t.inspection?.status ?? '')).length;
  const pct = traps.length ? Math.round((checked.length / traps.length) * 100) : 0;
  const onSite = onSiteOk || checked.length > 0; // уже есть проверенные станции — значит, на объекте
  const statusLabel = (s: string) => cfg.statuses.find((x) => x.id === s)?.label ?? s;
  // Станции мониторинга: у юрлица спрашиваем, нужны ли они; у физлица — как раньше (дератизация или уже есть ловушки)
  const monitoringOn = visit.monitoring === true || (visit.monitoring === null && traps.some((t) => t.inspection));
  const q = Boolean(visit.quick); // быстрый акт: только адрес и вредители
  const askMonitoring = !q && isOpen && visit.is_company && visit.monitoring === null && !traps.some((t) => t.inspection);
  const trapFocus = visit.is_company ? monitoringOn : visit.procedure === 'Дератизация' || traps.length > 0;
  // в быстром акте станции показываем только если на объекте они уже были — отдельный акт с ловушками соберётся в приложении
  const showTraps = (!q || traps.length > 0) && (visit.is_company ? monitoringOn : trapFocus || isOpen);
  const targetLabel = (id: string) => cfg.stationTargets.find((x) => x.id === id)?.label ?? '';
  const baitLabel = (id: string) => cfg.baitLevels.find((x) => x.id === id)?.label ?? '';
  const trapResult = (t: Trap) => {
    const i = t.inspection;
    if (!i) return '';
    return [i.bait_eaten ? `приманка: ${baitLabel(i.bait_eaten).toLowerCase()}` : '', i.count > 0 ? `${i.pest} ×${i.count}` : '', i.bait_replaced ? 'заменено' : '']
      .filter(Boolean).join(' · ');
  };

  async function setMonitoring(enabled: boolean) {
    haptic.tap();
    setData((d) => (d ? { ...d, visit: { ...d.visit, monitoring: enabled } } : d));
    try {
      await api.setMonitoring(id, enabled);
      if (enabled && traps.length === 0) setTimeout(startScan, 250);
    } catch (e) {
      toast((e as Error).message, 'error');
      load();
    }
  }

  /** «Да, я на объекте»: запоминаем, включаем мониторинг (у юрлица) и показываем список всех станций к обслуживанию. */
  async function confirmOnSite(trap: Trap) {
    haptic.success();
    setOnSiteOk(true);
    try { localStorage.setItem(`onsite:${id}`, '1'); } catch { /* без хранилища — спросим снова при следующем скане */ }
    if (visit.is_company && visit.monitoring !== true) {
      setData((d) => (d ? { ...d, visit: { ...d.visit, monitoring: true } } : d));
      api.setMonitoring(id, true).catch(() => load());
    }
    setSheet({ type: 'service', focusId: trap.id });
  }

  const inspectEl = (trap: Trap, back = false) => (
    <InspectSheet
      key={trap.id}
      visitId={id}
      trap={trap}
      onClose={() => setSheet(back ? { type: 'service', focusId: trap.id } : null)}
      onSaved={(next) => {
        load();
        if (next) { setSheet(null); setTimeout(startScan, 350); }
        else setSheet(back ? { type: 'service' } : null);
      }}
    />
  );

  async function setAssessment(field: 'infestation' | 'preparation' | 'pests' | 'premises' | 'reentry', value: string | string[]) {
    haptic.tap();
    setData((d) => (d ? { ...d, visit: { ...d.visit, [field]: value, ...(field === 'reentry' ? { reentry_custom: Boolean(value) } : {}) } } : d));
    try {
      const r = await api.patchVisit(id, { [field]: value });
      setData((d) => (d ? { ...d, visit: { ...d.visit, recommendations: r.recommendations, reentry: r.reentry, reentry_default: r.reentry_default } } : d));
    } catch (e) {
      toast((e as Error).message, 'error');
      load();
    }
  }

  async function setQuick(on: boolean) {
    haptic.tap();
    setData((d) => (d ? { ...d, visit: { ...d.visit, quick: on } } : d));
    try { await api.patchVisit(id, { quick: on }); load(); } catch (e) { toast((e as Error).message, 'error'); load(); }
  }

  async function setPoints(p: { point_cat?: string; point_zone?: string; rooms?: number | null; sotki?: number | string | null }) {
    haptic.tap();
    setData((d) => (d ? { ...d, visit: { ...d.visit, ...p, sotki: p.sotki !== undefined ? (p.sotki == null ? null : Number(String(p.sotki).replace(',', '.'))) : d.visit.sotki } } : d));
    try {
      await api.patchVisit(id, p);
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
      load();
    }
  }

  async function shareGeo() {
    haptic.tap();
    setGeoBusy(true);
    try {
      const pos = await getLocation();
      if (!pos) { toast('Нет доступа к геолокации — разрешите её для Telegram в настройках телефона', 'error'); return; }
      const r = await api.visitGeo(id, pos.lat, pos.lon);
      haptic.success();
      toast(`📍 ${String(r.km).replace('.', ',')} км от Кишинёва — ${r.zone_label}`);
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setGeoBusy(false);
    }
  }

  async function patchAct(p: ActPatch) {
    setData((d) => (d ? { ...d, visit: { ...d.visit, ...p } } : d));
    try {
      await api.patchVisit(id, p);
    } catch (e) {
      toast((e as Error).message, 'error');
      load();
    }
  }

  async function removeObservation(obsId: string) {
    if (confirmDel !== obsId) {
      setConfirmDel(obsId);
      return;
    }
    try {
      await api.deleteObservation(obsId);
      setConfirmDel('');
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function sendOffice() {
    setSending(true);
    try {
      await api.sendOffice(id);
      haptic.success();
      toast('Отчёт отправлен в офис');
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSending(false);
    }
  }

  const label = (list: { id: string; label: string }[], v: string) => list.find((x) => x.id === v)?.label ?? '—';
  const pestOptions = cfg.pestsByProcedure?.[visit.procedure] ?? [];

  const scanButtons = isOpen && (
    <div className="mt-4 space-y-2">
      <Button className={trapFocus ? 'h-[56px]' : undefined} variant={trapFocus ? 'primary' : 'secondary'} onClick={startScan} loading={scanning}
        icon={<ScanLine size={22} strokeWidth={1.75} />}>
        {trapFocus ? 'Сканировать QR' : 'Сканировать QR ловушки'}
      </Button>
      {traps.length > 0 && onSite && (
        <Button variant="secondary" onClick={() => setSheet({ type: 'service' })} icon={<Target size={18} strokeWidth={1.75} />}>
          Список станций к обслуживанию
        </Button>
      )}
      <Button variant="plain" onClick={() => setSheet({ type: 'manual' })} icon={<Keyboard size={18} strokeWidth={1.75} />}>
        Ввести код вручную
      </Button>
    </div>
  );

  const trapList = traps.length === 0 ? (
    trapFocus ? (
      <Empty icon={<Target size={44} strokeWidth={1.25} />} title="Станций пока нет" text="Отсканируйте QR-этикетку на станции — она привяжется к юрлицу и адресу." />
    ) : null
  ) : (
    <Group>
      {traps.map((t) => (
        <Row
          key={t.id}
          left={<IconBadge tone={t.inspection ? statusTone(t.inspection.status) : 'gray'}><span className="font-mono">{t.number}</span></IconBadge>}
          title={t.location || t.kind}
          subtitle={
            <>
              <div className="truncate">{[targetLabel(t.target), t.kind].filter(Boolean).join(' · ')}</div>
              {trapResult(t) && <div className="mt-0.5 truncate text-ink">{trapResult(t)}</div>}
            </>
          }
          right={t.inspection ? <Pill tone={statusTone(t.inspection.status)}>{statusLabel(t.inspection.status)}</Pill> : <Pill>Не проверена</Pill>}
          chevron={false}
          onClick={isOpen ? () => (t.inspection ? setSheet({ type: 'inspect', trap: t }) : toast('Отсканируйте QR-код на станции')) : undefined}
        />
      ))}
    </Group>
  );

  return (
    <Screen>
      <LargeTitle
        eyebrow={`${visit.lead_id ? 'Заявка · ' : ''}${visit.procedure} · № ${visit.act_no}${visit.revision ? ` · ред. ${visit.revision}` : ''}`}
        title={visit.company_name}
        onBack={onBack}
        right={isOpen ? <Pill tone="blue">В работе</Pill> : <Pill tone="green">Завершён</Pill>}
        subtitle={
          <span className="flex items-start gap-1.5">
            <MapPin size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            <span>
              {visit.address}
              {dealLabel(visit) && <span className="mt-1 block font-dot text-[13px] text-accent-ink">{dealLabel(visit)}</span>}
              {(visit.mult_now ?? 1) > 1 && <span className="mt-1.5 block"><MultPill m={visit.mult_now} /></span>}
            </span>
          </span>
        }
      />
      {!cfg.isAdmin && isOpen && !visit.revision && <QuestPath step={2} className="mb-4" />}

      {data.task && isOpen && (
        <div className="mb-4 rounded-2xl bg-accent/[0.06] p-4 text-[15px]">
          <div className="mb-1 text-[13px] font-medium uppercase tracking-wide text-muted">Заявка № {data.task.task_no} · {fmtTaskDate(data.task)}</div>
          {data.task.phone && (
            <button onClick={() => { haptic.tap(); callPhone(data.task!.phone, () => setPhoneOpen(true)); }} className="flex items-center gap-2 font-medium text-accent-ink">
              <Phone size={16} strokeWidth={1.75} />{prettyPhone(data.task.phone)}
            </button>
          )}
          {data.task.comment && <div className="mt-1 whitespace-pre-line">{data.task.comment}</div>}
          {data.observations.length === 0 && data.traps.every((t) => !t.inspection) && (
            <div className="mt-3"><ClientActions task={data.task} onChanged={onBack} /></div>
          )}
          {visit.can_undo_start && (
            <button onClick={() => { haptic.tap(); setConfirm('undo'); }}
              className="mt-3 flex h-[42px] w-full items-center justify-center gap-2 rounded-full text-[14px] font-medium text-muted ring-1 ring-inset ring-line active:opacity-70">
              ↩︎ Нажал «Приступить» по ошибке — вернуть заявку
            </button>
          )}
        </div>
      )}

      {isOpen && (
        <div className="mb-4">
          <Segmented<'full' | 'quick'>
            options={[{ id: 'full', label: 'Полный акт' }, { id: 'quick', label: '⚡ Быстрый акт' }]}
            value={q ? 'quick' : 'full'}
            onChange={(v) => setQuick(v === 'quick')}
          />
          {q && <div className="mt-2 px-1 text-[12.5px] leading-snug text-muted">Клиент получит одну страницу: адрес, тип вредителя, подписи и печать. Отметьте вредителей и категорию объекта — и завершайте.</div>}
        </div>
      )}
      {isOpen && !cfg.isAdmin && <div className="mb-4"><MediaCard visitId={visit.id} compact /></div>}
      {askMonitoring && (
        <div className="mb-4 rounded-[22px] bg-card p-5">
          <div className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />Станции мониторинга
          </div>
          <div className="mt-2 text-[17px] font-semibold leading-snug">Нужны станции мониторинга на этом объекте?</div>
          <div className="mt-1 text-[14px] leading-snug text-muted">
            {traps.length
              ? `На объекте уже ${traps.length} ${plural(traps.length, ['станция', 'станции', 'станций'])} — их нужно проверить и записать в журнал.`
              : 'Если да — сканируете QR на каждой станции, отмечаете приманку и улов. Всё попадёт в электронный журнал PDF.'}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Button variant="secondary" className="h-[48px] text-[15px]" onClick={() => setMonitoring(false)}>Нет</Button>
            <Button className="h-[48px] text-[15px]" onClick={() => setMonitoring(true)} icon={<ScanLine size={18} strokeWidth={1.75} />}>Да, QR</Button>
          </div>
        </div>
      )}
      {!q && isOpen && visit.is_company && visit.monitoring === false && (
        <button onClick={() => setMonitoring(true)} className="mb-4 flex w-full items-center justify-between rounded-2xl bg-card px-4 py-3 text-left">
          <span className="text-[14px] text-muted">Станции мониторинга не используются</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink">Включить</span>
        </button>
      )}

      {!isOpen && visit.annul_pending && (
        <div className="mb-3 rounded-2xl bg-[#D71921]/10 p-4 text-[15px]">
          <div className="font-semibold">🗑 Запрошено аннулирование</div>
          <div className="mt-1 text-[14px] leading-snug text-muted">
            {cfg.isAdmin ? `${visit.tech_name}: «${visit.annul_reason}»` : `Ждёт решения администратора. Причина: «${visit.annul_reason}»`}
          </div>
          {cfg.isAdmin && (
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <Button variant="secondary" className="h-[46px] text-[15px]" onClick={async () => {
                try { await api.rejectAnnul(id); haptic.success(); toast('Оставлено как выполненное'); load(); } catch (e) { toast((e as Error).message, 'error'); }
              }}>Оставить</Button>
              <Button variant="danger" className="h-[46px] text-[15px]" onClick={() => setConfirm('annul')}>Аннулировать</Button>
            </div>
          )}
        </div>
      )}
      {!isOpen && (
        <div className="mb-2 space-y-3">
          <Button onClick={() => { haptic.tap(); setShareOpen(true); }} icon={<Share2 size={19} strokeWidth={1.75} />}>Поделиться с клиентом</Button>
          {visit.report_url && (
            <Button variant="secondary" onClick={() => openLink(visit.report_url!)} icon={<FileText size={20} strokeWidth={1.75} />}>Открыть акт (PDF)</Button>
          )}
          {visit.journal_url && (
            <Button variant="secondary" onClick={() => openLink(visit.journal_url!)} icon={<Target size={19} strokeWidth={1.75} />}>Журнал мониторинга (PDF)</Button>
          )}
          {visit.office_sent_at ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#34C759]/12 px-4 py-3 text-[15px]">
              <span className="flex items-center gap-2">
                <CheckCircle2 size={18} strokeWidth={1.75} className="text-[#248A3D] dark:text-[#30D158]" />
                В офис отправлено {fmtDate(visit.office_sent_at)}
              </span>
              <button onClick={sendOffice} disabled={sending} className="text-[15px] text-accent-ink disabled:opacity-40">Ещё раз</button>
            </div>
          ) : visit.office_configured ? (
            <Button variant="secondary" loading={sending} onClick={sendOffice} icon={<Send size={18} strokeWidth={1.75} />}>Отправить в офис</Button>
          ) : null}
          <div className="px-1 text-[14px] text-muted">
            Завершён {visit.finished_at ? fmtDate(visit.finished_at) : ''} · {visit.tech_name}
            {visit.payment && <div className="mt-1.5"><PaymentBadge payment={visit.payment} amount={visit.pay_amount} note={visit.pay_note} /></div>}
            {visit.comment && <div className="mt-2 text-ink dark:text-white">«{visit.comment}»</div>}
          </div>
          {(visit.can_reopen || visit.can_delete) && (
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              {visit.can_reopen && (
                <Button variant="secondary" className="text-[15px]" onClick={() => setConfirm('reopen')} icon={<Pencil size={17} strokeWidth={1.75} />}>Исправить</Button>
              )}
              {visit.can_delete && (
                <Button variant="danger" className="text-[15px]" onClick={() => setConfirm('delete')} icon={<Trash2 size={17} strokeWidth={1.75} />}>Удалить</Button>
              )}
            </div>
          )}
          {visit.can_annul && !visit.annul_pending && (
            <button onClick={() => { haptic.tap(); setConfirm('annul'); }}
              className="flex h-[44px] w-full items-center justify-center rounded-full text-[14.5px] font-medium text-[#D70015] ring-1 ring-inset ring-line active:opacity-70 dark:text-[#FF453A]">
              {cfg.isAdmin ? 'Аннулировать — выполнено по ошибке' : 'Выполнено по ошибке — аннулировать'}
            </button>
          )}
          {cfg.isAdmin && (
            <Button variant="secondary" className="text-[15px]" onClick={() => setRemarkOpen(true)}
              icon={<MessageSquareWarning size={17} strokeWidth={1.75} />}>
              Замечание технику
            </Button>
          )}
        </div>
      )}
      {isOpen && visit.revision > 0 && (
        <div className="mb-2 flex gap-3 rounded-2xl bg-[#FF9500]/12 p-4 text-[15px]">
          <Pencil size={19} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[#C93400] dark:text-[#FF9F0A]" />
          <div>Исправление акта (ред. {visit.revision}). После завершения в офис уйдёт новая версия с пометкой «Исправленный».</div>
        </div>
      )}

      {/* Категория объекта → баллы сотруднику (KPI) */}
      {isOpen ? (
        <>
          <SectionTitle>Объект · баллы</SectionTitle>
          <div className="space-y-4 rounded-2xl bg-card p-4">
            <div>
              <div className="mb-2 text-[15px] font-semibold">Категория объекта</div>
              <Chips options={cfg.pointCats} value={visit.point_cat || ''} onChange={(v) => setPoints({ point_cat: v })} columns={3} />
            </div>
            {cfg.pointCats.find((c) => c.id === visit.point_cat)?.zoned && (
              <div>
                <div className="mb-2 text-[15px] font-semibold">Удалённость</div>
                {cfg.isAdmin ? (
                  <Chips options={cfg.pointZones} value={visit.point_zone || ''} onChange={(v) => setPoints({ point_zone: v })} columns={3} />
                ) : (
                  // дезинсектор не выбирает: удалённость определяется по геолокации (или как указал офис)
                  <div className="grid grid-cols-3 gap-2">
                    {cfg.pointZones.map((z) => {
                      const cur = visit.zone_src === 'admin' && visit.point_zone ? visit.point_zone : visit.geo ? visit.geo.zone : 'city';
                      return <div key={z.id} className={cx('flex min-h-[46px] items-center justify-center rounded-2xl px-2 text-center text-[14.5px] font-medium', z.id === cur ? 'bg-ink text-card' : 'bg-fill text-muted/70')}>{z.label}</div>;
                    })}
                  </div>
                )}
                <GeoStatus visit={visit} busy={geoBusy} onShare={shareGeo} />
              </div>
            )}
            {visit.rooms_task != null && <RoomsFromTask visit={visit} onChanged={load} />}
            {((cfg.pointExtras?.per_room ?? 0) > 0 || (cfg.pointExtras?.per_sotka ?? 0) > 0) && (
              <div className="grid grid-cols-2 gap-3">
                {(cfg.pointExtras?.per_room ?? 0) > 0 && (visit.rooms_task == null || cfg.isAdmin) && (
                  <div>
                    <div className="mb-2 text-[15px] font-semibold">Комнат</div>
                    <Input inputMode="numeric" placeholder="—" defaultValue={visit.rooms ?? ''} key={`r${visit.rooms}`}
                      onBlur={(e) => { const v = e.target.value.replace(/\D/g, ''); if (String(visit.rooms ?? '') !== v) setPoints({ rooms: v ? Number(v) : null }); }} />
                    <div className="mt-1 px-1 text-[11.5px] text-muted">сверх {cfg.pointExtras!.free_rooms}: +{String(cfg.pointExtras!.per_room).replace('.', ',')} за комнату</div>
                  </div>
                )}
                {(cfg.pointExtras?.per_sotka ?? 0) > 0 && (
                  <div>
                    <div className="mb-2 text-[15px] font-semibold">Соток</div>
                    <Input inputMode="decimal" placeholder="—" defaultValue={visit.sotki != null ? String(visit.sotki).replace('.', ',') : ''} key={`s${visit.sotki}`}
                      onBlur={(e) => { const v = e.target.value.trim(); if (String(visit.sotki ?? '').replace('.', ',') !== v) setPoints({ sotki: v || null }); }} />
                    <div className="mt-1 px-1 text-[11.5px] text-muted">сверх {String(cfg.pointExtras!.free_sotki).replace('.', ',')}: +{String(cfg.pointExtras!.per_sotka).replace('.', ',')} за сотку</div>
                  </div>
                )}
              </div>
            )}
            <div className={cx('flex items-baseline justify-between gap-3 rounded-xl px-3.5 py-2.5', (visit.mult_now ?? 1) > 1 ? 'bg-[#AF52DE]/12 dark:bg-[#BF5AF2]/15' : 'bg-accent/[0.08]')}>
              <span className="text-[13px] leading-snug text-muted">{visit.point_cat ? visit.points_detail : 'Выберите категорию — без неё выезд не завершить'}</span>
              {visit.points != null && <span className={cx('shrink-0 font-dot text-[22px] font-semibold', (visit.mult_now ?? 1) > 1 ? 'text-[#8E3BB8] dark:text-[#D08CF5]' : 'text-accent-ink')}>{visit.points}</span>}
            </div>
            {(visit.team?.length ?? 0) > 0 && visit.points != null && (
              <div className="rounded-xl bg-fill px-3.5 py-2.5 text-[13px] leading-snug">
                👥 Команда из {(visit.team?.length ?? 0) + 1}: {visit.team!.map((x) => x.name).join(', ')} и вы (ответственный).
                <br />Баллы объекта — каждому полностью ({visit.points} б). Стоимость заказа делится на {(visit.team?.length ?? 0) + 1}.
              </div>
            )}
          </div>
        </>
      ) : (visit.points != null || cfg.isAdmin) && (
        <>
          <SectionTitle>Баллы</SectionTitle>
          <Group>
            <Row title={visit.points != null ? `${String(visit.points).replace('.', ',')} ${plural(Math.ceil(visit.points), ['балл', 'балла', 'баллов'])}${visit.team?.length ? ` · каждому из ${visit.team.length + 1}` : ''}` : 'Баллы не начислены'}
              subtitle={`${visit.points_manual ? 'Исправлено администратором' : visit.points_detail || 'Категория объекта'}${visit.team?.length ? ` · 👥 ${visit.team.map((x) => x.name).join(', ')}` : ''}`}
              chevron={cfg.isAdmin} boost={(visit.mult_now ?? 1) > 1} onClick={cfg.isAdmin ? () => setPointsOpen(true) : undefined} />
          </Group>
        </>
      )}
      {pointsOpen && (
        <VisitPointsSheet visit={visit} onClose={() => setPointsOpen(false)} onSaved={() => { setPointsOpen(false); load(); }} />
      )}

      {/* Оценка объекта: вредители, заселённость, подготовка */}
      {(visit.needs_assessment || pestOptions.length > 0 || visit.procedure !== 'Дератизация') && (
        <>
          <SectionTitle>Оценка объекта</SectionTitle>
          {isOpen ? (
            <div className="space-y-5 rounded-2xl bg-card p-4">
              {pestOptions.length > 0 && (
                <div>
                  <div className="mb-2 text-[15px] font-semibold">Вредители</div>
                  <MultiChips options={pestOptions} value={visit.pests} onChange={(v) => setAssessment('pests', v)} columns={pestOptions.length > 4 ? 3 : 2} />
                </div>
              )}
              {!q && visit.procedure !== 'Дератизация' && (
                <div>
                  <div className="mb-1 text-[15px] font-semibold">Тип помещения</div>
                  <div className="mb-2 text-[13px] text-muted">Отметьте все подходящие — рекомендации заказчику подстроятся</div>
                  <MultiChips options={cfg.premises.map((p) => p.label)} value={visit.premises.map((pid) => cfg.premises.find((p) => p.id === pid)?.label ?? pid)}
                    onChange={(labels) => setAssessment('premises', labels.map((l) => cfg.premises.find((p) => p.label === l)?.id ?? l))} />
                </div>
              )}
              {!q && visit.procedure !== 'Дератизация' && (
                <div>
                  <div className="mb-1 text-[15px] font-semibold">Нельзя находиться в помещении</div>
                  <div className="mb-2 text-[13px] text-muted">
                    {visit.reentry_custom
                      ? <>Выбрано вручную · <button className="text-accent-ink" onClick={() => setAssessment('reentry', '')}>по вредителям</button></>
                      : 'Подобрано по вредителям: тараканы и блохи — 4–6 ч, клопы — 12–24 ч'}
                  </div>
                  <Chips options={cfg.reentryOptions} value={visit.reentry} onChange={(v) => setAssessment('reentry', v)} />
                </div>
              )}
              {!q && visit.needs_assessment && (
                <>
                  <div>
                    <div className="mb-2 text-[15px] font-semibold">Степень заселённости</div>
                    <Chips options={cfg.infestation} value={visit.infestation} onChange={(v) => setAssessment('infestation', v)} columns={3} />
                  </div>
                  <div>
                    <div className="mb-2 text-[15px] font-semibold">Подготовка помещения</div>
                    <Chips options={cfg.preparation} value={visit.preparation} onChange={(v) => setAssessment('preparation', v)} columns={3} />
                  </div>
                </>
              )}
            </div>
          ) : (
            <Group>
              {visit.pests.length > 0 && <Row title={visit.pests.join(', ')} subtitle="Вредители" />}
              {visit.premises.length > 0 && <Row title={visit.premises.map((pid) => cfg.premises.find((p) => p.id === pid)?.label ?? pid).join(', ')} subtitle="Тип помещения" />}
              {visit.reentry && <Row title={label(cfg.reentryOptions, visit.reentry)} subtitle="Нельзя находиться в помещении" />}
              {visit.needs_assessment && <Row title={label(cfg.infestation, visit.infestation)} subtitle="Степень заселённости" />}
              {visit.needs_assessment && <Row title={label(cfg.preparation, visit.preparation)} subtitle="Подготовка помещения" />}
            </Group>
          )}
        </>
      )}

      {/* Рекомендации заказчику (генерируются по вредителям) */}
      {!q && visit.recommendations.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-2xl bg-accent/[0.06]">
          <button onClick={() => setRecsOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
            <Lightbulb size={20} strokeWidth={1.75} className="shrink-0 text-accent-ink" />
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-semibold">Рекомендации заказчику</div>
              <div className="text-[13px] text-muted">Попадут в PDF-акт · {visit.recommendations.length} {plural(visit.recommendations.length, ['раздел', 'раздела', 'разделов'])}</div>
            </div>
            <ChevronDown size={20} strokeWidth={1.75} className={cx('shrink-0 text-muted transition', recsOpen && 'rotate-180')} />
          </button>
          {recsOpen && (
            <div className="space-y-4 px-4 pb-4">
              {visit.recommendations.map((b) => (
                <div key={b.title}>
                  <div className={cx('mb-1.5 text-[15px] font-semibold', b.accent && 'text-[#D70015] dark:text-[#FF453A]')}>{b.title}</div>
                  <ul className="space-y-1.5">
                    {b.items.map((it) => (
                      <li key={it} className="flex gap-2 text-[14px] leading-relaxed">
                        <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                        <span>{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!q && (
      <>
      {/* Данные для бланка акта */}
      <SectionTitle>Данные для акта</SectionTitle>
      <ActData key={`${visit.id}-${visit.status}`} visit={visit} editable={isOpen} onPatch={patchAct} />
      </>
      )}

      {/* Замечания с фото — доступны и в быстром акте: попадут отдельным приложением */}
      <SectionTitle>Замечания и фото{observations.length ? ` · ${observations.length}` : ''}</SectionTitle>
      {observations.length > 0 && (
        <div className="space-y-2.5">
          {observations.map((o) => (
            <div key={o.id} className="rounded-2xl bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[16px] font-semibold">{o.category}</div>
                  <div className="text-[13px] text-muted">{fmtDate(o.created_at)}</div>
                </div>
                {isOpen && (
                  confirmDel === o.id ? (
                    <button onClick={() => removeObservation(o.id)} className="shrink-0 rounded-2xl bg-[#FF3B30]/12 px-3 py-1.5 text-[14px] font-medium text-[#D70015] dark:text-[#FF453A]">Удалить?</button>
                  ) : (
                    <button onClick={() => removeObservation(o.id)} aria-label="Удалить" className="shrink-0 p-1 text-muted"><Trash2 size={18} strokeWidth={1.75} /></button>
                  )
                )}
              </div>
              {o.comment && <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed">{o.comment}</p>}
              {o.photos.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {o.photos.map((p) => (
                    <button key={p.id} onClick={() => setPhoto(p.url)} className="overflow-hidden rounded-2xl bg-black/5">
                      <img src={p.url} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {isOpen && (
        <>
          {observations.length === 0 && visit.needs_assessment && (
            <p className="mb-3 px-1 text-[14px] leading-relaxed text-muted">
              Если помещение не подготовлено или заражение сильное — сфотографируйте и опишите ситуацию. Фото уйдут в офис вместе с отчётом.
            </p>
          )}
          <Button variant="secondary" className={observations.length ? 'mt-3' : undefined} onClick={() => setSheet({ type: 'observation' })}
            icon={<Camera size={19} strokeWidth={1.75} />}>
            Добавить замечание с фото
          </Button>
        </>
      )}
      {!isOpen && observations.length === 0 && <p className="px-1 text-[15px] text-muted">Замечаний нет</p>}

      {/* Ловушки */}
      {showTraps && (
        <>
          <SectionTitle>
            {traps.length ? `Станции · ${traps.length}` : 'Станции мониторинга'}
          </SectionTitle>
          {isOpen && visit.is_company && visit.monitoring === true && checked.length === 0 && (
            <button onClick={() => setMonitoring(false)} className="-mt-1 mb-3 px-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
              ↩︎ Станции не нужны — выбрано по ошибке
            </button>
          )}
          {traps.length > 0 && (
            <div className="mb-3 rounded-2xl bg-card p-5">
              <div className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted">Записано в журнал</div>
              <div className="mt-2 font-dot text-[44px] leading-none">
                {checked.length}<span className="text-[22px] text-muted"> / {traps.length}</span>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/15">
                <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-4 flex gap-5 text-[14px]">
                <span><b className="font-semibold text-[#D70015] dark:text-[#FF453A]">{activity}</b> <span className="text-muted">с активностью</span></span>
                <span><b className="font-semibold text-[#C93400] dark:text-[#FF9F0A]">{issues}</b> <span className="text-muted">повреждено / нет</span></span>
              </div>
            </div>
          )}
          {trapList}
          {scanButtons}
        </>
      )}

      {isOpen && (
        <>
          <Button className="mt-8" onClick={() => setSheet({ type: 'finish' })}>
            {visit.lead_id ? 'Закрыть заявку' : visit.revision ? 'Сохранить исправленный акт' : 'Завершить выезд'}
          </Button>
          {visit.can_delete && (
            <Button className="mt-2" variant="plain" onClick={() => setConfirm('delete')}>
              <span className="text-[#D70015] dark:text-[#FF453A]">Удалить выезд</span>
            </Button>
          )}
        </>
      )}

      {confirm === 'annul' && (
        <ConfirmSheet
          title={cfg.isAdmin ? 'Аннулировать выполнение?' : 'Выполнено по ошибке?'}
          text={cfg.isAdmin
            ? 'Акт будет удалён, заявка не попадёт в «Выполнено», историю и KPI сотрудника. Если акт уже ушёл в офис — туда придёт сообщение об аннулировании. Отменить это нельзя.'
            : 'Администратор получит запрос. Если он подтвердит — акт удалится и заявка не будет считаться выполненной. Напишите, что случилось.'}
          confirmLabel={cfg.isAdmin ? 'Аннулировать' : 'Отправить запрос'}
          withReason
          onClose={() => setConfirm(null)}
          onConfirm={async (reason) => {
            try {
              const r = await api.annulVisit(id, reason);
              haptic.success();
              setConfirm(null);
              if (r.annulled) { toast('Выполнение аннулировано'); onBack(); }
              else { toast('Запрос отправлен администратору'); load(); }
            } catch (e) {
              toast((e as Error).message, 'error');
            }
          }}
        />
      )}
      {confirm === 'undo' && (
        <ConfirmSheet
          title="Вернуть заявку?"
          text="Выезд будет отменён, заявка вернётся в список «Мои заявки». Отметки «Позвонил» и «Еду к клиенту» сохранятся. Вернуть можно только один раз."
          confirmLabel="Вернуть заявку"
          danger={false}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              await api.undoStart(id);
              haptic.success();
              toast('Заявка возвращена в список');
              onBack();
            } catch (e) {
              toast((e as Error).message, 'error');
              setConfirm(null);
              load();
            }
          }}
        />
      )}
      {confirm === 'reopen' && (
        <ConfirmSheet
          title="Исправить акт?"
          text="Выезд вернётся в работу: можно изменить оценку, замечания, фото и заключение. После сохранения в чат офиса уйдёт исправленный акт, а старая версия станет недействительной."
          confirmLabel="Открыть на исправление"
          danger={false}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              await api.reopenVisit(id);
              haptic.success();
              setConfirm(null);
              load();
            } catch (e) {
              toast((e as Error).message, 'error');
            }
          }}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmSheet
          title={isOpen ? 'Удалить выезд?' : 'Удалить акт?'}
          text={isOpen
            ? 'Выезд, замечания и фото будут удалены без возможности восстановления.'
            : 'Акт, замечания и фото будут удалены без возможности восстановления. Если акт уже был в чате офиса, туда придёт сообщение об удалении.'}
          confirmLabel="Удалить"
          withReason={!isOpen}
          onClose={() => setConfirm(null)}
          onConfirm={async (reason) => {
            try {
              await api.deleteVisit(id, reason);
              haptic.success();
              toast('Удалено');
              onBack();
            } catch (e) {
              toast((e as Error).message, 'error');
            }
          }}
        />
      )}

      {photo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black animate-fade" onClick={() => setPhoto(null)}>
          <img src={photo} alt="" className="max-h-full max-w-full object-contain" />
          <button aria-label="Закрыть" className="top-safe absolute right-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Листы */}
      {sheet?.type === 'inspect' && inspectEl(sheet.trap, sheet.back)}
      {sheet?.type === 'scanned' && (onSite ? inspectEl(sheet.trap) : (
        <Sheet open onClose={() => setSheet(null)} title="Вы на объекте?">
          <div className="-mt-3 mb-5 rounded-2xl bg-card px-4 py-3.5">
            <div className="text-[17px] font-semibold leading-snug">{visit.company_name}</div>
            <div className="mt-1 flex items-start gap-1.5 text-[14.5px] leading-snug text-muted"><MapPin size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />{visit.address}</div>
          </div>
          <p className="mb-5 text-[14.5px] leading-relaxed text-muted">
            Станция № {sheet.trap.number} принадлежит этому объекту. Если вы сейчас на нём — покажу все станции, которые нужно обслужить ({traps.length}).
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="secondary" className="h-[48px] text-[15px]" onClick={() => setSheet(null)}>Нет</Button>
            <Button className="h-[48px] text-[15px]" onClick={() => confirmOnSite(sheet.trap)}>Да, я здесь</Button>
          </div>
        </Sheet>
      ))}
      {sheet?.type === 'service' && (
        <ServiceSheet
          traps={traps}
          focusId={sheet.focusId}
          statusLabel={statusLabel}
          targetLabel={targetLabel}
          trapResult={trapResult}
          onOpen={(t) => setSheet({ type: 'inspect', trap: t, back: true })}
          onScan={() => { setSheet(null); setTimeout(startScan, 250); }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.type === 'register' && (
        <RegisterSheet
          visitId={id}
          code={sheet.code}
          nextNumber={sheet.next}
          onClose={() => setSheet(null)}
          onRegistered={(trap) => {
            load();
            setSheet({ type: 'inspect', trap });
          }}
        />
      )}
      {sheet?.type === 'manual' && (
        <ManualSheet
          onClose={() => setSheet(null)}
          onSubmit={(code) => {
            setSheet(null);
            handleCode(code);
          }}
        />
      )}
      {sheet?.type === 'finish' && (
        <FinishSheet
          visitId={id}
          traps={traps}
          visit={visit}
          observations={observations}
          fromLead={Boolean(visit.lead_id)}
          onClose={() => setSheet(null)}
          onFinished={(r) => {
            setSheet(null);
            if (r) { setReward(r); playSound('deal'); }
            load();
          }}
        />
      )}
      {sheet?.type === 'observation' && (
        <ObservationSheet
          visitId={id}
          onClose={() => setSheet(null)}
          onSaved={(obs) => {
            setSheet(null);
            setData((d) => (d ? { ...d, observations: obs } : d));
          }}
        />
      )}
      {phoneOpen && data.task && <PhoneSheet task={data.task} onClose={() => setPhoneOpen(false)} />}
      {remarkOpen && <RemarkSheet visitId={visit.id} techName={visit.tech_name} onClose={() => setRemarkOpen(false)} />}
      {shareOpen && <ShareSheet visitId={visit.id} onClose={() => setShareOpen(false)} />}
      {sheet?.type === 'message' && <MessageSheet title={sheet.title} text={sheet.text} onClose={() => setSheet(null)} />}
      {reward && <RewardSheet reward={reward} onClose={() => setReward(null)} />}
    </Screen>
  );
}

/** Администратор: исправить баллы завершённого выезда — вручную или сменив категорию. */
function VisitPointsSheet({ visit, onClose, onSaved }: { visit: Visit; onClose: () => void; onSaved: () => void }) {
  const cfg = useConfig();
  const toast = useToast();
  const [cat, setCat] = useState(visit.point_cat || '');
  const [zone, setZone] = useState(visit.point_zone || 'city');
  const [val, setVal] = useState(visit.points != null ? String(visit.points).replace('.', ',') : '');
  const [reason, setReason] = useState('');
  const [mult, setMult] = useState(visit.mult ? String(visit.mult).replace('.', ',') : '');
  const [busy, setBusy] = useState(false);
  const zoned = cfg.pointCats.find((c) => c.id === cat)?.zoned;
  const save = async (points: number | null) => {
    setBusy(true);
    try {
      await api.setVisitPoints(visit.id, { points, reason, point_cat: cat, point_zone: zoned ? zone : '', mult: mult || null });
      haptic.success(); toast('Баллы сохранены'); onSaved();
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} title="Баллы за выезд">
      <p className="-mt-3 mb-4 text-[14px] text-muted">Сейчас: {visit.points ?? '—'} · {visit.points_detail || 'категория не выбрана'}</p>
      <div className="space-y-4">
        <div>
          <div className="mb-2 px-1 text-[13px] font-medium text-muted">Категория объекта</div>
          <Chips options={cfg.pointCats} value={cat} onChange={setCat} columns={3} />
        </div>
        {zoned && (
          <div>
            <div className="mb-2 px-1 text-[13px] font-medium text-muted">Удалённость</div>
            <Chips options={cfg.pointZones} value={zone} onChange={setZone} columns={3} />
          </div>
        )}
        <div>
          <div className="mb-2 px-1 text-[13px] font-medium text-muted">Повышенный коэффициент (вручную)</div>
          <div className="flex flex-wrap gap-1.5">
            {['', ...MULT_PRESETS].map((m) => (
              <button key={m || 'none'} onClick={() => { haptic.tap(); setMult(m); }}
                className={cx('rounded-full px-3.5 py-1.5 text-[14px] font-medium', mult === m ? (m ? 'bg-[#AF52DE] text-white' : 'bg-ink text-card') : 'bg-fill')}>{m ? `×${m}` : 'Нет'}</button>
            ))}
          </div>
          <div className="mt-1.5 px-1 text-[12px] text-muted">Воскресенье и особые периоды считаются автоматически — берётся наибольший коэффициент.</div>
        </div>
        <Button variant="secondary" loading={busy} onClick={() => save(null)}>Пересчитать по категории</Button>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2.5">
          <Field label={visit.team?.length ? `Или вручную — каждому из ${visit.team.length + 1}` : 'Или вручную, баллов'}><Input inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} /></Field>
          <Button className="h-[50px] w-auto px-6" disabled={!val.trim()} loading={busy} onClick={() => save(Number(val.replace(',', '.')))}>Сохранить</Button>
        </div>
        <Field label="Причина (увидит специалист)"><Input placeholder="Например: объект больше заявленного" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Sheet>
  );
}

/** Удалённость по геолокации: кнопка «Поделиться» или результат (км от Кишинёва, ссылка на карту для офиса). */
function GeoStatus({ visit, busy, onShare }: { visit: Visit; busy: boolean; onShare: () => void }) {
  const cfg = useConfig();
  const g = visit.geo;
  const zl = (z: string) => cfg.pointZones.find((x) => x.id === z)?.label || z;
  if (g) {
    return (
      <div className="mt-2.5 flex items-center gap-2.5 rounded-xl bg-[#34C759]/12 px-3.5 py-2.5 text-[13.5px]">
        <MapPin size={17} strokeWidth={1.75} className="shrink-0 text-[#1E7A35] dark:text-[#30D158]" />
        <div className="min-w-0 flex-1 leading-snug">
          <b>{String(g.km).replace('.', ',')} км</b> от Кишинёва · {zl(g.zone)}
          <div className="text-[12px] text-muted">по геолокации{visit.zone_src === 'admin' ? ' · удалённость задал офис' : ''}</div>
        </div>
        {cfg.isAdmin ? <button onClick={() => openLink(g.map)} className="shrink-0 text-[13px] font-medium text-accent-ink">Карта</button>
          : <button onClick={onShare} disabled={busy} className="shrink-0 text-[13px] font-medium text-accent-ink">{busy ? '…' : 'Обновить'}</button>}
      </div>
    );
  }
  if (visit.zone_src === 'admin' && visit.point_zone && visit.point_zone !== 'city') {
    return <div className="mt-2 px-1 text-[12.5px] text-muted">Удалённость указал офис в заявке.</div>;
  }
  return (
    <div className="mt-2.5 rounded-xl bg-fill px-3.5 py-3">
      <div className="text-[13px] leading-snug text-muted">Удалённость определяется только по геолокации с объекта. Без геолокации засчитывается «Кишинёв».</div>
      <Button variant="secondary" className="mt-2.5 h-11 text-[15px]" loading={busy} icon={<MapPin size={17} strokeWidth={1.75} />} onClick={onShare}>
        Поделиться геолокацией
      </Button>
    </div>
  );
}

/** Комнаты из заявки: дезинсектор не меняет, а нажимает «Ошибка» — менеджер подтверждает или исправляет. */
function RoomsFromTask({ visit, onChanged }: { visit: Visit; onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [n, setN] = useState((visit.rooms ?? visit.rooms_task ?? 1) + 1);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const d = visit.rooms_dispute;
  async function send() {
    setBusy(true);
    try { await api.roomsError(visit.id, n, note); haptic.success(); toast('Отправлено менеджеру', 'ok'); setOpen(false); onChanged(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <div className="rounded-xl bg-fill px-3.5 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">Комнат: {visit.rooms ?? visit.rooms_task}</div>
          <div className="text-[12.5px] text-muted">{d?.status === 'fixed' ? `исправил менеджер (${d.decided_by})` : d?.status === 'ok' ? `подтвердил менеджер (${d.decided_by})` : 'из заявки — изменить нельзя'}</div>
        </div>
        {visit.status === 'open' && d?.status !== 'new' && (
          <button onClick={() => { haptic.tap(); setOpen(true); }} className="shrink-0 rounded-xl bg-[#FF453A]/12 px-3 py-2 text-[13.5px] font-bold text-[#D70015] dark:text-[#FF453A]">Ошибка</button>
        )}
      </div>
      {d?.status === 'new' && <div className="mt-2 rounded-lg bg-[#FF9F0A]/15 px-3 py-2 text-[13px]">⏳ Отправлено менеджеру: на объекте {d.claimed}. Ждём подтверждения.</div>}
      <Sheet open={open} onClose={() => setOpen(false)} title="Ошибка в количестве комнат">
        <div className="flex flex-col gap-4">
          <div className="text-[14px] text-muted">В заявке: <b className="text-ink dark:text-white">{visit.rooms_task}</b>. Сколько комнат на самом деле? Менеджер получит уведомление и подтвердит.</div>
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => setN(Math.max(1, n - 1))} className="h-12 w-12 rounded-full bg-card text-[22px] ring-1 ring-inset ring-line">−</button>
            <div className="font-dot w-16 text-center text-[34px]">{n}</div>
            <button onClick={() => setN(Math.min(50, n + 1))} className="h-12 w-12 rounded-full bg-card text-[22px] ring-1 ring-inset ring-line">+</button>
          </div>
          <Input placeholder="Комментарий (например: ещё кухня и кладовка)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button onClick={send} loading={busy} disabled={n === visit.rooms_task}>Отправить менеджеру</Button>
        </div>
      </Sheet>
    </div>
  );
}

/** Список всех станций объекта к обслуживанию: после подтверждения «Я на объекте» и по кнопке в выезде. */
function ServiceSheet({ traps, focusId, statusLabel, targetLabel, trapResult, onOpen, onScan, onClose }: {
  traps: Trap[]; focusId?: string; statusLabel: (s: string) => string; targetLabel: (id: string) => string; trapResult: (t: Trap) => string;
  onOpen: (t: Trap) => void; onScan: () => void; onClose: () => void;
}) {
  const left = traps.filter((t) => !t.inspection).length;
  return (
    <Sheet open onClose={onClose} title="Станции к обслуживанию">
      <p className="-mt-3 mb-4 text-[14.5px] leading-relaxed text-muted">
        {traps.length === 0
          ? 'На объекте пока нет активных станций.'
          : left > 0
            ? `Осталось проверить: ${left} из ${traps.length}. Нажмите на станцию, чтобы записать результат, или сканируйте QR.`
            : `Все ${traps.length} ${plural(traps.length, ['станция', 'станции', 'станций'])} проверены ✅`}
      </p>
      {traps.length > 0 && (
        <Group>
          {traps.map((t) => (
            <Row
              key={t.id}
              left={<IconBadge tone={t.inspection ? statusTone(t.inspection.status) : 'gray'}><span className="font-mono">{t.number}</span></IconBadge>}
              title={t.location || t.kind}
              subtitle={
                <>
                  <div className="truncate">{[targetLabel(t.target), t.kind].filter(Boolean).join(' · ')}</div>
                  {trapResult(t) && <div className="mt-0.5 truncate text-ink">{trapResult(t)}</div>}
                  {t.id === focusId && <div className="mt-0.5 text-accent-ink">📍 только что отсканирована</div>}
                </>
              }
              right={t.inspection ? <Pill tone={statusTone(t.inspection.status)}>{statusLabel(t.inspection.status)}</Pill> : <Pill>Проверить</Pill>}
              chevron={false}
              onClick={() => onOpen(t)}
            />
          ))}
        </Group>
      )}
      <div className="mt-4 space-y-2">
        {left > 0 && <Button onClick={onScan} icon={<ScanLine size={20} strokeWidth={1.75} />}>Сканировать следующую</Button>}
        <Button variant={left > 0 ? 'plain' : 'primary'} onClick={onClose}>{left > 0 ? 'Закрыть' : 'Готово'}</Button>
      </div>
    </Sheet>
  );
}
