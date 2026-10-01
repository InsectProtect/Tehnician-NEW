import { useCallback, useEffect, useState } from 'react';
import { Banknote, HandCoins, Pencil, Wallet } from 'lucide-react';
import { api } from '../api';
import { haptic } from '../telegram';
import type { CashMe, CashOverview } from '../types';
import { Button, ConfirmSheet, Empty, Field, Group, Input, Row, SectionTitle, Sheet, Spinner, cx, useToast } from '../components/ui';

/* ================================================================================================
 * «Касса» (v52): сколько наличных сейчас на руках у сотрудника (из оплат cash в выездах),
 * сдача кассы администратору/менеджеру и выдача из кассы под отчёт (с одобрением).
 * ================================================================================================ */

const lei = (n: number) => `${Math.round(n * 100) / 100}`.replace('.', ',') + ' лей';
const dt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/* ---------------- Сотрудник: виджет на главной ---------------- */

export function CashWidget() {
  const toast = useToast();
  const [d, setD] = useState<CashMe | null>(null);
  const [sheet, setSheet] = useState<'handover' | 'withdraw' | null>(null);
  const load = useCallback(() => { api.cashMe().then(setD).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  if (!d) return null;

  return (
    <div className="mb-4 rounded-[22px] border-2 border-line bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-ink"><Wallet size={20} strokeWidth={2} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-muted">В кассе на руках</div>
          <div className="font-dot text-[26px] font-bold leading-none">{lei(d.balance)}</div>
        </div>
      </div>
      {d.pending && (
        <div className="mt-3 rounded-xl bg-accent/[0.08] px-3.5 py-2.5 text-[13px] leading-snug">⏳ Запрос на сдачу кассы отправлен · ожидается {lei(d.pending.expected_amount)} — ждите, когда примут.</div>
      )}
      {d.pending_withdrawals.map((w) => (
        <div key={w.id} className="mt-2 rounded-xl bg-fill px-3.5 py-2.5 text-[13px] leading-snug">⏳ Запрос на {lei(w.amount)} — «{w.reason}» — ждёт решения администратора.</div>
      ))}
      {!d.pending && (
        <div className={cx('mt-3 grid gap-2', d.balance > 0 ? 'grid-cols-2' : 'grid-cols-1')}>
          {d.balance > 0 && (
            <Button variant="secondary" className="text-[14px]" onClick={() => { haptic.tap(); setSheet('handover'); }} icon={<Banknote size={17} strokeWidth={1.75} />}>Сдать кассу</Button>
          )}
          <Button variant="secondary" className="text-[14px]" onClick={() => { haptic.tap(); setSheet('withdraw'); }} icon={<HandCoins size={17} strokeWidth={1.75} />}>Взять из кассы</Button>
        </div>
      )}
      {d.pending && !d.pending_withdrawals.length && (
        <div className="mt-3">
          <Button variant="plain" className="text-[14px]" onClick={() => { haptic.tap(); setSheet('withdraw'); }} icon={<HandCoins size={17} strokeWidth={1.75} />}>Взять из кассы</Button>
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
  const load = useCallback(() => { api.cashOverview().then(setD).catch((e: Error) => toast(e.message, 'error')); }, [toast]);
  useEffect(() => { load(); }, [load]);

  if (!d) return <Spinner />;

  return (
    <div>
      <SectionTitle>Наличные на руках</SectionTitle>
      {d.items.length === 0 ? (
        <Empty icon={<Wallet size={44} strokeWidth={1.25} />} title="Пока пусто" text="Здесь появятся сотрудники, у которых есть касса." />
      ) : (
        <Group>
          {d.items.map((it) => (
            <Row key={it.tg_id}
              title={it.name}
              subtitle={[
                it.balance > 0 ? `На руках: ${lei(it.balance)}` : 'На руках: 0',
                it.pending_handover ? `⏳ хочет сдать ${lei(it.pending_handover.expected_amount)}` : '',
                it.pending_withdrawals ? `⏳ запросов на выдачу: ${it.pending_withdrawals}` : '',
              ].filter(Boolean).join(' · ')}
              right={
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setAdjustTarget({ tg: it.tg_id, name: it.name, balance: it.balance })}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-fill text-muted"
                    aria-label="Изменить сумму"
                  ><Pencil size={15} strokeWidth={1.75} /></button>
                  {it.pending_handover && (
                    <Button className="h-9 px-3 text-[13px]" onClick={() => setConfirmId({ id: it.pending_handover!.id, name: it.name, expected: it.pending_handover!.expected_amount })}>Принять</Button>
                  )}
                </div>
              }
              chevron={false}
            />
          ))}
        </Group>
      )}

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
    </div>
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
