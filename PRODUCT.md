# MezoChat

A Telegram-native banking product where the full MUSD experience lives inside chat.

A user connects their wallet once, claims a handle, and then performs every everyday money action without opening the Mezo dApp.

## What a user can do

- Check MUSD balance and live Trove collateral health.
- Send or request MUSD to any @username.
- Split a bill and settle shares in the same chat.
- Set a recurring payment that checks the Trove ratio before it executes.
- Buy a gift card or top-up through Mezo Market and receive the code in chat.
- See every receipt, alert, and activity item in the same conversation.

## How it works

1. User starts the bot and connects a wallet (or confirms an address).
2. User claims a unique handle.
3. All subsequent actions happen through simple chat commands or buttons.
4. Every transfer, spend, and safety check settles in MUSD on Mezo.
5. Results and receipts return to the same Telegram thread.

## Why it is one product

The entire daily money loop — check, send, request, split, spend, and safety gate — stays inside Telegram. The user does not switch apps or open a browser for normal use. That self-contained journey is the product.

## User journey

```
Start bot
  → Connect wallet / confirm address
  → Claim @handle
  → Daily actions in chat:
       balance / health
       send / request
       split
       recurring (ratio-gated)
       spend (Market / Bitrefill)
       activity & receipts
```

## Core principles

- Everything settles in MUSD on Mezo.
- Collateral health is always visible and can gate actions.
- No need to leave Telegram for everyday money use.
- Extend existing Mezo primitives; do not invent new protocol pieces.
