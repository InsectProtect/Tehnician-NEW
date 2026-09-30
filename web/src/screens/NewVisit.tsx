import { useEffect, useState } from 'react';
import { Bug, Building2, Check, ClipboardList, Droplets, MapPin, Plus, Search, Target, User } from 'lucide-react';
import { api } from '../api';
import { AddressFields, joinAddress } from '../components/AddressFields';
import { plural, useConfig } from '../config';
import { haptic, useBackButton } from '../telegram';
import type { Company, SiteObject } from '../types';
import {
  Button, Empty, Field, Group, IconBadge, Input, LargeTitle, Row, MultiChips, Screen, SectionTitle, Sheet, Spinner, TextArea, cx, useToast,
} from '../components/ui';

const PROC_META: Record<string, { icon: typeof Bug; hint: string }> = {
  'Дезинсекция': { icon: Bug, hint: 'Насекомые · оценка заселённости и фотофиксация' },
  'Дератизация': { icon: Target, hint: 'Грызуны · контроль ловушек по QR' },
  'Дезинфекция': { icon: Droplets, hint: 'Обработка помещений и поверхностей' },
};

type Kind = 'company' | 'individual';
type Step = 'kind' | 'company' | 'object' | 'person' | 'procedure';

export function NewVisit({ onBack, onCreated }: { onBack: () => void; onCreated: (id: string) => void }) {
  const cfg = useConfig();
  const toast = useToast();
  const [kind, setKind] = useState<Kind | null>(null);
  const [step, setStep] = useState<Step>('kind');
  const [company, setCompany] = useState<Company | null>(null);
  const [object, setObject] = useState<SiteObject | null>(null);
  const [procedure, setProcedure] = useState('');
  const [reason, setReason] = useState('');
  const [pests, setPests] = useState<string[]>([]);
  const [premises, setPremises] = useState<string[]>([]);
  const [rooms, setRooms] = useState(0);
  const [busy, setBusy] = useState(false);
  const needsApproval = !cfg.isAdmin;
  const pestOptions = cfg.pestsByProcedure?.[procedure] ?? [];
  const ready = Boolean(procedure)
    && (!pestOptions.length || pests.length > 0)
    && (procedure === 'Дератизация' || premises.length > 0)
    && (!premises.includes('living') || rooms > 0);

  const flow: Step[] = kind === 'individual' ? ['kind', 'person', 'procedure'] : ['kind', 'company', 'object', 'procedure'];
  const idx = flow.indexOf(step);
  const back = () => (idx > 0 ? setStep(flow[idx - 1]) : onBack());
  useBackButton(back);
  useEffect(() => { window.scrollTo(0, 0); }, [step]);

  async function start() {
    if (!object || !procedure) return;
    setBusy(true);
    try {
      const { id, approval } = await api.createVisit(object.id, procedure, {
        reason: reason.trim(), pests, premises, rooms: premises.includes('living') ? rooms : undefined,
      });
      haptic.success();
      if (approval === 'pending') toast('Запрос отправлен администратору');
      onCreated(id);
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  const meta: Record<Step, { label: string; title: string; subtitle: string }> = {
    kind: { label: 'Клиент', title: 'Кто клиент?', subtitle: 'От этого зависит акт: реквизиты юрлица или данные физлица' },
    company: { label: 'Юрлицо', title: 'Выберите юрлицо', subtitle: cfg.amo ? 'Компании из amoCRM' : 'Поиск по базе клиентов' },
    object: { label: 'Адрес', title: company?.name ?? '', subtitle: 'Выберите адрес объекта' },
    person: { label: 'Физлицо', title: 'Данные клиента', subtitle: 'Попадут в акт как Beneficiar — persoană fizică' },
    procedure: { label: 'Обработка', title: 'Что обрабатываем', subtitle: object ? `${company?.name ?? ''} · ${object.address}` : '' },
  };

  return (
    <Screen>
      <div className="mb-5 flex gap-1.5">
        {flow.map((s, i) => (
          <div key={s} className={cx('h-1 flex-1 rounded-full transition', i <= idx ? 'bg-accent' : 'bg-black/10 dark:bg-white/15')} />
        ))}
      </div>
      <LargeTitle eyebrow={`Выезд без заявки · шаг ${idx + 1} из ${flow.length}`} title={meta[step].title} subtitle={meta[step].subtitle} onBack={back} />

      {step === 'kind' && (
        <div className="space-y-2.5">
          {([
            { id: 'company', icon: Building2, title: 'Юрлицо', hint: 'SRL, ÎI, организация — из базы клиентов, с реквизитами и представителем' },
            { id: 'individual', icon: User, title: 'Физлицо', hint: 'Частный клиент — ФИО, телефон и адрес' },
          ] as const).map((k) => (
            <button key={k.id} onClick={() => { haptic.tap(); setKind(k.id); setCompany(null); setObject(null); setStep(k.id === 'company' ? 'company' : 'person'); }}
              className="flex w-full items-center gap-4 rounded-[22px] bg-card p-4 text-left active:opacity-70">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
                <k.icon size={22} strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[17px] font-semibold">{k.title}</div>
                <div className="mt-0.5 text-[13.5px] leading-snug text-muted">{k.hint}</div>
              </div>
            </button>
          ))}
          {needsApproval && (
            <p className="px-1 pt-2 text-[13px] leading-snug text-muted">
              Выезд без заявки подтверждает администратор. После подтверждения придёт уведомление, и можно будет работать.
            </p>
          )}
        </div>
      )}

      {step === 'company' && (
        <CompanyStep onSelect={(c) => { haptic.tap(); setCompany(c); setObject(null); setStep('object'); }} />
      )}

      {step === 'object' && company && (
        <ObjectStep company={company} onSelect={(o) => { haptic.tap(); setObject(o); setStep('procedure'); }} />
      )}

      {step === 'person' && (
        <PersonStep onDone={(c) => { haptic.tap(); setCompany(c); setObject(c.object); setStep('procedure'); }} />
      )}

      {step === 'procedure' && (
        <>
          <div className="space-y-2.5">
            {cfg.procedures.map((p) => {
              const m = PROC_META[p];
              const Icon = m?.icon ?? ClipboardList;
              const on = procedure === p;
              return (
                <button
                  key={p}
                  onClick={() => { haptic.tap(); setProcedure(p); setPests([]); }}
                  className={cx('flex w-full items-center gap-4 rounded-2xl p-4 text-left transition', on ? 'bg-accent text-black' : 'bg-card active:opacity-70')}
                >
                  <div className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', on ? 'bg-black/10' : 'bg-accent/10 text-accent-ink')}>
                    <Icon size={22} strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[17px] font-semibold">{p}</div>
                    {m && <div className={cx('mt-0.5 text-[14px]', on ? 'text-black/70' : 'text-muted')}>{m.hint}</div>}
                  </div>
                  {on && <Check size={22} strokeWidth={2.25} />}
                </button>
              );
            })}
          </div>
          {procedure && pestOptions.length > 0 && (
            <div className="mt-6">
              <Field label="Вредители">
                <MultiChips options={pestOptions} value={pests} onChange={(v) => { haptic.tap(); setPests(v); }} columns={pestOptions.length > 4 ? 3 : 2} />
              </Field>
            </div>
          )}
          {procedure && procedure !== 'Дератизация' && (
            <div className="mt-6">
              <Field label="Тип помещения">
                <MultiChips options={cfg.premises.map((p) => p.label)} value={premises.map((id) => cfg.premises.find((p) => p.id === id)?.label ?? id)}
                  onChange={(labels) => { haptic.tap(); setPremises(labels.map((l) => cfg.premises.find((p) => p.label === l)?.id ?? l)); }} />
              </Field>
            </div>
          )}
          {premises.includes('living') && (
            <div className="mt-6">
              <Field label="Количество комнат">
                <div className="grid grid-cols-6 gap-2">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button key={n} onClick={() => { haptic.tap(); setRooms(n); }}
                      className={cx('h-[50px] rounded-2xl font-dot text-[20px] transition', rooms === n ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>
                      {n === 6 ? '6+' : n}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          )}
          {needsApproval && procedure && (
            <div className="mt-6">
              <Field label="Почему без заявки">
                <TextArea rows={2} placeholder="Например: клиент позвонил напрямую, повторный выезд" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
          )}
          <Button className="mt-6" disabled={!ready} loading={busy} onClick={start}>
            {needsApproval ? 'Запросить подтверждение' : 'Начать выезд'}
          </Button>
          {needsApproval && procedure && (
            <p className="mt-3 text-center text-[13px] leading-snug text-muted">
              Администратор получит запрос. После одобрения создастся заявка, и выезд откроется.
            </p>
          )}
        </>
      )}
    </Screen>
  );
}

function PersonStep({ onDone }: { onDone: (c: Company & { object: SiteObject }) => void }) {
  const toast = useToast();
  const [fio, setFio] = useState('');
  const [phone, setPhone] = useState('');
  const [addr, setAddr] = useState({ city: '', street: '' });
  const [busy, setBusy] = useState(false);
  const ok = phone.replace(/\D/g, '').length >= 8 && addr.street.trim().length >= 3;

  async function save() {
    setBusy(true);
    try {
      onDone(await api.createIndividual({ contact: fio.trim(), phone: phone.trim(), city: addr.city.trim(), street: addr.street.trim() }));
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <>
      <div className="space-y-5">
        <Field label="ФИО клиента">
          <Input placeholder="Ion Popescu" value={fio} onChange={(e) => setFio(e.target.value)} />
        </Field>
        <Field label="Телефон">
          <Input inputMode="tel" placeholder="069 123 456" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <AddressFields city={addr.city} street={addr.street} onChange={setAddr} />
      </div>
      <Button className="mt-7" disabled={!ok} loading={busy} onClick={save}>Далее</Button>
    </>
  );
}

function CompanyStep({ onSelect }: { onSelect: (c: Company) => void }) {
  const cfg = useConfig();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Company[] | null>(null);

  useEffect(() => {
    let alive = true;
    setItems(null);
    const t = setTimeout(() => {
      api.companies(q.trim())
        .then((r) => alive && setItems(r.items))
        .catch((e: Error) => {
          if (!alive) return;
          toast(e.message, 'error');
          setItems([]);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, toast]);

  return (
    <>
      <Input
        icon={<Search size={18} strokeWidth={1.75} />}
        placeholder="Название, ИНН или телефон"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        enterKeyHint="search"
      />
      <div className="mt-4">
        {!items ? (
          <Spinner />
        ) : items.length === 0 ? (
          <Empty icon={<Building2 size={44} strokeWidth={1.25} />} title="Ничего не найдено"
            text={cfg.amo ? 'Проверьте название или создайте компанию в amoCRM.' : 'Проверьте название или добавьте нового клиента.'} />
        ) : (
          <Group>
            {items.map((c) => (
              <Row
                key={c.id}
                title={c.name}
                subtitle={c.addresses.length > 1 ? `${c.addresses.length} ${plural(c.addresses.length, ['адрес', 'адреса', 'адресов'])}` : c.addresses[0] || 'Адрес не указан'}
                left={<IconBadge><Building2 size={18} strokeWidth={1.75} /></IconBadge>}
                onClick={() => onSelect(c)}
              />
            ))}
          </Group>
        )}
        {!cfg.amo && items && (
          <Button className="mt-3" variant="plain" onClick={() => setCreating(true)} icon={<Plus size={19} strokeWidth={2} />}>
            Новый клиент
          </Button>
        )}
      </div>
      {creating && <NewClientSheet initial={q} onClose={() => setCreating(false)} onCreated={onSelect} />}
    </>
  );
}

function NewClientSheet({ initial, onClose, onCreated }: { initial: string; onClose: () => void; onCreated: (c: Company) => void }) {
  const toast = useToast();
  const [name, setName] = useState(initial);
  const [inn, setInn] = useState('');
  const [legal, setLegal] = useState('');
  const [rep, setRep] = useState('');
  const [func, setFunc] = useState('Administrator');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      onCreated(await api.createClient({ name: name.trim(), inn, legal_address: legal.trim(), contact: rep.trim(), rep_function: func.trim() }));
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Новый клиент">
      <div className="space-y-5">
        <Field label="Юрлицо (Denumirea)">
          <Input placeholder="SRL «Название»" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Cod fiscal / ИНН">
          <Input inputMode="numeric" placeholder="13 цифр" value={inn} onChange={(e) => setInn(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Юридический адрес">
          <Input placeholder="mun. Chișinău, str. …" value={legal} onChange={(e) => setLegal(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Представитель">
            <Input placeholder="ФИО" value={rep} onChange={(e) => setRep(e.target.value)} />
          </Field>
          <Field label="Должность">
            <Input value={func} onChange={(e) => setFunc(e.target.value)} />
          </Field>
        </div>
      </div>
      <Button className="mt-7" loading={busy} disabled={name.trim().length < 2} onClick={save}>Добавить и выбрать адрес</Button>
    </Sheet>
  );
}

function ObjectStep({ company, onSelect }: { company: Company; onSelect: (o: SiteObject) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<SiteObject[] | null>(null);
  const [addr, setAddr] = useState({ city: '', street: '' });
  const address = joinAddress(addr.city, addr.street);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.objects(company.id)
      .then((r) => setItems(r.items))
      .catch((e: Error) => {
        toast(e.message, 'error');
        setItems([]);
      });
  }, [company.id, toast]);

  async function add() {
    if (address.trim().length < 3) return;
    setAdding(true);
    try {
      const o = await api.addObject(company.id, company.name, address.trim());
      onSelect(o);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setAdding(false);
    }
  }

  if (!items) return <Spinner />;

  return (
    <>
      {items.length > 0 ? (
        <Group>
          {items.map((o) => (
            <Row
              key={o.id}
              title={o.address}
              subtitle={o.traps ? `${o.traps} ${plural(o.traps, ['ловушка', 'ловушки', 'ловушек'])}` : 'Ловушки ещё не привязаны'}
              left={<IconBadge><MapPin size={18} strokeWidth={1.75} /></IconBadge>}
              onClick={() => onSelect(o)}
            />
          ))}
        </Group>
      ) : (
        <div className="rounded-2xl bg-card p-4 text-[15px] text-muted">
          У юрлица пока нет адресов. Добавьте адрес объекта ниже.
        </div>
      )}

      <SectionTitle>Другой адрес</SectionTitle>
      <div className="space-y-3">
        <AddressFields city={addr.city} street={addr.street} onChange={setAddr} />
        <Button variant="secondary" onClick={add} loading={adding} disabled={addr.street.trim().length < 3} icon={<Plus size={20} strokeWidth={2} />}>
          Добавить адрес
        </Button>
      </div>
    </>
  );
}
