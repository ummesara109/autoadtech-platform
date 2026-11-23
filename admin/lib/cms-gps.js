"use strict";

/*
  CMS → Admin GPS ingest helpers (Phase 1).
  - Exact identity mapping via vehicle_cms_link (no fuzzy plate match)
  - Upserts cms_admin_vehicle_gps
  - Optionally stamps matching devices.payload so /api/live skips sim
*/

const fs = require("fs");
const path = require("path");

const STALE_FUTURE_MS = 5 * 60 * 1000;
const DATA_DIR = path.join(__dirname, "..", "data");
const LINK_FILE = path.join(DATA_DIR, "vehicle-cms-link.json");
const GPS_FILE = path.join(DATA_DIR, "cms-admin-vehicle-gps.json");

/** Online = tracking_active && age ≤ threshold (Phase 2 markers / stale detection). */
function onlineThresholdMs() {
  const raw = Number(process.env.CMS_GPS_ONLINE_MS || 90_000);
  if (!Number.isFinite(raw) || raw < 5_000) return 90_000;
  return raw;
}

/**
 * Production must not invent movement. Local demo may keep sim unless disabled.
 * DISABLE_LIVE_SIM=true | Vercel (unless ALLOW_LIVE_SIM=true).
 */
function liveSimDisabled() {
  if (process.env.DISABLE_LIVE_SIM === "true") return true;
  if (process.env.ALLOW_LIVE_SIM === "true") return false;
  return !!process.env.VERCEL;
}

/** @type {Map<string, object>} */
const linkByAuto = new Map();
/** @type {Map<string, object>} */
const gpsByAuto = new Map();

let seeded = false;
let supabaseAvailable = null;
let gpsRefreshPromise = null;

function normalizeAutoNumber(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-]/g, "");
}

function demoLinks() {
  return [
    {
      id: "link-ka01ab1234",
      auto_number_norm: "KA01AB1234",
      admin_vehicle_id: "1",
      admin_device_id: "DEV-001",
      cms_vehicle_id: "11111111-1111-4111-8111-111111111111",
      cms_screen_id: "33333333-3333-4333-8333-333333333331",
      status: "Active"
    },
    {
      id: "link-ka02cd5678",
      auto_number_norm: "KA02CD5678",
      admin_vehicle_id: "2",
      admin_device_id: "DEV-002",
      cms_vehicle_id: "22222222-2222-4222-8222-222222222222",
      cms_screen_id: "33333333-3333-4333-8333-333333333332",
      status: "Active"
    }
  ];
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
}

function writeJsonFile(file, value) {
  if (process.env.VERCEL) return false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    console.error("cms-gps local persist failed:", err.message);
    return false;
  }
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

function putLink(row) {
  if (!row || !row.auto_number_norm) return;
  linkByAuto.set(row.auto_number_norm, row);
}

function putGps(row) {
  if (!row || !row.auto_number_norm) return;
  gpsByAuto.set(row.auto_number_norm, row);
}

function ensureSeeded() {
  if (seeded) return;
  seeded = true;

  const fromDisk = process.env.VERCEL ? null : readJsonFile(LINK_FILE);
  if (Array.isArray(fromDisk) && fromDisk.length) {
    fromDisk.forEach(putLink);
  } else if (!process.env.VERCEL && !hasSupabaseEnv()) {
    demoLinks().forEach(putLink);
    writeJsonFile(LINK_FILE, [...linkByAuto.values()]);
  }

  if (!process.env.VERCEL) {
    const gpsDisk = readJsonFile(GPS_FILE);
    if (Array.isArray(gpsDisk)) {
      gpsDisk.forEach(putGps);
    }
  }
}

async function refreshLinksFromSupabase() {
  const sb = getSupabase();
  if (!sb) {
    supabaseAvailable = false;
    return;
  }

  try {
    const { data, error } = await sb
      .from("vehicle_cms_link")
      .select("*")
      .eq("status", "Active");

    if (error) {
      console.warn("vehicle_cms_link read skipped:", error.message);
      supabaseAvailable = false;
      return;
    }

    supabaseAvailable = true;
    linkByAuto.clear();
    for (const row of data || []) {
      putLink({
        id: String(row.id),
        auto_number_norm: normalizeAutoNumber(row.auto_number_norm),
        admin_vehicle_id: String(row.admin_vehicle_id),
        admin_device_id: row.admin_device_id
          ? String(row.admin_device_id)
          : null,
        cms_vehicle_id: row.cms_vehicle_id
          ? String(row.cms_vehicle_id)
          : null,
        cms_screen_id: row.cms_screen_id
          ? String(row.cms_screen_id)
          : null,
        status: row.status || "Active"
      });
    }
  } catch (err) {
    supabaseAvailable = false;
    console.warn(
      "vehicle_cms_link refresh failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

async function refreshGpsFromSupabase() {
  const sb = getSupabase();
  if (!sb || supabaseAvailable === false) return;

  try {
    const { data, error } = await sb.from("cms_admin_vehicle_gps").select("*");
    if (error) {
      console.warn("cms_admin_vehicle_gps read skipped:", error.message);
      return;
    }
    for (const row of data || []) {
      putGps(normalizeGpsRow(row));
    }
  } catch (err) {
    console.warn(
      "cms_admin_vehicle_gps refresh failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/** CP-55: optional CMS currentlyPlaying piggybacked on GPS ingest. */
function parseCurrentAd(body, existing) {
  const raw =
    body &&
    (body.currentAd ||
      body.currentlyPlaying ||
      body.current_ad ||
      null);

  // Explicit idle clear from Nest
  if (raw === null && body && body.currentAd === null) {
    return {
      current_ad_id: null,
      current_ad_title: null,
      current_ad_media_url: null,
      current_ad_updated_at: new Date().toISOString()
    };
  }

  if (!raw || typeof raw !== "object") {
    // Keep prior ad when GPS arrives without ad snapshot
    return {
      current_ad_id: existing ? existing.current_ad_id || null : null,
      current_ad_title: existing ? existing.current_ad_title || null : null,
      current_ad_media_url: existing
        ? existing.current_ad_media_url || null
        : null,
      current_ad_updated_at: existing
        ? existing.current_ad_updated_at || null
        : null
    };
  }

  const id = raw.queueItemId || raw.id || raw.current_ad_id || null;
  const title = raw.title || raw.current_ad_title || null;
  const media =
    raw.mediaUrl || raw.media_url || raw.current_ad_media_url || null;
  const updated =
    raw.updatedAt ||
    raw.updated_at ||
    raw.startedAt ||
    raw.started_at ||
    new Date().toISOString();

  if (!id && !title && !media) {
    return {
      current_ad_id: null,
      current_ad_title: null,
      current_ad_media_url: null,
      current_ad_updated_at: new Date().toISOString()
    };
  }

  return {
    current_ad_id: id ? String(id).slice(0, 80) : null,
    current_ad_title: title ? String(title).slice(0, 160) : null,
    current_ad_media_url: media ? String(media).slice(0, 500) : null,
    current_ad_updated_at: String(updated)
  };
}

function normalizeGpsRow(row) {
  return {
    auto_number_norm: normalizeAutoNumber(row.auto_number_norm),
    admin_vehicle_id: row.admin_vehicle_id
      ? String(row.admin_vehicle_id)
      : null,
    admin_device_id: row.admin_device_id ? String(row.admin_device_id) : null,
    cms_vehicle_id: row.cms_vehicle_id ? String(row.cms_vehicle_id) : null,
    cms_screen_id: row.cms_screen_id ? String(row.cms_screen_id) : null,
    device_id: row.device_id != null ? String(row.device_id) : null,
    lat: row.lat == null ? null : Number(row.lat),
    lng: row.lng == null ? null : Number(row.lng),
    accuracy_m:
      row.accuracy_m == null || row.accuracy_m === ""
        ? null
        : Number(row.accuracy_m),
    speed_kmh:
      row.speed_kmh == null || row.speed_kmh === ""
        ? null
        : Number(row.speed_kmh),
    recorded_at: row.recorded_at || null,
    updated_at: row.updated_at || new Date().toISOString(),
    tracking_active: row.tracking_active !== false,
    source: "device_gps",
    current_ad_id: row.current_ad_id ? String(row.current_ad_id) : null,
    current_ad_title: row.current_ad_title
      ? String(row.current_ad_title)
      : null,
    current_ad_media_url: row.current_ad_media_url
      ? String(row.current_ad_media_url)
      : null,
    current_ad_updated_at: row.current_ad_updated_at || null
  };
}

async function initCmsGps() {
  ensureSeeded();
  await refreshLinksFromSupabase();
  await refreshGpsFromSupabase();
}

async function refreshLiveGps() {
  ensureSeeded();
  if (supabaseAvailable === false) return;
  if (gpsRefreshPromise) {
    await gpsRefreshPromise;
    return;
  }
  gpsRefreshPromise = refreshGpsFromSupabase();
  try {
    await gpsRefreshPromise;
  } finally {
    gpsRefreshPromise = null;
  }
}

/**
 * Exact mapping only: auto_number_norm, optional cms_vehicle_id / cms_screen_id.
 * Rejects when ids are supplied and do not match the link row.
 */
function resolveLink(input) {
  ensureSeeded();

  const autoNorm = normalizeAutoNumber(
    input.autoNumber || input.auto_number || input.auto_number_norm
  );
  if (!autoNorm) {
    return { error: "autoNumber is required", code: 400 };
  }

  const link = linkByAuto.get(autoNorm);
  if (!link || link.status !== "Active") {
    return {
      error: "No Active CMS↔Admin mapping for this autoNumber",
      code: 404
    };
  }

  const cmsVehicleId =
    input.cmsVehicleId || input.vehicleId || input.cms_vehicle_id || null;
  if (
    cmsVehicleId &&
    link.cms_vehicle_id &&
    String(cmsVehicleId) !== link.cms_vehicle_id
  ) {
    return {
      error: "cmsVehicleId does not match mapping for autoNumber",
      code: 409
    };
  }

  const cmsScreenId =
    input.cmsScreenId || input.screenId || input.cms_screen_id || null;
  if (
    cmsScreenId &&
    link.cms_screen_id &&
    String(cmsScreenId) !== link.cms_screen_id
  ) {
    return {
      error: "cmsScreenId does not match mapping for autoNumber",
      code: 409
    };
  }

  return { link, autoNorm };
}

function parseCoords(body) {
  const lat = Number(body.lat);
  const lng = Number(body.lng);

  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) {
    return { error: "Invalid coordinates", code: 400 };
  }

  let accuracy_m = null;
  if (body.accuracy != null || body.accuracyM != null || body.accuracy_m != null) {
    accuracy_m = Number(
      body.accuracy != null
        ? body.accuracy
        : body.accuracyM != null
          ? body.accuracyM
          : body.accuracy_m
    );
    if (!Number.isFinite(accuracy_m) || accuracy_m < 0) {
      return { error: "Invalid accuracy", code: 400 };
    }
  }

  let speed_kmh = null;
  if (body.speed != null || body.speedKmh != null || body.speed_kmh != null) {
    speed_kmh = Number(
      body.speed != null
        ? body.speed
        : body.speedKmh != null
          ? body.speedKmh
          : body.speed_kmh
    );
    if (!Number.isFinite(speed_kmh) || speed_kmh < 0) {
      return { error: "Invalid speed", code: 400 };
    }
  }

  const recordedRaw =
    body.recordedAt || body.recorded_at || body.timestamp || null;
  let recordedAt = recordedRaw ? new Date(recordedRaw) : new Date();
  if (Number.isNaN(recordedAt.getTime())) {
    return { error: "Invalid recordedAt", code: 400 };
  }

  const now = Date.now();
  if (recordedAt.getTime() - now > STALE_FUTURE_MS) {
    return { error: "recordedAt is too far in the future", code: 400 };
  }

  const source = body.source || "device_gps";
  if (source !== "device_gps") {
    return { error: 'source must be "device_gps"', code: 400 };
  }

  return {
    lat,
    lng,
    accuracy_m,
    speed_kmh,
    recordedAt: recordedAt.toISOString(),
    deviceId: body.deviceId || body.device_id || null
  };
}

/**
 * CP-56: Prefer Nest lastUpdated / streamSeq over phone recordedAt.
 * Browser geolocation timestamps can go backwards (cached fixes) and used to
 * freeze Admin markers even while the phone was moving.
 */
function isStaleVsExisting(existing, recordedAtIso, body) {
  if (!existing) return false;

  const incomingSeq = Number(
    body && (body.streamSeq != null ? body.streamSeq : body.stream_seq)
  );
  const prevSeq = Number(existing.stream_seq);
  if (Number.isFinite(incomingSeq) && Number.isFinite(prevSeq)) {
    return incomingSeq < prevSeq;
  }

  const incomingOrder = Date.parse(
    (body && (body.lastUpdated || body.last_updated)) ||
      recordedAtIso ||
      0
  );
  const prevOrder = Date.parse(
    existing.last_ingest_at ||
      existing.updated_at ||
      existing.recorded_at ||
      0
  );
  if (!Number.isFinite(incomingOrder) || !Number.isFinite(prevOrder)) {
    return false;
  }
  // Equal timestamps with new coords still accepted (handled by duplicate check).
  return incomingOrder < prevOrder;
}

function gpsUpsertPayload(row, withAd) {
  const base = {
    auto_number_norm: row.auto_number_norm,
    admin_vehicle_id: row.admin_vehicle_id,
    admin_device_id: row.admin_device_id,
    cms_vehicle_id: row.cms_vehicle_id,
    cms_screen_id: row.cms_screen_id,
    device_id: row.device_id,
    lat: row.lat,
    lng: row.lng,
    accuracy_m: row.accuracy_m,
    speed_kmh: row.speed_kmh,
    recorded_at: row.recorded_at,
    updated_at: row.updated_at,
    tracking_active: row.tracking_active,
    source: "device_gps"
  };
  if (!withAd) return base;
  return {
    ...base,
    current_ad_id: row.current_ad_id,
    current_ad_title: row.current_ad_title,
    current_ad_media_url: row.current_ad_media_url,
    current_ad_updated_at: row.current_ad_updated_at
  };
}

async function persistGpsRow(row) {
  const sb = getSupabase();
  if (!sb) {
    if (process.env.VERCEL) {
      throw new Error("CMS GPS persistence requires configured Admin Supabase");
    }
    const rows = new Map(gpsByAuto);
    rows.set(row.auto_number_norm, row);
    if (!writeJsonFile(GPS_FILE, [...rows.values()])) {
      throw new Error("CMS GPS could not be persisted to the local data file");
    }
    putGps(row);
    return { persisted: "local" };
  }

  try {
    let { error } = await sb
      .from("cms_admin_vehicle_gps")
      .upsert(gpsUpsertPayload(row, true), { onConflict: "auto_number_norm" });

    // Columns missing until 202603180002 applied — retry GPS-only.
    if (
      error &&
      (/current_ad_/i.test(error.message || "") ||
        /column/i.test(error.message || ""))
    ) {
      const retry = await sb
        .from("cms_admin_vehicle_gps")
        .upsert(gpsUpsertPayload(row, false), {
          onConflict: "auto_number_norm"
        });
      error = retry.error;
      if (!error) {
        putGps(row);
        writeJsonFile(GPS_FILE, [...gpsByAuto.values()]);
        return {
          persisted: "supabase",
          warning:
            "current_ad columns missing — apply admin/sql/202603180002_cms_admin_gps_current_ad.sql (memory still has ad)"
        };
      }
    }

    if (error) {
      throw new Error(`cms_admin_vehicle_gps upsert failed: ${error.message}`);
    }

    putGps(row);
    writeJsonFile(GPS_FILE, [...gpsByAuto.values()]);
    return { persisted: "supabase" };
  } catch (err) {
    throw new Error(
      `CMS GPS Supabase persistence failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/**
 * Stamp a mapped Admin device from a validated CMS GPS fix, creating a missing
 * device row when its vehicle already exists in Admin.
 */
function stampDevice(db, link, coords) {
  if (!db || !Array.isArray(db.devices) || !link) {
    return { stamped: false };
  }
  if (
    !coords ||
    !Number.isFinite(coords.lat) ||
    !Number.isFinite(coords.lng)
  ) {
    return { stamped: false, error: "CMS GPS coordinates are invalid" };
  }

  const autoNorm = normalizeAutoNumber(link.auto_number_norm);
  let device = link.admin_device_id
    ? db.devices.find(d => d && d.dev === link.admin_device_id)
    : null;

  if (
    device &&
    normalizeAutoNumber(device.vehicle) !== autoNorm
  ) {
    return {
      stamped: false,
      error: `Mapped Admin device does not belong to ${autoNorm}`
    };
  }

  if (!device) {
    const vehicles = Array.isArray(db.vehicles) ? db.vehicles : [];
    const vehicle =
      vehicles.find(
        v => String(v.id) === String(link.admin_vehicle_id)
      ) ||
      vehicles.find(v => normalizeAutoNumber(v.no) === autoNorm);
    if (!vehicle) {
      return {
        stamped: false,
        error: `Mapped Admin vehicle ${autoNorm} was not found`
      };
    }

    const ensured = ensureAdminDevice(db, vehicle, link.admin_device_id);
    if (!ensured.device) {
      return {
        stamped: false,
        error: ensured.error || `Could not create Admin device for ${autoNorm}`
      };
    }
    device = ensured.device;
    if (
      normalizeAutoNumber(device.vehicle) !== autoNorm ||
      (link.admin_device_id && device.dev !== link.admin_device_id)
    ) {
      return {
        stamped: false,
        error: `Mapped Admin device does not match ${autoNorm}`
      };
    }
  }

  Object.assign(device, {
    lat: coords.lat,
    lng: coords.lng,
    speed: Math.max(0, Number(coords.speed_kmh) || 0),
    status: "Online",
    lastSeenAt: new Date().toISOString(),
    real: Date.now()
  });

  return { stamped: true, deviceId: device.dev };
}

/**
 * Ensure an Admin device exists for Live Monitoring markers (/api/live iterates devices).
 * Mutates db.devices when creating; caller must save.
 */
function ensureAdminDevice(db, vehicle, preferredDev) {
  if (!db || !Array.isArray(db.devices) || !vehicle || !vehicle.no) {
    return { device: null, created: false };
  }
  const existing = db.devices.find(
    d => d && String(d.vehicle) === String(vehicle.no)
  );
  if (existing) {
    return { device: existing, created: false };
  }

  const autoNorm = normalizeAutoNumber(vehicle.no);
  const maxId = db.devices.reduce(
    (m, d) => Math.max(m, Number(d.id) || 0),
    0
  );
  let dev = preferredDev
    ? String(preferredDev)
    : `CMS-${autoNorm}`.slice(0, 32);
  if (db.devices.some(d => d && d.dev === dev)) {
    if (preferredDev) {
      return {
        device: null,
        created: false,
        error: `Admin device ID ${dev} is already assigned`
      };
    }
    dev = `CMS-${autoNorm}-${maxId + 1}`.slice(0, 32);
  }

  const rec = {
    id: maxId + 1,
    created: new Date().toISOString(),
    dev,
    vehicle: vehicle.no,
    status: "Offline",
    lat: null,
    lng: null,
    speed: 0,
    lastSeenAt: null
  };
  db.devices.unshift(rec);
  return { device: rec, created: true };
}

async function upsertFromCms(db, body) {
  const resolved = resolveLink(body || {});
  if (resolved.error) return resolved;

  const coords = parseCoords(body || {});
  if (coords.error) return coords;

  const existing = gpsByAuto.get(resolved.autoNorm);
  if (isStaleVsExisting(existing, coords.recordedAt, body)) {
    return {
      ok: true,
      duplicateOrStale: true,
      ignored: true,
      reason: "stale_timestamp",
      autoNumber: resolved.autoNorm,
      storedRecordedAt: existing.recorded_at,
      incomingRecordedAt: coords.recordedAt
    };
  }

  const ad = parseCurrentAd(body, existing);
  const stamp = stampDevice(db, resolved.link, coords);
  if (stamp.error) {
    return { error: stamp.error, code: 409 };
  }

  // Exact duplicate GPS — still refresh current ad if Nest sent a snapshot.
  if (
    existing &&
    existing.recorded_at === coords.recordedAt &&
    existing.lat === coords.lat &&
    existing.lng === coords.lng
  ) {
    const adChanged =
      ad.current_ad_id !== (existing.current_ad_id || null) ||
      ad.current_ad_title !== (existing.current_ad_title || null) ||
      ad.current_ad_media_url !== (existing.current_ad_media_url || null);
    if (adChanged || body.currentAd !== undefined) {
      const merged = {
        ...existing,
        ...ad,
        updated_at: new Date().toISOString()
      };
      const persistAd = await persistGpsRow(merged);
      return {
        ok: true,
        duplicateOrStale: true,
        ignored: false,
        reason: "duplicate_gps_ad_refresh",
        autoNumber: resolved.autoNorm,
        adminVehicleId: resolved.link.admin_vehicle_id,
        adminDeviceId: resolved.link.admin_device_id,
        currentAdTitle: merged.current_ad_title,
        deviceStamped: stamp.stamped,
        ...persistAd
      };
    }
    return {
      ok: true,
      duplicateOrStale: true,
      ignored: true,
      reason: "duplicate",
      autoNumber: resolved.autoNorm,
      adminVehicleId: resolved.link.admin_vehicle_id,
      adminDeviceId: resolved.link.admin_device_id,
      deviceStamped: stamp.stamped
    };
  }

  const now = new Date().toISOString();
  const streamSeq = Number(
    body.streamSeq != null ? body.streamSeq : body.stream_seq
  );
  const row = {
    auto_number_norm: resolved.autoNorm,
    admin_vehicle_id: resolved.link.admin_vehicle_id,
    admin_device_id: resolved.link.admin_device_id,
    cms_vehicle_id:
      body.cmsVehicleId ||
      body.vehicleId ||
      resolved.link.cms_vehicle_id ||
      null,
    cms_screen_id:
      body.cmsScreenId ||
      body.screenId ||
      resolved.link.cms_screen_id ||
      null,
    device_id: coords.deviceId,
    lat: coords.lat,
    lng: coords.lng,
    accuracy_m: coords.accuracy_m,
    speed_kmh: coords.speed_kmh,
    recorded_at: coords.recordedAt,
    updated_at: now,
    last_ingest_at:
      body.lastUpdated || body.last_updated || now,
    stream_seq: Number.isFinite(streamSeq) ? streamSeq : null,
    tracking_active: body.trackingActive !== false,
    source: "device_gps",
    ...ad
  };

  const persist = await persistGpsRow(row);

  const ageMs = Date.now() - Date.parse(row.updated_at);
  const threshold = onlineThresholdMs();

  return {
    ok: true,
    autoNumber: resolved.autoNorm,
    adminVehicleId: resolved.link.admin_vehicle_id,
    adminDeviceId: resolved.link.admin_device_id,
    cmsVehicleId: row.cms_vehicle_id,
    cmsScreenId: row.cms_screen_id,
    lat: row.lat,
    lng: row.lng,
    accuracyM: row.accuracy_m,
    recordedAt: row.recorded_at,
    lastUpdated: row.updated_at,
    trackingActive: row.tracking_active,
    online:
      row.tracking_active && Number.isFinite(ageMs) && ageMs <= threshold,
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    onlineThresholdMs: threshold,
    source: row.source,
    stream: true,
    deviceStamped: stamp.stamped,
    ...persist
  };
}

async function stopFromCms(body) {
  const resolved = resolveLink(body || {});
  if (resolved.error) return resolved;

  const existing = gpsByAuto.get(resolved.autoNorm);
  const now = new Date().toISOString();
  const row = {
    ...(existing || {
      auto_number_norm: resolved.autoNorm,
      admin_vehicle_id: resolved.link.admin_vehicle_id,
      admin_device_id: resolved.link.admin_device_id,
      cms_vehicle_id: resolved.link.cms_vehicle_id,
      cms_screen_id: resolved.link.cms_screen_id,
      device_id: null,
      lat: null,
      lng: null,
      accuracy_m: null,
      speed_kmh: null,
      recorded_at: null,
      source: "device_gps"
    }),
    tracking_active: false,
    updated_at: now,
    // Clear Now playing when GPS tracking stops
    current_ad_id: null,
    current_ad_title: null,
    current_ad_media_url: null,
    current_ad_updated_at: now
  };

  const persist = await persistGpsRow(row);

  return {
    ok: true,
    autoNumber: resolved.autoNorm,
    trackingActive: false,
    ...persist
  };
}

function listFleet() {
  ensureSeeded();
  const now = Date.now();
  const ONLINE_MS = onlineThresholdMs();

  return {
    positions: [...gpsByAuto.values()]
      .filter(r => r.source === "device_gps" && r.lat != null && r.lng != null)
      .map(r => {
        const age = now - Date.parse(r.updated_at || r.recorded_at || 0);
        const stale = !(
          r.tracking_active &&
          Number.isFinite(age) &&
          age <= ONLINE_MS
        );
        return {
          autoNumber: r.auto_number_norm,
          adminVehicleId: r.admin_vehicle_id,
          adminDeviceId: r.admin_device_id,
          cmsVehicleId: r.cms_vehicle_id,
          cmsScreenId: r.cms_screen_id,
          deviceId: r.device_id,
          lat: r.lat,
          lng: r.lng,
          accuracyM: r.accuracy_m,
          speedKmh: r.speed_kmh,
          recordedAt: r.recorded_at,
          lastUpdated: r.updated_at,
          trackingActive: r.tracking_active,
          online: !stale,
          stale,
          ageMs: Number.isFinite(age) ? age : null,
          source: r.source
        };
      }),
    links: [...linkByAuto.values()],
    onlineThresholdMs: ONLINE_MS,
    stream: true,
    fetchedAt: new Date().toISOString()
  };
}

/** Lookup by Admin device id or vehicle document id / plate — for /api/live merge. */
function liveFixForDevice(device) {
  ensureSeeded();
  if (!device) return null;

  for (const row of gpsByAuto.values()) {
    if (
      row.admin_device_id &&
      device.dev &&
      row.admin_device_id === device.dev
    ) {
      return row;
    }
  }

  const link = [...linkByAuto.values()].find(
    l =>
      l.admin_device_id === device.dev ||
      String(l.admin_vehicle_id) === String(device.id)
  );
  if (!link) return null;
  return gpsByAuto.get(link.auto_number_norm) || null;
}

function isCmsManagedDevice(device) {
  ensureSeeded();
  if (!device) return false;
  return [...linkByAuto.values()].some(
    link =>
      link.status === "Active" &&
      ((link.admin_device_id && link.admin_device_id === device.dev) ||
        String(link.admin_vehicle_id) === String(device.id))
  );
}

function ingestKeyConfigured() {
  return String(process.env.CMS_GPS_INGEST_KEY || "").trim();
}

function verifyIngestAuth(req) {
  const expected = ingestKeyConfigured();
  if (!expected) {
    return {
      ok: false,
      code: 503,
      error: "CMS_GPS_INGEST_KEY is not configured on Admin"
    };
  }

  const headerKey = String(
    req.headers["x-cms-ingest-key"] ||
      req.headers["x-cms-gps-key"] ||
      ""
  ).trim();

  const auth = String(req.headers.authorization || "");
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";

  const provided = headerKey || bearer;
  if (!provided || provided !== expected) {
    return { ok: false, code: 401, error: "Invalid CMS GPS ingest key" };
  }

  return { ok: true };
}

/**
 * Upsert Active vehicle_cms_link in Supabase before updating local caches.
 * Used by Admin → CMS provisioning after vehicle create/update.
 */
async function upsertLinkRow(input) {
  ensureSeeded();
  const autoNorm = normalizeAutoNumber(
    input.auto_number_norm || input.autoNumber || input.auto_number
  );
  if (!autoNorm) {
    const error = new Error("auto_number_norm is required");
    error.code = 400;
    throw error;
  }

  const row = {
    id: String(input.id || `link-${autoNorm.toLowerCase()}`),
    auto_number_norm: autoNorm,
    admin_vehicle_id: String(input.admin_vehicle_id),
    admin_device_id: input.admin_device_id
      ? String(input.admin_device_id)
      : null,
    cms_vehicle_id: input.cms_vehicle_id
      ? String(input.cms_vehicle_id)
      : null,
    cms_screen_id: input.cms_screen_id
      ? String(input.cms_screen_id)
      : null,
    status: input.status || "Active"
  };

  const sb = getSupabase();
  if (!sb) {
    throw new Error("Admin↔CMS mapping requires configured Admin Supabase");
  }

  const { error } = await sb.from("vehicle_cms_link").upsert(
    {
      id: row.id,
      auto_number_norm: row.auto_number_norm,
      admin_vehicle_id: row.admin_vehicle_id,
      admin_device_id: row.admin_device_id,
      cms_vehicle_id: row.cms_vehicle_id,
      cms_screen_id: row.cms_screen_id,
      status: row.status,
      updated_at: new Date().toISOString()
    },
    { onConflict: "auto_number_norm" }
  );
  if (error) throw error;

  putLink(row);
  writeJsonFile(LINK_FILE, [...linkByAuto.values()]);
  supabaseAvailable = true;
  return { ...row, persisted: "supabase" };
}

/** Mark a link inactive (e.g. plate rename) in Supabase before updating local caches. */
async function deactivateLink(autoNumberRaw) {
  ensureSeeded();
  const autoNorm = normalizeAutoNumber(autoNumberRaw);
  if (!autoNorm) return { ok: false };
  const existing = linkByAuto.get(autoNorm);

  const sb = getSupabase();
  if (!sb) {
    throw new Error("Admin↔CMS mapping requires configured Admin Supabase");
  }

  const { error } = await sb
    .from("vehicle_cms_link")
    .update({
      status: "Inactive",
      updated_at: new Date().toISOString()
    })
    .eq("auto_number_norm", autoNorm);
  if (error) throw error;

  if (existing) {
    putLink({ ...existing, status: "Inactive" });
    writeJsonFile(LINK_FILE, [...linkByAuto.values()]);
  }
  return { ok: true, autoNumber: autoNorm, missing: !existing };
}

module.exports = {
  normalizeAutoNumber,
  ensureAdminDevice,
  stampDevice,
  initCmsGps,
  refreshLiveGps,
  upsertFromCms,
  stopFromCms,
  listFleet,
  liveFixForDevice,
  isCmsManagedDevice,
  liveSimDisabled,
  onlineThresholdMs,
  verifyIngestAuth,
  ingestKeyConfigured,
  resolveLink,
  upsertLinkRow,
  deactivateLink
};
