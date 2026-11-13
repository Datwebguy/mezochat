# MezoChat Architecture

## Overview

MezoChat is a Telegram bot that acts as the primary interface for everyday MUSD actions. It reads and writes to Mezo contracts, maintains a handle registry, and keeps all user interaction inside chat.

## Components

### 1. Telegram Bot Layer
- Receives messages and commands
- Renders replies, buttons, and receipts
- Manages conversation state per user

### 2. Agentic Layer
- Interprets natural language and structured orders
- Applies safety rules (collateral ratio checks)
- Decides next action or asks for confirmation
- Uses the agentic prompt as its operating instructions

### 3. Handle Registry
- Maps @username → wallet address
- Simple on-chain or off-chain store (on-chain preferred for verifiability)
- Case-insensitive, unique handles

### 4. Mezo Interaction Layer
- Reads MUSD balance
- Reads Trove status, collateral, debt, and ICR via TroveManager + PriceFeed
- Executes MUSD transfers (with user signature or relayer + permit where possible)
- Interfaces with Mezo Market / Bitrefill flows (deep link or guided confirmation)

### 5. Activity & Receipt Store
- Logs every action
- Surfaces history and alerts back into the chat thread

## Data flow

```
User message
    → Telegram Bot
    → Agentic Layer (parse + safety check)
    → Mezo Layer (read or write)
    → Receipt / alert returned to chat
```

## Key contracts (Mezo mainnet)

| Contract              | Address                                      |
|-----------------------|----------------------------------------------|
| MUSD                  | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` |
| TroveManager          | `0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193` |
| BorrowerOperations    | `0x44b1bac67dDA612a41a58AAf779143B181dEe031` |
| PriceFeed             | `0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88` |

Always use proxy addresses and “Read/Write as Proxy” patterns.

## Safety gates

Before any spend or recurring execution:
1. Fetch current ICR for the user’s Trove.
2. Compare against user-defined threshold.
3. Proceed only if above threshold; otherwise refuse and alert.

## Deployment targets

- Telegram Bot
- Mezo testnet (primary for demos)
- Mezo mainnet (production)
- Optional: simple helper contracts for handle registry or split manager
