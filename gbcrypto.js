/* Grok Bots relay crypto (shared spec with /workspace/app/relay.py). No secrets live in this file.
   master = PBKDF2-SHA256(passcode, salt, iterations) -> 32 bytes
   enc = HKDF(master, info "gb/enc/v1") AES-256-GCM · mac = HKDF(master, "gb/mac/v1") HMAC-SHA256
   topics = "gb" + hex(HMAC(HKDF(master, "gb/topic/v1"), "state"|"cmd"))[:30]
   state blob = "GB1" | iv(12) | AES-GCM(gzip(json), aad "gb-state-v1")
   text msg  = {"v":1,"k":"ack"|"cmd","iv":b64,"ct":b64}, aad "gb-<k>-v1"
   command plaintext = {cmd, ts, nonce, mac: hex HMAC(mac, cmd|ts|nonce)} */
(function (root) {
  const te = new TextEncoder(), td = new TextDecoder();
  const subtle = () => root.crypto.subtle;
  const hex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, "0")).join("");
  const b64 = b => { let s = ""; new Uint8Array(b).forEach(x => s += String.fromCharCode(x)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function derive(passcode, saltB64, iterations) {
    const pk = await subtle().importKey("raw", te.encode(passcode), "PBKDF2", false, ["deriveBits"]);
    const master = await subtle().deriveBits({name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations}, pk, 256);
    const hk = await subtle().importKey("raw", master, "HKDF", false, ["deriveKey", "deriveBits"]);
    const h = info => ({name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: te.encode(info)});
    const enc = await subtle().deriveKey(h("gb/enc/v1"), hk, {name: "AES-GCM", length: 256}, false, ["encrypt", "decrypt"]);
    const mac = await subtle().deriveKey(h("gb/mac/v1"), hk, {name: "HMAC", hash: "SHA-256", length: 256}, false, ["sign"]);
    const seedBits = await subtle().deriveBits(h("gb/topic/v1"), hk, 256);
    const seed = await subtle().importKey("raw", seedBits, {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
    const topic = async n => "gb" + hex(await subtle().sign("HMAC", seed, te.encode(n))).slice(0, 30);
    return {enc, mac, stateTopic: await topic("state"), cmdTopic: await topic("cmd")};
  }
  async function gunzip(u8) {
    const ds = new DecompressionStream("gzip");
    const out = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
    return td.decode(out);
  }
  async function openState(keys, buf) {
    const u8 = new Uint8Array(buf);
    if (td.decode(u8.slice(0, 3)) !== "GB1") throw new Error("not a Grok Bots blob");
    const pt = await subtle().decrypt({name: "AES-GCM", iv: u8.slice(3, 15), additionalData: te.encode("gb-state-v1")}, keys.enc, u8.slice(15));
    return JSON.parse(await gunzip(new Uint8Array(pt)));
  }
  async function openText(keys, text) {
    const m = JSON.parse(text);
    if (m.v !== 1 || !m.k || !m.iv || !m.ct) throw new Error("bad envelope");
    const pt = await subtle().decrypt({name: "AES-GCM", iv: unb64(m.iv), additionalData: te.encode(`gb-${m.k}-v1`)}, keys.enc, unb64(m.ct));
    return {kind: m.k, body: JSON.parse(td.decode(pt))};
  }
  async function sealCommand(keys, cmd, now) {
    const ts = new Date(now || Date.now()).toISOString(), nonce = hex(root.crypto.getRandomValues(new Uint8Array(16)));
    const mac = hex(await subtle().sign("HMAC", keys.mac, te.encode(`${cmd}|${ts}|${nonce}`)));
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle().encrypt({name: "AES-GCM", iv, additionalData: te.encode("gb-cmd-v1")}, keys.enc, te.encode(JSON.stringify({cmd, ts, nonce, mac})));
    return {nonce, body: JSON.stringify({v: 1, k: "cmd", iv: b64(iv), ct: b64(ct)})};
  }
  root.GBC = {derive, openState, openText, sealCommand};
})(typeof window !== "undefined" ? window : globalThis);
