import { useEffect, useState } from 'react';
import { api } from '../api';
import { haptic } from '../telegram';
import type { CrmSettings } from '../types';
import { Button, Chips, ConfirmSheet, Field, Input, Sheet, Spinner, Toggle, useToast } from '../components/ui';

/** Настройки → «CRM»: подключить/отключить внешнюю CRM (пока — amoCRM), домен и токен, вкл/выкл синхронизации. */
export function CrmSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<CrmSettings | null>(null);
  const [domain, setDomain] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const load = () => api.getCrm().then((r) => { setD(r); setDomain(r.amocrm.domain); }).catch((e: Error) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(patch: Partial<Parameters<typeof api.saveCrm>[0]>) {
    setBusy(true);
    try {
      await api.saveCrm(patch);
      haptic.success(); toast('Сохранено', 'ok'); setToken('');
      await load();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  if (!d) return <Sheet open onClose={onClose} title="CRM"><Spinner /></Sheet>;
  return (
    <Sheet open onClose={onClose} title="CRM">
      <p className="-mt-3 mb-5 text-[15px] leading-relaxed text-muted">
        Когда выезд по заявке успешно завершён и к ней привязан ID лида, приложение переводит сделку в CRM в статус «Успешно» и прикладывает акт (PDF). Без привязанного лида заявка просто пропускается — ошибки не будет.
      </p>
      <div className="space-y-5">
        <Field label="CRM-система">
          <Chips options={[{ id: 'none', label: 'Не подключена' }, { id: 'amocrm', label: 'amoCRM' }]}
            value={d.provider || 'none'}
            onChange={(v) => save({ provider: v === 'amocrm' ? 'amocrm' : null, enabled: v === 'amocrm' ? d.enabled : false })} />
        </Field>
        {d.provider === 'amocrm' && (
          <>
            <Field label="Домен amoCRM"><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="mycompany.amocrm.ru" onBlur={() => domain !== d.amocrm.domain && save({ amocrm: { domain } })} /></Field>
            <Field label={d.amocrm.token_set ? `Токен доступа (сохранён: ${d.amocrm.token_masked})` : 'Токен доступа (долгосрочный, приватная интеграция)'}>
              <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="вставьте новый токен, чтобы заменить" />
            </Field>
            {token.trim().length > 10 && <Button loading={busy} onClick={() => save({ amocrm: { access_token: token.trim() } })}>Сохранить токен</Button>}
            <Toggle label="Синхронизация включена" checked={d.enabled} onChange={(v) => save({ enabled: v })} />
            <div className="px-1 text-[12.5px] leading-snug text-muted">ID лида указывается в карточке заявки (поле «CRM Lead ID»). Домен и токен нигде в коде не хранятся — только здесь, в базе.</div>
            <Button variant="danger" onClick={() => setConfirmOff(true)}>Отключить и очистить настройки</Button>
          </>
        )}
      </div>
      {confirmOff && (
        <ConfirmSheet title="Отключить CRM?" confirmLabel="Отключить" danger
          text="Домен и токен будут удалены из настроек. Синхронизация выездов с CRM прекратится."
          onClose={() => setConfirmOff(false)}
          onConfirm={async () => { try { await api.disconnectCrm(); haptic.success(); toast('CRM отключена'); setConfirmOff(false); load(); } catch (e) { toast((e as Error).message, 'error'); } }} />
      )}
    </Sheet>
  );
}
