import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, Send, Shield, Trash2, UserPlus, UserRound, X } from 'lucide-react';
import { api } from '../api';
import { fmtDate, plural, useConfig } from '../config';
import { copyText, haptic, shareLink } from '../telegram';
import type { Invite, StaffUser } from '../types';
import {
  Button, Chips, ConfirmSheet, Field, Group, IconBadge, Input, Pill, Row, SectionTitle, Sheet, Spinner, useToast,
} from '../components/ui';

export const ROLE_RU: Record<string, string> = { admin: 'Администратор', manager: 'Менеджер', tech: 'Дезинсектор', specialist: 'Специалист' };
const ROLE_HINT: Record<string, string> = {
  tech: 'Выезжает на обработки по заявкам.',
  specialist: 'Выезжает на обработки и выполняет поручения (видео, реклама и др.) за бонусные баллы.',
  manager: 'Администратор с ограниченными правами — какие разделы ему доступны, отмечаете галочками.',
  admin: 'Полный доступ: заявки, отчёты, сотрудники, настройки. Сам не выезжает.',
};
/** Роли, которые может выдать текущий пользователь: админов и менеджеров назначает только главный администратор. */
function useRoleOptions() {
  const cfg = useConfig();
  const owner = Boolean(cfg.user.isOwner);
  return [
    { id: 'tech', label: 'Дезинсектор' }, { id: 'specialist', label: 'Специалист' },
    ...(owner && cfg.features?.managers !== false ? [{ id: 'manager', label: 'Менеджер' }] : []),
    ...(owner ? [{ id: 'admin', label: 'Админ' }] : []),
  ];
}
export const PERMS: { id: string; label: string; hint: string }[] = [
  { id: 'tasks', label: 'Заявки (обработки)', hint: 'создавать, подтверждать, отменять, команда, коэффициент' },
  { id: 'jobs', label: 'Поручения', hint: 'ставить поручения сотрудникам и менеджерам, принимать работу' },
  { id: 'media', label: 'Фото и видео', hint: 'смотреть, скачивать, оценивать' },
  { id: 'kpi', label: 'KPI, план и баллы', hint: 'план, бонусы/штрафы, баллы, соревнование, специалисты' },
  { id: 'reports', label: 'Акты и отчёты', hint: 'акты, вредители, замечания, выгрузки' },
  { id: 'staff', label: 'Сотрудники', hint: 'приглашать, блокировать, менять роли (кроме админов)' },
  { id: 'settings', label: 'Настройки', hint: 'реквизиты, печать, чат офиса, типы замечаний' },
  { id: 'audit', label: 'Журнал', hint: 'история действий' },
];
type UserPatch = { status?: string; role?: string; name?: string; reset_pin?: boolean; perms?: string[] };

/** Сотрудники: приглашения, заявки на доступ, роли, блокировка, сброс PIN. */
export function StaffPanel() {
  const cfg = useConfig();
  const toast = useToast();
  const [items, setItems] = useState<StaffUser[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [edit, setEdit] = useState<StaffUser | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [shown, setShown] = useState<Invite | null>(null);
  const [toDelete, setToDelete] = useState<StaffUser | null>(null);

  const load = useCallback(() => {
    api.users().then((r) => setItems(r.items)).catch((e: Error) => toast(e.message, 'error'));
    api.invites().then((r) => setInvites(r.items)).catch(() => {});
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function update(u: StaffUser, data: UserPatch, msg: string) {
    try {
      await api.updateUser(u.id, data);
      haptic.success();
      toast(msg);
      setEdit(null);
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  if (!items) return <Spinner />;
  const pending = items.filter((u) => u.status === 'pending');
  const active = items.filter((u) => u.status === 'active');
  const blocked = items.filter((u) => u.status === 'blocked');

  const row = (u: StaffUser) => (
    <Row
      key={u.id}
      onClick={() => setEdit(u)}
      left={<IconBadge tone={u.role === 'admin' || u.role === 'manager' ? 'blue' : 'gray'}>{u.role === 'admin' || u.role === 'manager' ? <Shield size={18} strokeWidth={1.75} /> : <UserRound size={18} strokeWidth={1.75} />}</IconBadge>}
      title={u.name}
      subtitle={`${ROLE_RU[u.role] || 'Дезинсектор'} · ${u.visits} ${plural(u.visits, ['выезд', 'выезда', 'выездов'])}${u.pin_set ? '' : ' · PIN не задан'}${u.bot_blocked ? ' · 🤖 бот не запущен' : ''}${u.id === cfg.user.id ? ' · это вы' : ''}`}
    />
  );

  return (
    <>
      <Button onClick={() => setInviteOpen(true)} icon={<UserPlus size={19} strokeWidth={1.75} />}>Пригласить сотрудника</Button>

      {invites.length > 0 && (
        <>
          <SectionTitle>Приглашения · ждут входа</SectionTitle>
          <Group>
            {invites.map((i) => (
              <Row key={i.code} onClick={() => setShown(i)} title={i.name}
                subtitle={`${ROLE_RU[i.role] || 'Дезинсектор'} · действует до ${fmtDate(i.expires_at)}`}
                left={<IconBadge tone="orange"><Link2 size={18} strokeWidth={1.75} /></IconBadge>} />
            ))}
          </Group>
        </>
      )}

      {pending.length > 0 && (
        <>
          <SectionTitle>Заявки на доступ · {pending.length}</SectionTitle>
          <div className="space-y-2.5">
            {pending.map((u) => (
              <div key={u.id} className="rounded-2xl bg-card p-4">
                <div className="text-[17px] font-semibold">{u.name}</div>
                <div className="mt-0.5 text-[14px] text-muted">
                  {[u.phone, u.username && `@${u.username}`, `заявка ${fmtDate(u.created_at)}`].filter(Boolean).join(' · ')}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button className="h-[42px] text-[15px]" onClick={() => update(u, { status: 'active' }, `${u.name}: доступ открыт`)}
                    icon={<Check size={18} strokeWidth={2} />}>Подтвердить</Button>
                  <Button className="h-[42px] text-[15px]" variant="danger" onClick={() => update(u, { status: 'blocked' }, 'Заявка отклонена')}
                    icon={<X size={18} strokeWidth={2} />}>Отклонить</Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionTitle>Сотрудники · {active.length}</SectionTitle>
      <Group>{active.map(row)}</Group>

      {blocked.length > 0 && (
        <>
          <SectionTitle>Заблокированы</SectionTitle>
          <Group>{blocked.map(row)}</Group>
        </>
      )}

      <p className="mt-5 px-1 text-[14px] leading-relaxed text-muted">
        Техник видит только свои выезды, не может открывать и скачивать акты, базу клиентов и отчёты. Администратор видит всё.
      </p>

      {edit && (
        <StaffSheet u={edit} self={edit.id === cfg.user.id} onClose={() => setEdit(null)} onUpdate={update}
          onDelete={(u2) => { setEdit(null); setToDelete(u2); }} />
      )}
      {toDelete && (
        <ConfirmSheet title={`Удалить ${toDelete.name}?`} confirmLabel="Удалить" danger
          text="Сотрудник больше не сможет войти в приложение. История его выездов, актов и баллов сохранится в отчётах и KPI."
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            try { await api.deleteUser(toDelete.id); haptic.success(); toast(`${toDelete.name} удалён(а)`); setToDelete(null); load(); }
            catch (e) { toast((e as Error).message, 'error'); }
          }} />
      )}
      {inviteOpen && (
        <InviteSheet onClose={() => setInviteOpen(false)} onCreated={(i) => { setInviteOpen(false); setShown(i); load(); }} />
      )}
      {shown && (
        <InviteLinkSheet invite={shown} onClose={() => setShown(null)}
          onRevoke={async () => { await api.deleteInvite(shown.code); setShown(null); toast('Приглашение отменено'); load(); }} />
      )}
    </>
  );
}

function InviteSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (i: Invite) => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [role, setRole] = useState('tech');
  const [busy, setBusy] = useState(false);
  const ROLE_OPTIONS = useRoleOptions();
  async function create() {
    setBusy(true);
    try {
      onCreated(await api.createInvite(name.trim(), role));
      haptic.success();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title="Приглашение">
      <p className="-mt-3 mb-6 text-[15px] leading-relaxed text-muted">
        Сотрудник откроет ссылку в Telegram и сразу получит доступ — без подтверждения. Ссылка одноразовая и действует 7 дней.
      </p>
      <div className="space-y-6">
        <Field label="Фамилия и имя">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Иванов Иван" />
        </Field>
        <Field label="Роль">
          <Chips columns={2} options={ROLE_OPTIONS} value={role} onChange={setRole} />
          <div className="mt-2 px-1 text-[12.5px] text-muted">{ROLE_HINT[role]}</div>
          {role === 'manager' && <div className="mt-1 px-1 text-[12.5px] text-muted">Права по умолчанию: заявки, фото/видео, отчёты — поменяете в карточке сотрудника после входа.</div>}
        </Field>
      </div>
      <Button className="mt-7" loading={busy} disabled={name.trim().length < 3} onClick={create}>Создать ссылку</Button>
    </Sheet>
  );
}

function InviteLinkSheet({ invite, onClose, onRevoke }: { invite: Invite; onClose: () => void; onRevoke: () => Promise<void> }) {
  const toast = useToast();
  const text = `${invite.name}, приглашение в приложение для учёта обработок. Откройте ссылку в Telegram:`;
  return (
    <Sheet open onClose={onClose} title={invite.name}>
      {invite.link ? (
        <>
          <div className="-mt-2 mb-5 break-all rounded-2xl bg-fill p-4 font-mono text-[14px]">{invite.link}</div>
          <div className="space-y-2.5">
            <Button onClick={() => shareLink(invite.link!, text)} icon={<Send size={18} strokeWidth={1.75} />}>Отправить в Telegram</Button>
            <Button variant="secondary" onClick={async () => toast((await copyText(invite.link!)) ? 'Ссылка скопирована' : 'Не удалось скопировать', 'ok')}
              icon={<Copy size={18} strokeWidth={1.75} />}>Скопировать</Button>
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-muted">
            Ссылка открывает приложение, если в @BotFather включён Main App (Bot Settings → Mini Apps → Main App) с адресом сервиса.
          </p>
        </>
      ) : (
        <p className="-mt-2 mb-5 text-[15px] text-muted">
          Не удалось определить имя бота. Код приглашения: <b className="font-mono">{invite.code}</b>
        </p>
      )}
      <Button className="mt-5" variant="plain" onClick={onRevoke}>Отменить приглашение</Button>
    </Sheet>
  );
}

function StaffSheet({ u, self, onClose, onUpdate, onDelete }: {
  u: StaffUser; self: boolean; onClose: () => void;
  onUpdate: (u: StaffUser, data: UserPatch, msg: string) => Promise<void>;
  onDelete?: (u: StaffUser) => void;
}) {
  const [name, setName] = useState(u.name);
  const cfg = useConfig();
  const [role, setRole] = useState<string>(u.role);
  const [perms, setPerms] = useState<string[]>(u.perms || ['tasks', 'jobs', 'media', 'reports']);
  const [busy, setBusy] = useState(false);
  const opts = useRoleOptions();
  const ROLE_OPTIONS = opts.some((o) => o.id === u.role) ? opts : [...opts, { id: u.role, label: ROLE_RU[u.role] || u.role }];
  const owner = Boolean(cfg.user.isOwner);
  const lockedByRole = !owner && (u.role === 'admin' || u.role === 'manager');

  async function save() {
    setBusy(true);
    await onUpdate(u, { name: name.trim(), role, ...(owner && role === 'manager' ? { perms } : {}) }, 'Сохранено');
    setBusy(false);
  }

  return (
    <Sheet open onClose={onClose} title={u.name}>
      <div className="-mt-3 mb-6 text-[15px] text-muted">
        {[u.phone, u.username && `@${u.username}`, u.last_seen && `был(а) ${fmtDate(u.last_seen)}`, `${u.visits} ${plural(u.visits, ['выезд', 'выезда', 'выездов'])}`]
          .filter(Boolean).join(' · ')}
      </div>
      <div className="space-y-6">
        <Field label="Имя в актах">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {!self && !lockedByRole && (
          <Field label="Роль">
            <Chips columns={2} options={ROLE_OPTIONS} value={role} onChange={setRole} />
            <div className="mt-2 px-1 text-[12.5px] text-muted">{ROLE_HINT[role]}</div>
          </Field>
        )}
        {lockedByRole && <div className="rounded-2xl bg-fill px-4 py-3 text-[14px] text-muted">{ROLE_RU[u.role]} — менять может только главный администратор.</div>}
        {owner && role === 'manager' && (
          <Field label="Права менеджера">
            <div className="rounded-2xl bg-card p-1.5 ring-1 ring-inset ring-line">
              {PERMS.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 active:bg-fill">
                  <input type="checkbox" className="h-5 w-5 shrink-0 accent-[#F58220]" checked={perms.includes(p.id)}
                    onChange={() => { haptic.tap(); setPerms((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id])); }} />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium">{p.label}</span>
                    <span className="block text-[12.5px] text-muted">{p.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-2 px-1 text-[12.5px] text-muted">«Обзор» с заявками менеджер видит всегда. Назначать администраторов и менять права может только главный администратор.</div>
          </Field>
        )}
        {u.status !== 'active' && <Pill tone="orange">{u.status === 'pending' ? 'Ожидает подтверждения' : 'Заблокирован'}</Pill>}
      </div>
      <div className="mt-7 space-y-2.5">
        <Button loading={busy} disabled={name.trim().length < 2} onClick={save}>Сохранить</Button>
        {u.pin_set && (
          <Button variant="secondary" onClick={() => onUpdate(u, { reset_pin: true }, 'PIN сброшен — при входе сотрудник задаст новый')}>
            Сбросить PIN-код
          </Button>
        )}
        {!self && u.status === 'active' && (
          <Button variant="danger" onClick={() => onUpdate(u, { status: 'blocked' }, `${u.name} заблокирован`)}>Заблокировать</Button>
        )}
        {!self && u.status !== 'active' && (
          <Button variant="secondary" onClick={() => onUpdate(u, { status: 'active' }, `${u.name}: доступ открыт`)}>Открыть доступ</Button>
        )}
        {!self && !lockedByRole && onDelete && (
          <Button variant="danger" icon={<Trash2 size={17} strokeWidth={1.9} />} onClick={() => onDelete(u)}>Удалить сотрудника</Button>
        )}
      </div>
    </Sheet>
  );
}
