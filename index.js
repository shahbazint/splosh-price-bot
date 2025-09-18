import { ethers } from "ethers";
import fs from "fs";

// ---------- CONFIG ----------
const POLYGON_RPC = process.env.POLYGON_RPC_URL;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const CONTRACT_ADDRESS = "0x7F9090e31F720F6A8c0B23239b9a548e0B65D2f2";
const DATA_FILE = "./price_data.json";
const POLL_INTERVAL = 30_000; // 30 seconds

if (!POLYGON_RPC || !WEBHOOK_URL) {
  console.error("Error: POLYGON_RPC_URL or WEBHOOK_URL not set in environment!");
  process.exit(1);
}

// ---------- CONTRACT & ABI ----------
const abi = [
  {
    inputs: [],
    name: "getPrice",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "token_rate", type: "uint256" }],
    name: "Price_setting",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
];

const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

// ---------- LOAD OR INIT DATA ----------
let data = { previousPrice: null, messageId: null, last24hPrice: null, last24hTimestamp: null };
if (fs.existsSync(DATA_FILE)) {
  try { data = JSON.parse(fs.readFileSync(DATA_FILE)); }
  catch { console.error("Failed to read data file, starting fresh"); }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ---------- HELPER: POST TO DISCORD ----------
async function postPrice(price) {
  try {
    // Trend calculation
    let trend = "⏺";
    let changePercent = 0;
    if (data.previousPrice !== null) {
      changePercent = ((price - data.previousPrice) / data.previousPrice) * 100;
      trend = changePercent > 0 ? "⬆" : changePercent < 0 ? "⬇" : "⏺";
    }

    // 24h change
    const now = Date.now();
    let change24hPercent = 0;
    if (!data.last24hPrice || !data.last24hTimestamp || now - data.last24hTimestamp > 24 * 60 * 60 * 1000) {
      data.last24hPrice = price;
      data.last24hTimestamp = now;
    } else {
      change24hPercent = ((price - data.last24hPrice) / data.last24hPrice) * 100;
    }

    const content = `🚀 SPLOSH Price: $${price.toFixed(4)} USD ${trend} ${changePercent.toFixed(2)}% | 24h: ${change24hPercent.toFixed(2)}%`;

    if (data.messageId) {
      // Update existing Discord message
      await fetch(`${WEBHOOK_URL}/messages/${data.messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
    } else {
      // Post new Discord message
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const json = await res.json();
      data.messageId = json.id;
    }

    data.previousPrice = price;
    saveData();
    console.log("Price updated:", content);

  } catch (err) {
    console.error("Error posting/updating Discord:", err);
  }
}

// ---------- POLLING LOOP ----------
async function pollPrice() {
  try {
    const rawPrice = await contract.getPrice();
    const price = parseFloat(ethers.formatUnits(rawPrice, 18));

    if (price !== data.previousPrice) {
      await postPrice(price);
    }
  } catch (err) {
    console.error("Error fetching price from contract:", err);
  }
}

// Start polling
console.log("Bot started. Polling SPLOSH price every 30 seconds...");
setInterval(pollPrice, POLL_INTERVAL);
pollPrice(); // initial call immediately
