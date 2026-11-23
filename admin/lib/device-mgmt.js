"use strict";

/*
  Admin Device Management (Phases 2–6).
  - Relational admin_dm_* when Supabase tables exist
  - Local JSON fallback: admin/data/admin-dm.json
  - Phone GPS (cms_admin_vehicle_gps / /api/live) is NOT used for online status
  - No fake production heartbeats or demo stats
*/

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const STORE_FILE = path.join(DATA_DIR, "admin-dm.json");

const LIFECYCLE = [
  "registered",
  "pending_activation",
  "activated", // legacy synonym of active
  "active",
  "maintenance",
  "suspended",
  "revoked"
];

const COMMAND_TYPES = [
  "request_status",
  "sync_media",
  "refresh_manifest",
  "update_config",
  "restart_player",
  "start_playback",
  "stop_playback",
  "suspend_device",
  "revoke_device",
  "disable_device"
];

const COMMAND_STATUSES = [
  "pending",
  "delivered",
  "acknowledged",
  "executing",
  "completed",
  "failed",
  "expired"
];

const mqttAdapter = require("./dm-mqtt-adapter");

function normalizeLifecycle(status) {
  const s = String(status || "registered");
  if (s === "activated") return "active";
  return s;
}

function isActiveLifecycle(status) {
  return ["registered", "pending_activation", "activated", "active", "maintenance"].includes(
    status
  );
}

const SENSITIVE_ROLES = ["Super Admin", "Admin", "Manager"];
const VIEW_ROLES = ["Super Admin", "Admin", "Manager", "Viewer", "Support"];

/** @type {object|null} */
let store = null;
let supabaseDmOk = null;

function offlineTimeoutSec(device) {
  const cfg =
    device &&
    (store.config || []).find(c => c.device_pk === device.id);
  if (cfg && cfg.offline_timeout_sec != null) {
    const n = Number(cfg.offline_timeout_sec);
    if (Number.isFinite(n) && n >= 15) return n;
  }
  const n = Number(process.env.DM_OFFLINE_TIMEOUT_SEC || 90);
  return Number.isFinite(n) && n >= 15 ? n : 90;
}

function heartbeatIntervalSec(device) {
  const cfg =
    device &&
    (store.config || []).find(c => c.device_pk === device.id);
  if (cfg && cfg.heartbeat_interval_sec != null) {
    const n = Number(cfg.heartbeat_interval_sec);
    if (Number.isFinite(n) && n >= 5) return n;
  }
  const n = Number(process.env.DM_HEARTBEAT_INTERVAL_SEC || 30);
  return Number.isFinite(n) && n >= 5 ? n : 30;
}

function healthThresholds() {
  return {
    batteryWarnPct: Number(process.env.DM_HEALTH_BATTERY_WARN || 15),
    storageWarnMb: Number(process.env.DM_HEALTH_STORAGE_WARN_MB || 200),
    tempWarnC: Number(process.env.DM_HEALTH_TEMP_WARN_C || 70),
    recentErrorWindow: Number(process.env.DM_HEALTH_ERROR_WINDOW || 5)
  };
}

function commandTtlSec() {
  const n = Number(process.env.DM_COMMAND_TTL_SEC || 3600);
  return Number.isFinite(n) && n >= 60 ? n : 3600;
}

function hasSupabaseEnv() {
  return (
    !!process.env.SUPABASE_URL &&
    !!(
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
  );
}

function getSupabase() {
  if (!hasSupabaseEnv()) return null;
  try {
    return require("../config/supabase");
  } catch (_) {
    return null;
  }
}

function emptyStore() {
  return {
    devices: [],
    credentials: [],
    heartbeats: [],
    telemetry: [],
    activity: [],
    assignments: [],
    maintenance: [],
    config: [],
    config_history: [],
    commands: []
  };
}

function readStoreFile() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    return { ...emptyStore(), ...raw };
  } catch (_) {
    return emptyStore();
  }
}

function writeStoreFile() {
  if (!store) return;
  if (process.env.VERCEL) {
    if (supabaseDmOk !== true) {
      throw new Error(
        "Device Management requires configured Supabase tables on Vercel."
      );
    }
    return;
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STORE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, STORE_FILE);
  } catch (err) {
    console.error("device-mgmt local persist failed:", err.message);
  }
}

function persistLocal() {
  writeStoreFile();
}

function nid(prefix) {
  return (
    prefix +
    "-" +
    crypto.randomBytes(8).toString("hex") +
    "-" +
    Date.now().toString(36)
  );
}

function genDeviceId() {
  return "ADM-" + crypto.randomBytes(6).toString("hex").toUpperCase();
}

function genSecret() {
  return crypto.randomBytes(24).toString("base64url");
}

function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(secret), salt, 32).toString("hex");
  return salt + ":" + hash;
}

function verifySecret(secret, stored) {
  const [salt, k] = String(stored || "").split(":");
  if (!k) return false;
  const a = Buffer.from(k, "hex");
  const b = crypto.scryptSync(String(secret), salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function E(code, msg) {
  return Object.assign(new Error(msg), { code });
}

function canView(au) {
  return au && au.portal === "admin" && VIEW_ROLES.includes(au.role);
}

function canMutate(au) {
  return au && au.portal === "admin" && SENSITIVE_ROLES.includes(au.role);
}

function canSensitive(au) {
  return (
    au &&
    au.portal === "admin" &&
    (au.role === "Super Admin" || au.role === "Admin")
  );
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error((label || "operation") + " timed out after " + ms + "ms")),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function initDeviceMgmt() {
  store = readStoreFile();
  const sb = getSupabase();
  if (!sb) {
    supabaseDmOk = false;
    return { mode: "local-json" };
  }
  try {
    const probe = await withTimeout(
      sb.from("admin_dm_devices").select("id").limit(1),
      8000,
      "admin_dm_devices probe"
    );
    const { error } = probe;
    if (error) {
      console.warn(
        "admin_dm_* tables not ready — using local JSON:",
        error.message
      );
      supabaseDmOk = false;
      return { mode: "local-json", reason: error.message };
    }
    supabaseDmOk = true;
    await withTimeout(hydrateFromSupabase(sb), 15000, "admin_dm hydrate");
    return { mode: "supabase" };
  } catch (err) {
    supabaseDmOk = false;
    if (!store) store = readStoreFile();
    console.warn(
      "device-mgmt supabase init failed — using local JSON:",
      err instanceof Error ? err.message : String(err)
    );
    return { mode: "local-json" };
  }
}

const DM_TABLE_MAP = {
  devices: "admin_dm_devices",
  credentials: "admin_dm_credentials",
  heartbeats: "admin_dm_heartbeats",
  telemetry: "admin_dm_telemetry",
  activity: "admin_dm_activity",
  assignments: "admin_dm_assignments",
  maintenance: "admin_dm_maintenance",
  config: "admin_dm_config",
  config_history: "admin_dm_config_history",
  commands: "admin_dm_commands"
};

async function pushStoreToSupabase(sb, local) {
  for (const [key, table] of Object.entries(DM_TABLE_MAP)) {
    const rows = local[key] || [];
    if (!rows.length) continue;
    const { error } = await sb.from(table).upsert(rows, { onConflict: "id" });
    if (error) {
      console.warn("dm seed upsert " + table + ":", error.message);
    }
  }
}

async function hydrateFromSupabase(sb) {
  const keys = Object.keys(DM_TABLE_MAP);
  /* Parallel reads — sequential select("*") stacked multi-second latency on every boot. */
  const results = await Promise.all(
    keys.map(async key => {
      const { data, error } = await sb.from(DM_TABLE_MAP[key]).select("*");
      if (error) throw error;
      return [key, data || []];
    })
  );
  const next = emptyStore();
  results.forEach(([key, rows]) => {
    next[key] = rows;
  });

  const local = readStoreFile();
  const remoteEmpty = (next.devices || []).length === 0;
  const localHas = (local.devices || []).length > 0;

  /*
    After SQL apply, remote tables start empty. Prefer local JSON over wiping the
    registry to [] (that looked like a broken/empty hang to operators).
  */
  if (remoteEmpty && localHas) {
    store = { ...emptyStore(), ...local };
    persistLocal();
    pushStoreToSupabase(sb, store).catch(err => {
      console.warn(
        "dm local→supabase seed failed:",
        err instanceof Error ? err.message : String(err)
      );
    });
    return;
  }

  store = next;
  persistLocal();
}

async function upsertRow(table, row, conflict) {
  if (!supabaseDmOk) return;
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { error } = await sb.from(table).upsert(row, {
      onConflict: conflict || "id"
    });
    if (error) {
      console.warn(table + " upsert skipped:", error.message);
      /* Do not flip supabaseDmOk off on a single write error — that forced
         permanent JSON-only mode mid-session after SQL apply. */
    }
  } catch (err) {
    console.warn(
      table + " upsert failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

async function updateRows(table, match, patch) {
  if (!supabaseDmOk) return;
  const sb = getSupabase();
  if (!sb) return;
  let q = sb.from(table).update(patch);
  Object.entries(match).forEach(([k, v]) => {
    q = q.eq(k, v);
  });
  const { error } = await q;
  if (error) console.warn(table + " update skipped:", error.message);
}

function connectionOf(device, telemetry, now) {
  if (
    device.lifecycle_status === "revoked" ||
    device.lifecycle_status === "suspended"
  ) {
    return telemetry && telemetry.last_heartbeat_at ? "offline" : "unknown";
  }
  if (!telemetry || !telemetry.last_heartbeat_at) return "unknown";
  const age = now - Date.parse(telemetry.last_heartbeat_at || 0);
  if (!Number.isFinite(age)) return "unknown";
  return age <= offlineTimeoutSec(device) * 1000 ? "online" : "offline";
}

function recentCommandFailures(devicePk) {
  return (store.commands || []).filter(
    c =>
      c.device_pk === devicePk &&
      c.status === "failed"
  ).length;
}

function deriveHealth(device, telemetry, connection) {
  if (!telemetry || !telemetry.last_heartbeat_at) return "unknown";
  const th = healthThresholds();
  if (telemetry.error_code || telemetry.error_message) return "critical";
  if (telemetry.player_status === "error") return "critical";
  if (
    telemetry.temperature_c != null &&
    Number(telemetry.temperature_c) >= th.tempWarnC
  ) {
    return "critical";
  }
  if (
    telemetry.battery_pct != null &&
    Number(telemetry.battery_pct) < th.batteryWarnPct
  ) {
    return "warning";
  }
  if (
    telemetry.storage_free_mb != null &&
    Number(telemetry.storage_free_mb) < th.storageWarnMb
  ) {
    return "warning";
  }
  if (device && recentCommandFailures(device.id) >= 3) return "warning";
  if (connection === "offline") return "warning";
  if (connection === "online") return "healthy";
  return "unknown";
}

function publicDevice(device, now) {
  const tel =
    (store.telemetry || []).find(t => t.device_pk === device.id) || null;
  const connection = connectionOf(device, tel, now || Date.now());
  const health = tel
    ? tel.health_status || deriveHealth(device, tel, connection)
    : "unknown";
  const lifecycle = normalizeLifecycle(device.lifecycle_status);
  const cred = findActiveCred(device.id);
  return {
    id: device.id,
    deviceId: device.device_id,
    name: device.name,
    deviceType: device.device_type,
    deviceModel: device.device_model || null,
    manufacturer: device.manufacturer || null,
    serialNumber: device.serial_number || null,
    hardwareId: device.hardware_id || null,
    firmwareVersion: device.firmware_version || null,
    playerVersion: device.player_version || null,
    platform: device.platform,
    vehicleNo: device.vehicle_no || null,
    vehicleId: device.vehicle_id || null,
    markerDevId: device.marker_dev_id || null,
    installDate: device.install_date || null,
    registeredAt: device.registered_at,
    activatedAt: device.activated_at || null,
    lifecycleStatus: lifecycle,
    lifecycleStatusRaw: device.lifecycle_status,
    notes: device.notes || "",
    updatedAt: device.updated_at,
    connectionStatus: connection,
    playerStatus: tel ? tel.player_status || "unknown" : "unknown",
    healthStatus: health,
    lastHeartbeatAt: tel ? tel.last_heartbeat_at || null : null,
    appVersion: tel ? tel.app_version || null : null,
    networkStatus: tel ? tel.network_status || null : null,
    batteryPct: tel && tel.battery_pct != null ? tel.battery_pct : null,
    storageFreeMb:
      tel && tel.storage_free_mb != null ? tel.storage_free_mb : null,
    storageTotalMb:
      tel && tel.storage_total_mb != null ? tel.storage_total_mb : null,
    memoryUsedMb:
      tel && tel.memory_used_mb != null ? tel.memory_used_mb : null,
    memoryTotalMb:
      tel && tel.memory_total_mb != null ? tel.memory_total_mb : null,
    signalStrength:
      tel && tel.signal_strength != null ? tel.signal_strength : null,
    temperatureC:
      tel && tel.temperature_c != null ? tel.temperature_c : null,
    errorCode: tel ? tel.error_code || null : null,
    errorMessage: tel ? tel.error_message || null : null,
    deviceLat: tel && tel.lat != null ? tel.lat : null,
    deviceLng: tel && tel.lng != null ? tel.lng : null,
    lastMediaSyncAt: tel ? tel.last_media_sync_at || null : null,
    lastPlayerStartAt: tel ? tel.last_player_start_at || null : null,
    lastPlayerStopAt: tel ? tel.last_player_stop_at || null : null,
    credentials: cred
      ? {
          version: cred.version,
          createdAt: cred.created_at,
          rotatedAt: cred.rotated_at || null,
          expiresAt: cred.expires_at || null,
          lastAuthAt: cred.last_auth_at || null,
          revoked: !!cred.revoked_at
          /* secret never included */
        }
      : null,
    needingAttention:
      health === "warning" ||
      health === "critical" ||
      (lifecycle === "active" && connection === "offline")
  };
}

function findDeviceByPk(id) {
  return (store.devices || []).find(d => d.id === id || d.device_id === id);
}

function findActiveCred(devicePk) {
  return (store.credentials || []).find(
    c => c.device_pk === devicePk && !c.revoked_at
  );
}

function logActivity(device, eventType, summary, actor, meta) {
  const row = {
    id: nid("act"),
    device_pk: device.id,
    device_id: device.device_id,
    event_type: eventType,
    summary: summary || eventType,
    actor: actor || null,
    meta: meta || {},
    created_at: new Date().toISOString()
  };
  store.activity.unshift(row);
  store.activity = store.activity.slice(0, 5000);
  upsertRow("admin_dm_activity", row);
  return row;
}

function ensureDefaultConfig(device, actor) {
  let cfg = (store.config || []).find(c => c.device_pk === device.id);
  if (cfg) return cfg;
  cfg = {
    device_pk: device.id,
    device_id: device.device_id,
    version: 1,
    orientation: "landscape",
    resolution: null,
    playback: { volume: 1, loop: true },
    operating_hours: { enabled: false, start: "06:00", end: "23:00" },
    media_sync: { intervalMin: 15 },
    heartbeat_interval_sec: heartbeatIntervalSec(),
    offline_timeout_sec: offlineTimeoutSec(),
    updated_at: new Date().toISOString(),
    updated_by: actor || null
  };
  store.config.push(cfg);
  upsertRow("admin_dm_config", cfg, "device_pk");
  return cfg;
}

function ensureMarkerLink(db, device) {
  if (!db || !Array.isArray(db.devices) || !device.vehicle_no) {
    return { markerDevId: device.marker_dev_id || null, created: false };
  }
  if (device.marker_dev_id) {
    const existing = db.devices.find(d => d.dev === device.marker_dev_id);
    if (existing) {
      if (existing.vehicle !== device.vehicle_no) {
        existing.vehicle = device.vehicle_no;
      }
      return { markerDevId: existing.dev, created: false, markerDirty: true };
    }
  }
  let marker = db.devices.find(
    d => d && String(d.vehicle) === String(device.vehicle_no)
  );
  if (marker) {
    device.marker_dev_id = marker.dev;
    return { markerDevId: marker.dev, created: false, markerDirty: true };
  }
  const maxId = db.devices.reduce(
    (m, d) => Math.max(m, Number(d.id) || 0),
    0
  );
  const rec = {
    id: maxId + 1,
    created: new Date().toISOString(),
    dev: device.device_id.slice(0, 32),
    vehicle: device.vehicle_no,
    status: "Offline",
    lat: null,
    lng: null,
    speed: 0,
    lastSeenAt: null
  };
  if (db.devices.some(d => d.dev === rec.dev)) {
    rec.dev = (device.device_id + "-" + rec.id).slice(0, 32);
  }
  db.devices.unshift(rec);
  device.marker_dev_id = rec.dev;
  return { markerDevId: rec.dev, created: true, markerDirty: true };
}

function activeVehicleConflict(vehicleNo, exceptPk) {
  if (!vehicleNo) return null;
  return (store.devices || []).find(
    d =>
      d.id !== exceptPk &&
      d.vehicle_no === vehicleNo &&
      isActiveLifecycle(d.lifecycle_status)
  );
}

async function registerDevice(body, au, db) {
  const name = String(body.name || "").trim();
  if (!name) throw E(400, "Device name is required");
  if (name.length > 120) throw E(400, "Device name is too long");

  const deviceType = String(body.deviceType || body.device_type || "display")
    .trim()
    .slice(0, 60);
  const platform = String(body.platform || "unknown")
    .trim()
    .slice(0, 60);
  const notes = String(body.notes || "").trim().slice(0, 500);
  const installDate = body.installDate || body.install_date || null;
  if (installDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(installDate))) {
    throw E(400, "Installation date must be YYYY-MM-DD");
  }
  const deviceModel = body.deviceModel || body.device_model || null;
  const manufacturer = body.manufacturer || null;
  const serialNumber = body.serialNumber || body.serial_number || null;
  const hardwareId = body.hardwareId || body.hardware_id || null;
  const firmwareVersion = body.firmwareVersion || body.firmware_version || null;
  const playerVersion = body.playerVersion || body.player_version || null;

  let vehicleNo = body.vehicleNo || body.vehicle_no || body.vehicle || null;
  if (vehicleNo != null) vehicleNo = String(vehicleNo).trim() || null;

  let vehicleId = null;
  if (vehicleNo) {
    const v = (db.vehicles || []).find(x => x.no === vehicleNo);
    if (!v) throw E(400, "Vehicle not found. Add the vehicle first.");
    vehicleId = String(v.id);
    const conflict = activeVehicleConflict(vehicleNo, null);
    if (conflict) {
      throw E(
        409,
        "Vehicle already has an active device (" + conflict.device_id + ")"
      );
    }
  }

  let deviceId = genDeviceId();
  while ((store.devices || []).some(d => d.device_id === deviceId)) {
    deviceId = genDeviceId();
  }

  const now = new Date().toISOString();
  const device = {
    id: nid("dev"),
    device_id: deviceId,
    name,
    device_type: deviceType || "display",
    device_model: deviceModel ? String(deviceModel).slice(0, 80) : null,
    manufacturer: manufacturer ? String(manufacturer).slice(0, 80) : null,
    serial_number: serialNumber ? String(serialNumber).slice(0, 80) : null,
    hardware_id: hardwareId ? String(hardwareId).slice(0, 120) : null,
    firmware_version: firmwareVersion
      ? String(firmwareVersion).slice(0, 60)
      : null,
    player_version: playerVersion ? String(playerVersion).slice(0, 60) : null,
    platform: platform || "unknown",
    vehicle_no: vehicleNo,
    vehicle_id: vehicleId,
    marker_dev_id: null,
    install_date: installDate,
    registered_at: now,
    activated_at: null,
    lifecycle_status: "pending_activation",
    notes,
    created_by: au.name,
    updated_at: now
  };

  const secret = genSecret();
  const expiresDays = Number(process.env.DM_CREDENTIAL_TTL_DAYS || 365);
  const expiresAt =
    Number.isFinite(expiresDays) && expiresDays > 0
      ? new Date(Date.now() + expiresDays * 864e5).toISOString()
      : null;
  const cred = {
    id: nid("cred"),
    device_pk: device.id,
    device_id: device.device_id,
    secret_hash: hashSecret(secret),
    version: 1,
    created_at: now,
    rotated_at: null,
    revoked_at: null,
    last_auth_at: null,
    expires_at: expiresAt,
    created_by: au.name
  };

  let markerDirty = false;
  if (vehicleNo) {
    const link = ensureMarkerLink(db, device);
    markerDirty = !!link.markerDirty || link.created;
    const asg = {
      id: nid("asg"),
      device_pk: device.id,
      device_id: device.device_id,
      vehicle_no: vehicleNo,
      vehicle_id: vehicleId,
      previous_vehicle_no: null,
      new_vehicle_no: vehicleNo,
      assignment_status: "active",
      assigned_at: now,
      unassigned_at: null,
      assigned_by: au.name,
      reason: "registration"
    };
    store.assignments.unshift(asg);
    upsertRow("admin_dm_assignments", asg);
  }

  store.devices.unshift(device);
  store.credentials.unshift(cred);
  ensureDefaultConfig(device, au.name);
  logActivity(device, "device_registered", "Device registered", au.name, {
    vehicleNo
  });
  if (vehicleNo) {
    logActivity(
      device,
      "vehicle_assigned",
      "Assigned to " + vehicleNo,
      au.name
    );
  }

  await upsertRow("admin_dm_devices", device);
  await upsertRow("admin_dm_credentials", cred);
  persistLocal();

  return {
    device: publicDevice(device),
    credentials: {
      deviceId: device.device_id,
      secret,
      version: 1,
      expiresAt: cred.expires_at,
      note: "Copy now — secret is shown only once and never stored in plaintext"
    },
    markerDirty
  };
}

async function assignVehicle(device, body, au, db) {
  if (device.lifecycle_status === "revoked") {
    throw E(409, "Revoked devices cannot be assigned");
  }
  const vehicleNo = String(body.vehicleNo || body.vehicle_no || body.vehicle || "")
    .trim();
  if (!vehicleNo) throw E(400, "Vehicle number is required");
  const v = (db.vehicles || []).find(x => x.no === vehicleNo);
  if (!v) throw E(400, "Vehicle not found. Add the vehicle first.");

  const conflict = activeVehicleConflict(vehicleNo, device.id);
  if (conflict) {
    throw E(
      409,
      "Vehicle already has an active device (" + conflict.device_id + ")"
    );
  }

  const now = new Date().toISOString();
  const prevVehicle = device.vehicle_no || null;
  const open = (store.assignments || []).find(
    a => a.device_pk === device.id && !a.unassigned_at
  );
  if (open) {
    open.unassigned_at = now;
    open.assignment_status = "ended";
    await updateRows(
      "admin_dm_assignments",
      { id: open.id },
      { unassigned_at: now, assignment_status: "ended" }
    );
    logActivity(
      device,
      "vehicle_reassigned",
      "Unassigned from " + (open.vehicle_no || "-"),
      au.name
    );
  }

  device.vehicle_no = vehicleNo;
  device.vehicle_id = String(v.id);
  device.updated_at = now;

  const asg = {
    id: nid("asg"),
    device_pk: device.id,
    device_id: device.device_id,
    vehicle_no: vehicleNo,
    vehicle_id: String(v.id),
    previous_vehicle_no: prevVehicle,
    new_vehicle_no: vehicleNo,
    assignment_status: "active",
    assigned_at: now,
    unassigned_at: null,
    assigned_by: au.name,
    reason: String(body.reason || "assign").slice(0, 200)
  };
  store.assignments.unshift(asg);
  const link = ensureMarkerLink(db, device);
  logActivity(
    device,
    "vehicle_assigned",
    "Assigned to " + vehicleNo,
    au.name
  );

  await upsertRow("admin_dm_devices", device);
  await upsertRow("admin_dm_assignments", asg);
  persistLocal();
  return {
    device: publicDevice(device),
    markerDirty: !!link.markerDirty || link.created
  };
}

async function rotateCredentials(device, au) {
  if (device.lifecycle_status === "revoked") {
    throw E(409, "Cannot rotate credentials for a revoked device");
  }
  const now = new Date().toISOString();
  const active = findActiveCred(device.id);
  if (active) {
    active.revoked_at = now;
    await updateRows(
      "admin_dm_credentials",
      { id: active.id },
      { revoked_at: now }
    );
  }
  const version = active ? Number(active.version || 1) + 1 : 1;
  const secret = genSecret();
  const expiresDays = Number(process.env.DM_CREDENTIAL_TTL_DAYS || 365);
  const expiresAt =
    Number.isFinite(expiresDays) && expiresDays > 0
      ? new Date(Date.now() + expiresDays * 864e5).toISOString()
      : null;
  const cred = {
    id: nid("cred"),
    device_pk: device.id,
    device_id: device.device_id,
    secret_hash: hashSecret(secret),
    version,
    created_at: now,
    rotated_at: now,
    revoked_at: null,
    last_auth_at: null,
    expires_at: expiresAt,
    created_by: au.name
  };
  store.credentials.unshift(cred);
  logActivity(device, "credentials_rotated", "Credentials rotated", au.name, {
    version
  });
  device.updated_at = now;
  await upsertRow("admin_dm_credentials", cred);
  await upsertRow("admin_dm_devices", device);
  persistLocal();
  return {
    deviceId: device.device_id,
    secret,
    version,
    expiresAt,
    note: "Copy now — secret is shown only once"
  };
}

async function setLifecycle(device, next, au, extra) {
  const now = new Date().toISOString();
  const prev = device.lifecycle_status;
  if (prev === "revoked" && next !== "revoked") {
    throw E(409, "Revoked devices cannot be restored; register a new device");
  }
  device.lifecycle_status = next;
  device.updated_at = now;

  if (next === "maintenance") {
    const m = {
      id: nid("mnt"),
      device_pk: device.id,
      device_id: device.device_id,
      reason: String((extra && extra.reason) || "").slice(0, 200),
      notes: String((extra && extra.notes) || "").slice(0, 500),
      started_at: now,
      started_by: au.name,
      completed_at: null,
      completed_by: null
    };
    store.maintenance.unshift(m);
    await upsertRow("admin_dm_maintenance", m);
    logActivity(device, "maintenance_started", m.reason || "Maintenance", au.name);
  }

  if ((next === "activated" || next === "active") && prev === "maintenance") {
    const open = (store.maintenance || []).find(
      m => m.device_pk === device.id && !m.completed_at
    );
    if (open) {
      open.completed_at = now;
      open.completed_by = au.name;
      await updateRows(
        "admin_dm_maintenance",
        { id: open.id },
        { completed_at: now, completed_by: au.name }
      );
    }
    logActivity(device, "maintenance_completed", "Maintenance completed", au.name);
  }

  if (next === "suspended") {
    logActivity(device, "device_suspended", "Device suspended", au.name);
  }
  if (
    (next === "activated" || next === "active") &&
    prev === "suspended"
  ) {
    device.lifecycle_status = "active";
    logActivity(device, "device_restored", "Device restored", au.name);
  }
  if (next === "revoked") {
    const cred = findActiveCred(device.id);
    if (cred) {
      cred.revoked_at = now;
      await updateRows(
        "admin_dm_credentials",
        { id: cred.id },
        { revoked_at: now }
      );
    }
    logActivity(device, "device_revoked", "Device revoked", au.name);
  }

  await upsertRow("admin_dm_devices", device);
  persistLocal();
  return publicDevice(device);
}

function patchDevice(device, body, au) {
  const now = new Date().toISOString();
  if (body.name != null) {
    const name = String(body.name).trim();
    if (!name) throw E(400, "Device name is required");
    device.name = name.slice(0, 120);
  }
  if (body.deviceType != null || body.device_type != null) {
    device.device_type = String(body.deviceType || body.device_type)
      .trim()
      .slice(0, 60);
  }
  if (body.platform != null) {
    device.platform = String(body.platform).trim().slice(0, 60);
  }
  if (body.notes != null) {
    device.notes = String(body.notes).trim().slice(0, 500);
  }
  if (body.deviceModel != null || body.device_model != null) {
    device.device_model = String(body.deviceModel || body.device_model || "").slice(
      0,
      80
    ) || null;
  }
  if (body.manufacturer != null) {
    device.manufacturer = String(body.manufacturer || "").slice(0, 80) || null;
  }
  if (body.serialNumber != null || body.serial_number != null) {
    device.serial_number = String(
      body.serialNumber || body.serial_number || ""
    ).slice(0, 80) || null;
  }
  if (body.hardwareId != null || body.hardware_id != null) {
    device.hardware_id = String(body.hardwareId || body.hardware_id || "").slice(
      0,
      120
    ) || null;
  }
  if (body.firmwareVersion != null || body.firmware_version != null) {
    device.firmware_version = String(
      body.firmwareVersion || body.firmware_version || ""
    ).slice(0, 60) || null;
  }
  if (body.playerVersion != null || body.player_version != null) {
    device.player_version = String(
      body.playerVersion || body.player_version || ""
    ).slice(0, 60) || null;
  }
  if (body.installDate != null || body.install_date != null) {
    const d = body.installDate || body.install_date;
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(String(d))) {
      throw E(400, "Installation date must be YYYY-MM-DD");
    }
    device.install_date = d || null;
  }
  device.updated_at = now;
  logActivity(device, "device_updated", "Device information updated", au.name);
  upsertRow("admin_dm_devices", device);
  persistLocal();
  return publicDevice(device);
}

function listQuery(query) {
  const now = Date.now();
  let rows = (store.devices || []).map(d => publicDevice(d, now));
  const q = String(query.q || query.search || "")
    .trim()
    .toLowerCase();
  const filter = String(query.filter || query.status || "all")
    .trim()
    .toLowerCase();
  const vehicle = String(query.vehicle || "").trim();

  if (vehicle) rows = rows.filter(r => r.vehicleNo === vehicle);
  if (q) {
    rows = rows.filter(r =>
      JSON.stringify(r).toLowerCase().includes(q)
    );
  }

  switch (filter) {
    case "registered":
      rows = rows.filter(r => r.lifecycleStatus === "registered");
      break;
    case "activated":
    case "active":
      rows = rows.filter(
        r => r.lifecycleStatus === "activated" || r.lifecycleStatus === "active"
      );
      break;
    case "pending_activation":
    case "pending":
      rows = rows.filter(r => r.lifecycleStatus === "pending_activation");
      break;
    case "player_running":
      rows = rows.filter(r => r.playerStatus === "running");
      break;
    case "player_stopped":
      rows = rows.filter(r => r.playerStatus === "stopped");
      break;
    case "player_error":
      rows = rows.filter(r => r.playerStatus === "error");
      break;
    case "healthy":
    case "warning":
    case "critical":
    case "unknown":
      rows = rows.filter(r => r.healthStatus === filter);
      break;
    case "online":
      rows = rows.filter(r => r.connectionStatus === "online");
      break;
    case "offline":
      rows = rows.filter(r => r.connectionStatus === "offline");
      break;
    case "needs_attention":
    case "attention":
      rows = rows.filter(r => r.needingAttention);
      break;
    case "maintenance":
      rows = rows.filter(r => r.lifecycleStatus === "maintenance");
      break;
    case "suspended":
      rows = rows.filter(r => r.lifecycleStatus === "suspended");
      break;
    case "revoked":
      rows = rows.filter(r => r.lifecycleStatus === "revoked");
      break;
    case "unassigned":
      rows = rows.filter(r => !r.vehicleNo);
      break;
    default:
      break;
  }

  const sort = String(query.sort || "registeredAt").trim();
  const dir = String(query.dir || "desc").toLowerCase() === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const av = a[sort] ?? a.registeredAt ?? "";
    const bv = b[sort] ?? b.registeredAt ?? "";
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  const total = rows.length;
  const items = rows.slice((page - 1) * pageSize, page * pageSize);
  return {
    items,
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    offlineTimeoutSec: offlineTimeoutSec(),
    heartbeatIntervalSec: heartbeatIntervalSec()
  };
}

function overview() {
  const now = Date.now();
  const rows = (store.devices || []).map(d => publicDevice(d, now));
  const count = pred => rows.filter(pred).length;
  return {
    total: rows.length,
    activated: count(
      r => r.lifecycleStatus === "activated" || r.lifecycleStatus === "active"
    ),
    pendingActivation: count(r => r.lifecycleStatus === "pending_activation"),
    transport: mqttAdapter.describe(),
    online: count(r => r.connectionStatus === "online"),
    offline: count(r => r.connectionStatus === "offline"),
    maintenance: count(r => r.lifecycleStatus === "maintenance"),
    needingAttention: count(r => r.needingAttention),
    unassigned: count(r => !r.vehicleNo),
    suspended: count(r => r.lifecycleStatus === "suspended"),
    revoked: count(r => r.lifecycleStatus === "revoked"),
    registered: count(r => r.lifecycleStatus === "registered"),
    offlineTimeoutSec: offlineTimeoutSec(),
    heartbeatIntervalSec: heartbeatIntervalSec(),
    source: "admin_dm",
    note: "Online counts use device heartbeats only — not phone GPS"
  };
}

function deviceDetails(device) {
  const pub = publicDevice(device);
  const activity = (store.activity || [])
    .filter(a => a.device_pk === device.id)
    .slice(0, 100);
  const assignments = (store.assignments || [])
    .filter(a => a.device_pk === device.id)
    .slice(0, 50);
  const maintenance = (store.maintenance || [])
    .filter(m => m.device_pk === device.id)
    .slice(0, 50);
  const commands = (store.commands || [])
    .filter(c => c.device_pk === device.id)
    .slice(0, 50);
  const cfg = ensureDefaultConfig(device);
  const configHistory = (store.config_history || [])
    .filter(h => h.device_pk === device.id)
    .slice(0, 30);
  const heartbeats = (store.heartbeats || [])
    .filter(h => h.device_pk === device.id)
    .slice(0, 20);
  return {
    device: pub,
    config: sanitizeConfig(cfg),
    configHistory,
    activity,
    assignments,
    maintenance,
    commands: commands.map(sanitizeCommand),
    recentHeartbeats: heartbeats.map(h => ({
      id: h.id,
      receivedAt: h.received_at,
      playerStatus: h.player_status,
      networkStatus: h.network_status,
      appVersion: h.app_version,
      batteryPct: h.battery_pct,
      errorCode: h.error_code,
      errorMessage: h.error_message
    })),
    separationNote:
      "deviceLat/deviceLng are player-reported only. Phone GPS remains on Live Monitoring."
  };
}

function sanitizeConfig(cfg) {
  if (!cfg) return null;
  return {
    deviceId: cfg.device_id,
    version: cfg.version,
    orientation: cfg.orientation,
    resolution: cfg.resolution,
    playback: cfg.playback || {},
    operatingHours: cfg.operating_hours || {},
    mediaSync: cfg.media_sync || {},
    heartbeatIntervalSec: cfg.heartbeat_interval_sec ?? null,
    offlineTimeoutSec: cfg.offline_timeout_sec ?? null,
    updatedAt: cfg.updated_at,
    updatedBy: cfg.updated_by || null
  };
}

function sanitizeCommand(c) {
  return {
    id: c.id,
    deviceId: c.device_id,
    commandType: c.command_type,
    payload: c.payload || {},
    status: c.status,
    issuedBy: c.issued_by || null,
    createdAt: c.created_at,
    deliveredAt: c.delivered_at || null,
    ackAt: c.ack_at || null,
    executingAt: c.executing_at || null,
    completedAt: c.completed_at || null,
    expiresAt: c.expires_at || null,
    failureReason: c.failure_reason || null
  };
}

async function updateConfig(device, body, au) {
  const cfg = ensureDefaultConfig(device, au.name);
  const hist = {
    id: nid("cfgh"),
    device_pk: device.id,
    device_id: device.device_id,
    version: cfg.version,
    snapshot: {
      orientation: cfg.orientation,
      resolution: cfg.resolution,
      playback: cfg.playback,
      operating_hours: cfg.operating_hours,
      media_sync: cfg.media_sync
    },
    updated_by: cfg.updated_by,
    created_at: new Date().toISOString()
  };
  store.config_history.unshift(hist);
  await upsertRow("admin_dm_config_history", hist);

  if (body.orientation != null) {
    cfg.orientation = String(body.orientation).slice(0, 40);
  }
  if (body.resolution != null) {
    cfg.resolution = String(body.resolution).slice(0, 40) || null;
  }
  if (body.playback && typeof body.playback === "object") {
    cfg.playback = { ...cfg.playback, ...body.playback };
  }
  if (body.operatingHours && typeof body.operatingHours === "object") {
    cfg.operating_hours = { ...cfg.operating_hours, ...body.operatingHours };
  }
  if (body.mediaSync && typeof body.mediaSync === "object") {
    cfg.media_sync = { ...cfg.media_sync, ...body.mediaSync };
  }
  if (body.heartbeatIntervalSec != null || body.heartbeat_interval_sec != null) {
    const n = Number(body.heartbeatIntervalSec ?? body.heartbeat_interval_sec);
    if (!Number.isFinite(n) || n < 5) throw E(400, "Invalid heartbeatIntervalSec");
    cfg.heartbeat_interval_sec = n;
  }
  if (body.offlineTimeoutSec != null || body.offline_timeout_sec != null) {
    const n = Number(body.offlineTimeoutSec ?? body.offline_timeout_sec);
    if (!Number.isFinite(n) || n < 15) throw E(400, "Invalid offlineTimeoutSec");
    cfg.offline_timeout_sec = n;
  }
  cfg.version = Number(cfg.version || 1) + 1;
  cfg.updated_at = new Date().toISOString();
  cfg.updated_by = au.name;
  device.updated_at = cfg.updated_at;
  logActivity(
    device,
    "configuration_updated",
    "Configuration v" + cfg.version,
    au.name
  );
  await upsertRow("admin_dm_config", cfg, "device_pk");
  await upsertRow("admin_dm_devices", device);
  persistLocal();
  return sanitizeConfig(cfg);
}

async function issueCommand(device, body, au) {
  if (device.lifecycle_status === "revoked") {
    throw E(409, "Cannot command a revoked device");
  }
  const type = String(body.commandType || body.type || "")
    .trim()
    .toLowerCase();
  if (!COMMAND_TYPES.includes(type)) {
    throw E(400, "Unsupported command type");
  }
  const now = Date.now();
  const row = {
    id: nid("cmd"),
    device_pk: device.id,
    device_id: device.device_id,
    command_type: type,
    payload: body.payload && typeof body.payload === "object" ? body.payload : {},
    status: "pending",
    issued_by: au.name,
    created_at: new Date(now).toISOString(),
    ack_at: null,
    completed_at: null,
    expires_at: new Date(now + commandTtlSec() * 1000).toISOString(),
    failure_reason: null
  };
  store.commands.unshift(row);
  logActivity(device, "command_issued", type, au.name, { commandId: row.id });
  await upsertRow("admin_dm_commands", row);
  mqttAdapter.publishCommand(device.device_id, sanitizeCommand(row)).catch(() => {});
  persistLocal();
  return sanitizeCommand(row);
}

/* ---------- Device (player) auth ---------- */

const deviceAuthTries = new Map();

function deviceSigningKey() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET + ":dm-device";
  const supabaseKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseKey) {
    return crypto
      .createHash("sha256")
      .update("adtech-dm-device:" + supabaseKey)
      .digest("hex");
  }
  return "local-dm-device-key";
}

function signDeviceToken(payload) {
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      typ: "dm_device",
      exp: Date.now() + 12 * 3600e3
    })
  ).toString("base64url");
  const sig = crypto
    .createHmac("sha256", deviceSigningKey())
    .update(body)
    .digest("base64url");
  return body + "." + sig;
}

function unsignDeviceToken(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = crypto
    .createHmac("sha256", deviceSigningKey())
    .update(body)
    .digest("base64url");
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (p.typ !== "dm_device" || !(p.exp > Date.now())) return null;
    return p;
  } catch (_) {
    return null;
  }
}

function authDevice(req) {
  const h = req.headers.authorization || "";
  const token = h.replace(/^Bearer /i, "");
  const p = unsignDeviceToken(token);
  if (!p || !p.did) return null;
  const device = (store.devices || []).find(d => d.device_id === p.did);
  if (!device) return null;
  if (device.lifecycle_status === "revoked") return null;
  if (device.lifecycle_status === "suspended") return null;
  return { device, payload: p };
}

async function deviceAuthenticate(body, ip) {
  const key = String(ip || "unknown");
  const t = deviceAuthTries.get(key) || { n: 0, at: Date.now() };
  if (Date.now() - t.at > 300000) {
    t.n = 0;
    t.at = Date.now();
  }
  if (t.n >= 20) throw E(429, "Too many device auth attempts");

  const deviceId = String(body.deviceId || body.device_id || "").trim();
  const secret = String(body.secret || body.credential || "");
  if (!deviceId || !secret) throw E(400, "deviceId and secret are required");

  const device = (store.devices || []).find(d => d.device_id === deviceId);
  if (!device) {
    t.n++;
    deviceAuthTries.set(key, t);
    throw E(401, "Invalid device credentials");
  }
  if (device.lifecycle_status === "revoked") {
    throw E(403, "Device revoked");
  }
  if (device.lifecycle_status === "suspended") {
    throw E(403, "Device suspended");
  }

  const cred = findActiveCred(device.id);
  if (!cred || !verifySecret(secret, cred.secret_hash)) {
    t.n++;
    deviceAuthTries.set(key, t);
    throw E(401, "Invalid device credentials");
  }
  if (cred.expires_at && Date.parse(cred.expires_at) < Date.now()) {
    throw E(403, "Device credentials expired — rotate credentials");
  }

  const now = new Date().toISOString();
  cred.last_auth_at = now;
  await updateRows(
    "admin_dm_credentials",
    { id: cred.id },
    { last_auth_at: now }
  );

  if (!device.activated_at) {
    device.activated_at = now;
    device.lifecycle_status = "active";
    device.updated_at = now;
    logActivity(device, "device_activated", "Activated on first auth", deviceId);
    await upsertRow("admin_dm_devices", device);
  } else if (
    device.lifecycle_status === "registered" ||
    device.lifecycle_status === "pending_activation" ||
    device.lifecycle_status === "activated"
  ) {
    device.lifecycle_status = "active";
    device.updated_at = now;
    await upsertRow("admin_dm_devices", device);
  }

  logActivity(device, "device_authenticated", "Device authenticated", deviceId);
  persistLocal();

  return {
    token: signDeviceToken({ did: device.device_id, pk: device.id }),
    deviceId: device.device_id,
    lifecycleStatus: normalizeLifecycle(device.lifecycle_status),
    heartbeatIntervalSec: heartbeatIntervalSec(device),
    offlineTimeoutSec: offlineTimeoutSec(device),
    transport: mqttAdapter.describe()
  };
}

const deviceHbTries = new Map();

function rateLimitHeartbeat(deviceId, ip) {
  const key = deviceId + "|" + String(ip || "");
  const now = Date.now();
  const t = deviceHbTries.get(key) || { n: 0, at: now };
  if (now - t.at > 60000) {
    t.n = 0;
    t.at = now;
  }
  t.n++;
  deviceHbTries.set(key, t);
  if (t.n > 120) throw E(429, "Heartbeat rate limit exceeded");
}

async function ingestHeartbeat(device, body, ip) {
  if (device.lifecycle_status === "revoked") throw E(403, "Device revoked");
  if (device.lifecycle_status === "suspended") throw E(403, "Device suspended");
  rateLimitHeartbeat(device.device_id, ip);

  const idem =
    body.idempotencyKey || body.idempotency_key || body.nonce || null;
  if (idem) {
    const dup = (store.heartbeats || []).find(
      h =>
        h.device_pk === device.id &&
        h.idempotency_key &&
        h.idempotency_key === String(idem)
    );
    if (dup) {
      const tel =
        (store.telemetry || []).find(t => t.device_pk === device.id) || null;
      const connection = connectionOf(device, tel, Date.now());
      return {
        ok: true,
        duplicate: true,
        connectionStatus: connection,
        healthStatus: tel ? tel.health_status : "unknown",
        nextHeartbeatSec: heartbeatIntervalSec(device),
        config: sanitizeConfig(ensureDefaultConfig(device)),
        pendingCommands: pendingCommandsFor(device)
      };
    }
  }

  const nowIso = new Date().toISOString();
  const prevTel =
    (store.telemetry || []).find(t => t.device_pk === device.id) || null;
  const prevConnection = connectionOf(device, prevTel, Date.now());

  const num = (...keys) => {
    for (const k of keys) {
      if (body[k] != null && body[k] !== "") {
        const n = Number(body[k]);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  };

  const playerStatus = body.playerStatus || body.player_status || null;
  const networkStatus = body.networkStatus || body.network_status || null;
  const appVersion = body.appVersion || body.app_version || null;
  const errorCode = body.errorCode || body.error_code || null;
  const errorMessage = body.errorMessage || body.error_message || null;

  const hb = {
    id: nid("hb"),
    device_pk: device.id,
    device_id: device.device_id,
    received_at: nowIso,
    client_ts: body.timestamp || body.ts || null,
    player_status: playerStatus ? String(playerStatus).slice(0, 40) : null,
    network_status: networkStatus ? String(networkStatus).slice(0, 40) : null,
    app_version: appVersion ? String(appVersion).slice(0, 60) : null,
    battery_pct: num("batteryPct", "battery_pct"),
    storage_free_mb: num("storageFreeMb", "storage_free_mb"),
    storage_total_mb: num("storageTotalMb", "storage_total_mb"),
    memory_used_mb: num("memoryUsedMb", "memory_used_mb"),
    memory_total_mb: num("memoryTotalMb", "memory_total_mb"),
    signal_strength: num("signalStrength", "signal_strength"),
    temperature_c: num("temperatureC", "temperature_c"),
    error_code: errorCode ? String(errorCode).slice(0, 80) : null,
    error_message: errorMessage ? String(errorMessage).slice(0, 300) : null,
    lat: num("lat"),
    lng: num("lng"),
    accuracy_m: num("accuracyM", "accuracy_m"),
    idempotency_key: idem ? String(idem).slice(0, 120) : null,
    raw: {}
  };
  store.heartbeats.unshift(hb);
  store.heartbeats = store.heartbeats.slice(0, 2000);

  let tel = prevTel;
  if (!tel) {
    tel = { device_pk: device.id, device_id: device.device_id };
    store.telemetry.push(tel);
  }
  tel.last_heartbeat_at = nowIso;
  tel.player_status = hb.player_status;
  tel.network_status = hb.network_status;
  tel.app_version = hb.app_version;
  tel.battery_pct = hb.battery_pct;
  tel.storage_free_mb = hb.storage_free_mb;
  tel.storage_total_mb = hb.storage_total_mb;
  tel.memory_used_mb = hb.memory_used_mb;
  tel.memory_total_mb = hb.memory_total_mb;
  tel.signal_strength = hb.signal_strength;
  tel.temperature_c = hb.temperature_c;
  tel.error_code = hb.error_code;
  tel.error_message = hb.error_message;
  if (hb.lat != null) tel.lat = hb.lat;
  if (hb.lng != null) tel.lng = hb.lng;
  if (hb.accuracy_m != null) tel.accuracy_m = hb.accuracy_m;
  if (body.mediaSyncedAt || body.media_synced_at) {
    tel.last_media_sync_at = String(body.mediaSyncedAt || body.media_synced_at);
  }
  tel.updated_at = nowIso;

  if (hb.player_status === "running") {
    tel.last_player_start_at = nowIso;
    logActivity(device, "player_started", "Player running", device.device_id);
  } else if (hb.player_status === "stopped") {
    tel.last_player_stop_at = nowIso;
    logActivity(device, "player_stopped", "Player stopped", device.device_id);
  } else if (hb.player_status === "error") {
    logActivity(device, "player_error", "Player error", device.device_id);
  }
  if (hb.error_code || hb.error_message) {
    logActivity(
      device,
      "playback_error",
      hb.error_message || hb.error_code,
      device.device_id
    );
  }

  const connection = connectionOf(device, tel, Date.now());
  tel.health_status = deriveHealth(device, tel, connection);

  if (prevConnection !== "online" && connection === "online") {
    logActivity(device, "device_online", "Device online", device.device_id);
  } else if (prevConnection === "online" && connection !== "online") {
    logActivity(device, "device_offline", "Device offline", device.device_id);
  }

  if (
    ["registered", "pending_activation", "activated"].includes(
      device.lifecycle_status
    )
  ) {
    device.lifecycle_status = "active";
    device.activated_at = device.activated_at || nowIso;
  }
  if (hb.app_version) device.player_version = hb.app_version;
  device.updated_at = nowIso;

  logActivity(device, "heartbeat_received", "Heartbeat", device.device_id, {
    playerStatus: hb.player_status
  });

  /* Mark pending commands delivered when device polls via heartbeat. */
  const delivered = [];
  (store.commands || []).forEach(c => {
    if (c.device_pk === device.id && c.status === "pending") {
      c.status = "delivered";
      c.delivered_at = nowIso;
      delivered.push(c.id);
      upsertRow("admin_dm_commands", c);
    }
  });

  await upsertRow("admin_dm_heartbeats", hb);
  await upsertRow("admin_dm_telemetry", tel, "device_pk");
  await upsertRow("admin_dm_devices", device);
  persistLocal();

  const cfg = sanitizeConfig(ensureDefaultConfig(device));
  const pending = pendingCommandsFor(device);
  mqttAdapter.publishHeartbeatAck(device.device_id, {
    connectionStatus: connection,
    at: nowIso
  }).catch(() => {});

  return {
    ok: true,
    connectionStatus: connection,
    healthStatus: tel.health_status,
    nextHeartbeatSec: heartbeatIntervalSec(device),
    config: cfg,
    configVersion: cfg.version,
    pendingCommands: pending,
    deliveredCommandIds: delivered,
    locationSource:
      hb.lat != null
        ? "device_reported"
        : "none — phone GPS is separate (Live Monitoring)"
  };
}

function pendingCommandsFor(device) {
  expireCommands(device);
  return (store.commands || [])
    .filter(
      c =>
        c.device_pk === device.id &&
        ["pending", "delivered", "acknowledged", "executing"].includes(c.status)
    )
    .map(sanitizeCommand);
}

function expireCommands(device) {
  const now = Date.now();
  (store.commands || []).forEach(c => {
    if (
      c.device_pk === device.id &&
      c.status === "pending" &&
      c.expires_at &&
      Date.parse(c.expires_at) < now
    ) {
      c.status = "expired";
      updateRows("admin_dm_commands", { id: c.id }, { status: "expired" });
    }
  });
}

async function ackCommand(device, commandId, body) {
  expireCommands(device);
  const cmd = (store.commands || []).find(
    c => c.id === commandId && c.device_pk === device.id
  );
  if (!cmd) throw E(404, "Command not found");
  const status = String(body.status || "acknowledged").toLowerCase();
  const now = new Date().toISOString();
  if (status === "delivered") {
    if (cmd.status === "pending") {
      cmd.status = "delivered";
      cmd.delivered_at = now;
    }
  } else if (status === "acknowledged" || status === "ack") {
    if (["pending", "delivered"].includes(cmd.status)) {
      cmd.status = "acknowledged";
      cmd.ack_at = now;
      if (!cmd.delivered_at) cmd.delivered_at = now;
    }
  } else if (status === "executing") {
    cmd.status = "executing";
    cmd.executing_at = now;
    if (!cmd.ack_at) cmd.ack_at = now;
  } else if (status === "completed") {
    cmd.status = "completed";
    cmd.completed_at = now;
    if (!cmd.ack_at) cmd.ack_at = now;
    logActivity(
      device,
      "command_completed",
      cmd.command_type,
      device.device_id,
      { commandId: cmd.id }
    );
  } else if (status === "failed") {
    cmd.status = "failed";
    cmd.completed_at = now;
    cmd.failure_reason = String(
      body.reason || body.failureReason || "failed"
    ).slice(0, 300);
    logActivity(
      device,
      "command_failed",
      cmd.failure_reason,
      device.device_id,
      { commandId: cmd.id }
    );
  } else {
    throw E(
      400,
      "status must be delivered, acknowledged, executing, completed, or failed"
    );
  }
  await upsertRow("admin_dm_commands", cmd);
  persistLocal();
  return sanitizeCommand(cmd);
}

function parseQuery(url) {
  const out = {};
  url.searchParams.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

/**
 * Route handler for /api/dm/*
 * ctx: { m, ip, req, res, send, readBody, auth, audit, save, db }
 */
async function handle(parts, ctx) {
  const { m, ip, req, res, send, readBody, auth, audit, save, db } = ctx;
  if (!store) store = readStoreFile();

  /* Device player routes (no admin Bearer) */
  if (parts[0] === "device") {
    if (m === "POST" && parts[1] === "auth" && !parts[2]) {
      const body = await readBody(req);
      const result = await deviceAuthenticate(body, ip);
      return send(res, 200, result);
    }

    const da = authDevice(req);
    if (!da) throw E(401, "Device authentication required");

    if (m === "POST" && parts[1] === "heartbeat") {
      const body = await readBody(req);
      const result = await ingestHeartbeat(da.device, body, ip);
      return send(res, 200, result);
    }

    if (m === "GET" && parts[1] === "config") {
      const cfg = ensureDefaultConfig(da.device);
      return send(res, 200, sanitizeConfig(cfg));
    }

    if (m === "GET" && parts[1] === "commands" && parts[2] === "pending") {
      const pending = pendingCommandsFor(da.device);
      const nowIso = new Date().toISOString();
      pending.forEach(p => {
        const row = (store.commands || []).find(c => c.id === p.id);
        if (row && row.status === "pending") {
          row.status = "delivered";
          row.delivered_at = nowIso;
          upsertRow("admin_dm_commands", row);
        }
      });
      persistLocal();
      return send(res, 200, {
        commands: pendingCommandsFor(da.device),
        transport: mqttAdapter.describe()
      });
    }

    if (
      m === "POST" &&
      parts[1] === "commands" &&
      parts[2] &&
      parts[3] === "ack"
    ) {
      const body = await readBody(req);
      const result = await ackCommand(da.device, parts[2], body);
      return send(res, 200, result);
    }

    throw E(404, "Unknown device endpoint");
  }

  /* Admin routes */
  const au = auth(req);
  if (!canView(au)) throw E(403, "Admin access required");

  if (m === "GET" && parts[0] === "overview" && !parts[1]) {
    return send(res, 200, overview());
  }

  /* Live snapshot for Admin DM poll / Realtime fallback (Phase 9). */
  if (m === "GET" && parts[0] === "stream" && !parts[1]) {
    const now = Date.now();
    const devices = (store.devices || []).map(d => publicDevice(d, now));
    return send(res, 200, {
      at: new Date(now).toISOString(),
      offlineTimeoutSec: offlineTimeoutSec(),
      transport: mqttAdapter.describe(),
      note: "Poll this endpoint for live DM status. Phone GPS remains on /api/live.",
      devices: devices.map(d => ({
        id: d.id,
        deviceId: d.deviceId,
        lifecycleStatus: d.lifecycleStatus,
        connectionStatus: d.connectionStatus,
        playerStatus: d.playerStatus,
        healthStatus: d.healthStatus,
        lastHeartbeatAt: d.lastHeartbeatAt,
        needingAttention: d.needingAttention
      }))
    });
  }

  if (m === "GET" && parts[0] === "transport" && !parts[1]) {
    return send(res, 200, mqttAdapter.describe());
  }

  if (parts[0] === "devices" && !parts[1]) {
    if (m === "GET") {
      const url = new URL(req.url, "http://localhost");
      return send(res, 200, listQuery(parseQuery(url)));
    }
    if (m === "POST") {
      if (!canMutate(au)) throw E(403, "Not allowed");
      const body = await readBody(req);
      const result = await registerDevice(body, au, db);
      audit(
        au.name,
        `dm: registered device ${result.device.deviceId}`,
        ip
      );
      const dirty = ["audit"];
      if (result.markerDirty) dirty.push("devices");
      await save(dirty);
      return send(res, 201, result);
    }
    throw E(405, "Method not allowed");
  }

  if (parts[0] === "devices" && parts[1]) {
    const device = findDeviceByPk(parts[1]);
    if (!device) throw E(404, "Device not found");
    const action = parts[2];

    if (m === "GET" && !action) {
      return send(res, 200, deviceDetails(device));
    }

    if (m === "GET" && action === "telemetry") {
      const tel =
        (store.telemetry || []).find(t => t.device_pk === device.id) || null;
      const recent = (store.heartbeats || [])
        .filter(h => h.device_pk === device.id)
        .slice(0, 50);
      return send(res, 200, {
        deviceId: device.device_id,
        connectionStatus: connectionOf(device, tel, Date.now()),
        telemetry: tel,
        recentHeartbeats: recent,
        note: "Only fields the player reported — never fabricated"
      });
    }

    if (m === "POST" && action === "activate") {
      if (!canMutate(au)) throw E(403, "Not allowed");
      if (device.lifecycle_status === "revoked") {
        throw E(409, "Revoked devices cannot be activated");
      }
      /* Admin can mark pending → still requires device auth for true activation. */
      if (!device.activated_at) {
        device.lifecycle_status = "pending_activation";
      } else {
        device.lifecycle_status = "active";
      }
      device.updated_at = new Date().toISOString();
      logActivity(
        device,
        "activation_prepared",
        "Awaiting device authentication",
        au.name
      );
      await upsertRow("admin_dm_devices", device);
      persistLocal();
      audit(au.name, `dm: activate prepare ${device.device_id}`, ip);
      await save(["audit"]);
      return send(res, 200, {
        device: publicDevice(device),
        note: "Device becomes Active only after successful player authentication"
      });
    }

    if ((m === "PATCH" || m === "PUT") && !action) {
      if (!canMutate(au)) throw E(403, "Not allowed");
      const body = await readBody(req);
      const updated = patchDevice(device, body, au);
      audit(au.name, `dm: updated device ${device.device_id}`, ip);
      await save(["audit"]);
      return send(res, 200, { device: updated });
    }

    if (m === "POST" && action === "assign") {
      if (!canMutate(au)) throw E(403, "Not allowed");
      const body = await readBody(req);
      const result = await assignVehicle(device, body, au, db);
      audit(
        au.name,
        `dm: assigned ${device.device_id} → ${result.device.vehicleNo}`,
        ip
      );
      const dirty = ["audit"];
      if (result.markerDirty) dirty.push("devices");
      await save(dirty);
      return send(res, 200, result);
    }

    if (m === "POST" && action === "credentials" && parts[3] === "rotate") {
      if (!canSensitive(au)) throw E(403, "Admin role required");
      const creds = await rotateCredentials(device, au);
      audit(au.name, `dm: rotated credentials ${device.device_id}`, ip);
      await save(["audit"]);
      return send(res, 200, { credentials: creds });
    }

    if (m === "POST" && action === "maintenance") {
      if (!canMutate(au)) throw E(403, "Not allowed");
      const body = await readBody(req);
      const mode = String(body.action || "start").toLowerCase();
      let updated;
      if (mode === "complete" || mode === "end") {
        updated = await setLifecycle(device, "active", au, body);
      } else {
        updated = await setLifecycle(device, "maintenance", au, body);
      }
      audit(au.name, `dm: maintenance ${mode} ${device.device_id}`, ip);
      await save(["audit"]);
      return send(res, 200, { device: updated });
    }

    if (m === "POST" && action === "suspend") {
      if (!canSensitive(au)) throw E(403, "Admin role required");
      const updated = await setLifecycle(device, "suspended", au);
      audit(au.name, `dm: suspended ${device.device_id}`, ip);
      await save(["audit"]);
      return send(res, 200, { device: updated });
    }

    if (m === "POST" && action === "restore") {
      if (!canSensitive(au)) throw E(403, "Admin role required");
      if (device.lifecycle_status !== "suspended") {
        throw E(409, "Only suspended devices can be restored");
      }
      const updated = await setLifecycle(device, "active", au);
      audit(au.name, `dm: restored ${device.device_id}`, ip);
      await save(["audit"]);
      return send(res, 200, { device: updated });
    }

    if (m === "POST" && action === "revoke") {
      if (!canSensitive(au)) throw E(403, "Admin role required");
      const updated = await setLifecycle(device, "revoked", au);
      audit(au.name, `dm: revoked ${device.device_id}`, ip);
      await save(["audit"]);
      return send(res, 200, { device: updated });
    }

    if (m === "GET" && action === "activity") {
      const activity = (store.activity || [])
        .filter(a => a.device_pk === device.id)
        .slice(0, 200);
      return send(res, 200, { activity });
    }

    if (action === "config") {
      if (m === "GET") {
        return send(res, 200, {
          config: sanitizeConfig(ensureDefaultConfig(device)),
          history: (store.config_history || [])
            .filter(h => h.device_pk === device.id)
            .slice(0, 30)
        });
      }
      if (m === "PUT" || m === "PATCH") {
        if (!canMutate(au)) throw E(403, "Not allowed");
        const body = await readBody(req);
        const config = await updateConfig(device, body, au);
        audit(au.name, `dm: config update ${device.device_id}`, ip);
        await save(["audit"]);
        return send(res, 200, { config });
      }
    }

    if (action === "commands") {
      if (m === "GET") {
        return send(res, 200, {
          commands: (store.commands || [])
            .filter(c => c.device_pk === device.id)
            .slice(0, 100)
            .map(sanitizeCommand)
        });
      }
      if (m === "POST") {
        if (!canSensitive(au)) throw E(403, "Admin role required");
        const body = await readBody(req);
        const command = await issueCommand(device, body, au);
        audit(
          au.name,
          `dm: command ${command.commandType} → ${device.device_id}`,
          ip
        );
        await save(["audit"]);
        return send(res, 200, { command });
      }
    }

    throw E(404, "Unknown device management action");
  }

  throw E(404, "Unknown device management endpoint");
}

module.exports = {
  initDeviceMgmt,
  handle,
  overview,
  LIFECYCLE,
  COMMAND_TYPES,
  COMMAND_STATUSES,
  offlineTimeoutSec,
  heartbeatIntervalSec,
  mqttAdapter,
  /* test helpers */
  _getStore: () => store,
  _setStoreForTests: s => {
    store = s;
  }
};
