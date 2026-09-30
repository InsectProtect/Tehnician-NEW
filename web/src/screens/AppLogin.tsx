import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { api } from '../api';
import { hasAppToken as hasToken, isNativeApp, isTelegram as isTelegramApp, setAppToken } from '../telegram';
import { Button, Screen } from '../components/ui';

/**
 * Вход в отдельное приложение (APK / браузер) — только через Telegram и только по запросу:
 * приложение создаёт запрос, сотрудник открывает бота и сам нажимает «✅ Войти».
 */
export function AppLoginScreen({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<'idle' | 'waiting' | 'denied' | 'expired' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [link, setLink] = useState('');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearInterval(timer.current), []);

  const openTg = (url: string) => {
    if (isNativeApp()) window.location.href = url; // APK: Android откроет Telegram
    else window.open(url, '_blank');
  };

  async function start() {
    setErr('');
    try {
      const device = /android/i.test(navigator.userAgent) ? 'Android' : /iphone|ipad/i.test(navigator.userAgent) ? 'iPhone' : 'Браузер';
      const r = await api.appLoginStart(`${isNativeApp() ? 'Приложение' : 'Браузер'} · ${device}`);
      setLink(r.link);
      setState('waiting');
      openTg(r.link);
      window.clearInterval(timer.current);
      timer.current = window.setInterval(async () => {
        try {
          const p = await api.appLoginPoll(r.code);
          if (p.status === 'ok' && p.token) { window.clearInterval(timer.current); setAppToken(p.token); onDone(); }
          else if (p.status === 'denied' || p.status === 'expired') { window.clearInterval(timer.current); setState(p.status); }
        } catch { /* нет сети — попробуем ещё */ }
      }, 2000);
    } catch (e) {
      setErr((e as Error).message);
      setState('error');
    }
  }

  return (
    <Screen>
      <div className="flex min-h-[80dvh] flex-col justify-center">
        <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          <span className="h-2 w-2 rounded-full bg-accent" /> Insect Protect
        </div>
        <h1 className="text-[40px] font-bold uppercase leading-none tracking-tight">Вход</h1>
        <p className="mt-4 text-[16px] leading-relaxed text-muted">
          Войти можно только через Telegram: нажмите кнопку, откроется бот — нажмите в нём <b className="text-ink">«✅ Войти»</b>. Без вашего подтверждения вход не выполнится.
        </p>

        {state !== 'waiting' ? (
          <Button className="mt-8" icon={<Send size={18} strokeWidth={1.75} />} onClick={start}>Войти через Telegram</Button>
        ) : (
          <div className="mt-8 rounded-[22px] bg-card p-5">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 animate-pulse rounded-full bg-accent" />
              <div className="text-[16px] font-semibold">Ждём подтверждения в Telegram…</div>
            </div>
            <p className="mt-2 text-[14px] leading-snug text-muted">Откройте бота, нажмите «Старт», затем «✅ Войти». Запрос действует 10 минут.</p>
            <Button variant="secondary" className="mt-4" onClick={() => openTg(link)}>Открыть Telegram ещё раз</Button>
          </div>
        )}

        {state === 'denied' && <p className="mt-4 text-[14px] text-[#D70015] dark:text-[#FF453A]">Вход отклонён в Telegram.</p>}
        {state === 'expired' && <p className="mt-4 text-[14px] text-[#D70015] dark:text-[#FF453A]">Запрос устарел — нажмите «Войти через Telegram» ещё раз.</p>}
        {err && <p className="mt-4 text-[14px] text-[#D70015] dark:text-[#FF453A]">{err}</p>}
        <p className="mt-10 text-[12.5px] leading-snug text-muted">
          Войти могут только сотрудники, у которых уже есть доступ в Telegram-приложении. После входа приложение, как обычно, спросит PIN.
        </p>
      </div>
    </Screen>
  );
}

/** В отдельном приложении: выйти на этом устройстве или на всех. */
export function AppLogoutButtons() {
  if (isTelegramApp() || !hasToken()) return null;
  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      <Button variant="secondary" onClick={() => { setAppToken(''); window.location.reload(); }}>Выйти</Button>
      <Button variant="secondary" onClick={async () => { try { await api.appLogoutAll(); } catch { /* всё равно выходим */ } setAppToken(''); window.location.reload(); }}>Выйти везде</Button>
    </div>
  );
}
