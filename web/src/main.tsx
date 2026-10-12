import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { initTelegram } from './telegram';
import App from './App';
import { PhotoViewerHost } from './components/PhotoViewer';
import { setLocale } from './locale';
import { enableRomanian } from './i18n-dom';
import { ErrorBoundary, installGlobalErrorReporting } from './components/ErrorBoundary';

installGlobalErrorReporting();

initTelegram();

// румынский интерфейс включаем сразу, если он был выбран (до загрузки настроек с сервера)
try {
  if (localStorage.getItem('lang') === 'ro') { setLocale('ro'); enableRomanian(); }
} catch { /* без хранилища — включится после загрузки настроек */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary onReset={() => location.reload()}>
      <App />
      <PhotoViewerHost />
    </ErrorBoundary>
  </StrictMode>,
);
