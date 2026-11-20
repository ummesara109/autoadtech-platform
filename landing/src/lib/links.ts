// Integrated mode (http://localhost:4000): use /app/ and /admin/ on the same host.
// Separate ports: set VITE_DASHBOARD_URL and VITE_ADMIN_URL in landing/.env (see LOCAL.md).
export const DASHBOARD_URL: string =
  import.meta.env.VITE_DASHBOARD_URL ?? "/app/";

export const ADMIN_URL: string =
  import.meta.env.VITE_ADMIN_URL ?? "/admin/";
