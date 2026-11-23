"use strict";

if (typeof document !== "undefined") {

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PAGE = 8, TK = "adtech-token";
const inr = n => "₹" + Number(n || 0).toLocaleString("en-IN");
const pd = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T00:00:00") : new Date(v);
const fdate = v => { const d = pd(v); return isNaN(d) ? esc(v) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); };
const fdt = v => { const d = new Date(v); return isNaN(d) ? "" : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); };
const ago = v => { const m = Math.floor((Date.now() - new Date(v)) / 60000); if (isNaN(m)) return "-"; if (m < 1) return "Just now"; if (m < 60) return m + " min ago"; const h = Math.floor(m / 60); return h < 24 ? h + " hr ago" : Math.floor(h / 24) + " d ago"; };
const initials = s => String(s || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");

/* ---------- Icons ---------- */
const ICONS = {
  home: '<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.8.7 3 2.4 3.3 5"/>',
  mega: '<path d="M3 10v4h4l8 5V5L7 10z"/><path d="M18.5 9a4 4 0 0 1 0 6"/>',
  idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.5-1.5 1.7-2 3-2s2.5.5 3 2M14 10h4M14 13h3"/>',
  car: '<path d="M4 17v-5l2-5h12l2 5v5z"/><path d="M4 12h16"/><circle cx="8" cy="17" r="1.6"/><circle cx="16" cy="17" r="1.6"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  bars: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  life: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  logout: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  chev: '<path d="M14 6l-6 6 6 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M10 6l-6 6 6 6M4 12h16"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  login: '<path d="M14 4h5v16h-5M9 8l-4 4 4 4M5 12h10"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  pin: '<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>'
};
const ic = n => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

/* ---------- State + API ---------- */
let token = null; try { token = localStorage.getItem(TK); } catch (e) { /* no storage */ }
let ME = null, D = {}, META = { areas: [] }, PORTAL = "admin", cur = "dashboard", VIEW = null, ADMIN_D = null; /* VIEW = client whose portal an admin is previewing (view-only) */
/** Integrated gateway injects window.__API_BASE__="/admin-api"; standalone uses "". */
const apiBase = () =>
  (typeof window !== "undefined" && window.__API_BASE__
    ? String(window.__API_BASE__).replace(/\/$/, "")
    : "");
const apiUrl = path => {
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.startsWith("/") ? path : "/" + path;
  return apiBase() + p;
};
async function API(method, url, body) {
  let r;
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : null;
  try {
    r = await fetch(apiUrl(url), {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined
    });
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error("Request timed out. Check Admin API (/api/dm) is reachable.");
    }
    throw new Error("Cannot reach the server. Check your connection or redeploy the API.");
  } finally {
    if (timer) clearTimeout(timer);
  }
  const raw = await r.text();
  let j = {};
  try { j = raw ? JSON.parse(raw) : {}; } catch (e) { /* HTML / empty body */ }
  if (r.status === 401 && token) { logout(); toast("Session expired. Please sign in again."); }
  if (!r.ok) {
    if (!j.error && (r.status === 404 || r.status === 500) && /NOT_FOUND|FUNCTION_INVOCATION_FAILED|could not be found|INTERNAL_SERVER_ERROR/i.test(raw)) {
      throw new Error("API is down (" + r.status + "). Wait for the latest Vercel deploy, then set SUPABASE_URL and SUPABASE_SECRET_KEY in Vercel → Settings → Environment Variables.");
    }
    throw new Error(j.error || "Request failed (" + r.status + ")");
  }
  return j;
}
async function refresh() {
  applyBootstrap(await API("GET", "/api/bootstrap"));
}
const toast = m => { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), 2400); };

/* ---------- Schema: f = [key, label, type | options | options()] ---------- */
const ST = ["Active", "Inactive"], APP = ["Approved", "Pending", "Rejected"];
const vehOpts = () => D.vehicles.map(v => v.no), advOpts = () => D.advertisers.map(a => a.name);
const today = () => new Date().toISOString().slice(0, 10);
const S = {
  users: { t: "Users & Roles", add: "Add user", def: { status: "Active", role: "Manager" }, f: [["name", "Name"], ["email", "Email", "email"], ["role", "Role", ["Super Admin", "Admin", "Manager", "Viewer", "Support"]], ["status", "Status", ST], ["password", "Password", "password"]] },
  advertisers: { t: "Advertisers", add: "Add advertiser", def: { status: "Approved" }, f: [["name", "Business name"], ["email", "Login email", "email"], ["status", "Status", APP], ["password", "Password", "password"]] },
  partners: { t: "Drivers & Partners", add: "Add partner", def: { status: "Active" }, f: [["name", "Name"], ["phone", "Phone", "tel"], ["vehicle", "Vehicle no.", vehOpts], ["status", "Status", ["Active", "Pending", "Inactive"]]] },
  vehicles: { t: "Vehicles", add: "Add vehicle", def: { status: "Active" }, f: [["no", "Vehicle no."], ["owner", "Owner name"], ["phone", "Operator phone (required for live OTP; optional only for configured demo vehicles or partner fallback)", "tel"], ["area", "Area (Bengaluru)", () => META.areas], ["status", "Status", ST]] },
  devices: { t: "Device Management", add: "Register device", def: { status: "Online" }, f: [["dev", "Device ID"], ["vehicle", "Vehicle no.", vehOpts], ["status", "Status", ["Online", "Offline", "Maintenance"]], ["seen", "Last seen", "ago"]] },
  campaigns: { t: "Campaigns", add: "Create campaign", def: { status: "Pending" }, tabs: ["All", "Pending", "Approved", "Rejected"], tabKey: "status", f: [["name", "Campaign name"], ["adv", "Advertiser", advOpts], ["start", "Start date", "date"], ["end", "End date", "date"], ["status", "Status", APP]] },
  inventory: { t: "Inventory & Pricing", add: "Add package", def: { status: "Active" }, f: [["name", "Package name"], ["dur", "Duration", ["1 week", "1 month", "3 months", "6 months", "1 year"]], ["price", "Price (₹)", "money"], ["status", "Status", ST]] },
  billing: { t: "Billing & Payments", add: "Add transaction", def: { status: "Pending", type: "Transactions" }, tabs: ["Transactions", "Invoices", "Payouts"], tabKey: "type", tabsOnly: 1, export: 1, f: [["date", "Date", "date"], ["desc", "Description"], ["adv", "Advertiser", () => ["Platform", ...advOpts()]], ["amount", "Amount (₹)", "money"], ["type", "Type", ["Transactions", "Invoices", "Payouts"]], ["status", "Status", ["Paid", "Pending", "Failed"]]] },
  support: { t: "Support", add: "New ticket", def: { status: "Open", prio: "Medium" }, f: [["subj", "Subject"], ["user", "User"], ["prio", "Priority", ["High", "Medium", "Low"]], ["status", "Status", ["Open", "In progress", "Resolved", "Closed"]]] },
  audit: { t: "Audit Logs", ro: 1, f: [["action", "Action"], ["user", "User"], ["at", "Date & time", "datetime"], ["ip", "IP address"]] }
};
const LABEL = { clientlogins: "Client Logins", dashboard: "Dashboard", live: "Live Monitoring", cmsotp: "CMS OTP Inbox", analytics: "Analytics & Reports", delivery: "Campaign Delivery", settings: "Settings" };
const CT = { campaigns: "My Campaigns", inventory: "Ad Packages", billing: "Billing & Invoices", support: "Support" };
const title = k => (PORTAL === "client" && CT[k]) || (S[k] && S[k].t) || LABEL[k];
const ICON = { clientlogins: "login", dashboard: "home", users: "users", advertisers: "mega", partners: "idcard", vehicles: "car", devices: "monitor", campaigns: "flag", delivery: "radio", inventory: "tag", live: "radio", cmsotp: "shield", analytics: "bars", billing: "card", settings: "sliders", support: "life", audit: "shield" };
const GROUPS = {
  admin: [["Overview", ["dashboard", "clientlogins", "cmsotp"]], ["Management", ["users", "advertisers", "partners", "vehicles", "devices"]], ["Advertising", ["campaigns", "delivery", "inventory", "live", "analytics"]], ["Finance", ["billing"]], ["System", ["settings", "support", "audit"]]],
  client: [["Overview", ["dashboard"]], ["Advertising", ["campaigns", "inventory"]], ["Finance", ["billing"]], ["Help", ["support"]]]
};
const HIDECOL = { billing: ["adv"], campaigns: ["adv"], support: ["user"] }, FORMHIDE = { campaigns: ["adv", "status"], support: ["user", "status"] };
/** Server validates whether a blank vehicle phone is allowed for this record. */
const isOptional = (k, key) => k === "vehicles" && key === "phone";
const vis = k => S[k].f.filter(f => f[2] !== "password" && !(PORTAL === "client" && (HIDECOL[k] || []).includes(f[0])));
const AV = ["users", "advertisers", "partners"];

/* ---------- Permissions (the server enforces these too) ---------- */
const canAdd = k => { if (S[k].ro || VIEW) return false; if (PORTAL === "client") return k === "campaigns" || k === "support"; if (ME.role === "Viewer") return false; return k !== "users" || ["Super Admin", "Admin"].includes(ME.role); };
const canRow = (k, r) => VIEW ? false : PORTAL === "client" ? k === "campaigns" && r.status === "Pending" : canAdd(k);

/* ---------- Cells ---------- */
const OK = ["Active", "Approved", "Online", "online", "activated", "healthy", "Paid", "Resolved", "running", "completed"], WARN = ["Pending", "Maintenance", "maintenance", "Medium", "In progress", "warning", "registered", "stale", "pending", "acknowledged", "unknown", "suspended"], BAD = ["Inactive", "Offline", "offline", "Rejected", "High", "Failed", "failed", "critical", "revoked", "expired", "stopped"];
const badge = v => `<span class="b ${OK.includes(v) ? "ok" : WARN.includes(v) ? "warn" : BAD.includes(v) ? "bad" : ""}">${esc(v)}</span>`;
const cell = (f, r) => {
  const [key, , type] = f, v = r[key];
  if (type === "date") return fdate(v); if (type === "datetime") return fdt(v); if (type === "money") return inr(v); if (type === "ago") return ago(r.lastSeenAt);
  return ["status", "role", "prio"].includes(key) ? badge(v) : esc(v);
};
const SI = { "Revenue (paid)": "card", "Total campaigns": "flag", "Active devices": "monitor", "Active partners": "idcard", Impressions: "bars", Clicks: "radio", CTR: "flag", Revenue: "card", "My campaigns": "flag", Approved: "shield", "Pending review": "bell", "Total paid": "card", "Total Devices": "monitor", "Activated Devices": "check", "Online Devices": "radio", "Offline Devices": "monitor", "Devices Under Maintenance": "sliders", "Devices Requiring Attention": "bell", "Unassigned Devices": "tag", "Suspended Devices": "shield" };
/* Device Management UI state (player heartbeat registry — not Live phone GPS) */
const dmState = {
  q: "", filter: "all", page: 1, vehicle: "", detailId: null,
  _gen: 0, _loading: false, _pollInFlight: false, _delegatesBound: false,
  _cacheOverview: null, _interactUntil: 0, _pendingList: false
};
let dmPollTimer = null;
const stopDmPoll = () => { clearInterval(dmPollTimer); dmPollTimer = null; dmState._pollInFlight = false; };
const DM_FILTERS = [
  ["all", "All"], ["pending_activation", "Pending activation"], ["active", "Active"],
  ["online", "Online"], ["offline", "Offline"], ["needs_attention", "Needs attention"],
  ["healthy", "Healthy"], ["warning", "Warning"], ["critical", "Critical"],
  ["player_running", "Player running"], ["player_error", "Player error"],
  ["maintenance", "Maintenance"], ["suspended", "Suspended"], ["revoked", "Revoked"], ["unassigned", "Unassigned"]
];
function dmFilterLabel(key) {
  const hit = DM_FILTERS.find(([k]) => k === key);
  return hit ? hit[1] : (key || "All");
}
/** Mark user interaction so poll list redraws defer (~2.5s) and in-flight soft paints stay interruptible. */
function dmBumpInteract(ms) {
  const until = Date.now() + (ms == null ? 2500 : ms);
  if (until > dmState._interactUntil) dmState._interactUntil = until;
}
function dmIsInteracting() {
  if (dmState.detailId) return true;
  if (Date.now() < dmState._interactUntil) return true;
  const mbg = $("#mbg");
  if (mbg && mbg.classList.contains("on")) return true;
  return false;
}
function dmSoftReload() {
  if (cur === "devices" && !dmState.detailId) V.devices({ soft: true });
}
function dmMarkFilterTabs(active) {
  document.querySelectorAll("#dm-shell [data-dmf], #view [data-dmf]").forEach(b => {
    b.classList.toggle("on", b.getAttribute("data-dmf") === active);
  });
}
function dmSetFilter(key) {
  if (!key) return;
  dmBumpInteract();
  dmState.filter = key;
  dmState.page = 1;
  dmMarkFilterTabs(key); /* optimistic — do not wait for soft fetch */
  const live = $("#dm-live");
  if (live) live.textContent = "Updating…";
  dmSoftReload();
}
function dmSetPage(page) {
  dmBumpInteract();
  dmState.page = Math.max(1, Number(page) || 1);
  const live = $("#dm-live");
  if (live) live.textContent = "Updating…";
  dmSoftReload();
}
function dmSetVehicle(vehicle) {
  dmBumpInteract();
  dmState.vehicle = vehicle || "";
  dmState.page = 1;
  dmSoftReload();
}
function dmSetQuery(q) {
  dmBumpInteract(1500);
  dmState.q = q || "";
  dmState.page = 1;
  clearTimeout(dmState._t);
  dmState._t = setTimeout(dmSoftReload, 180);
}
function dmRowHint(tr) {
  if (!tr) return null;
  const tds = tr.querySelectorAll("td");
  const code = tr.querySelector("code");
  return {
    id: tr.getAttribute("data-did"),
    deviceId: code ? code.textContent : "",
    name: tds[1] ? tds[1].textContent : ""
  };
}
function dmOpenFromRow(tr) {
  const hint = dmRowHint(tr);
  if (!hint || !hint.id) return;
  dmBumpInteract(4000);
  dmOpenDetail(hint.id, () => {
    dmState.detailId = null;
    dmSoftReload();
  }, hint);
}
/** Stable document delegation — survives innerHTML repaints (unlike #view.onclick alone). */
function ensureDmDelegation() {
  if (dmState._delegatesBound) return;
  dmState._delegatesBound = true;
  document.addEventListener("click", e => {
    if (cur !== "devices") return;
    /* Ignore modal / sidebar chrome */
    if (e.target.closest("#mbg, #side, #modal, .modal-bg")) return;
    if (dmState.detailId) return; /* detail uses its own direct binds */
    const f = e.target.closest("[data-dmf]");
    if (f && f.closest("#view")) {
      e.preventDefault();
      dmSetFilter(f.getAttribute("data-dmf"));
      return;
    }
    const p = e.target.closest("[data-dmp]");
    if (p && p.closest("#view") && !p.hasAttribute("disabled") && !p.disabled) {
      e.preventDefault();
      dmSetPage(p.getAttribute("data-dmp"));
      return;
    }
    const tr = e.target.closest("tr[data-did]");
    if (tr && tr.closest("#view")) {
      e.preventDefault();
      dmOpenFromRow(tr);
      return;
    }
    if (e.target.closest("#dm-add")) {
      e.preventDefault();
      dmBumpInteract(5000);
      dmRegisterModal(dmSoftReload);
    }
  });
  document.addEventListener("input", e => {
    if (cur !== "devices" || dmState.detailId) return;
    if (e.target && e.target.id === "dm-q") dmSetQuery(e.target.value);
  });
  document.addEventListener("change", e => {
    if (cur !== "devices" || dmState.detailId) return;
    if (e.target && e.target.id === "dm-vehicle") dmSetVehicle(e.target.value);
  });
}
/** Soft-only live poll. Never paints Loading; never blocks filter clicks. */
function startDmLivePoll() {
  stopDmPoll();
  dmState._pollTicks = 0;
  dmPollTimer = setInterval(async () => {
    if (cur !== "devices" || dmState.detailId || dmState._pollInFlight) return;
    dmState._pollInFlight = true;
    dmState._pollTicks = (dmState._pollTicks || 0) + 1;
    try {
      const snap = await API("GET", "/api/dm/stream");
      if (cur !== "devices" || dmState.detailId) return;
      const el = $("#dm-live");
      if (el && snap && Array.isArray(snap.devices) && !dmIsInteracting()) {
        const online = snap.devices.filter(x => x.connectionStatus === "online").length;
        el.textContent = `Live · ${online} online / ${snap.devices.length} · ${fdt(snap.at)}`;
      }
      /* Defer full list redraw while user is clicking / modal open — stream text still updates. */
      if (dmState._pollTicks % 3 === 0 && cur === "devices" && !dmState.detailId && !dmIsInteracting()) {
        await V.devices({ soft: true, poll: true });
      }
    } catch (_) { /* ignore transient */ }
    finally { dmState._pollInFlight = false; }
  }, 5000);
}
function dmListRowsHtml(list) {
  if (!list) return "";
  return (list.items || []).map(d => `<tr data-did="${esc(d.id)}" tabindex="0" style="cursor:pointer">
      <td data-label="Device ID"><code>${esc(d.deviceId)}</code></td>
      <td data-label="Name">${esc(d.name)}</td>
      <td data-label="Vehicle">${esc(d.vehicleNo || "—")}</td>
      <td data-label="Type">${esc(d.deviceType)}</td>
      <td data-label="Lifecycle">${badge(d.lifecycleStatus)}</td>
      <td data-label="Connection">${badge(d.connectionStatus)}</td>
      <td data-label="Last heartbeat">${d.lastHeartbeatAt ? ago(d.lastHeartbeatAt) : "—"}</td>
      <td data-label="Player">${badge(d.playerStatus || "unknown")}</td>
      <td data-label="Health">${badge(d.healthStatus || "unknown")}</td>
    </tr>`).join("");
}
function dmBindShellControls() {
  document.querySelectorAll("#dm-shell [data-dmf]").forEach(btn => {
    btn.onclick = e => { e.preventDefault(); e.stopPropagation(); dmSetFilter(btn.getAttribute("data-dmf")); };
  });
  document.querySelectorAll("#dm-shell [data-dmp]").forEach(btn => {
    if (btn.disabled) return;
    btn.onclick = e => { e.preventDefault(); e.stopPropagation(); dmSetPage(btn.getAttribute("data-dmp")); };
  });
  document.querySelectorAll("#dm-shell tr[data-did]").forEach(tr => {
    tr.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      dmOpenFromRow(tr);
    };
  });
  if ($("#dm-add")) $("#dm-add").onclick = e => {
    e.preventDefault();
    e.stopPropagation();
    dmBumpInteract(5000);
    dmRegisterModal(dmSoftReload);
  };
  if ($("#dm-q")) $("#dm-q").oninput = e => dmSetQuery(e.target.value);
  if ($("#dm-vehicle")) $("#dm-vehicle").onchange = e => dmSetVehicle(e.target.value);
}
function dmOverviewDefaults(overview) {
  return overview || {
    total: "—", activated: "—", online: "—", offline: "—",
    maintenance: "—", needingAttention: "—", unassigned: "—", suspended: "—",
    offlineTimeoutSec: offlineTimeoutHint()
  };
}
function dmPatchOverviewStats(o) {
  const shell = $("#dm-shell");
  if (!shell) return;
  const vals = [o.total, o.activated, o.online, o.offline, o.maintenance, o.needingAttention, o.unassigned, o.suspended];
  shell.querySelectorAll(".stat strong").forEach((el, i) => {
    if (i < vals.length && vals[i] != null) el.textContent = vals[i];
  });
}
/** Surgical soft update — keep search/tabs/Register DOM; only swap list + pager + stats. */
function patchDmShell(st, overview, list) {
  ensureDmDelegation();
  const shell = $("#dm-shell");
  if (!shell) {
    paintDmShell(st, overview, list, { pending: false });
    return;
  }
  const o = dmOverviewDefaults(overview);
  if (overview) dmState._cacheOverview = overview;
  const pages = (list && list.pages) || 1;
  if (list) st.page = Math.min(st.page || 1, pages);
  const filt = st.filter || "all";
  const rows = dmListRowsHtml(list);
  const totalLabel = list
    ? `${list.total} record${list.total === 1 ? "" : "s"} · filter ${dmFilterLabel(filt)} · heartbeat timeout ${o.offlineTimeoutSec}s`
    : "Fetching devices…";
  const emptyMsg = list
    ? `No devices in “${dmFilterLabel(filt)}”. Register a device or choose another filter.`
    : "Loading records…";
  dmPatchOverviewStats(o);
  dmMarkFilterTabs(filt);
  const chSpan = shell.querySelector(".tcard .ch span");
  if (chSpan) chSpan.textContent = totalLabel;
  const tbody = shell.querySelector(".tcard tbody");
  if (tbody) tbody.innerHTML = rows || "";
  let empty = shell.querySelector(".tcard .empty");
  if (rows) {
    if (empty) empty.remove();
  } else {
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "empty";
      const pager = shell.querySelector(".tcard .pager");
      if (pager) pager.parentNode.insertBefore(empty, pager);
      else shell.querySelector(".tcard").appendChild(empty);
    }
    empty.textContent = emptyMsg;
  }
  const pager = shell.querySelector(".tcard .pager");
  if (pager) {
    const page = list ? list.page : (st.page || 1);
    pager.innerHTML = `<span class="pi">Page ${page} of ${pages}</span>
      <div class="pb"><button type="button" class="pg" data-dmp="${page - 1}" ${page <= 1 ? "disabled" : ""}>‹</button>
      <button type="button" class="pg" data-dmp="${page + 1}" ${page >= pages ? "disabled" : ""}>›</button></div>`;
  }
  /* Rebind only list/pager (tabs/Register/search nodes were preserved). */
  document.querySelectorAll("#dm-shell [data-dmp]").forEach(btn => {
    if (btn.disabled) return;
    btn.onclick = e => { e.preventDefault(); e.stopPropagation(); dmSetPage(btn.getAttribute("data-dmp")); };
  });
  document.querySelectorAll("#dm-shell tr[data-did]").forEach(tr => {
    tr.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      dmOpenFromRow(tr);
    };
  });
  const live = $("#dm-live");
  if (live && !(live.textContent || "").startsWith("Live")) {
    /* leave Updating… until stream poll refreshes */
  }
}
/** Paint DM UI. pending=true shows Updating… but keeps filters clickable — no Loading wall. */
function paintDmShell(st, overview, list, opts) {
  ensureDmDelegation();
  const pending = !!(opts && opts.pending);
  const o = dmOverviewDefaults(overview);
  if (overview) dmState._cacheOverview = overview;
  const vehOptsHtml = `<option value="">All vehicles</option>` + (D.vehicles || []).map(v => `<option value="${esc(v.no)}" ${st.vehicle === v.no ? "selected" : ""}>${esc(v.no)}</option>`).join("");
  const pages = (list && list.pages) || 1;
  if (list) st.page = Math.min(st.page || 1, pages);
  const rows = dmListRowsHtml(list);
  const prevQ = $("#dm-q") ? $("#dm-q").value : (st.q || "");
  const prevFocus = document.activeElement && document.activeElement.id;
  const prevLive = ($("#dm-live") && $("#dm-live").textContent) || "";
  const liveTxt = pending
    ? "Updating…"
    : (prevLive.startsWith("Live") ? prevLive : "");
  const filt = st.filter || "all";
  const totalLabel = list
    ? `${list.total} record${list.total === 1 ? "" : "s"} · filter ${dmFilterLabel(filt)} · heartbeat timeout ${o.offlineTimeoutSec}s`
    : "Fetching devices…";
  const emptyMsg = list
    ? `No devices in “${dmFilterLabel(filt)}”. Register a device or choose another filter.`
    : "Loading records…";
  $("#view").innerHTML = `
    <div id="dm-shell">
    <div class="dm-note muted">Player connectivity uses device heartbeats only. Phone GPS stays on Live Monitoring and does not mark screens online. <span id="dm-live">${esc(liveTxt)}</span></div>
    <div class="grid g4" style="margin-bottom:14px">
      ${stat("Total Devices", o.total)}
      ${stat("Activated Devices", o.activated)}
      ${stat("Online Devices", o.online)}
      ${stat("Offline Devices", o.offline)}
    </div>
    <div class="grid g4" style="margin-bottom:14px">
      ${stat("Devices Under Maintenance", o.maintenance)}
      ${stat("Devices Requiring Attention", o.needingAttention)}
      ${stat("Unassigned Devices", o.unassigned)}
      ${stat("Suspended Devices", o.suspended)}
    </div>
    <div class="bar">
      <div class="sb">${ic("search")}<input id="dm-q" placeholder="Search devices…" value="${esc(prevQ)}" aria-label="Search devices"></div>
      <select id="dm-vehicle" style="max-width:180px;margin:0" aria-label="Vehicle filter">${vehOptsHtml}</select>
      <span class="sp"></span>
      ${canAdd("devices") ? `<button type="button" class="btn" id="dm-add">${ic("plus")}Register device</button>` : ""}
    </div>
    <div class="tabs dm-tabs" role="tablist" aria-label="Device filters">${DM_FILTERS.map(([k, l]) => `<button type="button" data-dmf="${k}" class="${filt === k ? "on" : ""}" style="pointer-events:auto;cursor:pointer">${l}</button>`).join("")}</div>
    <div class="card tcard"><div class="ch"><h3>Devices</h3><span>${esc(totalLabel)}</span></div>
    <div class="tw"><table><thead><tr>
      <th>Device ID</th><th>Name</th><th>Vehicle</th><th>Type</th><th>Lifecycle</th><th>Connection</th><th>Last heartbeat</th><th>Player</th><th>Health</th>
    </tr></thead><tbody>${rows || ""}</tbody></table></div>
    ${rows ? "" : `<div class="empty">${esc(emptyMsg)}</div>`}
    <div class="pager"><span class="pi">Page ${list ? list.page : (st.page || 1)} of ${pages}</span>
      <div class="pb"><button type="button" class="pg" data-dmp="${(st.page || 1) - 1}" ${(st.page || 1) <= 1 ? "disabled" : ""}>‹</button>
      <button type="button" class="pg" data-dmp="${(st.page || 1) + 1}" ${(st.page || 1) >= pages ? "disabled" : ""}>›</button></div></div>
    </div>
    </div>`;
  dmBindShellControls();
  if (prevFocus && $("#" + prevFocus)) {
    try { $("#" + prevFocus).focus(); } catch (_) {}
  }
}
function offlineTimeoutHint() {
  return 90;
}
function dmRegisterModal(onDone) {
  dmBumpInteract(8000);
  const veh = (D.vehicles || []).map(v => `<option value="${esc(v.no)}">${esc(v.no)}</option>`).join("");
  openModal(`<h3>Register advertising device</h3>
    <form id="dmf">
      <label for="dm_name">Device name</label><input id="dm_name" required maxlength="120">
      <label for="dm_type">Device type</label><select id="dm_type"><option>display</option><option>tablet</option><option>android_player</option><option>other</option></select>
      <label for="dm_model">Device model</label><input id="dm_model" maxlength="80">
      <label for="dm_mfr">Manufacturer</label><input id="dm_mfr" maxlength="80">
      <label for="dm_serial">Serial number</label><input id="dm_serial" maxlength="80">
      <label for="dm_hw">Hardware ID</label><input id="dm_hw" maxlength="120">
      <label for="dm_fw">Firmware version</label><input id="dm_fw" maxlength="60">
      <label for="dm_pv">Player software version</label><input id="dm_pv" maxlength="60">
      <label for="dm_plat">Operating system / platform</label><select id="dm_plat"><option>android</option><option>linux</option><option>web</option><option>unknown</option></select>
      <label for="dm_veh">Vehicle number (optional)</label><select id="dm_veh"><option value="">Unassigned</option>${veh}</select>
      <label for="dm_inst">Installation date</label><input id="dm_inst" type="date">
      <label for="dm_notes">Notes</label><input id="dm_notes" maxlength="500">
      <div class="merr" id="merr" role="alert"></div>
      <div class="row"><button type="button" class="btn ghost" id="cx">Cancel</button><button class="btn" id="msave">Register</button></div>
    </form>`);
  $("#cx").onclick = closeModal;
  $("#dmf").onsubmit = async e => {
    e.preventDefault(); $("#msave").disabled = true;
    try {
      const r = await API("POST", "/api/dm/devices", {
        name: $("#dm_name").value.trim(),
        deviceType: $("#dm_type").value,
        deviceModel: $("#dm_model").value.trim() || null,
        manufacturer: $("#dm_mfr").value.trim() || null,
        serialNumber: $("#dm_serial").value.trim() || null,
        hardwareId: $("#dm_hw").value.trim() || null,
        firmwareVersion: $("#dm_fw").value.trim() || null,
        playerVersion: $("#dm_pv").value.trim() || null,
        platform: $("#dm_plat").value,
        vehicleNo: $("#dm_veh").value || null,
        installDate: $("#dm_inst").value || null,
        notes: $("#dm_notes").value.trim()
      });
      closeModal();
      openModal(`<h3>Device registered</h3>
        <p>Lifecycle: <b>${esc(r.device.lifecycleStatus)}</b> (becomes <b>active</b> after player auth)</p>
        <p>Device ID: <code>${esc(r.device.deviceId)}</code></p>
        <p><b>Copy the enrollment secret now</b> — shown only once; never stored in the browser.</p>
        <p><code class="otp-code">${esc(r.credentials.secret)}</code></p>
        <p class="muted">Expires: ${esc(r.credentials.expiresAt || "n/a")} · version ${esc(r.credentials.version)}</p>
        <div class="row"><button class="btn" id="ok">Done</button></div>`);
      $("#ok").onclick = () => { closeModal(); onDone && onDone(); };
      try { await refresh(); } catch (_) { /* ignore */ }
    } catch (err) { $("#merr").textContent = err.message; $("#msave").disabled = false; }
  };
}
async function dmOpenDetail(id, onBack, hint) {
  /* Paint selection immediately — never refetch list / wait on registry before chrome. */
  dmBumpInteract(5000);
  dmState.detailId = id;
  dmState._gen = (dmState._gen || 0) + 1; /* cancel in-flight list soft paints */
  stopDmPoll();
  const label = (hint && (hint.deviceId || hint.name)) ? `${hint.deviceId || ""}${hint.name ? " · " + hint.name : ""}` : "device";
  $("#view").innerHTML = `<div class="bar"><button class="btn ghost" id="dm-back">${ic("back")}Back to list</button><span class="sp"></span></div>
    <div class="card"><p class="muted">Loading ${esc(label)}…</p></div>`;
  if ($("#dm-back")) $("#dm-back").onclick = () => { dmState.detailId = null; onBack && onBack(); };
  let r; try { r = await API("GET", "/api/dm/devices/" + encodeURIComponent(id)); } catch (e) {
    if (dmState.detailId !== id) return;
    dmState.detailId = null;
    $("#view").innerHTML = `<div class="card"><p class="muted">${esc(e.message)}</p><button class="btn ghost" id="dm-back">Back</button></div>`;
    $("#dm-back").onclick = () => { dmState.detailId = null; onBack && onBack(); };
    return;
  }
  if (cur !== "devices" || dmState.detailId !== id) return;
  const d = r.device, cfg = r.config || {}, cred = d.credentials || null;
  const kv = (t, items) => `<div class="sec"><h4>${t}</h4>${items.map(([a, b]) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`).join("")}</div>`;
  const act = (r.activity || []).slice(0, 12).map(a => `<div class="tg"><span>${esc(a.event_type)}<small style="display:block;color:var(--mute)">${esc(a.summary || "")}</small></span><span style="color:var(--mute);font-size:12.5px">${fdt(a.created_at)}</span></div>`).join("") || `<p class="muted">No activity yet.</p>`;
  const asg = (r.assignments || []).slice(0, 8).map(a => `<div class="tg"><span>${esc(a.new_vehicle_no || a.vehicle_no || "—")}${a.previous_vehicle_no ? " ← " + esc(a.previous_vehicle_no) : ""}</span><span style="color:var(--mute);font-size:12.5px">${fdt(a.assigned_at)}${a.unassigned_at ? " → " + fdt(a.unassigned_at) : " (" + esc(a.assignment_status || "active") + ")"}</span></div>`).join("") || `<p class="muted">No assignment history.</p>`;
  const cmds = (r.commands || []).slice(0, 8).map(c => `<div class="tg"><span>${esc(c.commandType)} · ${badge(c.status)}</span><span style="color:var(--mute);font-size:12.5px">${fdt(c.createdAt)}</span></div>`).join("") || `<p class="muted">No commands.</p>`;
  const mnt = (r.maintenance || []).slice(0, 6).map(m => `<div class="tg"><span>${esc(m.reason || "Maintenance")}<small style="display:block;color:var(--mute)">${esc(m.notes || "")}</small></span><span style="color:var(--mute);font-size:12.5px">${fdt(m.started_at)}${m.completed_at ? " → " + fdt(m.completed_at) : " (open)"}</span></div>`).join("") || `<p class="muted">No maintenance history.</p>`;
  const canMut = canAdd("devices");
  const canSens = ["Super Admin", "Admin"].includes(ME.role);
  const isRevoked = d.lifecycleStatus === "revoked";
  $("#view").innerHTML = `<div class="bar"><button class="btn ghost" id="dm-back">${ic("back")}Back to list</button><span class="sp"></span>
    ${canMut && !isRevoked ? `<button class="btn ghost" id="dm-assign">Assign vehicle</button>` : ""}
    ${canMut ? `<button class="btn ghost" id="dm-cfg">Update config</button><button class="btn ghost" id="dm-mnt">Maintenance</button>` : ""}
    ${canSens ? `<button class="btn ghost" id="dm-rot">Rotate credentials</button><button class="btn ghost" id="dm-cmd">Issue command</button><button class="btn ghost" id="dm-sus">Suspend</button><button class="btn ghost" id="dm-rst">Restore</button><button class="btn danger" id="dm-rev">Revoke</button>` : ""}
  </div>
  ${isRevoked ? `<p class="muted">This device is revoked and cannot be assigned. Register a new device instead.</p>` : ""}
  <div class="grid g2">
    <div class="card">${kv("Device information", [
      ["Device ID", `<code>${esc(d.deviceId)}</code>`], ["Name", esc(d.name)], ["Type", esc(d.deviceType)],
      ["Model", esc(d.deviceModel || "—")], ["Manufacturer", esc(d.manufacturer || "—")],
      ["Serial", esc(d.serialNumber || "—")], ["Hardware ID", esc(d.hardwareId || "—")],
      ["Firmware", esc(d.firmwareVersion || "—")], ["Player version", esc(d.playerVersion || d.appVersion || "—")],
      ["Platform", esc(d.platform)], ["Assigned vehicle", esc(d.vehicleNo || "Unassigned")],
      ["Install date", d.installDate ? fdate(d.installDate) : "—"], ["Registered", fdt(d.registeredAt)],
      ["Activated", d.activatedAt ? fdt(d.activatedAt) : "—"], ["Lifecycle", badge(d.lifecycleStatus)], ["Notes", esc(d.notes || "—")]
    ])}
    ${kv("Authentication & credentials", [
      ["Credential version", cred ? esc(cred.version) : "—"],
      ["Created", cred && cred.createdAt ? fdt(cred.createdAt) : "—"],
      ["Last auth", cred && cred.lastAuthAt ? fdt(cred.lastAuthAt) : "Never"],
      ["Expires", cred && cred.expiresAt ? fdt(cred.expiresAt) : "—"],
      ["Secret", "Never shown again after enrollment / rotate"]
    ])}
    ${kv("Connectivity (heartbeat)", [
      ["Connection", badge(d.connectionStatus)], ["Last heartbeat", d.lastHeartbeatAt ? ago(d.lastHeartbeatAt) + " · " + fdt(d.lastHeartbeatAt) : "Never"],
      ["Network", esc(d.networkStatus || "—")], ["App version", esc(d.appVersion || "—")]
    ])}
    ${kv("Player", [
      ["Player status", badge(d.playerStatus || "unknown")],
      ["Last start", d.lastPlayerStartAt ? fdt(d.lastPlayerStartAt) : "—"],
      ["Last stop", d.lastPlayerStopAt ? fdt(d.lastPlayerStopAt) : "—"]
    ])}
    </div>
    <div class="card">
    ${kv("Health & telemetry", [
      ["Health", badge(d.healthStatus || "unknown")],
      ["Battery", d.batteryPct != null ? d.batteryPct + "%" : "Not reported"],
      ["Storage", d.storageFreeMb != null ? d.storageFreeMb + " / " + (d.storageTotalMb != null ? d.storageTotalMb + " MB" : "?") : "Not reported"],
      ["Memory", d.memoryUsedMb != null ? d.memoryUsedMb + (d.memoryTotalMb != null ? " / " + d.memoryTotalMb + " MB" : " MB") : "Not reported"],
      ["Signal", d.signalStrength != null ? esc(d.signalStrength) : "Not reported"],
      ["Temperature", d.temperatureC != null ? d.temperatureC + " °C" : "Not reported"],
      ["Errors", esc(d.errorMessage || d.errorCode || "None")],
      ["Last media sync", d.lastMediaSyncAt ? fdt(d.lastMediaSyncAt) : "—"]
    ])}
    ${kv("Device-reported location", [
      ["Coordinates", d.deviceLat != null ? `${Number(d.deviceLat).toFixed(5)}, ${Number(d.deviceLng).toFixed(5)}` : "Not reported by player"],
      ["Note", "Separate from Live Monitoring phone GPS"]
    ])}
    ${kv("Configuration v" + (cfg.version || 1), [
      ["Orientation", esc(cfg.orientation || "—")],
      ["Resolution", esc(cfg.resolution || "—")],
      ["Heartbeat interval", cfg.heartbeatIntervalSec != null ? cfg.heartbeatIntervalSec + "s" : "default"],
      ["Offline timeout", cfg.offlineTimeoutSec != null ? cfg.offlineTimeoutSec + "s" : "default"],
      ["Updated", cfg.updatedAt ? fdt(cfg.updatedAt) : "—"]
    ])}
    <div class="sec"><h4>Live marker link</h4><div class="kv"><span>marker_dev_id</span><b>${esc(d.markerDevId || "—")}</b></div><p class="muted">Used only for map markers — not proof the screen is online.</p></div>
    </div>
  </div>
  <div class="grid g2" style="margin-top:18px">
    <div class="card"><h3>Activity</h3>${act}<h3 style="margin-top:18px">Maintenance</h3>${mnt}</div>
    <div class="card"><h3>Assignment history</h3>${asg}<h3 style="margin-top:18px">Commands</h3>${cmds}</div>
  </div>`;
  $("#dm-back").onclick = () => { dmState.detailId = null; onBack && onBack(); };
  const openDmAction = (fn) => () => { dmBumpInteract(8000); fn(); };
  const confirmAct = (title, body, run) => {
    openModal(`<h3>${title}</h3><p>${body}</p><div class="merr" id="merr"></div><div class="row"><button class="btn ghost" id="cx">Cancel</button><button class="btn danger" id="ok">Confirm</button></div>`);
    $("#cx").onclick = closeModal;
    $("#ok").onclick = async () => {
      try {
        await run();
        closeModal();
        toast("Done");
        dmOpenDetail(id, onBack, hint);
      } catch (e) { $("#merr").textContent = e.message; }
    };
  };
  if ($("#dm-assign")) $("#dm-assign").onclick = openDmAction(() => {
    const veh = (D.vehicles || []).map(v => `<option value="${esc(v.no)}">${esc(v.no)}</option>`).join("");
    openModal(`<h3>Assign vehicle</h3><label>Vehicle</label><select id="av">${veh}</select><div class="merr" id="merr"></div><div class="row"><button class="btn ghost" id="cx">Cancel</button><button class="btn" id="ok">Assign</button></div>`);
    $("#cx").onclick = closeModal;
    $("#ok").onclick = async () => {
      try {
        await API("POST", `/api/dm/devices/${encodeURIComponent(id)}/assign`, { vehicleNo: $("#av").value });
        closeModal();
        toast("Assigned");
        refresh().catch(() => {});
        dmOpenDetail(id, onBack, hint);
      } catch (e) { $("#merr").textContent = e.message; }
    };
  });
  if ($("#dm-rot")) $("#dm-rot").onclick = openDmAction(() => {
    openModal(`<h3>Rotate credentials?</h3><p>Old credentials will stop working immediately.</p><div class="merr" id="merr"></div><div class="row"><button class="btn ghost" id="cx">Cancel</button><button class="btn danger" id="ok">Rotate</button></div>`);
    $("#cx").onclick = closeModal;
    $("#ok").onclick = async () => {
      try {
        const out = await API("POST", `/api/dm/devices/${encodeURIComponent(id)}/credentials/rotate`, {});
        openModal(`<h3>New credentials</h3><p>Copy secret now:</p><p><code class="otp-code">${esc(out.credentials.secret)}</code></p><div class="row"><button class="btn" id="ok">Done</button></div>`);
        $("#ok").onclick = () => { closeModal(); dmOpenDetail(id, onBack, hint); };
      } catch (e) { $("#merr").textContent = e.message; }
    };
  });
  if ($("#dm-mnt")) $("#dm-mnt").onclick = openDmAction(() => {
    openModal(`<h3>Maintenance</h3><label>Reason</label><input id="mr"><label>Notes</label><input id="mn"><div class="merr" id="merr"></div><div class="row"><button class="btn ghost" id="cx">Cancel</button><button class="btn ghost" id="end">Complete</button><button class="btn" id="ok">Start</button></div>`);
    $("#cx").onclick = closeModal;
    $("#ok").onclick = async () => {
      try {
        await API("POST", `/api/dm/devices/${encodeURIComponent(id)}/maintenance`, { action: "start", reason: $("#mr").value, notes: $("#mn").value });
        closeModal();
        toast("Under maintenance");
        dmOpenDetail(id, onBack, hint);
      } catch (e) { $("#merr").textContent = e.message; }
    };
    $("#end").onclick = async () => {
      try {
        await API("POST", `/api/dm/devices/${encodeURIComponent(id)}/maintenance`, { action: "complete" });
        closeModal();
        toast("Maintenance completed");
        dmOpenDetail(id, onBack, hint);
      } catch (e) { $("#merr").textContent = e.message; }
    };
  });
  if ($("#dm-sus")) $("#dm-sus").onclick = openDmAction(() => confirmAct("Suspend device?", "Device will be rejected on auth/heartbeat until restored.", () => API("POST", `/api/dm/devices/${encodeURIComponent(id)}/suspend`, {})));
  if ($("#dm-rst")) $("#dm-rst").onclick = openDmAction(() => confirmAct("Restore device?", "Returns a suspended device to activated.", () => API("POST", `/api/dm/devices/${encodeURIComponent(id)}/restore`, {})));
  if ($("#dm-rev")) $("#dm-rev").onclick = openDmAction(() => confirmAct("Revoke device?", "Permanent. Credentials are invalidated. History is kept.", () => API("POST", `/api/dm/devices/${encodeURIComponent(id)}/revoke`, {})));
  if ($("#dm-cfg")) $("#dm-cfg").onclick = openDmAction(() => {
    openModal(`<h3>Update configuration</h3>
      <label>Orientation</label><select id="co"><option ${cfg.orientation === "landscape" ? "selected" : ""}>landscape</option><option ${cfg.orientation === "portrait" ? "selected" : ""}>portrait</option></select>
      <label>Resolution</label><input id="cr" value="${esc(cfg.resolution || "")}">
      <label>Heartbeat interval (sec)</label><input id="ch" type="number" min="5" value="${esc(cfg.heartbeatIntervalSec != null ? cfg.heartbeatIntervalSec : 30)}">
      <label>Offline timeout (sec)</label><input id="coff" type="number" min="15" value="${esc(cfg.offlineTimeoutSec != null ? cfg.offlineTimeoutSec : 90)}">
      <div class="merr" id="merr"></div><div class="row"><button class="btn ghost" id="cx">Cancel</button><button class="btn" id="ok">Save</button></div>`);
    $("#cx").onclick = closeModal;
    $("#ok").onclick = async () => {
      try {
        await API("PUT", `/api/dm/devices/${encodeURIComponent(id)}/config`, { orientation: $("#co").value, resolution: $("#cr").value || null, heartbeatIntervalSec: Number($("#ch").value), offlineTimeoutSec: Number($("#coff").value) });
        closeModal();
        toast("Config updated");
        dmOpenDetail(id, onBack, hint);
      } catch (e) { $("#merr").textContent = e.message; }
    };
  });
  if ($("#dm-cmd")) $("#dm-cmd").onclick = openDmAction(() => {
    const types = ["request_status", "sync_media", "refresh_manifest", "update_config", "restart_player", "start_playback", "stop_playback", "suspend_device", "disable_device", "revoke_device"];
    openModal(`<h3>Issue command</h3><label>Type</label><select id="ct">${types.map(t => `<option>${t}</option>`).join("")}</select><p class="muted">Stays Pending/Delivered until the player acknowledges — never shown Completed without ack.</p><div class="merr" id="merr"></div><div class="row"><button class="btn ghost" id="cx">Cancel</button><button class="btn" id="ok">Issue</button></div>`);
    $("#cx").onclick = closeModal;
    $("#ok").onclick = async () => {
      try {
        await API("POST", `/api/dm/devices/${encodeURIComponent(id)}/commands`, { commandType: $("#ct").value });
        closeModal();
        toast("Command issued");
        dmOpenDetail(id, onBack, hint);
      } catch (e) { $("#merr").textContent = e.message; }
    };
  });
}
const stat = (l, v) => `<div class="card stat"><div class="si">${ic(SI[l] || "bars")}</div><div><small>${l}</small><strong>${v}</strong></div></div>`;

/* ---------- Modal ---------- */
let lastFocus;
function openModal(html) { lastFocus = document.activeElement; $("#modal").innerHTML = html; $("#mbg").classList.add("on"); const i = $("#modal input,#modal select,#modal button"); if (i) i.focus(); }
function closeModal() { $("#mbg").classList.remove("on"); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
$("#mbg").addEventListener("mousedown", e => { if (e.target.id === "mbg") closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") { closeModal(); closeDrawer(); } });

function formModal(k, row) {
  const s = S[k], isNew = !row, hid = PORTAL === "client" ? (FORMHIDE[k] || []) : [];
  const fields = s.f.filter(f => f[2] !== "ago" && !hid.includes(f[0])).map(([key, label, type]) => {
    let val = row ? row[key] : (s.def && s.def[key]) ?? ""; if (!row && key === "date") val = today();
    const opts = typeof type === "function" ? type() : type;
    const optional = isOptional(k, key);
    const req = optional ? "" : "required";
    const ph = optional ? ' placeholder="Required for live OTP unless assigned partner has a phone"' : "";
    if (Array.isArray(opts)) return `<label for="f_${key}">${label}</label><select id="f_${key}" name="${key}" ${req}>${isNew && !val ? `<option value="">Select…</option>` : ""}${opts.map(o => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    if (type === "password") return `<label for="f_${key}">${label}</label><input id="f_${key}" name="${key}" type="password" autocomplete="new-password" ${isNew ? "required" : ""} minlength="6" placeholder="${isNew ? "Minimum 6 characters" : "Leave blank to keep current"}">`;
    return `<label for="f_${key}">${label}</label><input id="f_${key}" name="${key}" type="${type === "money" ? "number" : type || "text"}" ${type === "money" ? 'min="0" step="1"' : ""} value="${esc(val)}" ${req}${ph}>`;
  }).join("");
  openModal(`<h3>${isNew ? s.add : "Edit record"}</h3><form id="mf">${fields}<div class="merr" id="merr" role="alert"></div><div class="row"><button type="button" class="btn ghost" id="cx">Cancel</button><button class="btn" id="msave">${isNew ? "Add" : "Save"}</button></div></form>`);
  $("#cx").onclick = closeModal;
  $("#mf").onsubmit = async e => {
    e.preventDefault();
    const o = {};
    s.f.forEach(([key, , type]) => { const el = e.target.elements[key]; if (!el) return; let v = el.value.trim(); if (type === "password" && !v) return; o[key] = type === "money" ? Number(v) : v; });
    $("#msave").disabled = true;
    try {
      await API(isNew ? "POST" : "PUT", isNew ? `/api/${k}` : `/api/${k}/${row.id}`, o);
      await refresh(); closeModal(); toast(isNew ? "Added successfully" : "Changes saved"); if (isNew) P[k].page = 1; go(cur);
    } catch (err) { $("#merr").textContent = err.message; $("#msave").disabled = false; }
  };
}
function confirmDelete(k, row) {
  openModal(`<h3>Delete record?</h3><p>"${esc(row[S[k].f[0][0]])}" will be removed permanently.</p><div class="merr" id="merr"></div><div class="row"><button class="btn ghost" id="cx">Cancel</button><button class="btn danger" id="ok">Delete</button></div>`);
  $("#cx").onclick = closeModal;
  $("#ok").onclick = async () => { try { await API("DELETE", `/api/${k}/${row.id}`); await refresh(); closeModal(); toast("Deleted"); go(cur); } catch (err) { $("#merr").textContent = err.message; } };
}
async function setStatus(k, r, status) {
  const o = {}; S[k].f.forEach(f => { if (f[2] !== "password" && f[2] !== "ago") o[f[0]] = r[f[0]]; }); o.status = status;
  try { await API("PUT", `/api/${k}/${r.id}`, o); await refresh(); toast("Marked " + status.toLowerCase()); go(cur); } catch (e) { toast(e.message); }
}

/* ---------- Detail drawer (opens when a row is clicked) ---------- */
const relList = (t, items) => `<div class="sec"><h4>${t}</h4>${items.length ? items.map(([a, b]) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`).join("") : `<p class="muted">Nothing linked yet.</p>`}</div>`;
const REL = {
  users: r => relList("Recent activity", D.audit.filter(a => a.user === r.name).slice(0, 6).map(a => [esc(a.action), fdt(a.at)])),
  advertisers: r => { const cs = D.campaigns.filter(c => c.adv === r.name), paid = D.billing.filter(b => b.adv === r.name && b.status === "Paid" && b.type !== "Payouts").reduce((a, b) => a + b.amount, 0); return relList("Summary", [["Campaigns", cs.length], ["Total paid", inr(paid)]]) + relList("Campaigns", cs.map(c => [esc(c.name), badge(c.status)])); },
  partners: r => { const v = D.vehicles.find(x => x.no === r.vehicle), d = D.devices.find(x => x.vehicle === r.vehicle); return relList("Assigned vehicle", v ? [["Vehicle no.", esc(v.no)], ["Area", esc(v.area)], ["Vehicle status", badge(v.status)]] : []) + relList("Device", d ? [["Device ID", esc(d.dev)], ["Status", badge(d.status)], ["Last seen", ago(d.lastSeenAt)]] : []); },
  vehicles: r => relList("Driver / partner", D.partners.filter(x => x.vehicle === r.no).map(x => [esc(x.name), esc(x.phone)])) + relList("Devices", D.devices.filter(x => x.vehicle === r.no).map(x => [esc(x.dev), badge(x.status)])),
  devices: r => { const v = D.vehicles.find(x => x.no === r.vehicle) || {}; return relList("Vehicle", [["Owner", esc(v.owner || "-")], ["Home area", esc(v.area || "-")]]) + relList("Last known location", [["Coordinates", `${Number(r.lat).toFixed(4)}, ${Number(r.lng).toFixed(4)}`]]) + `<button class="btn ghost" id="dl">${ic("pin")}View on live map</button>`; },
  campaigns: r => relList("Schedule", [["Duration", Math.max(1, Math.round((pd(r.end) - pd(r.start)) / 864e5) + 1) + " days"], ["Devices online now", r.status === "Approved" ? D.devices.filter(d => d.status === "Online").length : 0]])
};
function openDetail(k, id) {
  const r = D[k].find(x => x.id === id); if (!r) return;
  const s = S[k], main = r[s.f[0][0]];
  const rows = vis(k).map(f => `<div class="kv"><span>${f[1]}</span><b>${cell(f, r)}</b></div>`).join("") + `<div class="kv"><span>Record ID</span><b>${k === "support" ? "#" + (1000 + r.id) : "#" + r.id}</b></div>` + (r.created ? `<div class="kv"><span>Created</span><b>${fdate(r.created)}</b></div>` : "");
  $("#drawer").innerHTML = `<div class="dh"><div class="nm"><span class="ini lg">${esc(initials(main))}</span><div>${esc(main)}<small>${title(k)}</small></div></div><button class="ib" id="dx" aria-label="Close details">${ic("x")}</button></div>
  <div class="db">${r.status ? `<div style="margin-bottom:16px">${badge(r.status)}</div>` : ""}<div class="sec"><h4>Details</h4>${rows}</div>${REL[k] && PORTAL === "admin" ? REL[k](r) : ""}</div>
  <div class="df">${PORTAL === "admin" && k === "advertisers" ? `<button class="btn" id="dv">${ic("eye")}View client portal</button>` : ""}${canRow(k, r) ? `<button class="btn ghost" id="de">${ic("edit")}Edit</button><button class="btn danger" id="dd">${ic("trash")}Delete</button>` : ""}</div>`;
  $("#drawer").classList.add("on"); $("#dback").classList.add("on"); $("#dx").focus();
  $("#dx").onclick = closeDrawer;
  if ($("#dv")) $("#dv").onclick = () => { closeDrawer(); openClientView(r.id, k); };
  if ($("#de")) $("#de").onclick = () => { closeDrawer(); formModal(k, r); };
  if ($("#dd")) $("#dd").onclick = () => { closeDrawer(); confirmDelete(k, r); };
  if ($("#dl")) $("#dl").onclick = () => { closeDrawer(); liveSel = r.id; go("live"); };
}
function closeDrawer() { $("#drawer").classList.remove("on"); $("#dback").classList.remove("on"); }
$("#dback").onclick = closeDrawer;

/* ---------- Generic table view ---------- */
const P = Object.fromEntries(Object.keys(S).map(k => [k, { q: "", tab: 0, page: 1 }]));
function csv(k) {
  const cols = vis(k), rows = [cols.map(f => f[1]), ...D[k].map(r => cols.map(f => f[2] === "ago" ? r.lastSeenAt : r[f[0]]))];
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" })); a.download = k + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 500);
  toast("Exported " + k + ".csv");
}
function table(k) {
  const s = S[k], st = P[k], cols = vis(k), showAct = (!s.ro && !VIEW && (PORTAL === "client" ? k === "campaigns" : canAdd(k))) || (PORTAL === "admin" && k === "advertisers");
  const rows = D[k].filter(r => {
    const t = s.tabs && (s.tabsOnly || st.tab > 0) ? r[s.tabKey] === s.tabs[st.tab] : true;
    return t && JSON.stringify(Object.values(r)).toLowerCase().includes(st.q.toLowerCase());
  });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); st.page = Math.min(st.page, pages);
  const part = rows.slice((st.page - 1) * PAGE, st.page * PAGE), idf = r => k === "support" ? "#" + (1000 + r.id) : r.id;
  $("#view").innerHTML = `${s.tabs ? `<div class="tabs">${s.tabs.map((t, i) => `<button data-tab="${i}" class="${i === st.tab ? "on" : ""}">${t}${s.tabKey === "status" && t !== "All" ? ` (${D[k].filter(r => r.status === t).length})` : ""}</button>`).join("")}</div>` : ""}
  <div class="bar"><div class="sb">${ic("search")}<input id="q" placeholder="Search ${title(k).toLowerCase()}…" value="${esc(st.q)}" aria-label="Search"></div><span class="sp"></span>${s.export ? `<button class="btn ghost" id="exp">${ic("download")}Export CSV</button>` : ""}${canAdd(k) ? `<button class="btn" id="add">${ic("plus")}${s.add}</button>` : ""}</div>
  <div class="card tcard"><div class="ch"><h3>${title(k)}</h3><span>${rows.length} record${rows.length === 1 ? "" : "s"}${s.ro ? "" : " · click a row for details"}</span></div><div class="tw"><table><thead><tr><th>ID</th>${cols.map(f => `<th>${f[1]}</th>`).join("")}${showAct ? "<th>Actions</th>" : ""}</tr></thead><tbody>
  ${part.map(r => `<tr data-id="${r.id}" tabindex="0"><td data-label="ID">${idf(r)}</td>${cols.map((f, j) => `<td data-label="${f[1]}">${j === 0 && AV.includes(k) ? `<div class="nm"><span class="ini">${esc(initials(r[f[0]]))}</span>${esc(r[f[0]])}</div>` : cell(f, r)}</td>`).join("")}${showAct ? `<td data-label="Actions"><div class="act">${PORTAL === "admin" && k === "advertisers" ? `<button class="ib" data-v="${r.id}" aria-label="View client portal" title="View client portal (view-only)">${ic("eye")}</button>` : ""}${canRow(k, r) ? `<button class="ib" data-e="${r.id}" aria-label="Edit" title="Edit">${ic("edit")}</button><button class="ib d" data-d="${r.id}" aria-label="Delete" title="Delete">${ic("trash")}</button>` : ""}</div></td>` : ""}</tr>`).join("")}
  </tbody></table></div>${part.length ? "" : `<div class="empty">No records found.</div>`}
  <div class="pager"><span class="pi">Showing ${rows.length ? (st.page - 1) * PAGE + 1 : 0}–${Math.min(st.page * PAGE, rows.length)} of ${rows.length}</span><div class="pb"><button class="pg" data-p="${st.page - 1}" aria-label="Previous page" ${st.page <= 1 ? "disabled" : ""}>‹</button>${Array.from({ length: pages }, (_, i) => `<button class="pg ${i + 1 === st.page ? "on" : ""}" data-p="${i + 1}">${i + 1}</button>`).join("")}<button class="pg" data-p="${st.page + 1}" aria-label="Next page" ${st.page >= pages ? "disabled" : ""}>›</button></div></div></div>`;
  $("#q").oninput = e => { st.q = e.target.value; st.page = 1; const pos = e.target.selectionStart; table(k); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); };
  if ($("#add")) $("#add").onclick = () => formModal(k);
  if ($("#exp")) $("#exp").onclick = () => csv(k);
  const rec = id => D[k].find(r => String(r.id) === String(id));
  $("#view").onclick = e => {
    const b = e.target.closest("button");
    if (b) {
      if (b.dataset.tab) { st.tab = +b.dataset.tab; st.page = 1; table(k); }
      else if (b.dataset.p) { st.page = +b.dataset.p; table(k); }
      else if (b.dataset.v) openClientView(Number(b.dataset.v), k);
      else if (b.dataset.e) formModal(k, rec(b.dataset.e));
      else if (b.dataset.d) confirmDelete(k, rec(b.dataset.d));
      return;
    }
    const tr = e.target.closest("tr[data-id]"); if (tr) openDetail(k, Number(tr.dataset.id));
  };
  $("#view").onkeydown = e => { if (e.key === "Enter" && e.target.matches && e.target.matches("tr[data-id]")) openDetail(k, Number(e.target.dataset.id)); };
}

/* ---------- Charts (monochrome) ---------- */
function line(vals, labels) {
  const w = 420, h = 170, m = 26, mx = Math.max(1, ...vals) * 1.1, p = vals.map((v, i) => [m + i * (w - m - 8) / Math.max(1, vals.length - 1), h - 20 - v / mx * (h - 30)]);
  const d = p.map((a, i) => (i ? "L" : "M") + a[0] + "," + a[1]).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Revenue trend"><path d="${d}L${p[p.length - 1][0]},${h - 20}L${p[0][0]},${h - 20}Z" fill="var(--c1)" opacity=".08"/><path d="${d}" fill="none" stroke="var(--c1)" stroke-width="2.5"/>${p.map(a => `<circle cx="${a[0]}" cy="${a[1]}" r="3.5" fill="var(--surface)" stroke="var(--c1)" stroke-width="2"/>`).join("")}${labels.map((l, i) => `<text x="${p[i][0]}" y="${h - 4}" font-size="10" text-anchor="middle" fill="var(--mute)">${l}</text>`).join("")}</svg>`;
}
function donut(parts, center) {
  const tot = parts.reduce((a, p) => a + p[1], 0), R = 48, C = 2 * Math.PI * R; let a = 0;
  const seg = tot ? parts.map(([, v, c]) => { const s = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${c}" stroke-width="22" stroke-dasharray="${v / tot * C} ${C}" stroke-dashoffset="${-a / tot * C}" transform="rotate(-90 70 70)"/>`; a += v; return s; }).join("") : `<circle r="${R}" cx="70" cy="70" fill="none" stroke="var(--c3)" stroke-width="22"/>`;
  return `<svg viewBox="0 0 140 140" width="150" role="img" aria-label="Chart">${seg}${center ? `<text x="70" y="75" text-anchor="middle" font-size="18" font-weight="700" fill="var(--ink)">${center}</text>` : ""}</svg>`;
}
const legend = parts => `<div class="lg" style="flex-direction:column">${parts.map(([n, v, c]) => `<span><i style="background:${c}"></i>${n} · ${v}</span>`).join("")}</div>`;
const COL = ["var(--c1)", "var(--c2)", "var(--c3)"];

/* ---------- Live monitoring (Phase 2: poll /api/live — markers move without refresh) ---------- */
let liveTimer = null, map = null, markers = {}, trails = {}, trailLine = null, liveSel = null, LIVE = [];
let liveFilter = "all", liveMeta = { simDisabled: false, onlineThresholdMs: 90_000, stream: true, at: 0 };
/** CP-56: poll often enough that setLatLng tracks Nest GPS posts; animate between points. */
const LIVE_POLL_MS = 1000;
const LIVE_MOVE_MS = 900;
const markerAnim = {};
const agoLive = v => {
  const s = Math.floor((Date.now() - new Date(v)) / 1000);
  if (isNaN(s) || s < 0) return "-";
  if (s < 5) return "Just now";
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  const h = Math.floor(s / 3600);
  return h < 24 ? h + " hr ago" : Math.floor(h / 24) + " d ago";
};
const hasCoords = d => d.lat != null && d.lng != null && Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lng));
const liveLabel = d => d.autoNumber || d.vehicle || d.dev;
/** Presence from CMS GPS online/stale; never invent “live” from sim when simDisabled. */
function livePresence(d) {
  if (d.source === "device_gps") {
    if (d.online) return "Online";
    if (d.stale) return "Stale";
    return "Offline";
  }
  if (d.source === "device_location" && d.online) return "Online";
  if (d.source === "sim") return liveMeta.simDisabled ? "Awaiting GPS" : "Sim";
  if (d.status === "Online" && !d.autoNumber) return "Awaiting GPS";
  return d.status === "Online" ? "Online" : "Offline";
}
function liveBadge(d) {
  const p = livePresence(d);
  const cls = p === "Online" ? "ok" : (p === "Stale" || p === "Sim" || p === "Awaiting GPS") ? "warn" : "bad";
  return `<span class="b ${cls}">${esc(p)}</span>`;
}
function mkIcon(d, sel) {
  const p = livePresence(d);
  const kind = p === "Online" ? "Online" : p === "Stale" ? "Stale" : p === "Sim" ? "Sim" : "Offline";
  return L.divIcon({ className: "mk " + kind + (sel ? " sel" : ""), html: "<span></span>", iconSize: [24, 24], iconAnchor: [12, 12] });
}
function filteredLive() {
  if (liveFilter === "cms") return LIVE.filter(d => d.source === "device_gps");
  return LIVE;
}
function onLiveVisibility() {
  if (document.visibilityState === "visible" && cur === "live") pollLive(false);
}
function stopLive() {
  clearInterval(liveTimer); liveTimer = null;
  document.removeEventListener("visibilitychange", onLiveVisibility);
  Object.keys(markerAnim).forEach(id => {
    if (markerAnim[id] && markerAnim[id].raf) cancelAnimationFrame(markerAnim[id].raf);
    delete markerAnim[id];
  });
  if (map) { map.remove(); map = null; }
  markers = {}; trails = {}; trailLine = null;
}
function selectDev(id) {
  liveSel = id == null ? null : String(id);
  trailLine && map && map.removeLayer(trailLine); trailLine = null;
  const d = LIVE.find(x => String(x.id) === liveSel);
  if (d && map && hasCoords(d)) map.panTo([Number(d.lat), Number(d.lng)], { animate: true, duration: 0.4 });
  drawLive();
}
/** Smoothly slide marker to new GPS fix (CP-56). */
function animateMarkerTo(id, marker, lat, lng) {
  const key = String(id);
  const cur = marker.getLatLng();
  const fromLat = cur.lat, fromLng = cur.lng;
  if (Math.abs(fromLat - lat) < 1e-7 && Math.abs(fromLng - lng) < 1e-7) {
    marker.setLatLng([lat, lng]);
    return;
  }
  const prev = markerAnim[key];
  if (prev && prev.raf) cancelAnimationFrame(prev.raf);
  const started = performance.now();
  const step = now => {
    const t = Math.min(1, (now - started) / LIVE_MOVE_MS);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    marker.setLatLng([fromLat + (lat - fromLat) * e, fromLng + (lng - fromLng) * e]);
    if (t < 1) {
      markerAnim[key] = { raf: requestAnimationFrame(step), to: [lat, lng] };
    } else {
      marker.setLatLng([lat, lng]);
      delete markerAnim[key];
    }
  };
  markerAnim[key] = { raf: requestAnimationFrame(step), to: [lat, lng] };
}
function drawLive() {
  if (cur !== "live" || !$("#ll")) return;
  const list = filteredLive();
  const cmsOnline = LIVE.filter(d => d.source === "device_gps" && d.online).length;
  const cmsTotal = LIVE.filter(d => d.source === "device_gps").length;

  if (map) {
    const keep = new Set(list.filter(hasCoords).map(d => String(d.id)));
    Object.keys(markers).forEach(id => {
      if (!keep.has(String(id))) {
        if (markerAnim[id] && markerAnim[id].raf) cancelAnimationFrame(markerAnim[id].raf);
        delete markerAnim[id];
        map.removeLayer(markers[id]);
        delete markers[id];
      }
    });
    list.forEach(d => {
      if (!hasCoords(d)) return;
      const id = String(d.id);
      const lat = Number(d.lat), lng = Number(d.lng);
      const presence = livePresence(d);
      const key = presence + (id === liveSel) + (d.source || "");
      let m = markers[id];
      const tip = (d.autoNumber ? d.autoNumber + " · " : "") + d.dev;
      if (!m) {
        m = L.marker([lat, lng], { icon: mkIcon(d, id === liveSel) }).addTo(map).bindTooltip(tip);
        m.on("click", () => selectDev(id));
        markers[id] = m;
        m._k = key;
        m._pos = lat + "," + lng;
      } else {
        const posKey = lat + "," + lng;
        if (m._pos !== posKey) {
          animateMarkerTo(id, m, lat, lng);
          m._pos = posKey;
          // Keep selected auto in view as the phone moves
          if (id === liveSel) {
            try { map.panTo([lat, lng], { animate: true, duration: 0.85, easeLinearity: 0.25 }); } catch (_) { /* ignore */ }
          }
        }
        m.setTooltipContent(tip);
        if (m._k !== key) { m.setIcon(mkIcon(d, id === liveSel)); m._k = key; }
      }
    });
    const trailKey = liveSel != null ? String(liveSel) : null;
    if (trailKey && trails[trailKey] && trails[trailKey].length) {
      if (!trailLine) trailLine = L.polyline([], { color: "#0a0a0a", weight: 3, dashArray: "4 6" }).addTo(map);
      trailLine.setLatLngs(trails[trailKey]);
    } else if (trailLine) {
      map.removeLayer(trailLine); trailLine = null;
    }
  }

  const streamHint = liveMeta.simDisabled ? "Real GPS only" : "Live";
  $("#lc").innerHTML = `<span class="pulse"></span>${esc(streamHint)} · ${cmsOnline}/${cmsTotal} CMS online · ${new Date(liveMeta.at || Date.now()).toLocaleTimeString("en-IN")}`;

  const sel = LIVE.find(d => String(d.id) === String(liveSel));
  if (sel) {
    const acc = sel.accuracyM != null && Number.isFinite(Number(sel.accuracyM))
      ? Number(sel.accuracyM).toFixed(1) + " m"
      : "—";
    const coords = hasCoords(sel)
      ? Number(sel.lat).toFixed(5) + ", " + Number(sel.lng).toFixed(5)
      : "—";
    const rows = [
      ["Auto number", sel.autoNumber || "—"],
      ["Device", sel.dev],
      ["Vehicle", sel.vehicle],
      ["Presence", livePresence(sel)],
      ["Coordinates", coords],
      ["Accuracy", acc],
      ["Speed", (sel.speed != null ? sel.speed : 0) + " km/h"],
      ["Last updated", sel.lastUpdated ? agoLive(sel.lastUpdated) : "—"],
      ["Source", sel.source || "—"],
      ["Near", sel.near || "—"],
      ["Now playing", sel.ad || "Idle"],
      ["Ad media", sel.adMediaUrl || "—"]
    ];
    $("#ld").innerHTML = rows.map(([a, b]) => `<div class="kv"><span>${a}</span><b>${esc(b)}</b></div>`).join("");
  } else {
    $("#ld").innerHTML = `<p class="muted">Select a device on the map or list. CMS GPS markers move automatically (poll ${LIVE_POLL_MS / 1000}s).</p>`;
  }

  const sc = $("#ll").scrollTop;
  if (!list.length) {
    $("#ll").innerHTML = `<div class="empty live-empty">${liveFilter === "cms"
      ? "No CMS GPS fixes yet — awaiting device_gps from Display PWA."
      : "No devices to show."}</div>`;
  } else {
    $("#ll").innerHTML = list.map(d => {
      const sub = [
        d.dev,
        hasCoords(d) ? Number(d.lat).toFixed(4) + ", " + Number(d.lng).toFixed(4) : null,
        d.lastUpdated ? agoLive(d.lastUpdated) : null
      ].filter(Boolean).join(" · ");
      return `<button class="li ${String(d.id) === String(liveSel) ? "sel" : ""}" data-id="${esc(String(d.id))}" type="button"><div><b>${esc(liveLabel(d))}</b><small>${esc(sub)}</small></div>${liveBadge(d)}</button>`;
    }).join("");
  }
  $("#ll").scrollTop = sc;

  const fAll = $("#lf-all"), fCms = $("#lf-cms");
  if (fAll && fCms) {
    fAll.classList.toggle("on", liveFilter === "all");
    fCms.classList.toggle("on", liveFilter === "cms");
  }
}
async function pollLive(first) {
  try {
    const r = await API("GET", "/api/live");
    if (cur !== "live") return;
    liveMeta = {
      simDisabled: !!r.simDisabled,
      onlineThresholdMs: Number(r.onlineThresholdMs) || 90_000,
      stream: r.stream !== false,
      at: r.at || Date.now()
    };
    LIVE = Array.isArray(r.devices) ? r.devices : [];
    LIVE.forEach(d => {
      if (!hasCoords(d)) return;
      if (d.source === "sim" && liveMeta.simDisabled) return;
      const lat = Number(d.lat), lng = Number(d.lng);
      const tid = String(d.id);
      const t = trails[tid] = trails[tid] || [];
      const last = t[t.length - 1];
      if (!last || last[0] !== lat || last[1] !== lng) {
        t.push([lat, lng]);
        if (t.length > 60) t.shift();
      }
    });
    drawLive();
    if (first && map) {
      const pts = filteredLive().filter(hasCoords).map(d => [Number(d.lat), Number(d.lng)]);
      if (pts.length) map.fitBounds(pts, { padding: [40, 40] });
    }
  } catch (e) { /* retry on next tick */ }
}

/* ---------- Views ---------- */
const V = {
  dashboard() { return PORTAL === "client" ? V.clientHome() : V.adminHome(); },
  adminHome() {
    const c = D.campaigns, by = s => c.filter(x => x.status === s).length, canEdit = canAdd("campaigns");
    const parts = [["Running", by("Approved"), COL[0]], ["Pending", by("Pending"), COL[1]], ["Rejected", by("Rejected"), COL[2]]];
    const rev = D.billing.filter(b => b.status === "Paid" && b.type !== "Payouts").reduce((a, b) => a + b.amount, 0);
    const months = [], now = new Date();
    for (let i = 6; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ k: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"), l: d.toLocaleString("en-IN", { month: "short" }), v: 0 }); }
    D.billing.filter(b => b.status === "Paid" && b.type !== "Payouts").forEach(b => { const m = months.find(x => b.date.startsWith(x.k)); if (m) m.v += b.amount; });
    const pend = c.filter(x => x.status === "Pending");
    $("#view").innerHTML = `<div class="hero"><div><h3>Welcome back, ${esc(ME.name.split(" ")[0])}</h3><p>${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · Here is your platform overview.</p></div><div class="row">${canEdit ? `<button class="btn light" id="hbtn">${ic("plus")}New campaign</button>` : ""}<button class="btn light" id="hcl">${ic("eye")}View client logins</button></div></div>
    <div class="grid g4">${stat("Revenue (paid)", inr(rev))}${stat("Total campaigns", c.length)}${stat("Active devices", D.devices.filter(x => x.status === "Online").length + " / " + D.devices.length)}${stat("Active partners", D.partners.filter(x => x.status === "Active").length)}</div>
    <div class="grid g2" style="margin-top:18px"><div class="card"><h3>Revenue by month (₹ thousands)</h3>${line(months.map(m => Math.round(m.v / 1000)), months.map(m => m.l))}</div>
    <div class="card"><h3>Campaign status</h3><div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">${donut(parts, c.length ? Math.round(parts[0][1] / c.length * 100) + "%" : "0%")}${legend(parts)}</div></div></div>
    <div class="grid g2" style="margin-top:18px"><div class="card"><h3>Pending approvals</h3>${pend.length ? pend.slice(0, 5).map(x => `<div class="pend"><div><b>${esc(x.name)}</b><small>${esc(x.adv)} · ${fdate(x.start)}</small></div>${canEdit ? `<div class="row"><button class="btn ghost" data-q="${x.id}" data-s="Rejected">Reject</button><button class="btn" data-q="${x.id}" data-s="Approved">Approve</button></div>` : badge(x.status)}</div>`).join("") : `<p class="muted">No campaigns waiting for approval.</p>`}</div>
    <div class="card"><h3>Recent activity</h3>${D.audit.slice(0, 6).map(a => `<div class="tg"><span>${esc(a.action)}<small style="display:block;color:var(--mute)">${esc(a.user)}</small></span><span style="color:var(--mute);font-size:12.5px">${fdt(a.at)}</span></div>`).join("")}</div></div>`;
    if ($("#hbtn")) $("#hbtn").onclick = () => { go("campaigns"); formModal("campaigns"); };
    $("#hcl").onclick = () => go("clientlogins");
    $("#view").onclick = e => { const b = e.target.closest("button[data-q]"); if (b) setStatus("campaigns", D.campaigns.find(x => x.id === Number(b.dataset.q)), b.dataset.s); };
  },
  clientHome() {
    const c = D.campaigns, by = s => c.filter(x => x.status === s).length, paid = D.billing.filter(b => b.status === "Paid").reduce((a, b) => a + b.amount, 0);
    const parts = [["Approved", by("Approved"), COL[0]], ["Pending", by("Pending"), COL[1]], ["Rejected", by("Rejected"), COL[2]]];
    $("#view").innerHTML = `<div class="hero"><div><h3>Welcome, ${esc(VIEW ? VIEW.name : ME.name)}</h3><p>Launch campaigns and track their approval status.</p></div>${VIEW ? "" : `<button class="btn light" id="hbtn">${ic("plus")}New campaign</button>`}</div>
    <div class="grid g4">${stat("My campaigns", c.length)}${stat("Approved", by("Approved"))}${stat("Pending review", by("Pending"))}${stat("Total paid", inr(paid))}</div>
    <div class="grid g2" style="margin-top:18px"><div class="card"><h3>Campaign status</h3><div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">${donut(parts, c.length)}${legend(parts)}</div></div>
    <div class="card"><h3>Recent campaigns</h3>${c.slice(0, 5).map(x => `<div class="pend"><div><b>${esc(x.name)}</b><small>${fdate(x.start)} – ${fdate(x.end)}</small></div>${badge(x.status)}</div>`).join("") || `<p class="muted">You have no campaigns yet.</p>`}</div></div>`;
    if ($("#hbtn")) $("#hbtn").onclick = () => { go("campaigns"); formModal("campaigns"); };
  },
  async clientlogins() {
    $("#view").innerHTML = `<div class="card"><p class="muted">Loading client logins…</p></div>`;
    let r; try { r = await API("GET", "/api/client-logins"); } catch (e) { $("#view").innerHTML = `<div class="card"><p class="muted">${esc(e.message)}</p></div>`; return; }
    if (cur !== "clientlogins") return;
    const today0 = new Date(); today0.setHours(0, 0, 0, 0); const recent = r.history.filter(l => new Date(l.at) >= today0).length;
    $("#view").innerHTML = `<div class="grid g4">${stat("Clients", r.clients.length)}${stat("Logins today", recent)}${stat("Total logins", r.clients.reduce((a, c) => a + c.loginCount, 0))}${stat("Never logged in", r.clients.filter(c => !c.lastLogin).length)}</div>
    <div class="card tcard" style="margin-top:18px"><div class="ch"><h3>Client accounts</h3><span>${r.clients.length} clients · open any client's portal view-only, without leaving your admin session</span></div><div class="tw"><table><thead><tr><th>Client</th><th>Login email</th><th>Status</th><th>Last login</th><th>Total logins</th><th>Actions</th></tr></thead><tbody>
    ${r.clients.map(c => `<tr><td data-label="Client"><div class="nm"><span class="ini">${esc(initials(c.name))}</span>${esc(c.name)}</div></td><td data-label="Login email">${esc(c.email)}</td><td data-label="Status">${badge(c.status)}</td><td data-label="Last login">${c.lastLogin ? esc(fdt(c.lastLogin)) + " · " + ago(c.lastLogin) : "Never"}</td><td data-label="Total logins">${c.loginCount}</td><td data-label="Actions"><button class="btn ghost" data-va="${c.id}">${ic("eye")}View portal</button></td></tr>`).join("")}
    </tbody></table></div></div>
    <div class="card tcard" style="margin-top:18px"><div class="ch"><h3>Recent client sign-ins</h3><span>Latest ${r.history.length}</span></div><div class="tw"><table><thead><tr><th>Client</th><th>Email</th><th>Date &amp; time</th><th>IP address</th></tr></thead><tbody>
    ${r.history.map(l => `<tr><td data-label="Client">${esc(l.name)}</td><td data-label="Email">${esc(l.email)}</td><td data-label="Date & time">${esc(fdt(l.at))} · ${ago(l.at)}</td><td data-label="IP address">${esc(l.ip)}</td></tr>`).join("")}
    </tbody></table></div>${r.history.length ? "" : `<div class="empty">No client has signed in yet.</div>`}</div>`;
    $("#view").onclick = e => { const b = e.target.closest("button[data-va]"); if (b) openClientView(Number(b.dataset.va), "clientlogins"); };
  },
  async live() {
    liveFilter = "all";
    $("#view").innerHTML = `<div class="live"><div class="card lp"><div class="ch"><h3>Fleet</h3><span id="lc"></span></div><div class="lf" role="group" aria-label="Live filter"><button type="button" class="btn ghost on" id="lf-all">All devices</button><button type="button" class="btn ghost" id="lf-cms">CMS GPS only</button></div><div class="ld" id="ld"></div><div class="ll" id="ll"></div></div><div class="card mp"><div id="map"></div></div></div>`;
    if (window.L) {
      map = L.map("map").setView([12.9352, 77.6245], 12);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);
      setTimeout(() => map && map.invalidateSize(), 100);
    } else $("#map").innerHTML = `<div class="empty">The map library could not load. Check your internet connection. Live positions still update in the list.</div>`;
    $("#ll").onclick = e => { const b = e.target.closest(".li"); if (b) selectDev(b.dataset.id); };
    $("#lf-all").onclick = () => { liveFilter = "all"; drawLive(); };
    $("#lf-cms").onclick = () => { liveFilter = "cms"; drawLive(); };
    document.addEventListener("visibilitychange", onLiveVisibility);
    await pollLive(true);
    if (cur === "live") liveTimer = setInterval(() => pollLive(false), LIVE_POLL_MS);
  },
  /* Device Management (player heartbeat — separate from Live phone GPS) */
  async devices(opts) {
    if (PORTAL !== "admin") {
      $("#view").innerHTML = `<div class="card"><p class="muted">Device Management is admin-only.</p></div>`;
      return;
    }
    ensureDmDelegation();
    /* opts may be the nav key string from go(k) — only { soft: true } is soft. */
    const soft = !!(opts && typeof opts === "object" && opts.soft);
    const fromPoll = !!(opts && typeof opts === "object" && opts.poll);
    /* Poll redraws yield while the user is mid-click / modal open. */
    if (fromPoll && dmIsInteracting()) return;
    const st = dmState;
    const hasShell = !!$("#dm-shell");
    /* First entry: paint interactive shell immediately — never a full-page loading wall. */
    if (!soft && !hasShell) {
      stopDmPoll();
      paintDmShell(st, st._cacheOverview, null, { pending: true });
    } else if (!soft) {
      stopDmPoll();
      if ($("#dm-live")) $("#dm-live").textContent = "Updating…";
    } else if (!fromPoll && $("#dm-live") && !($("#dm-live").textContent || "").startsWith("Live") && !($("#dm-live").textContent || "").startsWith("Updating")) {
      $("#dm-live").textContent = "Refreshing…";
    }

    /* Soft filter clicks cancel an in-flight fetch via gen bump — never block filters. */
    const gen = (dmState._gen = (dmState._gen || 0) + 1);
    /* Snapshot filter/query at request start so a newer click wins via gen, not stale paint. */
    const reqFilter = st.filter || "all";
    const reqQ = st.q || "";
    const reqPage = st.page || 1;
    const reqVehicle = st.vehicle || "";

    let overview = null, list = null, err = null;
    try {
      const qs = new URLSearchParams({
        filter: reqFilter,
        q: reqQ,
        page: String(reqPage),
        pageSize: "8",
        sort: "registeredAt",
        dir: "desc"
      });
      if (reqVehicle) qs.set("vehicle", reqVehicle);
      const listUrl = "/api/dm/devices?" + qs.toString();
      /* Soft path: paint from devices list ASAP; reuse cached overview (refresh in background). */
      if (soft && st._cacheOverview) {
        overview = st._cacheOverview;
        list = await API("GET", listUrl);
        if (cur === "devices" && gen === dmState._gen && !dmState.detailId) {
          API("GET", "/api/dm/overview").then(ov => {
            if (cur !== "devices" || dmState.detailId) return;
            dmState._cacheOverview = ov;
            if ($("#dm-shell")) dmPatchOverviewStats(ov);
          }).catch(() => {});
        }
      } else {
        const [ov, ls] = await Promise.all([
          API("GET", "/api/dm/overview"),
          API("GET", listUrl)
        ]);
        overview = ov;
        list = ls;
      }
    } catch (e) {
      err = (e && e.message) || String(e);
    }

    if (cur !== "devices" || gen !== dmState._gen || dmState.detailId) return;
    if (fromPoll && dmIsInteracting()) return;

    if (err) {
      if (soft && $("#dm-live")) {
        $("#dm-live").textContent = "Live · refresh error — will retry";
        dmMarkFilterTabs(st.filter || "all");
        return;
      }
      $("#view").innerHTML = `<div class="card" id="dm-shell"><p class="muted">${esc(err)}</p>
        <p class="muted">Check Admin is serving <code>/api/dm/overview</code> (standalone) or <code>/admin-api/dm/overview</code> (integrated). Hard-refresh after restarting Admin.</p>
        <button type="button" class="btn ghost" id="dm-retry">Retry</button></div>`;
      if ($("#dm-retry")) $("#dm-retry").onclick = () => V.devices({ force: true });
      return;
    }
    if (!overview || !list) {
      if (soft) {
        dmMarkFilterTabs(st.filter || "all");
        return;
      }
      $("#view").innerHTML = `<div class="card" id="dm-shell"><p class="muted">Empty Device Management response. Retry.</p>
        <button type="button" class="btn ghost" id="dm-retry">Retry</button></div>`;
      if ($("#dm-retry")) $("#dm-retry").onclick = () => V.devices({ force: true });
      return;
    }

    try {
      /* Keep list state aligned with what we actually fetched. */
      st.filter = reqFilter;
      st.q = reqQ;
      st.page = reqPage;
      st.vehicle = reqVehicle;
      st._cacheOverview = overview;
      if (soft && $("#dm-shell")) {
        patchDmShell(st, overview, list);
      } else {
        paintDmShell(st, overview, list, { pending: false });
      }
      if (!soft || !dmPollTimer) startDmLivePoll();
    } catch (renderErr) {
      $("#view").innerHTML = `<div class="card" id="dm-shell"><p class="muted">Device list render failed: ${esc(renderErr && renderErr.message ? renderErr.message : renderErr)}</p>
        <button type="button" class="btn ghost" id="dm-retry">Retry</button></div>`;
      if ($("#dm-retry")) $("#dm-retry").onclick = () => V.devices({ force: true });
    }
  },
  analytics() {
    const r = V.range || 30, f = r / 30, ap = D.campaigns.filter(c => c.status === "Approved"), imp = ap.length * 1.7 * f;
    const paid = D.billing.filter(b => b.status === "Paid" && b.type !== "Payouts").reduce((a, b) => a + b.amount, 0);
    const parts = ap.slice(0, 3).map((c, i) => [esc(c.name), [45, 30, 25][i], COL[i]]), v = [40, 55, 38, 62, 70, 48, 80, 66, 90, 58, 75, 84];
    $("#view").innerHTML = `<div class="bar"><select id="rg" style="max-width:180px;margin:0" aria-label="Date range">${[7, 30, 90].map(x => `<option value="${x}" ${x === r ? "selected" : ""}>Last ${x} days</option>`).join("")}</select></div>
    <div class="grid g4">${stat("Impressions", imp.toFixed(1) + "M")}${stat("Clicks", Math.round(imp * 53) + "K")}${stat("CTR", "5.3%")}${stat("Revenue", inr(Math.round(paid * f / 3)))}</div>
    <div class="grid g2" style="margin-top:18px"><div class="card"><h3>Performance overview</h3><svg viewBox="0 0 420 160" width="100%" role="img" aria-label="Impressions">${v.map((x, i) => `<rect x="${14 + i * 34}" y="${150 - x / 90 * 130}" width="22" height="${x / 90 * 130}" rx="3" fill="var(--c1)" opacity="${i % 2 ? .45 : 1}"/>`).join("")}</svg></div>
    <div class="card"><h3>Top campaigns</h3>${parts.length ? `<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">${donut(parts)}${legend(parts)}</div>` : `<p class="muted">No approved campaigns yet.</p>`}</div></div>`;
    $("#rg").onchange = e => { V.range = Number(e.target.value); V.analytics(); };
  },
  async delivery() {
    $("#view").innerHTML = `<div class="card"><p class="muted">Loading advertiser campaigns and device assignments…</p></div>`;
    try {
      const result = await API("GET", "/api/campaign-delivery");
      const campaigns = result.campaigns || [];
      const canReview = ME.role !== "Viewer" && !VIEW;
      const stats = result.totals || {};
      $("#view").innerHTML = `      <div class="grid g4">${stat("Selected vehicles", stats.selectedVehicles || 0)}${stat("Successfully assigned to CMS queue", stats.assignedDevices || 0)}${stat("Pending assignments", stats.pendingAssignments || 0)}${stat("Failed assignments", stats.failedAssignments || 0)}</div>
      <div class="card tcard" style="margin-top:18px"><div class="ch"><h3>Advertiser campaign approvals and delivery</h3><span>${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}</span></div>
      <div class="tw"><table><thead><tr><th>Campaign</th><th>Advertiser</th><th>Approval</th><th>Vehicles</th><th>Devices assigned</th><th>Pending</th><th>Failed</th><th>Schedule</th><th>Actions</th></tr></thead><tbody>
      ${campaigns.map(c => `<tr><td><b>${esc(c.name)}</b><details style="margin-top:6px"><summary>Vehicle / screen assignments (${(c.assignments || []).length})</summary><div style="min-width:380px;padding:8px 0">${(c.assignments || []).map(a => `<div class="tg"><span><b>${esc(a.vehicleNo || "Vehicle")}</b><small style="display:block">${esc(a.deviceId || "Device")} · screen ${esc(a.screenId || "-")}</small>${a.lastError ? `<small style="display:block;color:#b42318">${esc(a.lastError)}</small>` : ""}</span><span>${badge(a.status)}${canReview && a.status === "failed" && a.retryable ? ` <button class="btn ghost" data-retry="${esc(a.id)}">Retry</button>` : ""}</span></div>`).join("") || `<span class="muted">No device assignments yet.</span>`}</div></details></td>
      <td>${esc(c.advertiser || "-")}</td><td>${badge(c.status)}</td><td>${c.selectedVehicles || 0} / ${c.autosBooked || 0}</td><td>${c.assignedDevices || 0}</td><td>${c.pendingAssignments || 0}</td><td>${c.failedAssignments || 0}</td>
      <td>${esc(c.startDate || "-")} – ${esc(c.endDate || "-")}<small style="display:block">${esc(c.startTime || "")} – ${esc(c.endTime || "")}</small></td>
      <td>${canReview && c.status === "Pending Approval" ? `<div class="row"><button class="btn" data-approve="${esc(c.id)}">Approve & assign</button><button class="btn ghost" data-reject="${esc(c.id)}">Reject</button></div>` : "—"}</td></tr>`).join("")}
      </tbody></table></div>${campaigns.length ? "" : `<div class="empty">No advertiser campaigns found.</div>`}</div>`;
      $("#view").onclick = async event => {
        const button = event.target.closest("button[data-approve],button[data-reject],button[data-retry]");
        if (!button) return;
        try {
          if (button.dataset.approve) {
            const done = await API("POST", `/api/campaign-delivery/${encodeURIComponent(button.dataset.approve)}/approve`, {});
            toast(`Approved; ${done.selectedVehicles} vehicle(s) targeted.`);
          } else if (button.dataset.reject) {
            await API("POST", `/api/campaign-delivery/${encodeURIComponent(button.dataset.reject)}/reject`, { reason: "Rejected by administrator" });
            toast("Campaign rejected.");
          } else {
            await API("POST", `/api/campaign-delivery/${encodeURIComponent(button.dataset.retry)}/retry`, {});
            toast("Delivery retry scheduled.");
          }
          await V.delivery();
        } catch (error) {
          toast(error.message);
        }
      };
    } catch (error) {
      $("#view").innerHTML = `<div class="card"><h3>Campaign delivery unavailable</h3><p class="muted">${esc(error.message)}</p><button class="btn" id="delivery-reload">Retry</button></div>`;
      $("#delivery-reload").onclick = () => V.delivery();
    }
  },
  async cmsotp() {
    let pending = [], delivery = "Admin dashboard OTP inbox", err = null;
    try {
      const r = await API("GET", "/api/cms/otp/pending");
      pending = r.pending || [];
      delivery = r.delivery || delivery;
    } catch (e) {
      err = e.message || "Failed to load OTP inbox";
    }
    const rows = pending.length
      ? pending.map(p => {
          const left = Math.max(0, Math.round((Date.parse(p.expiresAt) - Date.now()) / 1000));
          return `<tr>
            <td><b>${esc(p.autoNumber)}</b><div class="muted">${esc(p.maskedMobile || "")}</div></td>
            <td><code class="otp-code" style="font-size:1.25rem;letter-spacing:.12em">${esc(p.otp || "••••••")}</code>
              <button type="button" class="btn ghost" data-copy="${esc(p.otp || "")}" ${p.otp ? "" : "disabled"}>Copy</button></td>
            <td>${left}s · ${esc(new Date(p.expiresAt).toLocaleTimeString("en-IN"))}</td>
          </tr>`;
        }).join("")
      : `<tr><td colspan="3" class="muted">No pending CMS OTPs. When an operator looks up an Auto Number in CMS, the code appears here.</td></tr>`;
    $("#view").innerHTML = `<div class="card">
      <div class="ch"><h3>CMS OTP Inbox</h3>
        <button type="button" class="btn ghost" id="otp-refresh">${ic("radio")}Refresh</button></div>
      <p class="muted">Channel: <b>Admin dashboard</b> (no SMS provider). Read the 6-digit code to the vehicle operator, or send it manually. Codes expire in ~5 minutes.</p>
      <p class="muted">${esc(delivery)}</p>
      ${err ? `<p class="bad">${esc(err)}</p>` : ""}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Auto Number</th><th>OTP</th><th>Expires</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
    $("#otp-refresh").onclick = () => V.cmsotp();
    $("#view").querySelectorAll("[data-copy]").forEach(b => {
      b.onclick = async () => {
        const v = b.getAttribute("data-copy") || "";
        if (!v) return;
        try {
          await navigator.clipboard.writeText(v);
          toast("OTP copied");
        } catch (_) {
          toast("Copy failed — select the code manually");
        }
      };
    });
  },
  settings() {
    const s = D.settings, su = ME.role === "Super Admin";
    $("#view").innerHTML = `<div class="grid g2"><form class="card" id="sf"><h3>Platform information</h3><label for="s1">Platform name</label><input id="s1" value="${esc(s.name)}" required><label for="s2">Contact email</label><input id="s2" type="email" value="${esc(s.email)}" required><label for="s3">Timezone</label><select id="s3">${["Asia/Kolkata", "UTC", "Asia/Dubai", "Europe/London"].map(z => `<option ${z === s.tz ? "selected" : ""}>${z}</option>`).join("")}</select><button class="btn">Save changes</button></form>
    <div class="card"><h3>Security settings</h3><div class="tg"><span>Two-factor authentication</span><input type="checkbox" id="t1" ${s.tfa ? "checked" : ""}></div><div class="tg"><span>Login notifications</span><input type="checkbox" id="t2" ${s.notify ? "checked" : ""}></div>${su ? `<div class="tg"><span>Reset all demo data</span><button class="btn danger" id="rs" type="button">Reset</button></div>` : ""}</div></div>`;
    const put = async (o, msg) => { try { D.settings = await API("PUT", "/api/settings", o); toast(msg); } catch (e) { toast(e.message); } };
    $("#sf").onsubmit = e => { e.preventDefault(); put({ name: $("#s1").value, email: $("#s2").value, tz: $("#s3").value }, "Settings saved"); };
    $("#t1").onchange = e => put({ tfa: e.target.checked }, "Two-factor " + (e.target.checked ? "on" : "off"));
    $("#t2").onchange = e => put({ notify: e.target.checked }, "Login notifications " + (e.target.checked ? "on" : "off"));
    if (su) $("#rs").onclick = () => { openModal(`<h3>Reset demo data?</h3><p>All records will be replaced with the original sample data.</p><div class="row"><button class="btn ghost" id="cx">Cancel</button><button class="btn danger" id="ok">Reset</button></div>`); $("#cx").onclick = closeModal; $("#ok").onclick = async () => { try { await API("POST", "/api/reset"); await refresh(); closeModal(); toast("Data reset"); go("dashboard"); } catch (e) { toast(e.message); } }; };
  }
};

/* ---------- Shell, navigation and auth ---------- */
function renderNav() {
  const pend = D.campaigns.filter(c => c.status === "Pending").length, open = PORTAL === "admin" ? D.support.filter(t => t.status === "Open").length : 0, cnt = { campaigns: pend, support: open };
  $("#side").innerHTML = `<div class="logo"><i>▶</i><span>AdTech Platform</span></div>` + GROUPS[PORTAL].map(([g, ks]) => `<div class="sg">${g}</div>` + ks.map(k => `<button class="nv ${k === cur ? "on" : ""}" data-k="${k}" title="${title(k)}">${ic(ICON[k])}<span>${title(k)}</span>${cnt[k] ? `<em class="cnt">${cnt[k]}</em>` : ""}</button>`).join("")).join("") + `<div class="sfoot"><div class="suser"><div class="av">${esc(initials(ME.name))}</div><div class="ut"><b>${esc(ME.name)}</b><small>${esc(ME.role)}</small></div></div><button class="nv" id="out" title="Logout">${ic("logout")}<span>Logout</span></button></div>`;
  $("#bd").style.display = pend + open ? "block" : "none";
  $("#crumb").textContent = VIEW ? "Admin / Client view: " + VIEW.name + " / " + title(cur) : (PORTAL === "admin" ? "Admin" : "Client") + " / " + title(cur);
}
function go(k) {
  stopLive(); stopDmPoll(); dmState.detailId = null; closeDrawer();
  cur = k; $("#title").textContent = title(k); renderNav();
  $("#view").onclick = null; $("#view").onkeydown = null;
  /* Do not pass k into V.devices — a string arg used to look like opts and confuse soft/hard. */
  if (typeof V[k] === "function") V[k]();
  else table(k);
  closeMenu(); $("#view").scrollTop = 0;
}
const closeMenu = () => { $("#side").classList.remove("open"); $("#back").classList.remove("on"); };
function showScreen(n) { $("#landing").style.display = n === "landing" ? "flex" : "none"; $("#app").classList.toggle("on", n === "app"); }
function syncChrome() {
  const cv = $("#cview"); cv.style.display = ME.portal === "admin" && !VIEW ? "" : "none"; cv.innerHTML = `${ic("eye")}<span>Client portal</span>`; cv.onclick = clientPicker;
  const bar = $("#impbar"); bar.classList.toggle("on", !!VIEW);
  bar.innerHTML = VIEW ? `${ic("eye")}<span>Client portal view: <b>${esc(VIEW.name)}</b>${VIEW.status !== "Approved" ? " (" + esc(VIEW.status) + ")" : ""} · View-only · You are still signed in as <b>${esc(ME.name)}</b> (${esc(ME.role)})</span><button class="btn light" id="impx">Back to admin</button>` : "";
  if ($("#impx")) $("#impx").onclick = exitClientView;
}
function clientPicker() {
  openModal(`<h3>View a client's portal</h3><p>Opens the client's dashboard in view-only mode. You stay signed in as admin.</p><div class="cvl">${D.advertisers.map(a => `<button data-va="${a.id}"><span><b>${esc(a.name)}</b><small>${esc(a.email)} · ${esc(a.status)}</small></span>${ic("eye")}</button>`).join("") || `<p class="muted">No clients yet.</p>`}</div><div class="row"><button class="btn ghost" id="cx">Close</button><button class="btn" id="cgo">Open Client Logins</button></div>`);
  $("#cx").onclick = closeModal; $("#cgo").onclick = () => { closeModal(); go("clientlogins"); };
  $("#modal").querySelectorAll("[data-va]").forEach(b => { b.onclick = () => { closeModal(); openClientView(Number(b.dataset.va), cur); }; });
}
/* Admin previews a client's portal. The admin's token, identity and session are never touched:
   the server returns a read-only snapshot of that client's data and the UI renders the client views from it. */
async function openClientView(id, from) {
  if (ME.portal !== "admin") return;
  try {
    const r = await API("GET", "/api/client-view/" + id);
    if (!VIEW) ADMIN_D = D;
    const data = Object.fromEntries(Object.keys(S).map(k => [k, []])); Object.assign(data, r.data);
    VIEW = { ...r.client, from: VIEW ? VIEW.from : from }; D = data; PORTAL = "client";
    closeDrawer(); syncChrome(); go("dashboard");
  } catch (e) { toast(e.message); }
}
async function exitClientView() {
  const back = VIEW ? VIEW.from : "dashboard"; VIEW = null; PORTAL = "admin"; D = ADMIN_D || D; ADMIN_D = null;
  try { await refresh(); } catch (e) { return; }
  syncChrome(); go(back && (V[back] || S[back]) ? back : "dashboard");
}
function applyBootstrap(r) {
  ME = r.me; PORTAL = ME.portal; META.areas = r.areas || []; D = r.data || {};
  Object.keys(S).forEach(k => { D[k] = D[k] || []; });
}
async function enter(boot) {
  if (boot && boot.data) applyBootstrap(boot);
  else await refresh();
  if (!ME) throw new Error("Sign in required");
  cur = "dashboard"; VIEW = null; ADMIN_D = null;
  $("#un").textContent = ME.name; $("#ue").textContent = ME.email; $("#uav").textContent = initials(ME.name);
  syncChrome();
  showScreen("app");
  go("dashboard");
}
function logout() {
  token = null; VIEW = null; ADMIN_D = null; PORTAL = "admin"; try { localStorage.removeItem(TK); } catch (e) { /* ignore */ }
  const bar = $("#impbar"); if (bar) bar.classList.remove("on");
  stopLive(); closeDrawer(); closeModal(); closeMenu(); ME = null; D = {}; showScreen("landing");
}
document.querySelectorAll("[data-ic]").forEach(el => el.insertAdjacentHTML("afterbegin", ic(el.dataset.ic)));
document.querySelectorAll(".lc").forEach(f => {
  f.onsubmit = async e => {
    e.preventDefault(); const btn = f.querySelector(".btn"), err = f.querySelector(".merr"); btn.disabled = true; err.textContent = "";
    try {
      btn.textContent = "Signing in…";
      const r = await API("POST", "/api/login", { email: f.elements.email.value, password: f.elements.password.value, portal: f.dataset.portal });
      token = r.token; try { localStorage.setItem(TK, token); } catch (x) { /* ignore */ }
      await enter(r);
    } catch (x) { err.textContent = x.message; } finally { btn.disabled = false; btn.textContent = "Sign in as Admin"; }
  };
});
$("#side").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.id === "out") logout(); else if (b.dataset.k) go(b.dataset.k);
};
$("#menu").onclick = () => { $("#side").classList.toggle("open"); $("#back").classList.toggle("on"); };
$("#back").onclick = closeMenu;
$("#collapse").onclick = () => document.body.classList.toggle("collapsed");
$("#bell").onclick = () => go(PORTAL === "admin" ? "support" : "campaigns");
const toggleTheme = () => { const r = document.documentElement, n = r.dataset.theme === "dark" ? "light" : "dark"; r.dataset.theme = n; try { localStorage.setItem("adtech-theme", n); } catch (e) { /* ignore */ } };
$("#theme").onclick = toggleTheme; $("#theme0").onclick = toggleTheme;
const fit = () => document.body.classList.toggle("collapsed", innerWidth > 760 && innerWidth <= 1100);
addEventListener("resize", fit); fit();

/* Always show the login page on open. Do not auto-enter from a saved token. */
token = null;
try { localStorage.removeItem(TK); } catch (e) { /* ignore */ }
showScreen("landing");


}