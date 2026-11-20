"use strict";

/*
  Device Management — MQTT/EMQX adapter stub (Phase 10).

  REST (/api/dm/device/*) is the live path today.
  When MQTT is configured, the same message shapes can be published/consumed here
  without changing Admin UI or phone GPS.

  Env (optional, unused until wired to a broker):
    DM_MQTT_URL=mqtts://broker.example:8883
    DM_MQTT_USERNAME=
    DM_MQTT_PASSWORD=
    DM_MQTT_TOPIC_PREFIX=niyoads/dm
*/

function mqttConfigured() {
  return !!(process.env.DM_MQTT_URL && String(process.env.DM_MQTT_URL).trim());
}

function topic(deviceId, leaf) {
  const prefix = (process.env.DM_MQTT_TOPIC_PREFIX || "niyoads/dm").replace(
    /\/$/,
    ""
  );
  return `${prefix}/${deviceId}/${leaf}`;
}

/**
 * Publish helper — no-op unless DM_MQTT_URL is set.
 * Never throws into request path; logs and returns { ok:false }.
 */
async function publish(deviceId, leaf, payload) {
  if (!mqttConfigured()) {
    return {
      ok: false,
      skipped: true,
      reason: "mqtt_not_configured",
      topic: topic(deviceId, leaf)
    };
  }
  // Broker client intentionally not started in this environment.
  console.warn(
    "[dm-mqtt] configured but broker client not started — message not sent",
    topic(deviceId, leaf)
  );
  return {
    ok: false,
    skipped: true,
    reason: "mqtt_client_not_started",
    topic: topic(deviceId, leaf),
    payload
  };
}

async function publishHeartbeatAck(deviceId, body) {
  return publish(deviceId, "heartbeat/ack", body);
}

async function publishCommand(deviceId, command) {
  return publish(deviceId, "commands", command);
}

async function publishConfig(deviceId, config) {
  return publish(deviceId, "config", config);
}

function describe() {
  return {
    transport: mqttConfigured() ? "mqtt+rest" : "rest_only",
    mqttConfigured: mqttConfigured(),
    topicPrefix: process.env.DM_MQTT_TOPIC_PREFIX || "niyoads/dm",
    note:
      "REST authenticated polling is primary. MQTT adapter is a clean seam for EMQX later — not production connectivity."
  };
}

module.exports = {
  mqttConfigured,
  topic,
  publish,
  publishHeartbeatAck,
  publishCommand,
  publishConfig,
  describe
};
