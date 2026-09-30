import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { initTelegram } from './telegram';
import App from './App';
import { ErrorBoundary, installGlobalErrorReporting } from './components/ErrorBoundary';

installGlobalErrorReporting();

initTelegram();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary onReset={() => location.reload()}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
