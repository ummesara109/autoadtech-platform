"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ensureAdminDevice, stampDevice } = require("./cms-gps");

test("creates a missing mapped Admin device without inventing a position", () => {
  const db = {
    vehicles: [{ id: 21, no: "KA01AB0000" }],
    devices: [{ id: 1, dev: "DEV-001", vehicle: "KA01AB1234" }]
  };

  const result = ensureAdminDevice(
    db,
    db.vehicles[0],
    "CMS-KA01AB0000"
  );
  const device = db.devices.find(d => d.dev === "CMS-KA01AB0000");

  assert.equal(result.created, true);
  assert.ok(device);
  assert.equal(device.vehicle, "KA01AB0000");
  assert.equal(device.lat, null);
  assert.equal(device.lng, null);
  assert.equal(device.status, "Offline");
});

test("does not create a device when the mapped ID belongs to another vehicle", () => {
  const db = {
    vehicles: [{ id: 21, no: "KA01AB0000" }],
    devices: [{
      id: 1,
      dev: "CMS-KA01AB0000",
      vehicle: "KA01AB9999",
      lat: null,
      lng: null
    }]
  };
  const link = {
    auto_number_norm: "KA01AB0000",
    admin_vehicle_id: "21",
    admin_device_id: "CMS-KA01AB0000"
  };

  const result = ensureAdminDevice(
    db,
    db.vehicles[0],
    link.admin_device_id
  );

  assert.equal(result.created, false);
  assert.match(result.error, /already assigned/);
  assert.equal(db.devices.length, 1);
  assert.equal(db.devices[0].vehicle, "KA01AB9999");
});

test("does not create an Admin device without coordinates to stamp", () => {
  const db = {
    vehicles: [{ id: 21, no: "KA01AB0000" }],
    devices: []
  };
  const link = {
    auto_number_norm: "KA01AB0000",
    admin_vehicle_id: "21",
    admin_device_id: "CMS-KA01AB0000"
  };

  const result = stampDevice(db, link, {});

  assert.equal(result.stamped, false);
  assert.match(result.error, /coordinates are invalid/);
  assert.equal(db.devices.length, 0);
});
