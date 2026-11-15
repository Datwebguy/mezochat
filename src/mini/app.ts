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
  render(`<h1>Your MezoChat wallet</h1>
  <p class="muted">Your wallet lives inside Telegram. Your key is encrypted with a PIN you choose; MezoChat never sees your key or PIN.</p>
  <button id="new">✨ Create a new wallet</button>
  <button id="imp" class="secondary">🔑 Import an existing wallet</button>
  <p class="muted small-note">Importing keeps your current address and funds. You'll need that wallet's private key (in MetaMask: Account details → Show private key).</p>`);
  $("new").onclick = () => pinForm(false);
  $("imp").onclick = () => pinForm(true);
}

function pinForm(importing: boolean) {
  render(`<h1>${importing ? "Import your wallet" : "Create your wallet"}</h1>
  ${importing ? `<div class="card"><label>Private key<input id="pk" type="password" autocomplete="off" placeholder="0x… (64 hex characters)"></label>
    <p class="muted">It's encrypted on this device with your PIN before it's saved. It's never sent to MezoChat.</p></div>` : ""}
  <div class="card">${pinField("pin", "Choose a PIN")}${pinField("pin2", "Repeat PIN")}</div>
  <button id="go">${importing ? "Import wallet" : "Create wallet"}</button>
  <button id="back" class="secondary">Back</button>
  <div id="msg" class="msg"></div>`);
  $("back").onclick = () => setupView();
  $("go").onclick = async () => {
    const btn = $<HTMLButtonElement>("go");
    const pin = $("pin").value, pin2 = $("pin2").value;
    let pk: Hex | null = null;
    if (importing) {
      const raw = $("pk").value.trim();
      const norm = (/^[0-9a-fA-F]{64}$/.test(raw) ? "0x" + raw : raw) as Hex;   // accept keys with or without 0x
      if (!/^0x[0-9a-fA-F]{64}$/.test(norm)) return msg("That isn't a valid private key (64 hex characters).", "err");
      pk = norm;
    }
    if (!/^\d{6,12}$/.test(pin)) return msg("PIN must be 6-12 digits.", "err");
    if (pin !== pin2) return msg("PINs don't match.", "err");
    busy(btn, true, "Setting up…");
    try {
      const key = pk ?? generatePrivateKey();
      vault = await encrypt(key, pin);
      await store.set(JSON.stringify(vault));
      await linkWallet(key);
      route();
    } catch (e) { msg((e as Error).message, "err"); busy(btn, false, importing ? "Import wallet" : "Create wallet"); }
  };
}

async function homeView() {
  const a = vault!.address;
  render(`<h1>Your MezoChat wallet</h1><div class="muted">${MZ.chainName}</div>
  <div class="card"><div class="addr" id="addr">${a}</div><button id="copy" class="secondary small">Copy address</button></div>
  <div class="card" id="bal">Loading balances…</div>
  <div class="card hidden" id="loan"></div>
  <button id="borrow">Borrow MUSD</button>
  <button id="market" class="secondary">🛍 Mezo Market</button>
  <button id="backup" class="secondary">Back up private key</button>
  ${MZ.testnet ? `<a class="btn secondary" href="https://faucet.test.mezo.org" target="_blank">Get testnet BTC</a>` : ""}
  <div id="msg" class="msg"></div>`);
  $("copy").onclick = async () => { try { await navigator.clipboard.writeText(a); msg("Address copied.", "ok"); } catch { msg(a); } };
  $("borrow").onclick = () => borrowView();
  $("market").onclick = () => marketView();
  $("backup").onclick = () => backupView();
  try {
    const [musd, btc] = await Promise.all([pub.readContract({ address: MZ.musd, abi: erc20, functionName: "balanceOf", args: [a] }), pub.getBalance({ address: a })]);
    const bal = document.getElementById("bal"); if (!bal) return;   // user already moved to another screen
    bal.innerHTML = `<div class="row"><span>💵 MUSD</span><b>${fmt(musd, 2)}</b></div><div class="row"><span>₿ BTC (gas &amp; collateral)</span><b>${fmt(btc, 6)}</b></div>`;
  } catch { const bal = document.getElementById("bal"); if (bal) bal.textContent = "Couldn't load balances."; }
  // An open loan replaces the Borrow button (Mezo allows one Trove per wallet).
  try {
    const t = await api(`/api/trove/quote?address=${a}&action=view`);
    const loan = document.getElementById("loan"); if (!loan || !t.hasTrove) return;
    const cls = t.ratio >= 150 ? "good" : t.ratio >= t.minRatio + 10 ? "warn" : "bad";
    loan.innerHTML = `<div class="row"><span>Your loan</span><b class="${cls}">${t.ratio}%</b></div>
      <div class="row"><span>Debt</span><b>${Number(t.debtMusd).toLocaleString("en-US", { maximumFractionDigits: 2 })} MUSD</b></div>
      <div class="row"><span>Collateral</span><b>${Number(t.collateralBtc).toFixed(6)} BTC</b></div>
      <button id="manage" class="small">Manage loan</button>`;
    loan.classList.remove("hidden");
    $("borrow").classList.add("hidden");
    $("manage").onclick = () => loanView();
  } catch { /* loan card is optional */ }
}

async function loanView(action: "add" | "repay" | "close" = "add") {
  const a = vault!.address;
  const labels = { add: "Add BTC", repay: "Repay MUSD", close: "Close loan" } as const;
  render(`<h1>Your loan</h1><div class="card" id="state">Loading your loan…</div>
  <div class="tabs">${(["add", "repay", "close"] as const).map(k => `<button id="tab-${k}" class="small ${k === action ? "" : "secondary"}">${labels[k]}</button>`).join("")}</div>
  <div class="card" id="form">${action === "close" ? `<p class="muted">Repay the whole loan and get your BTC collateral back. The 200 MUSD liquidation deposit is refunded, so you pay the debt minus 200.</p>`
    : `<label>${action === "add" ? "BTC to add" : "MUSD to repay"}<input id="amt" inputmode="decimal" placeholder="${action === "add" ? "Amount of BTC" : "Amount of MUSD"}"></label>`}</div>
  <div class="card" id="result"></div>
  <div class="card">${pinField()}</div><button id="go" disabled>${labels[action]}</button><button id="back" class="secondary">Back</button><div id="msg" class="msg"></div>`);
  $("back").onclick = () => homeView();
  for (const k of ["add", "repay", "close"] as const) $(`tab-${k}`).onclick = () => loanView(k);
  const n = (x: string | number, d = 2) => Number(x).toLocaleString("en-US", { maximumFractionDigits: d });
  let q: any = null, t: any;
  const show = () => {
    $("state").innerHTML = !q.hasTrove ? esc(q.error) : `<div class="row"><span>Collateral</span><b>${n(q.collateralBtc, 6)} BTC</b></div>
      <div class="row"><span>Debt (incl. 200 MUSD deposit)</span><b>${n(q.debtMusd)} MUSD</b></div>
      <div class="row"><span>Ratio</span><b>${q.ratio}%</b></div>
      <div class="row"><span>Liquidated if BTC falls below</span><b>$${n(q.liquidationPrice, 0)}</b></div>
      <div class="row"><span>Your MUSD</span><b>${n(q.musdBalance)}</b></div>
      <div class="row"><span>Your BTC</span><b>${n(q.btcBalance, 6)}</b></div>
      <div class="muted">Repay up to ${n(q.maxRepayMusd)} MUSD · close costs ${n(q.closeCostMusd)} MUSD · Mezo minimum ${q.minRatio}%</div>`;
    $("result").innerHTML = q.error && q.hasTrove ? `<div class="bad">${esc(q.error)}</div>`
      : q.ok && q.newRatio !== undefined ? (action === "close"
        ? `<div class="good">✓ You'll pay ${n(q.closeCostMusd)} MUSD and get back ${n(q.collateralBtc, 6)} BTC.</div>`
        : `<div class="row"><span>New ratio</span><b class="good">${q.newRatio}%</b></div><div class="row"><span>New debt</span><b>${n(q.newDebtMusd)} MUSD</b></div>
           <div class="row"><span>New liquidation price</span><b>$${n(q.newLiquidationPrice, 0)}</b></div>`) : "";
    $<HTMLButtonElement>("go").disabled = !(q.ok && q.tx);
  };
  const fetchQ = async () => {
    const amt = action === "close" ? "0" : (document.getElementById("amt") as HTMLInputElement)?.value || "0";
    q = await api(`/api/trove/quote?address=${a}&action=${action}&amount=${encodeURIComponent(amt)}`); show();
  };
  const amtEl = document.getElementById("amt") as HTMLInputElement | null;
  if (amtEl) amtEl.oninput = () => { clearTimeout(t); $<HTMLButtonElement>("go").disabled = true; t = setTimeout(() => fetchQ().catch(e => msg((e as Error).message, "err")), 350); };
  try { await fetchQ(); } catch (e) { $("state").textContent = (e as Error).message; }
  $("go").onclick = async () => {
    const btn = $<HTMLButtonElement>("go"); busy(btn, true, "Signing…"); msg("");
    try {
      const amount = action === "close" ? "" : amtEl!.value;
      const { hash } = await sendTx($("pin").value, { to: q.tx.to, data: q.tx.data, value: BigInt(q.tx.value) });
      await api("/api/mini/trove-tx", { initData, txHash: hash, action, amount });
      render(`<h1>✓ Submitted</h1><p>MezoChat will confirm in the chat with your new ratio.</p><a class="btn secondary" href="${MZ.explorer}/tx/${hash}" target="_blank">View on explorer</a><button id="close">Back to chat</button>`);
      $("close").onclick = () => tg?.close();
    } catch (e) { msg((e as Error).message, "err"); busy(btn, false, labels[action]); }
  };
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

async function borrowView() {
  render(`<h1>Borrow MUSD</h1><p class="muted">Deposit BTC as collateral and borrow MUSD. All numbers update live from Mezo as you type.</p>
  <div class="card" id="wallet">Reading your wallet…</div>
  <div class="card"><label>Borrow MUSD<input id="debt" inputmode="decimal" placeholder="Amount of MUSD"></label>
  <label>Deposit BTC<input id="coll" inputmode="decimal" placeholder="Amount of BTC"></label>
  <div class="fill"><button id="fillSafe" class="secondary small">BTC for safe level (+2%)</button><button id="fillMax" class="secondary small">Max safe MUSD</button></div></div>
  <div class="card" id="quote"></div>
  <label class="ack hidden" id="ackrow"><input type="checkbox" id="ack"> <span id="acktext"></span></label>
  <div class="card">${pinField()}</div><button id="go" disabled>Borrow</button><button id="back" class="secondary">Back</button><div id="msg" class="msg"></div>`);
  $("back").onclick = () => homeView();
  let q: any = null, t: any;
  const n = (x: string | number, d = 2) => {
    const v = Number(x);
    return v > 0 && v < 10 ** -d ? `<${(10 ** -d).toFixed(d)}` : v.toLocaleString("en-US", { maximumFractionDigits: d });
  };
  const canGo = () => { $<HTMLButtonElement>("go").disabled = !(q?.ok && (!q.warning || $("ack").checked)); };
  const show = () => {
    $("wallet").innerHTML = `<div class="row"><span>Your BTC</span><b>${n(q.balanceBtc, 6)}</b></div>
      <div class="row"><span>Kept for gas (live gas price)</span><b>${n(q.gasReserveBtc, 6)}</b></div>
      <div class="row"><span>Available to deposit</span><b>${n(q.availableBtc, 6)}</b></div>
      <div class="row"><span>BTC price now</span><b>$${n(q.btcPrice, 0)}</b></div>
      <div class="row"><span>Mezo minimum ratio${q.recoveryMode ? " (recovery mode)" : ""}</span><b>${q.minRatio}%</b></div>
      <div class="row"><span>Your safety level (/alert)</span><b>${q.safeRatio}%</b></div>
      <div class="row"><span>Mezo minimum loan</span><b>${n(q.minLoanMusd, 0)} MUSD</b></div>`;
    const hasLoan = Number(q.borrowMusd) > 0 && Number(q.collateralBtc) > 0;
    const cls = q.ratio >= q.safeRatio ? "good" : q.ratio >= q.minRatio ? "warn" : "bad";
    $("quote").innerHTML = (hasLoan ? `<div class="row"><span>Collateral ratio</span><b class="${cls}">${q.ratio}%</b></div>
      <div class="row"><span>Liquidated if BTC falls below</span><b class="${cls}">$${n(q.liquidationPrice, 0)}</b></div>
      <div class="row"><span>BTC can drop before liquidation</span><b class="${cls}">${q.dropToLiquidation}%</b></div>` : "") +
      (Number(q.borrowMusd) > 0 ? `<div class="row"><span>BTC needed (Mezo minimum)</span><b>${n(q.needBtcMin, 6)}</b></div>
      <div class="row"><span>BTC needed (your safety level)</span><b>${n(q.needBtcSafe, 6)}</b></div>
      <div class="row"><span>Borrowing fee</span><b>${n(q.feeMusd)} MUSD</b></div>
      <div class="row"><span>Liquidation deposit (refunded)</span><b>${n(q.liquidationDepositMusd)} MUSD</b></div>
      <div class="row"><span>Total debt</span><b>${n(q.totalDebtMusd)} MUSD</b></div>` : "") +
      `<div class="row"><span>Max you can borrow safely${Number(q.collateralBtc) > 0 ? " with this BTC" : ""}</span><b>${n(q.maxSafeBorrowMusd, 0)} MUSD</b></div>` +
      (q.error ? `<div class="bad">${esc(q.error)}</div>` : q.ok && !q.warning ? `<div class="good">✓ Ready to borrow.</div>` : "");
    $("ackrow").classList.toggle("hidden", !q.warning);
    if (q.warning) $("acktext").textContent = `I understand: ${q.warning}`; else $("ack").checked = false;
    canGo();
  };
  const fetchQuote = async () => {
    q = await api(`/api/borrow/quote?address=${vault!.address}&coll=${encodeURIComponent($("coll").value || "0")}&debt=${encodeURIComponent($("debt").value || "0")}&tg=${encodeURIComponent(initData)}`);
    show();
  };
  const refresh = () => { clearTimeout(t); $<HTMLButtonElement>("go").disabled = true; t = setTimeout(() => fetchQuote().catch(e => { $("quote").textContent = (e as Error).message; }), 350); };
  $("coll").oninput = refresh; $("debt").oninput = refresh; $("ack").onchange = canGo;
  // Helpers only fill a box with a number computed from live data; the user stays in control.
  // 2% above the exact amount, so a small BTC price move doesn't put you below your level right away
  $("fillSafe").onclick = () => { if (q && Number(q.needBtcSafe) > 0) { $("coll").value = (Number(q.needBtcSafe) * 1.02).toFixed(6); refresh(); } else msg("Enter the MUSD amount first.", "err"); };
  $("fillMax").onclick = () => { if (q) { $("debt").value = String(Math.floor(Number(q.maxSafeBorrowMusd))); refresh(); } };
  try { await fetchQuote(); } catch (e) { $("wallet").textContent = (e as Error).message; }
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

async function marketView() {
  render(`<h1>Mezo Market</h1><p class="muted">Gift cards and more, paid in MUSD. Prices and stock are live from Mezo's Store contract.</p>
  <div id="items">Loading…</div><button id="back" class="secondary">Back</button>`);
  $("back").onclick = () => homeView();
  try {
    const { items } = await api("/api/market/catalog");
    if (!items.length) { $("items").innerHTML = `<div class="card">Mezo Market isn't connected on this network yet.</div>`; return; }
    $("items").innerHTML = items.map((p: any) => `<div class="card item"><div class="row"><b>${esc(p.name)}</b><b>${Number(p.priceMusd).toLocaleString("en-US")} MUSD</b></div>
      <div class="row muted"><span>${p.available ? `${p.stock} left` : "Sold out"}${p.perCustomerLimit ? ` · limit ${p.perCustomerLimit} per person` : ""}</span><span>Redeem at ${esc(p.redeem)}</span></div>
      ${p.available ? `<button class="small" data-id="${p.id}">Buy</button>` : ""}</div>`).join("");
    document.querySelectorAll<HTMLButtonElement>("#items button[data-id]").forEach(b => b.onclick = () => buyView(Number(b.dataset.id)));
  } catch (e) { $("items").textContent = (e as Error).message; }
}

async function buyView(productId: number) {
  render(`<h1>Buy</h1><div class="card" id="sum">Checking…</div>
  <div class="card">${pinField()}</div><button id="go" disabled>Buy</button><button id="back" class="secondary">Back to market</button><div id="msg" class="msg"></div>`);
  $("back").onclick = () => marketView();
  let q: any;
  try { q = await api(`/api/market/quote?address=${vault!.address}&product=${productId}&tg=${encodeURIComponent(initData)}`); }
  catch (e) { $("sum").textContent = (e as Error).message; return; }
  const p = q.product;
  $("sum").innerHTML = (p ? `<div class="row"><span>Item</span><b>${esc(p.name)}</b></div><div class="row"><span>Price</span><b>${Number(p.priceMusd).toLocaleString("en-US")} MUSD</b></div>` : "") +
    `<div class="row"><span>Your MUSD</span><b>${Number(q.musdBalance).toLocaleString("en-US", { maximumFractionDigits: 2 })}</b></div>
     <div class="row"><span>Your ratio</span><b>${q.ratio === null ? "no loan" : q.ratio + "%"}</b></div>` +
    (q.ok ? `<div class="muted">Steps: ${q.txs.map((t: any, i: number) => `${i + 1}. ${esc(t.label)}`).join(" · ")}</div>` : `<div class="bad">${esc(q.error)}</div>`);
  const btn = $<HTMLButtonElement>("go"); btn.disabled = !q.ok;
  btn.onclick = async () => {
    busy(btn, true, "Signing…"); msg("");
    try {
      let last = "" as Hex;
      for (const [i, t] of q.txs.entries()) {
        msg(`Step ${i + 1} of ${q.txs.length}: ${t.label}…`);
        const { hash } = await sendTx($("pin").value, { to: t.to, data: t.data, value: BigInt(t.value) });
        if (i < q.txs.length - 1) {                       // wait for the approval before ordering
          const rc = await pub.waitForTransactionReceipt({ hash });
          if (rc.status !== "success") throw new Error("Approval failed");
        }
        last = hash;
      }
      await api("/api/mini/market-tx", { initData, txHash: last, productId });
      render(`<h1>✓ Order sent</h1><p>MezoChat will confirm in the chat and explain how to reveal your code.</p><a class="btn secondary" href="${MZ.explorer}/tx/${last}" target="_blank">View on explorer</a><button id="close">Back to chat</button>`);
      $("close").onclick = () => tg?.close();
    } catch (e) { msg((e as Error).message, "err"); busy(btn, false, "Buy"); }
  };
}

function relinkView() {
  render(`<h1>Reconnect your wallet</h1>
  <p class="muted">Your wallet ${short(vault!.address)} is saved in Telegram, but MezoChat needs to link it to your account again. Enter your PIN once to sign a free message. No funds move.</p>
  <div class="card">${pinField()}</div><button id="go">Reconnect</button>
  <details><summary>Use a different wallet instead</summary><button id="reset" class="secondary">Set up a different wallet</button>
  <p class="muted">This replaces the wallet saved in Telegram. Back up your current key first if it holds funds.</p></details>
  <div id="msg" class="msg"></div>`);
  $("reset").onclick = () => setupView();
  $("go").onclick = async () => {
    const btn = $<HTMLButtonElement>("go"); busy(btn, true, "Reconnecting…");
    try { await linkWallet(await decrypt(vault!, $("pin").value)); msg("✓ Reconnected. Go back to the chat to claim your @handle if asked.", "ok"); setTimeout(() => homeView(), 1200); }
    catch (e) { msg((e as Error).message, "err"); busy(btn, false, "Reconnect"); }
  };
}

async function route() {
  const raw = await store.get();
  vault = raw ? JSON.parse(raw) : null;
  if (!vault) return setupView();
  // The wallet is saved in Telegram, but the bot may not have it linked (e.g. after a server move).
  // Re-link with one PIN entry so chat commands work again.
  if (initData) {
    try {
      const linked = await api("/api/mini/status", { initData });
      if (!linked || linked.address?.toLowerCase() !== vault.address.toLowerCase()) return relinkView();
    } catch { /* status check is best-effort */ }
  }
  const sid = params.get("s");
  if (sid && /^[0-9a-f]{24}$/.test(sid)) return payView(sid);
  if (params.get("view") === "borrow") return borrowView();
  if (params.get("view") === "loan") return loanView();
  if (params.get("view") === "market") return marketView();
  return homeView();
}

route().catch(e => render(`<h1>Something went wrong</h1><p>${esc((e as Error).message)}</p>`));
