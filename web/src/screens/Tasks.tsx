import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Ban, CalendarClock, Home, Car, RotateCcw, CalendarDays, Copy, MapPin, MessageSquare, Phone, PhoneCall, Play, Receipt, Send, User } from 'lucide-react';
import { api, type ApiError } from '../api';
import { plural, useConfig } from '../config';
import { callPhone, copyText, haptic, intlPhone, openTgChat, prettyPhone } from '../telegram';
import type { Task } from '../types';
import { Button, Chips, Field, Group, IconBadge, Input, Label, MultPill, Pill, Row, Segmented, Sheet, TextArea, cx, multLabel, useToast } from '../components/ui';
import { AddressFields, joinAddress, splitAddress } from '../components/AddressFields';
import { QuestPath } from '../components/game';
import { RouteCard } from './Play';

const TZ = 'Europe/Chisinau';
export const fmtTaskDate = (t: Pick<Task, 'planned_at' | 'has_time'>) =>
  t.planned_at
    ? new Date(t.planned_at).toLocaleString('ru-RU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', ...(t.has_time ? { hour: '2-digit', minute: '2-digit' } : {}) })
    : 'Дата не указана';

const dayKey = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }) : '');
export const isTodayTask = (t: Task) => dayKey(t.planned_at) === dayKey(new Date().toISOString());
export const isOverdue = (t: Task) => !!t.planned_at && dayKey(t.planned_at) < dayKey(new Date().toISOString());

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

/** Перерисовка раз в 30 секунд — чтобы подсветка времени менялась сама. */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

/** За час до заявки время ярко-зелёное, в остальное время — оранжевое. */
export const isSoon = (t: Pick<Task, 'planned_at' | 'has_time'>, now: number) => {
  if (!t.planned_at || !t.has_time) return false;
  const start = new Date(t.planned_at).getTime();
  return now >= start - 3600000 && now <= start;
};

export function TimeBadge({ t, now, full }: { t: Task; now: number; full?: boolean }) {
  if (!t.planned_at || !t.has_time) return null;
  const soon = isSoon(t, now);
  const mins = Math.max(0, Math.round((new Date(t.planned_at).getTime() - now) / 60000));
  return (
    <span className={cx('inline-flex shrink-0 items-center rounded-full px-3 py-1.5 font-mono text-[14px] font-semibold tabular-nums leading-none',
      soon ? 'bg-[#2BD45A] text-black shadow-[0_0_0_4px_rgba(43,212,90,0.22),0_0_18px_rgba(43,212,90,0.55)]' : 'bg-accent/15 text-accent-ink')}>
      {full ? fmtTaskDate(t) : fmtTime(t.planned_at)}{soon && !full ? <span className="ml-1 text-[12px] font-medium opacity-90">· {mins} мин</span> : null}
    </span>
  );
}

export function CallButton({ t, size = 40 }: { t: Task; size?: number }) {
  const [fallback, setFallback] = useState(false);
  if (!t.phone) return null;
  return (
    <>
      <button aria-label={`Позвонить ${t.phone}`}
        onClick={(e) => { e.stopPropagation(); haptic.tap(); callPhone(t.phone, () => setFallback(true)); }}
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded-full bg-[#34C759] text-white active:opacity-70">
        <Phone size={Math.round(size * 0.45)} strokeWidth={2} />
      </button>
      {fallback && <PhoneSheet task={t} onClose={() => setFallback(false)} />}
    </>
  );
}

export function TaskRow({ t, showTech, onClick, timeOnly }: { t: Task; showTech: boolean; onClick: () => void; timeOnly?: boolean }) {
  const now = useNow();
  const overdue = isOverdue(t);
  const when = timeOnly
    ? (t.planned_at && t.has_time ? '' : 'Время не указано')
    : (t.has_time ? '' : fmtTaskDate(t));
  return (
    <Row
      onClick={onClick}
      chevron={false}
      boost={(t.mult_eff ?? 1) > 1}
      left={<IconBadge tone={(t.mult_eff ?? 1) > 1 ? 'purple' : overdue ? 'red' : isSoon(t, now) ? 'green' : isTodayTask(t) ? 'blue' : 'gray'}><CalendarClock size={18} strokeWidth={1.75} /></IconBadge>}
      title={t.company_name || t.address}
      subtitle={
        <>
          <div className="truncate">{t.company_name ? t.address || 'Адрес не указан' : ''}</div>
          <div className="mt-0.5 truncate">
            {[when, t.procedure, t.pests.join(', '), dealLabel(t, true), showTech ? `${t.tech_name}${t.claimed_at ? ' 🙋' : ''}` : '', t.team?.length ? `👥 +${t.team.length}` : ''].filter(Boolean).join(' · ')}
          </div>
          {(!t.ack_at || t.en_route_at || t.reschedule || overdue || (t.planned_at && t.has_time) || (t.mult_eff ?? 1) > 1) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <MultPill m={t.mult_eff} />
              {!t.ack_at && <Pill tone="red">Не подтверждена</Pill>}
              {t.en_route_at && <Pill tone="green">🚗 В пути</Pill>}
              {t.reschedule ? <Pill tone="orange">🔁 Перенос{t.reschedule.to ? ` на ${fmtTaskDate({ planned_at: t.reschedule.to, has_time: t.reschedule.has_time })}` : ''} · ждёт офис</Pill>
                : overdue ? <Pill tone="red">Просрочена · {fmtTaskDate(t)}</Pill> : <TimeBadge t={t} now={now} full={!timeOnly} />}
            </div>
          )}
        </>
      }
      right={<CallButton t={t} />}
    />
  );
}

/* ---------- Заявки по дням: Сегодня / Завтра / Будущие ---------- */

type Tab = 'today' | 'tomorrow' | 'future';

const addDays = (n: number) => dayKey(new Date(Date.now() + n * 86400000).toISOString());
const dayTitle = (key: string) => {
  const s = new Date(`${key}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function TaskList({ tasks, showTech, onOpen }: { tasks: Task[]; showTech: boolean; onOpen: (t: Task) => void }) {
  const today = dayKey(new Date().toISOString());
  const tomorrow = addDays(1);

  const groups = useMemo(() => {
    const overdue: Task[] = []; const todayL: Task[] = []; const noDate: Task[] = []; const tomorrowL: Task[] = [];
    const future = new Map<string, Task[]>();
    for (const t of tasks) {
      const k = dayKey(t.planned_at);
      if (!k) noDate.push(t);
      else if (k < today) overdue.push(t);
      else if (k === today) todayL.push(t);
      else if (k === tomorrow) tomorrowL.push(t);
      else future.set(k, [...(future.get(k) || []), t]);
    }
    return { overdue, today: todayL, noDate, tomorrow: tomorrowL, future: [...future.entries()].sort(([a], [b]) => a.localeCompare(b)) };
  }, [tasks, today, tomorrow]);

  const counts = {
    today: groups.overdue.length + groups.today.length + groups.noDate.length,
    tomorrow: groups.tomorrow.length,
    future: groups.future.reduce((n, [, l]) => n + l.length, 0),
  };
  const [tab, setTab] = useState<Tab>(() => (counts.today ? 'today' : counts.tomorrow ? 'tomorrow' : counts.future ? 'future' : 'today'));

  const block = (title: string, list: Task[], opts: { tone?: 'red'; timeOnly?: boolean } = {}) => list.length > 0 && (
    <div key={title}>
      <div className={cx('mb-2 mt-5 flex items-baseline justify-between px-1 text-[13px] font-semibold uppercase tracking-wide first:mt-0',
        opts.tone === 'red' ? 'text-[#D70015] dark:text-[#FF453A]' : 'text-muted')}>
        <span>{title}</span><span className="font-normal normal-case tracking-normal">{list.length} {plural(list.length, ['заявка', 'заявки', 'заявок'])}</span>
      </div>
      <Group>{list.map((t) => <TaskRow key={t.id} t={t} showTech={showTech} timeOnly={opts.timeOnly} onClick={() => { haptic.tap(); onOpen(t); }} />)}</Group>
    </div>
  );

  const empty = (text: string) => (
    <div className="flex items-center gap-3 rounded-2xl bg-card p-4 text-[15px] text-muted">
      <CalendarDays size={20} strokeWidth={1.5} className="shrink-0" />{text}
    </div>
  );

  return (
    <div className="mb-4">
      <div className="mb-4">
        <Segmented<Tab>
          options={[
            { id: 'today', label: `Сегодня${counts.today ? ` · ${counts.today}` : ''}` },
            { id: 'tomorrow', label: `Завтра${counts.tomorrow ? ` · ${counts.tomorrow}` : ''}` },
            { id: 'future', label: `Будущие${counts.future ? ` · ${counts.future}` : ''}` },
          ]}
          value={tab}
          onChange={(v) => { haptic.tap(); setTab(v); }}
        />
      </div>

      {tab === 'today' && (counts.today ? (
        <>
          {block('Просрочены', groups.overdue, { tone: 'red' })}
          {block(dayTitle(today), groups.today, { timeOnly: true })}
          {block('Без даты', groups.noDate)}
        </>
      ) : empty('На сегодня заявок нет'))}

      {tab === 'tomorrow' && (counts.tomorrow ? block(dayTitle(tomorrow), groups.tomorrow, { timeOnly: true }) : empty('На завтра заявок пока нет'))}

      {tab === 'future' && (counts.future
        ? groups.future.map(([k, list]) => block(dayTitle(k), list, { timeOnly: true }))
        : empty('Заявок на послезавтра и дальше нет'))}
    </div>
  );
}

/* ---------- Звонок клиенту ---------- */

/**
 * В мини-приложении Telegram на iPhone ссылки tel: не открываются. Поэтому три способа:
 * набрать напрямую (Android, компьютер), получить номер от бота в личку (там он кликабельный) или скопировать.
 */
export function PhoneSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const cfg = useConfig();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const num = intlPhone(task.phone);

  async function viaBot() {
    setBusy(true);
    try {
      const r = await api.taskPhone(task.id);
      haptic.success();
      setSent(r.bot || cfg.bot || '');
      if (!(r.bot || cfg.bot)) toast('Номер отправлен вам в чат с ботом');
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={prettyPhone(task.phone)}>
      <div className="-mt-3 mb-5 text-[15px] text-muted">{task.company_name || 'Физлицо'}{task.address ? ` · ${task.address}` : ''}</div>
      <p className="mb-5 text-[14px] leading-snug text-muted">
        Telegram не открыл набор номера. Бот пришлёт номер в ваш чат — нажмите на него, и телефон сразу позвонит. Всё внутри Telegram, без сторонних ссылок.
      </p>
      {sent ? (
        <div className="mb-4 rounded-2xl bg-[#34C759]/10 p-4 text-[15px] leading-snug">
          <div className="font-semibold">✅ Номер отправлен в чат с ботом</div>
          <Button className="mt-3" onClick={() => openTgChat(sent)} icon={<PhoneCall size={18} strokeWidth={1.75} />}>Перейти в чат и позвонить</Button>
        </div>
      ) : (
        <Button loading={busy} onClick={viaBot} icon={<Send size={18} strokeWidth={1.75} />}>Номер в чат с ботом</Button>
      )}
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <Button variant="secondary" className="h-[46px] text-[15px]" icon={<PhoneCall size={17} strokeWidth={1.75} />}
          onClick={() => callPhone(task.phone, () => toast('Набор номера недоступен в этом Telegram', 'error'))}>
          Ещё раз
        </Button>
        <Button variant="secondary" className="h-[46px] text-[15px]" icon={<Copy size={17} strokeWidth={1.75} />}
          onClick={async () => { toast((await copyText(num)) ? 'Номер скопирован' : 'Не удалось скопировать'); }}>
          Копировать
        </Button>
      </div>
    </Sheet>
  );
}

export function TaskSheet({ task, onClose, onStarted, onCancelled }: {
  task: Task; onClose: () => void; onStarted: (visitId: string) => void; onCancelled: () => void;
}) {
  const cfg = useConfig();
  const toast = useToast();
  const known = cfg.procedures.includes(task.procedure) ? task.procedure : '';
  const [procedure, setProcedure] = useState(known);
  // если в заявке нет адреса — подставляем то, что написали в первой строке (часто это населённый пункт), специалист уточнит
  const [addr, setAddr] = useState(() => (task.address ? { city: '', street: task.address } : splitAddress(task.company_name || '')));
  const address = task.address || joinAddress(addr.city, addr.street);
  const [busy, setBusy] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const now = useNow();
  const [t2, setT2] = useState(task);
  const [stepBusy, setStepBusy] = useState<'' | 'call' | 'route'>('');
  // открыт незавершённый выезд — следующую заявку начать нельзя
  const [blocked, setBlocked] = useState<{ id: string; name: string; text: string } | null>(null);
  const onBlocked = (e: unknown) => {
    const err = e as ApiError;
    if (err.code === 'open_visit' && err.data?.visit_id) { setBlocked({ id: String(err.data.visit_id), name: String(err.data.visit_name || ''), text: err.message }); return true; }
    return false;
  };
  const ready = Boolean(t2.call_status && t2.en_route_at);
  const missing = [
    !t2.call_status && 'отметьте звонок',
    !t2.en_route_at && 'нажмите «Еду к клиенту»',
    !procedure && 'выберите тип обработки',
    !task.address && address.trim().length < 3 && 'укажите адрес объекта',
  ].filter(Boolean) as string[];

  async function progress(data: { call?: string; en_route?: boolean }) {
    if (stepBusy) return; // защита от двойного нажатия
    haptic.tap();
    setStepBusy(data.en_route !== undefined ? 'route' : 'call');
    try {
      const r = await api.taskProgress(task.id, data);
      setT2((x) => ({ ...x, ...r.task }));
      if (data.en_route) haptic.success();
      if (data.en_route === false || data.call === '') toast('Отменено');
    } catch (e) {
      if (onBlocked(e)) { haptic.error(); return; }
      toast((e as Error).message, 'error');
    } finally {
      setStepBusy('');
    }
  }

  async function start() {
    setBusy(true);
    try {
      const { id } = await api.startTask(task.id, { procedure, address: address.trim() });
      haptic.success();
      onStarted(id);
    } catch (e) {
      haptic.error();
      if (!onBlocked(e)) toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  async function cancel() {
    try {
      await api.cancelTask(task.id);
      toast('Заявка отменена');
      onCancelled();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <>
    <Sheet open onClose={onClose} title={task.company_name || 'Заявка'}>
      <div className="-mt-3 mb-5 text-[15px] text-muted">Заявка № {task.task_no}{task.author ? ` · от ${task.author}` : ''}{task.reschedule_count ? ` · переносов: ${task.reschedule_count}` : ''}</div>
      {!cfg.isAdmin && task.tech_id === cfg.user.id && ['new', 'in_progress'].includes(task.status) && (
        <QuestPath step={!t2.call_status ? 0 : !task.visit_id ? 1 : 2} className="mb-4" />
      )}
      {task.tech_id === cfg.user.id && t2.en_route_at && !task.visit_id && ['new', 'in_progress'].includes(task.status) && <RouteCard task={task} />}
      <RescheduleBanner task={task} onConfirmed={onCancelled} />
      {task.status === 'open' && (
        <div className="mb-4 rounded-2xl bg-[#FF9500]/12 px-4 py-3 text-[14px]">🙋 Ждёт, кто заберёт{task.audience ? ` (${task.audience === 'all' ? 'все сотрудники' : task.audience === 'tech' ? 'дезинсекторы' : 'специалисты'})` : ''}{(task.claim_bonus ?? 0) > 0 ? ` · бонус +${String(task.claim_bonus).replace('.', ',')} б` : ''}.</div>
      )}
      {task.claimed_at && task.status !== 'open' && (
        <div className="mb-4 rounded-2xl bg-[#34C759]/12 px-4 py-3 text-[14px]">🙋 Забрал(а) <b>{task.tech_name}</b> · {new Date(task.claimed_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{(task.claim_bonus ?? 0) > 0 ? ` · бонус +${String(task.claim_bonus).replace('.', ',')} б после выезда` : ''}</div>
      )}
      {!task.ack_at && task.tech_id === cfg.user.id && <AckButton task={task} onDone={onCancelled} />}
      {!task.ack_at && task.status !== 'open' && task.tech_id !== cfg.user.id && (
        <div className="mb-4 rounded-2xl bg-[#D71921]/10 px-4 py-3 text-[14px]">🔔 {task.tech_name || 'Сотрудник'} ещё не подтвердил получение — бот напоминает каждые 5 минут.</div>
      )}
      <TaskMultBlock task={task} canEdit={cfg.isAdmin} onChanged={onCancelled} />
      {cfg.user.isAdmin && <CrmLeadField task={t2} onChanged={(id) => setT2((x) => ({ ...x, crm_lead_id: id }))} />}
      <Group>
        {task.address && <Row left={<IconBadge tone="gray"><MapPin size={18} strokeWidth={1.75} /></IconBadge>} title={task.address} subtitle="Адрес" />}
        <Row left={<IconBadge tone={isSoon(task, now) ? 'green' : 'gray'}><CalendarClock size={18} strokeWidth={1.75} /></IconBadge>}
          title={task.has_time && task.planned_at ? <TimeBadge t={task} now={now} full /> : fmtTaskDate(task)} subtitle="Когда" />
        {(task.procedure || task.pests.length > 0) && (
          <Row left={<IconBadge tone="gray"><User size={18} strokeWidth={1.75} /></IconBadge>}
            title={[task.procedure, task.pests.join(', ')].filter(Boolean).join(' · ')} subtitle="Обработка и вредители" />
        )}
        {task.point_cat && cfg.pointCats.some((c) => c.id === task.point_cat) && (
          <Row left={<IconBadge tone="gray"><Home size={18} strokeWidth={1.75} /></IconBadge>}
            title={[cfg.pointCats.find((c) => c.id === task.point_cat)?.label, cfg.pointCats.find((c) => c.id === task.point_cat)?.zones ? cfg.pointZones.find((z) => z.id === (task.point_zone || 'city'))?.label : ''].filter(Boolean).join(' · ')}
            subtitle="Тип помещения (баллы)" />
        )}
        {dealLabel(task) && (
          <Row left={<IconBadge tone="gray"><Receipt size={18} strokeWidth={1.75} /></IconBadge>} title={dealLabel(task)} subtitle="Этап · комнаты · цена" />
        )}
        {task.phone && (
          <Row left={<IconBadge tone="green"><Phone size={18} strokeWidth={1.75} /></IconBadge>} title={prettyPhone(task.phone)} subtitle="Нажмите, чтобы позвонить"
            chevron={false} right={<CallButton t={task} size={36} />}
            onClick={() => { haptic.tap(); callPhone(task.phone, () => setPhoneOpen(true)); }} />
        )}
        {task.comment && <Row left={<IconBadge tone="gray"><MessageSquare size={18} strokeWidth={1.75} /></IconBadge>} title={task.comment} subtitle="Комментарий" />}
      </Group>

      {task.phone && (
        <button onClick={() => setPhoneOpen(true)} className="mt-2 w-full px-4 text-left text-[13px] text-accent-ink">
          Не звонит? Получить номер в чат с ботом
        </button>
      )}

      {/* администратор/менеджер только добавляет заявки — выезжает и отмечает шаги специалист */}
      <TaskTeamBlock task={task} canEdit={cfg.isAdmin && cfg.features?.team !== false} onChanged={onCancelled} />
      {!cfg.isAdmin && task.tech_id !== cfg.user.id && (
        <div className="mt-5 rounded-2xl bg-card px-4 py-3.5 text-[14.5px] leading-snug">
          👥 Вы в команде. Акт ведёт и оплату получает <b>{task.tech_name}</b> — он отмечает звонок, дорогу и начинает обработку.
          Баллы за объект придут вам автоматически после завершения.
        </div>
      )}
      {!cfg.isAdmin && task.tech_id === cfg.user.id && (
      <>
      <div className="mt-6 space-y-5">
        {!task.address && (
          <div>
            <Label className="mb-2.5 px-1">В заявке нет адреса — укажите его</Label>
            <AddressFields city={addr.city} street={addr.street} onChange={setAddr} />
          </div>
        )}
        {!known && (
          <Field label="Тип обработки">
            <Chips options={cfg.procedures.map((p) => ({ id: p, label: p }))} value={procedure} onChange={(v) => { haptic.tap(); setProcedure(v); }} columns={3} />
          </Field>
        )}
      </div>

      {blocked && (
        <div className="mt-6 rounded-2xl bg-[#D71921]/10 p-4">
          <div className="text-[15.5px] font-semibold">🔒 Сначала закройте предыдущий выезд</div>
          <div className="mt-1 text-[14px] leading-snug text-muted">{blocked.text}</div>
          <Button className="mt-3 h-11 text-[15px]" onClick={() => onStarted(blocked.id)}>Открыть «{blocked.name || 'выезд'}»</Button>
        </div>
      )}

      {/* Порядок: звонок клиенту (или «не требуется») → «Еду к клиенту» → обработка */}
      <div className="mt-7 space-y-2.5">
        <Step n={1} done={Boolean(t2.call_status)} title="Звонок клиенту"
          value={t2.call_status === 'called' ? 'Позвонил' : t2.call_status === 'not_needed' ? 'Звонок не требуется' : ''}>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => progress({ call: t2.call_status === 'called' ? '' : 'called' })}
              disabled={!!stepBusy || (!!t2.call_status && (t2.call_status !== 'called' || !!t2.call_undo))}
              className={cx('h-[44px] rounded-full text-[14.5px] font-semibold transition disabled:opacity-40', t2.call_status === 'called' ? 'bg-ink text-card disabled:opacity-100' : 'bg-card ring-1 ring-inset ring-line')}>
              Позвонил
            </button>
            <button onClick={() => progress({ call: t2.call_status === 'not_needed' ? '' : 'not_needed' })}
              disabled={!!stepBusy || (!!t2.call_status && (t2.call_status !== 'not_needed' || !!t2.call_undo))}
              className={cx('h-[44px] rounded-full text-[14.5px] font-semibold transition disabled:opacity-40', t2.call_status === 'not_needed' ? 'bg-ink text-card disabled:opacity-100' : 'bg-card ring-1 ring-inset ring-line')}>
              Не требуется
            </button>
          </div>
        </Step>
        {t2.call_status && (
          <div className="-mt-1 px-1 text-[12px] text-muted">
            {t2.call_undo ? 'Отметка закреплена — отменить можно было только один раз.' : 'Нажали по ошибке — нажмите выбранную кнопку ещё раз (отменить можно один раз).'}
          </div>
        )}
        <Step n={2} done={Boolean(t2.en_route_at)} title="Еду к клиенту" value={t2.en_route_at ? `в пути с ${fmtTime(t2.en_route_at)}` : ''}>
          {!t2.en_route_at ? (
            <Button variant="secondary" className="h-[46px] text-[15px]" disabled={!t2.call_status} loading={stepBusy === 'route'}
              onClick={() => progress({ en_route: true })} icon={<Car size={18} strokeWidth={1.75} />}>
              Еду к клиенту
            </Button>
          ) : t2.route_undo ? null : (
            <button onClick={() => progress({ en_route: false })} disabled={!!stepBusy}
              className="flex h-[40px] w-full items-center justify-center gap-2 rounded-full text-[14px] font-medium text-muted ring-1 ring-inset ring-line active:opacity-70">
              ↩︎ Отменить — нажал по ошибке (один раз)
            </button>
          )}
        </Step>
      </div>

      <Button className="mt-4" loading={busy} disabled={!ready || !procedure || (!task.address && address.trim().length < 3)} onClick={start}
        icon={<Play size={18} strokeWidth={2} />}>
        Приступить к обработке
      </Button>
      {missing.length > 0 && (
        <div className="mt-2 text-center text-[12.5px] text-[#D71921] dark:text-[#FF4D4D]">Чтобы начать: {missing.join(', ')}</div>
      )}
      <div className="mt-3"><ClientActions task={task} onChanged={onCancelled} /></div>
      </>
      )}
      {cfg.isAdmin && <Button className="mt-2" variant="plain" onClick={cancel}><span className="text-[#D70015] dark:text-[#FF453A]">Отменить заявку (офис)</span></Button>}
    </Sheet>
    {phoneOpen && <PhoneSheet task={task} onClose={() => setPhoneOpen(false)} />}
    </>
  );
}

/* ---------- Клиент просит перенести / клиент отменил ---------- */

const CANCEL_REASONS = ['Передумал', 'Обратился в другую компанию', 'Дорого', 'Не открыл / не отвечает', 'Проблема решена', 'Другое'];

const localDate = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: TZ });

export function RescheduleSheet({ task, onClose, onDone }: { task: Task; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState('');
  const [time, setTime] = useState(task.has_time && task.planned_at ? fmtTime(task.planned_at) : '');
  const [note, setNote] = useState('');
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(false);

  const quick = [
    { id: localDate(1), label: 'Завтра' },
    { id: localDate(2), label: 'Послезавтра' },
    { id: localDate(7), label: 'Через неделю' },
  ];

  async function send() {
    setBusy(true);
    try {
      await api.reschedule(task.id, { date: unknown ? '' : date, time: unknown ? '' : time, note: note.trim() });
      haptic.success();
      toast('Офис получил запрос на перенос');
      onDone();
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Перенос заявки">
      <p className="-mt-3 mb-5 text-[15px] leading-relaxed text-muted">
        Заявка № {task.task_no} · {task.company_name || task.address}. Офис получит уведомление и подтвердит новую дату.
      </p>
      <div className="space-y-5">
        {!unknown && (
          <>
            <Field label="Новая дата">
              <div className="mb-2.5 flex flex-wrap gap-2">
                {quick.map((q) => (
                  <button key={q.id} onClick={() => { haptic.tap(); setDate(q.id); }}
                    className={cx('h-9 rounded-full px-4 text-[14px] font-medium', date === q.id ? 'bg-accent text-black' : 'bg-fill')}>
                    {q.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-[1fr_120px] gap-2.5">
                <Input type="date" min={localDate(0)} value={date} onChange={(e) => setDate(e.target.value)} />
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </Field>
          </>
        )}
        <button onClick={() => setUnknown((v) => !v)} className="flex items-center gap-2.5 text-[15px]">
          <span className={cx('flex h-5 w-5 items-center justify-center rounded-md border', unknown ? 'border-accent bg-accent text-black' : 'border-black/20 dark:border-white/30')}>
            {unknown && '✓'}
          </span>
          Клиент не назвал дату
        </button>
        <Field label="Комментарий">
          <TextArea rows={2} placeholder="Например: в отъезде до пятницы, просит после 17:00" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <Button className="mt-6" loading={busy} disabled={unknown ? note.trim().length < 3 : !date} onClick={send} icon={<Send size={18} strokeWidth={1.75} />}>
        Отправить в офис
      </Button>
    </Sheet>
  );
}

export function ClientCancelSheet({ task, onClose, onDone }: { task: Task; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      await api.clientCancel(task.id, { reason, note: note.trim() });
      haptic.success();
      toast('Заявка отменена, офис уведомлён');
      onDone();
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Клиент отменил заявку">
      <p className="-mt-3 mb-5 text-[15px] leading-relaxed text-muted">
        Заявка № {task.task_no} · {task.company_name || task.address}. Офис получит уведомление. В KPI это не считается вашим невыполнением.
      </p>
      <Field label="Причина">
        <Chips options={CANCEL_REASONS.map((r) => ({ id: r, label: r }))} value={reason} onChange={(v) => { haptic.tap(); setReason(v); }} />
      </Field>
      <div className="mt-5">
        <Field label="Комментарий">
          <TextArea rows={2} placeholder="Необязательно" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <Button className="mt-6" variant="danger" loading={busy} disabled={!reason} onClick={send}>Отменить заявку</Button>
    </Sheet>
  );
}

/** Две кнопки для техника: «Клиент просит перенести» / «Клиент отменил». */
export function ClientActions({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const [open, setOpen] = useState<'' | 'resched' | 'cancel'>('');
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <button onClick={() => { haptic.tap(); setOpen('resched'); }}
          className="flex h-[48px] items-center justify-center gap-2 rounded-2xl bg-[#FF9500]/12 text-[15px] font-semibold text-[#C93400] dark:text-[#FF9F0A]">
          <CalendarClock size={17} strokeWidth={1.75} />Просит перенести
        </button>
        <button onClick={() => { haptic.tap(); setOpen('cancel'); }}
          className="flex h-[48px] items-center justify-center gap-2 rounded-2xl bg-[#FF3B30]/10 text-[15px] font-semibold text-[#D70015] dark:text-[#FF453A]">
          <Ban size={17} strokeWidth={1.75} />Клиент отменил
        </button>
      </div>
      {open === 'resched' && <RescheduleSheet task={task} onClose={() => setOpen('')} onDone={() => { setOpen(''); onChanged(); }} />}
      {open === 'cancel' && <ClientCancelSheet task={task} onClose={() => setOpen('')} onDone={() => { setOpen(''); onChanged(); }} />}
    </>
  );
}

/** Плашка «клиент просит перенести» в карточке. */
export function RescheduleBanner({ task, onConfirmed }: { task: Task; onConfirmed?: () => void }) {
  const cfg = useConfig();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!task.reschedule) return null;
  const r = task.reschedule;
  return (
    <div className="mb-4 rounded-2xl bg-[#FF9500]/12 p-4 text-[15px] leading-snug">
      <div className="font-semibold">🔁 Клиент просит перенести</div>
      <div className="mt-1">
        {r.to ? <>На <b>{fmtTaskDate({ planned_at: r.to, has_time: r.has_time })}</b></> : 'Дата не названа'}
        {r.note ? ` · ${r.note}` : ''}
      </div>
      <div className="mt-1 text-[13px] text-muted">Ждёт подтверждения офиса</div>
      {cfg.isAdmin && r.to && (
        <Button className="mt-3" loading={busy} onClick={async () => {
          setBusy(true);
          try { await api.confirmReschedule(task.id); haptic.success(); toast('Перенос подтверждён'); onConfirmed?.(); }
          catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
        }}>Подтвердить перенос</Button>
      )}
    </div>
  );
}

/* ---------- Отменённые за 7 дней: восстановить ---------- */

export function CancelledTasks({ items, showTech, onRestored }: { items: Task[]; showTech: boolean; onRestored: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  if (!items.length) return null;

  async function restore(t: Task) {
    setBusy(t.id);
    try {
      await api.restoreTask(t.id);
      haptic.success();
      toast(`Заявка № ${t.task_no} восстановлена`);
      onRestored();
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="mt-6">
      <button onClick={() => { haptic.tap(); setOpen((v) => !v); }}
        className="flex w-full items-center justify-between px-1 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
        <span>Отменённые · 7 дней · {items.length}</span>
        <span>{open ? 'Скрыть' : 'Показать'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2.5">
          {items.map((t) => (
            <div key={t.id} className="rounded-2xl bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[16px] font-medium line-through decoration-muted/60">{t.company_name || t.address}</div>
                  <div className="mt-0.5 truncate text-[13.5px] text-muted">{t.company_name ? t.address : ''}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Pill tone={t.cancel_reason === 'client' ? 'orange' : 'gray'}>{t.cancel_reason === 'client' ? 'Отменил клиент' : 'Отменил офис'}</Pill>
                    {showTech && <Pill>{t.tech_name}</Pill>}
                  </div>
                  {t.cancel_note && <div className="mt-1.5 text-[13.5px] text-muted">{t.cancel_note}</div>}
                </div>
                <div className="font-mono text-[11px] text-muted">№ {t.task_no}</div>
              </div>
              <Button variant="secondary" className="mt-3 h-[44px] text-[15px]" loading={busy === t.id} onClick={() => restore(t)}
                icon={<RotateCcw size={17} strokeWidth={1.75} />}>
                Восстановить заявку
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Виджет: сколько осталось до следующей заявки ---------- */

export function NowWidget({ tasks, onOpen }: { tasks: Task[]; onOpen: (t: Task) => void }) {
  const now = useNow(15000);
  const next = tasks
    .filter((t) => t.planned_at && t.has_time && new Date(t.planned_at).getTime() >= now - 30 * 60000 && !t.reschedule)
    .sort((a, b) => a.planned_at!.localeCompare(b.planned_at!))[0];
  if (!next) return null;
  const soon = isSoon(next, now);
  const mins = Math.round((new Date(next.planned_at!).getTime() - now) / 60000);
  const late = mins < 0;
  const abs = Math.abs(mins);
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const m = abs % 60;
  const big = d ? `${d} д ${h} ч` : h ? `${h} ч ${String(m).padStart(2, '0')} м` : `${m} мин`;

  return (
    <button onClick={() => { haptic.tap(); onOpen(next); }}
      className="mb-5 w-full overflow-hidden rounded-[24px] bg-ink p-5 text-left text-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] opacity-60">
          <span className={cx('h-2 w-2 rounded-full', soon || late ? 'bg-[#2BD45A] shadow-[0_0_10px_#2BD45A]' : 'bg-accent')} />
          {late ? 'Заявка началась' : 'До следующей заявки'}
        </div>
        <span className={cx('font-dot text-[18px] leading-none', soon || late ? 'text-[#2BD45A] dark:text-[#128A3A]' : 'text-accent dark:text-accent-ink')}>{fmtTime(next.planned_at!)}</span>
      </div>
      <div className={cx('mt-3 font-dot text-[56px] leading-[0.9]', soon && 'text-[#2BD45A] dark:text-[#128A3A]')}>{late ? `+${big}` : big}</div>
      <div className="mt-4 border-t border-dashed border-card/20 pt-3">
        <div className="truncate text-[16px] font-medium">{next.company_name || next.address}</div>
        {next.company_name && next.address && <div className="mt-0.5 truncate text-[13.5px] opacity-60">{next.address}</div>}
      </div>
    </button>
  );
}

/** «Уведомлен» — подтверждение получения заявки (останавливает напоминания бота). */
function AckButton({ task, onDone }: { task: Task; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mb-4 rounded-[22px] bg-[#D71921]/10 p-4">
      <div className="text-[15px] font-semibold">🔔 Подтвердите получение заявки</div>
      <div className="mt-0.5 text-[13.5px] text-muted">Пока не подтвердите, бот будет напоминать каждые 5 минут.</div>
      <Button className="mt-3 h-[48px]" loading={busy} onClick={async () => {
        setBusy(true);
        try { await api.ackTask(task.id); haptic.success(); toast('Получение подтверждено'); onDone(); }
        catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
      }}>Уведомлен</Button>
    </div>
  );
}

function Step({ n, done, title, value, children }: { n: number; done: boolean; title: string; value?: string; children?: ReactNode }) {
  return (
    <div className={cx('rounded-[20px] p-4', done ? 'bg-[#34C759]/10' : 'bg-card ring-1 ring-inset ring-line')}>
      <div className="flex items-center gap-3">
        <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[13px] font-semibold',
          done ? 'bg-[#34C759] text-white' : 'bg-fill text-muted')}>{done ? '✓' : n}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[15.5px] font-semibold">{title}</div>
          {value && <div className="text-[13px] text-muted">{value}</div>}
        </div>
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** «Этап 1 из 2 · 3 комн. · 4300 лей» (short: «1/2 · 3 комн. · 4300 лей»). */
export function dealLabel(t: { rooms?: number | null; stage?: string; price?: number | null; sotki?: number | null }, short = false) {
  const [a, b] = (t.stage || '').split('/');
  const stage = t.stage ? (short ? t.stage : `Этап ${a} из ${b}`) : '';
  return [stage, t.rooms ? `${t.rooms} комн.` : '', t.sotki ? `${String(t.sotki).replace('.', ',')} сот.` : '', t.price != null ? `${t.price.toLocaleString('ru-RU')} лей` : ''].filter(Boolean).join(' · ');
}

/* ---------- Повышенный коэффициент заявки ---------- */

export const MULT_PRESETS = ['1,5', '2', '2,5', '3'];

/** Фиолетовый блок «⚡ ×2,5» в карточке заявки; администратор может задать или снять коэффициент. */
/** CRM Lead ID заявки (например, ID сделки amoCRM) — необязательно, задаёт менеджер/администратор. */
function CrmLeadField({ task, onChanged }: { task: Task; onChanged: (id: string) => void }) {
  const toast = useToast();
  const [v, setV] = useState(task.crm_lead_id || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(task.crm_lead_id || ''), [task.crm_lead_id]);
  async function save() {
    setBusy(true);
    try { const r = await api.setTaskCrmLead(task.id, v.trim()); onChanged(r.crm_lead_id); haptic.success(); toast('Сохранено', 'ok'); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <div className="mb-4">
      <Field label="CRM Lead ID">
        <div className="flex gap-2">
          <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="ID сделки в CRM (необязательно)" />
          {v.trim() !== (task.crm_lead_id || '') && <Button className="!w-auto shrink-0 px-4" loading={busy} onClick={save}>Сохранить</Button>}
        </div>
      </Field>
    </div>
  );
}

function TaskMultBlock({ task, canEdit, onChanged }: { task: Task; canEdit: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState('');
  const eff = task.mult_eff ?? 1;
  if (eff <= 1 && !canEdit) return null;
  async function set(v: string | null) {
    setBusy(v ?? 'none');
    try { await api.setTaskMult(task.id, v); haptic.success(); toast(v ? `Коэффициент ×${v}` : 'Коэффициент снят'); onChanged(); }
    catch (e) { toast((e as Error).message, 'error'); setBusy(''); }
  }
  const manual = task.mult ? String(task.mult).replace('.', ',') : '';
  return (
    <div className={cx('mb-4 rounded-2xl px-4 py-3', eff > 1 ? 'bg-[#AF52DE]/12 dark:bg-[#BF5AF2]/15' : 'bg-card')}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-[14.5px]">
          {eff > 1 ? (
            <>
              <b className="text-[#8E3BB8] dark:text-[#D08CF5]">⚡ Повышенный коэффициент {multLabel(eff)}</b>
              <div className="text-[13px] text-muted">{task.mult_why ? `${task.mult_why[0].toUpperCase()}${task.mult_why.slice(1)} — ` : ''}баллы за этот выезд умножаются</div>
            </>
          ) : <span className="text-muted">Обычный коэффициент ×1</span>}
        </div>
        {canEdit && !edit && <button onClick={() => { haptic.tap(); setEdit(true); }} className="shrink-0 text-[14px] font-medium text-accent-ink">{task.mult ? 'Изменить' : 'Повысить'}</button>}
      </div>
      {canEdit && edit && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button onClick={() => set(null)} disabled={!!busy}
            className={cx('rounded-full px-3.5 py-1.5 text-[14px] font-medium', !manual ? 'bg-ink text-card' : 'bg-fill')}>Нет</button>
          {MULT_PRESETS.map((m) => (
            <button key={m} onClick={() => set(m)} disabled={!!busy}
              className={cx('rounded-full px-3.5 py-1.5 text-[14px] font-medium', manual === m ? 'bg-[#AF52DE] text-white' : 'bg-fill')}>×{m}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Командная заявка ---------- */

/** Кто в команде (кроме ответственного); администратор может изменить состав. */
function TaskTeamBlock({ task, canEdit, onChanged }: { task: Task; canEdit: boolean; onChanged: () => void }) {
  const cfg = useConfig();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [people, setPeople] = useState<{ id: string; name: string; role: string }[] | null>(null);
  const [sel, setSel] = useState<string[]>((task.team || []).map((x) => x.id));
  const [busy, setBusy] = useState(false);
  const team = task.team || [];
  if (!team.length && !canEdit) return null;
  const n = team.length + 1;
  async function open() {
    haptic.tap();
    setEdit(true);
    if (!people) api.assignees().then((r) => setPeople(r.items)).catch(() => setPeople([]));
  }
  async function save() {
    setBusy(true);
    try { await api.setTaskTeam(task.id, sel); haptic.success(); toast(sel.length ? `Команда: ${sel.length + 1} чел.` : 'Команда убрана'); onChanged(); }
    catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  }
  return (
    <div className="mt-4 rounded-2xl bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-[14.5px]">
          {team.length ? (
            <>
              <b>👥 Команда · {n} чел.</b>
              <div className="text-[13px] leading-snug text-muted">
                Ответственный (оплата): {task.tech_name} · также: {team.map((x) => x.name).join(', ')}
                <br />Баллы объекта — каждому полностью{task.price != null ? ` · стоимость ${task.price} лей делится на ${n}: по ${Math.round(task.price / n)} лей` : ` · стоимость делится на ${n}`}
              </div>
            </>
          ) : <span className="text-muted">Один исполнитель</span>}
        </div>
        {canEdit && !edit && <button onClick={open} className="shrink-0 text-[14px] font-medium text-accent-ink">{team.length ? 'Изменить' : '+ Команда'}</button>}
      </div>
      {edit && (
        <div className="mt-3">
          {!people ? <div className="py-2 text-center text-[13px] text-muted">Загрузка…</div> : (
            <div className="flex flex-wrap gap-1.5">
              {people.filter((p) => p.id !== task.tech_id).map((p) => {
                const on = sel.includes(p.id);
                return (
                  <button key={p.id} onClick={() => { haptic.tap(); setSel((x) => (on ? x.filter((y) => y !== p.id) : [...x, p.id])); }}
                    className={cx('rounded-full px-3.5 py-1.5 text-[14px] font-medium', on ? 'bg-accent text-black' : 'bg-fill')}>{p.name}</button>
                );
              })}
            </div>
          )}
          <div className="mt-2 px-1 text-[12px] text-muted">Ответственный — {task.tech_name}; сменить его — «Переназначить».</div>
          <Button className="mt-3 h-11 text-[15px]" loading={busy} onClick={save}>Сохранить команду</Button>
        </div>
      )}
    </div>
  );
}
