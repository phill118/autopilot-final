// autopilotEngine.js
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import { getUpcomingEvents } from "./seasonalEvents.js"; // 👈 seasonal events import

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🧩 Helper: get shop mode (manual, assist, full)
async function getShopMode(shop) {
  const { data, error } = await supabase
    .from("shops")
    .select("autopilot_mode")
    .eq("shop_domain", shop)
    .single();

  if (error) {
    console.error("⚠️ Failed to fetch autopilot_mode:", error.message);
    return "manual"; // fallback
  }

  return data?.autopilot_mode || "manual";
}

// 🧠 The Autopilot Brain
export async function runAutopilot(shop) {
  console.log(`🤖 Running autopilot for ${shop}...`);

  // 🧭 Get shop's current AI mode
  const mode = await getShopMode(shop);
  console.log(`🧭 Autopilot mode: ${mode.toUpperCase()}`);

  // 🎉 1️⃣ Check for upcoming seasonal events
  const events = await getUpcomingEvents();
  if (events.length > 0) {
    const nextEvent = events[0];
    console.log(`🗓️ Upcoming event detected: ${nextEvent.name}`);
    console.log(`📅 ${nextEvent.start_date} → ${nextEvent.end_date}`);
    console.log(`🏷️ Tags: ${nextEvent.tags?.join(", ")}`);
    console.log(`💡 Keywords: ${nextEvent.product_keywords?.join(", ")}`);
  } else {
    console.log("🕐 No seasonal events detected right now.");
  }

  // 2️⃣ Fetch all products for this shop
  const { data: products, error } = await supabase
    .from("products")
    .select("*")
    .eq("shop_domain", shop);

  if (error) throw new Error(`Supabase error: ${error.message}`);
  if (!products?.length) throw new Error("No products found in database.");

  console.log(`📦 Found ${products.length} products for ${shop}`);

  // 3️⃣ Example logic — find low-stock or low-price products
  const lowStock = products.filter((p) => p.inventory_quantity < 5);
  const cheap = products.filter((p) => parseFloat(p.price) < 5);

  console.log(`⚠️ Low stock: ${lowStock.length} | 💰 Cheap: ${cheap.length}`);

  // 4️⃣ Example AI suggestions based on mode
  if (mode === "manual") {
    console.log("🧑‍💼 Mode: Manual — only suggest actions, no automation.");
  } else if (mode === "assist") {
    console.log("🤝 Mode: Assist — AI will suggest and queue changes.");
  } else if (mode === "full") {
    console.log("🚀 Mode: Full AI — executing automated updates.");
  }

  for (const p of lowStock) {
    console.log(`🧩 Suggest restocking: ${p.title}`);
  }
  for (const p of cheap) {
    console.log(`💡 Suggest increasing price: ${p.title}`);
  }

  // 5️⃣ Seasonal event awareness
  if (events.length > 0) {
    const activeEvent = events[0];
    const matched = products.filter((p) =>
      activeEvent.product_keywords?.some((k) =>
        p.title.toLowerCase().includes(k.toLowerCase())
      )
    );
    console.log(`🎯 Matched ${matched.length} products for ${activeEvent.name}`);
    matched.forEach((p) =>
      console.log(`⭐ Highlight for event: ${p.title}`)
    );
  }

  console.log(`✅ Autopilot finished for ${shop}`);
  return { ok: true, analyzed: products.length, mode };
}
