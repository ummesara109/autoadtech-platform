import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { PwaInstallHint } from '../components/PwaInstallHint';
import {
  Alert,
  BrandMark,
  Button,
  Field,
  Panel,
  Shell,
  Title,
} from '../components/ui';
import { useOnline } from '../hooks/useOnline';

export function LoginPage() {
  const navigate = useNavigate();
  const online = useOnline();
  const [autoNumber, setAutoNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!navigator.onLine) {
      setError(
        'You’re offline. Auto Number lookup needs a network connection.',
      );
      return;
    }
    setLoading(true);
    try {
      const result = await api.lookup(autoNumber.trim());
      navigate('/otp', { state: result });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell narrow>
      <BrandMark />
      {!online ? (
        <Alert tone="warn">
          Offline — install still works; sign-in needs network.
        </Alert>
      ) : null}
      <Panel className="mt-4 w-full">
        <Title subtitle="Enter the vehicle Auto Number. After OTP you’ll open the full-screen Auto Display for that vehicle’s screen.">
          Sign in with Auto Number
        </Title>
        <form className="space-y-4" onSubmit={onSubmit}>
          <Field
            label="Auto Number"
            name="autoNumber"
            autoComplete="off"
            inputMode="text"
            placeholder="e.g. KA01AB1234"
            value={autoNumber}
            onChange={(e) => setAutoNumber(e.target.value.toUpperCase())}
            required
            minLength={4}
            maxLength={20}
          />
          {error ? <Alert>{error}</Alert> : null}
          <Button
            type="submit"
            className="w-full"
            disabled={loading || !autoNumber.trim()}
          >
            {loading ? 'Checking…' : 'Continue'}
          </Button>
        </form>
        <p className="mt-6 text-xs text-[var(--cms-muted)]">
          Local dev seed: <code>KA01AB1234</code> or <code>KA02CD5678</code>.
          Temporary Production demo testing: <code>KA01AB0000</code>; its OTP is
          shown only when enabled by the CMS server.
        </p>
      </Panel>
      <PwaInstallHint />
      <p className="mt-3 text-center text-xs text-[var(--cms-muted)]">
        Phone install needs HTTPS (Cloudflare Tunnel / ngrok). Chrome: Install
        app · iOS: Share → Add to Home Screen.
      </p>
    </Shell>
  );
}
