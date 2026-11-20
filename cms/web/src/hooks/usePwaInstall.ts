import { useCallback, useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

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
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [installed, setInstalled] = useState(isStandaloneDisplay);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    setInstalled(isStandaloneDisplay());
    setIosHint(!isStandaloneDisplay() && isIosSafari());

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      setIosHint(false);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const choice = await deferred.userChoice;
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
