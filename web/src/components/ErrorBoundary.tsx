import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getInitData } from '../telegram';

/** Отправляем ошибку на сервер — она появится в Админке → Журнал действий и в логах Render. */
export function reportError(message: string, stack = '', where = '') {
  try {
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `tma ${getInitData()}` },
      body: JSON.stringify({ message: String(message).slice(0, 500), stack: String(stack).slice(0, 2000), where, ua: navigator.userAgent, url: location.href }),
    }).catch(() => undefined);
  } catch { /* не мешаем работе */ }
}

let installed = false;
/** Ошибки вне React (промисы, обработчики) тоже отправляем. */
export function installGlobalErrorReporting() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => reportError(e.message, e.error?.stack, 'window'));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string } | undefined;
    reportError(r?.message || String(e.reason), r?.stack, 'promise');
  });
}

/** Вместо белого экрана — понятное сообщение с текстом ошибки и кнопками «Назад» / «Перезагрузить». */
export class ErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error.message, `${error.stack || ''}\n${info.componentStack || ''}`, 'render');
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="min-h-screen bg-page px-5 pt-16 text-ink">
        <div className="text-[28px] font-bold">Что-то пошло не так</div>
        <p className="mt-2 text-[15px] leading-snug text-muted">Ошибка уже отправлена администратору. Вернитесь назад — данные сохранены.</p>
        <pre className="mt-4 whitespace-pre-wrap break-words rounded-2xl bg-card p-4 text-[12px] text-muted">{error.message}</pre>
        <div className="mt-6 grid gap-2.5">
          <button className="h-[52px] rounded-full bg-accent text-[16px] font-semibold text-black"
            onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}>
            Назад
          </button>
          <button className="h-[52px] rounded-full bg-card text-[16px] font-semibold ring-1 ring-inset ring-line" onClick={() => location.reload()}>
            Перезагрузить
          </button>
        </div>
      </div>
    );
  }
}
