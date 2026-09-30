import { Banknote, CalendarDays, Landmark, ShieldCheck } from 'lucide-react';
import { haptic } from '../telegram';
import type { Payment, Visit } from '../types';
import { Input, cx } from './ui';

/*
 * Оплата при завершении выезда. Дезинсектор обязательно выбирает одно:
 * наличные получены (с суммой) · перечисление (юрлицо) · без оплаты — гарантия · обработка на несколько дней.
 */

export const PAYMENT_UI: Record<Payment, { label: string; short: string; hint: string; tone: string; Icon: typeof Banknote }> = {
  cash: { label: 'Наличные получены', short: 'Наличные', hint: 'клиент заплатил сейчас', tone: 'text-[#248A3D] dark:text-[#30D158]', Icon: Banknote },
  transfer: { label: 'Перечисление', short: 'Перечисление', hint: 'юрлицо, по счёту', tone: 'text-[#0066CC] dark:text-[#64A8FF]', Icon: Landmark },
  none: { label: 'Оплаты нет', short: 'Гарантия', hint: 'повтор по гарантии', tone: 'text-muted', Icon: ShieldCheck },
  multi: { label: 'Несколько дней', short: 'Несколько дней', hint: 'оплата в последний день', tone: 'text-[#C93400] dark:text-[#FF9F0A]', Icon: CalendarDays },
};
const ORDER: Payment[] = ['cash', 'transfer', 'none', 'multi'];

const money = (n: number) => `${String(Math.round(n * 100) / 100).replace('.', ',')} лей`;

/** Что выбрать по умолчанию: этап «1/2» — несколько дней, юрлицо — перечисление, иначе — пусть выберет сам. */
export function defaultPayment(visit: Visit): Payment | '' {
  if (visit.payment) return visit.payment;
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(visit.stage || '');
  if (m && Number(m[1]) < Number(m[2])) return 'multi';
  if (visit.is_company) return 'transfer';
  return '';
}
export function defaultPayNote(visit: Visit, p: Payment | ''): string {
  if (visit.pay_note) return visit.pay_note;
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(visit.stage || '');
  if (p === 'multi' && m) return `этап ${m[1]} из ${m[2]}`;
  return '';
}

export type PayState = { payment: Payment | ''; amount: string; note: string };

export function PaymentPicker({ v, set, price }: { v: PayState; set: (p: Partial<PayState>) => void; price?: number | null }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {ORDER.map((k) => {
          const u = PAYMENT_UI[k];
          const on = v.payment === k;
          return (
            <button key={k} onClick={() => {
              haptic.tap();
              set({ payment: k, ...(k === 'cash' && !v.amount && price ? { amount: String(price).replace('.', ',') } : {}) });
            }}
              className={cx('flex min-h-[64px] items-start gap-2.5 rounded-2xl p-3 text-left transition', on ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>
              <u.Icon size={20} strokeWidth={1.75} className={cx('mt-0.5 shrink-0', on ? '' : u.tone)} />
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold leading-tight">{u.label}</span>
                <span className={cx('mt-0.5 block text-[12px] leading-snug', on ? 'opacity-70' : 'text-muted')}>{u.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      {v.payment === 'cash' && (
        <div className="mt-3">
          <div className="mb-1 px-1 text-[13px] text-muted">Сколько получено, лей{price ? ` · по заявке ${money(price)}` : ''}</div>
          <Input inputMode="decimal" placeholder="Например: 450" value={v.amount} onChange={(e) => set({ amount: e.target.value })} className="font-dot text-[18px]" />
        </div>
      )}
      {(v.payment === 'none' || v.payment === 'multi') && (
        <div className="mt-3">
          <Input placeholder={v.payment === 'none' ? 'Комментарий: гарантия по акту № …' : 'Например: этап 1 из 2, оплата в конце'}
            value={v.note} onChange={(e) => set({ note: e.target.value })} />
        </div>
      )}
      {v.payment === 'transfer' && <div className="mt-2 px-1 text-[12.5px] text-muted">Офис выставит счёт — наличные не берите.</div>}
    </div>
  );
}

/** Небольшая метка оплаты в карточке выезда и в списках. */
export function PaymentBadge({ payment, amount, note }: { payment?: Payment | ''; amount?: number | null; note?: string }) {
  if (!payment) return null;
  const u = PAYMENT_UI[payment];
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[13.5px] font-medium', u.tone)}>
      <u.Icon size={16} strokeWidth={1.75} className="shrink-0" />
      {u.short}{payment === 'cash' && amount != null ? ` · ${money(amount)}` : ''}{note ? ` · ${note}` : ''}
    </span>
  );
}
