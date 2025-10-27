// autopilotEngine.js
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import { getUpcomingEvents } from "./seasonalEvents.js"; // 👈 import for events

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
      status,
    },
  ]);

  if (error) {
    console.error("❌ Failed to log AI action:", error.message);
  } else {
    console.log(`🧾 Logged AI action: ${action} for product ${product_id}`);
  }
}

// 🧮 Helper — update or insert product performance snapshot
async function recordPerformance(shop_domain, product_id, metrics) {
  const { error } = await supabase
    .from("product_performance")
    .upsert(
      {
        shop_domain,
        product_id,
        ...metrics,
        updated_at: new Date().toISOString(),
      },
      { onConflict: ["shop_domain", "product_id"] }
    );

  if (error) console.error("❌ Failed to record performance:", error.message);
  else console.log(`📊 Performance updated for ${product_id}`);
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
      current_price: p.price,
    });
  }

  // 5️⃣ Seasonal event matching
  if (events.length > 0) {
    const activeEvent = events[0];
    const matched = products.filter((p) =>
      activeEvent.product_keywords?.some((k) =>
        p.title.toLowerCase().includes(k.toLowerCase())
      )
    );

    console.log(`🎯 Matched ${matched.length} products for ${activeEvent.name}`);
    for (const p of matched) {
      await logAIAction(shop, p.shopify_product_id, "event_highlight", {
        event: activeEvent.name,
        title: p.title,
      });
    }
  }

  // 6️⃣ Record performance metrics (simulated for now)
  for (const p of products) {
    const metrics = {
      total_sales: Math.floor(Math.random() * 100),
      total_revenue: parseFloat(p.price) * Math.random() * 100,
      profit_margin: 0.25 + Math.random() * 0.3,
      conversion_rate: 0.02 + Math.random() * 0.05,
      last_30d_sales: Math.floor(Math.random() * 20),
      last_30d_revenue: parseFloat(p.price) * Math.random() * 20,
    };
    await recordPerformance(shop, p.shopify_product_id, metrics);
  }

  console.log(`✅ Autopilot finished for ${shop}`);
  return { ok: true, analyzed: products.length };
}
