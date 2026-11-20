import { Navigate } from 'react-router-dom';

/** Screen selection removed — Auto Display uses the session’s single screen. */
export function ScreensPage() {
  return <Navigate to="/display" replace />;
}
