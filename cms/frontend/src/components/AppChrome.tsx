import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BrandMark, Button, StatusPill } from './ui';
import { useOnline } from '../hooks/useOnline';
import { clearSession, loadSession } from '../lib/session';
import { api } from '../lib/api';
import { stopSilentGps } from '../lib/silentGps';

type Props = {
  children: ReactNode;
  title?: string;
};

export function AppChrome({ children, title }: Props) {
  const navigate = useNavigate();
  const session = loadSession();
  const online = useOnline();
  const [menuOpen, setMenuOpen] = useState(false);

  async function logout() {
    const token = session?.accessToken;
    if (token) {
      void stopSilentGps(token);
      try {
        await api.logout(token);
      } catch {
        /* ignore */
      }
    }
    clearSession();
    navigate('/', { replace: true });
  }

  const sideNav = (
    <>
      <BrandMark compact />
      <nav className="mt-4 flex flex-col gap-1" aria-label="Main">
        <Link
          to="/dashboard"
          onClick={() => setMenuOpen(false)}
          className="flex items-center gap-3 rounded-xl bg-[color-mix(in_srgb,var(--cms-accent)_18%,transparent)] px-3 py-2.5 text-sm font-semibold text-[var(--cms-accent)]"
        >
          <span className="h-2 w-2 rounded-full bg-[var(--cms-accent)]" aria-hidden />
          Dashboard
        </Link>
      </nav>
      <div className="mt-auto space-y-3 pt-6">
        <div className="rounded-xl border border-[var(--cms-border)] px-3 py-2 text-xs text-[var(--cms-muted)]">
          <p className="font-semibold text-[var(--cms-ink)]">
            {session?.operator.autoNumber ?? '—'}
          </p>
          <p className="mt-0.5 truncate">{session?.screen?.label ?? 'Screen'}</p>
        </div>
        <StatusPill online={online} label={online ? 'Network online' : 'Offline'} />
        <Button variant="ghost" className="w-full" onClick={logout}>
          Log out
        </Button>
      </div>
    </>
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-[var(--cms-border)] bg-[color-mix(in_srgb,var(--cms-bg-elevated)_70%,transparent)] p-5 lg:flex">
        {sideNav}
      </aside>

      <aside className="sticky top-0 hidden h-dvh w-52 shrink-0 flex-col border-r border-[var(--cms-border)] bg-[color-mix(in_srgb,var(--cms-bg-elevated)_55%,transparent)] p-4 md:flex lg:hidden">
        <nav className="flex flex-col gap-1" aria-label="Main">
          <Link
            to="/dashboard"
            className="flex items-center gap-3 rounded-xl bg-[color-mix(in_srgb,var(--cms-accent)_18%,transparent)] px-3 py-2.5 text-sm font-semibold text-[var(--cms-accent)]"
          >
            <span className="h-2 w-2 rounded-full bg-[var(--cms-accent)]" aria-hidden />
            Dashboard
          </Link>
        </nav>
        <div className="mt-auto space-y-3">
          <StatusPill online={online} label={online ? 'Online' : 'Offline'} />
          <Button variant="ghost" className="w-full" onClick={logout}>
            Log out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[var(--cms-border)] bg-[color-mix(in_srgb,var(--cms-bg)_92%,transparent)] px-4 py-3 backdrop-blur-md lg:hidden safe-top">
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--cms-border)] md:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="sr-only">Menu</span>
            <span aria-hidden className="flex w-5 flex-col gap-1.5">
              <span className="block h-0.5 rounded bg-[var(--cms-ink)]" />
              <span className="block h-0.5 rounded bg-[var(--cms-ink)]" />
              <span className="block h-0.5 rounded bg-[var(--cms-ink)]" />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {title ?? 'Auto AdTech CMS'}
            </p>
            <p className="truncate text-xs text-[var(--cms-muted)]">
              {session?.operator.autoNumber ?? 'Operator'}
              {session?.screen ? ` · ${session.screen.label}` : ''}
            </p>
          </div>
          <StatusPill online={online} />
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-5 md:pb-8 lg:px-8 lg:py-8">
          {children}
        </main>

        <nav
          className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--cms-border)] bg-[color-mix(in_srgb,var(--cms-bg)_94%,transparent)] px-2 pt-2 backdrop-blur-md md:hidden safe-bottom"
          aria-label="Primary"
        >
          <Link
            to="/dashboard"
            className="flex flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold text-[var(--cms-accent)]"
          >
            <span className="text-base" aria-hidden>
              ▣
            </span>
            Dashboard
          </Link>
          <button
            type="button"
            onClick={logout}
            className="flex flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold text-[var(--cms-muted)]"
          >
            <span className="text-base" aria-hidden>
              ⎋
            </span>
            Log out
          </button>
        </nav>
      </div>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[min(18rem,88vw)] flex-col bg-[var(--cms-bg-elevated)] p-5 shadow-2xl safe-top safe-bottom">
            {sideNav}
          </div>
        </div>
      ) : null}
    </div>
  );
}
