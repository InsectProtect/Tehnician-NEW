import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { initTelegram } from './telegram';
import App from './App';
import { PhotoViewerHost } from './components/PhotoViewer';
import { ErrorBoundary, installGlobalErrorReporting } from './components/ErrorBoundary';

installGlobalErrorReporting();

initTelegram();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary onReset={() => location.reload()}>
      <App />
      <PhotoViewerHost />
    </ErrorBoundary>
  </StrictMode>,
);
