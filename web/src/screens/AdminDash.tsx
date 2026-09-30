import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { MessageSquareWarning, Repeat, Send, Trash2 } from 'lucide-react';
import { api } from '../api';
import { fmtDate, plural } from '../config';
import { haptic } from '../telegram';
import type { PestsStats, RemarksRes, StaffUser, TasksStats } from '../types';
import { Bars, Daily, Tile } from '../components/charts';
import { Button, ConfirmSheet, Field, Group, IconBadge, Pill, Row, SectionTitle, Spinner, TextArea, cx, useToast } from '../components/ui';
import { TaskRow } from './Tasks';
import { RemarkTypePicker, RemarkTypesSheet } from '../components/RemarkTypes';
import { monthName } from './Notifications';

const PALETTE = ['#F58220', '#D71921', '#34C759', '#8C8C8C', '#FFB800'];

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-2xl bg-card p-4', className)}>
      <div className="mb-3 text-[15px] font-semibold">{title}</div>
      {children}
    </div>
  );
}

/* ---------------- Дашборд заявок ---------------- */

export function TasksDash({ from, to }: { from: string; to: string }) {
  const toast = useToast();
  const [s, setS] = useState<TasksStats | null>(null);
  useEffect(() => {
    setS(null);
    api.tasksStats({ from, to }).then(setS).catch((e: Error) => toast(e.message, 'error'));
  }, [from, to, toast]);
  if (!s) return <Spinner />;

  const rate = s.total ? Math.round((s.done / s.total) * 100) : 0;
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Tile label="Заявок за период" value={s.total} />
        <Tile label="Выполнено" value={s.done} tone="green" hint={s.total ? `${rate}% от всех` : undefined} />
        <Tile label="Открыто сейчас" value={s.open_now} tone="blue" hint={`новые ${s.new} · в работе ${s.in_progress}`} />
        <Tile label="Просрочено" value={s.overdue} tone={s.overdue ? 'red' : undefined} hint="дата прошла, не начаты" />
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Tile label="Отменено" value={s.cancelled} hint={s.client_cancelled ? `из них клиентом: ${s.client_cancelled}` : undefined} />
        <Tile label="Ждут переноса" value={s.reschedule_pending} tone={s.reschedule_pending ? 'orange' : undefined} hint="клиент попросил перенести" />
        <Tile label="Среднее время закрытия" value={s.avg_hours == null ? '—' : fmtHours(s.avg_hours)} />
      </div>

      {s.daily.length > 0 && <div className="mt-2.5"><Daily days={s.daily} title="Новые заявки по дням" /></div>}

      <div className="mt-2.5 grid gap-2.5 md:grid-cols-2">
        <Card title="По специалистам">
          {s.by_tech.length === 0 ? <div className="text-[14px] text-muted">Нет данных</div> : (
            <div className="space-y-3">
              {s.by_tech.map((t) => <TechBar key={t.name} t={t} />)}
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[12px] text-muted">
                <Legend color="#34C759" label="выполнено" /><Legend color="#F58220" label="открыто" /><Legend color="#C7C7CC" label="отменено" />
              </div>
            </div>
          )}
        </Card>
        <Bars title="Вредители в заявках" items={s.by_pest} />
      </div>

      <SectionTitle>Просроченные заявки</SectionTitle>
      {s.overdue_items.length === 0 ? (
        <div className="rounded-2xl bg-card p-4 text-[15px] text-muted">Просроченных заявок нет</div>
      ) : (
        <Group>{s.overdue_items.map((t) => <TaskRow key={t.id} t={t} showTech onClick={() => {}} />)}</Group>
      )}
    </>
  );
}

const fmtHours = (h: number) => (h < 1 ? `${Math.round(h * 60)} мин` : h < 48 ? `${h} ч` : `${Math.round(h / 24)} дн`);

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</span>;
}

function TechBar({ t }: { t: TasksStats['by_tech'][number] }) {
  const pct = (n: number) => `${t.total ? (n / t.total) * 100 : 0}%`;
  return (
    <div>
      <div className="mb-1 flex justify-between gap-3 text-[14px]">
        <span className="truncate">{t.name}</span>
        <span className="tabular-nums text-muted"><b className="font-semibold text-ink dark:text-white">{t.done}</b> / {t.total}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
        <div className="h-full bg-[#34C759]" style={{ width: pct(t.done) }} />
        <div className="h-full bg-accent" style={{ width: pct(t.open) }} />
        <div className="h-full bg-[#C7C7CC] dark:bg-[#48484A]" style={{ width: pct(t.cancelled) }} />
      </div>
    </div>
  );
}

/* ---------------- Дашборд вредителей ---------------- */

export function PestsDash({ from, to }: { from: string; to: string }) {
  const toast = useToast();
  const [s, setS] = useState<PestsStats | null>(null);
  useEffect(() => {
    setS(null);
    api.pestsStats({ from, to }).then(setS).catch((e: Error) => toast(e.message, 'error'));
  }, [from, to, toast]);
  if (!s) return <Spinner />;

  const top = s.pests[0];
  const high = s.pests.reduce((n, p) => n + p.high, 0);
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Tile label="Выполненных выездов" value={s.visits} />
        <Tile label="Чаще всего" value={top ? top.name : '—'} hint={top ? `${top.share}% случаев` : undefined} />
        <Tile label="Высокая заселённость" value={high} tone={high ? 'red' : undefined} hint="случаев за период" />
        <Tile label="Повторные объекты" value={s.repeat_objects.length} tone={s.repeat_objects.length ? 'orange' : undefined} hint="2+ выезда с вредителями" />
      </div>

      <div className="mt-2.5 grid gap-2.5 md:grid-cols-2">
        <Card title="Вредители">
          {s.pests.length === 0 ? <div className="text-[14px] text-muted">В актах за период вредители не отмечены</div> : (
            <div className="space-y-3">
              {s.pests.map((p, i) => (
                <div key={p.name}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-[14px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                      <span className="truncate">{p.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums"><b className="font-semibold">{p.n}</b> <span className="text-muted">· {p.share}%</span></span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
                    <div className="h-full rounded-full" style={{ width: `${p.share}%`, background: PALETTE[i % PALETTE.length] }} />
                  </div>
                  <div className="mt-1 text-[12px] text-muted">
                    {p.objects} {plural(p.objects, ['объект', 'объекта', 'объектов'])}{p.high ? ` · высокая заселённость: ${p.high}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Динамика за 6 месяцев">
          <Trend s={s} />
        </Card>
      </div>

      <div className="mt-2.5 grid gap-2.5 md:grid-cols-2">
        <Bars title="По обработкам" items={s.by_procedure} />
        <Card title="Активность в ловушках">
          {s.traps.length === 0 ? <div className="text-[14px] text-muted">Активности в ловушках не зафиксировано</div> : (
            <div className="space-y-2">
              {s.traps.map((t) => (
                <div key={t.name} className="flex justify-between text-[14px]">
                  <span className="truncate">{t.name}</span>
                  <span className="tabular-nums text-muted"><b className="font-semibold text-ink dark:text-white">{t.count}</b> особей · {t.n} {plural(t.n, ['ловушка', 'ловушки', 'ловушек'])}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <SectionTitle>Повторные объекты</SectionTitle>
      {s.repeat_objects.length === 0 ? (
        <div className="rounded-2xl bg-card p-4 text-[15px] text-muted">Повторных обращений за период нет</div>
      ) : (
        <Group>
          {s.repeat_objects.map((o) => (
            <Row key={`${o.company_name}|${o.address}`} chevron={false}
              left={<IconBadge tone="orange"><Repeat size={18} strokeWidth={1.75} /></IconBadge>}
              title={o.company_name}
              subtitle={<><div className="truncate">{o.address}</div><div className="mt-0.5 truncate">{o.pests.join(', ')} · последний {fmtDate(o.last)}</div></>}
              right={<Pill tone="orange">{o.n}×</Pill>} />
          ))}
        </Group>
      )}
    </>
  );
}

function Trend({ s }: { s: PestsStats }) {
  const keys = s.trend_keys;
  if (!keys.length) return <div className="text-[14px] text-muted">Нет данных</div>;
  const totals = s.trend.map((m) => keys.reduce((n, k) => n + Number(m[k] || 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <>
      <div className="flex h-32 items-end gap-2">
        {s.trend.map((m, i) => (
          <div key={String(m.month)} className="flex h-full flex-1 flex-col items-center justify-end">
            <div className="mb-1 text-[11px] tabular-nums text-muted">{totals[i] || ''}</div>
            <div className="flex w-full max-w-[36px] flex-col-reverse overflow-hidden rounded-t-[4px]"
              style={{ height: totals[i] ? `${(totals[i] / max) * 100}%` : '3px' }}>
              {totals[i] ? keys.map((k, j) => (
                <div key={k} style={{ height: `${(Number(m[k] || 0) / totals[i]) * 100}%`, background: PALETTE[j % PALETTE.length] }} />
              )) : <div className="h-full bg-black/[0.06] dark:bg-white/10" />}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        {s.trend.map((m) => <div key={String(m.month)} className="flex-1 text-center text-[12px] text-muted">{String(m.month).replace('.', '')}</div>)}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {keys.map((k, j) => <Legend key={k} color={PALETTE[j % PALETTE.length]} label={k} />)}
      </div>
    </>
  );
}

/* ---------------- Замечания техникам ---------------- */

export function RemarksPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const toast = useToast();
  const [data, setData] = useState<RemarksRes | null>(null);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [tech, setTech] = useState('');
  const [text, setText] = useState('');
  const [type, setType] = useState('');
  const [typesOpen, setTypesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<string | null>(null);

  const load = useCallback(() => {
    api.remarks().then(setData).catch((e: Error) => toast(e.message, 'error'));
  }, [toast]);
  useEffect(() => {
    load();
    api.users().then((r) => setStaff(r.items.filter((u) => u.status === 'active' && u.role !== 'admin'))).catch(() => {});
  }, [load]);

  async function send() {
    setBusy(true);
    try {
      const r = await api.addRemark({ tech_id: tech, text: text.trim(), type });
      haptic.success();
      toast(`Замечание отправлено: ${r.tech}`);
      setText('');
      setType('');
      load();
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="grid gap-2.5 md:grid-cols-[1fr_1fr]">
        <Card title="Новое замечание">
          <div className="space-y-4">
            <Field label="Сотрудник">
              <div className="flex flex-wrap gap-2">
                {staff.map((u) => (
                  <button key={u.id} onClick={() => { haptic.tap(); setTech(u.id); }}
                    className={cx('h-9 rounded-full px-4 text-[14px] font-medium transition',
                      tech === u.id ? 'bg-accent text-black' : 'bg-card text-ink ring-1 ring-inset ring-line')}>
                    {u.name}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Тип замечания">
              <RemarkTypePicker types={data?.types ?? []} value={type} onChange={setType} />
              <button onClick={() => setTypesOpen(true)} className="mt-2 px-1 text-[13px] text-accent-ink">Изменить типы и штрафы →</button>
            </Field>
            <Field label={type ? 'Комментарий (необязательно)' : 'Текст'}>
              <TextArea rows={3} placeholder="Например: в акте нет фото подготовки помещения" value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <Button loading={busy} disabled={!tech || (!type && text.trim().length < 3)} onClick={send} icon={<Send size={18} strokeWidth={1.75} />}>
              Отправить технику
            </Button>
            <p className="text-[13px] leading-snug text-muted">
              Придёт в панель уведомлений и в личку от бота. Ещё проще — ответить (reply) на PDF-акт в чате офиса: текст ответа станет замечанием автору акта.
            </p>
          </div>
        </Card>

        <Card title={data ? `${monthName(data.month_start)} · по сотрудникам` : 'По сотрудникам'}>
          {!data ? <Spinner /> : data.by_tech.length === 0 ? (
            <div className="text-[14px] text-muted">В этом месяце замечаний нет</div>
          ) : (
            <div className="space-y-2">
              {data.by_tech.map((b) => (
                <div key={b.name} className="flex items-center justify-between text-[15px]">
                  <span className="truncate">{b.name}</span>
                  <Pill tone={b.n >= 3 ? 'red' : 'orange'}>{b.n}</Pill>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 text-[12px] text-muted">Счётчик и панель техника обнуляются 1-го числа каждого месяца.</div>
        </Card>
      </div>

      <SectionTitle>Замечания за месяц{data?.items.length ? ` · ${data.items.length}` : ''}</SectionTitle>
      {!data ? <Spinner /> : data.items.length === 0 ? (
        <div className="rounded-2xl bg-card p-4 text-[15px] text-muted">Пока пусто</div>
      ) : (
        <div className="space-y-2.5">
          {data.items.map((r) => (
            <div key={r.id} className="flex gap-3 rounded-2xl bg-card p-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FF9500]/15 text-[#C93400] dark:text-[#FF9F0A]">
                <MessageSquareWarning size={18} strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="truncate text-[15px] font-semibold">{r.tech_name || r.tech_id}</div>
                  <div className="shrink-0 text-[12px] text-muted">{fmtDate(r.created_at)}</div>
                </div>
                <div className="mt-1 whitespace-pre-line break-words text-[15px] leading-snug">{r.text}</div>
                {r.points ? <div className="mt-1 font-dot text-[13px] text-[#D70015] dark:text-[#FF453A]">−{String(r.points).replace('.', ',')} балл. в KPI</div> : null}
                <div className="mt-1.5 flex items-center gap-3 text-[13px] text-muted">
                  <span>— {r.author || 'Офис'}</span>
                  <span className={r.read ? '' : 'text-accent-ink'}>{r.read ? 'прочитано' : 'не прочитано'}</span>
                  {r.visit_id && <button className="text-accent-ink" onClick={() => onOpen(r.visit_id!)}>Открыть акт</button>}
                  <button className="ml-auto text-[#D70015] dark:text-[#FF453A]" aria-label="Удалить" onClick={() => setDel(r.id)}>
                    <Trash2 size={16} strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {typesOpen && data && <RemarkTypesSheet types={data.types ?? []} onClose={() => setTypesOpen(false)} onSaved={() => { setTypesOpen(false); load(); }} />}
      {del && (
        <ConfirmSheet title="Удалить замечание?" text="Оно исчезнет из панели техника и из счётчика месяца; снятые за него баллы вернутся." confirmLabel="Удалить"
          onClose={() => setDel(null)}
          onConfirm={async () => {
            try { await api.deleteRemark(del); load(); } catch (e) { toast((e as Error).message, 'error'); }
            setDel(null);
          }} />
      )}
    </>
  );
}
