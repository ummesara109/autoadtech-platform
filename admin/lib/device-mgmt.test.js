"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const deviceMgmt = require("./device-mgmt");

test("does not write a local Device Management backup on Vercel with Supabase", async () => {
  const env = {
    VERCEL: process.env.VERCEL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  const moduleLoad = Module._load;
  const originalMkdirSync = fs.mkdirSync;
  const originalReadFileSync = fs.readFileSync;
  const deviceMgmtPath = path.join(__dirname, "device-mgmt.js");
  const localStorePath = path.join(__dirname, "..", "data", "admin-dm.json");
  let mkdirCalls = 0;
  const supabase = {
    from(table) {
      const query = {
        select() {
          return query;
        },
        limit() {
          return query;
        },
        then(resolve, reject) {
          const data =
            table === "admin_dm_devices" ? [{ id: "existing-device" }] : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
      };
      return query;
    }
  };

  process.env.VERCEL = "1";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-server-key";
  delete process.env.SUPABASE_SECRET_KEY;
  Module._load = function (request, parent, isMain) {
    if (
      request === "../config/supabase" &&
      parent &&
      parent.filename === deviceMgmtPath
    ) {
      return supabase;
    }
    return moduleLoad.call(this, request, parent, isMain);
  };
  fs.readFileSync = (file, ...args) => {
    if (path.resolve(String(file)) === path.resolve(localStorePath)) {
      const error = new Error("No local test store");
      error.code = "ENOENT";
      throw error;
    }
    return originalReadFileSync(file, ...args);
  };
  fs.mkdirSync = () => {
    mkdirCalls += 1;
    throw new Error("Vercel filesystem is read-only");
  };

  try {
    assert.deepEqual(await deviceMgmt.initDeviceMgmt(), { mode: "supabase" });
    assert.equal(mkdirCalls, 0);
  } finally {
    Module._load = moduleLoad;
    fs.mkdirSync = originalMkdirSync;
    fs.readFileSync = originalReadFileSync;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
