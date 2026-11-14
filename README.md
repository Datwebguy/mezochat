<p align="center"><img src="assets/logo.png" width="120" alt="MezoChat logo"></p>

# MezoChat

**Telegram-native banking for MUSD on Mezo.** Check your balance and Trove health, send and request MUSD by @handle, split bills, schedule ratio-gated payments and spend through Mezo Market, all without leaving the chat.

Try it: **[@MezoChat_Bot](https://t.me/MezoChat_Bot)** (Mezo Testnet). Wallet signing page: [pay.mezochat.xyz](https://pay.mezochat.xyz/health)

## Why

Using MUSD day to day means opening a dApp, finding addresses and keeping an eye on your collateral ratio. MezoChat puts that whole loop in a Telegram chat:

- **Check:** balance and live Trove ratio
- **Send and request:** by @handle instead of 0x addresses
- **Split:** shares are settled in the same thread
- **Pay:** recurring payments that skip themselves when your collateral is unsafe
- **Spend:** guided Mezo Market and Bitrefill purchases

It's non-custodial. The bot never holds keys, and every payment is signed in the user's own wallet.

## Features

| | |
|---|---|
| **Wallet connect with proof** | `/start` → Connect wallet → sign a free message. The signature is verified server-side. Works with MetaMask, Trust, Coinbase and OKX, or any wallet browser via a copied link. |
| **Balance and Trove health** | Live reads from `TroveManager` and `PriceFeed`: collateral, debt, BTC price and ratio. |
| **Send and request by @handle** | `/send 25 to @alice`. The recipient gets a Pay button for requests. |
| **Bill splits** | `/split 120 with @alice @bob` splits evenly, tracks who has paid, and lets you nudge the rest. |
| **Ratio-gated recurring payments** | `/pay 800 to @landlord on the 1st if ratio > 160`. On the day, it checks the Trove ratio and prompts you to sign, or skips and alerts you. |
| **Safety gate** | Every send, spend and recurring payment checks the live ratio against your threshold (default 150%) and refuses below it. |
| **Automatic on-chain receipts** | After you sign, the bot waits for the tx, checks the MUSD `Transfer` log matches the amount and recipient, then posts a receipt and notifies the recipient. |
| **Spend** | `/buy amazon 50` checks your ratio, then guides you through Mezo Market to Bitrefill. |
| **Alerts** | Warns when your ratio drops below your threshold and urgently near the 110% liquidation line. |
| **Natural language** | "yo send bob twenty for lunch" → `send 20 to @bob`. The AI can only produce existing commands, which then go through the same confirmation and safety checks. |

## Commands

Type `/` in the chat for the menu. Plain sentences work too.

| Command | Example |
|---|---|
| `/balance` | MUSD, BTC and MEZO balances plus Trove ratio |
| `/health` | Collateral, debt, BTC price, ratio |
| `/send` | `/send 25 to @alice` |
| `/request` | `/request 40 from @bob` |
| `/split` | `/split 120 with @alice @bob` |
| `/pay` | `/pay 800 to @landlord on the 1st if ratio > 160` |
| `/recurring` | List or cancel recurring payments |
| `/splits` | Who has paid, with nudge buttons |
| `/buy` | `/buy amazon 50` |
| `/activity` | Last 7 days of receipts |
| `/alert` | `/alert 160`, `/alert off` |
| `/faucet` | Testnet only: link to the Mezo Faucet (BTC) and steps to borrow test MUSD on testnet.mezo.org |
| `/whois` | `/whois @alice`: wallet, verification and on-chain status |
| `/connect` | Link a different wallet |

Receipt format:

```
✓ Send
Amount: 25 MUSD
To/From: @alice
Ratio at time: 187%
Tx: 0x…
```

## Demo script (2 minutes)

1. **Onboard:** open @MezoChat_Bot → `/start` → **Connect wallet** → pick your wallet → sign. The bot replies "✓ Wallet verified". Claim `@yourname`.
2. **Health:** `/balance`, then `/health`. These are live Trove numbers from Mezo testnet.
3. **Safety gate:** `/alert 999`, then `/send 1 to @friend`. It's refused because the ratio is below the threshold. `/alert 150` to restore.
4. **Pay:** `/send 1 to @friend` → Confirm → **Sign 1 MUSD** → approve in your wallet. A receipt with an explorer link arrives in chat, and @friend gets "Received 1 MUSD".
5. **Split:** `/split 30 with @friend`. Your friend gets a Pay button. `/splits` shows 0/1, then 1/1 once they pay.
6. **Recurring:** `/pay 5 to @friend on the 1st if ratio > 160`, then `/recurring` to see and cancel it.
7. **Natural language:** "how much do I have?" or "send my friend 2 for coffee".

## Architecture

```
Telegram ──► grammY bot ──► parser (+ optional AI translator) ──► safety gate (live ICR)
                 │                                                    │
                 │                                   Mezo RPC (viem): MUSD, TroveManager, PriceFeed
                 ▼
        Signer page (/app) ──► user's wallet signs MUSD transfer ──► tx confirmed + Transfer log checked ──► receipt in chat
```

| Folder | What it does |
|---|---|
| `src/bot` | Telegram handlers, slash menu, buttons, recurring and alert scheduler |
| `src/agent` | Command parser, ratio safety gate, OpenAI translator (constrained to the parser) |
| `src/mezo` | Chain config and contract reads with viem; builds unsigned MUSD transfers |
| `src/web` | HTTP server and signer page for wallet verification and payments |
| `src/registry` | Handles, activity, requests, splits and recurring (JSON on a persistent volume) |
| `src/commands` | Order handlers that return replies, buttons and notifications |

More detail is in [ARCHITECTURE.md](ARCHITECTURE.md), [ORDERS.md](ORDERS.md) and [PRODUCT.md](PRODUCT.md).

### Contracts used (Mezo Testnet, chain 31611)

| Contract | Address |
|---|---|
| MUSD | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` |
| TroveManager | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` |
| PriceFeed | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` |
| **HandleRegistry** (ours) | [`0xd5c172f90799670de5f05b7506f13d977eccc6b5`](https://explorer.test.mezo.org/address/0xd5c172f90799670de5f05b7506f13d977eccc6b5) |

`HandleRegistry` ([source](contracts/HandleRegistry.sol)) puts @handle → wallet on-chain so anyone can verify who a handle pays. After a user proves wallet ownership by signature, the bot's relayer calls `claimFor`. Users can also `claim` directly. No one, including the relayer, can take a handle that already belongs to someone else.

Mainnet addresses (chain 31612) are in `src/config.ts`. Switch with `MEZO_NETWORK=mainnet`.

## Run it yourself

Requirements: Node.js 20+ and a Telegram bot token from @BotFather.

```bash
npm install
TELEGRAM_BOT_TOKEN=... npm start
```

| Variable | Required | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | From @BotFather |
| `MEZO_NETWORK` | no | `testnet` (default) or `mainnet` |
| `MEZO_RPC_URL` | no | Override the public RPC |
| `PUBLIC_URL` | no | Public https URL of this service. Turns on wallet verification and in-wallet signing. Without it, payments fall back to an EIP-681 link. |
| `PORT` | no | Web server port (default 3000) |
| `DATA_FILE` | no | Data file path (default `data/db.json`) |
| `OPENAI_API_KEY` | no | Turns on natural-language understanding |
| `REGISTRY_ADDRESS` | no | Deployed HandleRegistry. Mirrors verified handles on-chain. |
| `PRIVATE_KEY` | no | Relayer key that pays gas for registry claims (deploy with `scripts/deploy-registry.ts`) |

Tests: `npm test`. Typecheck: `npm run typecheck`.

## Status and roadmap

Live on Mezo Testnet, hosted on Railway.

- [x] On-chain handle registry contract (deployed on testnet)
- [ ] Postgres storage
- [ ] Mainnet launch
