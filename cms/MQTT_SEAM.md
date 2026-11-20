# Device / ad-delivery seam (MQTT — future)

## Boundary

The NestJS CMS API is the **operator console** and **queue authority** for assign/append/complete rules. It must **not** own:

- Real-time device sockets (**no Socket.IO**, no WS fan-out from Nest for devices)
- Physical player rendering on the screen
- GPS / telematics ingest

Those belong to a **separate MQTT (or equivalent) worker / broker path**.

```
┌─────────────┐     REST      ┌──────────────┐
│  CMS PWA    │ ────────────► │  NestJS CMS  │ ──► Supabase (read models)
└─────────────┘               │  QueueService│
                              └──────┬───────┘
                                     ▲
                     x-cms-internal-key / SQL
                                     │
                              ┌──────┴───────┐
                              │ MQTT worker  │ ◄── devices / players
                              │ (future)     │
                              └──────────────┘
```

## Queue rules (Nest owns)

| Rule | Behavior |
| --- | --- |
| Assign while PLAYING | **Append** as `QUEUED` — never interrupt |
| Idle screen | First `QUEUED` promotes to `PLAYING` |
| States | `QUEUED` → `PLAYING` → `COMPLETED` \| `FAILED`; `QUEUED` → `CANCELLED` |
| Concurrency | One `PLAYING` per screen (unique index + screen lock) |
| Isolation | Queue rows scoped by `screen_id` / `vehicle_id` |
| History | Written only when PLAYING completes/fails — **no fake history** |

### Worker HTTP seam (prepared)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/queue/assign` | Append ads (`x-cms-internal-key`) |
| POST | `/api/queue/complete` | ACK finished PLAYING → advance |
| POST | `/api/queue/fail` | ACK failed PLAYING → advance |
| POST | `/api/queue/cancel` | Cancel a QUEUED item |

Set `CMS_INTERNAL_KEY` in production. With `CMS_DEV_AUTH=true` and no key, assign endpoints are open for local testing only.

## Tables

| Table | Writer | CMS API role |
| --- | --- | --- |
| `cms_device_status` | MQTT / device agent | Read for dashboard |
| `cms_vehicle_location` | Telematics / MQTT | Read (empty until populated) |
| `cms_ad_queue` | Nest QueueService (+ worker ACKs) | Manage + read |
| `cms_playback_history` | Nest on complete/fail | Read |

## Why not Socket.IO in Nest

Socket.IO would couple device traffic to the console API process. MQTT keeps device fan-out independent and AWS-friendly (IoT Core / Mosquitto sidecar).

## Leftovers / not implemented

- No MQTT broker started in this repo
- No physical player process
- Dashboard empty states until worker assigns ads / writes GPS
