import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { OtpPage } from './pages/OtpPage';
import { DisplayScreen } from './pages/DisplayScreen';

export default function App() {
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
