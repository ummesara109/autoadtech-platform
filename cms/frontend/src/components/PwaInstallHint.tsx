import { Button } from './ui';
import { usePwaInstall } from '../hooks/usePwaInstall';

/**
 * Login-only install affordance. Uses the real `beforeinstallprompt` event
 * (or iOS Share → Add to Home Screen). Not shown on /display kiosk.
 */
export function PwaInstallHint() {
  const { canPrompt, showIosHint, installed, promptInstall } = usePwaInstall();

  if (installed || (!canPrompt && !showIosHint)) return null;

  return (
    <div
      className="mt-4 rounded-xl border border-[var(--cms-border)] bg-[color-mix(in_srgb,var(--cms-panel)_70%,transparent)] p-3 text-sm text-[var(--cms-muted)]"
      role="region"
      aria-label="Install Auto Display"
    >
      {canPrompt ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0">
            Install <strong className="text-[var(--cms-ink)]">Auto Display</strong> for
            fullscreen vehicle use.
          </p>
          <Button
            type="button"
            className="shrink-0"
            onClick={() => {
              void promptInstall();
            }}
          >
            Install app
          </Button>
        </div>
      ) : (
        <p>
          On iPhone/iPad: tap <strong className="text-[var(--cms-ink)]">Share</strong> →{' '}
          <strong className="text-[var(--cms-ink)]">Add to Home Screen</strong> (needs
          HTTPS).
        </p>
      )}
    </div>
  );
}
