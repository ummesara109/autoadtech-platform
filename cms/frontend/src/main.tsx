import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { installNativeGpsBridge } from './lib/nativeGpsBridge';
import './index.css';

// Capacitor Android FGS bridge (no-op UI). Must run before OTP/display GPS start.
installNativeGpsBridge();

registerSW({
  immediate: true,
  onOfflineReady() {
    // App shell precached; API/OTP remain network-only.
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
