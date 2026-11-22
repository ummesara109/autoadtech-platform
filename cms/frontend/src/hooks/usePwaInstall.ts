import { useCallback, useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    promptListeners.forEach((listener) => listener());
  });
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return true;
  const mq = window.matchMedia?.('(display-mode: standalone)').matches;
  const iosStandalone =
    'standalone' in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const fullscreen = window.matchMedia?.('(display-mode: fullscreen)').matches;
  return Boolean(mq || iosStandalone || fullscreen);
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/i.test(ua);
  const chromeIsh = /CriOS|FxiOS|EdgiOS/i.test(ua);
  return iOS && webkit && !chromeIsh;
}

/**
 * Real browser install prompt only (no fake Chrome sheet).
 * Safe on Login — never used on the kiosk Display surface.
 */
export function usePwaInstall() {
  const [deferred, setDeferred] =
    useState<BeforeInstallPromptEvent | null>(deferredInstallPrompt);
  const [installed, setInstalled] = useState(isStandaloneDisplay);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    setInstalled(isStandaloneDisplay());
    setIosHint(!isStandaloneDisplay() && isIosSafari());

    const onPromptAvailable = () => setDeferred(deferredInstallPrompt);
    const onInstalled = () => {
      setInstalled(true);
      deferredInstallPrompt = null;
      setDeferred(null);
      setIosHint(false);
    };
    promptListeners.add(onPromptAvailable);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      promptListeners.delete(onPromptAvailable);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (deferredInstallPrompt === deferred) deferredInstallPrompt = null;
    setDeferred(null);
    return choice.outcome === 'accepted';
  }, [deferred]);

  return {
    canPrompt: Boolean(deferred) && !installed,
    showIosHint: iosHint && !installed,
    installed,
    promptInstall,
  };
}
