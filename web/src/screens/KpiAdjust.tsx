import { useCallback, useEffect, useState } from 'react';
import { Bot, Check, Plus, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { api } from '../api';
import { haptic } from '../telegram';
import type { AdjRule, KpiAdjust, KpiPlanRow } from '../types';
import { Button, Field, Input, Pill, SectionTitle, Sheet, Spinner, cx, useToast } from '../components/ui';

const pts = (n: number) => `${n > 0 ? '+' : ''}${String(n).replace('.', ',')}`;

/**
 * «Бонусы и штрафы»: бот по правилам предлагает +/− баллы (в последний день месяца сам, или по кнопке),
 * администратор применяет, меняет или отклоняет; можно добавить вручную.
 */
export function KpiAdjustPanel({ month, rows, onChanged }: { month: string; rows: KpiPlanRow[]; onChanged: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<{ rules: AdjRule[]; items: KpiAdjust[] } | null>(null);
  const [busy, setBusy] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [addFor, setAddFor] = useState<KpiPlanRow | null | 'pick'>(null);

  const load = useCallback(() => { api.kpiAdjust(month).then(setD).catch((e: Error) => toast(e.message, 'error')); }, [month, toast]);
  useEffect(() => { setD(null); load(); }, [load]);
  const changed = () => { load(); onChanged(); };

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try { await fn(); haptic.success(); if (ok) toast(ok); changed(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  }

  const proposed = d?.items.filter((a) => a.status === 'proposed') ?? [];
  const byTech = rows.map((r) => ({ r, items: d?.items.filter((a) => a.tg_id === r.id) ?? [] }));

  return (
    <>
      <SectionTitle>Бонусы и штрафы</SectionTitle>
      <div className="rounded-[22px] bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-xl text-[13.5px] leading-snug text-muted">
            <Bot size={16} strokeWidth={1.75} className="mr-1 inline text-accent-ink" />
            Бот сам предлагает бонусы за хорошую работу и штрафы за плохую — по правилам. В последний день месяца в 18:00 рекомендации
            формируются автоматически и приходят вам в бот. Применённые баллы входят в план и KPI сотрудника, он получает уведомление.
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setRulesOpen(true)} className="flex h-9 items-center gap-1.5 rounded-full bg-fill px-3.5 text-[13.5px] font-medium"><SlidersHorizontal size={15} strokeWidth={1.75} /> Правила</button>
            <button onClick={() => setAddFor('pick')} className="flex h-9 items-center gap-1.5 rounded-full bg-fill px-3.5 text-[13.5px] font-medium"><Plus size={15} strokeWidth={2} /> Вручную</button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" loading={busy === 'suggest'} icon={<Bot size={18} strokeWidth={1.75} />}
            onClick={() => run('suggest', async () => { const r = await api.suggestAdjust(month); toast(r.proposed ? `Бот предложил: ${r.proposed}` : 'Новых рекомендаций нет'); })}>
            Рекомендации бота сейчас
          </Button>
          <Button disabled={!proposed.length} loading={busy === 'all'} icon={<Check size={18} strokeWidth={2} />}
            onClick={() => run('all', () => api.applyAllAdjust(month), 'Всё применено')}>
            Применить все{proposed.length ? ` · ${proposed.length}` : ''}
          </Button>
        </div>

        {!d ? <Spinner /> : (
          <div className="mt-4 space-y-3">
            {byTech.map(({ r, items }) => {
              const sum = items.filter((a) => a.status === 'applied').reduce((s, a) => s + a.points, 0);
              return (
                <div key={r.id} className="rounded-2xl bg-fill/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{r.name}</span>
                    <span className="flex items-center gap-2">
                      {sum !== 0 && <b className={cx('font-dot', sum > 0 ? 'text-[#248A3D] dark:text-[#30D158]' : 'text-[#D70015] dark:text-[#FF453A]')}>{pts(Math.round(sum * 100) / 100)} б</b>}
                      <button aria-label="Добавить" onClick={() => setAddFor(r)} className="flex h-8 w-8 items-center justify-center rounded-full bg-card"><Plus size={15} strokeWidth={2} /></button>
                    </span>
                  </div>
                  {items.length === 0 ? <div className="mt-1 text-[12.5px] text-muted">Корректировок нет</div> : (
                    <div className="mt-2 space-y-1.5">
                      {items.map((a) => (
                        <div key={a.id} className={cx('flex items-center gap-2 rounded-xl bg-card px-3 py-2', a.status === 'rejected' && 'opacity-50')}>
                          <b className={cx('w-12 shrink-0 font-dot text-[15px]', a.points > 0 ? 'text-[#248A3D] dark:text-[#30D158]' : 'text-[#D70015] dark:text-[#FF453A]')}>{pts(a.points)}</b>
                          <div className="min-w-0 flex-1">
                            <div className={cx('text-[13.5px] leading-snug', a.status === 'rejected' && 'line-through')}>{a.reason}</div>
                            <div className="text-[11.5px] text-muted">
                              {a.rule === 'manual' ? 'вручную' : '🤖 бот'}
                              {a.status === 'applied' ? ` · применено${a.decided_by ? ` · ${a.decided_by}` : ''}` : a.status === 'rejected' ? ' · отклонено' : ''}
                            </div>
                          </div>
                          {a.status === 'proposed' ? (
                            <>
                              <button aria-label="Отклонить" disabled={!!busy} onClick={() => run(a.id, () => api.decideAdjust(a.id, { apply: false }))}
                                className="flex h-8 w-8 items-center justify-center rounded-full text-muted ring-1 ring-inset ring-line"><X size={15} strokeWidth={2} /></button>
                              <button aria-label="Применить" disabled={!!busy} onClick={() => run(a.id, () => api.decideAdjust(a.id, { apply: true }))}
                                className="flex h-8 items-center gap-1 rounded-full bg-accent px-3 text-[13px] font-semibold text-black"><Check size={14} strokeWidth={2.5} /> Применить</button>
                            </>
                          ) : (
                            <button aria-label="Отменить решение" disabled={!!busy} onClick={() => run(a.id, () => api.decideAdjust(a.id, { undo: true }))}
                              className="flex h-8 w-8 items-center justify-center rounded-full text-muted" title="Вернуть на рассмотрение"><RotateCcw size={14} strokeWidth={2} /></button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {rulesOpen && d && <RulesSheet rules={d.rules} onClose={() => setRulesOpen(false)} onSaved={() => { setRulesOpen(false); load(); }} />}
      {addFor && <AddSheet month={month} rows={rows} initial={addFor === 'pick' ? null : addFor} onClose={() => setAddFor(null)} onSaved={() => { setAddFor(null); changed(); }} />}
    </>
  );
}

function AddSheet({ month, rows, initial, onClose, onSaved }: { month: string; rows: KpiPlanRow[]; initial: KpiPlanRow | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [tg, setTg] = useState(initial?.id || rows[0]?.id || '');
  const [sign, setSign] = useState<1 | -1>(1);
  const [val, setVal] = useState('1');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title="Бонус или штраф">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {rows.map((r) => (
            <button key={r.id} onClick={() => setTg(r.id)} className={cx('h-9 rounded-full px-3.5 text-[14px] font-medium', tg === r.id ? 'bg-ink text-card' : 'bg-fill')}>{r.name}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setSign(1)} className={cx('h-11 rounded-full text-[15px] font-semibold', sign === 1 ? 'bg-[#34C759] text-black' : 'bg-fill')}>+ Бонус</button>
          <button onClick={() => setSign(-1)} className={cx('h-11 rounded-full text-[15px] font-semibold', sign === -1 ? 'bg-[#D71921] text-white' : 'bg-fill')}>− Штраф</button>
        </div>
        <Field label="Баллов"><Input inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} /></Field>
        <Field label="Причина (увидит сотрудник)"><Input placeholder="Например: помог коллеге на сложном объекте" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <Button className="mt-5" loading={busy} onClick={async () => {
        setBusy(true);
        try { await api.addAdjust(month, tg, sign * Number(val.replace(',', '.')), reason.trim()); haptic.success(); toast('Сохранено'); onSaved(); }
        catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
      }}>Применить</Button>
    </Sheet>
  );
}

function RulesSheet({ rules, onClose, onSaved }: { rules: AdjRule[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [list, setList] = useState(rules.map((r) => ({ ...r, p: String(r.points).replace('.', ','), t: String(r.threshold).replace('.', ',') })));
  const [busy, setBusy] = useState(false);
  const upd = (i: number, x: Partial<(typeof list)[number]>) => setList(list.map((r, j) => (j === i ? { ...r, ...x } : r)));
  return (
    <Sheet open onClose={onClose} title="Правила бота">
      <p className="-mt-3 mb-4 text-[13.5px] leading-snug text-muted">По этим правилам бот предлагает бонусы и штрафы. Выключите лишнее, поменяйте баллы и пороги.</p>
      <div className="space-y-2.5">
        {list.map((r, i) => (
          <div key={r.id} className={cx('rounded-2xl p-3 ring-1 ring-inset ring-line', !r.enabled && 'opacity-60')}>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input type="checkbox" className="h-5 w-5 accent-[#F58220]" checked={r.enabled} onChange={(e) => upd(i, { enabled: e.target.checked })} />
              <span className="flex-1 text-[15px] font-medium">{r.label}</span>
              <Pill tone={r.kind === 'bonus' ? 'green' : 'red'}>{r.kind === 'bonus' ? 'бонус' : 'штраф'}</Pill>
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block px-1 text-[11.5px] text-muted">{r.kind === 'bonus' ? '+' : '−'} баллов{r.per_unit ? ' (за каждый)' : ''}</span>
                <Input inputMode="decimal" value={r.p} onChange={(e) => upd(i, { p: e.target.value })} />
              </label>
              {!r.per_unit && r.id !== 'plan_unacked' && (
                <label className="block">
                  <span className="mb-1 block px-1 text-[11.5px] text-muted">Порог: {r.unit}</span>
                  <Input inputMode="decimal" value={r.t} onChange={(e) => upd(i, { t: e.target.value })} />
                </label>
              )}
            </div>
          </div>
        ))}
      </div>
      <Button className="mt-5" loading={busy} onClick={async () => {
        setBusy(true);
        try {
          await api.saveAdjRules(list.map((r) => ({ ...r, points: Number(r.p.replace(',', '.')), threshold: Number(r.t.replace(',', '.')) })));
          haptic.success(); toast('Правила сохранены'); onSaved();
        } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
      }}>Сохранить правила</Button>
    </Sheet>
  );
}
