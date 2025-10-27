// autopilotEngine.js
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import { getUpcomingEvents } from "./seasonalEvents.js"; // 👈 new import

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🪶 Helper — log AI actions to the database
async function logAIAction(shop_domain, product_id, action, details = {}, status = "suggested") {
  const { error } = await supabase.from("ai_actions").insert([
    {
      shop_domain,
      product_id,
      action,
      details,
      status
    }
  ]);

  if (error) {
    console.error("❌ Failed to log AI action:", error.message);
  } else {
    console.log(`🧾 Logged AI action: ${action} for product ${product_id}`);
  }
}

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

  // 4️⃣ Log AI suggestions into ai_actions
  for (const p of lowStock) {
    await logAIAction(shop, p.shopify_product_id, "restock_suggested", { title: p.title });
  }

  for (const p of cheap) {
    await logAIAction(shop, p.shopify_product_id, "increase_price_suggested", {
      title: p.title,
      current_price: p.price
    });
  }

  // 5️⃣ Seasonal event matching
  if (events.length > 0) {
    const activeEvent = events[0];
    const matched = products.filter(p =>
      activeEvent.product_keywords?.some(k =>
        p.title.toLowerCase().includes(k.toLowerCase())
      )
    );

    console.log(`🎯 Matched ${matched.length} products for ${activeEvent.name}`);
    for (const p of matched) {
      await logAIAction(shop, p.shopify_product_id, "event_highlight", {
        event: activeEvent.name,
        title: p.title
      });
    }
  }

  console.log(`✅ Autopilot finished for ${shop}`);
  return { ok: true, analyzed: products.length };
}
