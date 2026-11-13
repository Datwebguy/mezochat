# MezoChat

Telegram-native banking for MUSD. Full everyday money experience inside chat.

## Features

- Wallet connect + @handle claim
- Balance and live Trove collateral health
- Send / request MUSD by handle
- Bill splits
- Ratio-gated recurring payments
- Mezo Market / Bitrefill spends with in-chat receipts
- Activity feed and safety alerts

## Quick start

1. Clone the repo
2. Copy `.env.example` to `.env` and fill in:
   - `TELEGRAM_BOT_TOKEN`
   - `MEZO_RPC_URL`
   - `PRIVATE_KEY` (bot relayer, if used)
3. Install dependencies
4. Run the bot

```bash
npm install
npm run dev
```

## Project structure

```
/
├── src/
│   ├── bot/          # Telegram handlers
│   ├── agent/        # Agentic logic and prompts
│   ├── mezo/         # Contract interactions
│   ├── registry/     # Handle registry
│   └── commands/     # Order handlers
├── contracts/        # Optional helper contracts
├── PRODUCT.md
├── ARCHITECTURE.md
├── AGENTIC_PROMPT.md
├── RESOURCES.md
├── ORDERS.md
└── README.md
```

## Requirements

- Node.js 20+
- Telegram Bot Token
- Mezo RPC access
- (Optional) Relayer private key for gasless or sponsored flows

## Status

Working product definition. Implementation in progress.
