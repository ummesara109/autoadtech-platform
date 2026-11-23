import { useState } from 'react';
import { Button } from './ui';
import { usePwaInstall } from '../hooks/usePwaInstall';

/**
 * Login-only install affordance. Uses the real `beforeinstallprompt` event
 * (or iOS Share → Add to Home Screen). Not shown on /display kiosk.
 */
export function PwaInstallHint() {
  const { canPrompt, showIosHint, installed, promptInstall } = usePwaInstall();
  const [showManualSteps, setShowManualSteps] = useState(false);

  if (installed) return null;

  function onInstallClick() {
    if (canPrompt) {
      void promptInstall();
      return;
    }
    setShowManualSteps(true);
  }

  return (
    <div
      className="pwa-install-hint mt-4 rounded-xl border border-[var(--cms-border)] bg-[color-mix(in_srgb,var(--cms-panel)_70%,transparent)] p-3 text-sm text-[var(--cms-muted)]"
      role="region"
      aria-label="Install Auto Display"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0">
          Install <strong className="text-[var(--cms-ink)]">Auto Display</strong> for
          fullscreen vehicle use.
        </p>
        <Button type="button" className="shrink-0" onClick={onInstallClick}>
          Install app
        </Button>
      </div>
      {!canPrompt && showManualSteps ? (
        <p className="mt-2" role="status">
          Automatic install isn’t available in this browser right now.{' '}
          {showIosHint ? (
            <>
              On iPhone or iPad, tap <strong className="text-[var(--cms-ink)]">Share</strong> →{' '}
              <strong className="text-[var(--cms-ink)]">Add to Home Screen</strong>.
              If that option is missing, open this page in Safari and try again.
            </>
          ) : /Android/i.test(navigator.userAgent) ? (
            <>
              On Android, open the browser menu and choose{' '}
              <strong className="text-[var(--cms-ink)]">Install app</strong> or{' '}
              <strong className="text-[var(--cms-ink)]">Add to Home screen</strong>.
            </>
          ) : (
            <>
              Open this page in a browser that supports PWA installation, then use its
              menu to choose <strong className="text-[var(--cms-ink)]">Install app</strong>{' '}
              or <strong className="text-[var(--cms-ink)]">Add to Home Screen</strong>.
            </>
          )}{' '}
          Use the site’s HTTPS address, not an in-app browser or an HTTP address.
        </p>
      ) : null}
    </div>
  );
}
