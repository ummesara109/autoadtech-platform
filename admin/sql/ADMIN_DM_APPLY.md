# Admin Device Management — SQL apply instructions

**Do not auto-run these against production.** Apply only after review in the Admin Supabase SQL editor (or `psql` against the Admin project).

## Order

1. `202603190001_admin_dm_registry.sql`
2. `202603190002_admin_dm_credentials.sql`
3. `202603190003_admin_dm_heartbeat_telemetry.sql`
4. `202603190004_admin_dm_activity_assignments.sql`
5. `202603190005_admin_dm_config_commands.sql`
6. `202603190006_admin_dm_rls_realtime.sql`
7. `202603190007_admin_dm_deepen.sql` (registry/telemetry/command deepen — Phases 1–12)
8. `202603190008_admin_dm_rls_service_notes.sql` (deny anon/authenticated; service-role only)
9. `202611230001_campaign_device_assignments.sql` (requires the advertiser `campaigns` and `locations` tables and CMS vehicle/screen/queue tables)

## Safety

- All statements are `CREATE … IF NOT EXISTS` / `ADD` / enable RLS / optional Realtime.
- No `DROP`, `TRUNCATE`, or Advertiser schema changes.
- Does not alter `admin_devices` (Live markers), `cms_admin_vehicle_gps`, or CMS tables.
- No seed/demo production devices.
- Campaign assignment tables use service-role access only; no client policy is added.
- Apply `cms/supabase/migrations/202611230001_campaign_queue_idempotency.sql` to the same Supabase project before enabling Admin queue delivery.

## Local without Supabase

Admin Device Management falls back to `admin/data/admin-dm.json` when Supabase env is missing or DM tables are not yet applied. Apply SQL when you want relational persistence in Admin Supabase.

## Env (optional)

```
DM_HEARTBEAT_INTERVAL_SEC=30
DM_OFFLINE_TIMEOUT_SEC=90
DM_COMMAND_TTL_SEC=3600
DM_CREDENTIAL_TTL_DAYS=365
DM_HEALTH_BATTERY_WARN=15
DM_HEALTH_STORAGE_WARN_MB=200
# Optional future MQTT (adapter stub only until broker wired)
# DM_MQTT_URL=
# DM_MQTT_TOPIC_PREFIX=niyoads/dm
```

## Dev simulator (not production)

```bash
node scripts/dm-player-simulator.js --base http://127.0.0.1:3001 --label "DEV SIMULATOR"
```

Clearly labelled — never treat simulator connectivity as production devices.
