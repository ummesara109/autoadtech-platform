#!/usr/bin/env bash
# Phase 1 verification: POST /api/cms/gps with test coordinates.
# Usage:
#   CMS_GPS_INGEST_KEY=dev-test-key ADMIN_GPS_URL=http://127.0.0.1:3000 ./scripts/test-cms-gps.sh
set -euo pipefail

BASE="${ADMIN_GPS_URL:-${ADMIN_API_URL:-http://127.0.0.1:3000}}"
BASE="${BASE%/}"
KEY="${CMS_GPS_INGEST_KEY:-}"
if [[ -z "$KEY" ]]; then
  echo "CMS_GPS_INGEST_KEY is required" >&2
  exit 1
fi

HDR=(-H "Content-Type: application/json" -H "x-cms-ingest-key: ${KEY}")
PASS=0
FAIL=0

check() {
  local name="$1"
  local expect_code="$2"
  local got_code="$3"
  local body="$4"
  if [[ "$got_code" == "$expect_code" ]]; then
    echo "PASS  $name (HTTP $got_code)"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $name (expected $expect_code, got $got_code)"
    echo "      body: $body"
    FAIL=$((FAIL + 1))
  fi
}

echo "== Admin CMS GPS tests against ${BASE} =="

# Timestamps must be newer than any in-memory/local stored fix (stale guard).
BASE_MS=$(curl -sS "${HDR[@]}" "${BASE}/api/cms/gps/fleet" | node -e '
let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
  let max=Date.now();
  try {
    const j=JSON.parse(s||"{}");
    for (const p of j.positions||[]) {
      const t=Date.parse(p.recordedAt||p.lastUpdated||0);
      if (Number.isFinite(t) && t>max) max=t;
    }
  } catch (_) {}
  console.log(max);
});')
TS1=$(node -e "console.log(new Date(${BASE_MS}+1000).toISOString())")
TS_STALE=$(node -e "console.log(new Date(${BASE_MS}-3600000).toISOString())")
TS2=$(node -e "console.log(new Date(${BASE_MS}+2000).toISOString())")
TS3=$(node -e "console.log(new Date(${BASE_MS}+17000).toISOString())")

# 1) Valid upsert (CMS seed plate → Admin vehicle 1 / DEV-001)
CODE=$(curl -sS -o /tmp/cms-gps-1.json -w "%{http_code}" "${HDR[@]}" \
  -d "{\"autoNumber\":\"KA01AB1234\",\"cmsVehicleId\":\"11111111-1111-4111-8111-111111111111\",\"cmsScreenId\":\"33333333-3333-4333-8333-333333333331\",\"lat\":12.9716,\"lng\":77.5946,\"accuracy\":12.5,\"recordedAt\":\"${TS1}\",\"deviceId\":\"test-pwa-1\",\"source\":\"device_gps\",\"trackingActive\":true}" \
  "${BASE}/api/cms/gps")
BODY=$(cat /tmp/cms-gps-1.json)
check "valid upsert KA01AB1234" "200" "$CODE" "$BODY"

# 2) Duplicate (same recordedAt + coords) → ignored OK
CODE=$(curl -sS -o /tmp/cms-gps-2.json -w "%{http_code}" "${HDR[@]}" \
  -d "{\"autoNumber\":\"KA01AB1234\",\"lat\":12.9716,\"lng\":77.5946,\"recordedAt\":\"${TS1}\",\"source\":\"device_gps\"}" \
  "${BASE}/api/cms/gps")
BODY=$(cat /tmp/cms-gps-2.json)
check "duplicate ignored" "200" "$CODE" "$BODY"

# 3) Stale timestamp → ignored OK
CODE=$(curl -sS -o /tmp/cms-gps-3.json -w "%{http_code}" "${HDR[@]}" \
  -d "{\"autoNumber\":\"KA01AB1234\",\"lat\":12.98,\"lng\":77.60,\"recordedAt\":\"${TS_STALE}\",\"source\":\"device_gps\"}" \
  "${BASE}/api/cms/gps")
BODY=$(cat /tmp/cms-gps-3.json)
check "stale timestamp ignored" "200" "$CODE" "$BODY"

# 4) Invalid coords
CODE=$(curl -sS -o /tmp/cms-gps-4.json -w "%{http_code}" "${HDR[@]}" \
  -d '{"autoNumber":"KA01AB1234","lat":999,"lng":77.59,"source":"device_gps"}' \
  "${BASE}/api/cms/gps")
BODY=$(cat /tmp/cms-gps-4.json)
check "invalid coords rejected" "400" "$CODE" "$BODY"

# 5) Unmapped auto number
CODE=$(curl -sS -o /tmp/cms-gps-5.json -w "%{http_code}" "${HDR[@]}" \
  -d '{"autoNumber":"XX99ZZ9999","lat":12.97,"lng":77.59,"source":"device_gps"}' \
  "${BASE}/api/cms/gps")
BODY=$(cat /tmp/cms-gps-5.json)
check "unmapped autoNumber 404" "404" "$CODE" "$BODY"

# 6) Bad ingest key
CODE=$(curl -sS -o /tmp/cms-gps-6.json -w "%{http_code}" \
  -H "Content-Type: application/json" -H "x-cms-ingest-key: wrong-key" \
  -d '{"autoNumber":"KA01AB1234","lat":12.97,"lng":77.59,"source":"device_gps"}' \
  "${BASE}/api/cms/gps")
BODY=$(cat /tmp/cms-gps-6.json)
check "bad ingest key 401" "401" "$CODE" "$BODY"

# 7) Fleet snapshot
CODE=$(curl -sS -o /tmp/cms-gps-7.json -w "%{http_code}" "${HDR[@]}" \
  "${BASE}/api/cms/gps/fleet")
BODY=$(cat /tmp/cms-gps-7.json)
check "fleet snapshot" "200" "$CODE" "$BODY"

# 8) Stop tracking
CODE=$(curl -sS -o /tmp/cms-gps-8.json -w "%{http_code}" "${HDR[@]}" \
  -d '{"autoNumber":"KA01AB1234"}' \
  "${BASE}/api/cms/gps/stop")
BODY=$(cat /tmp/cms-gps-8.json)
check "stop tracking" "200" "$CODE" "$BODY"

# 9) Legacy device-location still works (local default key)
CODE=$(curl -sS -o /tmp/cms-gps-9.json -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{"key":"device-secret","dev":"DEV-002","lat":12.9784,"lng":77.6408,"speed":10}' \
  "${BASE}/api/device-location")
BODY=$(cat /tmp/cms-gps-9.json)
check "legacy device-location intact" "200" "$CODE" "$BODY"

# 10) Continuous stream: two successive fixes with moving coords (API verify only)
CODE=$(curl -sS -o /tmp/cms-gps-10a.json -w "%{http_code}" "${HDR[@]}" \
  -d "{\"autoNumber\":\"KA02CD5678\",\"lat\":12.9784,\"lng\":77.6408,\"accuracy\":8,\"recordedAt\":\"${TS2}\",\"source\":\"device_gps\",\"trackingActive\":true}" \
  "${BASE}/api/cms/gps")
BODY=$(cat /tmp/cms-gps-10a.json)
check "stream fix 1 KA02CD5678" "200" "$CODE" "$BODY"

CODE=$(curl -sS -o /tmp/cms-gps-10b.json -w "%{http_code}" "${HDR[@]}" \
  -d "{\"autoNumber\":\"KA02CD5678\",\"lat\":12.9790,\"lng\":77.6415,\"accuracy\":7,\"recordedAt\":\"${TS3}\",\"source\":\"device_gps\",\"trackingActive\":true}" \
  "${BASE}/api/cms/gps")
BODY=$(cat /tmp/cms-gps-10b.json)
LAT=$(node -e "const j=require('/tmp/cms-gps-10b.json'); process.exit(j.lat===12.9790&&j.online===true?0:1)" && echo ok || echo bad)
if [[ "$CODE" == "200" && "$LAT" == "ok" ]]; then
  echo "PASS  stream fix 2 moved coords + online"
  PASS=$((PASS + 1))
else
  echo "FAIL  stream fix 2 moved coords (HTTP $CODE latCheck=$LAT body=$BODY)"
  FAIL=$((FAIL + 1))
fi

echo
echo "Results: ${PASS} passed, ${FAIL} failed"
echo "Sample upsert body:"; cat /tmp/cms-gps-1.json; echo
echo "Fleet body:"; cat /tmp/cms-gps-7.json; echo
echo "Stream fix 2 body:"; cat /tmp/cms-gps-10b.json; echo
[[ "$FAIL" -eq 0 ]]
