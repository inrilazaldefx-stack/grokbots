/* Grok Bots client. Renders only what /api/snapshot returns; every string is escaped. */
"use strict";
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
// id, name, colour, glyph path (24x24 stroke)
const BOTS = [
  ["general", "General", "#f5c451", "M12 3.5l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.2l-5.1 2.7 1.1-5.6-4.2-3.9 5.7-.7z"],
  ["x_scout", "X Scout", "#60a5fa", "M6 5l12 14M18 5L6 19"],
  ["wallet_tracker", "Wallet Tracker", "#a78bfa", "M4 7.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 7.5l11-3v3M16 13h1.5"],
  ["market_scanner", "Market Scanner", "#2dd4bf", "M7 3v18M17 3v18M5 7h4v8H5zM15 9h4v5h-4z"],
  ["security", "Security", "#fb7185", "M12 3l7.5 3v5.5c0 4.6-3.2 7.9-7.5 9.5-4.3-1.6-7.5-4.9-7.5-9.5V6zM9 12l2.2 2.2L15.5 10"],
  ["executor_governor", "Executer", "#4ade80", "M13.5 2.5L5 13.5h6l-1 8 8.5-11h-6z"],
  ["journal", "Logger", "#fb923c", "M6.5 3h10.5a1 1 0 0 1 1 1v17H7.5A2 2 0 0 1 5.5 19V4a1 1 0 0 1 1-1zM9 8h6M9 12h6M9 16h3.5"],
];
const BOTC = Object.fromEntries(BOTS.map(b => [b[0], b]));
BOTC.control = ["control", "Control", "#9aa5a0", "M12 4v7M7.5 7.5a6.5 6.5 0 1 0 9 0"];
const glyph = id => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${(BOTC[id] || BOTC.control)[3]}"/></svg>`;
const usd = (x, d=2) => (typeof x === "number" && isFinite(x)) ? (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d}) : "—";
const sgn = x => typeof x === "number" ? (x > 0 ? "+" : "") : "";
const short = m => (m && m.length > 10) ? m.slice(0,4) + "…" + m.slice(-4) : (m || "?");
const tz = {timeZone:"America/New_York"};
const tET = s => s ? new Date(s).toLocaleTimeString("en-US", {...tz, hour:"numeric", minute:"2-digit"}) : "";
const dtET = s => s ? new Date(s).toLocaleString("en-US", {...tz, month:"short", day:"numeric", hour:"numeric", minute:"2-digit"}) + " ET" : "—";
const ago = s => { if (!s) return "never"; const d = (Date.now() - new Date(s)) / 1000;
  if (d < 60) return Math.max(0, Math.round(d)) + "s ago"; if (d < 3600) return Math.round(d/60) + "m ago";
  if (d < 86400) return Math.round(d/3600) + "h ago"; return Math.round(d/86400) + "d ago"; };
const toneOf = v => ({PASS:"good", APPROVE:"good", filled:"good", closed:"good", FAIL:"bad", REJECT:"bad", skipped_by_governor:"warn", failed:"bad", STALE:"warn", WATCH:"warn"}[v] || "");

let S = null, view = "command", feedFilter = "all", busy = false;

// Transport: same-origin server on the box, or (phone PWA build) the encrypted relay in relay.js.
const T = window.GB_TRANSPORT || null;
async function api(path, opts={}) {
  if (T) return T.api(path);
  const r = await fetch(path, {credentials:"same-origin", cache:"no-store", ...opts});
  if (r.status === 401) { location.href = "/login"; throw new Error("auth"); }
  if (!r.ok) throw new Error("http " + r.status);
  return r.json();
}

let clockOffset = 0;   // server clock minus browser clock, so the countdown matches the supervisor
async function refresh() {
  try {
    const t0 = Date.now(); S = await api("/api/snapshot");
    clockOffset = T ? 0 : new Date(S.generated_at) - (t0 + Date.now()) / 2;   // relay snapshots are minutes old by design
    setConn(true); render();
  }
  catch (e) { if (e.message !== "auth") setConn(false); }
}
function setConn(ok) {
  const c = $("#conn");
  if (T) { const st = T.conn(); c.textContent = st.label; c.className = "chip conn " + st.tone; return; }
  c.textContent = ok ? "LIVE" : "OFFLINE"; c.className = "chip conn " + (ok ? "ok" : "bad");
}

function render() {
  renderCrew(); renderRun(); renderSitrep(); renderCommand(); renderMini(); renderDesk(); renderBots(); renderFeed(); renderKills(); renderTrades(); renderRuns(); renderRules();
  styleDyn(document);
}
// CSP forbids inline style attributes, so dynamic widths/colours are applied through the CSSOM.
function styleDyn(root) {
  root.querySelectorAll("[data-w]").forEach(el => { el.style.width = el.dataset.w + "%"; });
  root.querySelectorAll("[data-bg]").forEach(el => { el.style.background = `linear-gradient(150deg, ${el.dataset.bg}, ${el.dataset.bg}b3)`; });
  root.querySelectorAll("[data-fg]").forEach(el => { el.style.color = el.dataset.fg; });
  root.querySelectorAll("[data-top]").forEach(el => { el.style.top = el.dataset.top + "%"; });
  root.querySelectorAll("[data-c]").forEach(el => { el.style.background = el.dataset.c + "1f"; el.style.color = el.dataset.c; });
}

const svcsOf = id => (S && S.supervisor && S.supervisor.by_bot && S.supervisor.by_bot[id]) || [];
const botLive = id => svcsOf(id).some(x => x.state === "running" || x.state === "external");
const mmss = n => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
function secsLeft() {
  const rs = S && S.run_state; if (!rs || rs.state !== "running" || !rs.run_until) return 0;
  return Math.max(0, Math.round((new Date(rs.run_until) - (Date.now() + clockOffset)) / 1000));
}
function avatar(id, dot, cls = "") {
  const b = BOTC[id] || BOTC.control;
  return `<div class="ava ${cls}" data-bg="${b[2]}" title="${esc(b[1])}">${glyph(id)}${dot != null ? `<span class="dot ${dot}"></span>` : ""}</div>`;
}
function renderCrew() {
  const el = $("#crew");
  el.innerHTML = BOTS.map(b => avatar(b[0], botLive(b[0]) ? "live" : "idle", "sm")).join("");
  styleDyn(el);
}
const STOP_TXT = {stopped_by_inri: "stopped by you", run_until_reached: "finished its hour", supervisor_stopped: "supervisor stopped"};
function renderRun() {
  if (!S) return;
  const rs = S.run_state, left = secsLeft(), running = rs.state === "running" && left > 0;
  $("#runCard").className = "runcard " + (running ? "running" : "idle");
  $("#runState").textContent = running ? "Running" : "Paused";
  $("#runClock").textContent = running ? mmss(left) : "60:00";
  const total = rs.started_at && rs.run_until ? (new Date(rs.run_until) - new Date(rs.started_at)) / 1000 : 3600;
  const bar = $("#runBar"); bar.style.width = (running ? Math.min(100, 100 * (1 - left / total)) : 0) + "%";
  let meta;
  if (running) meta = `Run ${esc(String(rs.run_id || "").slice(0, 8))} · started ${esc(tET(rs.started_at))} · ends ${esc(tET(rs.run_until))} ET`;
  else if (rs.default || !rs.run_id) meta = "No run yet. Everything is paused.";
  else meta = `Last run ${esc(STOP_TXT[rs.stop_reason] || (rs.expired ? "finished its hour" : "paused"))} · ${esc(dtET(rs.changed_at))}`;
  const sup = S.supervisor || {};
  if (!sup.supervisor_alive) meta += ` <span class="warnTxt">· Supervisor offline: Start writes the switch, but no bot gets launched.</span>`;
  $("#runMeta").innerHTML = meta;
  $("#startBtn").disabled = running || busy; $("#stopBtn").disabled = !running || busy;
  $("#startBtn").textContent = running ? `Running · ${mmss(left)} left` : "Start 1-hour run";
  const cd = $("#cdChip"); cd.textContent = running ? mmss(left) : "idle"; cd.className = "chip cd" + (running ? " on" : "");
}

function renderSitrep() {
  const c = S.counts, p = S.portfolio, rs = S.run_state.state;
  const nLive = BOTS.filter(b => botLive(b[0])).length;
  let s;
  if (S.empty) s = `<b>Standing by.</b> Waiting for the first candidate in the shared store. Security has logged ${c.security_checks_logged} check${c.security_checks_logged===1?"":"s"} on its own so far.`;
  else s = `<b>${rs === "running" ? `On patrol · ${nLive}/7 bots live.` : "Paused."}</b> ${c.scanned} scanned · ${c.approved} approved · ${c.traded} traded · ${p.open_count} open.`;
  if (p.drawdown_pct != null && p.drawdown_halt_pct && p.drawdown_pct >= p.drawdown_halt_pct) s += ` <b class="neg">Drawdown halt level reached.</b>`;
  $("#sitrep").innerHTML = s;
}

let range = "all";
const SPAN = {"1h": 3600e3, "1d": 864e5, "1w": 6048e5};
function renderChart(p) {
  const W = 320, H = 120, el = $("#chart"), lbl = $("#chartLbl");
  const start = typeof p.start_usd === "number" ? p.start_usd : null;
  if (start == null) { el.innerHTML = ""; lbl.innerHTML = `<div class="cl wait">run config missing</div>`; return; }
  const goal = (p.goal && p.goal.target_usd) || 2 * start;
  const pts = (p.equity_curve || []).filter(x => x.t).map(x => ({t: +new Date(x.t), y: x.equity, k: x.kind}));
  const now = Date.now() + clockOffset;
  const y = v => v;
  if (!pts.length) {   // nothing traded yet: flat line at the start balance, nothing invented
    el.innerHTML = `<line x1="0" y1="70" x2="${W}" y2="70" class="ln flat"/><line x1="0" y1="14" x2="${W}" y2="14" class="ln goal"/>`;
    lbl.innerHTML = `<div class="cl base" data-top="${(70 / H * 100).toFixed(1)}">${usd(start, 0)} start</div>` +
      `<div class="cl goalc" data-top="${(14 / H * 100).toFixed(1)}">${usd(goal, 0)} goal</div><div class="cl wait" data-top="40">waiting for first trade</div>`;
    $("#chartNote").textContent = "no fills or closes yet";
    styleDyn(lbl); return;
  }
  const t1 = now, t0 = SPAN[range] ? now - SPAN[range] : Math.min(pts[0].t, now - 60e3);
  let before = start; for (const q of pts) if (q.t < t0) before = q.y;
  const win = [{t: t0, y: before}, ...pts.filter(q => q.t >= t0 && q.t <= t1)];
  if (win[win.length - 1].t < t1) win.push({t: t1, y: win[win.length - 1].y});
  const ys = win.map(q => q.y).concat([start]);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = Math.max((hi - lo) * 0.18, start * 0.004); lo -= pad; hi += pad;
  const goalIn = goal <= hi;
  const X = t => ((t - t0) / Math.max(1, t1 - t0)) * W, Y = v => H - 8 - ((v - lo) / (hi - lo)) * (H - 22);
  const d = win.map((q, i) => `${i ? "L" : "M"}${X(q.t).toFixed(1)},${Y(q.y).toFixed(1)}`).join("");
  const last = win[win.length - 1].y, up = last >= start;
  const by = Y(start), gy = goalIn ? Y(goal) : 4;
  el.innerHTML = `<defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${up ? "#4ade80" : "#fb7185"}" stop-opacity=".35"/><stop offset="1" stop-color="${up ? "#4ade80" : "#fb7185"}" stop-opacity="0"/></linearGradient></defs>` +
    `<path d="${d}L${W},${H}L0,${H}Z" fill="url(#ga)"/>` +
    `<line x1="0" y1="${by.toFixed(1)}" x2="${W}" y2="${by.toFixed(1)}" class="ln base"/>` +
    `<line x1="0" y1="${gy.toFixed(1)}" x2="${W}" y2="${gy.toFixed(1)}" class="ln goal"/>` +
    `<path d="${d}" class="ln eq ${up ? "up" : "dn"}"/>` +
    win.filter(q => q.k === "close" || q.k === "fill").map(q => `<circle cx="${X(q.t).toFixed(1)}" cy="${Y(q.y).toFixed(1)}" r="2.2" class="pt ${q.k}"/>`).join("");
  lbl.innerHTML = `<div class="cl base" data-top="${(by / H * 100).toFixed(1)}">${usd(start, 0)} start</div>` +
    `<div class="cl goalc" data-top="${(gy / H * 100).toFixed(1)}">${usd(goal, 0)} goal${goalIn ? "" : " ↑ off scale"}</div>`;
  const nf = pts.filter(q => q.k === "fill").length, nc = pts.filter(q => q.k === "close").length;
  $("#chartNote").textContent = `${nf} fill${nf === 1 ? "" : "s"} · ${nc} close${nc === 1 ? "" : "s"} · realized + marked`;
  styleDyn(lbl);
}

function gauge(barSel, txtSel, used, capLabel) {
  const b = $(barSel); const pct = Math.max(0, Math.min(100, used ?? 0));
  b.style.width = pct + "%"; b.className = pct >= 80 ? "bad" : pct >= 50 ? "warn" : "";
  $(txtSel).textContent = capLabel;
}

function renderCommand() {
  const p = S.portfolio;
  const eq = p.equity_usd;
  if (typeof eq === "number") {
    const [w, f] = eq.toFixed(2).split(".");
    $("#equity").innerHTML = `$${Number(w).toLocaleString("en-US")}<small>.${f}</small>`;
  } else $("#equity").textContent = "—";
  $("#startLbl").textContent = p.start_usd != null ? `start ${usd(p.start_usd, 0)} · paper` : "run config missing";
  const pnl = (typeof eq === "number" && typeof p.start_usd === "number") ? eq - p.start_usd : null;
  const d = $("#eqDelta"); d.className = "delta " + (pnl > 0 ? "pos" : pnl < 0 ? "neg" : "");
  d.textContent = pnl == null ? "" : `${sgn(pnl)}${usd(pnl)} (${sgn(pnl)}${(100*pnl/p.start_usd).toFixed(2)}%)`;
  $("#eqNote").textContent = p.open_count ? (p.unpriced_open.length ? `${p.unpriced_open.length} open position(s) unpriced` : `incl. ${usd(p.unrealized_usd)} open`) : (p.closed_count ? `${p.closed_count} closed` : "no trades yet");
  renderChart(p);
  const g = p.goal;
  if (g && g.progress_pct != null) {
    const pr = g.progress_pct, w = Math.max(0, Math.min(100, pr));
    $("#goalBar").style.width = w + "%"; $("#goalBar").className = pr < 0 ? "bad" : "";
    $("#goalTxt").textContent = pr >= 100 ? "Target reached" : `${pr.toFixed(1)}% · ${usd(g.remaining_usd)} to go`;
    $("#goalFrom").textContent = usd(g.start_usd, 0); $("#goalTo").textContent = usd(g.target_usd, 0) + " target";
    $("#goal").hidden = false;
  } else $("#goal").hidden = true;
  const today = p.today_loss_basis_usd ?? 0;
  gauge("#dlBar", "#dlTxt", p.daily_loss_used_pct, p.daily_loss_cap_usd != null ? `${sgn(p.today_pnl_usd)}${usd(p.today_pnl_usd)} · cap −${usd(p.daily_loss_cap_usd)} (${p.daily_loss_cap_pct}%)` : "cap not set");
  gauge("#ddBar", "#ddTxt", p.drawdown_halt_pct ? 100 * (p.drawdown_pct || 0) / p.drawdown_halt_pct : 0, p.drawdown_pct != null ? `${p.drawdown_pct.toFixed(2)}% · halt ${p.drawdown_halt_pct}%` : "—");

  const c = S.counts;
  $("#tiles").innerHTML = [["Scanned", c.scanned], ["Approved", c.approved], ["Traded", c.traded], ["Open", p.open_count]]
    .map(([l, n]) => `<div class="tile"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");

  const top = Math.max(1, S.funnel[0].n);
  $("#funnel").innerHTML = `<div class="funnel">` + S.funnel.map((s, i) => {
    const prev = i ? S.funnel[i-1].n : null;
    const conv = (i && prev) ? ` <span class="pct">${Math.round(100*s.n/prev)}%</span>` : "";
    return `<div class="st"><span>${esc(s.stage)}${conv}</span><div class="tr"><i data-w="${(100*s.n/top).toFixed(1)}"></i></div><b class="num">${s.n}</b></div>`;
  }).join("") + `</div>` + (S.empty ? `<div class="empty">Waiting for the first candidate. Bars fill as coins move through the team.</div>` : "");

  const st = S.stats;
  $("#stats").innerHTML = st ? `<div class="grid2">
      <span>Win rate <b>${st.win_rate_pct}%</b> (${st.wins}/${st.trades})</span><span>Expectancy <b class="${st.expectancy_usd>=0?"pos":"neg"}">${sgn(st.expectancy_usd)}${usd(st.expectancy_usd)}</b>/trade</span>
      <span>Avg win <b>${usd(st.avg_win_usd)}</b></span><span>Avg loss <b>${usd(st.avg_loss_usd)}</b></span>
      <span>Profit factor <b>${st.profit_factor ?? "—"}</b></span><span>Avg hold <b>${st.avg_hold_minutes}m</b></span></div>`
    : `<div class="empty">Win rate and expectancy appear after the first closed paper trade.</div>`;

  $("#openMeta").textContent = p.open_count ? `${usd(p.open_exposure_usd)} at risk` : "";
  $("#openPos").innerHTML = S.open_positions.length ? `<div class="list">` + S.open_positions.map(t => `<div class="it" data-cid="${esc(t.candidate_id)}" data-ev="${t.evaluation}">
      <div><b>${esc(short(t.mint))}</b> <span class="pill">${esc(t.size_tier || "")}</span><div class="small muted">${usd(t.size_usd)} @ ${esc(t.entry_price_usd)} · ${t.hold_minutes ?? "?"}m</div></div>
      <div class="rt">${t.pnl_usd == null ? `<span class="pill warn">unpriced</span>` : `<b class="${t.pnl_usd>=0?"pos":"neg"}">${sgn(t.pnl_usd)}${usd(t.pnl_usd)}</b><div class="small muted">${sgn(t.pnl_pct)}${t.pnl_pct}%</div>`}</div></div>`).join("") + `</div>`
    : `<div class="empty">No open positions.</div>`;

  $("#coins").innerHTML = S.coins.length ? `<div class="list">` + S.coins.slice(0, 40).map(c => `<div class="it" data-cid="${esc(c.candidate_id)}" data-ev="${c.evaluation}">
      <div><b>${esc(short(c.mint))}</b>${c.evaluation>1?` <span class="small muted">eval ${c.evaluation}</span>`:""}<div class="small muted">${ago(c.updated_at)} · rev ${c.revisions}</div></div>
      <div class="row gap">${c.security?`<span class="pill ${toneOf(c.security)}">${esc(c.security)}</span>`:""}${c.verdict?`<span class="pill ${toneOf(c.verdict)}">${esc(c.verdict)}</span>`:""}${c.execution?`<span class="pill ${toneOf(c.execution)}">${esc(c.execution)}</span>`:""}</div></div>`).join("") + `</div>`
    : `<div class="empty">Waiting for the first candidate in <code>/workspace/shared/candidates.jsonl</code>.</div>`;
}

const SVC_TONE = {running: "good", external: "good", external_down: "bad", crashed: "bad", exited: "warn", disabled: "", stopped: ""};
function svcLabel(x) {
  if (x.state === "running") { const l = secsLeft(); return l ? `running · ${mmss(l)} left` : "running"; }
  if (x.state === "external") return "always-on";
  if (x.state === "external_down") return "always-on · DOWN";
  if (x.state === "crashed") return `crashed${x.last_exit != null ? ` · exit ${x.last_exit}` : ""}`;
  return x.state || "stopped";
}
function renderDesk() {
  const live = S.desk.filter(b => b.has_data && b.age_s != null && b.age_s < 600).length;
  const sup = S.supervisor || {};
  $("#deskMeta").textContent = `${BOTS.filter(b => botLive(b[0])).length} live · ${live} wrote in last 10m${sup.supervisor_alive ? "" : " · supervisor offline"}`;
  $("#desk").innerHTML = S.desk.map(b => {
    const svcs = b.services || [];
    const on = botLive(b.id);
    const ct = Object.entries(b.counters || {}).map(([k, v]) => `<span class="pill">${esc(k.replace(/_/g, " "))} ${v}</span>`).join("");
    const sv = svcs.length ? svcs.map(x => `<div class="svc"><span class="sdot ${esc(x.state)}"></span><span class="sn">${esc(x.name)}</span><span class="pill ${SVC_TONE[x.state] || ""}">${esc(svcLabel(x))}</span></div>` +
        (x.state === "disabled" && x.reason ? `<div class="why2">${esc(x.reason)}</div>` : "") +
        (x.state === "external_down" ? `<div class="why2">Owned by ${esc(b.name)}, outside the supervisor. It isn't running; ${esc(b.name)} restarts it.</div>` : "")).join("")
      : `<div class="why2">Not in the service registry.</div>`;
    return `<div class="bot ${on ? "on" : ""}">${avatar(b.id, on ? "live" : "idle", "tile")}<div>
      <div class="row between"><span class="nm">${esc(b.name)}</span><span class="small muted">${b.has_data ? esc(ago(b.last_ts)) : "no data yet"}</span></div>
      <div class="rl">${esc(b.role)}</div><div class="ln ${b.has_data ? "" : "muted"}">${esc(b.last_text)}</div>
      <div class="svcs">${sv}</div>
      ${ct ? `<div class="ct">${ct}</div>` : ""}${b.note ? `<div class="note">${esc(b.note)}</div>` : ""}</div></div>`;
  }).join("") + (sup.exit_only_note ? `<div class="note big">${esc(sup.exit_only_note)}</div>` : "");
}

// ---------------------------------------------------------------- Bots monitor (S.activity, built read-only on the box)
let actFilter = "all";
const BST = {running: "RUNNING", external: "ALWAYS-ON", idle: "IDLE", disabled: "DISABLED", crashed: "CRASHED", down: "DOWN"};
const whenET = s => { if (!s) return ""; const d = new Date(s), n = new Date();
  const same = d.toLocaleDateString("en-US", tz) === n.toLocaleDateString("en-US", tz);
  return same ? tET(s) : d.toLocaleString("en-US", {...tz, month:"short", day:"numeric"}) + " " + tET(s); };
function renderBots() {
  const A = S && S.activity; const el = $("#bots"); if (!el) return;
  if (!A || !A.bots) { el.innerHTML = `<div class="empty">No bot activity in this snapshot yet.</div>`; $("#actFeed").innerHTML = ""; return; }
  if (A.error) { el.innerHTML = `<div class="empty">The box couldn't build the bot view (${esc(A.error)}). The other tabs still work.</div>`; }
  const live = A.bots.filter(b => b.status === "running" || b.status === "external").length;
  $("#botsMeta").textContent = `${live}/${A.bots.length} up${A.supervisor_alive ? "" : " · supervisor offline"}`;
  const rs = S.run_state || {}, left = secsLeft(), eq = A.equity || {};
  const pnl = (typeof eq.equity_usd === "number" && typeof eq.start_usd === "number") ? eq.equity_usd - eq.start_usd : null;
  $("#botsRun").innerHTML = [
    `<span class="pill ${left ? "good" : ""}">${left ? `Run live · ${mmss(left)} left` : "Paused"}</span>`,
    `<span class="pill">Paper equity ${esc(usd(eq.equity_usd))}${pnl != null ? ` (${sgn(pnl)}${esc(usd(pnl))})` : ""}</span>`,
    `<span class="pill">${eq.open_count || 0} open</span>`,
    A.relay_state ? `<span class="pill ${A.relay_state === "external" ? "good" : "bad"}">Phone relay ${A.relay_state === "external" ? "up" : "down"}</span>` : ""].join("");
  if (!A.error) el.innerHTML = A.bots.map(b => {
    const acts = (b.latest || []).map(e => `<li class="${esc(e.tone)}"><span class="t">${esc(whenET(e.ts))}</span><span>${esc(e.text)}</span></li>`).join("");
    const ct = Object.entries(b.counters || {}).map(([k, v]) => `<span class="pill">${esc(k.replace(/_/g, " "))} ${esc(v)}</span>`).join("");
    const sv = (b.services || []).map(x => `<div class="svc"><span class="sdot ${esc(x.state)}"></span><span class="sn">${esc(x.name)}</span><span class="pill ${SVC_TONE[x.state] || ""}">${esc(svcLabel(x))}</span></div>`).join("");
    let extra = "";
    if (b.exit_monitor) extra += `<div class="small muted">Exit monitor tick ${esc(ago(b.exit_monitor.heartbeat_at))} · ${esc(b.exit_monitor.open_positions ?? 0)} open position(s)</div>`;
    if (b.ingest) extra += `<div class="small ${b.ingest.healthy ? "muted" : "warnTxt"}">Journal ingest ${b.ingest.healthy ? "healthy" : "NOT healthy"} · heartbeat ${esc(ago(b.ingest.heartbeat_at))}${b.ingest.violations ? ` · ${esc(b.ingest.violations)} violations` : ""}</div>`;
    return `<div class="bcard">${avatar(b.id, (b.status === "running" || b.status === "external") ? "live" : "idle", "tile")}<div>
      <div class="row between"><span class="nm">${esc(b.name)}</span><span class="bst ${esc(b.status)}">${esc(BST[b.status] || b.status)}</span></div>
      ${b.status_note ? `<div class="why2">${esc(b.status_note)}</div>` : ""}
      <div class="svcs">${sv}</div>${extra}
      ${acts ? `<ol class="acts">${acts}</ol>` : `<div class="small muted">No actions yet.</div>`}
      ${ct ? `<div class="ct">${ct}</div>` : ""}</div></div>`;
  }).join("");
  const items = (A.feed || []).filter(e => actFilter === "all" || e.bot === actFilter);
  $("#actFeed").innerHTML = items.length ? items.map(e => { const bb = BOTC[e.bot] || BOTC.control;
    return `<li class="${esc(e.tone)}"><span class="t">${esc(whenET(e.ts))}</span><span><span class="who">${esc(bb[1].toUpperCase())}</span>${esc(e.text)}</span></li>`; }).join("")
    : `<li><span></span><span class="muted">Nothing yet for this bot.</span></li>`;
}

function renderMini() {
  const items = S.feed.slice(0, 8);
  $("#miniFeedMeta").textContent = S.feed.length ? `${S.feed.length} events` : "";
  $("#miniFeed").innerHTML = items.length ? items.map(e => {
    const b = BOTC[e.bot] || BOTC.control;
    return `<li class="${esc(e.tone)}"${e.candidate_id ? ` data-cid="${esc(e.candidate_id)}" data-ev="${e.evaluation}"` : ""}><i class="ld" data-bg="${b[2]}"></i><span class="t">${esc(tET(e.ts))}</span>` +
      `<span><b data-fg="${b[2]}">${esc((e.bot_name || b[1]).toUpperCase())}:</b> ${esc(e.text)}</span></li>`;
  }).join("") : `<li class="info"><i class="ld"></i><span class="t"></span><span class="muted">Quiet. Events appear here as the bots write them.</span></li>`;
  const k = S.kill_reasons;
  let rows = [...k.security, ...k.general, ...k.governor].sort((a, b) => b.n - a.n), src = "shared store";
  if (!rows.length && k.security_log_only.length) { rows = k.security_log_only.slice().sort((a, b) => b.n - a.n); src = "Security's own log"; }
  const mx = Math.max(1, ...rows.map(r => r.n)), tot = rows.reduce((a, r) => a + r.n, 0);
  $("#miniKillMeta").textContent = rows.length ? `${tot} kills · ${src}` : "";
  $("#miniKills").innerHTML = rows.length ? rows.slice(0, 6).map(r => `<div class="kc"><div class="top2"><span>${esc(r.reason)}</span><b class="num">${r.n}</b></div><div class="bar"><i data-w="${(100 * r.n / mx).toFixed(1)}"></i></div></div>`).join("")
    : `<div class="empty">No kills yet.</div>`;
}

function renderRuns() {
  const R = S.runs || [];
  $("#runs").innerHTML = R.length ? R.map(r => {
    const dv = r.decisions || {}, dq = (r.equity_end_usd != null && r.equity_start_usd != null) ? r.equity_end_usd - r.equity_start_usd : null;
    const sv = (r.services || []).map(x => `<span class="pill ${x.crashes ? "bad" : x.enabled ? "good" : ""}">${esc(x.name)} · ${!x.enabled ? "disabled" : x.external ? (x.final_state === "external" ? "always-on" : "always-on · DOWN") : `${x.passes} start${x.passes === 1 ? "" : "s"}${x.crashes ? `, ${x.crashes} crash` : ""}`}</span>`).join("");
    const mm = r.mismatches || [];
    const src = `<div class="small ${mm.length ? "warnTxt" : "muted"} mt6">P&L source: ${esc(r.pnl_source || "store")}${mm.length ? ` · ${mm.length} mismatch${mm.length === 1 ? "" : "es"} with the journal: ` +
      mm.map(m => `${esc(m.field)} store ${esc(m.store ?? "—")} vs journal ${esc(m.journal ?? "—")}`).join("; ") : " · matches the journal"}</div>`;
    return `<div class="runrep"><div class="row between"><b>Run ${esc(String(r.run_id || "").slice(0, 8))}</b><span class="small muted">${esc(dtET(r.started_at))} → ${esc(tET(r.ended_at))} ET</span></div>
      <div class="small muted">${esc(STOP_TXT[r.end_reason] || r.end_reason || "")}${r.error ? ` · ${esc(r.error)}` : ""}</div>
      <div class="grid2"><span>Discovered <b>${r.discovered ?? "—"}</b></span><span>Security checks <b>${r.security_checks ?? "—"}</b></span>
      <span>Approve / Watch / Reject <b>${dv.APPROVE ?? 0} / ${dv.WATCH ?? 0} / ${dv.REJECT ?? 0}</b></span><span>Fills / Closes <b>${r.fills ?? 0} / ${r.closes ?? 0}</b></span>
      <span>Realized PnL <b class="${(r.realized_pnl_usd || 0) >= 0 ? "pos" : "neg"}">${sgn(r.realized_pnl_usd)}${usd(r.realized_pnl_usd)}</b></span><span>Equity <b>${usd(r.equity_start_usd)} → ${usd(r.equity_end_usd)}</b>${dq != null ? ` (${sgn(dq)}${usd(dq)})` : ""}</span></div>
      ${src}<div class="ct">${sv}</div></div>`;
  }).join("") : `<div class="empty">No finished runs yet. Press <b>Start 1-hour run</b>, and the report shows up here when the hour ends or you press Stop.</div>`;
}

function renderFeed() {
  const items = S.feed.filter(e => feedFilter === "all" || e.kind === feedFilter || (feedFilter === "security" && e.kind === "check_log"));
  $("#feed").innerHTML = items.length ? items.map(e => `<li class="${esc(e.tone)}"${e.candidate_id ? ` data-cid="${esc(e.candidate_id)}" data-ev="${e.evaluation}"` : ""}>
      <span class="t">${esc(tET(e.ts))}</span><span><span class="who">${esc((e.bot_name || e.bot).toUpperCase())}</span>${esc(e.text)}</span></li>`).join("")
    : `<li><span></span><span class="muted">Nothing yet. Events show up here as the bots write them.</span></li>`;
}

function renderKills() {
  const k = S.kill_reasons;
  const grp = (title, rows, note) => {
    const mx = Math.max(1, ...rows.map(r => r.n));
    return `<div class="kgrp"><div class="gt">${esc(title)}</div>${note ? `<div class="small muted">${esc(note)}</div>` : ""}` +
      (rows.length ? rows.slice(0, 15).map(r => `<div class="kr"><div class="top2"><span>${esc(r.reason)}</span><b class="num">${r.n}</b></div><div class="bar"><i data-w="${(100*r.n/mx).toFixed(1)}"></i></div></div>`).join("")
        : `<div class="empty">None yet.</div>`) + `</div>`;
  };
  $("#kills").innerHTML = grp("Security vetoes (shared store)", k.security) + grp("General rejects (rules triggered)", k.general) +
    grp("Governor skips (status_reason)", k.governor) +
    grp("Security's own log, coins not in the shared store", k.security_log_only, "Latest check per coin from security/logs/checks.jsonl (includes Security's test runs).");
}

function renderTrades() {
  const t = S.trades;
  $("#trades").innerHTML = t.length ? t.map(x => `<div class="trade" data-cid="${esc(x.candidate_id)}" data-ev="${x.evaluation}">
      <div class="row between"><b>${esc(short(x.mint))}</b>${x.pnl_usd == null ? `<span class="pill warn">${x.status === "filled" ? "open · unpriced" : "pnl n/a"}</span>` : `<b class="${x.pnl_usd>=0?"pos":"neg"}">${sgn(x.pnl_usd)}${usd(x.pnl_usd)} (${sgn(x.pnl_pct)}${x.pnl_pct}%)</b>`}</div>
      <div class="grid2"><span>Entry <b>${esc(x.entry_price_usd)}</b></span><span>Exit <b>${esc(x.exit_price_usd ?? "open")}</b></span>
      <span>Size <b>${usd(x.size_usd)}</b> ${esc(x.size_tier || "")}</span><span>Fees <b>${usd(x.fees_usd)}</b></span>
      <span>Hold <b>${x.hold_minutes ?? "?"}m</b></span><span>Exit reason <b>${esc(x.exit_reason || (x.status === "filled" ? "—" : "?"))}</b></span>
      <span>In <b>${esc(dtET(x.filled_at))}</b></span><span>Out <b>${esc(x.closed_at ? dtET(x.closed_at) : "—")}</b></span></div></div>`).join("")
    : `<div class="empty">No paper trades yet. Executer's fills appear here once it writes them to the shared store.</div>`;
}

function renderRules() {
  const r = S.rules;
  const fmt = (v, u) => v == null ? "—" : typeof v === "object" ? esc(Array.isArray(v) ? v.join(", ") : Object.entries(v).map(([a, b]) => `${a} ${b}`).join(" · ")) :
    u === "$" ? usd(v, 0) : esc(v) + (u ? (u === "%" ? "%" : " " + u) : "");
  $("#rules").innerHTML = r.loaded ? `<div class="rules">` + r.groups.map(g => `<div class="g"><div class="gt">${esc(g.name)}</div>` +
    g.rows.map(x => `<div class="r"><span>${esc(x.label)}</span><span>${fmt(x.value, x.unit)}</span></div>` +
      (x.pending ? `<div class="pend">Pending: ${fmt(x.pending.value, x.unit)} from ${esc(dtET(x.pending.effective_at))}${x.pending.approved_at ? ` (you approved ${esc(dtET(x.pending.approved_at))}; loosening waits 24h)` : ""}</div>` : "")).join("") + `</div>`).join("") + `</div>`
    : `<div class="empty">Run config not found or unreadable.</div>`;
  const s = S.sources;
  const line = (n, i, extra="") => `<div class="src"><b>${esc(n)}</b> · ${i.exists ? "found" : "missing"}${i.lines != null ? ` · ${i.lines} lines` : ""}${i.bad_lines ? ` · ${i.bad_lines} unreadable` : ""}${extra} <br><code>${esc(i.path)}</code></div>`;
  $("#sources").innerHTML = line("Shared store", s.candidates, ` · ${s.candidates.records || 0} records${s.candidates.invalid ? ` · ${s.candidates.invalid} invalid revisions ignored` : ""}${s.candidates.schema_validated ? " · schema-checked" : ""}`) +
    line("Run config", s.run_config) + line("Security checks", s.checks) + line("Executer fills log", s.fills, s.fills.orphan_lines ? ` · ${s.fills.orphan_lines} not in store (ignored)` : "") +
    line("Journal DB", s.journal, s.journal.events != null ? ` · ${s.journal.events} events` : "") +
    `<div class="src">Open-position marks: ${S.marks && S.marks.enabled ? "DexScreener free API" : "off"}${S.marks && S.marks.last_error ? " · last fetch failed" : ""}</div>` +
    `<div class="src">Updated ${esc(dtET(S.generated_at))}</div>`;
}

// ---- decision trail sheet
async function openTrail(cid, ev) {
  $("#sheet").hidden = false; $("#sheetContent").innerHTML = `<div class="empty">Loading…</div>`;
  try {
    const t = await api(`/api/coin?cid=${encodeURIComponent(cid)}${ev ? `&eval=${encodeURIComponent(ev)}` : ""}`);
    $("#sheetTitle").textContent = short(t.mint);
    $("#sheetContent").innerHTML = `<div class="small muted mono brk">${esc(t.mint)}</div>` + t.evaluations.map(e => `
      <div class="small muted mt10">Evaluation ${e.evaluation} · discovered by ${esc(e.discovered_by)} ${esc(dtET(e.discovered_at))} · ${e.revisions.length} revisions</div>` +
      e.verdicts.map(v => {
        const tone = v.verdict == null ? "none" : (toneOf(v.verdict) || "info");
        const kv = Object.entries(v.facts || {}).map(([k, x]) => `<span>${esc(k.replace(/_/g, " "))} <b>${esc(typeof x === "object" ? JSON.stringify(x) : (/_at$/.test(k) && typeof x === "string") ? dtET(x) : x)}</b></span>`).join("");
        return `<div class="step ${tone}"><div class="b"></div><div><div class="row between"><span class="v">${esc(v.name)}</span><span class="pill ${toneOf(v.verdict)}">${esc(v.verdict ?? "no input yet")}</span></div>
          ${(v.why || []).map(w => `<div class="why">${esc(w)}</div>`).join("")}${kv ? `<div class="kv">${kv}</div>` : ""}</div></div>`;
      }).join("") + `<div class="small muted mt6">Revisions: ${e.revisions.map(r => `${r.revision}·${esc(r.bot_name)}`).join(" → ")}</div>`).join("");
  } catch (e) { $("#sheetContent").innerHTML = `<div class="empty">Couldn't load this coin.</div>`; }
}

// ---- control
function confirmBox(title, text) {
  return new Promise(res => {
    $("#cTitle").textContent = title; $("#cText").textContent = text; $("#confirm").hidden = false;
    const done = v => { $("#confirm").hidden = true; $("#cYes").onclick = $("#cNo").onclick = null; res(v); };
    $("#cYes").onclick = () => done(true); $("#cNo").onclick = () => done(false);
  });
}
async function post(path) {
  if (T) return T.post(path);
  const r = await fetch(path, {method: "POST", credentials: "same-origin", cache: "no-store",
    headers: {"Content-Type": "application/json", "X-CC-Request": "1"}, body: "{}"});
  if (r.status === 401) { location.href = "/login"; throw new Error("auth"); }
  let j = {}; try { j = await r.json(); } catch (e) {}
  return {status: r.status, body: j};
}
function runMsg(t, tone = "") { const m = $("#runMsg"); m.hidden = !t; m.className = "runmsg " + tone; m.textContent = t || ""; }
async function startRun() {
  if (busy || !S) return;
  const l = secsLeft();
  if (l) return runMsg(`A run is already live. ${mmss(l)} left. Press Stop now first if you want a fresh hour.`, "warn");
  const ok = await confirmBox("Start a 1-hour run?", "Every enabled bot does its full job for exactly 60 minutes: scanning, wallet watching, security checks, General's decisions, Executer's PAPER fills and the journal. Then everything pauses on its own. No real money is involved.");
  if (!ok) return;
  busy = true; renderRun();
  try {
    const r = await post("/api/run/start");
    if (r.status === 409) runMsg(`Refused: a run is already live. ${mmss(r.body.seconds_left || 0)} left.`, "warn");
    else if (r.status === 504) runMsg("Sent. The box hasn't confirmed yet, so watch the run card.", "warn");
    else if (r.status !== 200) runMsg("Couldn't start the run. Nothing was changed.", "bad");
    else runMsg("");
    await refresh();
  } catch (e) { if (e.message !== "auth") runMsg("Couldn't reach the app. Nothing was changed.", "bad"); }
  busy = false; renderRun();
}
async function stopRun() {
  if (busy || !S) return;
  const ok = await confirmBox("Stop the run now?", "Every bot gets a stop signal (and is force-stopped after 20 s). No new approvals or fills. The run report appears under Runs.");
  if (!ok) return;
  busy = true; renderRun();
  try { const r = await post("/api/run/stop"); runMsg(r.status === 200 ? "" : r.status === 504 ? "Sent. The box hasn't confirmed yet, so watch the run card." : "Couldn't stop. Try again.", r.status === 200 ? "" : r.status === 504 ? "warn" : "bad"); await refresh(); }
  catch (e) { if (e.message !== "auth") runMsg("Couldn't reach the app.", "bad"); }
  busy = false; renderRun();
}

function show(v) {
  view = v;
  document.querySelectorAll(".view").forEach(s => s.hidden = s.id !== "v-" + v);
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  scrollTo({top: 0});
}

document.addEventListener("click", e => {
  const tab = e.target.closest("#tabs button"); if (tab) return show(tab.dataset.v);
  const f = e.target.closest("#feedFilter button");
  const rg = e.target.closest("#range button");
  if (rg) { range = rg.dataset.r; document.querySelectorAll("#range button").forEach(b => b.classList.toggle("on", b === rg)); return renderChart(S.portfolio); }
  const af = e.target.closest("#actFilter button");
  if (af) { actFilter = af.dataset.a; document.querySelectorAll("#actFilter button").forEach(b => b.classList.toggle("on", b === af)); return renderBots(); }
  if (f) { feedFilter = f.dataset.f; document.querySelectorAll("#feedFilter button").forEach(b => b.classList.toggle("on", b === f)); return renderFeed(); }
  if (e.target.closest("[data-close]")) { $("#sheet").hidden = true; return; }
  const c = e.target.closest("[data-cid]"); if (c) return openTrail(c.dataset.cid, c.dataset.ev);
});
$("#startBtn").addEventListener("click", startRun);
$("#stopBtn").addEventListener("click", stopRun);
setInterval(() => { if (S) { if (T) setConn(true); renderRun(); if (view === "desk" && secsLeft()) { renderDesk(); styleDyn($("#desk")); } if (view === "bots" && secsLeft()) { renderBots(); styleDyn($("#bots")); } } }, 1000);

let timer;
function loop() { clearTimeout(timer); if (!document.hidden) refresh(); timer = setTimeout(loop, 5000); }
document.addEventListener("visibilitychange", () => { if (!document.hidden) loop(); });
const hv = new URLSearchParams(location.hash.slice(1)).get("view"); if (hv) show(hv);
loop();
if ("serviceWorker" in navigator) navigator.serviceWorker.register(T ? "sw.js" : "/sw.js").catch(() => {});
