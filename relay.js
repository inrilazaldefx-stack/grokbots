/* Grok Bots phone transport: talks to the box through the relay (ntfy-compatible HTTP API), end-to-end encrypted.
   Nothing secret is stored in this file or in config.js. The passcode is typed on the phone, turned into
   non-extractable CryptoKeys, and (only if "Remember this phone" is ticked) kept in this phone's IndexedDB. */
(function () {
  const CFG = window.GB_CONFIG, R = CFG.relay.replace(/\/$/, "");
  const DB = "gb-keys", ST = "k";
  let keys = null, latest = null, lastId = null, lastAt = 0, es = null;
  const waiters = [], pending = {};
  let unlockResolve; const unlocked = new Promise(r => unlockResolve = r);

  const idb = () => new Promise((res, rej) => { const q = indexedDB.open(DB, 1); q.onupgradeneeded = () => q.result.createObjectStore(ST); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  async function idbDo(mode, fn) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction(ST, mode); const r = fn(tx.objectStore(ST)); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }); }
  const saveKeys = k => idbDo("readwrite", s => s.put({...k, salt: CFG.salt}, "keys"));
  const loadKeys = () => idbDo("readonly", s => s.get("keys"));
  const forget = () => idbDo("readwrite", s => s.delete("keys"));

  async function handleMsg(m) {
    if (!m || m.event !== "message") return;
    lastId = m.id;
    if (m.attachment && m.attachment.url) {
      if (m.time * 1000 < lastAt) return;
      try {
        const r = await fetch(m.attachment.url, {cache: "no-store"});
        if (!r.ok) return;
        const s = await GBC.openState(keys, await r.arrayBuffer());
        if (!latest || (s.relay && latest.relay && s.relay.published_at >= latest.relay.published_at) || !latest.relay) { latest = s; lastAt = m.time * 1000; }
        waiters.splice(0).forEach(f => f());
      } catch (e) { /* expired attachment or not ours */ }
    } else if (m.message) {
      try { const o = await GBC.openText(keys, m.message); if (o.kind === "ack" && pending[o.body.nonce]) pending[o.body.nonce](o.body); } catch (e) {}
    }
  }
  async function poll(since) {
    const r = await fetch(`${R}/${keys.stateTopic}/json?poll=1&since=${encodeURIComponent(since)}`, {cache: "no-store"});
    if (!r.ok) throw new Error("relay " + r.status);
    const lines = (await r.text()).split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    const states = lines.filter(m => m.attachment), last = states[states.length - 1];
    if (last) await handleMsg(last);
    if (lines.length) lastId = lines[lines.length - 1].id;
  }
  function live() {
    if (es) es.close();
    es = new EventSource(`${R}/${keys.stateTopic}/sse${lastId ? `?since=${encodeURIComponent(lastId)}` : ""}`);
    es.onmessage = e => { try { handleMsg(JSON.parse(e.data)); } catch (x) {} };
    es.onerror = () => { /* EventSource reconnects on its own; the 60 s poll below is the safety net */ };
  }
  setInterval(() => { if (keys && !document.hidden) poll(lastId || "12h").catch(() => {}); }, 60000);
  document.addEventListener("visibilitychange", () => { if (keys && !document.hidden) { poll(lastId || "12h").catch(() => {}); live(); } });

  async function start(k) { keys = k; await poll("12h").catch(() => {}); live(); unlockResolve(); }

  // ---------- lock screen
  const $ = s => document.querySelector(s);
  async function boot() {
    try { const k = await loadKeys(); if (k && k.salt === CFG.salt) { $("#lock").hidden = true; return start(k); } } catch (e) {}
    $("#lock").hidden = false; $("#lockPass").focus();
  }
  async function submit(ev) {
    ev.preventDefault();
    const pass = $("#lockPass").value; if (!pass) return;
    $("#lockGo").disabled = true; $("#lockMsg").textContent = "Unlocking… (deriving keys on this phone)";
    try {
      const k = await GBC.derive(pass, CFG.salt, CFG.iterations);
      $("#lockPass").value = "";
      keys = k; await poll("12h");
      if (!latest) { $("#lockMsg").textContent = "No data from the box for this passcode in the last 12 hours. Check the passcode, or the relay may be down."; keys = null; $("#lockGo").disabled = false; return; }
      if ($("#lockRemember").checked) await saveKeys(k).catch(() => {});
      $("#lock").hidden = true; start(k);
    } catch (e) { $("#lockMsg").textContent = "Couldn't reach the relay. Try again."; keys = null; }
    $("#lockGo").disabled = false;
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("#lockForm").addEventListener("submit", submit);
    const lb = $("#lockBtn"); if (lb) lb.addEventListener("click", async () => { await forget().catch(() => {}); location.reload(); });
    boot();
  });

  const age = () => latest && latest.relay ? Math.max(0, (Date.now() - new Date(latest.relay.published_at)) / 1000) : null;
  const ago = s => s < 90 ? Math.round(s) + "s" : s < 5400 ? Math.round(s / 60) + "m" : Math.round(s / 3600) + "h";
  window.GB_TRANSPORT = {
    async api(path) {
      await unlocked;
      if (!latest) await new Promise((res, rej) => { waiters.push(res); setTimeout(() => rej(new Error("no data")), 20000); });
      if (path.startsWith("/api/snapshot")) return latest;
      if (path.startsWith("/api/coin")) {
        const q = new URLSearchParams(path.split("?")[1] || ""); const t = (latest.trails || {})[`${q.get("cid")}|${q.get("eval") || ""}`];
        if (!t) throw new Error("trail not in phone snapshot"); return t;
      }
      throw new Error("not available over relay");
    },
    async post(path) {
      await unlocked;
      const cmd = path.endsWith("/start") ? "start_1h_run" : path.endsWith("/stop") ? "stop" : null;
      if (!cmd) return {status: 404, body: {}};
      const sealed = await GBC.sealCommand(keys, cmd);
      const got = new Promise(res => { pending[sealed.nonce] = res; setTimeout(() => res(null), 45000); });
      const r = await fetch(`${R}/${keys.cmdTopic}`, {method: "POST", body: sealed.body, cache: "no-store"});
      if (!r.ok) { delete pending[sealed.nonce]; return {status: 502, body: {}}; }
      const ack = await got; delete pending[sealed.nonce];
      if (!ack) return {status: 504, body: {}};
      if (ack.run_state && latest) latest = {...latest, run_state: ack.run_state};
      return {status: ack.status, body: ack};
    },
    conn() {
      const a = age(), hb = latest && latest.relay ? latest.relay.next_heartbeat_s : 1200;
      if (a == null) return {label: "NO DATA", tone: "bad"};
      if (a > hb + 600) return {label: "STALE · " + ago(a), tone: "warn"};
      return {label: "LIVE · " + ago(a), tone: "ok"};
    },
  };
})();
