import { useEffect, useState } from 'react';
import { Delete, Lock } from 'lucide-react';
import { api, ApiError, setSession } from '../api';
import { haptic } from '../telegram';
import { cx } from '../components/ui';

const LEN = 4;

/** Экран PIN-кода: установка (дважды) или ввод. */
export function PinScreen({ mode, name, onDone }: { mode: 'set' | 'enter'; name: string; onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  const title = mode === 'enter' ? 'Введите PIN-код' : first ? 'Повторите PIN-код' : 'Придумайте PIN-код';
  const hint = mode === 'enter'
    ? `${name.split(' ')[0]}, введите PIN для входа`
    : first ? 'Введите тот же PIN ещё раз' : 'Четыре цифры — их будут спрашивать при каждом входе';

  const fail = (msg: string) => {
    haptic.error();
    setError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 400);
    setPin('');
  };

  async function submit(value: string) {
    if (mode === 'set' && !first) {
      setFirst(value);
      setPin('');
      setError('');
      return;
    }
    if (mode === 'set' && first !== value) {
      setFirst(null);
      fail('PIN-коды не совпали. Попробуйте снова');
      return;
    }
    setBusy(true);
    try {
      const r = mode === 'set' ? await api.setPin(value) : await api.verifyPin(value);
      setSession(r.token);
      haptic.success();
      onDone();
    } catch (e) {
      fail(e instanceof ApiError ? e.message : 'Не удалось проверить PIN');
    } finally {
      setBusy(false);
    }
  }

  function press(d: string) {
    if (busy || pin.length >= LEN) return;
    haptic.tap();
    const next = pin + d;
    setPin(next);
    setError('');
    if (next.length === LEN) setTimeout(() => submit(next), 120);
  }

  // ввод с физической клавиатуры (Telegram Desktop)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  return (
    <div className="pt-safe mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-8 pb-[env(safe-area-inset-bottom)] animate-fade">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent-ink">
        <Lock size={26} strokeWidth={1.6} />
      </div>
      <h1 className="text-[24px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-1.5 h-10 text-center text-[15px] text-muted">{hint}</p>

      <div className={cx('my-6 flex gap-4', shake && 'animate-[shake_0.35s]')}>
        {Array.from({ length: LEN }, (_, i) => (
          <span key={i} className={cx('h-3.5 w-3.5 rounded-full border-2 transition',
            i < pin.length ? 'border-accent bg-accent' : 'border-black/20 dark:border-white/30')} />
        ))}
      </div>
      <p className="mb-6 h-5 text-center text-[14px] font-medium text-[#D70015] dark:text-[#FF453A]">{error}</p>

      <div className="grid w-full grid-cols-3 gap-4">
        {keys.map((k, i) =>
          k === '' ? <span key={i} /> : k === 'del' ? (
            <button key={i} onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Стереть"
              className="flex h-[72px] items-center justify-center rounded-full text-muted active:opacity-60">
              <Delete size={26} strokeWidth={1.6} />
            </button>
          ) : (
            <button key={i} onClick={() => press(k)} disabled={busy}
              className="h-[72px] rounded-full bg-card font-dot text-[32px] ring-1 ring-inset ring-line transition active:bg-fill">
              {k}
            </button>
          ),
        )}
      </div>

      {mode === 'enter' && <p className="mt-8 text-center text-[13px] text-muted">Забыли PIN? Попросите администратора сбросить его.</p>}
    </div>
  );
}
