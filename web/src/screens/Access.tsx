import { useState } from 'react';
import { Clock, Lock, RotateCw, UserPlus } from 'lucide-react';
import { api } from '../api';
import { haptic } from '../telegram';
import type { User } from '../types';
import { Button, Field, Input, LargeTitle, Screen, useToast } from '../components/ui';

/** Экран для нового сотрудника: заявка на доступ и ожидание подтверждения. */
export function AccessScreen({ user, onRefresh }: { user: User; onRefresh: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState(user.name || user.tg_name);
  const [phone, setPhone] = useState(user.phone);
  const [sent, setSent] = useState(Boolean(user.phone));
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  if (user.status === 'blocked') {
    return (
      <Screen>
        <div className="flex min-h-[70dvh] flex-col items-center justify-center px-4 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-fill text-muted">
            <Lock size={30} strokeWidth={1.5} />
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight">Доступ закрыт</h1>
          <p className="mt-2 max-w-xs text-[16px] text-muted">Обратитесь к администратору, если это ошибка.</p>
        </div>
      </Screen>
    );
  }

  async function submit() {
    setBusy(true);
    try {
      await api.requestAccess(name.trim(), phone.trim());
      haptic.success();
      setSent(true);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setChecking(true);
    await onRefresh();
    setChecking(false);
  }

  if (sent) {
    return (
      <Screen>
        <div className="flex min-h-[70dvh] flex-col items-center justify-center px-4 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-accent-ink">
            <Clock size={30} strokeWidth={1.5} />
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight">Заявка отправлена</h1>
          <p className="mt-2 max-w-xs text-[16px] leading-relaxed text-muted">
            Администратор получил уведомление. Как только он подтвердит доступ, бот пришлёт сообщение.
          </p>
          <div className="mt-8 w-full max-w-xs">
            <Button variant="secondary" loading={checking} onClick={check} icon={<RotateCw size={18} strokeWidth={1.75} />}>
              Проверить статус
            </Button>
          </div>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <LargeTitle title="Добро пожаловать" subtitle="Чтобы начать работу, отправьте заявку на доступ администратору." />
      <div className="space-y-6">
        <Field label="Фамилия и имя">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Иванов Иван" autoComplete="name" />
        </Field>
        <Field label="Телефон">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 900 000-00-00" inputMode="tel" autoComplete="tel" />
        </Field>
      </div>
      <Button className="mt-8" loading={busy} disabled={name.trim().length < 3} onClick={submit} icon={<UserPlus size={19} strokeWidth={1.75} />}>
        Отправить заявку
      </Button>
    </Screen>
  );
}
