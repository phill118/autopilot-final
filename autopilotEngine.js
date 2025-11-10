// autopilotEngine.js
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

// Initialize Supabase client
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

// 🧩 Log every AI action (price suggestions, skips, ad boosts, etc.)
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
  if (error)
    console.error("❌ Failed to log AI action:", error.message);
  else
    console.log(`🧾 Logged AI action: ${action} for product ${product_id}`);
}

// 🧠 Generate a reasoning string
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

// 🧮 Calculate the optimal price (uses performance + event + risk)
function calculateOptimalPrice(product, performance, event, risk_level) {
  const price = parseFloat(product.price);
  let newPrice = price;

  // Base logic: use performance
  if (
    performance?.profit_margin > 0.25 &&
    performance?.conversion_rate > 0.08
  ) {
    newPrice = price * 1.08;
  }
  if (performance?.conversion_rate < 0.02) {
    newPrice = price * 0.95;
  }
  if (product.inventory_quantity < 5) {
    newPrice = price * 1.1;
  }
  if (
    event &&
    event.product_keywords?.some((k) =>
      product.title.toLowerCase().includes(k.toLowerCase())
    )
  ) {
    newPrice = price * 1.15;
  }

  // Risk tuning
  if (risk_level === "safe") {
    // Soften moves
    newPrice = price + (newPrice - price) * 0.5;
  } else if (risk_level === "aggressive") {
    // Amplify moves
    newPrice = price + (newPrice - price) * 1.5;
  }

  // Round to 2 decimals
  return Math.round(newPrice * 100) / 100;
}

// 🧠 Main Autopilot Brain
export async function runAutopilot(shop) {
  console.log(`🤖 Running autopilot for ${shop}...`);

  // Counters for summary + autopilot_runs table
  let analyzedCount = 0;
  let priceSuggestions = 0;
  let appliedCount = 0;
  let skippedDueToFeedback = 0;
  let marketingSuggestions = 0;

  // 1️⃣ Seasonal event
  const { data: events } = await supabase
    .from("seasonal_events")
    .select("*")
    .eq("active", true);

  const activeEvent = events?.[0] || null;
  if (activeEvent) {
    console.log(`🗓️ Active event: ${activeEvent.name}`);
  }

  // 2️⃣ Shop mode + risk
  const { data: shopInfo } = await supabase
    .from("shops")
    .select("autopilot_mode, risk_level")
    .eq("shop_domain", shop)
    .single();

  const mode = shopInfo?.autopilot_mode || "manual";
  const risk = shopInfo?.risk_level || "normal";
  console.log(`🧭 Mode: ${mode} (risk: ${risk})`);

  // 3️⃣ Get products
  const { data: products, error } = await supabase
    .from("products")
    .select("*")
    .eq("shop_domain", shop);

  if (error) throw new Error(error.message);
  if (!products?.length) throw new Error("No products found.");

  // 4️⃣ Evaluate each product
  for (const p of products) {
    analyzedCount += 1;

    const { data: perf } = await supabase
      .from("product_performance")
      .select("*")
      .eq("shop_domain", shop)
      .eq("product_id", p.shopify_product_id)
      .maybeSingle();

    const currentPrice = parseFloat(p.price);
    const newPrice = calculateOptimalPrice(
      p,
      perf,
      activeEvent,
      risk
    );
    const priceChanged = newPrice !== currentPrice;

    // 🧩 Check AI feedback before deciding
    const trend = await getFeedbackTrends(
      shop,
      p.shopify_product_id,
      "price_adjustment"
    );

    if (trend.rejected > trend.approved * 2) {
      console.log(
        `⚖️ Skipping price change for ${p.title} — user disagreed before`
      );
      skippedDueToFeedback += 1;
      await logAIAction(
        shop,
        p.shopify_product_id,
        "price_skipped_due_to_feedback",
        { mode, risk },
        "Skipped due to repeated user rejection.",
        "skipped"
      );
    } else if (priceChanged) {
      const reason = generateReason(
        p,
        perf,
        newPrice,
        currentPrice,
        activeEvent
      );

      console.log(
        `💹 ${p.title}: £${currentPrice.toFixed(
          2
        )} → £${newPrice.toFixed(2)} (${mode} mode)`
      );
      console.log(`🧠 Reason: ${reason}`);

      priceSuggestions += 1;

      await logAIAction(
        shop,
        p.shopify_product_id,
        "price_adjustment",
        {
          old_price: currentPrice,
          new_price: newPrice,
          mode,
          risk,
        },
        reason,
        mode === "full" ? "pending" : "suggested"
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

          if (!res.ok) {
            throw new Error("Shopify update failed");
          }

          // Update local DB price too
          const { error: upErr } = await supabase
            .from("products")
            .update({ price: newPrice })
            .eq("shopify_product_id", p.shopify_product_id)
            .eq("shop_domain", shop);

          if (upErr) {
            console.error(
              "⚠️ Failed to update price in Supabase:",
              upErr.message
            );
          } else {
            console.log(
              `💾 Supabase price updated for ${p.shopify_product_id}: £${newPrice.toFixed(
                2
              )}`
            );
          }

          appliedCount += 1;

          await logAIAction(
            shop,
            p.shopify_product_id,
            "price_applied",
            { new_price: newPrice, mode, risk },
            "Applied automatically due to Full AI mode.",
            "completed"
          );

          console.log(`✅ Price updated on Shopify: ${p.title}`);
        } catch (err) {
          console.error(`❌ Shopify update error: ${err.message}`);
        }
      }
    }

    // 📣 Marketing suggestion (ad boost)
    if (
      perf &&
      perf.conversion_rate > 0.05 &&
      perf.profit_margin > 0.2
    ) {
      marketingSuggestions += 1;

      await logAIAction(
        shop,
        p.shopify_product_id,
        "ad_boost_suggested",
        { mode, risk },
        "Strong performance — recommend increasing ad budget for this product.",
        "suggested"
      );

      console.log(
        `📣 Ad boost suggested for ${p.title} — strong performance detected`
      );
    }
  }

  console.log(
    `📊 Summary — analyzed: ${analyzedCount}, price_suggestions: ${priceSuggestions}, applied: ${appliedCount}, skipped_due_to_feedback: ${skippedDueToFeedback}, marketing_suggestions: ${marketingSuggestions}`
  );

  // 📝 Log the run into autopilot_runs
  try {
    const { error: runErr } = await supabase
      .from("autopilot_runs")
      .insert([
        {
          shop_domain: shop,
          mode,
          risk_level: risk,
          analyzed: analyzedCount,
          price_suggestions: priceSuggestions,
          applied: appliedCount,
          skipped_due_to_feedback: skippedDueToFeedback,
          marketing_suggestions: marketingSuggestions,
        },
      ]);

    if (runErr) {
      console.error(
        "⚠️ Failed to record autopilot run:",
        runErr.message
      );
    } else {
      console.log("🕒 Autopilot run recorded in autopilot_runs");
    }
  } catch (e) {
    console.error("⚠️ Unexpected error logging autopilot run:", e.message);
  }

  console.log(`✅ Autopilot finished for ${shop}`);
  return {
    ok: true,
    analyzed: analyzedCount,
    price_suggestions: priceSuggestions,
    applied: appliedCount,
    skipped_due_to_feedback: skippedDueToFeedback,
    marketing_suggestions: marketingSuggestions,
  };
}
