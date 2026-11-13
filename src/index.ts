import { config } from "./config.js";
import { createBot } from "./bot/index.js";
import { startServer } from "./web/server.js";

if (!config.botToken) { console.error("Set TELEGRAM_BOT_TOKEN"); process.exit(1); }
const { bot, tick, hooks, setup } = createBot();
startServer(hooks);
await setup();
setInterval(() => tick().catch(console.error), 6 * 60 * 60 * 1000); // recurring runs once per day; alerts every 6h
bot.start({ onStart: me => console.log(`MezoChat @${me.username} running on ${config.chain.name}`) });
