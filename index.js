import { ethers } from "ethers";
import fs from "fs";

// ---------- CONFIG ----------
const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
const contractAddress = "0x7F9090e31F720F6A8c0B23239b9a548e0B65D2f2";
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const DATA_FILE = "./price_data.json";

// ---------- CONTRACT ABI ----------
const abi = [
  {
    "inputs": [],
    "name": "getPrice",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
];

const contract = new ethers.Contract(contractAddress, abi, provider);
const iface = new ethers.Interface(abi);

// ✅ ethers v6 fix: use full function signature
const priceSettingFragment = iface.getFunction("Price_setting(uint256)");
const priceSettingSig = priceSettingFragment.selector;

// ---------- LOAD OR INIT DATA ----------
let data = { previousPrice: null, messageId: null, last24hPrice: null, last24hTimestamp: null };
if (fs.existsSync(DATA_FILE)) {
  try { data = JSON.parse(fs.readFileSync(DATA_FILE)); }
  catch (err) { console.error("Failed to read data file, starting fresh:", err); }
}

// ---------- HELPER FUNCTIONS ----------
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function postPrice(price) {
  // Trend calculation
  let trend = "⏺";
  let changePercent = 0;
  if (data.previousPrice !== null) {
    changePercent = ((price - data.previousPrice) / data.previousPrice) * 100;
    trend = changePercent > 0 ? "⬆" : changePercent < 0 ? "⬇" : "⏺";
  }

  // True 24h change
  const now = Date.now();
  let change24hPercent = 0;
  if (!data.last24hPrice || !data.last24hTimestamp || now - data.last24hTimestamp > 24*60*60*1000) {
    data.last24hPrice = price;
    data.last24hTimestamp = now;
  } else {
    change24hPercent = ((price - data.last24hPrice)/data.last24hPrice)*100;
  }

  const content = `🚀 SPLOSH Price: $${price.toFixed(4)} USD ${trend} ${changePercent.toFixed(2)}% | 24h: ${change24hPercent.toFixed(2)}%`;

  try {
    if (data.messageId) {
      // Update message
      await fetch(`${WEBHOOK_URL}/messages/${data.messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
    } else {
      // Post new message
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

// ---------- LISTEN FOR PRICE_SETTING CALLS ----------
provider.on({ address: contractAddress }, async (log) => {
  if (log.topics[0] === priceSettingSig) {
    const newPrice = parseFloat(ethers.formatUnits(await contract.getPrice(), 18));
    await postPrice(newPrice);
    console.log("Detected Price_setting call, new price:", newPrice);
  }
});

console.log("Listening for Price_setting calls...");




