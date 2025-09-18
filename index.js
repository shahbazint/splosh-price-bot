import { ethers } from "ethers";
import fs from "fs";

const POLYGON_RPC = process.env.POLYGON_RPC_URL;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const contractAddress = "0x7F9090e31F720F6A8c0B23239b9a548e0B65D2f2";
const DATA_FILE = "./price_data.json";

const abi = [
  { inputs: [], name: "getPrice", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "uint256", name: "token_rate", type: "uint256" }], name: "Price_setting", outputs: [], stateMutability: "payable", type: "function" }
];

// Load or init data
let data = { previousPrice: null, messageId: null, last24hPrice: null, last24hTimestamp: null };
if (fs.existsSync(DATA_FILE)) {
  try { data = JSON.parse(fs.readFileSync(DATA_FILE)); }
  catch { console.error("Failed to read data file, starting fresh"); }
}

function saveData() { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

async function postPrice(price) {
  try {
    let trend = "⏺";
    let changePercent = 0;
    if (data.previousPrice !== null) {
      changePercent = ((price - data.previousPrice) / data.previousPrice) * 100;
      trend = changePercent > 0 ? "⬆" : changePercent < 0 ? "⬇" : "⏺";
    }

    const now = Date.now();
    let change24hPercent = 0;
    if (!data.last24hPrice || !data.last24hTimestamp || now - data.last24hTimestamp > 24*60*60*1000) {
      data.last24hPrice = price;
      data.last24hTimestamp = now;
    } else {
      change24hPercent = ((price - data.last24hPrice)/data.last24hPrice)*100;
    }

    const content = `🚀 SPLOSH Price: $${price.toFixed(4)} USD ${trend} ${changePercent.toFixed(2)}% | 24h: ${change24hPercent.toFixed(2)}%`;

    if (data.messageId) {
      await fetch(`${WEBHOOK_URL}/messages/${data.messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
    } else {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
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

async function startBot() {
  while (true) {
    try {
      const provider = new ethers.WebSocketProvider(POLYGON_RPC);
      const contract = new ethers.Contract(contractAddress, abi, provider);
      const iface = new ethers.Interface(abi);

      provider.on("error", (err) => {
        console.error("WebSocket error:", err);
      });

      provider._websocket.on("close", async () => {
        console.warn("WebSocket closed, reconnecting in 5s...");
        await new Promise(res => setTimeout(res, 5000));
        startBot(); // reconnect
      });

      provider.on({ address: contractAddress }, async (log) => {
        try {
          const parsed = iface.parseLog(log);
          if (parsed.name === "Price_setting") {
            const newPrice = parseFloat(ethers.formatUnits(await contract.getPrice(), 18));
            await postPrice(newPrice);
            console.log("Detected Price_setting call, new price:", newPrice);
          }
        } catch { /* ignore non-event logs */ }
      });

      console.log("Bot running, listening for Price_setting events...");
      break;

    } catch (err) {
      console.error("Error connecting to RPC, retrying in 5s", err);
      await new Promise(res => setTimeout(res, 5000));
    }
  }
}

startBot();
