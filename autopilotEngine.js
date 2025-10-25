// autopilotEngine.js
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🧠 The Autopilot Brain
export async function runAutopilot(shop) {
  console.log(`🤖 Running autopilot for ${shop}...`);

  // 1️⃣ Fetch all products for this shop
  const { data: products, error } = await supabase
    .from("products")
    .select("*")
    .eq("shop_domain", shop);

  if (error) throw new Error(`Supabase error: ${error.message}`);
  if (!products?.length) throw new Error("No products found in database.");

  console.log(`📦 Found ${products.length} products for ${shop}`);

  // 2️⃣ Example logic — find low-stock or low-price products
  const lowStock = products.filter((p) => p.inventory_quantity < 5);
  const cheap = products.filter((p) => parseFloat(p.price) < 5);

  console.log(`⚠️ Low stock: ${lowStock.length} | 💰 Cheap: ${cheap.length}`);

  // 3️⃣ (Future) Here’s where we’ll add AI optimization logic
  // For now, we just simulate an AI decision.
  for (const p of lowStock) {
    console.log(`🧩 Suggest restocking: ${p.title}`);
  }
  for (const p of cheap) {
    console.log(`💡 Suggest increasing price: ${p.title}`);
  }

  console.log(`✅ Autopilot finished for ${shop}`);
  return { ok: true, analyzed: products.length };
}
