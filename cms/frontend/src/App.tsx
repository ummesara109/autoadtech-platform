import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { OtpPage } from './pages/OtpPage';
import { DisplayScreen } from './pages/DisplayScreen';

export default function App() {
  const { pathname } = useLocation();

  useEffect(() => {
    const lockLandscape = () => {
      const installed =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
      if (!installed) return;

      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (orientation: string) => Promise<void>;
      };
      if (typeof orientation?.lock !== 'function') return;
      void orientation.lock('landscape').catch(() => {
        /* The manifest and display page provide their own orientation handling. */
      });
    };

    lockLandscape();
    document.addEventListener('visibilitychange', lockLandscape);
    return () =>
      document.removeEventListener('visibilitychange', lockLandscape);
  }, [pathname]);

  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/otp" element={<OtpPage />} />
      <Route path="/display" element={<DisplayScreen />} />
      {/* Legacy dashboard / picker URLs → fullscreen display */}
      <Route path="/dashboard" element={<Navigate to="/display" replace />} />
      <Route path="/dashboard/:screenId" element={<Navigate to="/display" replace />} />
      <Route path="/screens" element={<Navigate to="/display" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
