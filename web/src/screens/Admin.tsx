import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Building2, Camera, ClipboardCheck, Download, FileSpreadsheet, FileText, FlaskConical, History, MessageCircle, Pencil, QrCode, Stamp, Stethoscope, Search, Users,
} from 'lucide-react';
import { api } from '../api';
import { KpiPlanPanel } from './KpiPlan';
import { JobsPanel, MyJobs } from './Jobs';
import { AppLogoutButtons } from './AppLogin';
import { SpecialistsPanel } from './Specialists';
import { APP_VERSION, AdminTasksBoard, LabelsSheet } from './Home';
import { CoachPanel, EfficiencyDash, OVERVIEW_WIDGETS, OfficeCallsWidget, TimelinessDash } from './Dashboards';
import { compressImage } from '../image';
import { fmtDate, plural, useConfig } from '../config';
import { getThemePref, haptic, openLink, setThemePref, useBackButton, type ThemePref } from '../telegram';
import type { AdminStats, AdminVisit, AuditItem, CompanySettings, Features, GeoSettings } from '../types';
import { ContestSettingsPanel, ContestWidget } from './Contest';
import { AnnouncementBanners, OpenWork } from './Announce';
import { GuardSettingsPanel, GuardWidget } from './Guard';
import { LiveWidget } from './Play';
import { PointsEditor } from '../components/PointsEditor';
import { MediaGallery, MediaReviewWidget } from '../components/MediaUpload';
import {
  Button, Chips, Empty, Field, Group, IconBadge, Input, LargeTitle, Pill, Row, Screen, SectionTitle, Segmented, Sheet, Spinner, TextArea, Toggle, cx, useToast, Collapse,
} from '../components/ui';
import { ClientsSheet } from './ClientsSheet';
import { OfficeSheet } from './OfficeSheet';
import { StaffPanel } from './Staff';
import { CrmSheet } from './CrmSheet';
import { Bars, Daily, Tile } from '../components/charts';
import { PestsDash, RemarksPanel, TasksDash } from './AdminDash';
import { BotStatusSheet } from './BotStatus';
import { KpiPanel } from './Kpi';
import { MgrHero, SalesPanel, setSalesFocus } from './Sales';
import { RoomsDisputesWidget } from './Rooms';
import { CarsPanel } from './Car';

export type AdminTab = 'overview' | 'sales' | 'cars' | 'jobs' | 'specialists' | 'media' | 'tasks' | 'plan' | 'kpi' | 'pests' | 'acts' | 'remarks' | 'staff' | 'audit' | 'settings';
type Period = '7' | '30' | '90';

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'sales', label: 'Продажи' },
  { id: 'cars', label: 'Автопарк' },
  { id: 'jobs', label: 'Поручения' },
  { id: 'specialists', label: 'Специалисты' },
  { id: 'media', label: 'Фото / видео' },
  { id: 'tasks', label: 'Заявки' },
  { id: 'plan', label: 'План KPI' },
  { id: 'kpi', label: 'KPI' },
  { id: 'pests', label: 'Вредители' },
  { id: 'acts', label: 'Акты' },
  { id: 'remarks', label: 'Замечания' },
  { id: 'staff', label: 'Сотрудники' },
  { id: 'audit', label: 'Журнал' },
  { id: 'settings', label: 'Настройки' },
];
const PERIODS: { id: Period; label: string }[] = [
  { id: '7', label: '7 дней' },
  { id: '30', label: '30 дней' },
  { id: '90', label: '90 дней' },
];

const range = (p: Period) => {
  const to = new Date();
  const from = new Date(Date.now() - (Number(p) - 1) * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
};

export function Admin({ tab, onTab, onBack, onOpen, onConfigChanged }: {
  tab: AdminTab; onTab: (t: AdminTab) => void; onBack?: () => void; onOpen: (id: string) => void; onConfigChanged: () => void;
}) {
  const cfg = useConfig();
  const [period, setPeriod] = useState<Period>('30');
  useBackButton(onBack);
  const tabs = useMemo(() => orderedTabs(cfg.prefs?.tabs_order, cfg.prefs?.tabs_hidden).filter((t) => t.visible && tabAllowed(t.id, cfg.user.perms)), [cfg.prefs?.tabs_order, cfg.prefs?.tabs_hidden, cfg.user.perms]);
  // скрытая вкладка (например, выключили в Настройках) — показываем «Обзор»
  useEffect(() => { if (!tabs.some((t) => t.id === tab)) onTab('overview'); }, [tabs, tab, onTab]);

  return (
    <Screen wide>
      <LargeTitle title={cfg.user.role === 'manager' ? 'Кабинет менеджера' : 'Админ-панель'} subtitle={cfg.user.name} onBack={onBack} />
      <div className="mb-6">
        <Segmented options={tabs.map((t) => ({ id: t.id, label: t.id === 'staff' && cfg.pendingUsers ? `${t.label} · ${cfg.pendingUsers}` : t.id === 'sales' && cfg.user.role === 'manager' ? 'Мои продажи' : t.id === 'overview' && cfg.user.role === 'manager' ? 'Главная' : t.label }))} value={tab} onChange={onTab} />
      </div>
      {['tasks', 'pests', 'acts'].includes(tab) && (
        <div className="mb-5 max-w-xs"><Segmented options={PERIODS} value={period} onChange={setPeriod} /></div>
      )}
      {tab === 'overview' && <Overview period={period} setPeriod={setPeriod} onOpen={onOpen} onActs={() => onTab('acts')} onSettings={() => onTab('settings')} onTab={onTab} />}
      {tab === 'sales' && <SalesPanel />}
      {tab === 'cars' && <CarsPanel />}
      {tab === 'tasks' && <TasksDash {...range(period)} />}
      {tab === 'specialists' && <SpecialistsPanel onOpen={onOpen} />}
      {tab === 'media' && <MediaGallery />}
      {tab === 'jobs' && <JobsPanel />}
      {tab === 'plan' && <KpiPlanPanel />}
      {tab === 'kpi' && <KpiPanel />}
      {tab === 'pests' && <PestsDash {...range(period)} />}
      {tab === 'acts' && <Acts period={period} onOpen={onOpen} />}
      {tab === 'remarks' && <RemarksPanel onOpen={onOpen} />}
      {tab === 'staff' && <StaffPanel />}
      {tab === 'audit' && <Audit />}
      {tab === 'settings' && <Settings onConfigChanged={onConfigChanged} />}
    </Screen>
  );
}

/* ---------------- Обзор ---------------- */

function Overview({ period, setPeriod, onOpen, onActs, onSettings, onTab }: { period: Period; setPeriod: (p: Period) => void; onOpen: (id: string) => void; onActs: () => void; onSettings: () => void; onTab: (t: AdminTab) => void }) {
  const toast = useToast();
  const cfg = useConfig();
  const [s, setS] = useState<AdminStats | null>(null);
  const canReports = can(cfg, 'reports');
  useEffect(() => {
    if (!canReports) return;
    setS(null);
    api.adminStats(range(period)).then(setS).catch((e: Error) => toast(e.message, 'error'));
  }, [period, toast, canReports]);
  // виджет, появившийся после сохранения настройки «Обзора», показываем, пока его явно не выключат
  const known = cfg.prefs?.overview_known ?? OVERVIEW_WIDGETS.map((w) => w.id).filter((x) => x !== 'contest');
  // менеджеру — только виджеты разделов, на которые у него есть права
  const WIDGET_PERM: Record<string, string> = { live: 'tasks', guard: 'kpi', coach: 'kpi', media: 'media', tiles: 'reports', efficiency: 'kpi', timeliness: 'kpi', office: 'tasks', daily: 'reports', bars: 'reports', alerts: 'reports' };
  const on = (id: string) => (!WIDGET_PERM[id] || can(cfg, WIDGET_PERM[id]))
    && ((cfg.prefs?.overview ?? OVERVIEW_WIDGETS.map((w) => w.id)).includes(id) || (Boolean(cfg.prefs?.overview) && !known.includes(id)));
  const statsOn = can(cfg, 'reports');
  return (
    <>
      <RoomsDisputesWidget />
      {cfg.user.role === 'manager' && <MgrHero onOpen={(f) => { setSalesFocus(f || ''); onTab('sales'); }} />}
      {cfg.user.role === 'manager' && <AnnouncementBanners />}
      {cfg.user.role === 'manager' && <OpenWork />}
      {cfg.user.role === 'manager' && <MyJobs />}
      {on('tasks') && <AdminTasksBoard onOpen={onOpen} onJobs={() => onTab('jobs')} />}
      {on('contest') && cfg.features?.contest !== false && <div className="mt-4"><ContestWidget /></div>}
      {on('live') && cfg.features?.geo_shift !== false && <LiveWidget />}
      {on('guard') && <GuardWidget onOpen={onOpen} />}
      {on('coach') && <div className="mt-4"><CoachPanel /></div>}
      {on('media') && <div className="mt-4"><MediaReviewWidget onAll={() => onTab('media')} /></div>}
      {statsOn && on('tasks') && <SectionTitle>Показатели за период</SectionTitle>}
      {statsOn && <div className="mb-4 max-w-xs"><Segmented options={PERIODS} value={period} onChange={setPeriod} /></div>}
      {!statsOn ? null : !s ? <Spinner /> : (
      <>
      {on('tiles') && (
        <>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <Tile label="Выездов" value={s.total} />
            <Tile label="Завершено" value={s.done} />
            <Tile label="Высокая заселённость" value={s.high} tone={s.high ? 'red' : undefined} />
            <Tile label="Без подготовки" value={s.unprepared} tone={s.unprepared ? 'orange' : undefined} />
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <Tile label="В работе" value={s.open} />
            <Tile label="Замечаний" value={s.notes} />
            <Tile label="Фото" value={s.photos} />
            <button onClick={onActs} className="rounded-2xl bg-accent/[0.08] p-4 text-left">
              <div className="text-[13px] text-muted">Все акты</div>
              <div className="mt-1 text-[17px] font-semibold text-accent-ink">Открыть список →</div>
            </button>
          </div>
        </>
      )}

      {(on('efficiency') || on('office')) && (
        <div className="mt-2.5 grid gap-2.5 lg:grid-cols-2">
          {on('efficiency') && <EfficiencyDash />}
          {on('office') && <OfficeCallsWidget />}
        </div>
      )}
      {on('timeliness') && <div className="mt-2.5"><TimelinessDash /></div>}

      {on('daily') && s.daily.length > 0 && <div className="mt-2.5"><Daily days={s.daily} /></div>}

      {on('bars') && (
        <div className="mt-2.5 grid gap-2.5 md:grid-cols-3">
          <Bars title="По специалистам" items={s.by_tech} />
          <Bars title="По обработкам" items={s.by_procedure} />
          <Bars title="По вредителям" items={s.by_pest} />
        </div>
      )}

      {on('alerts') && (
        <>
          <SectionTitle>Требуют внимания</SectionTitle>
          {s.alerts.length === 0 ? (
            <div className="rounded-2xl bg-card p-4 text-[15px] text-muted">Объектов с высокой заселённостью или без подготовки нет</div>
          ) : (
            <Group>{s.alerts.map((v) => <ActRow key={v.id} v={v} onClick={() => onOpen(v.id)} />)}</Group>
          )}
        </>
      )}
      </>
      )}
      <button onClick={onSettings} className="mt-6 w-full text-center text-[13px] text-accent-ink">Настроить, что показывать на этой странице →</button>
    </>
  );
}

/* ---------------- Акты ---------------- */

const INF_LABEL: Record<string, string> = { none: 'Не выявлено', low: 'Низкая', medium: 'Средняя', high: 'Высокая', critical: 'Критическая' };

function ActRow({ v, onClick }: { v: AdminVisit; onClick: () => void }) {
  const hot = v.infestation === 'high' || v.infestation === 'critical';
  return (
    <Row
      onClick={onClick}
      left={<IconBadge tone={v.status === 'open' ? 'blue' : hot ? 'red' : 'green'}>
        {hot ? <AlertTriangle size={18} strokeWidth={1.75} /> : <ClipboardCheck size={18} strokeWidth={1.75} />}
      </IconBadge>}
      title={v.company_name}
      subtitle={
        <>
          <div className="truncate">{v.procedure} · {fmtDate(v.finished_at || v.started_at)} · {v.tech_name}</div>
          <div className="mt-0.5 truncate">
            № {v.act_no}{v.pests.length ? ` · ${v.pests.join(', ')}` : ''}{v.infestation ? ` · ${INF_LABEL[v.infestation] ?? ''}` : ''}
            {v.preparation === 'none' ? ' · без подготовки' : ''}
          </div>
        </>
      }
      right={
        <div className="flex flex-col items-end gap-1">
          {v.status === 'open' ? <Pill tone="blue">В работе</Pill> : v.revision ? <Pill tone="orange"><Pencil size={12} strokeWidth={2} className="mr-1" />ред. {v.revision}</Pill> : null}
          {v.photos > 0 && <Pill><Camera size={12} strokeWidth={2} className="mr-1" />{v.photos}</Pill>}
        </div>
      }
    />
  );
}

function Acts({ period, onOpen }: { period: Period; onOpen: (id: string) => void }) {
  const cfg = useConfig();
  const toast = useToast();
  const [items, setItems] = useState<AdminVisit[] | null>(null);
  const [q, setQ] = useState('');
  const [procedure, setProcedure] = useState('');
  const [status, setStatus] = useState('');
  const [tech, setTech] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setItems(null);
    const t = setTimeout(() => {
      api.adminVisits({ ...range(period), q: q.trim(), procedure, status, tech })
        .then((r) => setItems(r.items)).catch((e: Error) => toast(e.message, 'error'));
    }, 250);
    return () => clearTimeout(t);
  }, [period, q, procedure, status, tech, toast]);

  const techs = useMemo(() => {
    const m = new Map<string, string>();
    items?.forEach((v) => m.set(v.tech_id, v.tech_name));
    return [...m.entries()];
  }, [items]);

  async function exportCsv() {
    setExporting(true);
    try {
      const { url } = await api.exportVisits({ ...range(period), q: q.trim() || undefined, procedure: procedure || undefined, status: status || undefined, tech: tech || undefined });
      openLink(url);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="grid gap-2.5 md:grid-cols-[1fr_auto]">
        <Input icon={<Search size={18} strokeWidth={1.75} />} placeholder="Юрлицо, адрес, специалист или № акта" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="secondary" className="md:w-auto" loading={exporting} onClick={exportCsv} icon={<Download size={18} strokeWidth={1.75} />}>
          Выгрузить в Excel
        </Button>
      </div>
      <div className="mt-3 space-y-2.5">
        <Chips columns={3} value={status} onChange={(v) => setStatus(v === status ? '' : v)}
          options={[{ id: '', label: 'Все' }, { id: 'done', label: 'Завершены' }, { id: 'open', label: 'В работе' }]} />
        <Chips columns={3} value={procedure} onChange={(v) => setProcedure(v === procedure ? '' : v)}
          options={cfg.procedures.map((p) => ({ id: p, label: p }))} />
        {techs.length > 1 && (
          <Chips columns={3} value={tech} onChange={(v) => setTech(v === tech ? '' : v)} options={techs.map(([id, name]) => ({ id, label: name }))} />
        )}
      </div>

      <SectionTitle>{items ? `${items.length} ${plural(items.length, ['акт', 'акта', 'актов'])}` : 'Акты'}</SectionTitle>
      {!items ? <Spinner /> : items.length === 0 ? (
        <Empty icon={<FileSpreadsheet size={44} strokeWidth={1.25} />} title="Ничего не найдено" text="Измените период или фильтры" />
      ) : (
        <Group>{items.map((v) => <ActRow key={v.id} v={v} onClick={() => onOpen(v.id)} />)}</Group>
      )}
    </>
  );
}

/* ---------------- Журнал ---------------- */

function Audit() {
  const toast = useToast();
  const [items, setItems] = useState<AuditItem[] | null>(null);
  useEffect(() => { api.audit().then((r) => setItems(r.items)).catch((e: Error) => toast(e.message, 'error')); }, [toast]);
  if (!items) return <Spinner />;
  if (!items.length) return <Empty icon={<History size={44} strokeWidth={1.25} />} title="Журнал пуст" />;
  return (
    <Group>
      {items.map((a) => (
        <div key={a.id} className="px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[16px] font-semibold">{a.action}</div>
            <div className="shrink-0 text-[13px] text-muted">{fmtDate(a.at)}</div>
          </div>
          {a.target && <div className="mt-0.5 text-[15px]">{a.target}</div>}
          {a.details && <div className="mt-0.5 text-[14px] text-muted">{a.details}</div>}
          <div className="mt-1 text-[13px] text-muted">{a.actor_name}</div>
        </div>
      ))}
    </Group>
  );
}

/* ---------------- Настройки ---------------- */

function Settings({ onConfigChanged }: { onConfigChanged: () => void }) {
  const cfg = useConfig();
  const [open, setOpen] = useState<'' | 'office' | 'clients' | 'company' | 'products' | 'bot' | 'stamp' | 'crm'>('');
  const [count, setCount] = useState(cfg.clients ?? 0);
  const toast = useToast();
  const done = useCallback(() => { setOpen(''); onConfigChanged(); }, [onConfigChanged]);

  async function setTemplate(t: string) {
    try {
      await api.saveSettings({ act_template: t });
      toast(t === 'ro' ? 'Акт: фирменный бланк (RO)' : 'Акт: современный (RU)');
      onConfigChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const productCount = Object.values(cfg.products || {}).reduce((n, l) => n + l.length, 0);
  const f = cfg.features;
  return (
    <>
      <p className="mb-1 px-1 text-[13px] text-muted">Нажмите на раздел, чтобы раскрыть. Открытые разделы запоминаются.</p>
      {cfg.user.isOwner && (
        <Collapse id="features" title="Функции" hint="Команды, проверяющие, менеджеры, соревнование">
          <FeaturesSettings onChanged={onConfigChanged} />
        </Collapse>
      )}
      {f?.contest !== false && can(cfg, 'kpi') && (
        <Collapse id="contest" title="👑 Соревнование" hint="Рейтинг по баллам, корона и бонус победителю месяца">
          <ContestSettingsPanel />
        </Collapse>
      )}
      {f?.geo_shift !== false && can(cfg, 'settings') && (
        <Collapse id="geo" title="📍 Смена в эфире" hint="Рабочие часы, опыт за час, утреннее напоминание">
          <GeoSettingsPanel />
        </Collapse>
      )}
      {can(cfg, 'kpi') && (
        <Collapse id="guard" title="🕵️ Контроль баллов" hint="Бот ищет завышение баллов и сообщает администратору">
          <GuardSettingsPanel />
        </Collapse>
      )}
      {can(cfg, 'settings') && (
        <Collapse id="act" title="Акт" hint="Бланк, реквизиты, печать, препараты">
          <Chips columns={2} value={cfg.actTemplate} onChange={setTemplate}
            options={[{ id: 'ro', label: 'Фирменный бланк (RO)' }, { id: 'modern', label: 'Современный (RU)' }]} />
          <Group className="mt-3">
            <Row title="Реквизиты компании" subtitle={cfg.company ? `${cfg.company.name} · ${cfg.company.rep}` : ''}
              left={<IconBadge tone="gray"><Building2 size={18} strokeWidth={1.75} /></IconBadge>} onClick={() => setOpen('company')} />
            <Row title="Печать и подпись" subtitle="Ставятся в акт в поле «Prestator»"
              left={<IconBadge tone="gray"><Stamp size={18} strokeWidth={1.75} /></IconBadge>} onClick={() => setOpen('stamp')} />
            <Row title="Препараты" subtitle={productCount ? `${productCount} в списках для выбора` : 'Список не заполнен'}
              left={<IconBadge tone="gray"><FlaskConical size={18} strokeWidth={1.75} /></IconBadge>} onClick={() => setOpen('products')} />
          </Group>
        </Collapse>
      )}
      {can(cfg, 'tasks') && (
        <Collapse id="tasks" title="Заявки" hint="Подтверждение заявок, сброс отменённых">
          <TaskApprovalToggle initial={cfg.taskApproval !== false} onChanged={onConfigChanged} />
          <div className="h-2.5" />
          <CancelledReset />
        </Collapse>
      )}
      <Collapse id="tools" title="Инструменты" hint="Тема, QR-этикетки, версия">
        <AdminTools />
        <AppLogoutButtons />
      </Collapse>
      <Collapse id="tabs" title="Вкладки админ-панели" hint="Какие вкладки показывать и в каком порядке">
        <TabsSettings onChanged={onConfigChanged} />
      </Collapse>
      <Collapse id="overview" title="Главная страница админ-панели" hint="Что показывать на «Обзоре»">
        <OverviewWidgetsSettings onChanged={onConfigChanged} />
      </Collapse>
      {can(cfg, 'kpi') && (
        <Collapse id="points" title="Баллы сотрудникам" hint="Категории, удалённость, вечер, коэффициенты">
          <PointsEditor onSaved={onConfigChanged} />
        </Collapse>
      )}
      {can(cfg, 'settings') && (
        <Collapse id="integrations" title="Интеграции и данные" hint="Чат офиса, проверка бота, база клиентов">
          <Group>
            <Row title="Чат офиса" subtitle={cfg.office ? cfg.office.title : 'Не подключён — отчёты не приходят'}
              left={<IconBadge tone={cfg.office ? 'green' : 'orange'}><MessageCircle size={18} strokeWidth={1.75} /></IconBadge>}
              onClick={() => setOpen('office')} />
            <Row title="Проверка бота и тем заявок" subtitle="Почему заявки из Telegram не приходят"
              left={<IconBadge tone="blue"><Stethoscope size={18} strokeWidth={1.75} /></IconBadge>}
              onClick={() => setOpen('bot')} />
            {!cfg.amo && (
              <Row title="База клиентов" subtitle={`${count} ${plural(count, ['юрлицо', 'юрлица', 'юрлиц'])} · загрузить Excel`}
                left={<IconBadge tone="gray"><Users size={18} strokeWidth={1.75} /></IconBadge>}
                onClick={() => setOpen('clients')} />
            )}
            {cfg.user.isOwner && (
              <Row title="CRM" subtitle="amoCRM: перевод сделки в «Успешно» и акт после выезда"
                left={<IconBadge tone="blue"><Building2 size={18} strokeWidth={1.75} /></IconBadge>}
                onClick={() => setOpen('crm')} />
            )}
          </Group>
        </Collapse>
      )}

      {open === 'crm' && <CrmSheet onClose={() => setOpen('')} />}
      {open === 'bot' && <BotStatusSheet onClose={() => setOpen('')} />}
      {open === 'stamp' && <StampSheet onClose={() => setOpen('')} />}
      {open === 'office' && <OfficeSheet current={cfg.office} onClose={() => setOpen('')} onSaved={done} />}
      {open === 'clients' && <ClientsSheet count={count} onClose={() => setOpen('')} onImported={(n) => setCount((c) => c + n)} />}
      {open === 'company' && cfg.company && <CompanySheet initial={cfg.company} onClose={() => setOpen('')} onSaved={done} />}
      {open === 'products' && <ProductsSheet initial={cfg.products} procedures={cfg.procedures} onClose={() => setOpen('')} onSaved={done} />}
    </>
  );
}

function CompanySheet({ initial, onClose, onSaved }: { initial: CompanySettings; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [c, setC] = useState(initial);
  const [busy, setBusy] = useState(false);
  const f = (k: keyof CompanySettings) => ({ value: c[k], onChange: (e: { target: { value: string } }) => setC({ ...c, [k]: e.target.value }) });
  async function save() {
    setBusy(true);
    try {
      await api.saveSettings({ company: c });
      toast('Реквизиты сохранены');
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title="Реквизиты компании">
      <p className="-mt-3 mb-5 text-[14px] text-muted">Блок «Prestator» и подпись в акте.</p>
      <div className="space-y-4">
        <Field label="Denumirea"><Input {...f('name')} /></Field>
        <Field label="Cod fiscal"><Input inputMode="numeric" {...f('fiscal')} /></Field>
        <Field label="Sediul"><Input {...f('seat')} /></Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Reprezentant"><Input {...f('rep')} /></Field>
          <Field label="Funcția"><Input {...f('func')} /></Field>
        </div>
        <Field label="Подпись под логотипом"><Input {...f('tagline')} /></Field>
        <Field label="Declarații și obligații"><TextArea rows={8} {...f('declarations')} /></Field>
        <Field label="Anexa nr. 1 · Declarația beneficiarului (каждый пункт с новой строки, {ore} — время без доступа)">
          <TextArea rows={10} {...f('annex_declaration')} />
        </Field>
      </div>
      <Button className="mt-6" loading={busy} onClick={save} icon={<FileText size={18} strokeWidth={1.75} />}>Сохранить</Button>
    </Sheet>
  );
}

function ProductsSheet({ initial, procedures, onClose, onSaved }: {
  initial: Record<string, string[]>; procedures: string[]; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState<Record<string, string>>(
    Object.fromEntries(procedures.map((p) => [p, (initial?.[p] || []).join('\n')])),
  );
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const products = Object.fromEntries(procedures.map((p) => [p, (text[p] || '').split('\n').map((x) => x.trim()).filter(Boolean)]));
      await api.saveSettings({ products });
      toast('Список препаратов сохранён');
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title="Препараты">
      <p className="-mt-3 mb-5 text-[14px] text-muted">По одному в строке, можно с концентрацией. Техник выбирает их кнопками, попадают в «Produse utilizate».</p>
      <div className="space-y-4">
        {procedures.map((p) => (
          <Field key={p} label={p}>
            <TextArea rows={4} placeholder={'Например:\nAgita 10 WG\nCyper-Pro 25%'} value={text[p] || ''}
              onChange={(e) => setText({ ...text, [p]: e.target.value })} />
          </Field>
        ))}
      </div>
      <Button className="mt-6" loading={busy} onClick={save}>Сохранить</Button>
    </Sheet>
  );
}

/** Обнулить счётчик отменённых заявок за неделю или месяц. */
function CancelledReset() {
  const toast = useToast();
  const [c, setC] = useState<{ week: number; month: number } | null>(null);
  const [busy, setBusy] = useState<'' | 'week' | 'month'>('');
  const load = useCallback(() => { api.cancelledCount().then(setC).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  async function reset(period: 'week' | 'month') {
    setBusy(period);
    try {
      const r = await api.resetCancelled(period);
      toast(`Обнулено: ${r.count}`);
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="rounded-[22px] bg-card p-4">
      <div className="text-[16px] font-medium">Счётчик отменённых заявок</div>
      <div className="mt-1 text-[13.5px] text-muted">
        За неделю: <b className="font-dot text-ink">{c?.week ?? '—'}</b> · за месяц: <b className="font-dot text-ink">{c?.month ?? '—'}</b>.
        Обнуление убирает их из списка «Отменённые» и из счётчика на дашборде. История KPI сохраняется.
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <Button variant="secondary" className="h-[46px] text-[15px]" loading={busy === 'week'} disabled={!c?.week} onClick={() => reset('week')}>Обнулить неделю</Button>
        <Button variant="secondary" className="h-[46px] text-[15px]" loading={busy === 'month'} disabled={!c?.month} onClick={() => reset('month')}>Обнулить месяц</Button>
      </div>
    </div>
  );
}

/** Заявки из тем, написанные не администратором, уходят технику только после подтверждения. */
function TaskApprovalToggle({ initial, onChanged }: { initial: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [on, setOn] = useState(initial);
  return (
    <div className="rounded-[22px] bg-card p-4">
      <Toggle label="Подтверждение заявок администратором" checked={on} onChange={async (v) => {
        setOn(v);
        try { await api.saveSettings({ task_approval: v }); onChanged(); } catch (e) { setOn(!v); toast((e as Error).message, 'error'); }
      }} />
      <div className="mt-2 px-1 text-[13px] leading-snug text-muted">
        {on
          ? 'Заявку, написанную в теме не администратором, сначала подтверждает админ (кнопка в Telegram или на главной), и только потом она уходит технику. Выезды без заявки подтверждаются всегда.'
          : 'Заявки из тем сразу уходят технику. Выезды без заявки всё равно подтверждает администратор.'}
      </div>
    </div>
  );
}

/** Печать и подпись исполнителя в акте: по умолчанию (из фото), своя картинка или без печати. */
function StampSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<{ mode: 'default' | 'custom' | 'off'; image: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.stamp().then(setData).catch((e: Error) => toast(e.message, 'error')); }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function save(mode: 'default' | 'custom' | 'off', image?: string) {
    setBusy(true);
    try { await api.setStamp({ mode, image }); toast('Сохранено'); load(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  return (
    <Sheet open onClose={onClose} title="Печать и подпись">
      {!data ? <Spinner /> : (
        <>
          <div className="mb-4 flex h-40 items-center justify-center rounded-2xl bg-white p-4 ring-1 ring-inset ring-line">
            {data.mode !== 'off' && data.image
              ? <img src={data.image} alt="Печать" className="max-h-full max-w-full object-contain" />
              : <span className="text-[14px] text-black/40">Без печати</span>}
          </div>
          <Segmented<'default' | 'custom' | 'off'>
            options={[{ id: 'default', label: 'Стандартная' }, { id: 'custom', label: 'Своя' }, { id: 'off', label: 'Не ставить' }]}
            value={data.mode}
            onChange={(m) => { if (m !== 'custom') save(m); else setData({ ...data, mode: 'custom' }); }}
          />
          {data.mode === 'custom' && (
            <label className="mt-4 flex h-[50px] cursor-pointer items-center justify-center rounded-full bg-accent text-[16px] font-semibold text-black">
              {busy ? 'Загрузка…' : 'Загрузить фото печати'}
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try { await save('custom', await compressImage(f, 900, 0.9)); } catch (err) { toast((err as Error).message, 'error'); }
              }} />
            </label>
          )}
          <p className="mt-4 text-[13px] leading-snug text-muted">
            Лучше всего — печать с подписью на белом листе, снятая сверху без тени и обрезанная по краям. Печать встаёт в поле «Prestator» Proces-verbal и под Anexa.
          </p>
        </>
      )}
    </Sheet>
  );
}

/** Галочки: какие блоки показывать на вкладке «Обзор». */
/** Вкладки в заданном порядке; новые (которых нет в сохранённом порядке) — на своих местах в конце. */
const LOCKED_TABS: AdminTab[] = ['overview', 'settings'];
/** Какое право нужно менеджеру для вкладки (главному администратору доступно всё). */
const TAB_PERM: Partial<Record<AdminTab, string>> = {
  jobs: 'jobs|tasks', specialists: 'kpi', media: 'media', tasks: 'reports', plan: 'kpi', kpi: 'kpi', pests: 'reports', acts: 'reports', remarks: 'reports', staff: 'staff', audit: 'audit',
};
const tabAllowed = (id: AdminTab, perms?: string[]) => !TAB_PERM[id] || !perms || TAB_PERM[id]!.split('|').some((p) => perms.includes(p));
const can = (cfg: { user: { perms?: string[]; isOwner?: boolean } }, perm: string) => Boolean(cfg.user.isOwner) || perm.split('|').some((p) => (cfg.user.perms || []).includes(p));
function orderedTabs(order?: string[], hidden?: string[]) {
  const byId = new Map(TABS.map((t) => [t.id, t]));
  const ids = [...(order || []).filter((id) => byId.has(id as AdminTab)), ...TABS.map((t) => t.id).filter((id) => !(order || []).includes(id))] as AdminTab[];
  // «Обзор» всегда первым, «Настройки» — последними
  const mid = ids.filter((id) => !LOCKED_TABS.includes(id));
  return (['overview', ...mid, 'settings'] as AdminTab[]).map((id) => ({ ...byId.get(id)!, visible: LOCKED_TABS.includes(id) || !(hidden || []).includes(id) }));
}

function TabsSettings({ onChanged }: { onChanged: () => void }) {
  const cfg = useConfig();
  const toast = useToast();
  const [list, setList] = useState(() => orderedTabs(cfg.prefs?.tabs_order, cfg.prefs?.tabs_hidden).filter((t) => tabAllowed(t.id, cfg.user.perms)));
  async function save(next: typeof list) {
    const prev = list;
    setList(next);
    try {
      await api.setPrefs({ tabs_order: next.map((t) => t.id), tabs_hidden: next.filter((t) => !t.visible).map((t) => t.id) });
      onChanged();
    } catch (e) { toast((e as Error).message, 'error'); setList(prev); }
  }
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (LOCKED_TABS.includes(list[i].id) || LOCKED_TABS.includes(list[j]?.id)) return;
    haptic.tap();
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  const arrow = 'flex h-9 w-9 items-center justify-center rounded-full text-[16px] text-muted active:bg-fill disabled:opacity-25';
  return (
    <div className="rounded-[22px] bg-card p-2">
      {list.map((t, i) => {
        const locked = LOCKED_TABS.includes(t.id);
        return (
          <div key={t.id} className="flex items-center gap-2 rounded-xl px-3 py-1.5">
            <label className={cx('flex min-w-0 flex-1 items-center gap-3 py-1', !locked && 'cursor-pointer')}>
              <input type="checkbox" className="h-5 w-5 shrink-0 accent-[#F58220]" checked={t.visible} disabled={locked}
                onChange={() => { haptic.tap(); save(list.map((x) => (x.id === t.id ? { ...x, visible: !x.visible } : x))); }} />
              <span className={cx('truncate text-[15px] font-medium', !t.visible && 'text-muted line-through')}>{t.label}</span>
              {locked && <span className="shrink-0 text-[12px] text-muted">всегда</span>}
            </label>
            {!locked && (
              <>
                <button aria-label="Выше" className={arrow} disabled={LOCKED_TABS.includes(list[i - 1]?.id)} onClick={() => move(i, -1)}>↑</button>
                <button aria-label="Ниже" className={arrow} disabled={LOCKED_TABS.includes(list[i + 1]?.id)} onClick={() => move(i, 1)}>↓</button>
              </>
            )}
          </div>
        );
      })}
      <div className="px-3 pb-2 pt-1 text-[12.5px] text-muted">Снимите галочку — вкладка пропадёт из строки сверху. Стрелками меняется порядок. Настройка своя у каждого администратора.</div>
    </div>
  );
}

const FEATURE_LIST: { id: keyof Features; label: string; hint: string }[] = [
  { id: 'team', label: 'Командные заявки', hint: 'несколько сотрудников на объект: ответственный получает оплату, баллы объекта — каждому полностью, стоимость делится поровну' },
  { id: 'job_reviewer', label: 'Проверяющий для поручений', hint: 'специалист принимает работу вместо офиса — после его «Принять» баллы идут в зачёт' },
  { id: 'managers', label: 'Роль «Менеджер»', hint: 'администратор с ограниченными правами — права отмечаются в карточке сотрудника' },
  { id: 'contest', label: 'Соревнование 👑', hint: 'рейтинг по баллам, корона и бонус победителю месяца' },
  { id: 'one_open', label: 'Сначала закрыть предыдущий выезд', hint: 'пока акт не завершён, нельзя нажать «Еду к клиенту» и начать следующую заявку' },
  { id: 'game', label: 'Игра: опыт, уровни, квесты, значки', hint: 'XP за звонок, приезд вовремя, выезд, фото, ответы офису и смену в эфире; на баллы KPI не влияет' },
  { id: 'geo_shift', label: 'Смена в эфире (геопозиция боту)', hint: 'сотрудник транслирует геопозицию боту; карта «В пути», «Кто где» у офиса, удалённость подтверждается сама' },
  { id: 'require_geo_start', label: 'Обязательная геолокация', hint: 'без переданной геопозиции нельзя начать обработку («Приступить») и нельзя завершить выезд' },
];
function FeaturesSettings({ onChanged }: { onChanged: () => void }) {
  const cfg = useConfig();
  const toast = useToast();
  const [f, setF] = useState<Features>({ game: true, geo_shift: true, ...(cfg.features || { team: true, job_reviewer: true, managers: true, contest: true, one_open: true }) });
  const toggle = async (id: keyof Features) => {
    const next = { ...f, [id]: !f[id] };
    setF(next);
    try { await api.saveFeatures({ [id]: next[id] }); haptic.tap(); onChanged(); } catch (e) { toast((e as Error).message, 'error'); setF(f); }
  };
  return (
    <div className="rounded-[18px] bg-card p-1.5">
      {FEATURE_LIST.map((x) => (
        <label key={x.id} className={'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 active:bg-fill'}>
          <input type="checkbox" className="h-5 w-5 shrink-0 accent-[#F58220]" checked={f[x.id]} onChange={() => toggle(x.id)} />
          <span className="min-w-0">
            <span className="block text-[15px] font-medium">{x.label}</span>
            <span className="block text-[12.5px] leading-snug text-muted">{x.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function OverviewWidgetsSettings({ onChanged }: { onChanged: () => void }) {
  const cfg = useConfig();
  const toast = useToast();
  const [sel, setSel] = useState<string[]>(cfg.prefs?.overview ?? OVERVIEW_WIDGETS.map((w) => w.id));
  const toggle = async (id: string) => {
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    setSel(next);
    try { await api.setPrefs({ overview: next }); onChanged(); } catch (e) { toast((e as Error).message, 'error'); setSel(sel); }
  };
  return (
    <div className="rounded-[22px] bg-card p-2">
      {OVERVIEW_WIDGETS.map((w) => (
        <label key={w.id} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 active:bg-fill">
          <input type="checkbox" className="h-5 w-5 shrink-0 accent-[#F58220]" checked={sel.includes(w.id)} onChange={() => toggle(w.id)} />
          <span className="min-w-0">
            <span className="block text-[15px] font-medium">{w.label}</span>
            <span className="block text-[12.5px] text-muted">{w.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** Инструменты администратора (раньше были на экране «Выезды»): тема оформления, QR-этикетки, версия. */
function AdminTools() {
  const toast = useToast();
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const [labels, setLabels] = useState(false);
  return (
    <>
      <Group>
        <div className="px-4 py-3">
          <div className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Тема оформления</div>
          <Segmented<ThemePref>
            options={[{ id: 'light', label: 'Светлая' }, { id: 'dark', label: 'Тёмная' }, { id: 'auto', label: 'Как в Telegram' }]}
            value={theme}
            onChange={(v) => { haptic.tap(); setTheme(v); setThemePref(v); api.setPrefs({ theme: v }).catch((e: Error) => toast(e.message, 'error')); }}
          />
        </div>
        <Row title="QR-этикетки для ловушек" subtitle="Печать листа A4"
          left={<IconBadge tone="gray"><QrCode size={18} strokeWidth={1.75} /></IconBadge>} onClick={() => setLabels(true)} />
      </Group>
      <div className="mt-2 px-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted/70">Версия {APP_VERSION}</div>
      <LabelsSheet open={labels} onClose={() => setLabels(false)} />
    </>
  );
}

/** Настройки смены в эфире: рабочие часы, сколько часов в день даёт опыт, утреннее напоминание в боте. */
function GeoSettingsPanel() {
  const toast = useToast();
  const [s, setS] = useState<GeoSettings | null>(null);
  const [v, setV] = useState({ from_hour: '8', to_hour: '20', max_hours: '8', morning_hour: '8' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.geoSettings().then((r) => { setS(r.settings); setV({ from_hour: String(r.settings.from_hour), to_hour: String(r.settings.to_hour), max_hours: String(r.settings.max_hours), morning_hour: String(r.settings.morning_hour) }); })
      .catch((e: Error) => toast(e.message, 'error'));
  }, [toast]);
  if (!s) return <Spinner />;
  const save = async (p: Partial<GeoSettings>) => {
    setBusy(true);
    try { const r = await api.saveGeoSettings(p); setS(r.settings); haptic.success(); toast('Сохранено'); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 items-end gap-2.5">
        <Field label="С, час"><Input inputMode="numeric" value={v.from_hour} onChange={(e) => setV({ ...v, from_hour: e.target.value })} /></Field>
        <Field label="До, час"><Input inputMode="numeric" value={v.to_hour} onChange={(e) => setV({ ...v, to_hour: e.target.value })} /></Field>
        <Field label="Часов в день"><Input inputMode="numeric" value={v.max_hours} onChange={(e) => setV({ ...v, max_hours: e.target.value })} /></Field>
      </div>
      <div className="rounded-2xl bg-card px-4 py-3">
        <Toggle label="Утром напоминать в боте включить смену" checked={s.morning} onChange={(m) => save({ morning: m })} />
      </div>
      {s.morning && <Field label="Во сколько напоминать, час"><Input inputMode="numeric" value={v.morning_hour} onChange={(e) => setV({ ...v, morning_hour: e.target.value })} /></Field>}
      <Button loading={busy} onClick={() => save({ from_hour: Number(v.from_hour), to_hour: Number(v.to_hour), max_hours: Number(v.max_hours), morning_hour: Number(v.morning_hour) })}>Сохранить</Button>
      <p className="px-1 text-[12.5px] leading-snug text-muted">
        Сотрудник включает в боте трансляцию геопозиции (📎 → Геопозиция → «Транслировать» → 8 часов). Бот благодарит, и за каждый час в эфире в рабочие часы даёт +10 XP.
        Час засчитывается, только если точки приходили; утром бот напоминает тем, у кого сегодня есть заявки. Геопозицию видит офис («Обзор» → «Кто где»), по ней считается время в пути и удалённость выезда.
      </p>
    </div>
  );
}
