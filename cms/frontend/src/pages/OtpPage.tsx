import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Capacitor } from '@capacitor/core';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, api, type LookupResponse } from '../lib/api';
import { saveSession } from '../lib/session';
import { startSilentGps } from '../lib/silentGps';
import {
  Alert,
  BrandMark,
  Button,
  Panel,
  Shell,
  Title,
} from '../components/ui';
import { useOnline } from '../hooks/useOnline';

function requestFreshGpsPosition(): Promise<void> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return Promise.reject(new Error('Location is not supported on this device.'));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(),
      (error) => reject(error),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  });
}

export function OtpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnline();
  const initial = location.state as LookupResponse | null;

  const [challenge, setChallenge] = useState(initial);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!challenge) navigate('/', { replace: true });
  }, [challenge, navigate]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const secondsLeft = useMemo(() => {
    if (!challenge) return 0;
    return Math.max(
      0,
      Math.floor((new Date(challenge.expiresAt).getTime() - now) / 1000),
    );
  }, [challenge, now]);

  const active = challenge;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!active) return;
    setError(null);
    setInfo(null);
    if (!navigator.onLine) {
      setError(
        'You’re offline. OTP verification is never cached and needs network.',
      );
      return;
    }
    if (secondsLeft <= 0) {
      setError('OTP expired — resend a new code');
      return;
    }
    setLoading(true);
    try {
      const session = await api.verifyOtp(active.challengeId, otp);
      if (!session.screen?.id) {
        setError('No screen assigned to this Auto Number.');
        return;
      }
      saveSession(session);
      if (!Capacitor.isNativePlatform()) {
        try {
          await requestFreshGpsPosition();
        } catch (error) {
          if (
            error instanceof GeolocationPositionError &&
            error.code === error.PERMISSION_DENIED
          ) {
            setError(
              'Location permission is required after OTP verification to open the display.',
            );
            return;
          }
        }
      }
      // Silent GPS — no map/coords UI; native bridge used when present.
      void startSilentGps(session.accessToken);
      // Manager rule: one screen — full-screen Auto Display (not a dashboard)
      navigate('/display', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    if (!active) return;
    setError(null);
    setInfo(null);
    if (!navigator.onLine) {
      setError('You’re offline. Resend needs network.');
      return;
    }
    setResending(true);
    try {
      const next = await api.resendOtp(active.challengeId);
      setChallenge({ ...active, ...next });
      setInfo(
        next.devMode
          ? 'Temporary demo mode is enabled. No SMS was sent.'
          : `Code resent to ${next.maskedMobile}`,
      );
      setOtp('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Resend failed');
    } finally {
      setResending(false);
    }
  }

  if (!active) return null;

  return (
    <Shell narrow>
      <BrandMark />
      {!online ? (
        <Alert tone="warn">
          Offline — OTP is never stored in the service worker cache.
        </Alert>
      ) : null}
      <Panel className="mt-4 w-full">
        <Title
          subtitle={
            active.localDevelopmentAuth
              ? `Local development authentication is enabled for ${active.autoNumber}. Use OTP 123456.`
              : active.devMode
                ? `Temporary testing mode is enabled for ${active.autoNumber}. Enter the test OTP provided to you.`
                : `We sent a 6-digit code to ${active.maskedMobile} for ${active.autoNumber}.`
          }
        >
          Enter OTP
        </Title>
        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[var(--cms-muted)]">
              6-digit code
            </span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              className="w-full rounded-xl border border-[var(--cms-border)] bg-[var(--cms-bg-elevated)] px-4 py-4 text-center text-3xl tracking-[0.4em] outline-none ring-[var(--cms-accent)] focus:ring-2"
              value={otp}
              onChange={(e) =>
                setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))
              }
              required
            />
          </label>
          <p className="text-sm text-[var(--cms-muted)]">
            Expires in{' '}
            <span className="font-semibold text-[var(--cms-ink)]">
              {Math.floor(secondsLeft / 60)}:
              {String(secondsLeft % 60).padStart(2, '0')}
            </span>
            {active.localDevelopmentAuth
              ? ' · Local development testing only.'
              : active.devMode
                ? ' · Testing only — disable CMS_DEMO_AUTH before real drivers use this app.'
                : null}
          </p>
          {active.localDevelopmentAuth ? (
            <Alert tone="warn">
              Local-only authentication is enabled. It requires a vehicle and
              active display mapping already registered in Admin; do not enable
              this setting in Preview or Production.
            </Alert>
          ) : active.devMode ? (
            <Alert tone="warn">
              Testing-only authentication is enabled. Disable CMS_DEMO_AUTH in
              Vercel and redeploy before real drivers use this app.
            </Alert>
          ) : null}
          {error ? <Alert>{error}</Alert> : null}
          {info ? <Alert tone="info">{info}</Alert> : null}
          <Button
            type="submit"
            className="w-full"
            disabled={loading || otp.length !== 6}
          >
            {loading ? 'Verifying…' : 'Verify & continue'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={resending}
            onClick={onResend}
          >
            {resending ? 'Resending…' : 'Resend OTP'}
          </Button>
        </form>
        <p className="mt-6 text-sm">
          <Link to="/">← Different Auto Number</Link>
        </p>
      </Panel>
    </Shell>
  );
}
