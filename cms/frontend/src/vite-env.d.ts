/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Absolute Nest API origin for Capacitor Android FGS (required on device). */
  readonly VITE_NATIVE_API_URL?: string;
  /** Optional logout OTP override (default demo: 123456, same as login). Also ?logoutOtp= */
  readonly VITE_LOGOUT_OTP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
