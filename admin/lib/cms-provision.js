"use strict";

/*
  Admin → CMS provisioning (Option B).
  When Admin creates/updates a vehicle, ensure:
    1) CMS login graph: cms_vehicles, cms_operators, cms_screens, cms_screen_assignments
    2) Active vehicle_cms_link for Live GPS ingest
  Uses Admin Supabase service role (same project as CMS Nest). No frontend secrets.
  Does not invent GPS coordinates.
*/

const crypto = require("crypto");
const cmsGps = require("./cms-gps");

const CMS_MIGRATIONS_HINT = [
  "CMS login tables are missing on Admin Supabase.",
  "Apply these SQL files in order (Admin project only — not Advertiser):",
  "1) cms/supabase/migrations/202603140001_cms_milestone1.sql",
  "2) cms/supabase/migrations/202603170001_cms_silent_gps.sql",
  "3) cms/supabase/migrations/202603140003_cms_one_screen_queue.sql",
  "4) cms/supabase/migrations/202603140004_cms_queue_media_url.sql",
  "Optional seed: cms/supabase/migrations/202603140002_cms_seed_dev.sql",
  "GPS link/store (if not already): admin/sql/202603180001_cms_admin_gps.sql",
  "See docs/cms-gps-live-completion-plan.md"
].join(" ");

/** Same creatives as CMS Nest DEV_DEMO_ADS (web/public paths). */
const DEV_DEMO_ADS = [
  {
    title: "Demo Ad 1 Restaurant",
    advertiser: "NiyoAds Demo",
    durationSec: 30,
    mediaUrl: "/test-ad-restaurant.mp4",
    externalAdId: "dev-demo-restaurant"
  },
  {
    title: "Demo Ad 2 BBQ Catering",
    advertiser: "NiyoAds Demo",
    durationSec: 30,
    mediaUrl: "/ad2-bbq-catering.mp4",
    externalAdId: "dev-demo-bbq"
  }
];
const DEFAULT_CMS_DEMO_AUTONUMBERS = ["KA01AB1234", "KA02CD5678"];

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

/** Deterministic UUID from a stable key (valid UUID string). */
function uuidFromKey(key) {
  const h = crypto.createHash("sha256").update(String(key)).digest();
  const bytes = Buffer.from(h.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function isMissingTableError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || err.hint || err);
  const code = String(err.code || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /Could not find the table/i.test(msg) ||
    /relation .* does not exist/i.test(msg) ||
    /schema cache/i.test(msg)
  );
}

function missingTablesError(cause) {
  const e = new Error(CMS_MIGRATIONS_HINT);
  e.code = 503;
  e.cause = cause;
  e.cmsMigrationsRequired = true;
  return e;
}

function supabaseRequiredError() {
  const e = new Error(
    "CMS provisioning requires Admin Supabase (SUPABASE_URL + SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY). " +
      "Configure the same Admin project CMS Nest uses, then re-save the vehicle."
  );
  e.code = 503;
  return e;
}

function normalizePhoneFields(raw, source) {
  const digits = String(raw || "").replace(/\D/g, "");
  let nationalNumber = "";
  if (digits.length === 10) {
    nationalNumber = digits;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    nationalNumber = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    nationalNumber = digits.slice(2);
  }
  if (!/^[6-9]\d{9}$/.test(nationalNumber)) return null;

  return {
    registered_mobile: nationalNumber,
    mobile_e164: `+91${nationalNumber}`,
    phoneSource: source
  };
}

function demoAuthEnabled() {
  return String(process.env.CMS_DEV_AUTH || "").trim().toLowerCase() === "true";
}

function isConfiguredDemoVehicle(autoNumber) {
  const configured = process.env.CMS_DEMO_VEHICLES;
  const allowed = (configured === undefined
    ? DEFAULT_CMS_DEMO_AUTONUMBERS
    : configured.split(",")
  ).map(value => cmsGps.normalizeAutoNumber(value));
  return (
    demoAuthEnabled() &&
    allowed.includes(cmsGps.normalizeAutoNumber(autoNumber))
  );
}

function resolvePhone(db, vehicle) {
  const autoNumber = cmsGps.normalizeAutoNumber(vehicle && vehicle.no);
  // Prefer phone on the Admin vehicle record (real operator mobile).
  const rawVehiclePhone = String((vehicle && vehicle.phone) || "").trim();
  const fromVehicle = normalizePhoneFields(rawVehiclePhone, "vehicle");
  if (fromVehicle) {
    return fromVehicle;
  }
  if (rawVehiclePhone) {
    const e = new Error(
      "Vehicle operator phone must be a valid Indian mobile number (10 digits, optionally prefixed with 0 or +91)."
    );
    e.code = 400;
    throw e;
  }

  const partners = (db && db.partners) || [];
  const partner = partners.find(
    p =>
      p &&
      cmsGps.normalizeAutoNumber(p.vehicle) === autoNumber &&
      !["inactive", "pending"].includes(
        String(p.status || "Active").toLowerCase()
      ) &&
      p.phone
  );
  const fromPartner = partner
    ? normalizePhoneFields(partner.phone, "partner")
    : null;
  if (fromPartner) {
    return fromPartner;
  }
  if (partner && !isConfiguredDemoVehicle(autoNumber)) {
    const e = new Error(
      "The assigned partner phone must be a valid Indian mobile number (10 digits, optionally prefixed with 0 or +91)."
    );
    e.code = 400;
    throw e;
  }

  if (isConfiguredDemoVehicle(autoNumber)) {
    return {
      registered_mobile: "0000000000",
      mobile_e164: "+910000000000",
      phoneSource: "demo"
    };
  }

  const e = new Error(
    "A real operator phone number is required for CMS OTP login. Add it to the vehicle or its assigned partner."
  );
  e.code = 400;
  throw e;
}

async function ensureRole(sb) {
  const { error } = await sb.from("cms_roles").upsert(
    {
      code: "cms_operator",
      description: "Vehicle operator with access to assigned CMS screens"
    },
    { onConflict: "code" }
  );
  if (error) {
    if (isMissingTableError(error)) throw missingTablesError(error);
    throw error;
  }
}

async function upsertCmsVehicle(sb, { vehicleId, autoNumber, displayName, phone, status }) {
  const cmsStatus =
    String(status || "Active").toLowerCase() === "active"
      ? "active"
      : String(status || "").toLowerCase() === "inactive"
        ? "inactive"
        : "active";

  const row = {
    id: vehicleId,
    auto_number: autoNumber,
    display_name: displayName || autoNumber,
    make_model: "",
    registered_mobile: phone.registered_mobile,
    mobile_e164: phone.mobile_e164,
    status: cmsStatus,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await sb
    .from("cms_vehicles")
    .upsert(row, { onConflict: "id" })
    .select("id, auto_number")
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) throw missingTablesError(error);
    // Unique on auto_number if id differs — update by auto_number
    if (/duplicate|unique/i.test(String(error.message || ""))) {
      const { data: existing, error: findErr } = await sb
        .from("cms_vehicles")
        .select("id")
        .eq("auto_number", autoNumber)
        .maybeSingle();
      if (findErr) {
        if (isMissingTableError(findErr)) throw missingTablesError(findErr);
        throw findErr;
      }
      if (existing && existing.id) {
        const { data: updated, error: updErr } = await sb
          .from("cms_vehicles")
          .update({
            display_name: row.display_name,
            registered_mobile: row.registered_mobile,
            mobile_e164: row.mobile_e164,
            status: row.status,
            updated_at: row.updated_at
          })
          .eq("id", existing.id)
          .select("id, auto_number")
          .maybeSingle();
        if (updErr) {
          if (isMissingTableError(updErr)) throw missingTablesError(updErr);
          throw updErr;
        }
        return updated;
      }
    }
    throw error;
  }
  return data || row;
}

async function upsertOperator(sb, { operatorId, vehicleId, displayName }) {
  const { data: byVehicle, error: findErr } = await sb
    .from("cms_operators")
    .select("id")
    .eq("vehicle_id", vehicleId)
    .maybeSingle();
  if (findErr) {
    if (isMissingTableError(findErr)) throw missingTablesError(findErr);
    throw findErr;
  }

  if (byVehicle && byVehicle.id) {
    const { data, error } = await sb
      .from("cms_operators")
      .update({
        display_name: displayName || "Operator",
        role_code: "cms_operator",
        is_active: true,
        updated_at: new Date().toISOString()
      })
      .eq("id", byVehicle.id)
      .select("id")
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) throw missingTablesError(error);
      throw error;
    }
    return data || byVehicle;
  }

  const { data, error } = await sb
    .from("cms_operators")
    .insert({
      id: operatorId,
      vehicle_id: vehicleId,
      role_code: "cms_operator",
      display_name: displayName || "Operator",
      is_active: true
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) throw missingTablesError(error);
    throw error;
  }
  return data || { id: operatorId };
}

async function upsertScreen(sb, { screenId, vehicleId }) {
  const { data: existing, error: findErr } = await sb
    .from("cms_screens")
    .select("id")
    .eq("vehicle_id", vehicleId)
    .eq("code", "REAR")
    .maybeSingle();
  if (findErr) {
    if (isMissingTableError(findErr)) throw missingTablesError(findErr);
    throw findErr;
  }

  if (existing && existing.id) {
    const { data, error } = await sb
      .from("cms_screens")
      .update({
        label: "Rear screen",
        placement: "rear",
        is_active: true
      })
      .eq("id", existing.id)
      .select("id")
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) throw missingTablesError(error);
      throw error;
    }
    return data || existing;
  }

  const { data, error } = await sb
    .from("cms_screens")
    .insert({
      id: screenId,
      vehicle_id: vehicleId,
      code: "REAR",
      label: "Rear screen",
      placement: "rear",
      is_active: true
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) throw missingTablesError(error);
    throw error;
  }
  return data || { id: screenId };
}

async function ensureAssignment(sb, operatorId, screenId) {
  const { error } = await sb.from("cms_screen_assignments").upsert(
    {
      operator_id: operatorId,
      screen_id: screenId
    },
    { onConflict: "operator_id,screen_id" }
  );
  if (error) {
    if (isMissingTableError(error)) throw missingTablesError(error);
    // Some PostgREST versions need ignore duplicates via select+insert
    if (/duplicate|unique|conflict/i.test(String(error.message || ""))) {
      return;
    }
    throw error;
  }
}

async function renameCmsAutoIfNeeded(sb, { previousAuto, nextAuto, vehicleId }) {
  if (!previousAuto || previousAuto === nextAuto) return;
  const { error } = await sb
    .from("cms_vehicles")
    .update({
      auto_number: nextAuto,
      updated_at: new Date().toISOString()
    })
    .eq("id", vehicleId);
  if (error && isMissingTableError(error)) throw missingTablesError(error);
  // ignore if row not found yet — upsert follows
}

async function detectAdQueueColumns(sb) {
  const probe = async col => {
    const { error } = await sb.from("cms_ad_queue").select(col).limit(1);
    return !error;
  };
  const hasMediaUrl = await probe("media_url");
  const hasExternalAdId = await probe("external_ad_id");
  const hasVehicleId = await probe("vehicle_id");
  const hasStartedAt = await probe("started_at");
  // milestone1 uses lowercase queued/playing; migration 003 uses QUEUED/PLAYING
  const modern = hasMediaUrl && hasExternalAdId && hasVehicleId;
  return {
    hasMediaUrl,
    hasExternalAdId,
    hasVehicleId,
    hasStartedAt,
    playing: modern ? "PLAYING" : "playing",
    queued: modern ? "QUEUED" : "queued"
  };
}

/**
 * Seed the same DEV demo MP4s into cms_ad_queue when the screen is idle.
 * Compatible with milestone1 (lowercase, no media_url) and post-003/004 schema.
 * Does not interrupt PLAYING / existing QUEUED rows. No GPS / no fabricated coords.
 */
async function ensureDemoAdQueue(sb, { screenId, vehicleId }) {
  let cols;
  try {
    cols = await detectAdQueueColumns(sb);
  } catch (err) {
    if (isMissingTableError(err)) throw missingTablesError(err);
    console.warn("cms_ad_queue schema probe failed:", err.message || err);
    return { seeded: false, reason: "schema_probe_failed" };
  }

  const { data: playingRows, error: playErr } = await sb
    .from("cms_ad_queue")
    .select("id")
    .eq("screen_id", screenId)
    .eq("status", cols.playing)
    .limit(1);
  if (playErr) {
    if (isMissingTableError(playErr)) throw missingTablesError(playErr);
    console.warn("cms_ad_queue playing check skipped:", playErr.message);
    return { seeded: false, reason: "check_failed" };
  }
  if ((playingRows || []).length > 0) {
    return { seeded: false, reason: "already_playing" };
  }

  const { data: queuedRows, error: qErr } = await sb
    .from("cms_ad_queue")
    .select("id")
    .eq("screen_id", screenId)
    .eq("status", cols.queued)
    .limit(1);
  if (qErr) {
    if (isMissingTableError(qErr)) throw missingTablesError(qErr);
    console.warn("cms_ad_queue queued check skipped:", qErr.message);
    return { seeded: false, reason: "check_failed" };
  }
  if ((queuedRows || []).length > 0) {
    return { seeded: false, reason: "already_queued" };
  }

  const { data: maxRow } = await sb
    .from("cms_ad_queue")
    .select("position")
    .eq("screen_id", screenId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  let pos = (maxRow && maxRow.position) || 0;

  const rows = DEV_DEMO_ADS.map((ad, i) => {
    pos += 1;
    const advertiser = cols.hasMediaUrl
      ? ad.advertiser
      : `${ad.advertiser}|${ad.mediaUrl}`;
    const row = {
      id: uuidFromKey(`cms-ad:${screenId}:${ad.externalAdId}`),
      screen_id: screenId,
      title: ad.title,
      advertiser,
      duration_sec: ad.durationSec,
      position: pos,
      status: i === 0 ? cols.playing : cols.queued
    };
    if (cols.hasVehicleId) row.vehicle_id = vehicleId;
    if (cols.hasExternalAdId) row.external_ad_id = ad.externalAdId;
    if (cols.hasMediaUrl) row.media_url = ad.mediaUrl;
    if (cols.hasStartedAt && i === 0) {
      row.started_at = new Date().toISOString();
    }
    return row;
  });

  const { error: insErr } = await sb.from("cms_ad_queue").insert(rows);
  if (insErr) {
    if (isMissingTableError(insErr)) throw missingTablesError(insErr);
    if (/duplicate|unique|conflict/i.test(String(insErr.message || ""))) {
      return { seeded: false, reason: "duplicate" };
    }
    console.warn("cms_ad_queue demo seed failed:", insErr.message);
    return { seeded: false, reason: insErr.message };
  }

  return {
    seeded: true,
    count: rows.length,
    mediaUrls: DEV_DEMO_ADS.map(a => a.mediaUrl),
    statusMode: cols.playing === "PLAYING" ? "upper" : "lower",
    hasMediaUrl: cols.hasMediaUrl
  };
}

/**
 * Provision CMS login graph + GPS link for an Admin vehicle record.
 * @param {object} db Admin in-memory db (devices may be mutated)
 * @param {object} vehicle Admin vehicle { id, no, owner, status, ... }
 * @param {{ previousNo?: string }} [opts]
 */
async function provisionVehicleForCms(db, vehicle, opts = {}) {
  if (!vehicle || !vehicle.no) {
    const e = new Error("Vehicle number (auto/plate) is required for CMS provisioning");
    e.code = 400;
    throw e;
  }

  const sb = getSupabase();
  if (!sb) throw supabaseRequiredError();

  await cmsGps.initCmsGps();

  const autoNorm = cmsGps.normalizeAutoNumber(vehicle.no);
  const previousNo = opts.previousNo ? String(opts.previousNo) : null;
  const previousNorm = previousNo
    ? cmsGps.normalizeAutoNumber(previousNo)
    : null;

  // Stable IDs keyed by current auto (and Admin vehicle id for uniqueness)
  const idKey = `admin-vehicle:${vehicle.id}:${autoNorm}`;
  const vehicleId = uuidFromKey(`cms-vehicle:${idKey}`);
  const operatorId = uuidFromKey(`cms-operator:${idKey}`);
  const screenId = uuidFromKey(`cms-screen:${idKey}:REAR`);

  // If plate renamed, try to keep prior cms vehicle row by previous key
  let cmsVehicleId = vehicleId;
  if (previousNorm && previousNorm !== autoNorm) {
    const prevKey = `admin-vehicle:${vehicle.id}:${previousNorm}`;
    const prevVehicleId = uuidFromKey(`cms-vehicle:${prevKey}`);
    cmsVehicleId = prevVehicleId;
  }

  const phone = resolvePhone(db, vehicle);

  try {
    /* CMS tables first — avoid mutating Admin devices if migrations are missing. */
    await ensureRole(sb);

    if (previousNorm && previousNorm !== autoNorm) {
      await renameCmsAutoIfNeeded(sb, {
        previousAuto: previousNorm,
        nextAuto: autoNorm,
        vehicleId: cmsVehicleId
      });
    }

    const vRow = await upsertCmsVehicle(sb, {
      vehicleId: cmsVehicleId,
      autoNumber: autoNorm,
      displayName: vehicle.owner
        ? `${vehicle.owner} (${autoNorm})`
        : autoNorm,
      phone,
      status: vehicle.status
    });
    cmsVehicleId = (vRow && vRow.id) || cmsVehicleId;

    const op = await upsertOperator(sb, {
      operatorId,
      vehicleId: cmsVehicleId,
      displayName: vehicle.owner || "Operator"
    });
    const opId = (op && op.id) || operatorId;

    const scr = await upsertScreen(sb, {
      screenId,
      vehicleId: cmsVehicleId
    });
    const scrId = (scr && scr.id) || screenId;

    await ensureAssignment(sb, opId, scrId);

    // Deactivate other active screens for this vehicle (one-screen rule)
    const { error: deactErr } = await sb
      .from("cms_screens")
      .update({ is_active: false })
      .eq("vehicle_id", cmsVehicleId)
      .neq("id", scrId);
    if (deactErr && isMissingTableError(deactErr)) {
      throw missingTablesError(deactErr);
    }

    const adsResult = await ensureDemoAdQueue(sb, {
      screenId: scrId,
      vehicleId: cmsVehicleId
    });

    const { device, created: deviceCreated } = cmsGps.ensureAdminDevice(
      db,
      vehicle
    );

    const link = await cmsGps.upsertLinkRow({
      id: `link-${autoNorm.toLowerCase()}`,
      auto_number_norm: autoNorm,
      admin_vehicle_id: String(vehicle.id),
      admin_device_id: device ? String(device.dev) : null,
      cms_vehicle_id: String(cmsVehicleId),
      cms_screen_id: String(scrId),
      status: "Active"
    });

    // Drop old link key if plate renamed
    if (previousNorm && previousNorm !== autoNorm) {
      await cmsGps.deactivateLink(previousNorm);
    }

    return {
      ok: true,
      autoNumber: autoNorm,
      cmsVehicleId: String(cmsVehicleId),
      cmsOperatorId: String(opId),
      cmsScreenId: String(scrId),
      adminDeviceId: device ? device.dev : null,
      deviceCreated,
      phoneSource: phone.phoneSource,
      linkId: link && link.id,
      demoAds: adsResult
    };
  } catch (err) {
    if (err && err.cmsMigrationsRequired) throw err;
    if (isMissingTableError(err)) throw missingTablesError(err);
    const errorName = err instanceof Error ? err.name : "UnknownError";
    const errorCode =
      err && /^[a-z0-9_-]{1,64}$/i.test(String(err.code || ""))
        ? ` (${err.code})`
        : "";
    console.error(`cms-provision failed: ${errorName}${errorCode}`);
    const e = new Error(
      "CMS provisioning failed. Check Admin Supabase availability and CMS migrations."
    );
    e.code = err && err.code && Number(err.code) >= 400 ? err.code : 502;
    throw e;
  }
}

module.exports = {
  provisionVehicleForCms,
  resolvePhone,
  CMS_MIGRATIONS_HINT,
  uuidFromKey,
  isMissingTableError
};
