import { Navigate } from 'react-router-dom';

/** Legacy dashboard route — Auto Display PWA uses /display. */
export function DashboardPage() {
  return <Navigate to="/display" replace />;
}
