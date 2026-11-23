"use strict";

const RETRY_BASE_MS = 30 * 1000;
const RETRY_MAX_MS = 60 * 60 * 1000;

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function unwrap(result, context) {
  if (result.error) {
    const error = new Error(`${context}: ${result.error.message}`);
    error.cause = result.error;
    throw error;
  }
  return result.data;
}

function normalized(value) {
  return String(value || "").trim().toLocaleLowerCase("en");
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function validTime(value) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value || "");
  return !!match &&
    Number(match[1]) < 24 &&
    Number(match[2]) < 60 &&
    Number(match[3] || 0) < 60;
}

function timeOfDay(value) {
  return value.slice(0, 5);
}

function addDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function reservationEndDate(campaign) {
  return timeOfDay(campaign.end_time) < timeOfDay(campaign.start_time)
    ? addDate(campaign.end_date, 1)
    : campaign.end_date;
}

function scheduleExpiresAt(campaign) {
  const [year, month, day] = reservationEndDate(campaign).split("-").map(Number);
  const [hour, minute, second = 0] = campaign.end_time.split(":").map(Number);
  const utc = Date.UTC(year, month - 1, day, hour, minute, second) - 330 * 60_000;
  return new Date(utc).toISOString();
}

function istNowParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function scheduleState(campaign, now = new Date()) {
  if (!["Scheduled", "Approved", "Active"].includes(campaign.status)) {
    return "inactive";
  }
  if (!campaign.media || typeof campaign.media.url !== "string" ||
      !/^https?:\/\//i.test(campaign.media.url)) {
    return "missing_creative";
  }
  if (
    !Number.isInteger(Number(campaign.ad_duration)) ||
    Number(campaign.ad_duration) < 5 ||
    Number(campaign.ad_duration) > 60
  ) {
    return "invalid_duration";
  }
  if (
    !validDate(campaign.start_date) ||
    !validDate(campaign.end_date) ||
    campaign.end_date < campaign.start_date ||
    !validTime(campaign.start_time) ||
    !validTime(campaign.end_time)
  ) {
    return "invalid_schedule";
  }
  const current = istNowParts(now);
  const startTime = timeOfDay(campaign.start_time);
  const endTime = timeOfDay(campaign.end_time);
  const overnight = endTime < startTime;
  const finalDate = overnight ? addDate(campaign.end_date, 1) : campaign.end_date;
  if (current.date < campaign.start_date) return "not_started";
  if (current.date > finalDate) return "expired";
  if (current.date === campaign.start_date && current.time < startTime) {
    return "outside_hours";
  }
  if (current.date === finalDate && current.time > endTime) {
    return "expired";
  }
  const withinHours = overnight
    ? current.time >= startTime || current.time <= endTime
    : current.time >= startTime && current.time <= endTime;
  if (!withinHours) {
    return "outside_hours";
  }
  return "active";
}

function createCampaignDelivery({ supabase, decideCampaign, fetchImpl = global.fetch, env = process.env }) {
  async function getCampaign(id) {
    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Campaign lookup failed: ${error.message}`);
    if (!data) throw failure(404, "Campaign not found.");
    return data;
  }

  async function resolveTargets(campaign) {
    const [{ data: location, error: locationError }, vehicleResult, linkResult,
      cmsVehicleResult, screenResult, operatorResult, screenAssignmentResult,
      deviceResult, conflictResult] = await Promise.all([
      supabase.from("locations").select("id, name").eq("id", campaign.location).maybeSingle(),
      supabase.from("admin_vehicles").select("id, payload"),
      supabase.from("vehicle_cms_link").select("*").eq("status", "Active"),
      supabase.from("cms_vehicles").select("id, auto_number, status").eq("status", "active"),
      supabase.from("cms_screens").select("id, vehicle_id, is_active").eq("is_active", true),
      supabase.from("cms_operators").select("id, vehicle_id, is_active").eq("is_active", true),
      supabase.from("cms_screen_assignments").select("operator_id, screen_id"),
      supabase.from("admin_dm_devices")
        .select("id, device_id, vehicle_no, vehicle_id, lifecycle_status, activated_at")
        .in("lifecycle_status", ["active", "activated"]),
      supabase.from("campaign_target_vehicles")
        .select("cms_vehicle_id, campaign_id")
        .eq("status", "reserved")
        .lte("start_date", reservationEndDate(campaign))
        .gte("end_date", campaign.start_date)
    ]);

    if (locationError) throw new Error(`Campaign location lookup failed: ${locationError.message}`);
    if (!location) throw failure(409, "Campaign target location no longer exists.");
    const vehicles = unwrap(vehicleResult, "Admin vehicle lookup failed");
    const links = unwrap(linkResult, "Vehicle/CMS mapping lookup failed");
    const cmsVehicles = unwrap(cmsVehicleResult, "CMS vehicle lookup failed");
    const screens = unwrap(screenResult, "CMS screen lookup failed");
    const operators = unwrap(operatorResult, "CMS operator lookup failed");
    const screenAssignments = unwrap(screenAssignmentResult, "CMS screen assignment lookup failed");
    const devices = unwrap(deviceResult, "Registered display lookup failed");
    const conflicts = unwrap(conflictResult, "Campaign inventory lookup failed");

    const occupied = new Set(
      conflicts
        .filter(row => row.campaign_id !== campaign.id)
        .map(row => String(row.cms_vehicle_id))
    );
    const cmsVehicleById = new Map(cmsVehicles.map(row => [String(row.id), row]));
    const screensByVehicle = new Map();
    screens.forEach(screen => {
      const key = String(screen.vehicle_id);
      if (!screensByVehicle.has(key)) screensByVehicle.set(key, []);
      screensByVehicle.get(key).push(screen);
    });
    const operatorsByVehicle = new Map();
    operators.forEach(operator => {
      const key = String(operator.vehicle_id);
      if (!operatorsByVehicle.has(key)) operatorsByVehicle.set(key, new Set());
      operatorsByVehicle.get(key).add(String(operator.id));
    });
    const linksByAdminVehicle = new Map();
    links.forEach(link => {
      const key = String(link.admin_vehicle_id);
      if (!linksByAdminVehicle.has(key)) linksByAdminVehicle.set(key, []);
      linksByAdminVehicle.get(key).push(link);
    });
    const adminVehicleById = new Map(
      vehicles.map(row => [String(row.id), row.payload || {}])
    );
    const wantedLocation = normalized(location.name);
    const eligible = [];

    for (const device of devices) {
      const adminVehicleId = String(device.vehicle_id || "");
      const adminVehicle = adminVehicleById.get(adminVehicleId);
      if (!adminVehicle || normalized(adminVehicle.status) !== "active") continue;
      if (
        normalized(adminVehicle.area) !== wantedLocation &&
        normalized(adminVehicle.area) !== normalized(campaign.location)
      ) continue;

      const link = (linksByAdminVehicle.get(adminVehicleId) || []).find(item =>
        item.admin_device_id &&
        [String(device.device_id), String(device.id)].includes(String(item.admin_device_id))
      );
      if (!link || !link.cms_vehicle_id || !link.cms_screen_id) continue;

      const cmsVehicle = cmsVehicleById.get(String(link.cms_vehicle_id));
      const mappedScreens = screensByVehicle.get(String(link.cms_vehicle_id)) || [];
      const screen = mappedScreens.find(item =>
        String(item.id) === String(link.cms_screen_id)
      );
      if (!cmsVehicle || !screen || occupied.has(String(cmsVehicle.id))) continue;
      const activeOperators = operatorsByVehicle.get(String(cmsVehicle.id)) || new Set();
      if (!screenAssignments.some(item =>
        String(item.screen_id) === String(screen.id) &&
        activeOperators.has(String(item.operator_id))
      )) continue;
      if (device.vehicle_no && String(device.vehicle_no) !== String(adminVehicle.no)) continue;

      eligible.push({
        adminVehicleId,
        vehicleNo: String(adminVehicle.no || cmsVehicle.auto_number || ""),
        devicePk: String(device.id),
        deviceId: String(device.device_id),
        cmsVehicleId: String(cmsVehicle.id),
        screenId: String(screen.id)
      });
    }

    eligible.sort((a, b) => a.vehicleNo.localeCompare(b.vehicleNo));
    const requested = Number(campaign.autos_booked);
    if (!Number.isInteger(requested) || requested < 1) {
      throw failure(409, "Campaign has an invalid requested vehicle count.");
    }
    if (eligible.length < requested) {
      throw failure(
        409,
        `Campaign requests ${requested} vehicles, but only ${eligible.length} eligible, available mapped vehicles were found in ${location.name}.`
      );
    }
    return eligible.slice(0, requested);
  }

  async function ensureTargets(campaign) {
    const { data: existing, error: existingError } = await supabase
      .from("campaign_target_vehicles")
      .select("*")
      .eq("campaign_id", campaign.id)
      .eq("status", "reserved");
    if (existingError) throw new Error(`Campaign target lookup failed: ${existingError.message}`);
    if (existing && existing.length) return existing;

    const selected = await resolveTargets(campaign);
    const rows = selected.map(target => ({
      campaign_id: campaign.id,
      admin_vehicle_id: target.adminVehicleId,
      vehicle_no: target.vehicleNo,
      admin_device_pk: target.devicePk,
      device_id: target.deviceId,
      cms_vehicle_id: target.cmsVehicleId,
      screen_id: target.screenId,
      start_date: campaign.start_date,
      end_date: reservationEndDate(campaign),
      start_time: campaign.start_time,
      end_time: campaign.end_time,
      status: "reserved"
    }));

    const { error } = await supabase
      .from("campaign_target_vehicles")
      .insert(rows);
    if (error) {
      if (error.code === "23P01" || error.code === "23505") {
        throw failure(409, "One or more vehicles were assigned to another overlapping campaign. Refresh and retry approval.");
      }
      throw new Error(`Campaign target creation failed: ${error.message}`);
    }

    const { data, error: readError } = await supabase
      .from("campaign_target_vehicles")
      .select("*")
      .eq("campaign_id", campaign.id)
      .eq("status", "reserved");
    if (readError) throw new Error(`Campaign target read failed: ${readError.message}`);
    return data || [];
  }

  async function ensureAssignments(campaign, targets) {
    if (!targets.length) return [];
    const rows = targets.map(target => ({
      campaign_id: campaign.id,
      target_vehicle_id: target.id,
      admin_device_pk: target.admin_device_pk,
      device_id: target.device_id,
      vehicle_no: target.vehicle_no,
      cms_vehicle_id: target.cms_vehicle_id,
      screen_id: target.screen_id,
      status: "pending",
      next_retry_at: new Date().toISOString()
    }));
    const { error } = await supabase
      .from("campaign_device_assignments")
      .upsert(rows, { onConflict: "campaign_id,screen_id", ignoreDuplicates: true });
    if (error) throw new Error(`Campaign assignment creation failed: ${error.message}`);
    const { data, error: readError } = await supabase
      .from("campaign_device_assignments")
      .select("*")
      .eq("campaign_id", campaign.id);
    if (readError) throw new Error(`Campaign assignment read failed: ${readError.message}`);
    return data || [];
  }

  async function requestCmsQueue(campaign, assignment) {
    if (!env.CMS_QUEUE_API_URL || !env.CMS_INTERNAL_KEY) {
      throw new Error("Campaign delivery is not configured: set CMS_QUEUE_API_URL and CMS_INTERNAL_KEY on the Admin server.");
    }
    const base = env.CMS_QUEUE_API_URL.replace(/\/+$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetchImpl(`${base}/queue/assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cms-internal-key": env.CMS_INTERNAL_KEY
        },
        body: JSON.stringify({
          screenId: assignment.screen_id,
          vehicleId: assignment.cms_vehicle_id,
          ads: [{
            title: campaign.name,
            advertiser: assignment.advertiser_name || campaign.advertiser_name || "",
            durationSec: Number(campaign.ad_duration),
            externalAdId: String(campaign.id),
            mediaUrl: campaign.media.url,
            expiresAt: scheduleExpiresAt(campaign)
          }]
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    const raw = await response.text();
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`CMS queue returned invalid JSON (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      throw new Error(`CMS queue rejected assignment (HTTP ${response.status}): ${payload.message || payload.error || "request failed"}`);
    }
    const queueItem = (payload.enqueued || []).find(item =>
      item.externalAdId === String(campaign.id)
    );
    if (!queueItem || !queueItem.id) {
      throw new Error("CMS accepted the request without returning the campaign queue item.");
    }
    return queueItem;
  }

  async function cancelCmsQueue(assignment) {
    if (!env.CMS_QUEUE_API_URL || !env.CMS_INTERNAL_KEY) {
      throw new Error("Campaign delivery is not configured: set CMS_QUEUE_API_URL and CMS_INTERNAL_KEY on the Admin server.");
    }
    const base = env.CMS_QUEUE_API_URL.replace(/\/+$/, "");
    const response = await fetchImpl(`${base}/queue/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cms-internal-key": env.CMS_INTERNAL_KEY
      },
      body: JSON.stringify({
        screenId: assignment.screen_id,
        vehicleId: assignment.cms_vehicle_id,
        queueItemId: assignment.queue_item_id
      })
    });
    const raw = await response.text();
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`CMS queue returned invalid cancellation JSON (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      throw new Error(`CMS queue cancellation failed (HTTP ${response.status}): ${payload.message || payload.error || "request failed"}`);
    }
    return payload;
  }

  async function dispatch(campaign, assignment) {
    const now = new Date();
    if (scheduleState(campaign, now) !== "active") return;
    if (assignment.queue_item_id) return;
    if (assignment.status === "failed" && assignment.attempt_count >= 8) return;
    if (assignment.next_retry_at && Date.parse(assignment.next_retry_at) > now.getTime()) return;

    const attemptNo = Number(assignment.attempt_count || 0) + 1;
    const attemptId = `${assignment.id}-${attemptNo}`;
    const startedAt = now.toISOString();
    const attemptRow = {
      id: attemptId,
      assignment_id: assignment.id,
      attempt_no: attemptNo,
      status: "started",
      requested_at: startedAt
    };
    const { error: attemptCountError } = await supabase
      .from("campaign_device_assignments")
      .update({ attempt_count: attemptNo, updated_at: startedAt })
      .eq("id", assignment.id);
    if (attemptCountError) throw new Error(`Delivery attempt count could not be saved: ${attemptCountError.message}`);
    const { error: attemptError } = await supabase
      .from("campaign_delivery_attempts")
      .insert(attemptRow);
    if (attemptError) throw new Error(`Delivery attempt could not be recorded: ${attemptError.message}`);

    let queueItem = null;
    let failureReason = null;
    try {
      queueItem = await requestCmsQueue(campaign, {
        ...assignment,
        advertiser_name: campaign.advertiser_name
      });
    } catch (error) {
      failureReason = error.message || String(error);
    }

    if (failureReason) {
      const retryDelay = Math.min(RETRY_BASE_MS * (2 ** (attemptNo - 1)), RETRY_MAX_MS);
      const nextRetryAt = new Date(Date.now() + retryDelay).toISOString();
      const { error: updateError } = await supabase
        .from("campaign_delivery_attempts")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error: failureReason.slice(0, 1000)
        })
        .eq("id", attemptId);
      if (updateError) throw new Error(`Failed delivery attempt could not be updated: ${updateError.message}`);
      const { error: assignmentError } = await supabase
        .from("campaign_device_assignments")
        .update({
          status: "failed",
          last_error: failureReason.slice(0, 1000),
          next_retry_at: attemptNo >= 8 ? null : nextRetryAt,
          updated_at: new Date().toISOString()
        })
        .eq("id", assignment.id);
      if (assignmentError) throw new Error(`Failed assignment could not be updated: ${assignmentError.message}`);
      return false;
    }

    const { error: attemptUpdateError } = await supabase
      .from("campaign_delivery_attempts")
      .update({
        status: "accepted",
        completed_at: new Date().toISOString(),
        response: { queueItemId: queueItem.id }
      })
      .eq("id", attemptId);
    if (attemptUpdateError) throw new Error(`Accepted delivery attempt could not be updated: ${attemptUpdateError.message}`);
    const { error: assignmentUpdateError } = await supabase
      .from("campaign_device_assignments")
      .update({
        status: "queued",
        queue_item_id: queueItem.id,
        last_error: null,
        next_retry_at: null,
        queued_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", assignment.id);
    if (assignmentUpdateError) throw new Error(`Queued campaign assignment could not be updated: ${assignmentUpdateError.message}`);
    return true;
  }

  async function reconcileQueue() {
    const { data: assignments, error } = await supabase
      .from("campaign_device_assignments")
      .select("id, queue_item_id, status, delivered_at, completed_at")
      .not("queue_item_id", "is", null)
      .in("status", ["queued", "delivered"]);
    if (error) throw new Error(`Campaign queue reconciliation failed: ${error.message}`);
    const rows = assignments || [];
    if (!rows.length) return;

    const queueIds = [...new Set(rows.map(row => row.queue_item_id).filter(Boolean))];
    const { data: queueItems, error: queueError } = await supabase
      .from("cms_ad_queue")
      .select("id, status, started_at, ended_at")
      .in("id", queueIds);
    if (queueError) throw new Error(`CMS playback status lookup failed: ${queueError.message}`);
    const queueById = new Map((queueItems || []).map(item => [String(item.id), item]));

    for (const assignment of rows) {
      const item = queueById.get(String(assignment.queue_item_id));
      if (!item) continue;
      const state = String(item.status).toUpperCase();
      let updates = null;
      if (state === "PLAYING" && item.started_at && assignment.status !== "delivered") {
        updates = {
          status: "delivered",
          delivered_at: item.started_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      } else if (state === "COMPLETED") {
        updates = {
          status: "completed",
          delivered_at: assignment.delivered_at || item.started_at || item.ended_at,
          completed_at: item.ended_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      } else if (state === "FAILED" || state === "CANCELLED") {
        updates = {
          status: state.toLowerCase(),
          last_error: state === "FAILED" ? "CMS playback failed." : "CMS queue item was cancelled.",
          updated_at: new Date().toISOString()
        };
      }
      if (updates) {
        const { error: updateError } = await supabase
          .from("campaign_device_assignments")
          .update(updates)
          .eq("id", assignment.id);
        if (updateError) throw new Error(`Campaign playback status update failed: ${updateError.message}`);
      }
    }
  }

  async function runDue() {
    await reconcileQueue();
    const { data: campaigns, error: campaignError } = await supabase
      .from("campaigns")
      .select("*")
      .in("status", ["Scheduled", "Approved", "Active", "Paused", "Rejected", "Cancelled", "Canceled", "Expired", "Completed"]);
    if (campaignError) throw new Error(`Campaign dispatch lookup failed: ${campaignError.message}`);
    const ownerIds = [...new Set((campaigns || []).map(campaign => campaign.owner_id).filter(Boolean))];
    let owners = [];
    if (ownerIds.length) {
      const { data, error } = await supabase
        .from("users")
        .select("id, name, company")
        .in("id", ownerIds);
      if (error) throw new Error(`Campaign advertiser lookup failed: ${error.message}`);
      owners = data || [];
    }
    const ownerById = new Map(owners.map(owner => [String(owner.id), owner]));
    const campaignById = new Map((campaigns || []).map(campaign => {
      const owner = ownerById.get(String(campaign.owner_id)) || {};
      return [String(campaign.id), {
        ...campaign,
        advertiser_name: owner.company || owner.name || ""
      }];
    }));
    const { data: assignments, error: assignmentError } = await supabase
      .from("campaign_device_assignments")
      .select("*")
      .in("status", ["pending", "failed", "queued", "delivered"]);
    if (assignmentError) throw new Error(`Pending assignment lookup failed: ${assignmentError.message}`);

    let accepted = 0;
    for (const assignment of assignments || []) {
      const campaign = campaignById.get(String(assignment.campaign_id));
      if (!campaign) continue;
      const state = scheduleState(campaign);
      const terminal =
        ["Rejected", "Cancelled", "Canceled", "Expired", "Completed"].includes(campaign.status) ||
        state === "expired";
      if (terminal) {
        if (["pending", "failed"].includes(assignment.status)) {
          const { error } = await supabase
            .from("campaign_device_assignments")
            .update({ status: "cancelled", last_error: state, updated_at: new Date().toISOString() })
            .eq("id", assignment.id);
          if (error) throw new Error(`Expired assignment update failed: ${error.message}`);
        }
      }
      if (
        state !== "active" &&
        assignment.queue_item_id &&
        ["queued", "delivered"].includes(assignment.status)
      ) {
        let queueState;
        try {
          queueState = await cancelCmsQueue(assignment);
        } catch (error) {
          const { error: updateError } = await supabase
            .from("campaign_device_assignments")
            .update({
              last_error: `Queue cancellation pending: ${String(error.message || error).slice(0, 900)}`,
              updated_at: new Date().toISOString()
            })
            .eq("id", assignment.id);
          if (updateError) throw new Error(`Queue cancellation error could not be recorded: ${updateError.message}`);
          continue;
        }
        if (queueState.status === "CANCELLED" || queueState.cancelledId) {
          const { error: updateError } = await supabase
            .from("campaign_device_assignments")
            .update({
              status: "cancelled",
              last_error: terminal ? state : "Campaign is not currently active.",
              updated_at: new Date().toISOString()
            })
            .eq("id", assignment.id);
          if (updateError) throw new Error(`Campaign cancellation state could not be saved: ${updateError.message}`);
          assignment.status = "cancelled";
        }
      }
      if (terminal) {
        const { error: targetError } = await supabase
          .from("campaign_target_vehicles")
          .update({ status: "released" })
          .eq("campaign_id", campaign.id)
          .eq("status", "reserved");
        if (targetError) throw new Error(`Campaign inventory release failed: ${targetError.message}`);
        continue;
      }
      if (state !== "active") continue;
      if (["pending", "failed"].includes(assignment.status)) {
        if (!campaign.advertiser_name) {
          const { error } = await supabase
            .from("campaign_device_assignments")
            .update({
              status: "failed",
              last_error: "Campaign advertiser name is unavailable.",
              next_retry_at: null,
              updated_at: new Date().toISOString()
            })
            .eq("id", assignment.id);
          if (error) throw new Error(`Campaign advertiser validation failed: ${error.message}`);
          continue;
        }
        if (await dispatch(campaign, assignment)) accepted += 1;
      }
    }
    return { processed: assignments?.length || 0, queueRequests: accepted };
  }

  async function approve(campaignId) {
    const campaign = await getCampaign(campaignId);
    if (!["Pending Approval", "Scheduled", "Approved", "Active"].includes(campaign.status)) {
      throw failure(409, "Only pending or previously approved campaigns can be assigned.");
    }
    if (!campaign.media || typeof campaign.media.url !== "string" ||
        !/^https?:\/\//i.test(campaign.media.url)) {
      throw failure(409, "Campaign creative is unavailable.");
    }
    const { data: advertiser, error: advertiserError } = await supabase
      .from("users")
      .select("id, name, company")
      .eq("id", campaign.owner_id)
      .maybeSingle();
    if (advertiserError) throw new Error(`Campaign advertiser lookup failed: ${advertiserError.message}`);
    if (!advertiser || !(advertiser.company || advertiser.name)) {
      throw failure(409, "Campaign advertiser name is unavailable.");
    }
    if (
      !validDate(campaign.start_date) ||
      !validDate(campaign.end_date) ||
      campaign.end_date < campaign.start_date ||
      !validTime(campaign.start_time) ||
      !validTime(campaign.end_time) ||
      !Number.isInteger(Number(campaign.ad_duration)) ||
      Number(campaign.ad_duration) < 5 ||
      Number(campaign.ad_duration) > 60
    ) {
      throw failure(409, "Campaign schedule or advertisement duration is invalid.");
    }
    if (scheduleState({ ...campaign, status: "Scheduled" }) === "expired") {
      throw failure(409, "Campaign end date or operating hours have already passed.");
    }
    const targets = await ensureTargets(campaign);
    if (campaign.status === "Pending Approval") {
      await decideCampaign(campaign.id, "Scheduled");
    }
    const approvedCampaign = await getCampaign(campaign.id);
    const assignments = await ensureAssignments(approvedCampaign, targets);
    const delivery = await runDue();
    return {
      campaign: approvedCampaign,
      selectedVehicles: targets.length,
      assignments,
      delivery
    };
  }

  async function reject(campaignId, reason) {
    return decideCampaign(campaignId, "Rejected", reason || "Rejected by administrator");
  }

  async function retry(assignmentId) {
    const { data: assignment, error } = await supabase
      .from("campaign_device_assignments")
      .select("id, queue_item_id")
      .eq("id", assignmentId)
      .maybeSingle();
    if (error) throw new Error(`Assignment lookup failed: ${error.message}`);
    if (!assignment) throw failure(404, "Campaign assignment not found.");
    if (assignment.queue_item_id) {
      throw failure(409, "This ad is already in the CMS queue; playback failures are not re-enqueued.");
    }
    const { error: updateError } = await supabase
      .from("campaign_device_assignments")
      .update({
        status: "pending",
        next_retry_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", assignmentId);
    if (updateError) throw new Error(`Assignment retry could not be scheduled: ${updateError.message}`);
    return runDue();
  }

  async function list() {
    await runDue();
    const [{ data: campaigns, error: campaignError },
      { data: assignments, error: assignmentError },
      { data: targets, error: targetError }] = await Promise.all([
      supabase.from("campaigns").select("*").order("submitted_at", { ascending: false }),
      supabase.from("campaign_device_assignments").select("*"),
      supabase.from("campaign_target_vehicles").select("campaign_id, cms_vehicle_id")
    ]);
    if (campaignError) throw new Error(`Campaign delivery list failed: ${campaignError.message}`);
    if (assignmentError) throw new Error(`Campaign assignments could not be loaded: ${assignmentError.message}`);
    if (targetError) throw new Error(`Campaign vehicle targets could not be loaded: ${targetError.message}`);

    const ownerIds = [...new Set((campaigns || []).map(item => item.owner_id).filter(Boolean))];
    let owners = [];
    if (ownerIds.length) {
      const { data, error } = await supabase
        .from("users")
        .select("id, name, company")
        .in("id", ownerIds);
      if (error) throw new Error(`Campaign advertiser lookup failed: ${error.message}`);
      owners = data || [];
    }
    const ownerById = new Map(owners.map(owner => [String(owner.id), owner]));
    const assignmentsByCampaign = new Map();
    (assignments || []).forEach(assignment => {
      const key = String(assignment.campaign_id);
      if (!assignmentsByCampaign.has(key)) assignmentsByCampaign.set(key, []);
      assignmentsByCampaign.get(key).push(assignment);
    });
    const targetsByCampaign = new Map();
    (targets || []).forEach(target => {
      const key = String(target.campaign_id);
      targetsByCampaign.set(key, (targetsByCampaign.get(key) || 0) + 1);
    });

    const output = (campaigns || []).map(campaign => {
      const owner = ownerById.get(String(campaign.owner_id)) || {};
      const items = assignmentsByCampaign.get(String(campaign.id)) || [];
      return {
        id: campaign.id,
        name: campaign.name,
        advertiser: owner.company || owner.name || "",
        status: campaign.status,
        location: campaign.location,
        autosBooked: campaign.autos_booked,
        selectedVehicles: targetsByCampaign.get(String(campaign.id)) || 0,
        assignedDevices: items.filter(item => ["queued", "delivered", "completed"].includes(item.status)).length,
        pendingAssignments: items.filter(item => item.status === "pending").length,
        failedAssignments: items.filter(item => ["failed"].includes(item.status)).length,
        startDate: campaign.start_date,
        endDate: campaign.end_date,
        startTime: campaign.start_time,
        endTime: campaign.end_time,
        assignments: items.map(item => ({
          id: item.id,
          vehicleNo: item.vehicle_no,
          deviceId: item.device_id,
          screenId: item.screen_id,
          status: item.status,
          attemptCount: item.attempt_count || 0,
          retryable: !item.queue_item_id && (item.attempt_count || 0) < 8,
          lastError: item.last_error || null
        }))
      };
    });
    return {
      campaigns: output,
      totals: {
        selectedVehicles: (targets || []).length,
        assignedDevices: (assignments || []).filter(item =>
          ["queued", "delivered", "completed"].includes(item.status)
        ).length,
        pendingAssignments: (assignments || []).filter(item =>
          item.status === "pending"
        ).length,
        failedAssignments: (assignments || []).filter(item => item.status === "failed").length
      }
    };
  }

  return { approve, reject, retry, list, runDue };
}

module.exports = {
  createCampaignDelivery,
  scheduleState,
  istNowParts
};
