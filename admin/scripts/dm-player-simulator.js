#!/usr/bin/env node
"use strict";

/*
  LABEL: DEVELOPMENT DEVICE SIMULATOR — NOT PRODUCTION CONNECTIVITY

  Simulates an advertising player against Admin /api/dm/device/* for local tests.
  Do not present this as a real deployed screen.
*/

const http = require("http");
const https = require("https");
const { URL } = require("url");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const BASE = arg("--base", process.env.DM_BASE_URL || "http://127.0.0.1:3001");
const DEVICE_ID = arg("--deviceId", process.env.DM_SIM_DEVICE_ID || "");
const SECRET = arg("--secret", process.env.DM_SIM_SECRET || "");
const INTERVAL = Number(arg("--interval", "5")) * 1000;
const LABEL = arg("--label", "DEV SIMULATOR — not production");

if (!DEVICE_ID || !SECRET) {
  console.error(
    `[${LABEL}] Usage: node dm-player-simulator.js --base URL --deviceId ADM-… --secret <once-shown-secret>`
  );
  console.error(
    "Register a device in Admin Device Management first, copy the one-time secret."
  );
  process.exit(1);
}

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, BASE);
    const lib = u.protocol === "https:" ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {})
        }
      },
      res => {
        let raw = "";
        res.on("data", c => (raw += c));
        res.on("end", () => {
          let j = {};
          try {
            j = raw ? JSON.parse(raw) : {};
          } catch (_) {}
          if (res.statusCode >= 400) {
            reject(
              new Error(
                (j.error || raw || res.statusCode) + " (" + res.statusCode + ")"
              )
            );
          } else resolve(j);
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`[${LABEL}] base=${BASE} deviceId=${DEVICE_ID}`);
  console.log(`[${LABEL}] Authenticating…`);
  const auth = await request("POST", "/api/dm/device/auth", {
    deviceId: DEVICE_ID,
    secret: SECRET
  });
  const token = auth.token;
  console.log(
    `[${LABEL}] Activated lifecycle=${auth.lifecycleStatus} hbInterval=${auth.heartbeatIntervalSec}s`
  );

  let n = 0;
  async function tick() {
    n++;
    const idem = `sim-${DEVICE_ID}-${Date.now()}-${n}`;
    const hb = await request(
      "POST",
      "/api/dm/device/heartbeat",
      {
        idempotencyKey: idem,
        playerStatus: "running",
        networkStatus: "wifi",
        appVersion: "sim-0.1.0",
        batteryPct: 72,
        storageFreeMb: 1400,
        storageTotalMb: 8000,
        memoryUsedMb: 512,
        signalStrength: 3,
        temperatureC: 42
      },
      token
    );
    console.log(
      `[${LABEL}] heartbeat #${n} connection=${hb.connectionStatus} health=${hb.healthStatus} pending=${(hb.pendingCommands || []).length}`
    );
    for (const cmd of hb.pendingCommands || []) {
      console.log(`[${LABEL}] ack command ${cmd.id} ${cmd.commandType}`);
      await request(
        "POST",
        `/api/dm/device/commands/${cmd.id}/ack`,
        { status: "completed" },
        token
      );
    }
  }

  await tick();
  setInterval(() => {
    tick().catch(err => console.error(`[${LABEL}] error:`, err.message));
  }, INTERVAL);
}

main().catch(err => {
  console.error(`[${LABEL}] fatal:`, err.message);
  process.exit(1);
});
