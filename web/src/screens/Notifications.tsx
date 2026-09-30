import { useEffect, useState } from 'react';
import { AlertTriangle, BellOff, CalendarPlus, CheckCircle2, ClipboardList, PencilLine, XCircle } from 'lucide-react';
import { api } from '../api';
import { haptic } from '../telegram';
import type { MonthSummary, NotificationItem, NotificationsRes } from '../types';
import { Empty, Sheet, Spinner, cx, useToast } from '../components/ui';

export const monthName = (iso?: string) => {
  const s = (iso ? new Date(iso) : new Date()).toLocaleDateString('ru-RU', { month: 'long', timeZone: 'Europe/Chisinau' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Личный счётчик за текущий месяц. Сервер считает от 1-го числа — в новом месяце всё начинается с нуля. */
export function MonthCard({ m, onRemarks, onHistory }: { m: MonthSummary; onRemarks: () => void; onHistory: () => void }) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <div className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted"><span className="h-1.5 w-1.5 rounded-full bg-accent" />{monthName(m.month_start)}</div>
        <button onClick={onHistory} className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink">История →</button>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Tile value={m.done} label="Выполнено" tone="green" big onClick={onHistory} />
        <Tile value={String(m.points ?? 0).replace('.', ',')} label="Баллы" tone="blue" big onClick={onHistory} />
        <Tile value={m.open} label="Ожидают" tone="gray" />
        <Tile value={m.remarks} label="Замечания" tone={m.remarks ? 'orange' : 'gray'} onClick={onRemarks} />
      </div>
      <div className="mt-1.5 px-1 text-[12px] text-muted">Счётчик обнуляется 1-го числа, история сохраняется</div>
    </div>
  );
}

function Tile({ value, label, tone, big, onClick }: {
  value: number | string; label: string; tone: 'green' | 'blue' | 'orange' | 'gray'; big?: boolean; onClick?: () => void;
}) {
  const color = {
    green: 'text-[#248A3D] dark:text-[#30D158]',
    blue: 'text-accent-ink',
    orange: 'text-[#C93400] dark:text-[#FF9F0A]',
    gray: 'text-ink dark:text-white',
  }[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={cx('rounded-2xl bg-card p-3.5 text-left', onClick && 'active:opacity-60')}>
      <div className={cx('font-dot leading-none', big ? 'text-[44px]' : 'text-[36px]', color)}>{value}</div>
      <div className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">{label}</div>
    </Tag>
  );
}

const KIND: Record<string, { icon: typeof AlertTriangle; cls: string; title: string }> = {
  remark: { icon: AlertTriangle, cls: 'bg-[#FF9500]/15 text-[#C93400] dark:text-[#FF9F0A]', title: 'Замечание от офиса' },
  task_new: { icon: CalendarPlus, cls: 'bg-accent/10 text-accent-ink', title: 'Новая заявка' },
  task_update: { icon: PencilLine, cls: 'bg-accent/10 text-accent-ink', title: 'Заявка изменена' },
  task_cancel: { icon: XCircle, cls: 'bg-gray-200 text-muted dark:bg-white/10', title: 'Заявка отменена' },
  act_reopened: { icon: ClipboardList, cls: 'bg-accent/10 text-accent-ink', title: 'Акт открыт для исправления' },
};

/** Панель уведомлений: замечания офиса и события по заявкам за текущий месяц. */
export function NotificationsSheet({ onClose, onOpenVisit, onRead }: {
  onClose: () => void; onOpenVisit: (id: string) => void; onRead: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<NotificationsRes | null>(null);
  const [filter, setFilter] = useState<'all' | 'remark'>('all');

  useEffect(() => {
    api.notifications()
      .then((r) => {
        setData(r);
        if (r.unread) api.readNotifications().then(onRead).catch(() => {});
      })
      .catch((e: Error) => { toast(e.message, 'error'); onClose(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const items = data?.items.filter((i) => filter === 'all' || i.kind === 'remark') ?? [];

  return (
    <Sheet open onClose={onClose} title="Уведомления">
      {!data ? <Spinner /> : (
        <>
          <div className="-mt-3 mb-5 text-[15px] text-muted">
            {monthName(data.month_start)} · выполнено {data.month.done} · замечаний {data.remarks}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-fill p-1">
            {([['all', `Все · ${data.items.length}`], ['remark', `Замечания · ${data.remarks}`]] as const).map(([id, label]) => (
              <button key={id} onClick={() => { haptic.tap(); setFilter(id); }}
                className={cx('h-9 rounded-[9px] text-[14px] font-medium transition',
                  filter === id ? 'bg-card shadow-sm' : 'text-muted')}>
                {label}
              </button>
            ))}
          </div>

          {items.length === 0 ? (
            <div className="rounded-2xl bg-card">
              <Empty
                icon={filter === 'remark' ? <CheckCircle2 size={40} strokeWidth={1.25} /> : <BellOff size={40} strokeWidth={1.25} />}
                title={filter === 'remark' ? 'Замечаний нет' : 'Пока пусто'}
                text="Панель очищается в начале каждого месяца."
              />
            </div>
          ) : (
            <div className="space-y-2.5">
              {items.map((n) => <NotificationCard key={n.id} n={n} onOpenVisit={(id) => { onClose(); onOpenVisit(id); }} />)}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

function NotificationCard({ n, onOpenVisit }: { n: NotificationItem; onOpenVisit: (id: string) => void }) {
  const k = KIND[n.kind] ?? KIND.task_update;
  const Icon = k.icon;
  const clickable = Boolean(n.visit_id);
  // в тексте уведомлений о заявках бывают эмодзи-маркеры из бота — убираем их для чистоты
  const text = n.text.replace(/^[\p{Extended_Pictographic}️\s]+/u, '');
  return (
    <button disabled={!clickable} onClick={() => n.visit_id && onOpenVisit(n.visit_id)}
      className={cx('flex w-full gap-3 rounded-2xl p-3.5 text-left',
        n.kind === 'remark' ? 'bg-[#FF9500]/[0.07]' : 'bg-card',
        clickable && 'active:opacity-60')}>
      <div className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', k.cls)}>
        <Icon size={18} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[15px] font-semibold">
            {!n.read && <span className="h-2 w-2 rounded-full bg-accent" />}
            {k.title}
          </div>
          <div className="shrink-0 text-[12px] text-muted">{fmtWhen(n.created_at)}</div>
        </div>
        <div className="mt-1 whitespace-pre-line break-words text-[15px] leading-snug">{text}</div>
        {n.author && n.kind === 'remark' && <div className="mt-1.5 text-[13px] text-muted">— {n.author}</div>}
      </div>
    </button>
  );
}
