import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bell, Car as CarIcon, CalendarClock, ChevronRight, Hand, Home as HomeIcon, Inbox, MapPin, Megaphone, Navigation, Plus, Trophy, User as UserIcon } from 'lucide-react';
import { api } from '../api';
import { useConfig } from '../config';
import { getLocation, getThemePref, haptic, openLink, openTgChat, setThemePref, type ThemePref } from '../telegram';
import type { GameState, InboxItem, InboxRes, Job, MonthSummary, MyPlan, Reward, RouteInfo, Task, LiveItem } from '../types';
import { BadgeTile, FatBar, GameButton, QuestPath, Segments, TileMap, XpChip, fmtN, type MapMark } from '../components/game';
import { Button, Screen, SectionTitle, Segmented, Sheet, Spinner, cx, useToast } from '../components/ui';
import { ContestWidget, useCrown } from './Contest';
import { MonthCard, NotificationsSheet } from './Notifications';
import { MyKpiSheet } from './Kpi';
import { MyPlanCard } from './KpiPlan';
import { MediaCard } from '../components/MediaUpload';
import { AppLogoutButtons } from './AppLogin';
import { JobSheet } from './Jobs';
import { TaskSheet } from './Tasks';
import { makeT } from '../i18n';
import { playSound } from '../sounds';
import { CashWidget } from './Cash';
import { ScanButton } from './ScanStart';
import { PrepButton } from './Prep';

/*
 * Сотрудник: вкладки «Сегодня / Входящие / Лига / Профиль», игровой слой (опыт, уровни, квесты, значки),
 * смена в эфире (геопозиция боту), входящие от офиса со всплывающим окном и экран награды после выезда.
 */

export type StaffTab = 'today' | 'inbox' | 'league' | 'car' | 'profile';
let lastTab: StaffTab = 'today';
/** Открыть вкладку при запуске (кнопка бота «📷 Сфотографировать» → ?car=check). */
export const setInitialStaffTab = (t: StaffTab) => { lastTab = t; };

/* ---------------- общий контекст: входящие + игра (обновляются каждые 30 с) ---------------- */

type PlayCtxT = { inbox: InboxRes | null; game: GameState | null; refresh: () => void; ack: (item: InboxItem) => Promise<void>; tab: StaffTab; setTab: (t: StaffTab) => void };
const PlayCtx = createContext<PlayCtxT>({ inbox: null, game: null, refresh: () => {}, ack: async () => {}, tab: 'today', setTab: () => {} });
export const usePlay = () => useContext(PlayCtx);

export function PlayProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [inbox, setInbox] = useState<InboxRes | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [tab, setTabS] = useState<StaffTab>(lastTab);
  const setTab = useCallback((t: StaffTab) => { lastTab = t; setTabS(t); window.scrollTo(0, 0); }, []);
  const refresh = useCallback(() => {
    api.inbox().then(setInbox).catch(() => {});
    api.game().then(setGame).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 30000);
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [refresh]);
  const ack = useCallback(async (item: InboxItem) => {
    try {
      const r = await api.inboxAck(item.key);
      haptic.success();
      toast(r.xp ? `Готово · +${r.xp} XP` : 'Готово');
    } catch (e) { haptic.error(); toast((e as Error).message, 'error'); }
    refresh();
  }, [refresh, toast]);
  const v = useMemo(() => ({ inbox, game, refresh, ack, tab, setTab }), [inbox, game, refresh, ack, tab, setTab]);
  return <PlayCtx.Provider value={v}>{children}</PlayCtx.Provider>;
}

/* ---------------- нижние вкладки ---------------- */

export function TabBar() {
  const cfg = useConfig();
  const tr = makeT(cfg.user.lang || 'ru');
  const { tab, setTab, inbox } = usePlay();
  const n = inbox?.counts.new || 0;
  const items: { id: StaffTab; label: string; icon: ReactNode }[] = [
    { id: 'today', label: tr('tab_today'), icon: <HomeIcon size={23} strokeWidth={1.9} /> },
    { id: 'inbox', label: tr('tab_inbox'), icon: <Inbox size={23} strokeWidth={1.9} /> },
    { id: 'league', label: tr('tab_league'), icon: <Trophy size={23} strokeWidth={1.9} /> },
    { id: 'car', label: tr('tab_car'), icon: <CarIcon size={23} strokeWidth={1.9} /> },
    { id: 'profile', label: tr('tab_profile'), icon: <UserIcon size={23} strokeWidth={1.9} /> },
  ];
  return (
    <>
      <div className="h-24" />
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-line bg-card/95 pb-[max(env(safe-area-inset-bottom),10px)] pt-2 backdrop-blur">
        <div className="mx-auto grid max-w-xl grid-cols-5">
          {items.map((it) => (
            <button key={it.id} onClick={() => { haptic.tap(); setTab(it.id); }}
              className={cx('relative flex flex-col items-center gap-0.5 py-1 text-[11px]', tab === it.id ? 'font-extrabold text-accent-ink' : 'font-semibold text-muted')}>
              {it.icon}{it.label}
              {it.id === 'inbox' && n > 0 && (
                <span className="absolute left-1/2 top-0 ml-2 flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[#FF453A] px-1 text-[11px] font-extrabold text-white">{n > 99 ? '99+' : n}</span>
              )}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}

/* ---------------- «Сегодня»: верх экрана ---------------- */

export function LevelStrip() {
  const cfg = useConfig();
  const { game } = usePlay();
  const crown = useCrown();
  if (!game || !game.enabled) return null;
  const pct = ((game.xp - game.from) / Math.max(1, game.to - game.from)) * 100;
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="relative flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-full bg-accent text-[22px] font-extrabold text-black shadow-[0_4px_0_#9C4A08]">
        {(cfg.user.name || '?').trim().slice(0, 1).toUpperCase()}
        <span className="absolute -bottom-1 -right-1 flex h-[26px] min-w-[26px] items-center justify-center rounded-full border-[3px] border-page bg-[#FFD23F] px-1 text-[12px] font-extrabold text-black">{game.level}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[17px] font-extrabold">{crown(cfg.user.id)}{cfg.user.name.split(' ')[0]}</span>
          <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">ур. {game.level} · {game.title}</span>
        </div>
        <div className="mt-1.5 h-3 overflow-hidden rounded-full border-2 border-line bg-fill"><div className="h-full rounded-full bg-[#FFD23F]" style={{ width: `${Math.min(100, pct)}%` }} /></div>
        <div className="mt-1 text-[12px] text-muted">{game.xp} / {game.to} XP{game.today_xp ? ` · сегодня +${game.today_xp}` : ''}{game.streak ? ` · серия ${game.streak} дн.` : ''}</div>
      </div>
    </div>
  );
}

/** Смена в эфире: геопозиция боту на 8 часов, +10 XP за каждый час. */
export function ShiftCard() {
  const cfg = useConfig();
  const { game } = usePlay();
  const [help, setHelp] = useState(false);
  if (cfg.features?.geo_shift === false || !game) return null;
  const s = game.shift;
  const hoursDone = s.hours;
  const partial = s.minutes % 60;
  if (s.live) {
    return (
      <div className="mb-4 rounded-[22px] border-2 border-[#34C759] bg-[#34C759]/[0.1] p-4 shadow-[0_5px_0_#1E7A37]">
        <div className="flex items-center gap-3">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#34C759] text-black">
            <MapPin size={21} strokeWidth={2.2} />
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-pulse rounded-full border-2 border-card bg-[#FF453A]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-extrabold">Смена в эфире</div>
            <div className="text-[12.5px] text-[#248A3D] dark:text-[#A7E2B8]">геопозиция у бота · {Math.floor(s.minutes / 60)} ч {s.minutes % 60} мин · до {s.until ? new Date(s.until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}</div>
          </div>
          {game.enabled && <span className="font-dot text-[24px] font-bold text-[#9A7A00] dark:text-[#FFD23F]">+{hoursDone * s.xp_per_hour}</span>}
        </div>
        <Segments className="mt-3" total={s.max_hours} done={hoursDone} partial={partial} />
        {game.enabled && <div className="mt-2 text-[12px] text-muted">+{s.xp_per_hour} XP за каждый час с {s.from_hour}:00 до {s.to_hour}:00 · вся смена = +{s.max_hours * s.xp_per_hour} XP</div>}
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-[22px] border-2 border-dashed border-[#34C759] bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#34C759]/15 text-[#248A3D] dark:text-[#30D158]"><MapPin size={21} strokeWidth={2} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-extrabold">Включите смену в эфире</div>
          <div className="text-[12.5px] leading-snug text-muted">Поделитесь геопозицией с ботом на 8 часов{game.enabled ? ` — +${s.xp_per_hour} XP за каждый час` : ''}. Офис видит вас в пути, удалённость подтверждается сама.</div>
        </div>
      </div>
      <GameButton className="mt-3" tone="green" small icon={<Navigation size={17} strokeWidth={2.2} />} onClick={() => { haptic.tap(); setHelp(true); if (cfg.bot) openTgChat(cfg.bot); }}>Открыть бота</GameButton>
      {help && (
        <ol className="mt-3 space-y-1 rounded-2xl bg-fill px-4 py-3 text-[13.5px] leading-snug">
          <li><b>1.</b> В чате с ботом нажмите 📎 (скрепку)</li>
          <li><b>2.</b> «Геопозиция» → «Транслировать геопозицию»</li>
          <li><b>3.</b> Выберите <b>8 часов</b> — бот поблагодарит и начнёт начислять опыт</li>
        </ol>
      )}
    </div>
  );
}

const COLORS: Record<InboxItem['color'], { box: string; btn: 'orange' | 'red' | 'green' | 'yellow' | 'ghost'; dot: string }> = {
  red: { box: 'border-[#FF453A] bg-[#FF453A]/[0.08]', btn: 'red', dot: 'bg-[#FF453A]' },
  orange: { box: 'border-accent bg-accent/[0.08]', btn: 'orange', dot: 'bg-accent' },
  purple: { box: 'border-[#AF52DE] bg-[#AF52DE]/[0.1]', btn: 'orange', dot: 'bg-[#AF52DE]' },
  blue: { box: 'border-line bg-card', btn: 'ghost', dot: 'bg-[#64A8FF]' },
  green: { box: 'border-[#34C759] bg-[#34C759]/[0.08]', btn: 'green', dot: 'bg-[#34C759]' },
};
const TYPE_LABEL: Record<InboxItem['type'], string> = { call: 'Вызов', task: 'Заявка', note: 'Офис', job: 'Поручение', ann: 'Объявление' };
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.floor(m / 60)} ч назад` : new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

/** Карточка уведомления офиса с действием («Принял / Понял / Беру»). */
export function InboxCard({ item, onOpen, compact }: { item: InboxItem; onOpen?: (item: InboxItem) => void; compact?: boolean }) {
  const { ack } = usePlay();
  const [busy, setBusy] = useState(false);
  const c = COLORS[item.color] || COLORS.blue;
  const canOpen = Boolean(onOpen && (item.task_id || item.visit_id || item.job_id));
  return (
    <div className={cx('rounded-[20px] border-2 p-3.5', c.box)}>
      <div className="flex items-start gap-3">
        <span className={cx('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', c.dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted">
            {item.urgent && <span className="rounded-md bg-[#FF453A] px-1.5 py-0.5 text-[10.5px] text-white">срочно</span>}
            <span>{TYPE_LABEL[item.type]}</span><span className="font-medium normal-case tracking-normal">· {ago(item.at)}</span>
          </div>
          <div className="mt-0.5 break-words text-[15.5px] font-extrabold leading-snug">{item.title}</div>
          <div className={cx('mt-0.5 whitespace-pre-line break-words text-[13.5px] leading-snug text-muted', compact && 'line-clamp-2')}>{item.text}</div>
          {item.steps && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.steps.map((s) => (
                <span key={s.label} className={cx('rounded-full px-2 py-0.5 text-[12px] font-bold', s.ok ? 'bg-[#34C759]/15 text-[#248A3D] dark:text-[#30D158]' : 'bg-fill text-muted')}>{s.ok ? '✓' : '○'} {s.label}</span>
              ))}
            </div>
          )}
        </div>
      </div>
      {(item.action || canOpen) && (
        <div className={cx('mt-3 grid gap-2', item.action && canOpen ? 'grid-cols-2' : 'grid-cols-1')}>
          {item.action && (
            <GameButton small tone={c.btn} loading={busy} onClick={async () => { setBusy(true); await ack(item); setBusy(false); }}>{item.action} · +5 XP</GameButton>
          )}
          {canOpen && <GameButton small tone="ghost" onClick={() => onOpen!(item)}>Открыть</GameButton>}
        </div>
      )}
    </div>
  );
}

/** Главная: до 3 новых уведомлений офиса. */
export function InboxPreview({ onOpen }: { onOpen: (item: InboxItem) => void }) {
  const { inbox, setTab } = usePlay();
  const list = inbox?.new || [];
  if (!list.length) return null;
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">От офиса · {list.length} новых</span>
        <button onClick={() => { haptic.tap(); setTab('inbox'); }} className="text-[13px] font-bold text-accent-ink">Все →</button>
      </div>
      <div className="space-y-2.5">{list.slice(0, 3).map((i) => <InboxCard key={i.key} item={i} onOpen={onOpen} compact />)}</div>
    </div>
  );
}

/** Квесты дня. */
export function QuestsCard() {
  const { game, refresh } = usePlay();
  const toast = useToast();
  const [checking, setChecking] = useState(false);
  if (!game || !game.enabled || !game.quests.length) return null;
  async function checkin() {
    haptic.tap();
    setChecking(true);
    try {
      const pos = await getLocation();
      if (!pos) { toast('Нет доступа к геопозиции — разрешите её для Telegram в настройках телефона', 'error'); return; }
      const r = await api.checkin(pos.lat, pos.lon);
      haptic.success();
      toast(r.fresh ? `☕️ Доброе утро! +${r.xp} XP` : 'Уже засчитано сегодня');
      refresh();
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Квесты дня</span>
        {game.streak > 0 && <span className="text-[12.5px] font-extrabold text-[#E0602A]">🔥 серия {game.streak} дн.</span>}
      </div>
      <div className="overflow-hidden rounded-[20px] border-2 border-line bg-card">
        {game.quests.map((q, i) => (
          <div key={q.id} className={cx('flex items-center gap-3 px-3.5 py-3', i > 0 && 'border-t border-line')}>
            <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[13px] font-extrabold',
              q.done ? 'bg-[#34C759] text-black shadow-[0_3px_0_#1E7A37]' : 'border-2 border-accent text-accent-ink')}>{q.done ? '✓' : q.progress}</span>
            <div className="min-w-0 flex-1">
              <div className={cx('text-[14.5px] font-bold', q.done && 'text-muted line-through')}>{q.icon ? `${q.icon} ` : ''}{q.title}{!q.done && q.target > 1 ? ` · ${q.progress}/${q.target}` : ''}</div>
              {!q.done && q.hint && <div className="mt-0.5 text-[12px] leading-snug text-muted">{q.hint}</div>}
              {!q.done && q.target > 1 && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-fill"><div className="h-full rounded-full bg-accent" style={{ width: `${(q.progress / q.target) * 100}%` }} /></div>}
              {!q.done && q.action === 'checkin' && (
                <button disabled={checking} onClick={checkin}
                  className="mt-2 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-extrabold text-black shadow-[0_3px_0_#9C4A08] active:translate-y-[2px] active:shadow-none disabled:opacity-50">
                  {checking ? 'Проверяю…' : '☕️ Я в офисе'}
                </button>
              )}
            </div>
            <span className={cx('shrink-0 text-[12px] font-extrabold', q.done ? 'text-[#248A3D] dark:text-[#30D158]' : 'text-[#9A7A00] dark:text-[#FFD23F]')}>+{q.xp} XP</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** План месяца «как босс»: сколько до KPI, до плана и до суперплана 120%. */
export function PlanBoss() {
  const [p, setP] = useState<MyPlan | null | undefined>(undefined);
  useEffect(() => { api.myPlan().then((r) => setP(r.plan)).catch(() => setP(null)); }, []);
  if (!p || !p.plan) return null;
  const pct = (p.points / p.plan) * 100;
  const minPct = p.min_points ? (p.min_points / p.plan) * 100 : 70;
  const scale = (x: number) => (x / 120) * 100;
  const next = pct < minPct ? { to: p.min_points ?? p.plan * 0.7, label: 'до KPI' } : pct < 100 ? { to: p.plan, label: 'до плана' } : pct < 120 ? { to: p.plan * 1.2, label: 'до суперплана' } : null;
  const avg = p.done ? p.points / p.done : 1;
  return (
    <div className="mb-5 rounded-[22px] border-2 border-line bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">План · {p.month_label}</span>
        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[12px] font-extrabold text-accent-ink">{Math.round(pct)}%</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2"><span className="font-dot text-[40px] font-bold leading-none text-accent-ink">{fmtN(p.points)}</span><span className="text-[14px] text-muted">из {fmtN(p.plan)} баллов</span></div>
      <div className="mt-3">
        <FatBar pct={scale(pct)} marks={[{ at: scale(minPct), label: 'KPI' }, { at: scale(100), label: 'план', tone: 'bg-accent' }, { at: 100, label: '120%', tone: 'bg-[#FFD23F]' }]} />
      </div>
      {next && <div className="mt-1 text-[13.5px]">Ещё <b className="text-accent-ink">{fmtN(Math.max(0, next.to - p.points))} б</b> {next.label} — это ≈ {Math.max(1, Math.ceil(Math.max(0, next.to - p.points) / Math.max(0.5, avg)))} выезд(а).</div>}
      {!next && <div className="mt-1 text-[13.5px] font-bold text-[#248A3D] dark:text-[#30D158]">Суперплан выполнен! 👑</div>}
    </div>
  );
}

export function MoreWorkButton() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <GameButton className="mb-5" tone="yellow" loading={busy} icon={<Plus size={19} strokeWidth={2.6} />} onClick={async () => {
      setBusy(true);
      try { await api.moreWork(); haptic.success(); toast('Офис получил запрос — подберут заявку'); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
    }}>Хочу ещё заявку</GameButton>
  );
}

/** Верх главной для сотрудника. */
export function GameTop({ onOpenVisit }: { onOpenVisit: (id: string) => void }) {
  const { open, sheets } = useOpenItem(onOpenVisit);
  return (
    <>
      <LevelStrip />
      <ShiftCard />
      <CashWidget />
      <InboxPreview onOpen={open} />
      <ScanButton onOpenVisit={onOpenVisit} />
      <PrepButton />
      <PlanBoss />
      <MoreWorkButton />
      {sheets}
    </>
  );
}

/* ---------------- открыть заявку / поручение / выезд из уведомления ---------------- */

export function useOpenItem(onOpenVisit: (id: string) => void) {
  const toast = useToast();
  const [task, setTask] = useState<Task | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const { refresh } = usePlay();
  const open = useCallback(async (item: InboxItem) => {
    haptic.tap();
    try {
      if (item.visit_id) { onOpenVisit(item.visit_id); return; }
      if (item.task_id) {
        const r = await api.tasks();
        const t = r.items.find((x) => x.id === item.task_id) || r.cancelled.find((x) => x.id === item.task_id);
        if (t) setTask(t); else toast('Заявка уже закрыта или отменена');
        return;
      }
      if (item.job_id) {
        const r = await api.jobs(false);
        const j = r.items.find((x) => x.id === item.job_id);
        if (j) setJob(j); else toast('Поручение уже закрыто');
      }
    } catch (e) { toast((e as Error).message, 'error'); }
  }, [onOpenVisit, toast]);
  const sheets = (
    <>
      {task && <TaskSheet task={task} onClose={() => setTask(null)} onStarted={onOpenVisit} onCancelled={() => { setTask(null); refresh(); }} />}
      {job && <JobSheet job={job} onClose={() => setJob(null)} onChanged={() => { setJob(null); refresh(); }} />}
    </>
  );
  return { open, sheets };
}

/* ---------------- всплывающее уведомление поверх экрана ---------------- */

const shown = new Set<string>();
export function AlertOverlay({ onOpenVisit }: { onOpenVisit: (id: string) => void }) {
  const { inbox, ack } = usePlay();
  const { open, sheets } = useOpenItem(onOpenVisit);
  const [cur, setCur] = useState<InboxItem | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (!inbox || cur) return;
    // при первом открытии — только срочное; дальше — любое новое, что пришло
    const cand = inbox.new.find((i) => !shown.has(i.key) && (!first.current || i.urgent || i.type === 'call' || i.type === 'task'));
    if (first.current) { inbox.new.forEach((i) => { if (!(i.urgent || i.type === 'call' || i.type === 'task')) shown.add(i.key); }); first.current = false; }
    if (cand) {
      shown.add(cand.key);
      setCur(cand);
      haptic.success();
      playSound(cand.type === 'job' ? 'job' : 'task');
    }
  }, [inbox, cur]);
  const c = cur ? COLORS[cur.color] || COLORS.blue : COLORS.blue;
  return (
    <>
      {cur && (
        <Sheet open onClose={() => setCur(null)} title={TYPE_LABEL[cur.type]}>
          <div className={cx('-mt-2 rounded-[22px] border-2 p-4', c.box)}>
            <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
              {cur.urgent && <span className="rounded-md bg-[#FF453A] px-1.5 py-0.5 text-[10.5px] text-white">срочно</span>}
              <Bell size={14} strokeWidth={2} /> от офиса · {ago(cur.at)}
            </div>
            <div className="mt-1 text-[19px] font-extrabold leading-snug">{cur.title}</div>
            <div className="mt-1 whitespace-pre-line text-[15px] leading-relaxed">{cur.text}</div>
            {cur.author && <div className="mt-1.5 text-[13px] text-muted">— {cur.author}</div>}
          </div>
          <div className="mt-4 space-y-2.5">
            {cur.action && <GameButton tone={c.btn === 'ghost' ? 'orange' : c.btn} loading={busy} onClick={async () => { setBusy(true); await ack(cur); setBusy(false); setCur(null); }}>{cur.action} · +5 XP</GameButton>}
            <div className="grid grid-cols-2 gap-2.5">
              {(cur.task_id || cur.visit_id || cur.job_id) ? <GameButton small tone="ghost" onClick={() => { const it = cur; setCur(null); open(it); }}>Открыть</GameButton> : <span />}
              <GameButton small tone="ghost" onClick={() => setCur(null)}>Позже</GameButton>
            </div>
            <p className="px-1 text-center text-[12px] text-muted">Пока не ответите, офис видит «не прочитано», а бот напоминает.</p>
          </div>
        </Sheet>
      )}
      {sheets}
    </>
  );
}

/* ---------------- вкладка «Входящие» ---------------- */

export function InboxScreen({ onOpenVisit }: { onOpenVisit: (id: string) => void }) {
  const { inbox, refresh } = usePlay();
  const { open, sheets } = useOpenItem(onOpenVisit);
  const [f, setF] = useState<'new' | 'work' | 'done'>('new');
  useEffect(() => { refresh(); }, [refresh]);
  const list = inbox ? inbox[f] : null;
  return (
    <Screen>
      <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">От офиса</div>
      <h1 className="mb-4 text-[34px] font-extrabold uppercase leading-none tracking-tight">Входящие</h1>
      <div className="mb-4">
        <Segmented<'new' | 'work' | 'done'> value={f} onChange={(v) => { haptic.tap(); setF(v); }}
          options={[{ id: 'new', label: `Новые${inbox?.counts.new ? ` · ${inbox.counts.new}` : ''}` }, { id: 'work', label: `В работе${inbox?.counts.work ? ` · ${inbox.counts.work}` : ''}` }, { id: 'done', label: 'Готово' }]} />
      </div>
      {!list ? <Spinner /> : list.length === 0 ? (
        <div className="rounded-[22px] border-2 border-dashed border-line p-6 text-center text-[15px] text-muted">
          {f === 'new' ? 'Новых сообщений от офиса нет — всё прочитано 👍' : f === 'work' ? 'Сейчас ничего не в работе' : 'За последние дни пусто'}
        </div>
      ) : (
        <div className="space-y-2.5">{list.map((i) => <InboxCard key={i.key} item={f === 'done' ? { ...i, action: '' } : i} onOpen={open} />)}</div>
      )}
      {sheets}
    </Screen>
  );
}

/* ---------------- вкладка «Лига» ---------------- */

export function LeagueScreen() {
  const cfg = useConfig();
  const { game } = usePlay();
  return (
    <Screen>
      <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Соревнование и достижения</div>
      <h1 className="mb-4 text-[34px] font-extrabold uppercase leading-none tracking-tight">Лига</h1>
      {cfg.features?.contest !== false && <ContestWidget />}
      <div className="mt-5"><PlanBoss /></div>
      <div className="mt-5"><QuestsCard /></div>
      {game?.enabled && (
        <>
          <SectionTitle>Значки · {game.badges.filter((b) => b.got).length} из {game.badges.length}</SectionTitle>
          <div className="grid grid-cols-4 gap-x-2 gap-y-4 rounded-[22px] border-2 border-line bg-card p-4 sm:grid-cols-5">
            {game.badges.map((b, i) => <BadgeTile key={b.id} i={i} icon={b.icon} title={b.title} got={b.got} progress={b.progress} />)}
          </div>
          <div className="mt-2 px-1 text-[12.5px] leading-snug text-muted">{game.badges.filter((b) => !b.got).map((b) => `${b.title} — ${b.hint}`).slice(0, 3).join(' · ')}</div>
          <SectionTitle>Как получить опыт</SectionTitle>
          <div className="grid grid-cols-2 gap-2 text-[13.5px]">
            {[['Позвонить клиенту заранее', 10], ['Выехать («Еду к клиенту»)', 5], ['Начать вовремя', 15], ['Выезд завершён', 30], ['Фото в акте', '5 за фото'], ['Ответить офису', 5], ['Час смены в эфире', 10], ['Квесты дня', '20–50']].map(([t, x]) => (
              <div key={String(t)} className="flex items-center justify-between gap-2 rounded-2xl bg-card px-3 py-2.5"><span className="leading-snug">{t}</span><span className="shrink-0 font-extrabold text-[#9A7A00] dark:text-[#FFD23F]">+{x}</span></div>
            ))}
          </div>
          <p className="mt-2 px-1 text-[12.5px] text-muted">Опыт — для уровня и значков, на баллы KPI и деньги не влияет.</p>
        </>
      )}
    </Screen>
  );
}

/** Язык интерфейса (RU/RO) — своя настройка у каждого сотрудника; сохраняется на сервере (users.lang). */
function LanguageCard() {
  const cfg = useConfig();
  const toast = useToast();
  const [lang, setLang] = useState<'ru' | 'ro'>(cfg.user.lang || 'ru');
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-[20px] border-2 border-line bg-card px-4 py-3.5">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Язык интерфейса</div>
      <Segmented<'ru' | 'ro'> options={[{ id: 'ru', label: 'Русский' }, { id: 'ro', label: 'Română' }]} value={lang}
        onChange={async (v) => {
          haptic.tap(); setLang(v); setBusy(true);
          try { await api.setLang(v); window.location.reload(); }
          catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
        }} />
      {busy && <div className="mt-1.5 text-[12px] text-muted">Применяем…</div>}
    </div>
  );
}

/* ---------------- вкладка «Профиль» ---------------- */

const ROLE_RU: Record<string, string> = { tech: 'Дезинсектор', specialist: 'Специалист', manager: 'Менеджер', admin: 'Администратор' };
export function ProfileScreen({ onOpenVisit, version }: { onOpenVisit: (id: string) => void; version: string }) {
  const cfg = useConfig();
  const { game } = usePlay();
  const toast = useToast();
  const crown = useCrown();
  const [month, setMonth] = useState<MonthSummary | null>(null);
  const [kpiOpen, setKpiOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  useEffect(() => { api.notifications().then((r) => setMonth(r.month)).catch(() => {}); }, []);
  return (
    <Screen>
      <div className="mb-5 flex items-center gap-4">
        <div className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-accent text-[28px] font-extrabold text-black shadow-[0_5px_0_#9C4A08]">
          {(cfg.user.name || '?').trim().slice(0, 1).toUpperCase()}
          {game?.enabled && <span className="absolute -bottom-1 -right-1 flex h-7 min-w-7 items-center justify-center rounded-full border-[3px] border-page bg-[#FFD23F] px-1 text-[13px] font-extrabold text-black">{game.level}</span>}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[22px] font-extrabold leading-tight">{crown(cfg.user.id)}{cfg.user.name}</div>
          <div className="text-[14px] text-muted">{ROLE_RU[cfg.user.role] || cfg.user.role}{game?.enabled ? ` · ${game.title}` : ''}</div>
          {game?.enabled && <div className="mt-1 text-[12.5px] text-muted">{game.xp} XP · лучшая серия {game.best_streak} дн.</div>}
        </div>
      </div>

      {month && <MonthCard m={month} onRemarks={() => { haptic.tap(); setNotifOpen(true); }} onHistory={() => { haptic.tap(); setKpiOpen(true); }} />}
      <MyPlanCard />
      <MediaCard />

      {game?.enabled && game.recent.length > 0 && (
        <>
          <SectionTitle>Последний опыт</SectionTitle>
          <div className="overflow-hidden rounded-[20px] border-2 border-line bg-card">
            {game.recent.slice(0, 6).map((r, i) => (
              <div key={i} className={cx('flex items-center gap-3 px-3.5 py-2.5 text-[14px]', i > 0 && 'border-t border-line')}>
                <span className="min-w-0 flex-1 truncate">{r.note || r.kind}</span>
                <span className="shrink-0 text-[12px] text-muted">{new Date(r.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                <XpChip xp={r.xp} />
              </div>
            ))}
          </div>
        </>
      )}

      <SectionTitle>Настройки</SectionTitle>
      <div className="space-y-2.5">
        <button onClick={() => { haptic.tap(); setNotifOpen(true); }} className="flex w-full items-center gap-3 rounded-[20px] border-2 border-line bg-card px-4 py-3.5 text-left">
          <Bell size={20} strokeWidth={1.8} className="shrink-0 text-accent-ink" /><span className="flex-1 text-[15px] font-bold">Уведомления и замечания</span><ChevronRight size={18} className="text-muted" />
        </button>
        <button onClick={() => { haptic.tap(); setKpiOpen(true); }} className="flex w-full items-center gap-3 rounded-[20px] border-2 border-line bg-card px-4 py-3.5 text-left">
          <CalendarClock size={20} strokeWidth={1.8} className="shrink-0 text-accent-ink" /><span className="flex-1 text-[15px] font-bold">История KPI по месяцам</span><ChevronRight size={18} className="text-muted" />
        </button>
        {cfg.bot && (
          <button onClick={() => { haptic.tap(); openTgChat(cfg.bot); }} className="flex w-full items-center gap-3 rounded-[20px] border-2 border-line bg-card px-4 py-3.5 text-left">
            <Megaphone size={20} strokeWidth={1.8} className="shrink-0 text-accent-ink" />
            <span className="flex-1"><span className="block text-[15px] font-bold">Бот InsectProtect</span><span className="block text-[12.5px] text-muted">{cfg.user.bot_blocked ? 'не запущен — уведомления не доходят, нажмите «Старт»' : 'уведомления и смена в эфире'}</span></span>
            <ChevronRight size={18} className="text-muted" />
          </button>
        )}
        <div className="rounded-[20px] border-2 border-line bg-card px-4 py-3.5">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Тема оформления</div>
          <Segmented<ThemePref> options={[{ id: 'light', label: 'Светлая' }, { id: 'dark', label: 'Тёмная' }, { id: 'auto', label: 'Как в Telegram' }]} value={theme}
            onChange={(v) => { haptic.tap(); setTheme(v); setThemePref(v); api.setPrefs({ theme: v }).catch((e: Error) => toast(e.message, 'error')); }} />
        </div>
        <LanguageCard />
      </div>
      <AppLogoutButtons />
      <div className="mt-8 text-center font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted/70">Версия {version}</div>
      {kpiOpen && <MyKpiSheet name={cfg.user.name} onClose={() => setKpiOpen(false)} />}
      {notifOpen && <NotificationsSheet onClose={() => setNotifOpen(false)} onOpenVisit={onOpenVisit} onRead={() => setMonth((m) => (m ? { ...m, unread: 0 } : m))} />}
    </Screen>
  );
}

/* ---------------- «В пути»: карта, время до клиента ---------------- */

export function RouteCard({ task }: { task: Task }) {
  const cfg = useConfig();
  const [r, setR] = useState<RouteInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.taskRoute(task.id).then((x) => { if (alive) setR(x); }).catch(() => {});
    load();
    const t = window.setInterval(load, 20000);
    return () => { alive = false; window.clearInterval(t); };
  }, [task.id]);
  if (!r) return null;
  const marks: MapMark[] = [];
  if (r.dest) marks.push({ id: 'dest', ...r.dest, tone: 'dest', text: task.company_name || 'клиент' });
  if (r.me) marks.push({ id: 'me', ...r.me, tone: 'me', label: '▲' });
  const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—');
  return (
    <div className="mb-4 space-y-3">
      {marks.length > 0 && <TileMap marks={marks} height={220} line={r.me && r.dest ? [r.me, r.dest] : null} />}
      {r.me ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-card px-3 py-2.5"><div className="font-dot text-[26px] font-bold text-accent-ink">{r.eta_min ?? '—'}</div><div className="text-[12px] text-muted">мин ≈</div></div>
          <div className="rounded-2xl bg-card px-3 py-2.5"><div className="font-dot text-[26px] font-bold">{r.km != null ? fmtN(r.km) : '—'}</div><div className="text-[12px] text-muted">км по прямой</div></div>
          <div className={cx('rounded-2xl px-3 py-2.5', r.late ? 'bg-[#FF453A]/12' : 'bg-[#34C759]/12')}><div className={cx('font-dot text-[26px] font-bold', r.late ? 'text-[#D70015] dark:text-[#FF453A]' : 'text-[#248A3D] dark:text-[#30D158]')}>{hhmm(r.arrive_at)}</div><div className="text-[12px] text-muted">{r.late ? 'опаздываете' : 'успеваете'}</div></div>
        </div>
      ) : (
        <div className="rounded-[20px] border-2 border-dashed border-[#34C759] p-3.5 text-[14px] leading-snug">
          <b>Включите трансляцию геопозиции боту</b> — появится карта, время до клиента и удалённость подтвердится сама.
          {cfg.bot && <GameButton className="mt-2.5" small tone="green" icon={<Navigation size={16} strokeWidth={2.2} />} onClick={() => openTgChat(cfg.bot)}>Открыть бота</GameButton>}
        </div>
      )}
      {r.zone && <div className="px-1 text-[13px] text-muted">📍 {fmtN(r.zone.km)} км от центра Кишинёва · {r.zone.zone === 'city' ? 'Кишинёв' : r.zone.zone === 'near' ? 'до 100 км' : 'дальше 100 км'} — подтвердится при начале выезда</div>}
      {r.nav_url && <Button variant="secondary" icon={<Navigation size={18} strokeWidth={1.8} />} onClick={() => openLink(r.nav_url!)}>Навигатор</Button>}
      {!r.dest && r.me && <div className="px-1 text-[12px] text-muted">Адрес не найден на карте — время в пути не считается, навигатор откроется по адресу.</div>}
    </div>
  );
}

/* ---------------- награда после выезда ---------------- */

export function RewardSheet({ reward, onClose }: { reward: Reward; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const plan = reward.plan;
  const pct = plan && plan.plan ? (plan.points / plan.plan) * 100 : 0;
  const minPct = plan?.min && plan.plan ? (plan.min / plan.plan) * 100 : 70;
  const lvlPct = ((reward.xp_total - reward.level_from) / Math.max(1, reward.level_to - reward.level_from)) * 100;
  return (
    <Sheet open onClose={onClose} title="Выезд закрыт!">
      <div className="-mt-2 flex flex-col items-center gap-2 text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-accent text-black shadow-[0_7px_0_#9C4A08,0_0_0_10px_rgba(245,130,32,0.18)]"><Trophy size={48} strokeWidth={2} /></div>
        {reward.on_time && <span className="mt-2 rounded-full bg-[#34C759]/15 px-3 py-1 text-[13px] font-bold text-[#248A3D] dark:text-[#30D158]">вовремя{reward.streak ? ` · серия ${reward.streak} дн.` : ''}</span>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-[20px] border-2 border-accent bg-accent/[0.08] p-3 text-center shadow-[0_4px_0_#9C4A08]"><div className="font-dot text-[34px] font-bold text-accent-ink">+{fmtN(reward.points)}</div><div className="text-[12.5px] text-muted">балла в KPI</div></div>
        <div className="rounded-[20px] border-2 border-[#FFD23F] bg-[#FFD23F]/10 p-3 text-center shadow-[0_4px_0_#8A7414]"><div className="font-dot text-[34px] font-bold text-[#9A7A00] dark:text-[#FFD23F]">+{reward.xp}</div><div className="text-[12.5px] text-muted">XP · ур. {reward.level}</div></div>
      </div>
      {reward.detail && <div className="mt-3 rounded-2xl bg-card px-4 py-3 text-[13.5px] leading-snug"><div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Как посчитаны баллы</div>{reward.detail}</div>}
      <div className="mt-3 rounded-2xl bg-card px-4 py-3">
        <div className="mb-1 flex justify-between text-[13px]"><span>{reward.title} · ур. {reward.level}</span><span className="text-muted">{reward.xp_total} / {reward.level_to} XP</span></div>
        <div className="h-3 overflow-hidden rounded-full border-2 border-line bg-fill"><div className="h-full rounded-full bg-[#FFD23F]" style={{ width: `${Math.min(100, lvlPct)}%` }} /></div>
      </div>
      {plan && plan.plan > 0 && (
        <div className="mt-3 rounded-2xl bg-card px-4 py-3">
          <div className="mb-2 flex justify-between text-[13.5px]"><span>План месяца</span><span><b className="text-accent-ink">{fmtN(plan.points)}</b> / {fmtN(plan.plan)}</span></div>
          <FatBar pct={(pct / 120) * 100} marks={[{ at: (minPct / 120) * 100, label: 'KPI' }, { at: (100 / 120) * 100, label: 'план', tone: 'bg-accent' }]} />
          {pct < minPct && plan.min != null && <div className="text-[13px] font-bold text-[#9A7A00] dark:text-[#FFD23F]">Ещё {fmtN(plan.min - plan.points)} б — и KPI засчитан!</div>}
        </div>
      )}
      <div className="mt-3 space-y-1.5">
        {reward.quests.map((q) => (
          <div key={q.id} className="flex items-center gap-2 text-[13.5px]"><span className={cx('flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-extrabold', q.done ? 'bg-[#34C759] text-black' : 'border-2 border-line')}>{q.done ? '✓' : ''}</span><span className={cx('flex-1', q.done && 'text-muted')}>{q.title} · {q.progress}/{q.target}</span><span className="text-[12px] font-bold text-muted">+{q.xp}</span></div>
        ))}
      </div>
      <div className="mt-5 space-y-2.5">
        <GameButton tone="yellow" loading={busy} icon={<Hand size={19} strokeWidth={2.2} />} onClick={async () => {
          setBusy(true);
          try { await api.moreWork(); haptic.success(); toast('Офис получил запрос — подберут заявку'); onClose(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
        }}>Хочу ещё заявку</GameButton>
        <GameButton tone="ghost" onClick={onClose}>Дальше</GameButton>
      </div>
    </Sheet>
  );
}

/* ---------------- офис: кто где ---------------- */

export function LiveWidget() {
  const [items, setItems] = useState<LiveItem[] | null>(null);
  const [open, setOpen] = useState<LiveItem | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.adminLive().then((r) => { if (alive) setItems(r.items); }).catch(() => { if (alive) setItems([]); });
    load();
    const t = window.setInterval(load, 30000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  if (!items || !items.length) return null;
  const withPos = items.filter((i) => i.pos);
  const initials = (n: string) => n.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  const marks: MapMark[] = withPos.map((i) => ({ id: i.id, lat: i.pos!.lat, lon: i.pos!.lon, label: initials(i.name), tone: i.late ? 'red' : i.state === 'onsite' ? 'green' : i.state === 'route' ? 'me' : 'gray', text: i.state === 'route' && i.eta_min != null ? `≈${i.eta_min} мин` : undefined }));
  const STATE: Record<LiveItem['state'], string> = { route: 'едет', onsite: 'на объекте', free: 'свободен' };
  return (
    <div className="mt-4 rounded-[22px] bg-card p-4">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#34C759]/15 text-[#248A3D] dark:text-[#30D158]"><MapPin size={20} strokeWidth={1.75} /></div>
        <div className="min-w-0 flex-1"><div className="text-[16px] font-semibold">Кто где</div><div className="text-[13px] text-muted">в эфире {items.filter((i) => i.pos?.live).length} из {items.length} · обновляется каждые 30 с</div></div>
      </div>
      {withPos.length > 0 && <TileMap marks={marks} height={240} />}
      <div className="mt-3 space-y-1.5">
        {items.map((i) => (
          <div key={i.id} role="button" onClick={() => { haptic.tap(); setOpen(i); }} className={cx('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 active:opacity-60', i.late ? 'bg-[#FF453A]/10' : 'bg-fill/50')}>
            <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold', i.late ? 'bg-[#FF453A] text-white' : i.state === 'onsite' ? 'bg-[#34C759] text-black' : i.state === 'route' ? 'bg-[#FFD23F] text-black' : 'bg-fill text-muted')}>{initials(i.name)}</span>
            <div className="min-w-0 flex-1"><div className="truncate text-[14.5px] font-semibold">{i.name} <span className="font-normal text-muted">· {i.late ? 'опаздывает' : STATE[i.state]}</span></div><div className="truncate text-[12.5px] text-muted">{i.text}{i.shift_hours ? ` · в эфире ${i.shift_hours} ч` : ''}</div></div>
            {i.pos && !i.pos.live && <span className="shrink-0 text-[11px] text-muted">точка</span>}
            <ChevronRight size={16} className="shrink-0 text-muted/60" />
          </div>
        ))}
      </div>
      <WhereSheet item={open} onClose={() => setOpen(null)} initials={initials} />
    </div>
  );
}

const agoText = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч ${m % 60} мин назад`;
  return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** Нажали на сотрудника в «Кто где» — карта: где он сейчас (или последняя точка) и куда едет / где работает. */
function WhereSheet({ item, onClose, initials }: { item: LiveItem | null; onClose: () => void; initials: (n: string) => string }) {
  if (!item) return null;
  const p = item.pos || item.last || null;
  const fresh = Boolean(item.pos);
  const marks: MapMark[] = [];
  if (p) marks.push({ id: 'me', lat: p.lat, lon: p.lon, label: initials(item.name), tone: item.late ? 'red' : fresh ? 'me' : 'gray', text: fresh ? (p.live ? 'в эфире' : 'сейчас') : 'был здесь' });
  if (item.site) marks.push({ id: 'site', lat: item.site.lat, lon: item.site.lon, tone: 'dest', text: item.state === 'onsite' ? 'объект' : 'адрес' });
  const gmaps = (lat: number, lon: number) => `https://www.google.com/maps?q=${lat},${lon}`;
  const STATE: Record<LiveItem['state'], string> = { route: 'едет к клиенту', onsite: 'на объекте', free: 'свободен' };
  return (
    <Sheet open onClose={onClose} title={item.name}>
      <div className="flex flex-col gap-3">
        <div className={cx('rounded-2xl px-3.5 py-3 text-[14px]', item.late ? 'bg-[#FF453A]/12' : 'bg-fill')}>
          <b>{item.late ? 'Опаздывает' : STATE[item.state]}</b>{item.text && item.text !== 'свободен' && item.text !== 'нет геопозиции' ? ` · ${item.text}` : ''}
          <div className="mt-0.5 text-[12.5px] text-muted">
            {p ? `${fresh ? (p.live ? 'Геопозиция в эфире' : 'Геопозиция') : 'Последняя точка'} · ${agoText(p.at)}` : 'Нет геопозиции — попросите включить «Смену в эфире» (поделиться геопозицией с ботом)'}
            {item.shift_hours ? ` · в эфире ${item.shift_hours} ч` : ''}
          </div>
        </div>
        {marks.length > 0 && <TileMap marks={marks} height={300} line={p && item.site ? [p, item.site] : null} />}
        {p && <Button variant="secondary" icon={<MapPin size={17} strokeWidth={1.75} />} onClick={() => openLink(gmaps(p.lat, p.lon))}>Открыть в Google Maps</Button>}
        {item.site && <Button variant="plain" icon={<Navigation size={17} strokeWidth={1.75} />} onClick={() => openLink(gmaps(item.site!.lat, item.site!.lon))}>{item.state === 'onsite' ? 'Объект' : 'Адрес заявки'}: {item.site.label}</Button>}
      </div>
    </Sheet>
  );
}
