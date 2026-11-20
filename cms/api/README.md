# CMS API (NestJS + Fastify)

See [../README.md](../README.md) for run instructions.

- No Express — bootstrap uses `@nestjs/platform-fastify`
- Auth: Auto Number lookup → Supabase phone OTP (or `CMS_DEV_AUTH` OTP `123456`)
- Modules: `auth`, `screens`, `dashboard`, `redis`, `supabase`
- Device MQTT is out of process — [../MQTT_SEAM.md](../MQTT_SEAM.md)
