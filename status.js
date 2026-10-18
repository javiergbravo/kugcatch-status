"use strict";
const MONITOR = "javiergbravo/kugcatch-uptime";
const SUMMARY = `https://raw.githubusercontent.com/${MONITOR}/master/history/summary.json`;
const HEARTBEAT = `https://api.github.com/repos/${MONITOR}/actions/workflows/uptime.yml/runs?status=success&per_page=1`;
const MAX_AGE_MS = 30 * 60 * 1000;
const REFRESH_MS = 5 * 60 * 1000;
const COMPONENTS = new Map([["review-pipeline", "Review pipeline"], ["portal", "Portal"]]);
let lastCheck = null;
let sites = null;
let refreshing = false;
let incidentsKnown = false;
let incidentOpen = false;
const displayed = new Map();

function show(id, lines) {
  const key = JSON.stringify(lines);
  if (displayed.get(id) === key) return;
  displayed.set(id, key);
  document.getElementById(id).replaceChildren(...lines.map((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }));
}
function fresh() {
  const age = Date.now() - lastCheck;
  return Number.isFinite(lastCheck) && age >= -5 * 60 * 1000 && age <= MAX_AGE_MS;
}
function renderChecks() {
  if (!sites || !fresh()) {
    show("checks", ["Automatic checks unavailable or stale: no verified check within 30 minutes. Status unknown."]);
  } else {
    const checked = new Date(lastCheck).toISOString().slice(0, 16).replace("T", " ");
    show("checks", sites.map((site) => `${COMPONENTS.get(site.slug)}: ${site.status === "up" ? "responding" : "not responding"} (last check ${checked} UTC; liveness only)`));
  }
  document.title = incidentOpen ? "KugCatch Status — incident open"
    : !incidentsKnown || !sites || !fresh() ? "KugCatch Status — unknown"
    : "KugCatch Status — liveness checks";
}
async function load(url) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10000);
  try {
    const response = await fetch(url, { cache: "no-store", signal: abort.signal });
    if (!response.ok) throw new Error("unavailable");
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
function renderIncidents(data) {
  const states = new Set(["investigating", "identified", "monitoring", "resolved"]);
  if (!data || !Array.isArray(data.incidents) || data.incidents.length > 100) throw new Error("invalid incidents");
  for (const item of data.incidents) {
    if (!item || !states.has(item.state) || typeof item.title !== "string" || typeof item.component !== "string"
      || !Array.isArray(item.updates) || item.updates.length > 100) throw new Error("invalid incident");
    if (item.updates.some((u) => !u || typeof u.time !== "string" || typeof u.text !== "string")) throw new Error("invalid update");
  }
  const open = data.incidents.filter((i) => i.state !== "resolved");
  // Active incidents always appear before resolved history, even if the input is misordered.
  const history = data.incidents.filter((i) => i.state === "resolved").slice(0, Math.max(0, 10 - open.length));
  const ordered = [...open, ...history];
  const lines = ordered.flatMap((item) => [
    `${item.component.slice(0, 100)} — ${item.state}: ${item.title.slice(0, 300)}`,
    ...item.updates.slice(0, 10).map((u) => `${u.time.slice(0, 40)} — ${u.text.slice(0, 1000)}`),
  ]);
  show("incidents", lines.length ? lines : ["No incidents published. This does not confirm service availability."]);
  incidentsKnown = true;
  incidentOpen = open.length > 0;
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [incidentResult, checkResult] = await Promise.allSettled([
      load("incidents.json").then(renderIncidents),
      Promise.all([load(HEARTBEAT), load(SUMMARY)]).then(([runs, summary]) => {
        const run = runs?.workflow_runs?.[0];
        const checked = Date.parse(run?.updated_at || "");
        if (run?.conclusion !== "success" || run?.head_branch !== "master" || !Number.isFinite(checked)) throw new Error("invalid heartbeat");
        if (!Array.isArray(summary) || summary.length !== COMPONENTS.size
          || new Set(summary.map((s) => s?.slug)).size !== COMPONENTS.size
          || summary.some((s) => !COMPONENTS.has(s?.slug) || !["up", "down", "degraded"].includes(s?.status))) throw new Error("invalid summary");
        lastCheck = checked;
        sites = summary;
      }),
    ]);
    if (incidentResult.status === "rejected") {
      incidentsKnown = false;
      show("incidents", ["Incident list unavailable. Incident status unknown."]);
    }
    if (checkResult.status === "rejected") {
      lastCheck = null;
      sites = null;
    }
    renderChecks();
  } finally {
    refreshing = false;
  }
}
refresh();
setInterval(refresh, REFRESH_MS);
// Expire an already displayed success without waiting for another fetch or a page reload.
setInterval(renderChecks, 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    renderChecks();
    refresh();
  }
});
