import { config } from "./config.js";
import { createBot } from "./bot/index.js";

if (!config.botToken) { console.error("Set TELEGRAM_BOT_TOKEN in .env"); process.exit(1); }
const { bot, tick } = createBot();
setInterval(() => tick().catch(console.error), 6 * 60 * 60 * 1000); // every 6h; recurring runs once per day
bot.start({ onStart: me => console.log(`MezoChat @${me.username} running on ${config.chain.name}`) });
