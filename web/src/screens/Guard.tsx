import { useCallback, useEffect, useState } from 'react';
import { Check, ScanSearch, ShieldAlert, X } from 'lucide-react';
import { api } from '../api';
import { haptic } from '../telegram';
import type { GuardFlag, GuardRes, GuardSettings } from '../types';
import { Button, Field, Input, Segmented, Spinner, Toggle, cx, useToast } from '../components/ui';

/*
 * Контроль баллов: бот проверяет каждый завершённый акт по правилам и сообщает администратору,
 * если похоже, что сотрудник завышает баллы (быстро закрыл, поднял тип помещения, добавил «дорогого» вредителя,
 * сдвинул выезд на повышенный коэффициент или вечер, повторный акт по адресу, много выездов без заявки).
 */

const pts = (n?: number | null) => String(Math.round((n ?? 0) * 100) / 100).replace('.', ',');
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** Обзор: акты с замечаниями, которые ещё не разобраны, и сотрудники с систематическими признаками. */
export function GuardWidget({ onOpen }: { onOpen: (visitId: string) => void }) {
  const toast = useToast();
  const [d, setD] = useState<GuardRes | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => { api.guard().then(setD).catch(() => setD(null)); }, []);
  useEffect(() => { load(); }, [load]);
  if (!d || !d.settings.enabled) return null;
  const warn = d.stats.items.filter((s) => s.warn.length);
  async function decide(f: GuardFlag, status: 'ok' | 'fixed') {
    setBusy(f.id + status);
    try { await api.decideGuard(f.id, status); haptic.success(); toast(status === 'ok' ? 'Отмечено: всё в порядке' : 'Отмечено как нарушение'); load(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  }
  return (
    <div className="mt-4 rounded-[22px] bg-card p-4">
      <div className="flex items-center gap-3">
        <div className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', d.items.length ? 'bg-[#FF3B30]/12 text-[#D70015] dark:text-[#FF453A]' : 'bg-[#34C759]/12 text-[#248A3D] dark:text-[#30D158]')}>
          <ShieldAlert size={20} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold">Контроль баллов</div>
          <div className="text-[13px] text-muted">{d.items.length ? `не разобрано: ${d.items.length}` : 'подозрительных актов нет'}{d.stats.team_minutes ? ` · обычный выезд ~${d.stats.team_minutes} мин` : ''}</div>
        </div>
      </div>

      {warn.length > 0 && (
        <div className="mt-3 rounded-2xl bg-[#FF9500]/12 px-3.5 py-3 text-[13.5px]">
          <div className="font-semibold">Систематически</div>
          {warn.map((s) => <div key={s.id} className="mt-0.5"><b>{s.name}</b>: {s.warn.join('; ')}</div>)}
        </div>
      )}

      {d.items.length > 0 && (
        <div className="mt-3 space-y-2">
          {d.items.slice(0, 8).map((f) => (
            <div key={f.id} className="rounded-2xl bg-fill/60 p-3.5 ring-1 ring-inset ring-line">
              <button className="block w-full min-w-0 text-left" onClick={() => onOpen(f.visit_id)}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold">{f.tech_name}</div>
                    <div className="truncate text-[13px] text-muted">{[f.company_name, f.address].filter(Boolean).join(' · ')} · {when(f.finished_at)}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-dot text-[16px] font-semibold">{pts(f.points)} б</div>
                    {f.extra > 0 && <div className="text-[12px] font-semibold text-[#D70015] dark:text-[#FF453A]">≈ +{pts(f.extra)} сверх заявки</div>}
                  </div>
                </div>
                <ul className="mt-2 space-y-1 text-[13.5px] leading-snug">
                  {f.flags.map((x, i) => <li key={i}><b>{d.kinds[x.kind] || x.kind}:</b> {x.text}</li>)}
                </ul>
              </button>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="secondary" className="h-10 text-[14px]" icon={<Check size={16} strokeWidth={2} />} loading={busy === f.id + 'ok'} onClick={() => decide(f, 'ok')}>В порядке</Button>
                <Button variant="secondary" className="h-10 text-[14px] text-[#D70015] dark:text-[#FF453A]" icon={<X size={16} strokeWidth={2} />} loading={busy === f.id + 'fixed'} onClick={() => decide(f, 'fixed')}>Нарушение</Button>
              </div>
            </div>
          ))}
          {d.items.length > 8 && <div className="px-1 text-[12.5px] text-muted">Ещё {d.items.length - 8} — разберите сверху, список обновится.</div>}
          <div className="px-1 text-[12px] leading-snug text-muted">Нажмите на акт, чтобы открыть его и при необходимости исправить баллы («Баллы» → вручную). «Нарушение» — отметка для статистики сотрудника.</div>
        </div>
      )}
    </div>
  );
}

/** Настройки → «Контроль баллов». */
export function GuardSettingsPanel() {
  const toast = useToast();
  const [s, setS] = useState<GuardSettings | null>(null);
  const [minM, setMinM] = useState('');
  const [maxU, setMaxU] = useState('');
  const [hour, setHour] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    api.guard().then((r) => { setS(r.settings); setMinM(String(r.settings.min_minutes)); setMaxU(String(r.settings.max_unplanned_day)); setHour(String(r.settings.digest_hour)); })
      .catch((e: Error) => toast(e.message, 'error'));
  }, [toast]);
  if (!s) return <Spinner />;
  async function save(p: Partial<GuardSettings>, key = 'save') {
    setBusy(key);
    try { const r = await api.saveGuard(p); setS(r.settings); haptic.success(); toast('Сохранено'); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  }
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-card px-4 py-3">
        <Toggle label="Бот проверяет начисление баллов" checked={s.enabled} onChange={(v) => save({ enabled: v }, 'en')} />
      </div>
      {s.enabled && (
        <>
          <Field label="Когда сообщать администратору">
            <Segmented<'instant' | 'digest'> options={[{ id: 'instant', label: 'Сразу' }, { id: 'digest', label: 'Итог за день' }]} value={s.mode} onChange={(m) => save({ mode: m }, 'mode')} />
          </Field>
          <div className="grid grid-cols-3 items-end gap-2.5">
            <Field label="Минимум мин"><Input inputMode="numeric" value={minM} onChange={(e) => setMinM(e.target.value)} /></Field>
            <Field label="Без заявки"><Input inputMode="numeric" value={maxU} onChange={(e) => setMaxU(e.target.value)} /></Field>
            <Field label="Итог, час"><Input inputMode="numeric" value={hour} onChange={(e) => setHour(e.target.value)} /></Field>
          </div>
          <div className="-mt-1 px-1 text-[12px] leading-snug text-muted">Минимум минут от начала до завершения акта · сколько выездов без заявки в день считать нормой · во сколько присылать итог дня.</div>
          <Button loading={busy === 'save'} onClick={() => save({ min_minutes: Number(minM), max_unplanned_day: Number(maxU), digest_hour: Number(hour) })}>Сохранить</Button>
          <Button variant="secondary" icon={<ScanSearch size={18} strokeWidth={1.75} />} loading={busy === 'scan'} onClick={async () => {
            setBusy('scan');
            try { const r = await api.guardScan(); haptic.success(); toast(`Проверено актов: ${r.checked}, с замечаниями: ${r.found}`); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
          }}>Проверить акты этого месяца</Button>
        </>
      )}
      <div className="px-1 text-[12.5px] leading-snug text-muted">
        После каждого завершённого выезда бот сравнивает акт с заявкой и сообщает, если:
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>акт закрыт быстрее минимума (и без фото);</li>
          <li>тип помещения, комнаты или сотки больше, чем указал офис;</li>
          <li>добавлен вредитель с большим коэффициентом (например, клопы к тараканам);</li>
          <li>выезд начат в воскресенье / «повышенное» время, хотя заявка была на другой день или время;</li>
          <li>вечерняя надбавка при дневной заявке;</li>
          <li>второй акт по тому же адресу за сутки или много выездов без заявки за день.</li>
        </ul>
        <div className="mt-1.5">Сотрудник об этих проверках не получает сообщений. Баллы сами не меняются — решаете вы: «Всё в порядке» или «Нарушение», исправить баллы можно в акте. Раз в месяц видно, у кого замечания повторяются.</div>
      </div>
    </div>
  );
}
