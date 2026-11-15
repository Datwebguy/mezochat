# MezoChat: Mezo Buildathon submission (Access & Distribution track)

**One-liner:** MezoChat is your MUSD bank inside Telegram. Borrow MUSD against Bitcoin, pay anyone by @username, split bills, run ratio-protected recurring payments and shop on Mezo Market, all without leaving the chat.

**Try it (free, Mezo Testnet):** https://t.me/MezoChat_Bot
**Repository:** https://github.com/Datwebguy/mezochat
**Live service:** https://pay.mezochat.xyz

## What it does
- **A wallet inside Telegram:** non-custodial, PIN or passphrase encrypted on the user's device. MetaMask, Trust, Coinbase and OKX also connect.
- **Borrow MUSD in chat:** a live quote straight from Mezo's contracts (ratio, liquidation price, fee, refundable deposit), then `BorrowerOperations.openTrove`.
- **Manage the loan:** add BTC, repay MUSD or close the Trove, with the new ratio shown before signing.
- **Pay by @username:** MezoChat handles, Telegram usernames or addresses, with every receipt confirmed on-chain.
- **Requests and bill splits:** payment tracking and nudges.
- **Recurring payments:** protected by the user's Trove ratio, so their Bitcoin stays safe.
- **Mezo Market in Telegram:** a live catalog from Mezo's Store contract, with purchases via `order(productId)`.
- **Gift cards with the code in chat:** through the Bitrefill API.
- **Safety alerts:** every 3 hours, based on each user's own threshold.
- **On-chain @handle registry:** our `HandleRegistry` contract on Mezo, so handles are verifiable and restore across devices.
- **Plain-language commands:** AI maps casual messages onto MezoChat's own commands.

## How it uses MUSD
Every flow is MUSD:
- borrowing (opening Troves)
- payments, requests and splits
- recurring payments
- Mezo Market purchases

Safety checks read the live Trove ratio from Mezo's `TroveManager` and `PriceFeed` before any spend.

## Proven on Mezo Testnet
- Borrow 1,800 MUSD: https://explorer.test.mezo.org/tx/0x1870d4e26b05963476d5326f94658c97c19772da6060236aef343ad92d52dd57
- Mezo Market purchase (Store order #609): https://explorer.test.mezo.org/tx/0x15095f35288455690aceae7a3e65a3f8816c90f8f2afa0dda8c274bd4cf83ec4
- In-Telegram MUSD payment: https://explorer.test.mezo.org/tx/0xec41d08e7f0044a7a30359e02981381bf0e9e42824286238101519c875a1c1a2
- HandleRegistry contract: https://explorer.test.mezo.org/address/0xd5c172f90799670de5f05b7506f13d977eccc6b5

## How to try it (2 minutes)
1. Open @MezoChat_Bot, tap **Start**, then **Create or import wallet in Telegram**, and choose a PIN.
2. `/faucet`: free test BTC.
3. `/borrow`: borrow 1,800 test MUSD with your PIN.
4. `/send`, `/split`, `/pay`, `/buy`, `/giftcard test`, `/loan`, or just type a sentence.

## Tech
TypeScript, grammY (Telegram webhook + Mini App), viem, Mezo MUSD contracts, Solidity (`HandleRegistry`), Web Crypto (PBKDF2 / AES-GCM), Bitrefill API, OpenAI, Vercel (Functions, Blob, Cron).
