"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { createCampaignDelivery, istNowParts, scheduleState } = require("../lib/campaign-delivery");

class FakeQuery {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.filters = [];
    this.operation = "select";
    this.values = [];
    this.conflict = null;
    this.ignoreDuplicates = false;
    this.sort = null;
  }

  select() { return this; }
  eq(column, value) { this.filters.push(row => row[column] === value); return this; }
  in(column, values) { this.filters.push(row => values.includes(row[column])); return this; }
  lte(column, value) { this.filters.push(row => row[column] <= value); return this; }
  gte(column, value) { this.filters.push(row => row[column] >= value); return this; }
  not(column, operator, value) {
    this.filters.push(row => operator === "is" && value === null ? row[column] !== null : true);
    return this;
  }
  order(column, options) { this.sort = [column, options?.ascending !== false]; return this; }
  insert(values) { this.operation = "insert"; this.values = Array.isArray(values) ? values : [values]; return this; }
  upsert(values, options = {}) {
    this.operation = "upsert";
    this.values = Array.isArray(values) ? values : [values];
    this.conflict = options.onConflict?.split(",") || [];
    this.ignoreDuplicates = options.ignoreDuplicates;
    return this;
  }
  update(values) { this.operation = "update"; this.values = values; return this; }
  maybeSingle() { return Promise.resolve(this.execute(true)); }
  single() { return Promise.resolve(this.execute(true)); }
  then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject); }

  execute(single = false) {
    const records = this.database[this.table] || (this.database[this.table] = []);
    let rows = records.filter(row => this.filters.every(filter => filter(row)));
    if (this.sort) {
      const [column, ascending] = this.sort;
      rows = rows.slice().sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
    }

    if (this.operation === "insert" || this.operation === "upsert") {
      const written = [];
      for (const value of this.values) {
        const conflict = this.operation === "upsert" && this.conflict.length
          ? records.find(row => this.conflict.every(key => row[key] === value[key]))
          : null;
        if (conflict) {
          if (!this.ignoreDuplicates) Object.assign(conflict, value);
          if (!this.ignoreDuplicates) written.push(conflict);
          continue;
        }
        const row = { id: randomUUID(), ...value };
        records.push(row);
        written.push(row);
      }
      rows = written;
    } else if (this.operation === "update") {
      rows.forEach(row => Object.assign(row, this.values));
    }

    if (single) return { data: rows[0] || null, error: null };
    return { data: rows, error: null };
  }
}

function fixture({ failFirstRequest = false } = {}) {
  const today = istNowParts().date;
  const campaign = {
    id: "c12345678",
    owner_id: "owner-1",
    name: "Spring offer",
    location: "location-1",
    autos_booked: 2,
    ad_duration: 15,
    status: "Pending Approval",
    start_date: today,
    end_date: today,
    start_time: "00:00",
    end_time: "23:59",
    media: { url: "https://cdn.example/creative.mp4" }
  };
  const db = {
    campaigns: [campaign],
    locations: [{ id: "location-1", name: "Central" }],
    users: [{ id: "owner-1", name: "Advertiser", company: "Example Co" }],
    admin_vehicles: [
      { id: "admin-1", payload: { no: "KA01AA0001", area: "Central", status: "Active" } },
      { id: "admin-2", payload: { no: "KA01AA0002", area: "Central", status: "Active" } }
    ],
    vehicle_cms_link: [
      { admin_vehicle_id: "admin-1", admin_device_id: "device-1", cms_vehicle_id: "11111111-1111-4111-8111-111111111111", cms_screen_id: "33333333-3333-4333-8333-333333333331", status: "Active" },
      { admin_vehicle_id: "admin-2", admin_device_id: "device-2", cms_vehicle_id: "22222222-2222-4222-8222-222222222222", cms_screen_id: "33333333-3333-4333-8333-333333333332", status: "Active" }
    ],
    cms_vehicles: [
      { id: "11111111-1111-4111-8111-111111111111", auto_number: "KA01AA0001", status: "active" },
      { id: "22222222-2222-4222-8222-222222222222", auto_number: "KA01AA0002", status: "active" }
    ],
    cms_screens: [
      { id: "33333333-3333-4333-8333-333333333331", vehicle_id: "11111111-1111-4111-8111-111111111111", is_active: true },
      { id: "33333333-3333-4333-8333-333333333332", vehicle_id: "22222222-2222-4222-8222-222222222222", is_active: true }
    ],
    cms_operators: [
      { id: "operator-1", vehicle_id: "11111111-1111-4111-8111-111111111111", is_active: true },
      { id: "operator-2", vehicle_id: "22222222-2222-4222-8222-222222222222", is_active: true }
    ],
    cms_screen_assignments: [
      { operator_id: "operator-1", screen_id: "33333333-3333-4333-8333-333333333331" },
      { operator_id: "operator-2", screen_id: "33333333-3333-4333-8333-333333333332" }
    ],
    admin_dm_devices: [
      { id: "device-pk-1", device_id: "device-1", vehicle_id: "admin-1", vehicle_no: "KA01AA0001", lifecycle_status: "active" },
      { id: "device-pk-2", device_id: "device-2", vehicle_id: "admin-2", vehicle_no: "KA01AA0002", lifecycle_status: "active" }
    ],
    cms_device_status: [
      { screen_id: "33333333-3333-4333-8333-333333333331", online: false },
      { screen_id: "33333333-3333-4333-8333-333333333332", online: false }
    ],
    campaign_target_vehicles: [],
    campaign_device_assignments: [],
    campaign_delivery_attempts: [],
    cms_ad_queue: []
  };
  const supabase = { from: table => new FakeQuery(db, table) };
  const requests = [];
  let shouldFail = failFirstRequest;
  const delivery = createCampaignDelivery({
    supabase,
    decideCampaign: async id => {
      campaign.status = "Scheduled";
      return campaign;
    },
    env: { CMS_QUEUE_API_URL: "https://cms.example/api", CMS_INTERNAL_KEY: "server-secret" },
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, options, body });
      if (url.endsWith("/queue/cancel")) {
        const item = db.cms_ad_queue.find(row => row.id === body.queueItemId);
        if (item?.status === "QUEUED") item.status = "CANCELLED";
        return {
          ok: true,
          status: 201,
          text: async () => JSON.stringify({
            cancelledId: item?.status === "CANCELLED" ? item.id : null,
            status: item?.status
          })
        };
      }
      if (shouldFail) {
        shouldFail = false;
        return {
          ok: false,
          status: 503,
          text: async () => JSON.stringify({ message: "temporarily unavailable" })
        };
      }
      const item = {
        id: randomUUID(),
        externalAdId: body.ads[0].externalAdId,
        screen_id: body.screenId,
        status: "QUEUED"
      };
      db.cms_ad_queue.push(item);
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ enqueued: [{ id: item.id, externalAdId: item.externalAdId }] })
      };
    }
  });
  return { db, requests, delivery, campaign };
}

test("campaign scheduling prevents pending, paused, and out-of-hours playback", () => {
  const now = new Date("2026-11-23T04:30:00.000Z");
  const campaign = {
    status: "Scheduled",
    media: { url: "https://cdn.example/ad.mp4" },
    start_date: "2026-11-23",
    end_date: "2026-11-23",
    start_time: "09:00",
    end_time: "17:00",
    ad_duration: 15
  };
  assert.equal(scheduleState({ ...campaign, status: "Pending Approval" }, now), "inactive");
  assert.equal(scheduleState({ ...campaign, status: "Paused" }, now), "inactive");
  assert.equal(scheduleState(campaign, now), "active");
  assert.equal(scheduleState({ ...campaign, start_time: "11:00" }, now), "outside_hours");
  assert.equal(
    scheduleState({ ...campaign, start_date: "2026-11-22", end_date: "2026-11-22" }, now),
    "expired"
  );

  const overnight = {
    ...campaign,
    start_time: "20:00",
    end_time: "06:00"
  };
  assert.equal(scheduleState(overnight, new Date("2026-11-23T15:30:00.000Z")), "active");
  assert.equal(scheduleState(overnight, new Date("2026-11-24T00:30:00.000Z")), "active");
  assert.equal(scheduleState(overnight, new Date("2026-11-24T02:00:00.000Z")), "expired");
});

test("approving a campaign assigns its two mapped screens once and tracks playback acknowledgements", async () => {
  const { db, requests, delivery } = fixture();
  await delivery.approve("c12345678");

  assert.equal(db.campaigns[0].status, "Scheduled");
  assert.equal(db.campaign_target_vehicles.length, 2);
  assert.equal(db.campaign_device_assignments.length, 2);
  assert.equal(requests.length, 2);
  assert.deepEqual(new Set(requests.map(request => request.body.screenId)), new Set([
    "33333333-3333-4333-8333-333333333331",
    "33333333-3333-4333-8333-333333333332"
  ]));
  const [year, month, day] = istNowParts().date.split("-").map(Number);
  const expectedExpiry = new Date(
    Date.UTC(year, month - 1, day, 23, 59) - 330 * 60_000
  ).toISOString();
  for (const request of requests) {
    assert.equal(request.url, "https://cms.example/api/queue/assign");
    assert.equal(request.options.headers["x-cms-internal-key"], "server-secret");
    assert.deepEqual(request.body.ads[0], {
      title: "Spring offer",
      advertiser: "Example Co",
      durationSec: 15,
      externalAdId: "c12345678",
      mediaUrl: "https://cdn.example/creative.mp4",
      expiresAt: expectedExpiry
    });
  }
  assert.ok(db.campaign_device_assignments.every(item => item.status === "queued"));

  await delivery.approve("c12345678");
  assert.equal(requests.length, 2);
  assert.equal(db.campaign_device_assignments.length, 2);

  db.cms_ad_queue[0].status = "PLAYING";
  db.cms_ad_queue[0].started_at = new Date().toISOString();
  await delivery.list();
  assert.equal(db.campaign_device_assignments.find(item => item.queue_item_id === db.cms_ad_queue[0].id).status, "delivered");

  db.cms_ad_queue[0].status = "COMPLETED";
  await delivery.list();
  assert.equal(db.campaign_device_assignments.find(item => item.queue_item_id === db.cms_ad_queue[0].id).status, "completed");
});

test("unapproved campaigns and offline-but-registered devices are never dropped or delivered early", async () => {
  const { db, requests, delivery, campaign } = fixture();
  await delivery.runDue();
  assert.equal(requests.length, 0);

  campaign.status = "Scheduled";
  campaign.start_date = "2999-01-01";
  campaign.end_date = "2999-01-01";
  const selected = await delivery.approve("c12345678");
  assert.equal(selected.selectedVehicles, 2);
  assert.equal(requests.length, 0);

  campaign.start_date = istNowParts().date;
  campaign.end_date = istNowParts().date;
  await delivery.runDue();
  assert.equal(requests.length, 2);
  assert.ok(db.campaign_device_assignments.every(item => item.status === "queued"));

  db.cms_ad_queue[1].status = "PLAYING";
  db.cms_ad_queue[1].started_at = new Date().toISOString();
  await delivery.runDue();
  assert.equal(db.campaign_device_assignments.find(item => item.queue_item_id === db.cms_ad_queue[1].id).status, "delivered");
});

test("paused campaigns cancel queued items without interrupting playback", async () => {
  const { db, delivery } = fixture();
  await delivery.approve("c12345678");
  db.cms_ad_queue[0].status = "PLAYING";
  db.cms_ad_queue[0].started_at = new Date().toISOString();
  db.campaigns[0].status = "Paused";

  await delivery.runDue();

  assert.equal(db.cms_ad_queue[0].status, "PLAYING");
  assert.equal(db.cms_ad_queue[1].status, "CANCELLED");
  assert.equal(
    db.campaign_device_assignments.find(item => item.queue_item_id === db.cms_ad_queue[0].id).status,
    "delivered"
  );
  assert.equal(
    db.campaign_device_assignments.find(item => item.queue_item_id === db.cms_ad_queue[1].id).status,
    "cancelled"
  );
});

test("temporary CMS failures are recorded and retried without creating duplicate queue items", async () => {
  const { db, requests, delivery } = fixture({ failFirstRequest: true });
  await delivery.approve("c12345678");

  const failed = db.campaign_device_assignments.find(item => item.status === "failed");
  assert.ok(failed);
  assert.equal(failed.attempt_count, 1);
  assert.equal(db.campaign_delivery_attempts.find(item => item.assignment_id === failed.id).status, "failed");
  failed.next_retry_at = new Date(0).toISOString();

  await delivery.runDue();
  assert.equal(failed.status, "queued");
  assert.equal(failed.attempt_count, 2);
  assert.equal(requests.length, 3);
  assert.equal(db.cms_ad_queue.length, 2);
});

test("overlapping reservations prevent selecting the same vehicle for another campaign", async () => {
  const { db, delivery, campaign } = fixture();
  db.campaign_target_vehicles.push({
    id: randomUUID(),
    campaign_id: "another-campaign",
    cms_vehicle_id: "11111111-1111-4111-8111-111111111111",
    start_date: campaign.start_date,
    end_date: campaign.end_date,
    status: "reserved"
  });

  await assert.rejects(
    delivery.approve(campaign.id),
    /only 1 eligible, available mapped vehicles/
  );
  assert.equal(campaign.status, "Pending Approval");
  assert.equal(db.campaign_device_assignments.length, 0);
});
