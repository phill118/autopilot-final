// autopilotEngine.js
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import { getUpcomingEvents } from "./seasonalEvents.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🧩 Log every AI action
async function logAIAction(shop_domain, product_id, action, details = {}, status = "suggested") {
  const { error } = await supabase.from("ai_actions").insert([
    { shop_domain, product_id, action, details, status },
  ]);
  if (error) console.error("❌ Failed to log AI action:", error.message);
  else console.log(`🧾 Logged AI action: ${action} for product ${product_id}`);
}

// 🧠 Calculate the ideal price
function calculateOptimalPrice(product, performance, event) {
  let price = parseFloat(product.price);
  let newPrice = price;

  // Price increase for good performance
  if (performance?.profit_margin > 0.25 && performance?.conversion_rate > 0.08)
    newPrice = price * 1.08;

  // Price drop for weak conversion
  if (performance?.conversion_rate < 0.02) newPrice = price * 0.95;

  // Price bump if low inventory
  if (product.inventory_quantity < 5) newPrice = price * 1.10;

  // Boost for seasonal event relevance
  if (
    event &&
    event.product_keywords?.some((k) =>
      product.title.toLowerCase().includes(k.toLowerCase())
    )
  )
    newPrice = price * 1.15;

  // Round to 2 decimals
  return Math.round(newPrice * 100) / 100;
}

// 🧠 Main Autopilot Brain
export async function runAutopilot(shop) {
  console.log(`🤖 Running autopilot for ${shop}...`);

  // 1️⃣ Active events
  const { data: events } = await supabase.from("seasonal_events").select("*").eq("active", true);
  const activeEvent = events?.[0] || null;

  // 2️⃣ Shop mode
  const { data: shopInfo } = await supabase
    .from("shops")
    .select("autopilot_mode")
    .eq("shop_domain", shop)
    .single();
  const mode = shopInfo?.autopilot_mode || "manual";
  console.log(`🧭 Mode: ${mode}`);

  // 3️⃣ Products
  const { data: products, error } = await supabase
    .from("products")
    .select("*")
    .eq("shop_domain", shop);
  if (error) throw new Error(error.message);
  if (!products?.length) throw new Error("No products found.");

  // 4️⃣ Performance
  for (const p of products) {
    const { data: perf } = await supabase
      .from("product_performance")
      .select("*")
      .eq("shop_domain", shop)
      .eq("product_id", p.shopify_product_id)
      .maybeSingle();

    const newPrice = calculateOptimalPrice(p, perf, activeEvent);
    const priceChanged = newPrice !== parseFloat(p.price);

    if (priceChanged) {
      console.log(
        `💹 ${p.title}: £${p.price} → £${newPrice} (${mode} mode)`
      );

      await logAIAction(shop, p.shopify_product_id, "price_adjustment", {
        old_price: p.price,
        new_price: newPrice,
        mode,
      });

      // 🧩 If FULL AI — apply live via Shopify
      if (mode === "full") {
        try {
          const res = await fetch(
            `${process.env.SHOPIFY_APP_URL}/api/shopify/update-price`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                shop,
                product_id: p.shopify_product_id,
                new_price: newPrice,
              }),
            }
          );
          if (!res.ok) throw new Error(`Shopify update failed`);
          await logAIAction(
            shop,
            p.shopify_product_id,
            "price_applied",
            { new_price: newPrice },
            "completed"
          );
          console.log(`✅ Price updated on Shopify: ${p.title}`);
        } catch (err) {
          console.error(`❌ Shopify update error: ${err.message}`);
        }
      }
    }
  }

  console.log(`✅ Autopilot finished for ${shop}`);
  return { ok: true };
}
