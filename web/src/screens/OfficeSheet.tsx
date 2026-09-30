import { useState } from 'react';
import { AlertTriangle, CheckCircle2, MessageCircle, RotateCw, Search, Users } from 'lucide-react';
import { api } from '../api';
import { haptic } from '../telegram';
import type { OfficeChat } from '../types';
import { Button, Group, IconBadge, Input, Row, Sheet, useToast } from '../components/ui';

/** Подключение чата офиса, куда бот отправляет отчёты о выездах. */
export function OfficeSheet({ current, onClose, onSaved }: {
  current: OfficeChat | null; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [chats, setChats] = useState<OfficeChat[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'find' | 'check' | 'manual'>('');
  const [saving, setSaving] = useState('');
  const [manual, setManual] = useState(false);
  const [manualId, setManualId] = useState('');

  // Проверить, подключил ли администратор чат командой /office
  async function check() {
    setBusy('check');
    setError('');
    try {
      const res = await api.bootstrap();
      const b = { office: 'office' in res ? res.office : null };
      if (b.office && b.office.id !== current?.id) {
        haptic.success();
        toast(`Подключено: ${b.office.title}`);
        onSaved();
      } else if (b.office) {
        setError('Чат уже подключён. Чтобы сменить, отправьте /office в другой группе.');
      } else {
        setError('Бот пока не получил команду /office. Проверьте, что бот добавлен в группу, и отправьте команду ещё раз.');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function find() {
    setBusy('find');
    setError('');
    try {
      const r = await api.officeChats();
      setChats(r.items);
      if (!r.items.length) setError('Бот пока не видит групп. Удалите бота из группы и добавьте заново — группа появится в списке.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function choose(chat: OfficeChat) {
    setSaving(chat.id);
    setError('');
    try {
      await api.setOffice(chat);
      haptic.success();
      toast('Чат подключён — в него пришло тестовое сообщение');
      onSaved();
    } catch (e) {
      haptic.error();
      setError((e as Error).message);
      setSaving('');
    }
  }

  return (
    <Sheet open onClose={onClose} title="Чат офиса">
      {current && (
        <div className="-mt-2 mb-5 flex gap-3 rounded-2xl bg-[#34C759]/12 p-4 text-[15px]">
          <CheckCircle2 size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[#248A3D] dark:text-[#30D158]" />
          <div>Отчёты приходят в <b className="font-semibold">{current.title}</b></div>
        </div>
      )}

      <ol className="space-y-2.5 text-[15px] leading-relaxed">
        {[
          <>Добавьте бота в группу офиса как участника.</>,
          <>Напишите в группе команду <b className="font-semibold">/office</b> — если в группе есть темы, напишите её в той теме, куда должны приходить отчёты.</>,
          <>Бот ответит «✅ Чат подключён». Нажмите «Проверить».</>,
        ].map((t, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[13px] font-semibold text-accent-ink">{i + 1}</span>
            <span>{t}</span>
          </li>
        ))}
      </ol>

      <Button className="mt-6" loading={busy === 'check'} onClick={check} icon={<RotateCw size={18} strokeWidth={1.75} />}>
        Проверить
      </Button>

      {error && (
        <div className="mt-4 flex gap-3 rounded-2xl bg-[#FF9500]/12 p-4 text-[15px]">
          <AlertTriangle size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[#C93400] dark:text-[#FF9F0A]" />
          <div>{error}</div>
        </div>
      )}

      <div className="mt-6 border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
        <div className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-muted">Другие способы</div>
        <Button variant="plain" loading={busy === 'find'} onClick={find} icon={<Search size={18} strokeWidth={1.75} />}>
          Выбрать из групп с ботом
        </Button>
        {chats && chats.length > 0 && (
          <Group className="mt-2">
            {chats.map((c) => (
              <Row
                key={c.id}
                title={c.title}
                subtitle={c.type === 'private' ? 'Личный чат' : c.type === 'channel' ? 'Канал' : 'Группа'}
                left={<IconBadge tone={current?.id === c.id ? 'green' : 'gray'}>{c.type === 'private' ? <MessageCircle size={18} strokeWidth={1.75} /> : <Users size={18} strokeWidth={1.75} />}</IconBadge>}
                right={saving === c.id ? <span className="text-[14px] text-muted">Подключаю…</span> : undefined}
                onClick={() => choose(c)}
              />
            ))}
          </Group>
        )}
        {!manual ? (
          <Button variant="plain" onClick={() => setManual(true)}>Ввести ID чата вручную</Button>
        ) : (
          <div className="mt-2 space-y-2.5">
            <Input inputMode="numeric" placeholder="-1001234567890" value={manualId} onChange={(e) => setManualId(e.target.value.trim())} />
            <Button variant="secondary" loading={saving === manualId && !!manualId} disabled={!/^-?\d{5,}$/.test(manualId)}
              onClick={() => choose({ id: manualId, title: 'Чат офиса' })}>
              Подключить
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
