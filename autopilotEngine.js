// autopilotEngine.js
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import { getUpcomingEvents } from "./seasonalEvents.js"; // 👈 new import

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🧠 The Autopilot Brain
export async function runAutopilot(shop) {
  console.log(`🤖 Running autopilot for ${shop}...`);

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

  // 4️⃣ Example AI suggestions
  for (const p of lowStock) {
    console.log(`🧩 Suggest restocking: ${p.title}`);
  }
  for (const p of cheap) {
    console.log(`💡 Suggest increasing price: ${p.title}`);
  }

  // 5️⃣ Future: tie this into seasonal events
  // If event tags match product titles or categories -> boost visibility or ads
  if (events.length > 0) {
    const activeEvent = events[0];
    const matched = products.filter(p =>
      activeEvent.product_keywords?.some(k =>
        p.title.toLowerCase().includes(k.toLowerCase())
      )
    );
    console.log(`🎯 Matched ${matched.length} products for ${activeEvent.name}`);
    matched.forEach(p =>
      console.log(`⭐ Highlight for event: ${p.title}`)
    );
  }

  console.log(`✅ Autopilot finished for ${shop}`);
  return { ok: true, analyzed: products.length };
}
