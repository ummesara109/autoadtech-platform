"use strict";

/*
  Admin-owned CMS OTP challenges.
  Channel: Admin dashboard inbox (no SMS provider in this Admin app).
  Nest requests/verifies via CMS_GPS_INGEST_KEY; operators read pending codes via Admin Bearer.
*/

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const cmsGps = require("./cms-gps");

const DATA_DIR = path.join(__dirname, "..", "data");
const OTP_FILE = path.join(DATA_DIR, "cms-otp-challenges.json");
const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/** @type {Map<string, object>} */
const byId = new Map();
let seeded = false;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error("cms-otp persist failed:", err.message);
  }
}

function hashOtp(otp) {
  return crypto.createHash("sha256").update(String(otp)).digest("hex");
}

function generateOtp() {
  // 6-digit, never all zeros
  let n = crypto.randomInt(0, 1_000_000);
  if (n < 100000) n += 100000;
  return String(n).padStart(6, "0");
}

function ensureSeeded() {
  if (seeded) return;
  seeded = true;
  const disk = readJson(OTP_FILE);
  if (Array.isArray(disk)) {
    const now = Date.now();
    for (const row of disk) {
      if (!row || !row.id) continue;
      if (row.consumedAt) continue;
      if (Date.parse(row.expiresAt) < now) continue;
      byId.set(row.id, row);
    }
  }
}

function persist() {
  writeJson(OTP_FILE, [...byId.values()]);
}

function purgeExpired() {
  ensureSeeded();
  const now = Date.now();
  for (const [id, row] of byId) {
    if (row.consumedAt || Date.parse(row.expiresAt) < now) {
      byId.delete(id);
    }
  }
}

/**
 * Nest → Admin: create OTP for a CMS auto login.
 * Body: { challengeId?, autoNumber, cmsVehicleId, cmsOperatorId, maskedMobile, mobileE164 }
 */
function issueFromCms(body) {
  ensureSeeded();
  purgeExpired();

  const autoNorm = cmsGps.normalizeAutoNumber(
    body.autoNumber || body.auto_number
  );
  if (!autoNorm) {
    return { error: "autoNumber is required", code: 400 };
  }

  const challengeId = String(body.challengeId || crypto.randomUUID());
  const otp = generateOtp();
  const now = Date.now();
  const row = {
    id: challengeId,
    auto_number_norm: autoNorm,
    cms_vehicle_id: body.cmsVehicleId || body.vehicleId || null,
    cms_operator_id: body.cmsOperatorId || body.operatorId || null,
    masked_mobile: body.maskedMobile || body.masked_mobile || "••••",
    mobile_e164: body.mobileE164 || body.mobile_e164 || null,
    otp_hash: hashOtp(otp),
    // Plaintext for Admin inbox only — never returned to CMS Nest/PWA
    otp_plain: otp,
    attempts: 0,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
    consumedAt: null,
    channel: "admin_dashboard"
  };

  byId.set(challengeId, row);
  persist();

  console.log(
    `CMS OTP issued for ${autoNorm} (${row.masked_mobile}) — view Admin → CMS OTP Inbox`
  );

  return {
    ok: true,
    challengeId,
    autoNumber: autoNorm,
    maskedMobile: row.masked_mobile,
    expiresAt: row.expiresAt,
    expiresInSec: Math.floor(TTL_MS / 1000),
    channel: "admin_dashboard",
    delivery: "Admin dashboard OTP inbox (no SMS provider configured)"
  };
}

/**
 * Nest → Admin: verify OTP. Consumes on success.
 */
function verifyFromCms(body) {
  ensureSeeded();
  purgeExpired();

  const challengeId = String(body.challengeId || body.id || "").trim();
  const otp = String(body.otp || "").trim();
  if (!challengeId || !/^\d{6}$/.test(otp)) {
    return { error: "challengeId and 6-digit otp are required", code: 400 };
  }

  const row = byId.get(challengeId);
  if (!row || row.consumedAt) {
    return { error: "OTP challenge expired or invalid", code: 400 };
  }
  if (Date.parse(row.expiresAt) < Date.now()) {
    byId.delete(challengeId);
    persist();
    return { error: "OTP expired — request a new code", code: 400 };
  }

  row.attempts = (row.attempts || 0) + 1;
  if (row.attempts > MAX_ATTEMPTS) {
    byId.delete(challengeId);
    persist();
    return { error: "Too many invalid attempts — request a new code", code: 401 };
  }

  if (hashOtp(otp) !== row.otp_hash) {
    persist();
    return { error: "Invalid OTP", code: 401 };
  }

  row.consumedAt = new Date().toISOString();
  row.otp_plain = null;
  byId.set(challengeId, row);
  persist();

  return {
    ok: true,
    challengeId,
    autoNumber: row.auto_number_norm,
    cmsVehicleId: row.cms_vehicle_id,
    cmsOperatorId: row.cms_operator_id
  };
}

/** Admin Bearer: pending OTPs for inbox (includes otp_plain until consumed). */
function listPending() {
  ensureSeeded();
  purgeExpired();
  const now = Date.now();
  return {
    channel: "admin_dashboard",
    delivery: "Show code to vehicle operator / send manually (SMS not wired)",
    pending: [...byId.values()]
      .filter(r => !r.consumedAt && Date.parse(r.expiresAt) >= now)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map(r => ({
        challengeId: r.id,
        autoNumber: r.auto_number_norm,
        maskedMobile: r.masked_mobile,
        otp: r.otp_plain,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
        attempts: r.attempts || 0,
        channel: r.channel
      })),
    fetchedAt: new Date().toISOString()
  };
}

module.exports = {
  issueFromCms,
  verifyFromCms,
  listPending,
  TTL_MS
};
