import { createPortal } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { isTelegram } from '../telegram';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ---------- Каркас экрана ---------- */
/* Стиль: InsectProtect × Nothing. Монохромные карточки на точечной сетке, моно-подписи капсом,
   dot-matrix цифры (font-dot), узкий гротеск в заголовках, оранжевый — только для главного. */

/** wide — админка; desktop — главная (на компьютере две колонки); по умолчанию — экран выезда (на компьютере чуть шире). */
export function Screen({ children, wide, desktop }: { children: ReactNode; wide?: boolean; desktop?: boolean }) {
  return (
    <div className={cx('pt-safe mx-auto min-h-dvh px-4 pb-[calc(env(safe-area-inset-bottom)+32px)] animate-fade md:px-8',
      wide ? 'max-w-6xl' : desktop ? 'max-w-xl lg:max-w-6xl' : 'max-w-xl md:max-w-2xl')}>
      {children}
    </div>
  );
}

/** Моно-подпись капсом: «● INSECT PROTECT». */
export function Label({ children, dot, className }: { children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <div className={cx('flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted', className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
      {children}
    </div>
  );
}

export function LargeTitle({ title, subtitle, eyebrow, onBack, right }: {
  title: string; subtitle?: ReactNode; eyebrow?: string; onBack?: () => void; right?: ReactNode;
}) {
  return (
    <header className="mb-7">
      {onBack && !isTelegram() && (
        <button onClick={onBack} className="-ml-1.5 mb-3 flex items-center font-mono text-[12px] uppercase tracking-[0.14em] text-accent-ink">
          <ChevronLeft size={18} strokeWidth={1.75} /> Назад
        </button>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label dot className="mb-2.5">{eyebrow || 'Insect Protect'}</Label>
          <h1 className="font-display text-[40px] font-semibold uppercase leading-[0.95] tracking-[-0.01em]">{title}</h1>
          {subtitle && <div className="mt-2 text-[15px] text-muted">{subtitle}</div>}
        </div>
        {right}
      </div>
    </header>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 mt-9 flex items-center gap-3 px-1 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
      <span className="shrink-0">{children}</span>
      <span className="h-px flex-1 border-t border-dashed border-line" />
    </h2>
  );
}

/* ---------- Кнопки ---------- */

export function Button({ children, onClick, variant = 'primary', loading, disabled, icon, className, type = 'button' }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'plain' | 'danger';
  loading?: boolean; disabled?: boolean; icon?: ReactNode; className?: string; type?: 'button' | 'submit';
}) {
  const styles = {
    primary: 'bg-accent text-black active:brightness-95',
    secondary: 'bg-card text-ink ring-1 ring-inset ring-line active:opacity-70',
    plain: 'bg-transparent text-accent-ink active:opacity-60',
    danger: 'bg-card text-[#D71921] ring-1 ring-inset ring-[#D71921]/25 dark:text-[#FF4D4D] active:opacity-70',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={cx(
        'flex h-[52px] w-full items-center justify-center gap-2 rounded-full px-6 text-[16px] font-semibold tracking-[-0.01em] transition disabled:opacity-35',
        styles,
        className,
      )}
    >
      {loading ? <Loader2 size={20} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* ---------- Списки ---------- */

export function Group({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-hidden rounded-[22px] bg-card', className)}>
      <div className="divide-y divide-dashed divide-line">{children}</div>
    </div>
  );
}

export function Row({ title, subtitle, left, right, onClick, chevron = true, selected, boost, wrap }: {
  title: ReactNode; subtitle?: ReactNode; left?: ReactNode; right?: ReactNode;
  onClick?: () => void; chevron?: boolean; selected?: boolean; boost?: boolean;
  /** длинный текст (адрес, комментарий) переносится на новые строки, а не обрезается «…» */
  wrap?: boolean;
}) {
  // div с role=button (а не <button>), чтобы внутри строки можно было разместить свои кнопки — например «Позвонить»
  const Tag = 'div';
  return (
    <Tag
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e: { key: string }) => { if (e.key === 'Enter') onClick(); } : undefined}
      className={cx(onClick && 'cursor-pointer select-none',
        'flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition',
        onClick && 'active:bg-black/[0.03] dark:active:bg-white/[0.05]',
        selected && 'bg-accent/[0.08]',
        boost && 'bg-[#AF52DE]/[0.10] shadow-[inset_4px_0_0_#AF52DE] dark:bg-[#BF5AF2]/[0.14] dark:shadow-[inset_4px_0_0_#BF5AF2]',
      )}
    >
      {left}
      <div className="min-w-0 flex-1">
        <div className={cx('text-[16px] font-medium leading-snug', wrap ? 'whitespace-pre-line break-words' : 'truncate')}>{title}</div>
        {subtitle && <div className="mt-0.5 text-[13.5px] leading-snug text-muted">{subtitle}</div>}
      </div>
      {right}
      {onClick && chevron && <ChevronRight size={18} strokeWidth={1.5} className="shrink-0 text-muted/60" />}
    </Tag>
  );
}

type Tone = 'blue' | 'gray' | 'green' | 'red' | 'orange' | 'purple';
const TONES: Record<Tone, string> = {
  blue: 'bg-accent/15 text-accent-ink',          // «основной» тон = фирменный оранжевый
  gray: 'bg-fill text-muted',
  green: 'bg-[#34C759]/15 text-[#1E7A35] dark:text-[#30D158]',
  red: 'bg-[#D71921]/12 text-[#D71921] dark:text-[#FF4D4D]',
  orange: 'bg-[#FFB800]/18 text-[#8A5A00] dark:text-[#FFC53D]',
  purple: 'bg-[#AF52DE]/15 text-[#8E3BB8] dark:text-[#D08CF5]', // повышенный коэффициент
};

/** Повышенный коэффициент к баллам: фиолетовая метка «×2,5». */
export const multLabel = (m: number) => `×${String(Math.round(m * 100) / 100).replace('.', ',')}`;
export function MultPill({ m, why }: { m?: number | null; why?: string }) {
  if (!m || m <= 1) return null;
  return <Pill tone="purple">⚡ {multLabel(m)}{why ? ` · ${why}` : ''}</Pill>;
}

export function IconBadge({ children, tone = 'blue' }: { children: ReactNode; tone?: Tone }) {
  return <div className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold', TONES[tone])}>{children}</div>;
}

export function Pill({ children, tone = 'gray' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-[5px] font-mono text-[11px] font-medium uppercase leading-none tracking-[0.06em]', TONES[tone])}>
      {children}
    </span>
  );
}

export const statusTone = (status?: string): Tone =>
  status === 'ok' ? 'green' : status === 'activity' ? 'red' : status === 'damaged' || status === 'missing' ? 'orange' : status === 'replaced' ? 'blue' : 'gray';

/* ---------- Поля ввода ---------- */

const fieldCls =
  'w-full rounded-2xl bg-card px-4 text-[16px] outline-none ring-1 ring-inset ring-line placeholder:text-muted/70 focus:ring-2 focus:ring-accent';

export function Input(props: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }) {
  const { icon, className, ...rest } = props;
  return (
    <div className="relative min-w-0">
      {icon && <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">{icon}</div>}
      {/* min-w-0 + appearance-none: на iPhone поля даты/времени иначе вылезают за край экрана */}
      <input {...rest} className={cx(fieldCls, 'h-[50px] min-w-0 max-w-full',
        (rest.type === 'date' || rest.type === 'time') && 'block appearance-none text-left [&::-webkit-date-and-time-value]:text-left',
        icon ? 'pl-10' : undefined, className)} />
    </div>
  );
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(fieldCls, 'resize-none py-3', props.className)} />;
}

const chipCls = (on: boolean) => cx(
  'min-h-[46px] rounded-2xl px-3 py-2.5 text-[15px] font-medium transition',
  on ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line active:opacity-70',
);

export function Chips({ options, value, onChange, columns = 2 }: {
  options: { id: string; label: string }[]; value: string; onChange: (v: string) => void; columns?: 1 | 2 | 3;
}) {
  const cols = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' }[columns];
  return (
    <div className={cx('grid gap-2', cols)}>
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={chipCls(value === o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

export function MultiChips({ options, value, onChange, columns = 2 }: {
  options: string[]; value: string[]; onChange: (v: string[]) => void; columns?: 2 | 3;
}) {
  const cols = columns === 3 ? 'grid-cols-3' : 'grid-cols-2';
  return (
    <div className={cx('grid gap-2', cols)}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button key={o} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])} className={cx(chipCls(on), 'relative')}>
            {on && <span className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-accent" />}
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function Stepper({ value, onChange, min = 0 }: { value: number; onChange: (v: number) => void; min?: number }) {
  const btn = 'h-12 w-12 rounded-full bg-card text-[22px] ring-1 ring-inset ring-line active:opacity-70';
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(Math.max(min, value - 1))} className={btn}>−</button>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value.replace(/\D/g, '')) || 0))}
        className="font-dot h-12 w-16 rounded-2xl bg-card text-center text-[22px] outline-none ring-1 ring-inset ring-line"
      />
      <button onClick={() => onChange(value + 1)} className={btn}>+</button>
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 rounded-2xl bg-card px-4 py-3 text-left ring-1 ring-inset ring-line">
      <span className="text-[16px]">{label}</span>
      <span className={cx('relative h-[31px] w-[51px] shrink-0 rounded-full transition', checked ? 'bg-accent' : 'bg-fill')}>
        <span className={cx('absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-[2px]')} />
      </span>
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <Label className="mb-2.5 px-1">{label}</Label>
      {children}
    </div>
  );
}

/** Переключатель-«таблетка». */
export function Segmented<T extends string>({ options, value, onChange }: {
  options: { id: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-full bg-fill p-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            'min-w-fit flex-1 whitespace-nowrap rounded-full px-3.5 py-2 text-[14px] font-medium transition',
            value === o.id ? 'bg-card text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Подтверждение опасного действия (с необязательным полем «Причина»). */
export function ConfirmSheet({ title, text, confirmLabel, danger = true, withReason, onConfirm, onClose }: {
  title: string; text: string; confirmLabel: string; danger?: boolean; withReason?: boolean;
  onConfirm: (reason: string) => Promise<void>; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title={title}>
      <p className="-mt-3 mb-5 text-[15px] leading-relaxed text-muted">{text}</p>
      {withReason && (
        <div className="mb-5">
          <Field label="Причина">
            <Input placeholder="Например: ошибка в юрлице" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      )}
      <div className="space-y-2.5">
        <Button variant={danger ? 'danger' : 'primary'} loading={busy}
          onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); } finally { setBusy(false); } }}>
          {confirmLabel}
        </Button>
        <Button variant="plain" onClick={onClose}>Отмена</Button>
      </div>
    </Sheet>
  );
}

/* ---------- Состояния ---------- */

export function Spinner() {
  return (
    <div className="flex justify-center gap-2 py-16" aria-label="Загрузка">
      {[0, 1, 2].map((i) => <span key={i} className="animate-dot h-2.5 w-2.5 rounded-full bg-ink" style={{ animationDelay: `${i * 0.15}s` }} />)}
    </div>
  );
}

export function Empty({ icon, title, text }: { icon: ReactNode; title: string; text?: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 text-muted/70">{icon}</div>
      <div className="font-display text-[20px] font-semibold uppercase">{title}</div>
      {text && <div className="mt-1 text-[15px] text-muted">{text}</div>}
    </div>
  );
}

/* ---------- Нижний лист (bottom sheet) ---------- */

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  // портал в body: лист, открытый из другого листа, не зажимается его анимацией/прокруткой и всегда поверх
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center md:p-6">
      <div className="absolute inset-0 bg-black/50 animate-fade" onClick={onClose} />
      {/* телефон — лист снизу; компьютер — окно по центру */}
      <div className="dot-grid relative max-h-[calc(100dvh-var(--safe-top)-24px)] w-full max-w-xl overflow-y-auto rounded-t-[28px] bg-page px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-3 animate-sheet md:max-h-[88dvh] md:rounded-[28px] md:px-6 md:pb-6 md:pt-6 md:shadow-2xl">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink/20 md:hidden" />
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="font-display text-[26px] font-semibold uppercase leading-none">{title}</h3>
          <button onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-muted ring-1 ring-inset ring-line" aria-label="Закрыть">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Тосты ---------- */

type ToastFn = (text: string, kind?: 'ok' | 'error') => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'error'; key: number } | null>(null);
  const show = useCallback<ToastFn>((text, kind = 'ok') => setToast({ text, kind, key: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div key={toast.key} className="top-safe pointer-events-none fixed inset-x-0 z-50 flex justify-center px-5 animate-fade">
          <div className={cx('flex max-w-md items-center gap-2.5 rounded-full px-5 py-3 text-[15px] font-medium shadow-lg',
            toast.kind === 'error' ? 'bg-[#D71921] text-white' : 'bg-ink text-card')}>
            <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', toast.kind === 'error' ? 'bg-white' : 'bg-accent')} />
            {toast.text}
          </div>
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export { cx };

/** Сворачиваемый раздел (Настройки): заголовок-кнопка со стрелкой; открытые разделы запоминаются на этом устройстве. */
export function Collapse({ id, title, hint, children, defaultOpen = false }: { id: string; title: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  const key = `collapse:${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    try { const v = localStorage.getItem(key); return v == null ? defaultOpen : v === '1'; } catch { return defaultOpen; }
  });
  const toggle = () => {
    setOpen((o) => { try { localStorage.setItem(key, o ? '0' : '1'); } catch { /* нет доступа к хранилищу */ } return !o; });
  };
  return (
    <div className="mt-3 overflow-hidden rounded-[22px] bg-card/60 ring-1 ring-inset ring-line">
      <button onClick={toggle} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:opacity-70">
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold">{title}</div>
          {hint && !open && <div className="truncate text-[12.5px] text-muted">{hint}</div>}
        </div>
        <ChevronDown size={20} strokeWidth={1.75} className={cx('shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}
