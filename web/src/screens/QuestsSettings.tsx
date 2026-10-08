import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { api } from '../api';
import { getLocation, haptic } from '../telegram';
import type { QuestsSettings } from '../types';
import { Button, Field, Input, Spinner, Toggle, useToast } from '../components/ui';

type Key = 'coffee' | 'first_ontime' | 'ontime' | 'visits' | 'photos' | 'shift';
const LIST: { id: Key; title: string; hint: string }[] = [
  { id: 'coffee', title: '☕️ Утренний кофе в офисе', hint: 'Геопозиция у офиса утром: кнопка «Я в офисе» в приложении или точка/трансляция боту' },
  { id: 'first_ontime', title: '⏱ Первую обработку начать вовремя', hint: 'Первая заявка дня со временем — начата не позже 15 минут' },
  { id: 'ontime', title: '🎯 Все обработки начать вовремя', hint: 'Все заявки дня со временем — вовремя' },
  { id: 'visits', title: '🚗 Выезды за день', hint: '3–5 выполненных выездов (по числу заявок на день)' },
  { id: 'photos', title: '📸 Фото в каждом акте', hint: 'В каждом выполненном акте есть фото' },
  { id: 'shift', title: '📍 Смена в эфире', hint: 'Часы трансляции геопозиции боту' },
];

/** Админка → «🎯 Квесты»: какие квесты дня включены, сколько опыта дают, где офис для «кофе». */
export function QuestsSettingsPanel() {
  const toast = useToast();
  const [s, setS] = useState<QuestsSettings | null>(null);
  const [xp, setXp] = useState<Record<string, string>>({});
  const [from, setFrom] = useState('07:30');
  const [to, setTo] = useState('09:30');
  const [hours, setHours] = useState('4');
  const [radius, setRadius] = useState('150');
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  function apply(r: QuestsSettings) {
    setS(r);
    setXp(Object.fromEntries(LIST.map((q) => [q.id, String(r[q.id].xp)])));
    setFrom(r.coffee.from); setTo(r.coffee.to); setHours(String(r.shift.hours)); setRadius(String(r.office.radius));
  }
  useEffect(() => { api.questsSettings().then((r) => apply(r.settings)).catch((e: Error) => toast(e.message, 'error')); }, [toast]);

  async function save(p: Record<string, unknown>, msg = 'Сохранено') {
    setBusy(true);
    try { const r = await api.saveQuestsSettings(p); apply(r.settings); haptic.success(); toast(msg); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  async function officeHere() {
    haptic.tap();
    setLocating(true);
    try {
      const pos = await getLocation();
      if (!pos) { toast('Нет доступа к геопозиции — разрешите её для Telegram', 'error'); return; }
      await save({ office: { lat: pos.lat, lon: pos.lon } }, 'Офис отмечен здесь');
    } finally { setLocating(false); }
  }

  if (!s) return <Spinner />;
  const officeSet = s.office.lat != null && s.office.lon != null;
  return (
    <div className="space-y-3">
      {LIST.map((q) => (
        <div key={q.id} className="rounded-xl bg-card p-3.5">
          <Toggle label={q.title} checked={s[q.id].on} onChange={(v) => save({ [q.id]: { on: v } })} />
          <div className="mt-1.5 px-1 text-[12.5px] leading-snug text-muted">{q.hint}</div>
          {s[q.id].on && (
            <div className="mt-3 grid grid-cols-[110px_1fr] items-end gap-2.5">
              <Field label="Опыт, XP">
                <Input inputMode="numeric" value={xp[q.id] ?? ''} onChange={(e) => setXp({ ...xp, [q.id]: e.target.value.replace(/\D/g, '') })}
                  onBlur={() => Number(xp[q.id]) !== s[q.id].xp && save({ [q.id]: { xp: Number(xp[q.id]) || 0 } })} />
              </Field>
              {q.id === 'coffee' && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="С"><Input value={from} onChange={(e) => setFrom(e.target.value)} onBlur={() => from !== s.coffee.from && save({ coffee: { from } })} className="font-mono" /></Field>
                  <Field label="До"><Input value={to} onChange={(e) => setTo(e.target.value)} onBlur={() => to !== s.coffee.to && save({ coffee: { to } })} className="font-mono" /></Field>
                </div>
              )}
              {q.id === 'shift' && (
                <Field label="Часов в эфире">
                  <Input inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value.replace(/\D/g, ''))} onBlur={() => Number(hours) !== s.shift.hours && save({ shift: { hours: Number(hours) } })} />
                </Field>
              )}
            </div>
          )}
          {q.id === 'coffee' && s.coffee.on && (
            <div className="mt-3 rounded-xl bg-fill p-3">
              <div className="text-[14px] font-semibold">Где офис</div>
              <div className="mt-0.5 text-[12.5px] leading-snug text-muted">
                {officeSet ? `Отмечен: ${s.office.lat!.toFixed(5)}, ${s.office.lon!.toFixed(5)}` : 'Не отмечен — квест сотрудникам не показывается.'}
              </div>
              <div className="mt-2.5 grid grid-cols-[1fr_110px] items-end gap-2.5">
                <Button variant="secondary" loading={locating} disabled={busy} onClick={officeHere} icon={<MapPin size={17} strokeWidth={1.75} />}>
                  {officeSet ? 'Офис здесь (обновить)' : 'Офис здесь'}
                </Button>
                <Field label="Радиус, м">
                  <Input inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value.replace(/\D/g, ''))} onBlur={() => Number(radius) !== s.office.radius && save({ office: { radius: Number(radius) } })} />
                </Field>
              </div>
              <div className="mt-2 text-[12px] leading-snug text-muted">Нажмите «Офис здесь», находясь в офисе. Засчитывается, если сотрудник в радиусе от этой точки.</div>
            </div>
          )}
        </div>
      ))}
      <p className="px-1 text-[12.5px] leading-snug text-muted">
        Квесты обновляются каждый день и видны сотрудникам во вкладке «Лига». Опыт за каждый квест начисляется один раз в день.
      </p>
    </div>
  );
}
