import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import { App } from './App';
import { isDesktop } from './platform/fileio';

// Service worker only in the web/PWA build; Electron loads from file:// and is offline by nature.
if (!isDesktop() && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  registerSW({ immediate: true });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
