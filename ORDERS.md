# MezoChat Orders

Commands and actions the bot supports.

## Core orders

| Order                  | Example                          | Description                                      |
|------------------------|----------------------------------|--------------------------------------------------|
| `/start`               | `/start`                         | Onboard, connect wallet, claim handle           |
| `balance`              | `balance`                        | Show MUSD balance + Trove ratio                 |
| `health`               | `health`                         | Detailed collateral health                      |
| `send`                 | `send 25 to @alice`              | Send MUSD to handle or address                  |
| `request`              | `request 40 from @bob`           | Request MUSD                                    |
| `split`                | `split 120 with @alice @bob`     | Create or settle a bill split                   |
| `recurring`            | `pay 800 to @landlord on 1st if ratio > 160` | Set ratio-gated recurring payment |
| `spend`                | `buy amazon 50`                  | Guided Mezo Market / Bitrefill spend            |
| `activity`             | `activity`                       | Show recent receipts and actions                |
| `alerts`               | `alerts on` / `set alert 150`    | Manage safety alerts                            |

## Safety behavior (applies to send, recurring, spend)

1. Read current Trove ICR.
2. Compare to user threshold (default 150%).
3. If below threshold → refuse + alert.
4. If above → confirm then execute.

## Receipt format

Every completed action returns:

```
✓ [Action]
Amount: X MUSD
To/From: @handle
Ratio at time: Y%
Tx: 0x… (or “pending signature”)
```

## Natural language

The agentic layer also accepts plain sentences:

- “How much do I have?”
- “Send Alice 20 for lunch”
- “Don’t let me spend if my ratio drops under 170”
- “Show what I did this week”

All map to the orders above.
