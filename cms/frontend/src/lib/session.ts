import type { SessionResponse } from './api';

const KEY = 'cms.session.v1';

export function loadSession(): SessionResponse | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionResponse;
    // Normalize older sessions that only had screens[]
    if (!parsed.screen && parsed.screens?.length === 1) {
      parsed.screen = parsed.screens[0];
    }
    return parsed;
  } catch {
    return null;
  }
}

export function hasSessionCredential(
  session: SessionResponse | null | undefined,
): session is SessionResponse {
  return Boolean(
    session && (session.accessToken || session.sessionMode === 'demo-cookie'),
  );
}

export function saveSession(session: SessionResponse) {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(KEY);
  localStorage.removeItem('cms.selectedScreen.v1');
}
