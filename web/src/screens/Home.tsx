import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Bell, ChevronDown, Maximize2, Minimize2, CalendarClock, Camera, CheckCircle2, ClipboardList, Inbox, LayoutDashboard, MapPin, Play, Plus, Printer, QrCode, RotateCw,
} from 'lucide-react';
import { api } from '../api';
import { fmtDate, plural, useConfig } from '../config';
import { askWriteAccess, canFullscreen, getThemePref, haptic, isDesktopTg, isFullscreen, isTelegram, onFullscreenChange, openLink, setThemePref, toggleFullscreen, type ThemePref } from '../telegram';
import type { AnnulRequest, Lead, MonthSummary, Payment, Task, VisitSummary } from '../types';
import { PAYMENT_UI } from '../components/Payment';
import { MonthCard, NotificationsSheet } from './Notifications';
import { MyKpiSheet } from './Kpi';
import { JobsReviewWidget, MyJobs, NewTaskButton, audienceText } from './Jobs';
import { AnnounceButton, AnnouncementsWidget, OpenWork } from './Announce';
import { GameTop } from './Play';
import { useCrown } from './Contest';
import { AppLogoutButtons } from './AppLogin';
import { CancelledTasks, NowWidget, TaskList, TaskSheet } from './Tasks';
import { ClientsSheet } from './ClientsSheet';
import { OfficeSheet } from './OfficeSheet';
import {
  Button, Chips, Empty, Field, Group, IconBadge, Input, LargeTitle, MultPill, Pill, Row, Screen, SectionTitle, Segmented, Sheet, Spinner, Toggle, cx, useToast,
} from '../components/ui';

/** Меняется с каждым архивом — по ней видно, какая версия реально открыта на телефоне. */
export const APP_VERSION = '2026.10.06-v59';

const isToday = (iso: string | null) => !!iso && new Date(iso).toDateString() === new Date().toDateString();

export function Home({ onNew, onOpen, onAdmin, onConfigChanged }: {
  onNew: () => void; onOpen: (id: string) => void; onAdmin: () => void; onConfigChanged: () => void;
}) {
  const cfg = useConfig();
  const toast = useToast();
  const [leads, setLeads] = useState<Lead[] | null>(cfg.leads ? null : []);
  const [visits, setVisits] = useState<VisitSummary[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cancelled, setCancelled] = useState<Task[]>([]);
  const [pending, setPending] = useState<Task[]>([]);
  const [unacked, setUnacked] = useState<Task[]>([]);
  const [annulReqs, setAnnulReqs] = useState<AnnulRequest[]>([]);
  const [unackedOpen, setUnackedOpen] = useState(false);
  const [allTasks, setAllTasks] = useState(true);
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const [task, setTask] = useState<Task | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [full, setFull] = useState(isFullscreen());
  useEffect(() => onFullscreenChange(() => setFull(isFullscreen() || Boolean(document.fullscreenElement))), []);
  const [refreshing, setRefreshing] = useState(false);
  const [clients, setClients] = useState(cfg.clients ?? 0);
  const [clientsOpen, setClientsOpen] = useState(false);
  const [officeOpen, setOfficeOpen] = useState(false);
  const [month, setMonth] = useState<MonthSummary | null>(null);
  const [unread, setUnread] = useState(cfg.unread ?? 0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [kpiOpen, setKpiOpen] = useState(false);
  const ownBase = !cfg.amo; // своя база клиентов из Excel

  const load = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      cfg.leads
        ? api.leads().then((r) => setLeads(r.items)).catch((e: Error) => { toast(e.message, 'error'); setLeads([]); })
        : Promise.resolve(),
      api.visits().then((r) => setVisits(r.items)).catch((e: Error) => { toast(e.message, 'error'); setVisits([]); }),
      api.tasks().then((r) => { setTasks(r.items); setCancelled(r.cancelled || []); setPending(r.pending || []); setUnacked(r.unacked || []); setAnnulReqs(r.annul_requests || []); setAllTasks(r.all_tasks !== false); if (r.month) { setMonth(r.month); setUnread(r.month.unread); } }).catch(() => {}),
    ]);
    setRefreshing(false);
  }, [cfg.leads, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { askWriteAccess(); }, []);

  // обновлять список, когда техник возвращается в приложение
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  const newLeads = leads?.filter((l) => !l.visit_id) ?? [];
  const open = visits?.filter((v) => v.status === 'open') ?? [];
  const done = visits?.filter((v) => v.status === 'done') ?? [];
  const firstName = cfg.user.name.split(' ')[0];
  const crown = useCrown();
  const loading = !leads || !visits;

  // на компьютере план, месяц и инструменты — в правой колонке; на телефоне — в общем потоке
  const sideTop = (
    <>
      {month && cfg.isAdmin && <MonthCard m={month} onRemarks={() => { haptic.tap(); setNotifOpen(true); }} onHistory={() => { haptic.tap(); setKpiOpen(true); }} />}
    </>
  );
  const sideTools = (
    <>
          {cfg.leads ? (
            <div className="mt-8 grid grid-cols-2 gap-2.5">
              {!cfg.isAdmin && (
                <Button variant="secondary" onClick={onNew} icon={<Plus size={19} strokeWidth={2} />} className="text-[15px]">
                  Без заявки
                </Button>
              )}
              {cfg.isAdmin && (
                <Button variant="secondary" onClick={() => setLabelsOpen(true)} icon={<QrCode size={18} strokeWidth={1.75} />} className="text-[15px]">
                  QR-этикетки
                </Button>
              )}
            </div>
          ) : (
            <SectionTitle>Инструменты</SectionTitle>
          )}


          {!cfg.leads && (
            <Group>
              <div className="px-4 py-3">
                <div className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Тема оформления</div>
                <Segmented<ThemePref>
                  options={[{ id: 'light', label: 'Светлая' }, { id: 'dark', label: 'Тёмная' }, { id: 'auto', label: 'Как в Telegram' }]}
                  value={theme}
                  onChange={(v) => { haptic.tap(); setTheme(v); setThemePref(v); api.setPrefs({ theme: v }).catch(() => {}); }}
                />
              </div>
              {cfg.isAdmin && (
                <div className="px-4 py-3">
                  <Toggle label="Заявки всех сотрудников" checked={allTasks} onChange={async (v) => {
                    haptic.tap();
                    setAllTasks(v);
                    try { await api.setPrefs({ all_tasks: v }); load(); } catch (e) { toast((e as Error).message, 'error'); setAllTasks(!v); }
                  }} />
                  <div className="mt-1.5 px-1 text-[12.5px] text-muted">{allTasks ? 'Видите заявки всех дезинсекторов' : 'Показаны только ваши заявки'}</div>
                </div>
              )}
              {cfg.isAdmin && (
                <Row
                  title="QR-этикетки для ловушек"
                  subtitle="Печать листа A4 · только администратор"
                  left={<IconBadge tone="gray"><QrCode size={18} strokeWidth={1.75} /></IconBadge>}
                  onClick={() => setLabelsOpen(true)}
                />
              )}
            </Group>
          )}

          {cfg.isAdmin && (
            <>
              <SectionTitle>Управление</SectionTitle>
              <Group>
                <Row
                  title="Админ-панель"
                  subtitle={cfg.pendingUsers ? 'Есть новые заявки на доступ' : 'Отчёты, акты, сотрудники, журнал'}
                  left={<IconBadge><LayoutDashboard size={18} strokeWidth={1.75} /></IconBadge>}
                  right={cfg.pendingUsers ? <Pill tone="red">{cfg.pendingUsers}</Pill> : undefined}
                  onClick={onAdmin}
                />
              </Group>
            </>
          )}

    </>
  );

  return (
    <Screen desktop>
      <LargeTitle
        title={cfg.leads ? 'Мои заявки' : 'Выезды'}
        subtitle={`Здравствуйте, ${crown(cfg.user.id)}${firstName}`}
        right={
          <div className="mt-1 flex gap-2">
            <button onClick={() => { haptic.tap(); setNotifOpen(true); }} aria-label="Уведомления"
              className="relative flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink ring-1 ring-inset ring-line">
              <Bell size={17} strokeWidth={1.75} />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[11px] font-semibold leading-none text-black">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
            {(isDesktopTg() || !isTelegram()) && (canFullscreen() || !isTelegram()) && (
              <button onClick={() => { haptic.tap(); toggleFullscreen(); }} aria-label={full ? 'Обычное окно' : 'Во весь экран'} title={full ? 'Обычное окно' : 'Во весь экран'}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink ring-1 ring-inset ring-line">
                {full ? <Minimize2 size={17} strokeWidth={1.75} /> : <Maximize2 size={17} strokeWidth={1.75} />}
              </button>
            )}
            <button onClick={() => { haptic.tap(); load(); }} aria-label="Обновить"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink ring-1 ring-inset ring-line">
              <RotateCw size={17} strokeWidth={1.75} className={cx(refreshing && 'animate-spin')} />
            </button>
          </div>
        }
      />

      {ownBase && clients === 0 && (
        <div className="mb-4 rounded-2xl bg-accent/[0.08] p-4 text-[15px]">
          <div className="font-semibold">База клиентов пуста</div>
          <div className="mt-1 text-muted">
            {cfg.isAdmin ? 'Загрузите список юрлиц и адресов из Excel — техники будут выбирать клиента из него.' : 'Попросите администратора загрузить базу клиентов.'}
          </div>
          {cfg.isAdmin && (
            <Button className="mt-3 h-[44px] text-[15px]" onClick={() => setClientsOpen(true)}>Загрузить Excel</Button>
          )}
        </div>
      )}

      {cfg.isAdmin && !cfg.office && (
        <button onClick={() => setOfficeOpen(true)} className="mb-4 flex w-full gap-3 rounded-2xl bg-[#FF9500]/12 p-4 text-left text-[15px]">
          <AlertTriangle size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[#C93400] dark:text-[#FF9F0A]" />
          <div>
            <div className="font-semibold">Чат офиса не подключён</div>
            <div className="text-muted">Отчёты техников не будут приходить в Telegram. Нажмите, чтобы настроить.</div>
          </div>
        </button>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-10">
          <div className="min-w-0">
          {!cfg.isAdmin && <GameTop onOpenVisit={onOpen} />}
          {!cfg.isAdmin && <OpenWork onClaimed={load} />}
          {!cfg.isAdmin && <MyJobs />}
          {open.length > 0 && (
            <div className="mb-5">
              <SectionTitle>В работе · {open.length}</SectionTitle>
              <Group>{open.map((v) => <VisitRow key={v.id} v={v} showTech={cfg.isAdmin} onClick={() => onOpen(v.id)} />)}</Group>
            </div>
          )}
          {!cfg.leads && <NowWidget tasks={tasks.filter((t) => !t.visit_id)} onOpen={setTask} />}
          {cfg.isAdmin && unacked.length > 0 && (
            <div className="mb-5 overflow-hidden rounded-[22px] bg-card">
              <button onClick={() => { haptic.tap(); setUnackedOpen((v) => !v); }} className="flex w-full items-center gap-3.5 p-4 text-left">
                <span className="font-dot text-[40px] leading-none text-[#D71921] dark:text-[#FF4D4D]">{unacked.length}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15.5px] font-semibold leading-snug">Не подтвердили получение</div>
                  <div className="text-[13px] text-muted">Заявки отправлены, дезинсектор ещё не нажал «Уведомлен»</div>
                </div>
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink">{unackedOpen ? 'Скрыть' : 'Кто'}</span>
              </button>
              {unackedOpen && (
                <div className="divide-y divide-dashed divide-line border-t border-dashed border-line">
                  {unacked.map((t) => {
                    const mins = Math.max(0, Math.round((Date.now() - new Date(t.sent_at || t.created_at).getTime()) / 60000));
                    return (
                      <button key={t.id} onClick={() => setTask(t)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-medium">{t.tech_name} · № {t.task_no}</div>
                          <div className="truncate text-[13px] text-muted">{t.company_name || t.address}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-[13px] text-[#D71921] dark:text-[#FF4D4D]">{mins < 60 ? `${mins} мин` : `${Math.floor(mins / 60)} ч ${mins % 60} м`}</div>
                          <div className="text-[11.5px] text-muted">напоминаний: {t.alert_count || 0}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className="lg:hidden">{sideTop}</div>

          {cfg.leads && (
            <>
              <SectionTitle>Новые заявки{newLeads.length ? ` · ${newLeads.length}` : ''}</SectionTitle>
              {newLeads.length === 0 ? (
                <div className="rounded-2xl bg-card">
                  <Empty icon={<Inbox size={40} strokeWidth={1.25} />} title="Новых заявок нет" text="Когда менеджер назначит вам заявку в amoCRM, она появится здесь." />
                </div>
              ) : (
                <Group>
                  {newLeads.map((l) => (
                    <Row
                      key={l.id}
                      onClick={() => { haptic.tap(); setLead(l); }}
                      left={<IconBadge><CalendarClock size={18} strokeWidth={1.75} /></IconBadge>}
                      title={l.company_name}
                      subtitle={
                        <>
                          <div className="truncate">{l.address || 'Адрес не указан'}</div>
                          <div className="mt-0.5 truncate">
                            {l.procedure || 'Процедура не указана'}{l.planned_at ? ` · ${fmtDate(l.planned_at)}` : ''}
                          </div>
                        </>
                      }
                      right={isToday(l.planned_at) ? <Pill tone="blue">Сегодня</Pill> : undefined}
                    />
                  ))}
                </Group>
              )}
            </>
          )}

          {cfg.isAdmin && annulReqs.length > 0 && (
            <>
              <SectionTitle>Аннулировать выполнение? · {annulReqs.length}</SectionTitle>
              <Group>
                {annulReqs.map((a) => (
                  <Row key={a.id} onClick={() => onOpen(a.id)}
                    left={<IconBadge tone="red"><AlertTriangle size={18} strokeWidth={1.75} /></IconBadge>}
                    title={`${a.tech_name} · акт № ${a.act_no}`}
                    subtitle={<><div className="truncate">{a.company_name} · {a.address}</div><div className="truncate">«{a.reason}»</div></>} />
                ))}
              </Group>
            </>
          )}
          {cfg.isAdmin && pending.length > 0 && (
            <>
              <SectionTitle>Ждут подтверждения · {pending.length}</SectionTitle>
              <div className="mb-4 space-y-2.5">
                {pending.map((t) => <PendingTask key={t.id} t={t} onDone={load} />)}
              </div>
            </>
          )}

          {!cfg.leads && tasks.filter((t) => !t.visit_id).length > 0 && (
            <>
              <SectionTitle>{cfg.isAdmin && allTasks ? 'Заявки' : 'Мои заявки'} · {tasks.filter((t) => !t.visit_id).length}</SectionTitle>
              {cfg.isAdmin && allTasks
                ? <TasksByTech tasks={tasks.filter((t) => !t.visit_id)} onOpen={setTask} />
                : <TaskList tasks={tasks.filter((t) => !t.visit_id)} showTech={false} onOpen={setTask} />}
            </>
          )}

          {!cfg.leads && !cfg.isAdmin && (
            <Button variant={tasks.some((t) => !t.visit_id) ? 'secondary' : 'primary'} onClick={onNew} icon={<Plus size={20} strokeWidth={2} />}>
              {tasks.some((t) => !t.visit_id) ? 'Выезд без заявки' : 'Новый выезд'}
            </Button>
          )}

          {!cfg.leads && <CancelledTasks items={cancelled} showTech={cfg.isAdmin && allTasks} onRestored={load} />}


          {cfg.isAdmin && <div className="lg:hidden">{sideTools}</div>}

          {cfg.isAdmin && <DoneByTech onOpen={onOpen} />}

          {!cfg.isAdmin && done.length > 0 && (
            <>
              <SectionTitle>Выполненные</SectionTitle>
              <Group>{done.map((v) => <VisitRow key={v.id} v={v} showTech={cfg.isAdmin} onClick={() => onOpen(v.id)} />)}</Group>
            </>
          )}

          </div>
          <aside className="hidden lg:sticky lg:top-6 lg:block">{sideTop}{cfg.isAdmin && sideTools}</aside>
        </div>
      )}

      {cfg.isAdmin && <AppLogoutButtons />}
      {cfg.isAdmin && <div className="mt-10 text-center font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted/70">Версия {APP_VERSION}</div>}

      {task && (
        <TaskSheet task={task} onClose={() => setTask(null)} onStarted={onOpen}
          onCancelled={() => { setTask(null); load(); }} />
      )}
      {kpiOpen && <MyKpiSheet name={cfg.user.name} onClose={() => setKpiOpen(false)} />}
      {notifOpen && (
        <NotificationsSheet onClose={() => setNotifOpen(false)} onOpenVisit={onOpen}
          onRead={() => { setUnread(0); setMonth((m) => (m ? { ...m, unread: 0 } : m)); }} />
      )}
      {lead && <LeadSheet lead={lead} onClose={() => setLead(null)} onStarted={onOpen} />}
      {officeOpen && (
        <OfficeSheet current={cfg.office} onClose={() => setOfficeOpen(false)} onSaved={() => { setOfficeOpen(false); onConfigChanged(); }} />
      )}
      {clientsOpen && (
        <ClientsSheet count={clients} onClose={() => setClientsOpen(false)} onImported={(n) => setClients((c) => c + n)} />
      )}
      {cfg.isAdmin && <LabelsSheet open={labelsOpen} onClose={() => setLabelsOpen(false)} />}
    </Screen>
  );
}

function VisitRow({ v, onClick, showTech }: { v: VisitSummary; onClick: () => void; showTech: boolean }) {
  const isOpen = v.status === 'open';
  const boost = (v.mult_eff ?? 1) > 1;
  return (
    <Row
      onClick={onClick}
      boost={boost}
      left={
        <IconBadge tone={boost ? 'purple' : isOpen ? 'blue' : 'green'}>
          {isOpen ? <ClipboardList size={18} strokeWidth={1.75} /> : <CheckCircle2 size={18} strokeWidth={1.75} />}
        </IconBadge>
      }
      title={v.company_name}
      subtitle={
        <>
          <div className="truncate">{v.address}</div>
          <div className="mt-0.5 truncate">
            {v.procedure} · {fmtDate(v.finished_at || v.started_at)}{showTech && !v.mine ? ` · ${v.tech_name}` : ''}
          </div>
          {boost && <div className="mt-1.5"><MultPill m={v.mult_eff} /></div>}
        </>
      }
      right={
        v.approval === 'pending' ? <Pill tone="orange">Ждёт подтверждения</Pill>
          : v.approval === 'rejected' ? <Pill tone="red">Отклонён</Pill>
          : v.total ? <Pill tone={isOpen ? 'blue' : 'gray'}>{v.checked}/{v.total}</Pill>
          : v.notes ? <Pill tone={isOpen ? 'blue' : 'gray'}><Camera size={13} strokeWidth={2} className="mr-1" />{v.notes}</Pill>
          : undefined
      }
    />
  );
}

/* ---------- Карточка заявки ---------- */

function LeadSheet({ lead, onClose, onStarted }: { lead: Lead; onClose: () => void; onStarted: (visitId: string) => void }) {
  const cfg = useConfig();
  const toast = useToast();
  const known = cfg.procedures.find((p) => p.toLowerCase() === lead.procedure.toLowerCase());
  const [procedure, setProcedure] = useState(known ?? '');
  const [address, setAddress] = useState(lead.address);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const { id } = await api.startLead(lead.id, { procedure, address });
      haptic.success();
      onStarted(id);
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={lead.company_name}>
      <div className="-mt-3 mb-6 text-[15px] text-muted">{lead.name}</div>

      <Group>
        {lead.address && (
          <Row left={<IconBadge tone="gray"><MapPin size={18} strokeWidth={1.75} /></IconBadge>} title={lead.address} subtitle="Адрес объекта" />
        )}
        {lead.planned_at && (
          <Row left={<IconBadge tone="gray"><CalendarClock size={18} strokeWidth={1.75} /></IconBadge>} title={fmtDate(lead.planned_at)} subtitle="Плановое время" />
        )}
        {known && (
          <Row left={<IconBadge tone="gray"><ClipboardList size={18} strokeWidth={1.75} /></IconBadge>} title={known} subtitle="Процедура" />
        )}
      </Group>

      <div className="mt-6 space-y-6">
        {!lead.address && (
          <Field label="Адрес объекта">
            <Input placeholder="Город, улица, дом" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        )}
        {!known && (
          <Field label={lead.procedure ? `Процедура (в заявке: «${lead.procedure}»)` : 'Процедура'}>
            <Chips options={cfg.procedures.map((p) => ({ id: p, label: p }))} value={procedure} onChange={(v) => { haptic.tap(); setProcedure(v); }} />
          </Field>
        )}
      </div>

      <Button className="mt-7" loading={busy} disabled={!procedure || address.trim().length < 3} onClick={start}
        icon={<Play size={18} strokeWidth={2} />}>
        Начать выезд
      </Button>
      <p className="mt-3 text-center text-[13px] text-muted">Заявка в amoCRM перейдёт в этап «В работе»</p>
    </Sheet>
  );
}

/* ---------- Печать этикеток ---------- */

export function LabelsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [count, setCount] = useState('21');
  const [busy, setBusy] = useState(false);

  async function print() {
    setBusy(true);
    try {
      const { url } = await api.labels(Number(count));
      openLink(url);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="QR-этикетки">
      <p className="mb-5 text-[15px] leading-relaxed text-muted">
        Каждая этикетка — уникальный код. Наклейте её на ловушку и отсканируйте в выезде: ловушка привяжется к адресу объекта.
      </p>
      <Chips
        options={['21', '42', '63', '84'].map((c) => ({ id: c, label: `${c} шт. · ${Number(c) / 21} ${plural(Number(c) / 21, ['лист', 'листа', 'листов'])}` }))}
        value={count}
        onChange={setCount}
      />
      <Button className="mt-6" onClick={print} loading={busy} icon={<Printer size={20} strokeWidth={1.75} />}>
        Открыть для печати
      </Button>
    </Sheet>
  );
}

/** Заявка из темы, написанная не админом: подтвердить → уйдёт технику. */
function PendingTask({ t, onDone }: { t: Task; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<'' | 'ok' | 'no'>('');
  async function act(ok: boolean) {
    setBusy(ok ? 'ok' : 'no');
    try {
      if (ok) await api.approveTask(t.id); else await api.cancelTask(t.id);
      haptic.success();
      toast(ok ? `Заявка № ${t.task_no} отправлена: ${t.tech_name}` : 'Заявка отменена');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy('');
    }
  }
  return (
    <div className="rounded-[22px] bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[16px] font-medium">{t.company_name || t.address}</div>
          <div className="mt-0.5 text-[13.5px] leading-snug text-muted">
            {[t.company_name ? t.address : '', [t.procedure, t.pests.join(', ')].filter(Boolean).join(' · ')].filter(Boolean).join(' · ')}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Pill tone="blue">→ {t.tech_name}</Pill>
            {t.author && <Pill>от {t.author}</Pill>}
          </div>
        </div>
        <div className="shrink-0 font-mono text-[11px] text-muted">№ {t.task_no}</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <Button variant="secondary" className="h-[44px] text-[15px]" loading={busy === 'no'} onClick={() => act(false)}>Отменить</Button>
        <Button className="h-[44px] text-[15px]" loading={busy === 'ok'} onClick={() => act(true)}>Подтвердить</Button>
      </div>
    </div>
  );
}

/** Администратор: «Выполнено» по каждому сотруднику — выбрать человека и увидеть, сколько и что он сделал. */
function DoneByTech({ onOpen }: { onOpen: (id: string) => void }) {
  const toast = useToast();
  const [period, setPeriod] = useState<'month' | 'prev' | 'all'>('month');
  const [tech, setTech] = useState('');
  const [data, setData] = useState<Awaited<ReturnType<typeof api.doneByTech>> | null>(null);
  useEffect(() => {
    let alive = true;
    api.doneByTech(period, tech).then((r) => { if (alive) setData(r); }).catch((e: Error) => toast(e.message, 'error'));
    return () => { alive = false; };
  }, [period, tech, toast]);
  const money = (n: number) => `${n.toLocaleString('ru-RU')} лей`;
  const sel = data?.techs.find((t) => t.id === tech);

  return (
    <>
      <SectionTitle>Выполнено</SectionTitle>
      <div className="mb-3">
        <Segmented<'month' | 'prev' | 'all'>
          options={[{ id: 'month', label: 'Этот месяц' }, { id: 'prev', label: 'Прошлый' }, { id: 'all', label: 'Всё время' }]}
          value={period} onChange={(v) => { haptic.tap(); setPeriod(v); }} />
      </div>
      {!data ? <Spinner /> : data.total === 0 ? (
        <div className="rounded-2xl bg-card p-4 text-[15px] text-muted">За этот период выполненных выездов нет</div>
      ) : (
        <>
          <Group>
            <Row selected={!tech} chevron={false} onClick={() => { haptic.tap(); setTech(''); }}
              title="Все сотрудники" subtitle={[data.points ? `${String(data.points).replace('.', ',')} балл.` : '', data.revenue ? money(data.revenue) : '', data.cash ? `наличными ${money(data.cash)}` : ''].filter(Boolean).join(' · ') || undefined}
              right={<span className="font-dot text-[20px] font-semibold tabular-nums">{data.total}</span>} />
            {data.techs.map((t) => (
              <Row key={t.id} selected={tech === t.id} chevron={false} onClick={() => { haptic.tap(); setTech(tech === t.id ? '' : t.id); }}
                title={t.name}
                subtitle={[t.points ? `${String(t.points).replace('.', ',')} балл.` : '', t.revenue ? money(t.revenue) : '', t.cash ? `💵 на руках ${money(t.cash)}` : '', data.total ? `${Math.round((t.count / data.total) * 100)}% от всех` : ''].filter(Boolean).join(' · ')}
                right={<span className="font-dot text-[20px] font-semibold tabular-nums">{t.count}</span>} />
            ))}
          </Group>
          {data.pay_counts && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(PAYMENT_UI) as Payment[]).map((k) => {
                const u = PAYMENT_UI[k];
                return (
                  <div key={k} className="flex items-center gap-2.5 rounded-2xl bg-card px-3.5 py-3">
                    <u.Icon size={18} strokeWidth={1.75} className={cx('shrink-0', u.tone)} />
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{u.short}</span>
                    <span className="font-dot text-[17px] font-semibold tabular-nums">{data.pay_counts?.[k] ?? 0}</span>
                  </div>
                );
              })}
            </div>
          )}
          <SectionTitle>{sel ? `${sel.name} · ${sel.count}` : `Все акты · ${data.total}`}</SectionTitle>
          <Group>{data.items.map((v) => <VisitRow key={v.id} v={v} showTech={!tech} onClick={() => onOpen(v.id)} />)}</Group>
          {data.items.length >= 150 && <div className="mt-2 px-1 text-[12.5px] text-muted">Показаны последние 150 — полный список в Админке → Акты</div>}
        </>
      )}
    </>
  );
}

/** Администратор: заявки сгруппированы по сотрудникам; нажатие на сотрудника раскрывает его список. */
function TasksByTech({ tasks, onOpen }: { tasks: Task[]; onOpen: (t: Task) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const crown = useCrown();
  // баллы и выполненные за текущий месяц — рядом с именем
  const [stats, setStats] = useState<Record<string, { points: number; count: number }>>({});
  useEffect(() => {
    api.doneByTech('month').then((r) => setStats(Object.fromEntries(r.techs.map((t) => [t.id, { points: t.points ?? 0, count: t.count }])))).catch(() => {});
  }, []);
  const today = new Date().toDateString();
  const tomorrow = new Date(Date.now() + 86400000).toDateString();
  const groups = new Map<string, { id: string; name: string; list: Task[] }>();
  for (const t of tasks) {
    const id = t.tech_id || 'none';
    const g = groups.get(id) || { id, name: t.tech_name || 'Без исполнителя', list: [] };
    g.list.push(t);
    groups.set(id, g);
  }
  const list = [...groups.values()].sort((a, b) => b.list.length - a.list.length || a.name.localeCompare(b.name));
  const day = (t: Task) => (t.planned_at ? new Date(t.planned_at).toDateString() : '');

  return (
    <div className="space-y-2.5">
      {list.map((g) => {
        const open = openId === g.id;
        const nToday = g.list.filter((t) => !t.planned_at || day(t) === today || new Date(t.planned_at) < new Date(new Date().toDateString())).length;
        const nTomorrow = g.list.filter((t) => day(t) === tomorrow).length;
        const unacked = g.list.filter((t) => !t.ack_at).length;
        return (
          <div key={g.id} className="overflow-hidden rounded-2xl bg-card">
            <button onClick={() => { haptic.tap(); setOpenId(open ? null : g.id); }}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:opacity-70">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-fill text-[16px] font-semibold">
                {g.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[17px] font-semibold">{crown(g.id)}{g.name}</span>
                  <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 font-dot text-[12px] font-semibold text-accent-ink">
                    {String(stats[g.id]?.points ?? 0).replace('.', ',')} б
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[13px] text-muted">
                  <span>сегодня {nToday}</span><span>· завтра {nTomorrow}</span>
                  <span>· выполнено за месяц {stats[g.id]?.count ?? 0}</span>
                  {unacked > 0 && <span className="text-[#D70015] dark:text-[#FF453A]">· не подтв. {unacked}</span>}
                </div>
              </div>
              <span className="font-dot text-[24px] font-semibold tabular-nums text-accent-ink">{g.list.length}</span>
              <ChevronDown size={20} strokeWidth={1.75} className={cx('shrink-0 text-muted transition-transform', open && 'rotate-180')} />
            </button>
            {open && (
              <div className="border-t border-dashed border-line px-2 pb-3 pt-3">
                <TaskList tasks={g.list} showTech={false} onOpen={onOpen} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Админ-панель → «Обзор»: доска заявок — подтверждение новых, кто не нажал «Уведомлен»,
 * запросы на аннулирование, выезды в работе и все открытые заявки по сотрудникам.
 */
export function AdminTasksBoard({ onOpen, onJobs }: { onOpen: (visitId: string) => void; onJobs?: () => void }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [pending, setPending] = useState<Task[]>([]);
  const [unacked, setUnacked] = useState<Task[]>([]);
  const [annul, setAnnul] = useState<AnnulRequest[]>([]);
  const [cancelled, setCancelled] = useState<Task[]>([]);
  const [open, setOpen] = useState<VisitSummary[]>([]);
  const [task, setTask] = useState<Task | null>(null);
  const [jobsKey, setJobsKey] = useState(0);
  const [annKey, setAnnKey] = useState(0);
  const [openTasks, setOpenTasks] = useState<Task[]>([]);
  const cfg = useConfig();
  const load = useCallback(() => {
    api.tasks(true).then((r) => { setTasks(r.items); setOpenTasks(r.open_tasks || []); setPending(r.pending || []); setUnacked(r.unacked || []); setAnnul(r.annul_requests || []); setCancelled(r.cancelled || []); }).catch(() => setTasks([]));
    api.visits().then((r) => setOpen(r.items.filter((v) => v.status === 'open' && !v.approval))).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  if (!tasks) return <Spinner />;
  const active = tasks.filter((t) => !t.visit_id);
  return (
    <div className="mb-2">
      {(cfg.user.isOwner || cfg.user.perms?.includes('tasks') || cfg.user.perms?.includes('jobs')) && (
        <div className="mb-2 grid max-w-xl grid-cols-2 gap-2.5">
          <NewTaskButton onCreated={(k) => (k === 'job' ? setJobsKey((n) => n + 1) : load())} />
          <AnnounceButton onSent={() => setAnnKey((n) => n + 1)} />
        </div>
      )}
      <AnnouncementsWidget refreshKey={annKey} />
      {onJobs && <JobsReviewWidget onAll={onJobs} refreshKey={jobsKey} />}
      {openTasks.length > 0 && (
        <>
          <SectionTitle>🙋 Ждут, кто заберёт · {openTasks.length}</SectionTitle>
          <Group>
            {openTasks.map((t) => (
              <Row key={t.id} onClick={() => setTask(t)} boost={(t.mult_eff ?? 1) > 1} title={`№ ${t.task_no} · ${t.company_name || t.address}`}
                subtitle={`для: ${audienceText(t.audience)}${(t.claim_bonus ?? 0) > 0 ? ` · бонус +${String(t.claim_bonus).replace('.', ',')} б` : ''}`}
                right={<span className="text-[12.5px] font-medium text-[#C93400] dark:text-[#FF9F0A]">свободна</span>} />
            ))}
          </Group>
        </>
      )}
      {pending.length > 0 && (
        <>
          <SectionTitle>Ждут подтверждения · {pending.length}</SectionTitle>
          <div className="grid gap-2.5 lg:grid-cols-2">{pending.map((t) => <PendingTask key={t.id} t={t} onDone={load} />)}</div>
        </>
      )}
      {annul.length > 0 && (
        <>
          <SectionTitle>Аннулировать выполнение? · {annul.length}</SectionTitle>
          <Group>
            {annul.map((a) => (
              <Row key={a.id} onClick={() => onOpen(a.id)}
                left={<IconBadge tone="red"><AlertTriangle size={18} strokeWidth={1.75} /></IconBadge>}
                title={`${a.tech_name} · акт № ${a.act_no}`}
                subtitle={<><div className="truncate">{a.company_name} · {a.address}</div><div className="truncate">«{a.reason}»</div></>} />
            ))}
          </Group>
        </>
      )}
      {unacked.length > 0 && (
        <>
          <SectionTitle>Не подтвердили получение · {unacked.length}</SectionTitle>
          <Group>
            {unacked.map((t) => {
              const mins = Math.max(0, Math.round((Date.now() - new Date(t.sent_at || t.created_at).getTime()) / 60000));
              return (
                <Row key={t.id} onClick={() => setTask(t)} title={`${t.tech_name} · № ${t.task_no}`} subtitle={t.company_name || t.address}
                  right={<div className="text-right"><div className="font-mono text-[13px] text-[#D71921] dark:text-[#FF4D4D]">{mins < 60 ? `${mins} мин` : `${Math.floor(mins / 60)} ч ${mins % 60} м`}</div><div className="text-[11.5px] text-muted">напоминаний: {t.alert_count || 0}</div></div>} />
              );
            })}
          </Group>
        </>
      )}
      <div className="grid gap-x-6 lg:grid-cols-2">
        <div className="min-w-0">
          <SectionTitle>Заявки · {active.length}</SectionTitle>
          {active.length === 0 ? <div className="rounded-2xl bg-card p-4 text-[15px] text-muted">Открытых заявок нет</div>
            : <TasksByTech tasks={active} onOpen={setTask} />}
          <CancelledTasks items={cancelled} showTech onRestored={load} />
        </div>
        <div className="min-w-0">
          <SectionTitle>В работе · {open.length}</SectionTitle>
          {open.length === 0 ? <div className="rounded-2xl bg-card p-4 text-[15px] text-muted">Сейчас никто не на выезде</div>
            : <Group>{open.map((v) => <VisitRow key={v.id} v={v} showTech onClick={() => onOpen(v.id)} />)}</Group>}
        </div>
      </div>
      {task && <TaskSheet task={task} onClose={() => setTask(null)} onStarted={onOpen} onCancelled={() => { setTask(null); load(); }} />}
    </div>
  );
}
