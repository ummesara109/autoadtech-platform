import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api, type DashboardResponse } from '../lib/api';
import { clearSession, loadSession } from '../lib/session';
import {
  getSilentGpsError,
  getSilentGpsStatus,
  startSilentGps,
  stopSilentGps,
  type SilentGpsStatus,
} from '../lib/silentGps';

/** Top-left corner long-press (ms) to open operator chrome — not discoverable by passengers. */
const OPS_LONG_PRESS_MS = 2800;
const OPS_HOTZONE_PX = 56;
/** Operator chrome (incl. Log out) auto-hides after this many ms (1 minute). */
const OPS_VISIBLE_MS = 60_000;
const POLL_ONLINE_MS = 8_000;
const POLL_OFFLINE_MS = 4_000;
const POLL_BACKOFF_MAX_MS = 30_000;
const IMAGE_DEFAULT_DWELL_MS = 15_000;
/** Image creatives only — videos must not enter Cache Storage (Range breakage). */
const MEDIA_CACHE = 'cms-ad-media-images-v2';
/** Same demo OTP as login (`OtpPage` / API seed). */
const DEFAULT_LOGOUT_OTP = '123456';
const OTP_LEN = 6;

/** Demo OTP 123456; override with VITE_LOGOUT_OTP or ?logoutOtp= / ?otp= */
function resolveLogoutOtp(search: URLSearchParams): string {
  const fromQuery = (search.get('logoutOtp') ?? search.get('otp') ?? '').trim();
  if (/^\d{6}$/.test(fromQuery)) return fromQuery;
  const fromEnv = String(import.meta.env.VITE_LOGOUT_OTP ?? '').trim();
  if (/^\d{6}$/.test(fromEnv)) return fromEnv;
  return DEFAULT_LOGOUT_OTP;
}

function isPlayableMediaUrl(url: string | null | undefined): url is string {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  // Absolute http(s) or same-origin relative path (works through HTTPS tunnels)
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  return false;
}

function isVideoUrl(url: string) {
  return /\.(mp4|webm|ogg|m4v)(\?|$)/i.test(url) || /\/video\//i.test(url);
}

function requestDisplayFullscreen(el: HTMLElement | null) {
  if (!el) return;
  const anyEl = el as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
  };
  try {
    if (document.fullscreenElement) return;
    if (typeof anyEl.requestFullscreen === 'function') {
      void anyEl.requestFullscreen().catch(() => {
        /* browser may require a gesture; kiosk MDMs force this separately */
      });
      return;
    }
    if (typeof anyEl.webkitRequestFullscreen === 'function') {
      void anyEl.webkitRequestFullscreen();
    } else if (typeof anyEl.msRequestFullscreen === 'function') {
      void anyEl.msRequestFullscreen();
    }
  } catch {
    /* ignore — CSS/PWA fullscreen is the primary path */
  }
}

/**
 * Prefetch upcoming creatives as opaque network warm-up only.
 * Do NOT put videos into Cache API — full-body puts break Range requests used by
 * video elements on mobile Chrome / installed PWAs (black screen after media_playback_error).
 */
async function warmCreativeUrl(url: string) {
  if (!url || isVideoUrl(url)) return;
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(MEDIA_CACHE);
    const hit = await cache.match(url);
    if (hit) return;
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (res.ok) await cache.put(url, res.clone());
  } catch {
    /* ignore — images only */
  }
}

function ensureInlineMuted(el: HTMLVideoElement | null) {
  if (!el) return;
  el.muted = true;
  el.defaultMuted = true;
  el.playsInline = true;
  el.setAttribute('muted', '');
  el.setAttribute('playsinline', '');
  el.setAttribute('webkit-playsinline', '');
  el.setAttribute('autoplay', '');
}

async function tryPlay(el: HTMLVideoElement | null) {
  if (!el) return;
  ensureInlineMuted(el);
  try {
    await el.play();
  } catch {
    // Retry once after a short delay (Safari / Chrome autoplay quirks over tunnel).
    window.setTimeout(() => {
      ensureInlineMuted(el);
      void el.play().catch(() => undefined);
    }, 250);
  }
}

/**
 * Full-viewport landscape ad player (always horizontal — no H/V toggle).
 * Portrait phones: CSS-rotate stage 90° (+ best-effort orientation.lock) so playback
 * looks like landscape fullscreen; object-fit: contain (whole creative, no cover crop).
 * Log out visible ~1 min after load; then long-press / brief corner tap / ?ops=1.
 * Logout requires demo OTP 123456 (same as login). Dual video slots for seamless swaps.
 * Ad stage blocks all touch; only Log out (when visible) and OTP dialog stay interactive.
 */
export function DisplayScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const session = loadSession();
  const rootRef = useRef<HTMLDivElement>(null);
  const slotRefs = [
    useRef<HTMLVideoElement>(null),
    useRef<HTMLVideoElement>(null),
  ] as const;
  const longPressTimer = useRef<number | null>(null);
  const opsHideTimer = useRef<number | null>(null);
  const advancingRef = useRef(false);
  const missingMediaHandled = useRef<string | null>(null);
  const imageTimer = useRef<number | null>(null);
  const pollBackoff = useRef(POLL_ONLINE_MS);
  const activeSlotRef = useRef<0 | 1>(0);
  const playingIdRef = useRef<string | null>(null);
  const swapGenRef = useRef(0);
  const [data, setData] = useState<DashboardResponse | null>(null);
  // After login/display load: Log out visible for OPS_VISIBLE_MS (1 min). ?ops=0 forces hidden.
  const [opsOpen, setOpsOpen] = useState(() => {
    const v = searchParams.get('ops') ?? searchParams.get('unlock');
    if (v === '0' || v === 'false') return false;
    return true;
  });
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpDigits, setOtpDigits] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState(false);
  const [gpsError, setGpsError] = useState(getSilentGpsError);
  const [gpsStatus, setGpsStatus] =
    useState<SilentGpsStatus>(getSilentGpsStatus);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const [slotSrc, setSlotSrc] = useState<[string | null, string | null]>([
    null,
    null,
  ]);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [viewportPortrait, setViewportPortrait] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(orientation: portrait)').matches
      : false,
  );
  const expectedLogoutOtp = resolveLogoutOtp(searchParams);

  useEffect(() => {
    const onGpsStatus = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          status: SilentGpsStatus;
          error: string | null;
        }>
      ).detail;
      setGpsStatus(detail.status);
      setGpsError(detail.error);
    };
    window.addEventListener('niyoads:gps-status', onGpsStatus);
    return () => window.removeEventListener('niyoads:gps-status', onGpsStatus);
  }, []);
  const rotateStage = viewportPortrait && searchParams.get('noRotate') !== '1';

  function clearOpsHideTimer() {
    if (opsHideTimer.current) {
      window.clearTimeout(opsHideTimer.current);
      opsHideTimer.current = null;
    }
  }

  function scheduleOpsHide() {
    clearOpsHideTimer();
    opsHideTimer.current = window.setTimeout(() => {
      opsHideTimer.current = null;
      setOpsOpen(false);
    }, OPS_VISIBLE_MS);
  }

  function openOpsChrome() {
    setOpsOpen(true);
  }

  function openLogoutOtp() {
    clearOpsHideTimer();
    setOtpDigits('');
    setOtpError(null);
    setOtpOpen(true);
  }

  function closeLogoutOtp() {
    setOtpOpen(false);
    setOtpDigits('');
    setOtpError(null);
    if (opsOpen) scheduleOpsHide();
  }

  function appendOtpDigit(d: string) {
    setOtpError(null);
    setOtpDigits((prev) => {
      if (prev.length >= OTP_LEN) return prev;
      const next = prev + d;
      if (next.length === expectedLogoutOtp.length) {
        window.setTimeout(() => verifyLogoutOtp(next), 0);
      }
      return next;
    });
  }

  function backspaceOtp() {
    setOtpError(null);
    setOtpDigits((prev) => prev.slice(0, -1));
  }

  function verifyLogoutOtp(digits: string) {
    if (digits === expectedLogoutOtp) {
      void doLogout();
      return;
    }
    setOtpError('Incorrect OTP');
    setOtpDigits('');
  }

  function submitLogoutOtp() {
    verifyLogoutOtp(otpDigits);
  }

  async function doLogout() {
    const token = session?.accessToken;
    // Stop silent GPS before clearing session (token still needed for /location/stop).
    void stopSilentGps(token);
    // Leave the display immediately — don't block on network logout.
    clearSession();
    navigate('/', { replace: true });
    if (token) {
      try {
        await api.logout(token);
      } catch {
        /* ignore */
      }
    }
  }

  useEffect(() => {
    if (!session?.accessToken) {
      navigate('/', { replace: true });
      return;
    }
    // Resume silent GPS if page reloaded while session alive (no GPS UI).
    void startSilentGps(session.accessToken);

    let cancelled = false;
    let timer: number | undefined;

    async function load() {
      try {
        const dash = await api.dashboard(session!.accessToken);
        if (!cancelled) {
          setData(dash);
          pollBackoff.current = POLL_ONLINE_MS;
        }
      } catch (err) {
        if (!cancelled) {
          // Keep last dashboard snapshot when offline; only clear creative on auth loss.
          if (
            err instanceof ApiError &&
            (err.status === 401 || err.status === 403)
          ) {
            void stopSilentGps(session?.accessToken);
            clearSession();
            navigate('/', { replace: true });
            return;
          }
          pollBackoff.current = Math.min(
            pollBackoff.current * 1.5,
            POLL_BACKOFF_MAX_MS,
          );
        }
      } finally {
        if (!cancelled) {
          const base = navigator.onLine ? pollBackoff.current : POLL_OFFLINE_MS;
          timer = window.setTimeout(() => void load(), base);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  // Soft-lock: discourage accidental leave. Cannot block Android system nav / Home.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    const guardToken = 'cms-display-kiosk';
    try {
      if (window.history.state?.cmsDisplayKiosk !== true) {
        window.history.pushState(
          { cmsDisplayKiosk: true, guardToken },
          '',
          window.location.href,
        );
      }
    } catch {
      /* ignore */
    }
    const onPopState = () => {
      try {
        window.history.pushState(
          { cmsDisplayKiosk: true, guardToken },
          '',
          window.location.href,
        );
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  // Best-effort browser fullscreen (MDM/kiosk still required on Android).
  useEffect(() => {
    requestDisplayFullscreen(rootRef.current);
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        requestDisplayFullscreen(rootRef.current);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Portrait phone: track orientation + best-effort Screen Orientation API lock.
  // CSS rotate is the reliable path; lock often needs fullscreen / installed PWA.
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const sync = () => setViewportPortrait(mq.matches);
    sync();
    mq.addEventListener('change', sync);

    const tryLockLandscape = () => {
      const orientApi = screen.orientation as ScreenOrientation & {
        lock?: (orientation: string) => Promise<void>;
      };
      if (typeof orientApi?.lock !== 'function') return;
      void orientApi.lock('landscape').catch(() => {
        /* ignored — CSS rotate handles portrait phones */
      });
    };
    tryLockLandscape();
    const onVis = () => {
      if (document.visibilityState === 'visible') tryLockLandscape();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      mq.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', onVis);
      try {
        screen.orientation?.unlock?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
      if (imageTimer.current) window.clearTimeout(imageTimer.current);
      clearOpsHideTimer();
    };
  }, []);

  // Ops chrome (Log out included) visible ~1 min, then auto-hide. Pause while OTP dialog open.
  useEffect(() => {
    if (!opsOpen || otpOpen) {
      clearOpsHideTimer();
      return;
    }
    scheduleOpsHide();
    return () => clearOpsHideTimer();
  }, [opsOpen, otpOpen]);

  const playing = data?.currentlyPlaying ?? null;
  const mediaUrl = playing?.mediaUrl ?? null;
  const canShowCreative = isPlayableMediaUrl(mediaUrl) && !mediaError;

  async function refreshDashboard() {
    if (!session?.accessToken) return;
    try {
      const dash = await api.dashboard(session.accessToken);
      setData(dash);
      setMediaError(false);
      pollBackoff.current = POLL_ONLINE_MS;
    } catch {
      /* keep last frame; poll loop continues */
    }
  }

  async function advanceComplete(queueItemId: string) {
    if (!session?.accessToken || advancingRef.current) return;
    advancingRef.current = true;
    try {
      await api.playerComplete(session.accessToken, queueItemId);
      await refreshDashboard();
    } catch {
      /* conflict / offline — next poll will resync */
      await refreshDashboard();
    } finally {
      advancingRef.current = false;
    }
  }

  async function advanceFail(queueItemId: string, reason: string) {
    if (!session?.accessToken || advancingRef.current) return;
    advancingRef.current = true;
    try {
      await api.playerFail(session.accessToken, queueItemId, reason);
      await refreshDashboard();
    } catch {
      await refreshDashboard();
    } finally {
      advancingRef.current = false;
    }
  }

  // Warm upcoming image creatives only (videos stay NetworkOnly — see vite SW).
  useEffect(() => {
    if (canShowCreative && mediaUrl) {
      void warmCreativeUrl(mediaUrl);
    }
    const upcoming = data?.upcomingQueue ?? [];
    for (const item of upcoming) {
      if (isPlayableMediaUrl(item.mediaUrl)) {
        void warmCreativeUrl(item.mediaUrl);
      }
    }
  }, [canShowCreative, mediaUrl, data?.upcomingQueue]);

  // Dual-slot video: keep showing previous ad until next slot can play.
  useEffect(() => {
    if (!playing?.id || !isPlayableMediaUrl(mediaUrl)) {
      playingIdRef.current = null;
      setSlotSrc([null, null]);
      setImageSrc(null);
      return;
    }

    if (!isVideoUrl(mediaUrl)) {
      playingIdRef.current = playing.id;
      setImageSrc(mediaUrl);
      setSlotSrc([null, null]);
      return;
    }

    setImageSrc(null);
    if (playingIdRef.current === playing.id) return;

    const gen = ++swapGenRef.current;
    const currentActive = activeSlotRef.current;
    const currentSrc = slotSrc[currentActive];

    // First video or empty: load onto active slot immediately.
    if (!currentSrc) {
      playingIdRef.current = playing.id;
      setSlotSrc((prev) => {
        const next: [string | null, string | null] = [prev[0], prev[1]];
        next[currentActive] = mediaUrl;
        return next;
      });
      requestAnimationFrame(() => {
        void tryPlay(slotRefs[currentActive].current);
      });
      return;
    }

    if (currentSrc === mediaUrl) {
      playingIdRef.current = playing.id;
      void tryPlay(slotRefs[currentActive].current);
      return;
    }

    const inactive: 0 | 1 = currentActive === 0 ? 1 : 0;
    setSlotSrc((prev) => {
      const next: [string | null, string | null] = [prev[0], prev[1]];
      next[inactive] = mediaUrl;
      return next;
    });

    const promote = () => {
      if (swapGenRef.current !== gen) return;
      activeSlotRef.current = inactive;
      playingIdRef.current = playing.id;
      setActiveSlot(inactive);
      void tryPlay(slotRefs[inactive].current);
      const other = slotRefs[currentActive].current;
      try {
        other?.pause();
      } catch {
        /* ignore */
      }
    };

    // Wait a tick so React applies inactive src, then listen for readiness.
    const timer = window.setTimeout(() => {
      if (swapGenRef.current !== gen) return;
      const el = slotRefs[inactive].current;
      if (!el) {
        promote();
        return;
      }
      if (el.readyState >= 3) {
        promote();
        return;
      }
      const onReady = () => {
        el.removeEventListener('canplay', onReady);
        el.removeEventListener('loadeddata', onReady);
        promote();
      };
      el.addEventListener('canplay', onReady);
      el.addEventListener('loadeddata', onReady);
      try {
        el.load();
      } catch {
        /* ignore */
      }
      window.setTimeout(() => {
        el.removeEventListener('canplay', onReady);
        el.removeEventListener('loadeddata', onReady);
        promote();
      }, 3000);
    }, 50);

    return () => {
      window.clearTimeout(timer);
    };
    // slotSrc intentionally omitted — we only react to PLAYING identity/url changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing?.id, mediaUrl]);

  // Warm inactive slot with next queued video while current plays.
  useEffect(() => {
    const upcoming = data?.upcomingQueue ?? [];
    const nextUrl = upcoming.find(
      (item) => isPlayableMediaUrl(item.mediaUrl) && isVideoUrl(item.mediaUrl),
    )?.mediaUrl;
    if (!nextUrl || nextUrl === mediaUrl) return;
    const inactive: 0 | 1 = activeSlotRef.current === 0 ? 1 : 0;
    setSlotSrc((prev) => {
      if (prev[inactive] === nextUrl) return prev;
      // Don't overwrite a slot currently holding the active creative.
      if (prev[inactive] && prev[inactive] === mediaUrl) return prev;
      const next: [string | null, string | null] = [prev[0], prev[1]];
      next[inactive] = nextUrl;
      return next;
    });
  }, [data?.upcomingQueue, mediaUrl, activeSlot]);

  // PLAYING without a valid mediaUrl → fail + promote next (or black idle).
  useEffect(() => {
    if (!playing?.id) {
      missingMediaHandled.current = null;
      return;
    }
    if (isPlayableMediaUrl(playing.mediaUrl)) return;
    if (missingMediaHandled.current === playing.id) return;
    missingMediaHandled.current = playing.id;
    void advanceFail(playing.id, 'missing_media_url');
  }, [playing?.id, playing?.mediaUrl]);

  // Image dwell: after durationSec, complete and advance.
  useEffect(() => {
    if (imageTimer.current) {
      window.clearTimeout(imageTimer.current);
      imageTimer.current = null;
    }
    if (!canShowCreative || !mediaUrl || !playing?.id) return;
    if (isVideoUrl(mediaUrl)) return;
    const dwellMs = Math.max(
      3_000,
      (playing.durationSec && playing.durationSec > 0
        ? playing.durationSec
        : IMAGE_DEFAULT_DWELL_MS / 1000) * 1000,
    );
    imageTimer.current = window.setTimeout(() => {
      void advanceComplete(playing.id);
    }, dwellMs);
    return () => {
      if (imageTimer.current) {
        window.clearTimeout(imageTimer.current);
        imageTimer.current = null;
      }
    };
  }, [canShowCreative, mediaUrl, playing?.id, playing?.durationSec]);

  // Media load/decode error → fail current and fetch next (or black).
  useEffect(() => {
    if (!mediaError || !playing?.id) return;
    void advanceFail(playing.id, 'media_playback_error');
  }, [mediaError, playing?.id]);

  function clearLongPress() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function startOpsLongPress(clientX: number, clientY: number) {
    clearLongPress();
    if (clientX > OPS_HOTZONE_PX || clientY > OPS_HOTZONE_PX) return;
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      openOpsChrome();
    }, OPS_LONG_PRESS_MS);
  }

  /** Brief corner tap (hotzone) also reveals ops — same as long-press unlock. */
  function onCornerBriefTap(clientX: number, clientY: number) {
    if (clientX > OPS_HOTZONE_PX || clientY > OPS_HOTZONE_PX) return;
    if (opsOpen || otpOpen) return;
    openOpsChrome();
  }

  function blockSurfaceInteraction(e: SyntheticEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  const showVideoFrame = Boolean(
    canShowCreative &&
    mediaUrl &&
    isVideoUrl(mediaUrl) &&
    (slotSrc[0] || slotSrc[1]),
  );
  const showImageFrame = Boolean(canShowCreative && imageSrc);

  return (
    <div
      ref={rootRef}
      className={`display-root display-kiosk relative h-dvh w-dvw overflow-hidden bg-black text-[var(--cms-ink)]${
        opsOpen ? '' : ' display-kiosk--locked'
      }${rotateStage ? ' display-root--portrait-rotate' : ''}`}
      role="presentation"
      onContextMenu={blockSurfaceInteraction}
      onDragStart={blockSurfaceInteraction}
      onClick={(e) => {
        e.preventDefault();
      }}
      onDoubleClick={blockSurfaceInteraction}
      onPointerDown={(e) => {
        if (e.button === 2) {
          e.preventDefault();
          return;
        }
        startOpsLongPress(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        const started = longPressTimer.current != null;
        clearLongPress();
        // Brief corner tap: pointer up before long-press fires → reveal ops ~1 min
        if (started) onCornerBriefTap(e.clientX, e.clientY);
      }}
      onPointerCancel={clearLongPress}
      onPointerLeave={clearLongPress}
      onTouchStart={(e) => {
        // Swallow multi-touch / pinch on the stage; allow single-finger hotzone only
        if (e.touches.length > 1) e.preventDefault();
      }}
      onTouchMove={(e) => {
        e.preventDefault();
        clearLongPress();
      }}
      onTouchEnd={(e) => {
        if (e.touches.length === 0) clearLongPress();
      }}
      onWheel={blockSurfaceInteraction}
      onScroll={blockSurfaceInteraction}
    >
      {/* Signage stage — landscape fullscreen; portrait phones CSS-rotated 90°.
          pointer-events/touch-action none so ads never take gestures; root still gets
          top-left long-press. Only Log out + OTP overlay are interactive. */}
      <div
        className="display-stage absolute inset-0 flex items-center justify-center bg-black"
        aria-hidden="true"
      >
        {showVideoFrame || showImageFrame ? (
          <div
            className="display-frame display-frame--landscape relative overflow-hidden bg-black"
            data-orient="landscape"
          >
            {showVideoFrame ? (
              <>
                {([0, 1] as const).map((slot) => (
                  <video
                    key={`slot-${slot}`}
                    ref={(el) => {
                      slotRefs[slot].current = el;
                      ensureInlineMuted(el);
                    }}
                    className={`display-media absolute inset-0 h-full w-full object-contain bg-black ${
                      activeSlot === slot
                        ? 'z-[1] opacity-100'
                        : 'z-0 opacity-0'
                    }`}
                    src={slotSrc[slot] ?? undefined}
                    muted
                    playsInline
                    preload="auto"
                    autoPlay={activeSlot === slot}
                    controls={false}
                    disablePictureInPicture
                    disableRemotePlayback
                    controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
                    onContextMenu={blockSurfaceInteraction}
                    onClick={blockSurfaceInteraction}
                    onLoadedData={() => {
                      if (activeSlot === slot)
                        void tryPlay(slotRefs[slot].current);
                    }}
                    onCanPlay={() => {
                      if (activeSlot === slot)
                        void tryPlay(slotRefs[slot].current);
                    }}
                    onEnded={() => {
                      if (activeSlot === slot && playing?.id) {
                        void advanceComplete(playing.id);
                      }
                    }}
                    onError={() => {
                      if (activeSlot === slot) setMediaError(true);
                    }}
                  />
                ))}
              </>
            ) : (
              <img
                className="display-media absolute inset-0 h-full w-full object-contain bg-black"
                src={imageSrc!}
                alt=""
                draggable={false}
                onContextMenu={blockSurfaceInteraction}
                onClick={blockSurfaceInteraction}
                onError={() => setMediaError(true)}
              />
            )}
          </div>
        ) : null}
      </div>

      {gpsError ? (
        <div
          className="pointer-events-none absolute inset-x-3 bottom-3 z-20 mx-auto max-w-xl rounded-lg border border-amber-400/40 bg-amber-950/90 px-3 py-2 text-center text-xs text-amber-100"
          role="alert"
          aria-live="polite"
        >
          {gpsError}
        </div>
      ) : gpsStatus !== 'idle' ? (
        <div
          className={`pointer-events-none absolute inset-x-3 bottom-3 z-20 mx-auto max-w-xl rounded-lg border px-3 py-2 text-center text-xs ${
            gpsStatus === 'active'
              ? 'border-emerald-400/40 bg-emerald-950/90 text-emerald-100'
              : 'border-slate-400/40 bg-slate-950/90 text-slate-100'
          }`}
          role="status"
          aria-live="polite"
        >
          {gpsStatus === 'requesting'
            ? 'Requesting phone location permission…'
            : gpsStatus === 'waiting'
              ? 'Location permission granted; waiting for a GPS fix…'
              : gpsStatus === 'sending'
                ? 'GPS captured; sending update to CMS and Admin…'
                : gpsStatus === 'pending'
                  ? 'GPS captured; Admin forwarding is pending.'
                  : 'Live GPS is active; Admin tracking is up to date.'}
        </div>
      ) : null}

      {/* Compact Log out — top-right, visible ~1 min after load/unlock */}
      {opsOpen ? (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-end safe-top px-2 py-1.5"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="display-ops-logout pointer-events-auto rounded border border-[var(--cms-border)] bg-black/75 px-2 py-0.5 text-[10px] font-semibold leading-tight tracking-wide backdrop-blur-md"
            onClick={openLogoutOtp}
          >
            Log out
          </button>
        </div>
      ) : null}

      {/* Logout OTP pad — same demo code as login */}
      {otpOpen ? (
        <div
          className="display-pin-overlay absolute inset-0 z-30 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Enter logout OTP"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="display-pin-dialog w-full max-w-[280px] rounded-xl border border-[var(--cms-border)] bg-[var(--cms-bg-elevated)] p-4 shadow-lg">
            <p className="text-center text-sm font-semibold">
              Enter OTP to log out
            </p>
            <p
              className="mt-3 flex justify-center gap-2 tracking-[0.35em] text-lg font-semibold"
              aria-live="polite"
            >
              {Array.from({ length: OTP_LEN }).map((_, i) => (
                <span
                  key={i}
                  className="inline-block h-2.5 w-2.5 rounded-full border border-white/40"
                  style={{
                    background:
                      i < otpDigits.length
                        ? 'var(--cms-accent)'
                        : 'transparent',
                  }}
                />
              ))}
            </p>
            {otpError ? (
              <p className="mt-2 text-center text-xs text-[var(--cms-danger)]">
                {otpError}
              </p>
            ) : (
              <p className="mt-2 text-center text-[10px] text-[var(--cms-muted)]">
                Demo OTP 123456
              </p>
            )}
            <div className="display-pin-pad mt-3 grid grid-cols-3 gap-2">
              {[
                '1',
                '2',
                '3',
                '4',
                '5',
                '6',
                '7',
                '8',
                '9',
                '⌫',
                '0',
                'OK',
              ].map((key) => (
                <button
                  key={key}
                  type="button"
                  className="display-pin-key rounded-lg border border-[var(--cms-border)] bg-black/40 py-2.5 text-sm font-semibold text-white"
                  onClick={() => {
                    if (key === '⌫') backspaceOtp();
                    else if (key === 'OK') submitLogoutOtp();
                    else appendOtpDigit(key);
                  }}
                >
                  {key}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 w-full rounded-lg border border-[var(--cms-border)] py-2 text-xs font-semibold text-[var(--cms-muted)]"
              onClick={closeLogoutOtp}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
