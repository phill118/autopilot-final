// autopilotEngine.js
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🧠 Learn from past AI feedback
async function getFeedbackTrends(shop_domain, product_id, action) {
  const { data, error } = await supabase
    .from("ai_feedback")
    .select("feedback")
    .eq("shop_domain", shop_domain)
    .eq("product_id", product_id)
    .eq("action", action);

  if (error) {
    console.error("⚠️ Failed to fetch feedback trends:", error.message);
    return { approved: 0, rejected: 0 };
  }

  const approved = data.filter((f) => f.feedback === "approved").length;
  const rejected = data.filter((f) => f.feedback === "rejected").length;

  return { approved, rejected };
}

// 🧩 Log every AI action
async function logAIAction(
  shop_domain,
  product_id,
  action,
  details = {},
  reason = "",
  status = "suggested"
) {
  const { error } = await supabase.from("ai_actions").insert([
    { shop_domain, product_id, action, details, reason, status },
  ]);
  if (error) {
    console.error("❌ Failed to log AI action:", error.message);
  } else {
    console.log(`🧾 Logged AI action: ${action} for product ${product_id}`);
  }
}

// 🧠 Generate a reasoning string (for price changes)
function generateReason(product, performance, newPrice, oldPrice, event) {
  const change = newPrice > oldPrice ? "increase" : "decrease";
  let reason = `Price ${change} from £${oldPrice} to £${newPrice}. `;

  if (performance?.conversion_rate > 0.08)
    reason += "High conversion rate suggests strong demand. ";
  if (performance?.conversion_rate < 0.02)
    reason += "Low conversion rate indicates price may be too high. ";
  if (performance?.profit_margin > 0.25)
    reason += "Good profit margin allows for small price adjustments. ";
  if (product.inventory_quantity < 5)
    reason += "Low inventory, increasing price slightly to protect margin. ";
  if (
    event &&
    event.product_keywords?.some((k) =>
      product.title.toLowerCase().includes(k.toLowerCase())
    )
  )
    reason += `Relevant to ${event.name}, boosting price for seasonal demand. `;

  return reason.trim();
}

// 🧮 Calculate the optimal price
function calculateOptimalPrice(product, performance, event) {
  let price = parseFloat(product.price);
  let newPrice = price;

  // Good margin + strong demand → gently increase
  if (
    performance?.profit_margin > 0.25 &&
    performance?.conversion_rate > 0.08
  )
    newPrice = price * 1.08;

  // Very low conversion → try lowering price
  if (performance?.conversion_rate < 0.02)
    newPrice = price * 0.95;

  // Very low stock → protect margin with slight increase
  if (product.inventory_quantity < 5)
    newPrice = price * 1.10;

  // Seasonal boost for relevant products
  if (
    event &&
    event.product_keywords?.some((k) =>
      product.title.toLowerCase().includes(k.toLowerCase())
    )
  )
    newPrice = price * 1.15;

  return Math.round(newPrice * 100) / 100;
}

// 🧠 Main Autopilot Brain
export async function runAutopilot(shop) {
  console.log(`🤖 Running autopilot for ${shop}...`);

  // 1️⃣ Seasonal event (if any)
  const { data: events } = await supabase
    .from("seasonal_events")
    .select("*")
    .eq("active", true);
  const activeEvent = events?.[0] || null;

  // 2️⃣ Shop mode
  const { data: shopInfo } = await supabase
    .from("shops")
    .select("autopilot_mode")
    .eq("shop_domain", shop)
    .single();
  const mode = shopInfo?.autopilot_mode || "manual";
  console.log(`🧭 Mode: ${mode}`);

  // 3️⃣ Get products
  const { data: products, error } = await supabase
    .from("products")
    .select("*")
    .eq("shop_domain", shop);

  if (error) throw new Error(error.message);
  if (!products?.length) throw new Error("No products found.");

  // 📊 Counters for the summary
  let analyzed = 0;
  let priceSuggestions = 0;
  let priceApplied = 0;
  let skippedDueToFeedback = 0;
  let marketingSuggestions = 0;

  // 4️⃣ Evaluate each product
  for (const p of products) {
    analyzed++;

    const { data: perf } = await supabase
      .from("product_performance")
      .select("*")
      .eq("shop_domain", shop)
      .eq("product_id", p.shopify_product_id)
      .maybeSingle();

    const newPrice = calculateOptimalPrice(p, perf, activeEvent);
    const priceChanged = newPrice !== parseFloat(p.price);

    // 🧩 Check AI feedback before deciding on PRICE changes
    const trend = await getFeedbackTrends(
      shop,
      p.shopify_product_id,
      "price_adjustment"
    );

    if (trend.rejected > trend.approved * 2) {
      console.log(
        `⚖️ Skipping price change for ${p.title} — user disagreed before`
      );
      skippedDueToFeedback++;
      await logAIAction(
        shop,
        p.shopify_product_id,
        "price_skipped_due_to_feedback",
        { old_price: p.price, mode },
        "Skipped due to repeated user rejection",
        "skipped"
      );
    } else if (priceChanged) {
      const reason = generateReason(
        p,
        perf,
        newPrice,
        parseFloat(p.price),
        activeEvent
      );
      console.log(
        `💹 ${p.title}: £${p.price} → £${newPrice} (${mode} mode)`
      );
      console.log(`🧠 Reason: ${reason}`);

      priceSuggestions++;

      await logAIAction(
        shop,
        p.shopify_product_id,
        "price_adjustment",
        {
          old_price: p.price,
          new_price: newPrice,
          mode,
        },
        reason,
        "suggested"
      );

      // Apply automatically in FULL mode
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

          if (!res.ok) throw new Error("Shopify update failed");

          priceApplied++;

          await logAIAction(
            shop,
            p.shopify_product_id,
            "price_applied",
            { new_price: newPrice, mode },
            "Applied automatically due to Full AI mode.",
            "completed"
          );

          console.log(`✅ Price updated on Shopify: ${p.title}`);
        } catch (err) {
          console.error(`❌ Shopify update error: ${err.message}`);
        }
      }
    }

    // 🧠 5️⃣ Simple marketing intelligence (ad suggestions)
    const conv = perf?.conversion_rate ?? 0;
    const margin = perf?.profit_margin ?? 0;

    // Winner: good conversion + good margin ⇒ boost ads
    if (conv > 0.05 && margin > 0.2) {
      marketingSuggestions++;
      await logAIAction(
        shop,
        p.shopify_product_id,
        "ad_boost_suggested",
        {
          conversion_rate: conv,
          profit_margin: margin,
          mode,
          event: activeEvent?.name ?? null,
        },
        "Strong performance — recommend increasing ad budget for this product.",
        "suggested"
      );
    }
    // Loser: poor conversion or terrible margin ⇒ reduce/kill ads
    else if (conv < 0.01 || margin < 0.05) {
      marketingSuggestions++;
      await logAIAction(
        shop,
        p.shopify_product_id,
        "ad_reduce_suggested",
        {
          conversion_rate: conv,
          profit_margin: margin,
          mode,
        },
        "Weak performance — consider reducing or pausing ads and replacing this product.",
        "suggested"
      );
    }
  }

  console.log(`✅ Autopilot finished for ${shop}`);
  console.log(
    `📊 Summary — analyzed: ${analyzed}, price_suggestions: ${priceSuggestions}, applied: ${priceApplied}, skipped_due_to_feedback: ${skippedDueToFeedback}, marketing_suggestions: ${marketingSuggestions}`
  );

  // 🔙 return stats for the dashboard
  return {
    ok: true,
    analyzed,
    price_adjustments: priceSuggestions,
    price_applied: priceApplied,
    skipped_due_to_feedback: skippedDueToFeedback,
    marketing_suggestions: marketingSuggestions,
  };
}
