"use strict";

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const { resolvePhone } = require("../lib/cms-provision");

const originalEnv = {
  CMS_DEV_AUTH: process.env.CMS_DEV_AUTH,
  NODE_ENV: process.env.NODE_ENV,
  VERCEL_ENV: process.env.VERCEL_ENV
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("Preview demo mode provisions a vehicle without a real phone", () => {
  process.env.CMS_DEV_AUTH = "true";
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "preview";

  assert.deepEqual(resolvePhone({ partners: [] }, { no: "KA01AB0001" }), {
    registered_mobile: "0000000000",
    mobile_e164: "+910000000000",
    phoneSource: "demo"
  });
});

test("Local demo mode continues to allow provisioning without a real phone", () => {
  process.env.CMS_DEV_AUTH = "true";
  process.env.NODE_ENV = "development";
  delete process.env.VERCEL_ENV;

  assert.equal(
    resolvePhone({ partners: [] }, { no: "KA01AB0001" }).phoneSource,
    "demo"
  );
});

test("Production rejects a missing phone even if demo auth is accidentally enabled", () => {
  process.env.CMS_DEV_AUTH = "true";
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "production";

  assert.throws(
    () => resolvePhone({ partners: [] }, { no: "KA01AB0001" }),
    /A real operator phone number is required/
  );
});

test("Production Node deployments reject demo mode without Vercel metadata", () => {
  process.env.CMS_DEV_AUTH = "true";
  process.env.NODE_ENV = "production";
  delete process.env.VERCEL_ENV;

  assert.throws(
    () => resolvePhone({ partners: [] }, { no: "KA01AB0001" }),
    /A real operator phone number is required/
  );
});

test("Demo provisioning still prefers a real vehicle or assigned partner phone", () => {
  process.env.CMS_DEV_AUTH = "true";
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "preview";

  const phone = resolvePhone(
    { partners: [{ vehicle: "KA01AB0001", phone: "9876543210" }] },
    { no: "KA01AB0001", phone: "" }
  );

  assert.equal(phone.phoneSource, "partner");
  assert.equal(phone.mobile_e164, "+919876543210");
});
