import { useEffect, useState, type ReactNode } from 'react';
import { Copy, RefreshCw, Zap } from 'lucide-react';
import { api } from '../api';
import { copyText, haptic } from '../telegram';
import type { CrmProvider, CrmSettings } from '../types';
import { Button, Chips, ConfirmSheet, Field, Input, Sheet, Spinner, Toggle, useToast } from '../components/ui';

const PROVIDERS: { id: CrmProvider | 'none'; label: string }[] = [
  { id: 'none', label: 'Не подключена' },
  { id: 'amocrm', label: 'amoCRM' },
  { id: 'bitrix24', label: 'Bitrix24' },
  { id: 'webhook', label: 'Любая CRM (вебхук)' },
];

const INBOUND_EXAMPLE = `{
  "address": "mun. Chișinău, str. Ismail 33",
  "company": "SRL Beta",
  "phone": "+373 69 000 000",
  "date": "2026-10-09", "time": "10:00",
  "procedure": "Дератизация",
  "pests": ["мыши"],
  "comment": "вход со двора",
  "lead_id": "12345",
  "tech": "Radu"
}`;

/** Настройки → «CRM»: amoCRM, Bitrix24 или любая CRM через вебхук; входящий вебхук — заявки из CRM. */
export function CrmSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<CrmSettings | null>(null);
  const [domain, setDomain] = useState('');
  const [token, setToken] = useState('');
  const [bxUrl, setBxUrl] = useState('');
  const [bxStage, setBxStage] = useState('WON');
  const [hookUrl, setHookUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const load = () => api.getCrm().then((r) => {
    setD(r); setDomain(r.amocrm.domain); setBxStage(r.bitrix24.won_stage || 'WON'); setHookUrl(r.webhook.url);
  }).catch((e: Error) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(patch: Parameters<typeof api.saveCrm>[0], msg = 'Сохранено') {
    setBusy(true);
    try {
      await api.saveCrm(patch);
      haptic.success(); toast(msg, 'ok'); setToken(''); setBxUrl('');
      await load();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  async function test() {
    setTesting(true);
    try {
      const r = await api.testCrm();
      if (r.ok) haptic.success(); else haptic.error();
      toast(r.message, r.ok ? 'ok' : 'error');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setTesting(false); }
  }

  async function copy(text: string, what: string) {
    haptic.tap();
    toast(await copyText(text) ? `${what} скопирован` : text);
  }

  if (!d) return <Sheet open onClose={onClose} title="CRM"><Spinner /></Sheet>;
  const ready = d.provider === 'amocrm' ? d.amocrm.token_set && Boolean(d.amocrm.domain)
    : d.provider === 'bitrix24' ? d.bitrix24.url_set
      : d.provider === 'webhook' ? Boolean(d.webhook.url) : false;

  return (
    <Sheet open onClose={onClose} title="CRM">
      <p className="-mt-3 mb-5 text-[15px] leading-relaxed text-muted">
        Когда выезд по заявке завершён, приложение сообщает об этом в вашу CRM: сделка → «Успешно», акт (PDF) прикладывается.
        Обратно — CRM может сама создавать заявки (входящий вебхук внизу).
      </p>
      <div className="space-y-5">
        <Field label="CRM-система">
          <Chips options={PROVIDERS} value={d.provider || 'none'}
            onChange={(v) => save({ provider: v === 'none' ? null : (v as CrmProvider), enabled: v === 'none' ? false : d.enabled })} />
        </Field>

        {d.provider === 'amocrm' && (
          <>
            <Field label="Домен amoCRM"><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="mycompany.amocrm.ru" onBlur={() => domain !== d.amocrm.domain && save({ amocrm: { domain } })} /></Field>
            <Field label={d.amocrm.token_set ? `Токен доступа (сохранён: ${d.amocrm.token_masked})` : 'Токен доступа (долгосрочный, приватная интеграция)'}>
              <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="вставьте новый токен, чтобы заменить" />
            </Field>
            {token.trim().length > 10 && <Button loading={busy} onClick={() => save({ amocrm: { access_token: token.trim() } })}>Сохранить токен</Button>}
            <Hint>ID сделки указывается в карточке заявки (поле «ID сделки в CRM»). Без него заявка в amoCRM не уходит.</Hint>
          </>
        )}

        {d.provider === 'bitrix24' && (
          <>
            <Field label={d.bitrix24.url_set ? `Входящий вебхук Bitrix24 (сохранён: ${d.bitrix24.url_masked})` : 'Входящий вебхук Bitrix24'}>
              <Input value={bxUrl} onChange={(e) => setBxUrl(e.target.value)} placeholder="https://xxx.bitrix24.ru/rest/1/код/" />
            </Field>
            {bxUrl.trim().length > 20 && <Button loading={busy} onClick={() => save({ bitrix24: { webhook_url: bxUrl.trim() } })}>Сохранить адрес</Button>}
            <Field label="Стадия «Сделка успешна»">
              <Input value={bxStage} onChange={(e) => setBxStage(e.target.value)} placeholder="WON" className="font-mono"
                onBlur={() => bxStage !== d.bitrix24.won_stage && save({ bitrix24: { won_stage: bxStage.trim() || 'WON' } })} />
            </Field>
            <Hint>
              В Bitrix24: Разработчикам → Другое → Входящий вебхук, права «CRM». Для основной воронки стадия — WON, для другой — вида C2:WON.
              ID сделки указывается в карточке заявки.
            </Hint>
          </>
        )}

        {d.provider === 'webhook' && (
          <>
            <Field label="Адрес, куда отправлять события">
              <Input value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} placeholder="https://hook.eu1.make.com/…"
                onBlur={() => hookUrl !== d.webhook.url && save({ webhook: { url: hookUrl.trim() } })} />
            </Field>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-3">
              <div className="min-w-0">
                <div className="text-[15px] font-medium">Секрет подписи</div>
                <div className="mt-0.5 font-mono text-[12.5px] text-muted">{d.webhook.secret_set ? d.webhook.secret_masked : 'не задан — подписи нет'}</div>
              </div>
              <button disabled={busy} onClick={() => save({ webhook: { new_secret: true } }, 'Новый секрет создан')}
                className="shrink-0 rounded-full bg-fill px-3.5 py-2 text-[13.5px] font-medium active:opacity-70">{d.webhook.secret_set ? 'Заменить' : 'Создать'}</button>
            </div>
            <Toggle label="Прикладывать PDF акта в запрос" checked={d.webhook.include_pdf} onChange={(v) => save({ webhook: { include_pdf: v } })} />
            <Hint>
              Подходит для любой CRM: Pipedrive, HubSpot, Zoho, 1С, Google Таблицы — напрямую или через Make, Zapier, n8n.
              После каждой выполненной заявки приходит POST с событием <b>visit.done</b>: номер заявки, клиент, адрес, телефон, оплата, ID сделки (если указан) и ссылка на акт PDF (30 дней).
              Подпись — заголовок X-InsectProtect-Signature: sha256=HMAC(секрет, тело).
            </Hint>
          </>
        )}

        {d.provider && (
          <>
            <Toggle label="Синхронизация включена" checked={d.enabled} onChange={(v) => save({ enabled: v })} />
            <Button variant="secondary" disabled={!ready} loading={testing} onClick={test} icon={<Zap size={18} strokeWidth={1.75} />}>
              Проверить подключение
            </Button>
            <Button variant="danger" onClick={() => setConfirmOff(true)}>Отключить и очистить настройки</Button>
          </>
        )}
      </div>

      {/* входящий вебхук: заявки из CRM */}
      <div className="mt-8 rounded-xl bg-card p-4">
        <div className="text-[17px] font-semibold">Заявки из CRM</div>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">
          Любая CRM (или Make/Zapier) отправляет POST с JSON — в приложении появляется заявка. Указан исполнитель — заявка уходит ему, нет — в «Кто заберёт».
        </p>
        <div className="mt-3"><Toggle label="Принимать заявки из CRM" checked={d.inbound.enabled} onChange={(v) => save({ inbound: { enabled: v } })} /></div>
        {d.inbound.enabled && d.inbound.url && (
          <>
            <button onClick={() => copy(d.inbound.url, 'Адрес')} className="mt-3 flex w-full items-center gap-2 rounded-xl bg-fill px-3.5 py-3 text-left active:opacity-70">
              <span className="min-w-0 flex-1 break-all font-mono text-[12px] leading-snug">{d.inbound.url}</span>
              <Copy size={17} strokeWidth={1.75} className="shrink-0 text-muted" />
            </button>
            <div className="mt-2 flex gap-2">
              <button onClick={() => { haptic.tap(); setShowExample((x) => !x); }} className="rounded-full bg-fill px-3.5 py-2 text-[13.5px] font-medium active:opacity-70">
                {showExample ? 'Скрыть пример' : 'Пример запроса'}
              </button>
              <button disabled={busy} onClick={() => save({ inbound: { new_token: true } }, 'Новый адрес создан — старый больше не работает')}
                className="flex items-center gap-1.5 rounded-full bg-fill px-3.5 py-2 text-[13.5px] font-medium active:opacity-70">
                <RefreshCw size={14} strokeWidth={2} />Новый адрес
              </button>
            </div>
            {showExample && (
              <>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-fill p-3 font-mono text-[11.5px] leading-relaxed">{INBOUND_EXAMPLE}</pre>
                <Hint>
                  Обязателен только адрес (или поле text со свободным текстом заявки — разберётся как сообщение боту).
                  tech — Telegram ID, телефон или имя. Повторный запрос с тем же lead_id новую заявку не создаёт.
                </Hint>
                <button onClick={() => copy(INBOUND_EXAMPLE, 'Пример')} className="mt-2 text-[13.5px] font-medium text-accent-ink">Скопировать пример</button>
              </>
            )}
            {!d.inbound.url.startsWith('http') && <Hint>Адрес сервиса не определён (RENDER_EXTERNAL_URL) — допишите домен приложения перед /api/hooks/…</Hint>}
          </>
        )}
      </div>

      {confirmOff && (
        <ConfirmSheet title="Отключить CRM?" confirmLabel="Отключить" danger
          text="Настройки подключения будут удалены. Синхронизация выездов с CRM прекратится. Приём заявок из CRM не затрагивается."
          onClose={() => setConfirmOff(false)}
          onConfirm={async () => { try { await api.disconnectCrm(); haptic.success(); toast('CRM отключена'); setConfirmOff(false); load(); } catch (e) { toast((e as Error).message, 'error'); } }} />
      )}
    </Sheet>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <div className="px-1 text-[12.5px] leading-snug text-muted">{children}</div>;
}
