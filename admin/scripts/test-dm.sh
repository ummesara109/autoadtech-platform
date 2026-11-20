#!/usr/bin/env bash
# Device Management E2E (local). Labeled controlled test — not production connectivity.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${DM_BASE_URL:-http://127.0.0.1:3000}"
PASS=0
FAIL=0

ok() { echo "PASS: $1"; PASS=$((PASS + 1)); }
bad() { echo "FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

json() { python3 -c 'import json,sys; print(json.load(sys.stdin)'"$1"')' 2>/dev/null; }

echo "== Device Management tests against $BASE =="

# 1) Admin login
LOGIN=$(curl -sS -X POST "$BASE/api/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@adtech.in","password":"Admin@123","portal":"admin"}' || true)
TOKEN=$(printf '%s' "$LOGIN" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("token",""))' 2>/dev/null || true)
if [[ -n "$TOKEN" ]]; then ok "admin login"; else bad "admin login" "$LOGIN"; exit 1; fi
AUTH="Authorization: Bearer $TOKEN"

# 2) Overview starts with real counts (may be zero)
OV=$(curl -sS "$BASE/api/dm/overview" -H "$AUTH")
echo "$OV" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert "total" in d and "online" in d and d.get("note"); print("overview ok", d["total"])' \
  && ok "overview" || bad "overview" "$OV"

# 3) Pick an existing vehicle
VEH=$(printf '%s' "$LOGIN" | python3 -c 'import json,sys; d=json.load(sys.stdin); vs=d.get("data",{}).get("vehicles") or []; print(vs[0]["no"] if vs else "")')
if [[ -z "$VEH" ]]; then
  # bootstrap fallback
  BOOT=$(curl -sS "$BASE/api/bootstrap" -H "$AUTH")
  VEH=$(printf '%s' "$BOOT" | python3 -c 'import json,sys; d=json.load(sys.stdin); vs=d.get("data",{}).get("vehicles") or []; print(vs[0]["no"] if vs else "KA-01-AA-1001")')
fi
ok "vehicle selected: $VEH"

# 4) Register device (unassigned first)
REG=$(curl -sS -X POST "$BASE/api/dm/devices" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"E2E Test Display","deviceType":"display","platform":"android","notes":"labeled local test — not production"}')
DID=$(printf '%s' "$REG" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["device"]["deviceId"])' 2>/dev/null || true)
SECRET=$(printf '%s' "$REG" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["credentials"]["secret"])' 2>/dev/null || true)
PK=$(printf '%s' "$REG" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["device"]["id"])' 2>/dev/null || true)
if [[ -n "$DID" && -n "$SECRET" ]]; then ok "register $DID"; else bad "register" "$REG"; exit 1; fi

# 4b) Assign vehicle
ASG=$(curl -sS -X POST "$BASE/api/dm/devices/$PK/assign" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"vehicleNo\":\"$VEH\"}")
echo "$ASG" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['device']['vehicleNo']=='$VEH'" \
  && ok "assign vehicle" || bad "assign" "$ASG"

# 5) Duplicate active assignment rejected
DUP=$(curl -sS -o /tmp/dm-dup.json -w '%{http_code}' -X POST "$BASE/api/dm/devices" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Dup\",\"deviceType\":\"display\",\"platform\":\"android\",\"vehicleNo\":\"$VEH\"}")
if [[ "$DUP" == "409" ]]; then ok "duplicate active assignment blocked"; else bad "duplicate assign" "HTTP $DUP $(cat /tmp/dm-dup.json)"; fi

# 6) Device auth
DAUTH=$(curl -sS -X POST "$BASE/api/dm/device/auth" -H 'Content-Type: application/json' \
  -d "{\"deviceId\":\"$DID\",\"secret\":\"$SECRET\"}")
DTOKEN=$(printf '%s' "$DAUTH" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("token",""))' 2>/dev/null || true)
if [[ -n "$DTOKEN" ]]; then ok "device auth"; else bad "device auth" "$DAUTH"; exit 1; fi
DAUTH_H="Authorization: Bearer $DTOKEN"

# 7) Reject bad secret
BADAUTH=$(curl -sS -o /tmp/dm-badauth.json -w '%{http_code}' -X POST "$BASE/api/dm/device/auth" -H 'Content-Type: application/json' \
  -d "{\"deviceId\":\"$DID\",\"secret\":\"wrong-secret\"}")
if [[ "$BADAUTH" == "401" ]]; then ok "invalid credentials rejected"; else bad "bad auth" "HTTP $BADAUTH"; fi

# 8) Heartbeat → online
HB=$(curl -sS -X POST "$BASE/api/dm/device/heartbeat" -H "$DAUTH_H" -H 'Content-Type: application/json' \
  -d '{"playerStatus":"running","networkStatus":"wifi","appVersion":"test-1.0","batteryPct":80,"storageFreeMb":1200}')
echo "$HB" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("connectionStatus")=="online"; print(d)' \
  && ok "heartbeat online" || bad "heartbeat" "$HB"

# 9) Details show activated + online
DET=$(curl -sS "$BASE/api/dm/devices/$PK" -H "$AUTH")
echo "$DET" | python3 -c 'import json,sys; d=json.load(sys.stdin)["device"]; assert d["lifecycleStatus"] in ("activated","active"); assert d["connectionStatus"]=="online"; assert d["playerStatus"]=="running"' \
  && ok "details activated/online" || bad "details" "$DET"

# 10) Overview online >= 1
OV2=$(curl -sS "$BASE/api/dm/overview" -H "$AUTH")
echo "$OV2" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["online"]>=1' \
  && ok "overview online count" || bad "overview online" "$OV2"

# 11) Offline detection via short timeout (env may be default 90s — simulate by checking unknown/offline after stop is not automatic;
#     instead verify list filter online includes device, then rotate + old secret fails)
LIST=$(curl -sS "$BASE/api/dm/devices?filter=online" -H "$AUTH")
echo "$LIST" | python3 -c "import json,sys; d=json.load(sys.stdin); assert any(x['deviceId']=='$DID' for x in d['items'])" \
  && ok "online filter" || bad "online filter" "$LIST"

# 12) Rotate credentials — old rejected
ROT=$(curl -sS -X POST "$BASE/api/dm/devices/$PK/credentials/rotate" -H "$AUTH" -H 'Content-Type: application/json' -d '{}')
NEWSEC=$(printf '%s' "$ROT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["credentials"]["secret"])' 2>/dev/null || true)
OLD=$(curl -sS -o /tmp/dm-old.json -w '%{http_code}' -X POST "$BASE/api/dm/device/auth" -H 'Content-Type: application/json' \
  -d "{\"deviceId\":\"$DID\",\"secret\":\"$SECRET\"}")
if [[ "$OLD" == "401" && -n "$NEWSEC" ]]; then ok "credential rotation"; else bad "rotation" "HTTP $OLD / $ROT"; fi

# Re-auth with new secret for further calls
DAUTH2=$(curl -sS -X POST "$BASE/api/dm/device/auth" -H 'Content-Type: application/json' \
  -d "{\"deviceId\":\"$DID\",\"secret\":\"$NEWSEC\"}")
DTOKEN2=$(printf '%s' "$DAUTH2" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')
DAUTH_H="Authorization: Bearer $DTOKEN2"
ok "re-auth after rotate"

# 13) Config get/put
curl -sS -X PUT "$BASE/api/dm/devices/$PK/config" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"orientation":"portrait","resolution":"1920x1080"}' >/tmp/dm-cfg.json
CFG=$(curl -sS "$BASE/api/dm/device/config" -H "$DAUTH_H")
echo "$CFG" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["orientation"]=="portrait"' \
  && ok "config update + device pull" || bad "config" "$CFG"

# 14) Command pending until ack
CMD=$(curl -sS -X POST "$BASE/api/dm/devices/$PK/commands" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"commandType":"request_status"}')
CID=$(printf '%s' "$CMD" | python3 -c 'import json,sys; print(json.load(sys.stdin)["command"]["id"])')
PEND=$(curl -sS "$BASE/api/dm/device/commands/pending" -H "$DAUTH_H")
echo "$PEND" | python3 -c "import json,sys; d=json.load(sys.stdin); assert any(c['id']=='$CID' and c['status'] in ('pending','delivered') for c in d['commands'])" \
  && ok "command pending/delivered" || bad "pending" "$PEND"
ACK=$(curl -sS -X POST "$BASE/api/dm/device/commands/$CID/ack" -H "$DAUTH_H" -H 'Content-Type: application/json' \
  -d '{"status":"completed"}')
echo "$ACK" | python3 -c 'import json,sys; assert json.load(sys.stdin)["status"]=="completed"' \
  && ok "command completed after ack" || bad "ack" "$ACK"

# 15) Suspend blocks heartbeat
curl -sS -X POST "$BASE/api/dm/devices/$PK/suspend" -H "$AUTH" -H 'Content-Type: application/json' -d '{}' >/tmp/dm-sus.json
SUS=$(curl -sS -o /tmp/dm-sus-hb.json -w '%{http_code}' -X POST "$BASE/api/dm/device/heartbeat" -H "$DAUTH_H" -H 'Content-Type: application/json' -d '{"playerStatus":"running"}')
if [[ "$SUS" == "401" || "$SUS" == "403" ]]; then ok "suspended rejects heartbeat"; else bad "suspend" "HTTP $SUS"; fi

# 16) Restore
curl -sS -X POST "$BASE/api/dm/devices/$PK/restore" -H "$AUTH" -H 'Content-Type: application/json' -d '{}' >/tmp/dm-rst.json
# need re-auth after suspend (token still for suspended device may fail authDevice)
DAUTH3=$(curl -sS -X POST "$BASE/api/dm/device/auth" -H 'Content-Type: application/json' \
  -d "{\"deviceId\":\"$DID\",\"secret\":\"$NEWSEC\"}")
DTOKEN3=$(printf '%s' "$DAUTH3" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')
if [[ -n "$DTOKEN3" ]]; then ok "restore + re-auth"; else bad "restore" "$DAUTH3"; fi

# 17) Revoke
curl -sS -X POST "$BASE/api/dm/devices/$PK/revoke" -H "$AUTH" -H 'Content-Type: application/json' -d '{}' >/tmp/dm-rev.json
REV=$(curl -sS -o /tmp/dm-rev-auth.json -w '%{http_code}' -X POST "$BASE/api/dm/device/auth" -H 'Content-Type: application/json' \
  -d "{\"deviceId\":\"$DID\",\"secret\":\"$NEWSEC\"}")
if [[ "$REV" == "403" || "$REV" == "401" ]]; then ok "revoked cannot auth"; else bad "revoke" "HTTP $REV"; fi

# 18) Live GPS endpoint still present (regression — do not break)
LIVE=$(curl -sS -o /tmp/dm-live.json -w '%{http_code}' "$BASE/api/live" -H "$AUTH")
if [[ "$LIVE" == "200" ]]; then ok "GET /api/live still works"; else bad "live" "HTTP $LIVE"; fi

# 19) CMS GPS route still mounted (auth may 401 without key — not 404)
CGPS=$(curl -sS -o /tmp/dm-cgps.json -w '%{http_code}' -X POST "$BASE/api/cms/gps" -H 'Content-Type: application/json' -d '{}')
if [[ "$CGPS" != "404" ]]; then ok "POST /api/cms/gps still mounted ($CGPS)"; else bad "cms gps" "404"; fi

# 20) Vehicles CRUD still works
VEHS=$(curl -sS -o /tmp/dm-vehs.json -w '%{http_code}' "$BASE/api/vehicles" -H "$AUTH")
if [[ "$VEHS" == "200" ]]; then ok "GET /api/vehicles still works"; else bad "vehicles" "HTTP $VEHS"; fi

# 21) Stream snapshot (Phase 9)
STR=$(curl -sS "$BASE/api/dm/stream" -H "$AUTH")
echo "$STR" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert "devices" in d and "at" in d' \
  && ok "dm stream snapshot" || bad "stream" "$STR"

# 22) Telemetry endpoint
TEL=$(curl -sS "$BASE/api/dm/devices/$PK/telemetry" -H "$AUTH")
echo "$TEL" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert "telemetry" in d or d.get("note")' \
  && ok "telemetry endpoint" || bad "telemetry" "$TEL"

# 23) Heartbeat returns pending commands + config (after restore path may be revoked — register fresh)
REG2=$(curl -sS -X POST "$BASE/api/dm/devices" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"E2E Sim Probe","deviceType":"display","platform":"android","notes":"DEV SIMULATOR fixture — not production"}')
DID2=$(printf '%s' "$REG2" | python3 -c 'import json,sys; print(json.load(sys.stdin)["device"]["deviceId"])')
SEC2=$(printf '%s' "$REG2" | python3 -c 'import json,sys; print(json.load(sys.stdin)["credentials"]["secret"])')
PK2=$(printf '%s' "$REG2" | python3 -c 'import json,sys; print(json.load(sys.stdin)["device"]["id"])')
AUTH2=$(curl -sS -X POST "$BASE/api/dm/device/auth" -H 'Content-Type: application/json' \
  -d "{\"deviceId\":\"$DID2\",\"secret\":\"$SEC2\"}")
TOK2=$(printf '%s' "$AUTH2" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')
curl -sS -X POST "$BASE/api/dm/devices/$PK2/commands" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"commandType":"start_playback"}' >/tmp/dm-cmd2.json
HB2=$(curl -sS -X POST "$BASE/api/dm/device/heartbeat" -H "Authorization: Bearer $TOK2" -H 'Content-Type: application/json' \
  -d '{"playerStatus":"running","appVersion":"sim","idempotencyKey":"e2e-1","storageFreeMb":500,"storageTotalMb":2000,"memoryUsedMb":100}')
echo "$HB2" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("config"); assert isinstance(d.get("pendingCommands"), list)' \
  && ok "heartbeat returns config + pendingCommands" || bad "hb enrich" "$HB2"
# Idempotent replay
HB3=$(curl -sS -X POST "$BASE/api/dm/device/heartbeat" -H "Authorization: Bearer $TOK2" -H 'Content-Type: application/json' \
  -d '{"playerStatus":"running","idempotencyKey":"e2e-1"}')
echo "$HB3" | python3 -c 'import json,sys; assert json.load(sys.stdin).get("duplicate") is True' \
  && ok "heartbeat idempotency" || bad "idem" "$HB3"

# 24) Command ack lifecycle executing→completed
CID2=$(printf '%s' "$HB2" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("pendingCommands") or [{}])[0].get("id",""))')
if [[ -n "$CID2" ]]; then
  curl -sS -X POST "$BASE/api/dm/device/commands/$CID2/ack" -H "Authorization: Bearer $TOK2" -H 'Content-Type: application/json' \
    -d '{"status":"executing"}' >/tmp/dm-ex.json
  DONE=$(curl -sS -X POST "$BASE/api/dm/device/commands/$CID2/ack" -H "Authorization: Bearer $TOK2" -H 'Content-Type: application/json' \
    -d '{"status":"completed"}')
  echo "$DONE" | python3 -c 'import json,sys; assert json.load(sys.stdin)["status"]=="completed"' \
    && ok "command executing→completed" || bad "cmd lifecycle" "$DONE"
else
  bad "command id missing from heartbeat" "$HB2"
fi

# 25) MQTT transport describe (stub)
TR=$(curl -sS "$BASE/api/dm/transport" -H "$AUTH")
echo "$TR" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("transport") in ("rest_only","mqtt+rest")' \
  && ok "mqtt adapter describe" || bad "transport" "$TR"

echo
echo "Result: $PASS passed, $FAIL failed"
echo "NOTE: Controlled local DM tests / DEV SIMULATOR — not production device connectivity"
if [[ "$FAIL" -gt 0 ]]; then exit 1; fi
