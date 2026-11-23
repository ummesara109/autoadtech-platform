"use strict";

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const { resolvePhone } = require("../lib/cms-provision");

const originalEnv = {
  CMS_DEV_AUTH: process.env.CMS_DEV_AUTH,
  CMS_DEMO_AUTH: process.env.CMS_DEMO_AUTH,
  CMS_DEMO_VEHICLES: process.env.CMS_DEMO_VEHICLES,
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
  process.env.CMS_DEMO_VEHICLES = "KA01AB0001";
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "preview";

  assert.deepEqual(resolvePhone({ partners: [] }, { no: "KA01AB0001" }), {
    registered_mobile: null,
    mobile_e164: null,
    phoneSource: "demo"
  });
});

test("Preview demo mode accepts uppercase CMS_DEV_AUTH values", () => {
  process.env.CMS_DEV_AUTH = "TRUE";
  process.env.CMS_DEMO_VEHICLES = "KA01AB0001";
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "preview";

  assert.equal(
    resolvePhone({ partners: [] }, { no: "KA01AB0001" }).phoneSource,
    "demo"
  );
});

test("Local demo mode continues to allow provisioning without a real phone", () => {
  process.env.CMS_DEV_AUTH = "true";
  process.env.CMS_DEMO_VEHICLES = "KA01AB0001";
  process.env.NODE_ENV = "development";
  delete process.env.VERCEL_ENV;

  assert.equal(
    resolvePhone({ partners: [] }, { no: "KA01AB0001" }).phoneSource,
    "demo"
  );
});

test("Production demo auth provisions the two built-in demo vehicles without phones", () => {
  process.env.CMS_DEV_AUTH = "true";
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "production";

  for (const no of ["KA01AB1234", "KA02CD5678"]) {
    assert.equal(
      resolvePhone({ partners: [] }, { no }).phoneSource,
      "demo"
    );
  }
});

test("temporary Production demo mode provisions only the five designated plates without phone placeholders", () => {
  process.env.CMS_DEV_AUTH = "false";
  process.env.CMS_DEMO_AUTH = "true";
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "production";

  for (const no of [
    "KA01 AB 0000",
    "KA01AB0001",
    "KA01AB0002",
    "KA01AB0003",
    "KA01AB0004"
  ]) {
    assert.deepEqual(resolvePhone({ partners: [] }, { no }), {
      registered_mobile: null,
      mobile_e164: null,
      phoneSource: "demo"
    });
  }

  assert.throws(
    () => resolvePhone({ partners: [] }, { no: "KA01AB0005" }),
    /A real operator phone number is required/
  );
});

test("the four additional demo plates allow phone-less registration without enabling demo login", () => {
  process.env.CMS_DEV_AUTH = "false";
  process.env.CMS_DEMO_AUTH = "false";
  process.env.CMS_DEMO_VEHICLES = "";
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "production";

  for (const no of [
    "KA01AB0001",
    "KA01AB0002",
    "KA01AB0003",
    "KA01AB0004"
  ]) {
    assert.deepEqual(resolvePhone({ partners: [] }, { no }), {
      registered_mobile: null,
      mobile_e164: null,
      phoneSource: "demo"
    });
  }

  assert.throws(
    () => resolvePhone({ partners: [] }, { no: "KA01AB0005" }),
    /A real operator phone number is required/
  );
  assert.throws(
    () => resolvePhone({ partners: [] }, { no: "KA01AB0000" }),
    /A real operator phone number is required/
  );
});

test("turning off temporary demo mode restores phone requirement", () => {
  process.env.CMS_DEV_AUTH = "false";
  process.env.CMS_DEMO_AUTH = "false";
  process.env.CMS_DEMO_VEHICLES = "";
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "production";

  assert.throws(
    () => resolvePhone({ partners: [] }, { no: "KA01AB0000" }),
    /A real operator phone number is required/
  );
});

test("Production demo registration does not invent a phone from an invalid assigned-partner value", () => {
  process.env.CMS_DEV_AUTH = "true";
  process.env.CMS_DEMO_AUTH = "true";
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "production";

  assert.deepEqual(
    resolvePhone(
      { partners: [{ vehicle: "KA01AB0001", phone: "not-a-phone" }] },
      { no: "KA01AB0001" }
    ),
    {
      registered_mobile: null,
      mobile_e164: null,
      phoneSource: "demo"
    }
  );
});

test("Production demo auth rejects vehicles outside the configured allowlist", () => {
  process.env.CMS_DEV_AUTH = "true";
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "production";

  assert.throws(
    () => resolvePhone({ partners: [] }, { no: "KA01AB0005" }),
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

test("Assigned partner matching ignores registration-number spacing and hyphens", () => {
  process.env.CMS_DEV_AUTH = "false";
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "production";

  const phone = resolvePhone(
    { partners: [{ vehicle: "KA-01 AB 0001", phone: "09876543210" }] },
    { no: "KA01AB0001", phone: "" }
  );

  assert.equal(phone.registered_mobile, "9876543210");
  assert.equal(phone.mobile_e164, "+919876543210");
  assert.equal(phone.phoneSource, "partner");
});

test("Production rejects invalid Indian phone values instead of provisioning them", () => {
  process.env.CMS_DEV_AUTH = "true";
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "production";

  assert.throws(
    () =>
      resolvePhone(
        { partners: [] },
        { no: "KA01AB0001", phone: "1234567890" }
      ),
    /valid Indian mobile number/
  );
});
