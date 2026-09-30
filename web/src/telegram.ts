// Обёртка над Telegram: @telegram-apps/sdk-react для инициализации и initData,
// нативный Telegram.WebApp — для сканера QR, кнопки «Назад», вибро и ссылок.
import * as sdk from '@telegram-apps/sdk-react';
import { useEffect, useRef } from 'react';

type Haptic = {
  impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
  notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  selectionChanged(): void;
};

type TgWebApp = {
  initData: string;
  version: string;
  platform: string;
  colorScheme?: 'light' | 'dark';
  ready(): void;
  expand(): void;
  isVersionAtLeast(v: string): boolean;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  showScanQrPopup(params: { text?: string }, cb: (text: string) => boolean | void): void;
  closeScanQrPopup(): void;
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
  openLink(url: string): void;
  openTelegramLink?(url: string): void;
  close?(): void;
  requestWriteAccess?(cb?: (granted: boolean) => void): void;
  disableVerticalSwipes?(): void;
  isFullscreen?: boolean;
  requestFullscreen?(): void;
  exitFullscreen?(): void;
  HapticFeedback?: Haptic;
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

const wa = (): TgWebApp | undefined => {
  const w = window.Telegram?.WebApp;
  return w && w.platform && w.platform !== 'unknown' ? w : undefined;
};

let rawInitData = '';

export function initTelegram() {
  // SDK может бросить исключение вне Telegram (в обычном браузере) — это нормально.
  const s = sdk as unknown as Record<string, unknown>;
  try {
    if (typeof s.init === 'function') (s.init as () => void)();
  } catch {
    /* вне Telegram */
  }
  try {
    if (typeof s.retrieveRawInitData === 'function') rawInitData = ((s.retrieveRawInitData as () => string | undefined)() ?? '');
  } catch {
    /* вне Telegram */
  }
  const w = wa();
  if (!rawInitData && w?.initData) rawInitData = w.initData;
  if (w) {
    w.ready();
    w.expand();
    w.disableVerticalSwipes?.();
  }
  applyTheme();
  w?.onEvent('themeChanged', applyTheme);
}

export const isTelegram = () => Boolean(wa());
export const getInitData = () => rawInitData;

/* ---- Отдельное приложение (APK / браузер): вход подтверждается в Telegram-боте, токен хранится на устройстве ---- */
const APP_TOKEN_KEY = 'ip_app_token';
let appToken = (() => { try { return localStorage.getItem(APP_TOKEN_KEY) || ''; } catch { return ''; } })();
export const hasAppToken = () => Boolean(appToken);
export function setAppToken(t: string) {
  appToken = t;
  try { if (t) localStorage.setItem(APP_TOKEN_KEY, t); else localStorage.removeItem(APP_TOKEN_KEY); } catch { /* хранилище недоступно */ }
}
/** Внутри Telegram — initData; в отдельном приложении — токен после подтверждения в боте. */
export const authHeader = () => (rawInitData ? `tma ${rawInitData}` : appToken ? `app ${appToken}` : 'tma ');
/** APK (Capacitor) — открываем Telegram переходом, в браузере — новой вкладкой. */
export const isNativeApp = () => Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());

export type ThemePref = 'dark' | 'light' | 'auto';
// По умолчанию — тёмная (утверждённый макет). Выбор пользователя приходит из профиля (bootstrap.prefs.theme) и кэшируется локально.
let themePref: ThemePref = (() => {
  try { return (localStorage.getItem('pt_theme') as ThemePref) || 'dark'; } catch { return 'dark'; }
})();

export function setThemePref(t: ThemePref | undefined) {
  themePref = t === 'light' || t === 'auto' ? t : 'dark';
  try { localStorage.setItem('pt_theme', themePref); } catch { /* нет хранилища */ }
  applyTheme();
}
export const getThemePref = () => themePref;

function applyTheme() {
  const w = wa();
  const system = w?.colorScheme ? w.colorScheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = themePref === 'dark' || (themePref === 'auto' && system);
  document.documentElement.classList.toggle('dark', dark);
  const bg = dark ? '#000000' : '#F1F1F1';
  try {
    w?.setHeaderColor?.(bg);
    w?.setBackgroundColor?.(bg);
  } catch {
    /* старые клиенты */
  }
}

export const canScanQr = () => Boolean(wa()?.isVersionAtLeast('6.4'));

/** Открывает нативный сканер Telegram. Возвращает текст QR или null, если закрыли. */
export function scanQr(text = 'Наведите камеру на QR-код ловушки'): Promise<string | null> {
  const w = wa();
  if (!w || !canScanQr()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const onClosed = () => finish(null);
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      w.offEvent('scanQrPopupClosed', onClosed);
      resolve(value);
    };
    w.onEvent('scanQrPopupClosed', onClosed);
    w.showScanQrPopup({ text }, (value) => {
      finish(value);
      return true; // закрыть сканер
    });
  });
}

export const haptic = {
  success: () => wa()?.HapticFeedback?.notificationOccurred('success'),
  error: () => wa()?.HapticFeedback?.notificationOccurred('error'),
  tap: () => wa()?.HapticFeedback?.selectionChanged(),
};

export function openLink(path: string) {
  const url = new URL(path, window.location.origin).toString();
  const w = wa();
  if (w) { w.openLink(url); return; }
  // APK: PDF/файлы открываем во встроенном браузере Android (Custom Tabs), там работают просмотр и скачивание
  const browser = (window as unknown as { Capacitor?: { Plugins?: { Browser?: { open: (o: { url: string }) => Promise<void> } } } }).Capacitor?.Plugins?.Browser;
  if (browser) { browser.open({ url }).catch(() => { window.location.href = url; }); return; }
  window.open(url, '_blank');
}

/** Разрешение боту писать пользователю в личку (уведомления о заявках). Спрашивается один раз. */
export function askWriteAccess() {
  const w = wa();
  try {
    if (!w?.requestWriteAccess || !w.isVersionAtLeast('6.9')) return;
    if (localStorage.getItem('pt_write_access')) return;
    w.requestWriteAccess(() => { try { localStorage.setItem('pt_write_access', '1'); } catch { /* нет хранилища */ } });
  } catch {
    /* не поддерживается */
  }
}

/** Поделиться ссылкой через выбор чата Telegram. */
export function shareLink(url: string, text: string) {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  const w = wa();
  if (w?.openTelegramLink) w.openTelegramLink(share);
  else window.open(share, '_blank');
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Показывает системную кнопку «Назад» Telegram, пока экран смонтирован. */
export function useBackButton(handler: (() => void) | undefined) {
  const ref = useRef(handler);
  ref.current = handler;
  const enabled = Boolean(handler);
  useEffect(() => {
    const bb = wa()?.BackButton;
    if (!bb || !enabled) return;
    const cb = () => ref.current?.();
    bb.onClick(cb);
    bb.show();
    return () => {
      bb.offClick(cb);
      bb.hide();
    };
  }, [enabled]);
}

export const platform = () => wa()?.platform || '';

/**
 * Перейти в чат с ботом. Если мини-приложение открыто из этого же чата, openTelegramLink на iPhone ничего не делает,
 * поэтому после перехода приложение закрываем — под ним окажется чат с сообщением.
 */
export function openTgChat(username: string) {
  const url = `https://t.me/${username}`;
  const w = wa();
  if (!w) { window.open(url, '_blank'); return; }
  try { w.openTelegramLink?.(url); } catch { /* ignore */ }
  setTimeout(() => { try { w.close?.(); } catch { /* ignore */ } }, 350);
}

/** Номер в международном формате (Молдова по умолчанию): 60356016 / 069123456 → +37360356016 */
export function intlPhone(raw: string) {
  let d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9 && d.startsWith('0')) d = `373${d.slice(1)}`;
  else if (d.length === 8) d = `373${d}`;
  return `+${d}`;
}

/** +37360356016 → +373 60 356 016 */
export function prettyPhone(raw: string) {
  const p = intlPhone(raw);
  const m = p.match(/^\+373(\d{2})(\d{3})(\d{3})$/);
  return m ? `+373 ${m[1]} ${m[2]} ${m[3]}` : p;
}

/**
 * Позвонить прямо с телефона, без перехода на сторонние страницы.
 * Пробуем tel: (Android и новые версии Telegram на iPhone открывают набор номера). Если за ~1,2 с приложение
 * не ушло в фон — звонилка не открылась, и вызывается onFail (показываем запасной вариант внутри Telegram).
 */
export function callPhone(phone: string, onFail?: () => void) {
  const num = intlPhone(phone);
  if (!num) return;
  let left = false;
  const mark = () => { left = true; };
  window.addEventListener('blur', mark, { once: true });
  document.addEventListener('visibilitychange', mark, { once: true });
  try {
    const a = document.createElement('a');
    a.href = `tel:${num}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    try { window.location.href = `tel:${num}`; } catch { /* ignore */ }
  }
  setTimeout(() => {
    window.removeEventListener('blur', mark);
    document.removeEventListener('visibilitychange', mark);
    if (!left && document.visibilityState === 'visible') onFail?.();
  }, 1200);
}

/**
 * Координаты телефона: LocationManager Telegram (Bot API 8.0+) или геолокация браузера.
 * Возвращает null, если пользователь не дал доступ.
 */
export function getLocation(): Promise<{ lat: number; lon: number } | null> {
  type LM = {
    isInited?: boolean; isLocationAvailable?: boolean; isAccessGranted?: boolean;
    init(cb?: () => void): void; getLocation(cb: (d: { latitude: number; longitude: number } | null) => void): void;
  };
  const lm = (wa() as unknown as { LocationManager?: LM } | undefined)?.LocationManager;
  const viaBrowser = () => new Promise<{ lat: number; lon: number } | null>((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });
  if (!lm || !wa()?.isVersionAtLeast('8.0')) return viaBrowser();
  return new Promise((resolve) => {
    const ask = () => {
      if (!lm.isLocationAvailable) { viaBrowser().then(resolve); return; }
      lm.getLocation((d) => resolve(d ? { lat: d.latitude, lon: d.longitude } : null));
    };
    if (lm.isInited) ask(); else lm.init(ask);
  });
}

/** Telegram на компьютере (Desktop / macOS / Web) — там окно мини-приложения можно развернуть на весь экран. */
export const isDesktopTg = () => ['tdesktop', 'macos', 'weba', 'webk', 'web', 'unigram'].includes(platform());
export const canFullscreen = () => { const w = wa(); return Boolean(w?.requestFullscreen && w.isVersionAtLeast('8.0')); };
export const isFullscreen = () => Boolean(wa()?.isFullscreen);
export function toggleFullscreen() {
  const w = wa();
  if (!w) { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.(); return; }
  try { if (w.isFullscreen) w.exitFullscreen?.(); else w.requestFullscreen?.(); } catch { /* не поддерживается */ }
}
/** Подписка на смену полноэкранного режима. */
export function onFullscreenChange(cb: () => void) {
  const w = wa();
  w?.onEvent('fullscreenChanged', cb);
  document.addEventListener('fullscreenchange', cb);
  return () => { w?.offEvent('fullscreenChanged', cb); document.removeEventListener('fullscreenchange', cb); };
}
