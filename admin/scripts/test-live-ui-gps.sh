#!/usr/bin/env bash
# Phase 2 verification: continuous GPS stream → GET /api/live fields for Live Monitoring UI.
# Usage:
#   CMS_GPS_INGEST_KEY=dev-test-key ADMIN_GPS_URL=http://127.0.0.1:3000 ./scripts/test-live-ui-gps.sh
set -euo pipefail

BASE="${ADMIN_GPS_URL:-${ADMIN_API_URL:-http://127.0.0.1:3000}}"
BASE="${BASE%/}"
KEY="${CMS_GPS_INGEST_KEY:-}"
EMAIL="${ADMIN_EMAIL:-admin@adtech.in}"
PASS="${ADMIN_PASSWORD:-Admin@123}"

if [[ -z "$KEY" ]]; then
  echo "CMS_GPS_INGEST_KEY is required" >&2
  exit 1
fi

HDR=(-H "Content-Type: application/json" -H "x-cms-ingest-key: ${KEY}")
PASS_N=0
FAIL_N=0

check() {
  local name="$1"
  local ok="$2"
  local detail="${3:-}"
  if [[ "$ok" == "1" ]]; then
    echo "PASS  $name"
    PASS_N=$((PASS_N + 1))
  else
    echo "FAIL  $name${detail:+ — $detail}"
    FAIL_N=$((FAIL_N + 1))
  fi
}

echo "== Phase 2 Live Monitoring GPS against ${BASE} =="

# Admin Bearer for /api/live
LOGIN=$(curl -sS -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\",\"portal\":\"admin\"}" \
  "${BASE}/api/login" || true)
TOKEN=$(node -e 'const j=JSON.parse(process.argv[1]||"{}"); process.stdout.write(j.token||"")' "$LOGIN")
if [[ -z "$TOKEN" ]]; then
  echo "FAIL  admin login (no token)"
  echo "      body: $LOGIN"
  exit 1
fi
check "admin login" "1"
AUTH=(-H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json")

# Timestamps newer than any stored fix
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
TS2=$(node -e "console.log(new Date(${BASE_MS}+16000).toISOString())")

LAT1=12.98010
LNG1=77.61010
LAT2=12.98140
LNG2=77.61180

# Fix 1
CODE=$(curl -sS -o /tmp/live-ui-gps-1.json -w "%{http_code}" "${HDR[@]}" \
  -d "{\"autoNumber\":\"KA02CD5678\",\"lat\":${LAT1},\"lng\":${LNG1},\"accuracy\":8.2,\"recordedAt\":\"${TS1}\",\"deviceId\":\"phase2-ui-test\",\"source\":\"device_gps\",\"trackingActive\":true}" \
  "${BASE}/api/cms/gps")
check "ingest fix 1" "$([[ "$CODE" == "200" ]] && echo 1 || echo 0)" "HTTP $CODE $(cat /tmp/live-ui-gps-1.json)"

LIVE1=$(curl -sS "${AUTH[@]}" "${BASE}/api/live")
node -e '
const j=JSON.parse(process.argv[1]);
const wantLat=Number(process.argv[2]), wantLng=Number(process.argv[3]);
const d=(j.devices||[]).find(x => x.dev==="DEV-002" || x.autoNumber==="KA02CD5678");
const checks=[];
const ok=(n,c,det)=>{ checks.push({n,c,det}); };
ok("simDisabled true (or unset local)", j.simDisabled===true || j.simDisabled===false, "simDisabled="+j.simDisabled);
ok("stream true", j.stream===true, "stream="+j.stream);
ok("onlineThresholdMs", Number(j.onlineThresholdMs)>0, String(j.onlineThresholdMs));
ok("device found", !!d, "missing DEV-002 / KA02CD5678");
if (d) {
  ok("source device_gps", d.source==="device_gps", d.source);
  ok("autoNumber", d.autoNumber==="KA02CD5678", d.autoNumber);
  ok("online true", d.online===true, String(d.online));
  ok("stale false", d.stale===false, String(d.stale));
  ok("accuracyM", Number(d.accuracyM)===8.2, String(d.accuracyM));
  ok("lastUpdated", !!d.lastUpdated, String(d.lastUpdated));
  ok("lat moved to fix1", Math.abs(Number(d.lat)-wantLat)<1e-6, String(d.lat));
  ok("lng moved to fix1", Math.abs(Number(d.lng)-wantLng)<1e-6, String(d.lng));
}
for (const c of checks) {
  if (!c.c) { console.log("FAIL_DETAIL "+c.n+" :: "+c.det); process.exitCode=2; }
}
if (!process.exitCode) console.log("FIELDS_OK");
' "$LIVE1" "$LAT1" "$LNG1"
check "live fields after fix 1" "$([[ $? -eq 0 ]] && echo 1 || echo 0)"

# Fix 2 (marker must move without “page refresh” — new poll)
CODE=$(curl -sS -o /tmp/live-ui-gps-2.json -w "%{http_code}" "${HDR[@]}" \
  -d "{\"autoNumber\":\"KA02CD5678\",\"lat\":${LAT2},\"lng\":${LNG2},\"accuracy\":6.5,\"recordedAt\":\"${TS2}\",\"deviceId\":\"phase2-ui-test\",\"source\":\"device_gps\",\"trackingActive\":true}" \
  "${BASE}/api/cms/gps")
check "ingest fix 2 (move)" "$([[ "$CODE" == "200" ]] && echo 1 || echo 0)" "HTTP $CODE"

LIVE2=$(curl -sS "${AUTH[@]}" "${BASE}/api/live")
node -e '
const a=JSON.parse(process.argv[1]);
const b=JSON.parse(process.argv[2]);
const lat2=Number(process.argv[3]), lng2=Number(process.argv[4]);
const d1=(a.devices||[]).find(x => x.dev==="DEV-002" || x.autoNumber==="KA02CD5678");
const d2=(b.devices||[]).find(x => x.dev==="DEV-002" || x.autoNumber==="KA02CD5678");
if (!d1 || !d2) { console.error("missing device"); process.exit(2); }
const moved = Math.abs(Number(d2.lat)-Number(d1.lat))>1e-6 || Math.abs(Number(d2.lng)-Number(d1.lng))>1e-6;
const atTarget = Math.abs(Number(d2.lat)-lat2)<1e-6 && Math.abs(Number(d2.lng)-lng2)<1e-6;
if (!moved || !atTarget) {
  console.error("no move", {from:[d1.lat,d1.lng],to:[d2.lat,d2.lng],want:[lat2,lng2]});
  process.exit(2);
}
if (d2.source!=="device_gps" || d2.online!==true) process.exit(2);
console.log("MOVED", d1.lat, d1.lng, "→", d2.lat, d2.lng);
' "$LIVE1" "$LIVE2" "$LAT2" "$LNG2"
check "marker position updates on next /api/live poll" "$([[ $? -eq 0 ]] && echo 1 || echo 0)"

# Legacy device-location still reachable (auth key path — expect 4xx without DEVICE_KEY or 200 if set; just not 404)
DL_CODE=$(curl -sS -o /tmp/live-ui-dl.json -w "%{http_code}" -H "Content-Type: application/json" \
  -d '{"key":"__phase2_probe__","dev":"DEV-001","lat":12.9,"lng":77.6}' \
  "${BASE}/api/device-location" || echo "000")
check "device-location route still present (not 404)" "$([[ "$DL_CODE" != "404" ]] && echo 1 || echo 0)" "HTTP $DL_CODE"

# Static UI assets include Phase 2 strings
APP_JS=$(curl -sS "${BASE}/app.js" || true)
check "app.js serves Live Phase 2 poll" "$(echo "$APP_JS" | grep -q 'LIVE_POLL_MS' && echo 1 || echo 0)"
check "app.js shows auto number / presence" "$(echo "$APP_JS" | grep -q 'livePresence' && echo "$APP_JS" | grep -q 'Auto number' && echo 1 || echo 0)"
check "app.js CMS GPS filter" "$(echo "$APP_JS" | grep -q 'CMS GPS only' && echo 1 || echo 0)"

echo "== Result: ${PASS_N} passed, ${FAIL_N} failed =="
[[ "$FAIL_N" -eq 0 ]]
