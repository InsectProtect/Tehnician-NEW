import { isTelegram, setThemePref } from './telegram';
import { AppLoginScreen } from './screens/AppLogin';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { api, onAppLoginNeeded, onSessionLost, setSession } from './api';
import { ConfigCtx } from './config';
import type { Bootstrap, BootstrapPartial, User } from './types';
import { Empty, Screen, Spinner, ToastProvider } from './components/ui';
import { AccessScreen } from './screens/Access';
import { Admin, type AdminTab } from './screens/Admin';
import { APP_VERSION, Home } from './screens/Home';
import { AlertOverlay, InboxScreen, LeagueScreen, PlayProvider, ProfileScreen, TabBar, setInitialStaffTab, usePlay } from './screens/Play';
import { CarScreen } from './screens/Car';

import { NewVisit } from './screens/NewVisit';
import { setSalesFocus } from './screens/Sales';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PinScreen } from './screens/Pin';
import { VisitScreen } from './screens/Visit';

// кнопка бота «📷 Сфотографировать» (?car=check) — сразу вкладка «Авто»
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('car')) setInitialStaffTab('car');

type Route =
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'admin'; tab: AdminTab }
  | { name: 'visit'; id: string; back: Route };

const LOCK_AFTER_MS = 5 * 60 * 1000; // приложение свернули дольше 5 минут — снова PIN

export default function App() {
  const [cfg, setCfg] = useState<Bootstrap | null>(null);
  const [partial, setPartial] = useState<BootstrapPartial | null>(null);
  const [error, setError] = useState('');
  // вне Telegram (APK / браузер) без токена — экран «Войти через Telegram»
  const [needLogin, setNeedLogin] = useState(false);
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const hiddenAt = useRef(0);

  const load = useCallback(() => {
    setError('');
    return api
      .bootstrap()
      .then((b) => {
        if ('procedures' in b) {
          setPartial(null);
          if (b.prefs?.theme) setThemePref(b.prefs.theme);
          setCfg(b);
        } else {
          setCfg(null);
          setPartial(b);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const lock = useCallback(() => {
    setSession('');
    setCfg(null);
    load();
  }, [load]);

  useEffect(() => {
    if (!needLogin) load();
    onSessionLost(lock);
    onAppLoginNeeded(() => { if (isTelegram()) return; setCfg(null); setPartial(null); setNeedLogin(true); });
  }, [load, lock, needLogin]);

  // блокировка при долгом сворачивании
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > LOCK_AFTER_MS) lock();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [lock]);

  // после деплоя открытое приложение держит старую версию — при возврате в приложение сверяем сборку и перезагружаемся
  // (не во время работы, чтобы не потерять заполняемую форму)
  useEffect(() => {
    let first = '';
    const check = async () => {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        const b = String((await r.json()).build || '');
        if (!b) return;
        if (!first) first = b;
        else if (b !== first) window.location.reload();
      } catch { /* нет сети — проверим позже */ }
    };
    check();
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => { window.scrollTo(0, 0); }, [route]);

  // администратор сразу попадает в админ-панель (заявки там же); «Назад» ведёт на экран «Выезды» с инструментами
  const adminStart = useRef(false);
  useEffect(() => {
    if (cfg?.isAdmin && !adminStart.current) {
      adminStart.current = true;
      // кнопка бота «Мой KPI» / «Дополнить заявку» / «Звонилка» открывает раздел «Продажи»
      const sales = new URLSearchParams(window.location.search).get('sales');
      if (sales) setSalesFocus(sales === 'calls' ? 'calls' : 'money');
      const cars = new URLSearchParams(window.location.search).get('cars');
      setRoute((r) => (r.name === 'home' ? { name: 'admin', tab: cars ? 'cars' : sales || cfg.user.role === 'manager' ? 'sales' : 'overview' } : r));
    }
  }, [cfg]);

  const home = () => {
    setRoute({ name: 'home' });
    load(); // обновить счётчики (заявки на доступ, чат офиса)
  };
  const openVisit = (id: string) => setRoute((r) => ({ name: 'visit', id, back: r.name === 'visit' ? r.back : r }));

  let content;
  if (needLogin) {
    content = <AppLoginScreen onDone={() => { setNeedLogin(false); }} />;
  } else if (error) {
    content = (
      <Screen>
        <Empty icon={<ShieldAlert size={44} strokeWidth={1.25} />} title="Нет доступа" text={error} />
      </Screen>
    );
  } else if (partial && partial.user.status !== 'active') {
    content = <AccessScreen user={partial.user as User} onRefresh={load} />;
  } else if (partial?.pin) {
    content = <PinScreen key={partial.pin.set ? 'enter' : 'set'} mode={partial.pin.set ? 'enter' : 'set'} name={partial.user.name} onDone={load} />;
  } else if (!cfg) {
    content = <Spinner />;
  } else {
    const screens = (
      <>
        {route.name === 'home' && cfg.isAdmin && (
          <Admin tab="overview" onTab={(tab) => setRoute({ name: 'admin', tab })} onOpen={openVisit} onConfigChanged={load} />
        )}
        {route.name === 'home' && !cfg.isAdmin && (
          <StaffHome
            onNew={() => setRoute({ name: 'new' })}
            onOpen={openVisit}
            onAdmin={() => setRoute({ name: 'admin', tab: 'overview' })}
            onConfigChanged={load}
          />
        )}
        {route.name === 'new' && <NewVisit onBack={home} onCreated={(id) => setRoute({ name: 'visit', id, back: { name: 'home' } })} />}
        {route.name === 'admin' && (
          <Admin tab={route.tab} onTab={(tab) => setRoute({ name: 'admin', tab })} onBack={cfg.isAdmin ? undefined : home} onOpen={openVisit} onConfigChanged={load} />
        )}
        {route.name === 'visit' && (
          <ErrorBoundary key={route.id} onReset={home}>
            <VisitScreen
              id={route.id}
              onBack={() => (route.back.name === 'home' ? home() : setRoute(route.back))}
            />
          </ErrorBoundary>
        )}
      </>
    );
    content = (
      <ConfigCtx.Provider value={cfg}>
        {cfg.isAdmin ? screens : (
          <PlayProvider>
            {screens}
            <AlertOverlay onOpenVisit={openVisit} />
          </PlayProvider>
        )}
      </ConfigCtx.Provider>
    );
  }

  return <ToastProvider>{content}</ToastProvider>;
}

/** Сотрудник: вкладки «Сегодня / Входящие / Лига / Профиль» с нижним меню. */
function StaffHome(props: { onNew: () => void; onOpen: (id: string) => void; onAdmin: () => void; onConfigChanged: () => void }) {
  const { tab } = usePlay();
  return (
    <>
      {tab === 'today' && <Home {...props} />}
      {tab === 'inbox' && <InboxScreen onOpenVisit={props.onOpen} />}
      {tab === 'league' && <LeagueScreen />}
      {tab === 'car' && <CarScreen />}
      {tab === 'profile' && <ProfileScreen onOpenVisit={props.onOpen} version={APP_VERSION} />}
      <TabBar />
    </>
  );
}
