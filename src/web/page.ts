/** Single-page signer. Runs in any wallet browser (MetaMask etc.) using window.ethereum; no libraries. */
export const page = (chain: { id: number; name: string; rpc: string; explorer: string }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MezoChat</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--card:#f5f5f5;--accent:#E5480F}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#f1f1f1;--muted:#aaa;--card:#1e1e1e}}
body{margin:0;font:16px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);padding:24px 16px}
main{max-width:420px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}.muted{color:var(--muted);font-size:14px}
.card{background:var(--card);border-radius:14px;padding:16px;margin:16px 0;white-space:pre-wrap;word-break:break-word}
button,a.btn{display:block;width:100%;box-sizing:border-box;padding:14px;border:0;border-radius:12px;background:var(--accent);color:#fff;font-size:16px;font-weight:600;text-align:center;text-decoration:none;margin-top:10px}
button:disabled{opacity:.5}#status{margin-top:14px}
</style></head><body><main>
<h1>MezoChat</h1><div class="muted">${chain.name}</div>
<div class="card" id="summary">Loading…</div>
<button id="go" disabled>Connect wallet</button>
<div id="open"></div>
<div id="status" class="muted"></div>
</main><script>
const CHAIN={id:${chain.id},hex:"0x"+(${chain.id}).toString(16),name:${JSON.stringify(chain.name)},rpc:${JSON.stringify(chain.rpc)},explorer:${JSON.stringify(chain.explorer)}};
const sid=new URLSearchParams(location.search).get("s");
const $=id=>document.getElementById(id);const status=t=>$("status").textContent=t;
let S;
const TG="https://t.me/MezoChat_Bot";
function finished(kind){
  $("go").style.display="none"; $("open").innerHTML='<a class="btn" href="'+TG+'">Back to Telegram</a>'; status("");
  $("summary").textContent = kind==="verify" ? "✓ Wallet connected. Go back to Telegram to claim your @handle." : "✓ Payment signed. Your receipt will appear in Telegram once it confirms.";
}
/** When this page is open somewhere without a wallet, watch for the signature made in the wallet app. */
function watch(){ const t=setInterval(async()=>{ try{ const r=await fetch("/api/session/"+sid+"/status"); if(!r.ok) return; const j=await r.json(); if(j.done){clearInterval(t); finished(j.kind);} }catch{} },3000); }
async function load(){
  const r=await fetch("/api/session/"+sid); if(!r.ok){$("summary").textContent="This link has expired or was already used. Go back to Telegram and send /connect (or repeat your payment) for a fresh link.";return;}
  S=await r.json();
  $("summary").textContent=S.kind==="verify"?"Prove you own this wallet by signing a message. No funds move and it costs nothing.":S.summary;
  if(!window.ethereum){
    $("go").style.display="none";
    $("summary").textContent+="\\n\\nTo continue, open this page in your wallet app.";
    const full=location.href, enc=encodeURIComponent(full), hp=location.host+location.pathname+location.search;
    const wallets=[["MetaMask","https://metamask.app.link/dapp/"+hp],["Trust Wallet","https://link.trustwallet.com/open_url?coin_id=60&url="+enc],
      ["Coinbase Wallet","https://go.cb-w.com/dapp?cb_url="+enc],["OKX Wallet","okx://wallet/dapp/url?dappUrl="+enc]];
    $("summary").textContent+=" Pick your wallet:";
    $("open").innerHTML=wallets.map(w=>'<a class="btn" href="'+w[1]+'">Open in '+w[0]+'</a>').join("")+
      '<button id="copy" style="background:transparent;color:var(--fg);border:1px solid var(--muted)">Other wallet: copy link</button>'+
      '<div class="muted" style="margin-top:8px">For other wallets (Rabby, Bitget, Rainbow…), copy the link and paste it into your wallet’s built-in browser.</div>';
    watch();
    $("copy").onclick=async()=>{try{await navigator.clipboard.writeText(full);status("Link copied.");}catch{prompt("Copy this link",full);}};
    return;
  }
  $("go").textContent=S.kind==="verify"?"Connect & sign":"Connect & pay "+S.amount+" MUSD";$("go").disabled=false;
}
async function ensureChain(){
  try{await ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:CHAIN.hex}]});}
  catch(e){ if(e.code===4902||/Unrecognized|not added/i.test(e.message||"")){
    await ethereum.request({method:"wallet_addEthereumChain",params:[{chainId:CHAIN.hex,chainName:CHAIN.name,nativeCurrency:{name:"Bitcoin",symbol:"BTC",decimals:18},rpcUrls:[CHAIN.rpc],blockExplorerUrls:[CHAIN.explorer]}]});
  } else throw e; }
}
async function post(body){const r=await fetch("/api/session/"+sid,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error||"Failed");return j;}
$("go").onclick=async()=>{
  $("go").disabled=true;
  try{
    const [from]=await ethereum.request({method:"eth_requestAccounts"});
    if(S.kind==="verify"){
      status("Sign the message in your wallet…");
      const msg="0x"+Array.from(new TextEncoder().encode(S.message)).map(b=>b.toString(16).padStart(2,"0")).join("");
      const signature=await ethereum.request({method:"personal_sign",params:[msg,from]});
      await post({address:from,signature});
      finished("verify");
    } else {
      await ensureChain();
      status("Confirm the payment in your wallet…");
      const hash=await ethereum.request({method:"eth_sendTransaction",params:[{from,to:S.tx.to,data:S.tx.data}]});
      await post({txHash:hash,from});
      finished("pay");
    }
  }catch(e){status("✗ "+(e.message||e));$("go").disabled=false;}
};
load();
</script></body></html>`;
