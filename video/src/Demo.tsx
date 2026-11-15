import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing, delayRender, continueRender } from "remotion";
import timeline from "./timeline.json";
import promoTimeline from "./promo.json";

const fontFamily = "InterV";
if (typeof document !== "undefined") {
  const h = delayRender("font");
  const ff = new FontFace("InterV", `url(${staticFile("fonts/inter.woff2")})`, { weight: "100 900" });
  ff.load().then(f => { document.fonts.add(f); continueRender(h); });
}
export const FPS = 30;
const PAD = 0.8;
type Word = { w: string; s: number; e: number };
type Scene = { id: string; text: string; words: Word[]; dur: number; from: number; frames: number };
const build = (tl: any[]): Scene[] => { const out: Scene[] = []; let at = 0; for (const s of tl) { const frames = Math.ceil((s.dur + PAD) * FPS); out.push({ ...s, from: at, frames }); at += frames; } return out; };
const scenes = build(timeline as any[]);
const promoScenes = build(promoTimeline as any[]);
export const TOTAL_FRAMES = scenes.reduce((a, s) => a + s.frames, 0);
export const PROMO_FRAMES = promoScenes.reduce((a, s) => a + s.frames, 0);

const C = { bg: "#0d0705", o: "#ff5a1f", o2: "#ff8a4c", tx: "#fff4ec", mut: "#bfa898", line: "#3a2218", ok: "#4ade80", tg: "#17212b", tg2: "#0e1621", bub: "#182533", me: "#2b5278" };
const ease = Easing.bezier(0.45, 0, 0.2, 1);
const W = (s: Scene, q: string, n = 0) => {
  let c = 0;
  for (const w of s.words) if (w.w.toLowerCase().replace(/[^a-z0-9@]/g, "").includes(q.toLowerCase()) && c++ === n) return w.s;
  throw new Error(`${s.id}:${q}`);
};
const useT = () => useCurrentFrame() / FPS;
const useSpring = (at: number, cfg = { damping: 14, mass: 0.6 }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  return spring({ frame: f - at * fps, fps, config: cfg });
};
const lerp = (t: number, a: number, b: number, from = 0, to = 1) => interpolate(t, [a, b], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });

/* ---------------- shared pieces ---------------- */
const Background: React.FC = () => {
  const t = useT();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ background: `radial-gradient(1100px 700px at ${70 + Math.sin(t / 6) * 8}% ${18 + Math.cos(t / 7) * 6}%, #3d1809 0%, transparent 60%), radial-gradient(900px 600px at 8% 100%, #2a1006 0%, transparent 60%)` }} />
      <AbsoluteFill style={{ backgroundImage: "radial-gradient(#ffffff0f 1.5px, transparent 1.5px)", backgroundSize: "44px 44px", backgroundPosition: `${(t * 6) % 44}px 0` }} />
    </AbsoluteFill>
  );
};

const Tag: React.FC<{ n: string; l: string }> = ({ n, l }) => {
  const p = useSpring(0.1);
  return (
    <div style={{ position: "absolute", left: 70, top: 56, display: "flex", gap: 12, fontWeight: 800, fontSize: 22, letterSpacing: 2, opacity: p, transform: `translateY(${(1 - p) * -20}px)` }}>
      <span style={{ background: C.o, color: "#fff", borderRadius: 999, padding: "6px 14px" }}>{n}</span>
      <span style={{ border: `2px solid ${C.line}`, borderRadius: 999, padding: "6px 16px", color: C.mut }}>{l}</span>
    </div>
  );
};

const Side: React.FC<{ kick: string; title: string; pts: [string, string, number][] }> = ({ kick, title, pts }) => {
  const h = useSpring(0.2);
  return (
    <div style={{ position: "absolute", left: 830, right: 90, top: 210 }}>
      <div style={{ color: C.o, fontWeight: 800, letterSpacing: 3, fontSize: 24, marginBottom: 22, opacity: h }}>{kick}</div>
      <h1 style={{ fontSize: 80, lineHeight: 1.04, fontWeight: 900, letterSpacing: -2, margin: "0 0 36px", opacity: h, transform: `translateY(${(1 - h) * 30}px)` }}>{title}</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{pts.map(([i, x, at]) => <Point key={x} icon={i} text={x} at={at} />)}</div>
    </div>
  );
};
const Point: React.FC<{ icon: string; text: string; at: number }> = ({ icon, text, at }) => {
  const p = useSpring(at); const t = useT(); const glow = lerp(t, at, at + 0.2) * (1 - lerp(t, at + 0.6, at + 1.4));
  return (
    <div style={{ display: "flex", gap: 18, alignItems: "center", fontSize: 31, color: "#f4e2d6", background: "#ffffff08", border: `1px solid ${glow > 0.05 ? C.o : C.line}`, borderRadius: 20, padding: "18px 24px",
      opacity: p, transform: `translateX(${(1 - p) * 60}px)`, boxShadow: `0 0 ${40 * glow}px ${C.o}55` }}>
      <span style={{ width: 6, height: 36, flex: "none", borderRadius: 3, background: C.o }} />{text}
    </div>
  );
};

/* ---------------- phone ---------------- */
type Msg = { t: number; me?: boolean; text?: string; html?: React.ReactNode; type?: [number, number] };
type Mini = { t0: number; t1: number; img: string; swap?: [number, string][]; scroll?: [number, number, number, number][]; pin?: [number, number] };
const PH = { x: 250, y: 90, w: 430, h: 880, b: 12 };
const IW = PH.w - PH.b * 2;
export const imgPt = (px: number, py: number, sc = 0): [number, number] => [PH.x + PH.b + (px * IW) / 780, PH.y + PH.b + 44 + 52 + (py * IW) / 780 - sc];

const Bubble: React.FC<{ m: Msg; at: number }> = ({ m, at }) => {
  const p = useSpring(at, { damping: 13, mass: 0.5 });
  return (
    <div style={{ maxWidth: "84%", padding: "10px 13px", borderRadius: 16, fontSize: 16.5, lineHeight: 1.38, whiteSpace: "pre-line", background: m.me ? C.me : C.bub,
      alignSelf: m.me ? "flex-end" : "flex-start", transformOrigin: m.me ? "bottom right" : "bottom left", opacity: Math.min(1, p * 1.5), transform: `scale(${0.6 + 0.4 * p})` }}>
      {m.html ?? m.text}
    </div>
  );
};
export const Btn: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ marginTop: 9, background: "#2b3b4d", borderRadius: 10, padding: 9, textAlign: "center", fontWeight: 600, fontSize: 15, color: "#cfe6ff" }}>{children}</div>
);
export const Ok: React.FC<{ children: React.ReactNode }> = ({ children }) => <span style={{ color: C.ok, fontWeight: 700 }}>{children}</span>;
export const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => <code style={{ fontFamily: "ui-monospace,monospace", color: "#ffd2b8" }}>{children}</code>;

const Phone: React.FC<{ msgs: Msg[]; mini?: Mini[]; zoom?: [number, number][] }> = ({ msgs, mini = [], zoom = [] }) => {
  const t = useT(); const enter = useSpring(0, { damping: 16, mass: 0.8 });
  let comp: React.ReactNode = <span style={{ color: "#6c7883" }}>Message</span>;
  for (const m of msgs) if (m.me && m.type && t >= m.type[0] && t < m.type[1]) {
    const n = Math.round(m.text!.length * Math.min(1, (t - m.type[0]) / Math.max(0.2, m.type[1] - m.type[0] - 0.2)));
    comp = <span>{m.text!.slice(0, n)}<span style={{ opacity: Math.floor(t * 2.5) % 2 }}>|</span></span>;
  }
  const z = zoom.reduce((a, [at, v]) => (t >= at ? v : a), 1);
  return (
    <div style={{ position: "absolute", left: PH.x, top: PH.y, width: PH.w, height: PH.h, borderRadius: 58, background: "#050302", border: `${PH.b}px solid #241610`,
      boxShadow: `0 40px 140px ${C.o}38, 0 0 0 2px ${C.line}`, overflow: "hidden", opacity: enter, transform: `translateY(${(1 - enter) * 80}px) scale(${z})` }}>
      <div style={{ height: 74, background: C.tg, display: "flex", alignItems: "center", gap: 14, padding: "14px 18px 0" }}>
        <Img src={staticFile("logo.png")} style={{ width: 42, height: 42, borderRadius: "50%" }} />
        <div><b style={{ fontSize: 19, display: "block" }}>MezoChat</b><span style={{ fontSize: 14, color: "#6c8fb0" }}>bot</span></div>
      </div>
      <div style={{ position: "absolute", top: 74, bottom: 66, left: 0, right: 0, background: C.tg2, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "12px 12px 6px", gap: 8, overflow: "hidden" }}>
        {msgs.map((m, i) => { const at = m.me && m.type ? m.type[1] : m.t; return t >= at ? <Bubble key={i} m={m} at={at} /> : null; })}
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 66, background: C.tg, display: "flex", alignItems: "center", padding: "0 16px", gap: 10 }}>
        <div style={{ flex: 1, background: "#242f3d", borderRadius: 20, padding: "11px 16px", fontSize: 16, color: "#e8eef5", whiteSpace: "nowrap", overflow: "hidden" }}>{comp}</div>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#5288c1" }} />
      </div>
      {mini.map((mm, i) => <MiniApp key={i} mm={mm} />)}
    </div>
  );
};

const MiniApp: React.FC<{ mm: Mini }> = ({ mm }) => {
  const t = useT();
  if (t < mm.t0 - 0.01 || t > mm.t1 + 0.6) return null;
  const y = t < mm.t1 ? (1 - lerp(t, mm.t0, mm.t0 + 0.5)) * 100 : lerp(t, mm.t1, mm.t1 + 0.45) * 100;
  let img = mm.img; let swapAt = mm.t0; for (const [st, im] of mm.swap ?? []) if (t >= st) { img = im; swapAt = st; }
  let sc = 0; for (const [a, b, from, to] of mm.scroll ?? []) if (t >= a) sc = from + (to - from) * lerp(t, a, b);
  const fadeIn = lerp(t, swapAt, swapAt + 0.25);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 44, bottom: 0, background: "#fff", borderRadius: "22px 22px 0 0", overflow: "hidden", boxShadow: "0 -10px 40px #0008", transform: `translateY(${y}%)` }}>
      <div style={{ height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", color: "#111", fontWeight: 700, fontSize: 17, borderBottom: "1px solid #eee" }}>
        <span style={{ color: "#5288c1", fontWeight: 600 }}>Close</span><span>MezoChat</span><span style={{ color: "#5288c1" }}>⋯</span>
      </div>
      <div style={{ position: "absolute", top: 52, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>
        <Img src={staticFile(`img/${img}.png`)} style={{ width: "100%", position: "absolute", top: 0, left: 0, transform: `translateY(${-sc}px)`, opacity: fadeIn }} />
      </div>
      {mm.pin && <Pin a={mm.pin[0]} b={mm.pin[1]} />}
    </div>
  );
};
const Pin: React.FC<{ a: number; b: number }> = ({ a, b }) => {
  const t = useT();
  if (t < a - 0.45 || t > b + 0.4) return null;
  const y = t < b ? (1 - lerp(t, a - 0.45, a - 0.1)) * 100 : lerp(t, b, b + 0.35) * 100;
  const filled = t < a ? 0 : Math.min(4, Math.floor(((t - a) / (b - a - 0.25)) * 4) + 1);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "#fff", color: "#111", borderRadius: "22px 22px 0 0", padding: "26px 24px 34px", boxShadow: "0 -10px 50px #0006", textAlign: "center", transform: `translateY(${y}%)` }}>
      <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 6 }}>Enter your PIN</div>
      <div style={{ color: "#666", fontSize: 14, marginBottom: 18 }}>Unlocks your key on this device</div>
      <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
        {[0, 1, 2, 3].map(i => <span key={i} style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${i < filled ? C.o : "#bbb"}`, background: i < filled ? C.o : "transparent", transform: `scale(${i === filled - 1 ? 1.25 : 1})` }} />)}
      </div>
    </div>
  );
};

/* ---------------- cursor + captions ---------------- */
type CurKey = [number, [number, number], boolean?];
const Cursor: React.FC<{ path?: CurKey[] }> = ({ path }) => {
  const t = useT();
  if (!path) return null;
  let p = path[0][1]; let click: number | null = null;
  for (let i = 0; i < path.length; i++) {
    const [a, pt, c] = path[i]; if (t < a) break;
    p = pt; if (c) click = a;
    const nx = path[i + 1];
    if (nx && t < nx[0]) { const d = Math.min(0.75, nx[0] - a); if (t > nx[0] - d) { const q = lerp(t, nx[0] - d, nx[0]); p = [pt[0] + (nx[1][0] - pt[0]) * q, pt[1] + (nx[1][1] - pt[1]) * q]; } }
  }
  const rt = click === null ? 9 : t - click;
  const appear = lerp(t, 0, 0.4);
  return (
    <>
      {rt < 0.55 && <div style={{ position: "absolute", left: p[0] - 36, top: p[1] - 36, width: 72, height: 72, borderRadius: "50%", border: `4px solid ${C.o}`, opacity: 1 - rt / 0.55, transform: `scale(${0.3 + rt * 1.6})` }} />}
      <svg viewBox="0 0 24 24" style={{ position: "absolute", left: p[0], top: p[1], width: 36, height: 36, opacity: appear, transform: `scale(${rt < 0.15 ? 0.82 : 1})`, transformOrigin: "0 0", filter: "drop-shadow(0 3px 6px #000a)" }}>
        <path d="M4 2l16 9.5-7 1.6-3.6 6.9z" fill="#fff" stroke="#111" strokeWidth={1.4} strokeLinejoin="round" />
      </svg>
    </>
  );
};

const Captions: React.FC<{ s: Scene }> = ({ s }) => {
  const t = useT();
  if (t > s.dur + 0.25) return null;
  const groups: Word[][] = []; let g: Word[] = [];
  for (const w of s.words) { g.push(w); if ((/[.?!:,]$/.test(w.w) && g.length >= 4) || g.length >= 9) { groups.push(g); g = []; } }
  if (g.length) groups.push(g);
  let cur = groups[0]; for (const gg of groups) if (t >= gg[0].s - 0.05) cur = gg;
  return (
    <div style={{ position: "absolute", left: "50%", bottom: 40, transform: "translateX(-50%)", background: "#000000cc", border: "1px solid #ffffff1a", borderRadius: 16, padding: "14px 28px", fontSize: 31, fontWeight: 600, whiteSpace: "nowrap" }}>
      {cur.map((w, i) => <span key={i} style={{ color: t >= w.s ? (t < w.e + 0.05 ? C.o2 : "#fff") : "#ffffff55" }}>{w.w}{" "}</span>)}
    </div>
  );
};

/* ---------------- scenes ---------------- */
const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => {
  const p = useSpring(0, { damping: 15, mass: 0.7 });
  return <div style={{ background: "#ffffff07", border: `1px solid ${C.line}`, borderRadius: 36, padding: "70px 110px", boxShadow: "0 30px 120px #0008", textAlign: "center", opacity: p, transform: `scale(${0.9 + 0.1 * p})`, ...style }}>{children}</div>;
};
const Chips: React.FC<{ items: [string, boolean?][] }> = ({ items }) => (
  <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 26 }}>
    {items.map(([x, f]) => <span key={x} style={{ border: `2px solid ${C.o}`, background: f ? C.o : "transparent", color: f ? "#fff" : C.o2, borderRadius: 999, padding: "6px 18px", fontWeight: 800, fontSize: 20, letterSpacing: 2 }}>{x}</span>)}
  </div>
);
const Center: React.FC<{ children: React.ReactNode }> = ({ children }) => <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>{children}</AbsoluteFill>;
const Logo: React.FC<{ size?: number }> = ({ size = 150 }) => { const p = useSpring(0.15, { damping: 9, mass: 0.6 }); return <Img src={staticFile("logo.png")} style={{ width: size, marginBottom: 26, transform: `scale(${p}) rotate(${(1 - p) * -25}deg)` }} />; };
const Wordmark = () => <h1 style={{ fontSize: 150, fontWeight: 900, letterSpacing: -5, lineHeight: 1, margin: 0 }}>Mezo<span style={{ color: C.o }}>Chat</span></h1>;
const Reveal: React.FC<{ at: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ at, children, style }) => {
  const p = useSpring(at); return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 30}px)`, ...style }}>{children}</div>;
};

const S: Record<string, (s: Scene) => { body: React.ReactNode; cur?: CurKey[] }> = {
  intro: s => ({ body: <Center><Card><Chips items={s.text.includes("I'm") ? [["MEZO BUILDATHON"], ["BUILT BY DATWEB3GUY", true]] : [["BUILT ON MEZO"], ["MUSD", true]]} /><Logo /><Wordmark />
    <Reveal at={W(s, "bank") - 0.3}><p style={{ fontSize: 40, color: "#ecd8ca", marginTop: 24 }}>A Bitcoin-backed bank, inside Telegram.</p></Reveal></Card></Center> }),
  idea: s => ({ body: <Center>{([["Hold Bitcoin.", 0.1, "#fff"], ["Spend dollars.", W(s, "dollars") - 0.3, C.o], ["All inside your chat.", W(s, "chat") - 0.4, "#fff"]] as const).map(([x, a, c]) =>
    <Reveal key={x} at={a}><div style={{ fontSize: 116, fontWeight: 900, letterSpacing: -3, lineHeight: 1.14, color: c }}>{x}</div></Reveal>)}</Center> }),
  wallet: s => {
    const a = W(s, "start"), c = W(s, "create"), p = W(s, "pin"), h = W(s, "handle");
    return { cur: [[0, [900, 700]], [a - 0.9, [560, 930]], [a - 0.2, [640, 935], true], [c - 1, [460, 880]], [c - 0.2, [465, 866], true], [p - 0.6, imgPt(390, 980)], [p, imgPt(390, 980), true], [h - 0.6, imgPt(390, 560)], [h, imgPt(390, 560), true]],
      body: <><Tag n="01" l="WALLET" />
        <Phone msgs={[{ t: 0, me: true, text: "/start", type: [a - 1.1, a - 0.15] },
          { t: a + 0.35, html: <>Welcome to <b>MezoChat</b> {"\n"}Your MUSD bank, right here in Telegram.<Btn> Create or import wallet in Telegram</Btn></> }]}
          mini={[{ t0: c, t1: 99, img: "wallet-setup", swap: [[p - 0.1, "wallet-passphrase"], [h, "wallet-home"]] }]} />
        <Side kick="YOUR WALLET" title="A wallet in seconds" pts={[["", "Encrypted on your phone with your PIN", c], ["", "Only you control your key", W(s, "only")], ["", "@handle registered on Mezo", h]]} /></> };
  },
  borrow: s => {
    const b = W(s, "borrow"), n = W(s, "number"), o = W(s, "tap"), pn = W(s, "pin"), e = W(s, "eighteen");
    return { cur: [[0, [900, 700]], [b + 0.6, [460, 866]], [b + 1.1, [460, 866], true], [o - 0.6, imgPt(215, 1191, 560)], [o, imgPt(215, 1191, 560), true], [pn - 0.3, [470, 880]]],
      body: <><Tag n="02" l="BORROW" />
        <Phone msgs={[{ t: 0, me: true, text: "/borrow", type: [0.2, b - 0.1] },
          { t: b + 0.2, html: <>Borrow MUSD against your BTC.{"\n"}Every number is live from Mezo.<Btn> Open Borrow</Btn></> },
          { t: e, html: <><Ok>✓ Borrowed 1,800 MUSD</Ok>{"\n"}Collateral: 0.039 BTC{"\n"}Ratio: 127%{"\n"}Tx: <Code>0x1870…dd57</Code></> }]}
          mini={[{ t0: b + 1.15, t1: e - 0.4, img: "borrow", scroll: [[n + 0.3, n + 2.6, 0, 560]], pin: [pn, pn + 1.4] }]} />
        <Side kick="BORROW MUSD" title="Borrow against Bitcoin" pts={[["", "Live ratio and liquidation price", W(s, "ratio")], ["", "Fees shown before you sign", W(s, "fees")], ["", "You keep your Bitcoin", W(s, "still")]]} /></> };
  },
  pay: s => {
    const u = W(s, "username"), h = W(s, "healthy"), r = W(s, "receipt");
    return { cur: [[0, [900, 700]], [h - 0.8, [460, 866]], [h - 0.3, [460, 866], true], [h + 0.6, [470, 900]]],
      body: <><Tag n="03" l="PAY" />
        <Phone msgs={[{ t: 0, html: <><Ok>✓ Borrowed 1,800 MUSD</Ok>{"\n"}Ratio: 127%</> },
          { t: 0, me: true, text: "/send 25 to @alice", type: [0.3, u + 0.2] },
          { t: u + 0.6, html: <>Loan check: ratio 127% <Ok>✓</Ok>{"\n"}Send 25 MUSD to @alice<Btn> Pay 25 MUSD</Btn></> },
          { t: r - 0.2, html: <><Ok>✓ Send</Ok>{"\n"}Amount: 25 MUSD{"\n"}To: @alice{"\n"}Ratio at time: 127%{"\n"}Tx: <Code>0xec41…1c1a2</Code></> }]}
          mini={[{ t0: h - 0.25, t1: r - 0.6, img: "pay", pin: [h + 0.6, h + 1.9] }]} />
        <Side kick="PAY BY @USERNAME" title="Pay like you text" pts={[["@", "Any handle, @username or address", u], ["", "Loan checked before money moves", h], ["", "On-chain receipts in chat", r]]} /></> };
  },
  split: s => {
    const d = W(s, "dinner"), e = W(s, "everyone"), r = W(s, "rent"), p = W(s, "protected");
    return { body: <><Tag n="04" l="SPLIT & AUTOMATE" />
      <Phone msgs={[{ t: 0, me: true, text: "split 45 for dinner with @tolu @mike", type: [0.1, d + 0.2] },
        { t: d + 0.5, html: <>Got it: <Code>/split 45 with @tolu @mike</Code>{"\n"}<Ok>✓ Split created</Ok>: 15 MUSD each</> },
        { t: e + 0.6, html: <><Ok>✓ @tolu paid</Ok> 15 MUSD</> },
        { t: 0, me: true, text: "/pay 800 to @landlord on the 1st if ratio > 125", type: [r - 0.9, r + 0.9] },
        { t: p, html: <><b>Scheduled</b>{"\n"}800 MUSD to @landlord on the 1st of every month, while your ratio stays above 125%.</> }]} />
      <Side kick="SPLIT & AUTOMATE" title="Just talk to it" pts={[["", "Plain language works", W(s, "talk")], ["", "Everyone gets a Pay button", e], ["", "Rent, protected by your ratio", p]]} /></> };
  },
  market: s => {
    const sp = W(s, "spend"), st = W(s, "store"), g = W(s, "gift");
    return { cur: [[0, [900, 700]], [sp + 0.8, [460, 866]], [sp + 1.2, [460, 866], true], [st - 0.4, imgPt(390, 551, 120)], [st + 0.2, imgPt(390, 551, 120), true]],
      body: <><Tag n="05" l="SHOP" />
        <Phone msgs={[{ t: 0, me: true, text: "/buy", type: [0.1, sp + 0.3] },
          { t: sp + 0.6, html: <> Mezo Market, paid in MUSD<Btn>Open Mezo Market</Btn></> },
          { t: 0, me: true, text: "/giftcard test", type: [g - 1.2, g - 0.2] },
          { t: g + 0.4, html: <><b>Your gift card is ready</b>{"\n"}Test Gift Card · $10{"\n"}Code delivered right here</> }]}
          mini={[{ t0: sp + 1.25, t1: g - 1.5, img: "market", scroll: [[sp + 2, st - 0.5, 0, 120]], swap: [[st + 0.3, "market-buy"]] }]} />
        <Side kick="SPEND MUSD" title="Shop inside Telegram" pts={[["", "Mezo Market, from the Store contract", W(s, "market")], ["", "Live prices and stock", W(s, "prices")], ["", "Gift card codes in chat", g]]} /></> };
  },
  safety: s => {
    const d = W(s, "dips"), o = W(s, "tap");
    return { cur: [[0, [900, 700]], [o - 0.9, [460, 866]], [o - 0.3, [460, 866], true]],
      body: <><Tag n="06" l="STAY SAFE" />
        <Phone msgs={[{ t: d, html: <><b>Heads-up</b>{"\n"}Your ratio is 122%, close to your 120% safety level.<Btn> Add BTC</Btn></> },
          { t: s.dur - 0.3, html: <><Ok>✓ Added 0.01 BTC</Ok>{"\n"}New ratio: 160%</> }]}
          mini={[{ t0: o - 0.25, t1: s.dur - 0.9, img: "loan-manage" }]} />
        <Side kick="ALWAYS WATCHING" title="Your Bitcoin, protected" pts={[["", "Checks around the clock", W(s, "clock")], ["", "Alerts at your safety level", d], ["", "Add BTC in one tap", o]]} /></> };
  },
  proof: s => {
    const rows: [string, string, string][] = [["Borrow 1,800 MUSD", "0x1870…dd57", "borrowing"], ["Repay MUSD", "0x2f25…15dc", "repaying"], ["Mezo Market order #609", "0x1509…3ec4", "market"],
      ["Telegram wallet payment", "0xec41…c1a2", "payments"], ["Add BTC to the loan", "0xad67…ac0f", "payments"], ["@handle registry contract", "0xd5c1…ccc6", "registry"]];
    return { body: <><Tag n="07" l="ON-CHAIN" /><Center><div style={{ width: 1280, textAlign: "center" }}>
      <Chips items={[["MEZO TESTNET"], ["REAL TRANSACTIONS", true]]} />
      <Reveal at={0.1}><h1 style={{ fontSize: 76, fontWeight: 900, letterSpacing: -2, margin: "0 0 40px" }}>Everything you saw is on-chain</h1></Reveal>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>{rows.map(([a, h, q], i) =>
        <Reveal key={a} at={W(s, q) + (i === 4 ? 0.25 : 0)}><div style={{ display: "flex", alignItems: "center", gap: 18, background: "#ffffff08", border: `1px solid ${C.line}`, borderRadius: 18, padding: "22px 26px", textAlign: "left" }}>
          <b style={{ color: C.ok, fontSize: 30 }}>✓</b><span style={{ fontSize: 29, flex: 1 }}>{a}</span><code style={{ color: C.mut, fontSize: 21 }}>{h}</code></div></Reveal>)}</div>
    </div></Center></> };
  },
  outro: s => ({ body: <Center><Card><Logo /><Wordmark /><p style={{ fontSize: 40, color: "#ecd8ca", margin: "24px 0 0" }}>Bitcoin-backed money, as easy as sending a message.</p>
    <Reveal at={W(s, "try") - 0.2}><div style={{ marginTop: 40, display: "inline-block", background: C.o, padding: "22px 54px", borderRadius: 999, fontSize: 44, fontWeight: 900 }}>t.me/MezoChat_Bot</div></Reveal>
    <Reveal at={W(s, "bot")}><div style={{ marginTop: 34 }}><Chips items={[[s.text.includes("Try it now on") ? "BUILT BY DATWEB3GUY" : "BUILT ON MEZO"]]} /></div></Reveal></Card></Center> }),
};

const SceneView: React.FC<{ s: Scene; dir?: string }> = ({ s, dir = "voice" }) => {
  const f = useCurrentFrame();
  const { body, cur } = S[s.id](s);
  const fade = interpolate(f, [0, 8, s.frames - 8, s.frames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: s.id === "intro" ? Math.min(1, interpolate(f, [s.frames - 8, s.frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })) : fade }}>
      {body}<Cursor path={cur} /><Captions s={s} />
      <Audio src={staticFile(`${dir}/${s.id}.mp3`)} />
    </AbsoluteFill>
  );
};

export const Thumbnail: React.FC = () => (
  <AbsoluteFill style={{ fontFamily, color: C.tx }}>
    <Background />
    <div style={{ position: "absolute", left: 110, top: 0, bottom: 0, width: 1050, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ display: "flex", gap: 14, marginBottom: 34 }}>
        {["MEZO BUILDATHON", "BUILT BY DATWEB3GUY"].map((x, i) => <span key={x} style={{ border: `3px solid ${C.o}`, background: i ? C.o : "transparent", color: i ? "#fff" : C.o2, borderRadius: 999, padding: "10px 24px", fontWeight: 800, fontSize: 28, letterSpacing: 2 }}>{x}</span>)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 30, marginBottom: 26 }}>
        <Img src={staticFile("logo.png")} style={{ width: 150 }} />
        <h1 style={{ fontSize: 150, fontWeight: 900, letterSpacing: -5, lineHeight: 1, margin: 0 }}>Mezo<span style={{ color: C.o }}>Chat</span></h1>
      </div>
      <div style={{ fontSize: 92, fontWeight: 900, letterSpacing: -3, lineHeight: 1.05 }}>Your Bitcoin bank,<br /><span style={{ color: C.o }}>inside Telegram.</span></div>
      <div style={{ fontSize: 38, color: "#ecd8ca", marginTop: 30, fontWeight: 600 }}>Borrow MUSD. Pay by @username. Shop. All in chat.</div>
    </div>
    <div style={{ position: "absolute", right: 150, top: 110, width: 520, height: 860, borderRadius: 64, border: "14px solid #241610", overflow: "hidden", transform: "rotate(6deg)", boxShadow: `0 40px 160px ${C.o}55` }}>
      <Img src={staticFile("img/borrow.png")} style={{ width: "100%" }} />
    </div>
  </AbsoluteFill>
);

export const Demo: React.FC = () => (
  <AbsoluteFill style={{ fontFamily, color: C.tx }}>
    <Background />
    {scenes.map(s => <Sequence key={s.id} from={s.from} durationInFrames={s.frames}><SceneView s={s} /></Sequence>)}
  </AbsoluteFill>
);

export const Promo: React.FC = () => (
  <AbsoluteFill style={{ fontFamily, color: C.tx }}>
    <Background />
    {promoScenes.map(s => <Sequence key={s.id} from={s.from} durationInFrames={s.frames}><SceneView s={s} dir="voice-promo" /></Sequence>)}
  </AbsoluteFill>
);
