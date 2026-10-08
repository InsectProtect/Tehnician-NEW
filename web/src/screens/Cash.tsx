import { useCallback, useEffect, useState } from 'react';
import { Banknote, Coins, HandCoins, Pencil, Wallet } from 'lucide-react';
import { api } from '../api';
import { haptic } from '../telegram';
import type { CashMe, CashOverview } from '../types';
import { Button, ConfirmSheet, Empty, Field, Group, Input, Row, SectionTitle, Sheet, Spinner, cx, useToast } from '../components/ui';

/* ================================================================================================
 * «Касса» (v52): сколько наличных сейчас на руках у сотрудника (из оплат cash в выездах),
 * сдача кассы администратору/менеджеру и выдача из кассы под отчёт (с одобрением).
 * ================================================================================================ */

const lei = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString('ru-RU')} лей`;
const dt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/* ---------------- Сотрудник: виджет на главной ---------------- */

/** Цвет кассы по заполнению лимита: зелёный → жёлтый (от 80%) → красный (превышен). */
function cashTone(balance: number, limit: number | null | undefined) {
  if (!limit) return { bg: 'linear-gradient(135deg,#0E9F6E 0%,#34C759 100%)', shadow: '#0B6B4B', bar: '#FFFFFF', state: 'ok' as const };
  const r = balance / limit;
  if (r > 1) return { bg: 'linear-gradient(135deg,#D70015 0%,#FF453A 100%)', shadow: '#8A0010', bar: '#FFFFFF', state: 'over' as const };
  if (r >= 0.8) return { bg: 'linear-gradient(135deg,#E67E00 0%,#FFB800 100%)', shadow: '#8A5A00', bar: '#FFFFFF', state: 'warn' as const };
  return { bg: 'linear-gradient(135deg,#0E9F6E 0%,#34C759 100%)', shadow: '#0B6B4B', bar: '#FFFFFF', state: 'ok' as const };
}

export function CashWidget() {
  const toast = useToast();
  const [d, setD] = useState<CashMe | null>(null);
  const [sheet, setSheet] = useState<'handover' | 'withdraw' | null>(null);
  const load = useCallback(() => { api.cashMe().then(setD).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  if (!d) return null;
  const tone = cashTone(d.balance, d.limit);
  const pct = d.limit ? Math.min(100, (d.balance / d.limit) * 100) : 0;
  const canWithdraw = !d.pending || !d.pending_withdrawals.length;

  return (
    <div className="relative mb-4 overflow-hidden rounded-[24px] p-4 text-white" style={{ background: tone.bg, boxShadow: `0 6px 0 ${tone.shadow}` }}>
      {/* декоративные купюры */}
      <Banknote size={120} strokeWidth={1.2} className="pointer-events-none absolute -right-6 -top-6 rotate-12 opacity-[0.14]" />
      <Coins size={64} strokeWidth={1.4} className="pointer-events-none absolute bottom-2 right-24 -rotate-12 opacity-[0.12]" />

      <div className="relative flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-inset ring-white/30"><Wallet size={24} strokeWidth={2} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-white/80">Касса на руках</div>
          <div className="font-dot text-[34px] font-bold leading-none drop-shadow-sm">{lei(d.balance)}</div>
        </div>
        {tone.state === 'over' && <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11.5px] font-extrabold text-[#D70015]">ЛИМИТ!</span>}
      </div>

      {d.limit ? (
        <div className="relative mt-3">
          <div className="h-2.5 overflow-hidden rounded-full bg-black/20"><div className="h-full rounded-full bg-white transition-all" style={{ width: `${pct}%` }} /></div>
          <div className="mt-1.5 flex justify-between text-[12px] font-semibold text-white/90">
            <span>{tone.state === 'over' ? `Больше лимита на ${lei(d.balance - d.limit)}` : `Можно ещё ${lei(d.limit - d.balance)}`}</span>
            <span>лимит {lei(d.limit)}</span>
          </div>
        </div>
      ) : null}

      {tone.state === 'over' && !d.pending && (
        <div className="relative mt-3 rounded-xl bg-white/20 px-3.5 py-2.5 text-[13.5px] font-semibold leading-snug ring-1 ring-inset ring-white/30">🚨 Лимит превышен — сдайте кассу в офис как можно скорее.</div>
      )}
      {d.pending && (
        <div className="relative mt-3 rounded-xl bg-white/20 px-3.5 py-2.5 text-[13px] leading-snug ring-1 ring-inset ring-white/25">⏳ Запрос на сдачу отправлен · ожидается {lei(d.pending.expected_amount)} — ждите, когда примут.</div>
      )}
      {d.pending_withdrawals.map((w) => (
        <div key={w.id} className="relative mt-2 rounded-xl bg-black/15 px-3.5 py-2.5 text-[13px] leading-snug">⏳ Запрос на {lei(w.amount)} — «{w.reason}» — ждёт решения.</div>
      ))}

      <div className={cx('relative mt-3 grid gap-2', !d.pending && d.balance > 0 && canWithdraw ? 'grid-cols-2' : 'grid-cols-1')}>
        {!d.pending && d.balance > 0 && (
          <button onClick={() => { haptic.tap(); setSheet('handover'); }}
            className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-white text-[14.5px] font-extrabold active:translate-y-[2px]"
            style={{ color: tone.shadow, boxShadow: '0 3px 0 rgba(0,0,0,0.25)' }}>
            <Banknote size={18} strokeWidth={2} />Сдать кассу
          </button>
        )}
        {canWithdraw && (
          <button onClick={() => { haptic.tap(); setSheet('withdraw'); }}
            className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-white/20 text-[14.5px] font-bold ring-1 ring-inset ring-white/35 active:opacity-80">
            <HandCoins size={18} strokeWidth={2} />Взять из кассы
          </button>
        )}
      </div>
      {d.last_handover && (
        <div className="relative mt-2.5 text-[12px] text-white/85">
          Последняя сдача: {d.last_handover.amount != null ? lei(d.last_handover.amount) : '—'} · {dt(d.last_handover.at)} {d.last_handover.status === 'ok' ? '✓ сошлось' : '⚠️ недостача'}
        </div>
      )}

      {sheet === 'handover' && (
        <ConfirmSheet
          title="Сдать кассу"
          text={`Отправить запрос на сдачу кассы — ожидается ${lei(d.balance)}. Администратор пересчитает наличные при получении: если сумма сойдётся — отметит галочкой, если нет — покажет, сколько не хватает.`}
          confirmLabel="Отправить запрос"
          danger={false}
          onClose={() => setSheet(null)}
          onConfirm={async () => {
            try { await api.cashHandover(); haptic.success(); toast('Запрос отправлен'); setSheet(null); load(); }
            catch (e) { toast((e as Error).message, 'error'); }
          }}
        />
      )}
      {sheet === 'withdraw' && <WithdrawSheet onClose={() => setSheet(null)} onDone={() => { setSheet(null); load(); }} />}
    </div>
  );
}

function WithdrawSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = Number(amount.replace(',', '.')) > 0 && reason.trim().length >= 3;
  async function submit() {
    setBusy(true);
    try {
      await api.cashWithdraw(amount.replace(',', '.'), reason.trim());
      haptic.success();
      toast('Запрос отправлен — ждите одобрения администратора');
      onDone();
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title="Взять из кассы">
      <p className="-mt-3 mb-5 text-[14.5px] leading-relaxed text-muted">Деньги можно взять только после того, как администратор даст добро. Обязательно укажите, на что.</p>
      <div className="space-y-4">
        <Field label="Сумма, лей"><Input inputMode="decimal" placeholder="500" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="На что"><Input placeholder="Например: купить клей для ловушек" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <Button className="mt-6" disabled={!valid} loading={busy} onClick={submit}>Отправить запрос</Button>
    </Sheet>
  );
}

/* ---------------- Администратор / менеджер с правом «Касса» ---------------- */

export function CashPanel() {
  const toast = useToast();
  const [d, setD] = useState<CashOverview | null>(null);
  const [confirmId, setConfirmId] = useState<{ id: string; name: string; expected: number } | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<{ tg: string; name: string; balance: number } | null>(null);
  const [limitTarget, setLimitTarget] = useState<CashOverview['items'][number] | null>(null);
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.cashOverview().then((r) => { setD(r); setLimit(String(r.limit ?? '')); }).catch((e: Error) => toast(e.message, 'error')); }, [toast]);
  useEffect(() => { load(); }, [load]);

  if (!d) return <Spinner />;
  const over = d.items.filter((i) => i.over).length;
  const waiting = d.items.filter((i) => i.pending_handover).length;
  const total = d.total ?? d.items.reduce((s2, i) => s2 + i.balance, 0);

  async function saveLimit() {
    setBusy(true);
    try { const r = await api.cashLimits({ limit: limit.replace(/\s/g, '') || 0 }); setD(r); haptic.success(); toast('Лимит сохранён'); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div>
      {/* сводка */}
      <div className="relative overflow-hidden rounded-[24px] p-5 text-white" style={{ background: 'linear-gradient(135deg,#0B6B4B 0%,#0E9F6E 55%,#34C759 100%)', boxShadow: '0 6px 0 #064A33' }}>
        <Banknote size={140} strokeWidth={1.1} className="pointer-events-none absolute -right-8 -top-8 rotate-12 opacity-[0.13]" />
        <div className="relative text-[12px] font-bold uppercase tracking-[0.12em] text-white/80">Всего наличных у сотрудников</div>
        <div className="relative mt-1 font-dot text-[40px] font-bold leading-none">{lei(total)}</div>
        <div className="relative mt-3 flex flex-wrap gap-2 text-[12.5px] font-bold">
          <span className={cx('rounded-full px-3 py-1', over ? 'bg-[#FF453A] text-white' : 'bg-white/20')}>🚨 Превышен лимит: {over}</span>
          <span className={cx('rounded-full px-3 py-1', waiting ? 'bg-[#FFD23F] text-black' : 'bg-white/20')}>⏳ Ждут сдачи: {waiting}</span>
          <span className={cx('rounded-full px-3 py-1', d.withdrawals.length ? 'bg-white text-[#0B6B4B]' : 'bg-white/20')}>💸 Запросы: {d.withdrawals.length}</span>
        </div>
      </div>

      {d.withdrawals.length > 0 && (
        <>
          <SectionTitle>Запросы на выдачу из кассы</SectionTitle>
          <Group>
            {d.withdrawals.map((w) => (
              <WithdrawRow key={w.id} w={w} onDecided={load} />
            ))}
          </Group>
        </>
      )}

      <SectionTitle>Наличные на руках</SectionTitle>
      {d.items.length === 0 ? (
        <Empty icon={<Wallet size={44} strokeWidth={1.25} />} title="Пока пусто" text="Здесь появятся сотрудники, у которых есть касса." />
      ) : (
        <div className="space-y-2.5">
          {d.items.map((it) => {
            const tone = cashTone(it.balance, it.limit);
            const pct = it.limit ? Math.min(100, (it.balance / it.limit) * 100) : 0;
            const color = tone.state === 'over' ? '#FF3B30' : tone.state === 'warn' ? '#FF9F0A' : '#34C759';
            return (
              <div key={it.tg_id} className={cx('rounded-[20px] bg-card p-3.5', tone.state === 'over' && 'ring-2 ring-[#FF3B30]')}>
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[17px] font-extrabold text-white" style={{ background: tone.bg }}>
                    {(it.name || '?').trim().slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15.5px] font-semibold">{it.name}</div>
                    <div className="font-dot text-[22px] font-bold leading-tight" style={{ color: it.balance > 0 ? color : undefined }}>{lei(it.balance)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button onClick={() => setAdjustTarget({ tg: it.tg_id, name: it.name, balance: it.balance })}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-fill text-muted" aria-label="Изменить сумму"><Pencil size={15} strokeWidth={1.75} /></button>
                    {it.pending_handover && (
                      <Button className="h-9 px-3 text-[13px]" onClick={() => setConfirmId({ id: it.pending_handover!.id, name: it.name, expected: it.pending_handover!.expected_amount })}>Принять</Button>
                    )}
                  </div>
                </div>
                {it.limit ? (
                  <div className="mt-2.5">
                    <div className="h-2 overflow-hidden rounded-full bg-fill"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div>
                  </div>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12.5px] text-muted">
                  <span>
                    {it.pending_handover ? `⏳ сдаёт ${lei(it.pending_handover.expected_amount)} · ` : ''}
                    {it.pending_withdrawals ? `💸 запросов: ${it.pending_withdrawals} · ` : ''}
                    {tone.state === 'over' ? <b className="text-[#D70015] dark:text-[#FF453A]">лимит превышен</b> : it.limit ? `${Math.round(pct)}% лимита` : 'без лимита'}
                  </span>
                  <button onClick={() => { haptic.tap(); setLimitTarget(it); }} className="font-semibold text-accent-ink">
                    Лимит: {it.limit ? lei(it.limit) : 'нет'}{it.own_limit ? ' (свой)' : ''}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* общий лимит */}
      <div className="mt-5 rounded-[20px] bg-card p-4">
        <div className="text-[16px] font-semibold">Лимит наличных на руках</div>
        <div className="mt-1 text-[13px] leading-snug text-muted">Сколько дезинсектор может держать наличными. При превышении он и вы получаете уведомление, а его касса краснеет и просит сдать. 0 — без лимита. Свой лимит сотруднику — кнопкой «Лимит» в его карточке.</div>
        <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2.5">
          <Field label="Для всех, лей"><Input inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^\d]/g, ''))} placeholder="5000" /></Field>
          <Button className="h-[48px] px-5" loading={busy} onClick={saveLimit}>Сохранить</Button>
        </div>
      </div>

      {confirmId && (
        <HandoverConfirmSheet
          name={confirmId.name} expected={confirmId.expected}
          onClose={() => setConfirmId(null)}
          onDone={() => { setConfirmId(null); load(); }}
          id={confirmId.id}
        />
      )}
      {adjustTarget && (
        <AdjustSheet
          tg={adjustTarget.tg} name={adjustTarget.name} balance={adjustTarget.balance}
          onClose={() => setAdjustTarget(null)}
          onDone={() => { setAdjustTarget(null); load(); }}
        />
      )}
      {limitTarget && <LimitSheet it={limitTarget} common={d.limit ?? 0} onClose={() => setLimitTarget(null)} onDone={(r) => { setLimitTarget(null); setD(r); }} />}
    </div>
  );
}

function LimitSheet({ it, common, onClose, onDone }: { it: CashOverview['items'][number]; common: number; onClose: () => void; onDone: (r: CashOverview) => void }) {
  const toast = useToast();
  const [v, setV] = useState(it.own_limit && it.limit != null ? String(it.limit) : '');
  const [busy, setBusy] = useState(false);
  async function save(limit: string | null) {
    setBusy(true);
    try { const r = await api.cashLimits({ tg: it.tg_id, limit }); haptic.success(); toast(limit === null ? 'Лимит как у всех' : 'Лимит сохранён'); onDone(r); } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={`Лимит · ${it.name}`}>
      <p className="-mt-3 mb-5 text-[14.5px] leading-relaxed text-muted">Общий лимит — {common ? lei(common) : 'нет'}. Можно задать этому сотруднику свой: больше (давно работает, много наличных заказов) или меньше. 0 — без лимита.</p>
      <Field label="Свой лимит, лей"><Input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ''))} placeholder={common ? String(common) : '5000'} /></Field>
      <div className="mt-5 space-y-2">
        <Button loading={busy} disabled={v === ''} onClick={() => save(v)}>Сохранить</Button>
        {it.own_limit && <Button variant="secondary" disabled={busy} onClick={() => save(null)}>Как у всех ({common ? lei(common) : 'без лимита'})</Button>}
      </div>
    </Sheet>
  );
}

function AdjustSheet({ tg, name, balance, onClose, onDone }: { tg: string; name: string; balance: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(String(balance).replace('.', ','));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = Number(amount.replace(',', '.')) >= 0 && reason.trim().length >= 3;
  async function submit() {
    setBusy(true);
    try {
      await api.cashAdjust(tg, amount.replace(',', '.'), reason.trim());
      haptic.success();
      toast('Сумма изменена');
      onDone();
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={`Изменить кассу · ${name}`}>
      <p className="-mt-3 mb-5 text-[14.5px] leading-relaxed text-muted">Сейчас на руках: <b className="text-ink dark:text-white">{lei(balance)}</b>. Укажите фактическую сумму и причину правки (например, сверка или исправление ошибки).</p>
      <div className="space-y-4">
        <Field label="Сумма на руках, лей"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Причина"><Input placeholder="Например: сверка наличных" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <Button className="mt-6" disabled={!valid} loading={busy} onClick={submit}>Сохранить</Button>
    </Sheet>
  );
}

function WithdrawRow({ w, onDecided }: { w: CashOverview['withdrawals'][number]; onDecided: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<'ok' | 'no' | null>(null);
  async function decide(ok: boolean) {
    setBusy(ok ? 'ok' : 'no');
    try { await api.cashDecideWithdraw(w.id, ok); haptic.success(); toast(ok ? 'Одобрено' : 'Отклонено'); onDecided(); }
    catch (e) { toast((e as Error).message, 'error'); setBusy(null); }
  }
  return (
    <Row
      title={`${w.name} · ${lei(w.amount)}`}
      subtitle={`${w.reason} · ${dt(w.created_at)}`}
      chevron={false}
      right={
        <div className="flex gap-1.5">
          <button onClick={() => decide(false)} disabled={busy !== null} className={cx('rounded-xl bg-[#FF453A]/12 px-3 py-1.5 text-[13px] font-medium text-[#D70015] dark:text-[#FF453A]', busy === 'no' && 'opacity-50')}>✕</button>
          <button onClick={() => decide(true)} disabled={busy !== null} className={cx('rounded-xl bg-[#34C759]/15 px-3 py-1.5 text-[13px] font-medium text-[#1E7A35] dark:text-[#30D158]', busy === 'ok' && 'opacity-50')}>✓ Разрешить</button>
        </div>
      }
    />
  );
}

function HandoverConfirmSheet({ id, name, expected, onClose, onDone }: { id: string; name: string; expected: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(String(expected).replace('.', ','));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: 'ok' | 'short'; shortfall: number } | null>(null);
  async function submit() {
    const v = Number(amount.replace(',', '.'));
    if (!(v >= 0)) { toast('Укажите пересчитанную сумму', 'error'); return; }
    setBusy(true);
    try {
      const r = await api.cashConfirm(id, amount.replace(',', '.'));
      haptic.success();
      setResult(r);
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  }
  return (
    <Sheet open onClose={() => { onClose(); if (result) onDone(); }} title={`Сдача кассы · ${name}`}>
      {result ? (
        <div className={cx('rounded-2xl p-4 text-[15px] leading-relaxed', result.status === 'ok' ? 'bg-[#34C759]/12' : 'bg-[#FF9500]/12')}>
          {result.status === 'ok' ? '✅ Сошлось — касса принята.' : `⚠️ Не хватает ${lei(result.shortfall)}. Сотрудник уведомлён.`}
          <Button className="mt-4" onClick={() => { onClose(); onDone(); }}>Готово</Button>
        </div>
      ) : (
        <>
          <p className="-mt-3 mb-5 text-[14.5px] leading-relaxed text-muted">По учёту ожидается <b className="text-ink dark:text-white">{lei(expected)}</b>. Пересчитайте наличные и укажите, сколько получили фактически.</p>
          <Field label="Фактически получено, лей"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Button className="mt-6" loading={busy} onClick={submit}>Подтвердить приём</Button>
        </>
      )}
    </Sheet>
  );
}
