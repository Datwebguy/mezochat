// MezoChat Mini App: a non-custodial wallet that lives inside Telegram.
// The private key is created here, encrypted with the user's PIN (PBKDF2 + AES-GCM) and kept in
// Telegram CloudStorage. The server never sees the key or the PIN.
import { createPublicClient, createWalletClient, defineChain, formatUnits, http, parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

declare const MZ: { chainId: number; chainName: string; rpc: string; explorer: string; musd: Hex; testnet: boolean };
declare const Telegram: any;

const tg = (globalThis as any).Telegram?.WebApp;
tg?.ready(); tg?.expand();
const initData: string = tg?.initData ?? "";
const params = new URLSearchParams(location.search);
const chain = defineChain({ id: MZ.chainId, name: MZ.chainName, nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: [MZ.rpc] } } });
const pub = createPublicClient({ chain, transport: http(MZ.rpc) });
const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const;

// ---------- storage (Telegram CloudStorage, localStorage fallback) ----------
const KEY = "mezochat_wallet_v1";
const cloud = tg?.CloudStorage && tg.isVersionAtLeast?.("6.9") ? tg.CloudStorage : null;
const local = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } },
};
/** Telegram cloud copy (synced across the user's devices) plus a device copy. Never hangs: cloud reads time out after 4s. */
const store = {
  get: () => new Promise<string | null>(res => {
    if (!cloud) return res(local.get());
    const t = setTimeout(() => res(local.get()), 4000);
    cloud.getItem(KEY, (err: unknown, v: string) => { clearTimeout(t); res((!err && v) || local.get()); });
  }),
  set: (v: string) => new Promise<void>((res, rej) => {
    local.set(v);
    if (!cloud) return res();
    const t = setTimeout(res, 4000);   // device copy is already saved
    cloud.setItem(KEY, v, (err: unknown) => { clearTimeout(t); err ? rej(new Error("Couldn't save to Telegram cloud: " + String(err))) : res(); });
  }),
};

// ---------- crypto ----------
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const buf = (u: Uint8Array) => u as unknown as BufferSource; // TS lib typing quirk for Web Crypto
async function deriveKey(pin: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: buf(salt), iterations: 210_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
interface Vault { v: 1; address: Hex; salt: string; iv: string; ct: string }
async function encrypt(pk: Hex, pin: string): Promise<Vault> {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(iv) }, await deriveKey(pin, salt), buf(new TextEncoder().encode(pk))));
  return { v: 1, address: privateKeyToAccount(pk).address, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
async function decrypt(vault: Vault, pin: string): Promise<Hex> {
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(unb64(vault.iv)) }, await deriveKey(pin, unb64(vault.salt)), buf(unb64(vault.ct)));
    return new TextDecoder().decode(pt) as Hex;
  } catch { throw new Error("Wrong PIN"); }
}

// ---------- api ----------
async function api(path: string, body?: unknown) {
  const r = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

// ---------- ui helpers ----------
const app = document.getElementById("app")!;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (wei: bigint, d: number) => Number(formatUnits(wei, 18)).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: Math.min(2, d) });
function render(html: string) { app.innerHTML = html; }
function msg(text: string, kind: "err" | "ok" | "" = "") {
  const el = document.getElementById("msg"); if (el) { el.textContent = text; el.className = "msg " + kind; }
}
const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const pinField = (id = "pin", label = "PIN") => `<label>${label}<input id="${id}" type="password" inputmode="numeric" autocomplete="off" minlength="6" maxlength="12" placeholder="6-12 digits"></label>`;
function busy(btn: HTMLButtonElement, on: boolean, text?: string) { btn.disabled = on; if (text) btn.textContent = text; }

// ---------- flows ----------
let vault: Vault | null = null;

async function linkWallet(pk: Hex) {
  const acct = privateKeyToAccount(pk);
  const user = tg?.initDataUnsafe?.user?.id;
  if (!initData || !user) throw new Error("Open this from the MezoChat bot in Telegram.");
  const message = `MezoChat: link this in-Telegram wallet to Telegram user ${user}.\nAddress: ${acct.address}\nTime: ${new Date().toISOString()}`;
  await api("/api/mini/link", { initData, address: acct.address, message, signature: await acct.signMessage({ message }) });
}

function setupView() {
  render(`<h1>Create your MezoChat wallet</h1>
  <p class="muted">Your wallet lives inside Telegram. Choose a PIN; it encrypts your key on this device and in your Telegram cloud. MezoChat never sees your key or PIN.</p>
  <div class="card">${pinField("pin", "Choose a PIN")}${pinField("pin2", "Repeat PIN")}</div>
  <button id="create">Create wallet</button>
  <details><summary>I already have a private key</summary><div class="card"><label>Private key<input id="pk" type="password" autocomplete="off" placeholder="0x…"></label></div><button id="import" class="secondary">Import with this PIN</button></details>
  <div id="msg" class="msg"></div>`);
  const go = async (pk: Hex | null, btn: HTMLButtonElement) => {
    const pin = $("pin").value, pin2 = $("pin2").value;
    if (!/^\d{6,12}$/.test(pin)) return msg("PIN must be 6-12 digits.", "err");
    if (pin !== pin2) return msg("PINs don't match.", "err");
    if (pk && !/^0x[0-9a-fA-F]{64}$/.test(pk)) return msg("That isn't a valid private key.", "err");
    busy(btn, true, "Setting up…");
    try {
      const key = pk ?? generatePrivateKey();
      vault = await encrypt(key, pin);
      await store.set(JSON.stringify(vault));
      await linkWallet(key);
      route();
    } catch (e) { msg((e as Error).message, "err"); busy(btn, false, pk ? "Import with this PIN" : "Create wallet"); }
  };
  $("create").onclick = () => go(null, $("create") as any);
  $("import").onclick = () => go($("pk").value.trim() as Hex, $("import") as any);
}

async function homeView() {
  const a = vault!.address;
  render(`<h1>Your MezoChat wallet</h1><div class="muted">${MZ.chainName}</div>
  <div class="card"><div class="addr" id="addr">${a}</div><button id="copy" class="secondary small">Copy address</button></div>
  <div class="card" id="bal">Loading balances…</div>
  <button id="borrow">Borrow MUSD</button>
  <button id="backup" class="secondary">Back up private key</button>
  ${MZ.testnet ? `<a class="btn secondary" href="https://faucet.test.mezo.org" target="_blank">Get testnet BTC</a>` : ""}
  <div id="msg" class="msg"></div>`);
  $("copy").onclick = async () => { try { await navigator.clipboard.writeText(a); msg("Address copied.", "ok"); } catch { msg(a); } };
  $("borrow").onclick = () => borrowView();
  $("backup").onclick = () => backupView();
  try {
    const [musd, btc] = await Promise.all([pub.readContract({ address: MZ.musd, abi: erc20, functionName: "balanceOf", args: [a] }), pub.getBalance({ address: a })]);
    const bal = document.getElementById("bal"); if (!bal) return;   // user already moved to another screen
    bal.innerHTML = `<div class="row"><span>💵 MUSD</span><b>${fmt(musd, 2)}</b></div><div class="row"><span>₿ BTC (gas &amp; collateral)</span><b>${fmt(btc, 6)}</b></div>`;
  } catch { const bal = document.getElementById("bal"); if (bal) bal.textContent = "Couldn't load balances."; }
}

function backupView() {
  render(`<h1>Back up your key</h1>
  <p class="muted">Anyone with this key controls your funds. Write it down and keep it offline. You can import it into MetaMask or any EVM wallet.</p>
  <div class="card">${pinField()}</div><button id="show">Show private key</button>
  <div class="card hidden" id="out"></div><button id="back" class="secondary">Back</button><div id="msg" class="msg"></div>`);
  $("back").onclick = () => homeView();
  $("show").onclick = async () => {
    try { const pk = await decrypt(vault!, $("pin").value); $("out").textContent = pk; $("out").classList.remove("hidden"); msg(""); }
    catch (e) { msg((e as Error).message, "err"); }
  };
}

async function sendTx(pin: string, tx: { to: Hex; data: Hex; value?: bigint }) {
  const pk = await decrypt(vault!, pin);
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain, transport: http(MZ.rpc) });
  return { hash: await wallet.sendTransaction({ ...tx, account, chain }), from: account.address };
}

async function payView(sid: string) {
  render(`<h1>Confirm payment</h1><div class="card" id="sum">Loading…</div>
  <div class="card">${pinField()}</div><button id="pay" disabled>Confirm</button><div id="msg" class="msg"></div>`);
  let s: any;
  try { s = await api(`/api/session/${sid}`); }
  catch { $("sum").textContent = "This payment link has expired or was already used. Go back to the chat and try again."; return; }
  if (s.kind !== "pay") { $("sum").textContent = "Nothing to pay here."; return; }
  $("sum").textContent = s.summary;
  const btn = $<HTMLButtonElement>("pay"); btn.disabled = false; btn.textContent = `Pay ${s.amount} MUSD`;
  btn.onclick = async () => {
    busy(btn, true, "Signing…"); msg("");
    try {
      const { hash, from } = await sendTx($("pin").value, { to: s.tx.to, data: s.tx.data });
      await api(`/api/session/${sid}`, { txHash: hash, from });
      render(`<h1>✓ Payment sent</h1><p>Your receipt will appear in the chat once it confirms.</p><a class="btn secondary" href="${MZ.explorer}/tx/${hash}" target="_blank">View on explorer</a><button id="close">Back to chat</button>`);
      $("close").onclick = () => tg?.close();
    } catch (e) { msg((e as Error).message, "err"); busy(btn, false, `Pay ${s.amount} MUSD`); }
  };
}

function borrowView() {
  render(`<h1>Borrow MUSD</h1><p class="muted">Deposit BTC as collateral and borrow MUSD at Mezo's fixed rate. Keep a little BTC for gas.</p>
  <div class="card"><label>Deposit BTC<input id="coll" inputmode="decimal" value="0.035"></label><label>Borrow MUSD<input id="debt" inputmode="decimal" value="1800"></label></div>
  <div class="card" id="quote">Calculating…</div>
  <div class="card">${pinField()}</div><button id="go" disabled>Borrow</button><button id="back" class="secondary">Back</button><div id="msg" class="msg"></div>`);
  $("back").onclick = () => homeView();
  let q: any = null, t: any;
  const refresh = () => { clearTimeout(t); t = setTimeout(async () => {
    try {
      q = await api(`/api/borrow/quote?address=${vault!.address}&coll=${encodeURIComponent($("coll").value)}&debt=${encodeURIComponent($("debt").value)}`);
      const n = (x: string, d = 2) => Number(x).toLocaleString("en-US", { maximumFractionDigits: d });
      $("quote").innerHTML = `<div class="row"><span>Collateral ratio</span><b class="${q.ratio >= 150 ? "good" : q.ratio >= 110 ? "warn" : "bad"}">${q.ratio}%</b></div>
        <div class="row"><span>Borrowing fee</span><b>${n(q.feeMusd)} MUSD</b></div>
        <div class="row"><span>Liquidation deposit (refunded)</span><b>${n(q.liquidationDepositMusd)} MUSD</b></div>
        <div class="row"><span>Total debt</span><b>${n(q.totalDebtMusd)} MUSD</b></div>
        <div class="row"><span>Liquidated if BTC falls below</span><b>$${n(q.liquidationPrice, 0)}</b></div>
        ${q.ok ? "" : `<div class="bad">${esc(q.error)}</div>`}`;
      $<HTMLButtonElement>("go").disabled = !q.ok;
    } catch (e) { $("quote").textContent = (e as Error).message; $<HTMLButtonElement>("go").disabled = true; }
  }, 350); };
  $("coll").oninput = refresh; $("debt").oninput = refresh; refresh();
  $("go").onclick = async () => {
    const btn = $<HTMLButtonElement>("go"); busy(btn, true, "Signing…"); msg("");
    try {
      const { hash } = await sendTx($("pin").value, { to: q.tx.to, data: q.tx.data, value: BigInt(q.tx.value) });
      await api("/api/mini/borrowed", { initData, txHash: hash, coll: $("coll").value, debt: $("debt").value });
      render(`<h1>✓ Borrow submitted</h1><p>MezoChat will confirm in the chat when your MUSD arrives.</p><a class="btn secondary" href="${MZ.explorer}/tx/${hash}" target="_blank">View on explorer</a><button id="close">Back to chat</button>`);
      $("close").onclick = () => tg?.close();
    } catch (e) { msg((e as Error).message, "err"); busy(btn, false, "Borrow"); }
  };
}

async function route() {
  const raw = await store.get();
  vault = raw ? JSON.parse(raw) : null;
  if (!vault) return setupView();
  const sid = params.get("s");
  if (sid && /^[0-9a-f]{24}$/.test(sid)) return payView(sid);
  if (params.get("view") === "borrow") return borrowView();
  return homeView();
}

route().catch(e => render(`<h1>Something went wrong</h1><p>${esc((e as Error).message)}</p>`));
