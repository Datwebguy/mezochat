import { formatEther, formatGwei } from "viem";
import { publicClient } from "../../src/mezo/client.js";
const gp = await publicClient.getGasPrice();
console.log("gas price:", formatGwei(gp), "gwei | openTrove (~590k gas) costs", formatEther(gp * 590_000n), "BTC");
