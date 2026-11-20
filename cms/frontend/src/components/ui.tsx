import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Shell({
  children,
  narrow = false,
}: {
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    <div
      className={`mx-auto flex min-h-dvh w-full flex-col px-4 py-6 sm:px-6 lg:px-8 ${
        narrow ? 'max-w-md justify-center' : 'max-w-5xl'
      }`}
    >
      {children}
    </div>
  );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${compact ? 'mb-2' : 'mb-8'}`}>
      <div
        className={`grid place-items-center rounded-xl ${compact ? 'h-10 w-10' : 'h-11 w-11'}`}
        style={{ background: 'linear-gradient(145deg, #3dd68c, #1f8f5a)' }}
        aria-hidden
      >
        <span className="text-sm font-bold text-[#0b1f17]">AC</span>
      </div>
      <div className="min-w-0">
        <p
          className={`truncate font-semibold tracking-tight text-[var(--cms-ink)] ${
            compact ? 'text-base' : 'text-xl'
          }`}
        >
          Auto AdTech Display
        </p>
        <p className="truncate text-sm text-[var(--cms-muted)]">
          {compact ? 'Auto Display' : 'Vehicle advertisement screen'}
        </p>
      </div>
    </div>
  );
}

export function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-[var(--cms-border)] bg-[color-mix(in_srgb,var(--cms-panel)_88%,transparent)] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.25)] backdrop-blur-sm sm:p-5 ${className}`}
    >
      {children}
    </section>
  );
}

export function Title({
  children,
  subtitle,
}: {
  children: ReactNode;
  subtitle?: string;
}) {
  return (
    <header className="mb-5 sm:mb-6">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl lg:text-3xl">
        {children}
      </h1>
      {subtitle ? (
        <p className="mt-2 text-sm text-[var(--cms-muted)] sm:text-base">{subtitle}</p>
      ) : null}
    </header>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
}) {
  const styles =
    variant === 'primary'
      ? 'bg-[var(--cms-accent)] text-[#062016] hover:brightness-110'
      : variant === 'danger'
        ? 'bg-[color-mix(in_srgb,var(--cms-danger)_20%,transparent)] text-[var(--cms-danger)] border border-[color-mix(in_srgb,var(--cms-danger)_40%,transparent)]'
        : 'bg-transparent text-[var(--cms-ink)] border border-[var(--cms-border)] hover:bg-white/5';
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-3 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-[var(--cms-muted)]">
        {label}
      </span>
      <input
        className="w-full rounded-xl border border-[var(--cms-border)] bg-[var(--cms-bg-elevated)] px-4 py-3 text-[var(--cms-ink)] outline-none ring-[var(--cms-accent)] placeholder:text-[var(--cms-muted)] focus:ring-2"
        {...props}
      />
      {hint ? (
        <span className="mt-2 block text-xs text-[var(--cms-muted)]">{hint}</span>
      ) : null}
    </label>
  );
}

export function Alert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'info' | 'warn';
  children: ReactNode;
}) {
  const color =
    tone === 'error'
      ? 'var(--cms-danger)'
      : tone === 'warn'
        ? 'var(--cms-warn)'
        : 'var(--cms-accent)';
  return (
    <div
      className="rounded-xl border px-4 py-3 text-sm"
      style={{
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
      }}
      role="alert"
    >
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--cms-border)] px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      {detail ? (
        <p className="mt-2 text-sm text-[var(--cms-muted)]">{detail}</p>
      ) : null}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-[var(--cms-muted)]" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--cms-muted)] border-t-[var(--cms-accent)]" />
      <span>{label}</span>
    </div>
  );
}

export function StatusPill({
  online,
  label,
}: {
  online: boolean;
  label?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
      style={{
        background: online
          ? 'color-mix(in srgb, var(--cms-accent) 18%, transparent)'
          : 'color-mix(in srgb, var(--cms-muted) 18%, transparent)',
        color: online ? 'var(--cms-accent)' : 'var(--cms-muted)',
      }}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: online ? 'var(--cms-accent)' : 'var(--cms-muted)' }}
      />
      {label ?? (online ? 'Online' : 'Offline')}
    </span>
  );
}
