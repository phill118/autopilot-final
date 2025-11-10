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

// 🧾 Log every AI action
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
function generateReason(product, performance, newPrice, oldPrice, event, risk) {
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
  if (risk === "safe")
    reason += "Using safe risk level (softer adjustments). ";
  if (risk === "aggressive")
    reason += "Using aggressive risk level (bolder adjustments). ";

  return reason.trim();
}

// 🧮 Calculate a *base* optimal price (before risk scaling)
function calculateBasePrice(product, performance, event) {
  const price = parseFloat(product.price);
  let newPrice = price;

  // High margin + strong conversion → gentle increase
  if (
    performance?.profit_margin > 0.25 &&
    performance?.conversion_rate > 0.08
  ) {
    newPrice = price * 1.08;
  }

  // Very low conversion → test a lower price
  if (performance?.conversion_rate < 0.02) {
    newPrice = price * 0.95;
  }

  // Low inventory → protect margin
  if (product.inventory_quantity < 5) {
    newPrice = price * 1.1;
  }

  // Seasonal event match → demand spike
  if (
    event &&
    event.product_keywords?.some((k) =>
      product.title.toLowerCase().includes(k.toLowerCase())
    )
  ) {
    newPrice = price * 1.15;
  }

  return Math.round(newPrice * 100) / 100;
}

// 🎚️ Apply risk level scaling to the price change
function applyRiskLevel(oldPrice, baseNewPrice, riskLevel) {
  if (!baseNewPrice || baseNewPrice === oldPrice) return oldPrice;

  const diff = baseNewPrice - oldPrice;
  let scaledDiff = diff;

  switch (riskLevel) {
    case "safe":
      // Only half as bold
      scaledDiff = diff * 0.5;
      break;
    case "aggressive":
      // 50% more aggressive
      scaledDiff = diff * 1.5;
      break;
    case "normal":
    default:
      // Use base change
      scaledDiff = diff;
      break;
  }

  const finalPrice = oldPrice + scaledDiff;
  return Math.round(finalPrice * 100) / 100;
}

// 🧠 Main Autopilot Brain
export async function runAutopilot(shop) {
  console.log(`🤖 Running autopilot for ${shop}...`);

  // 1️⃣ Seasonal event (from DB)
  const { data: events } = await supabase
    .from("seasonal_events")
    .select("*")
    .eq("active", true)
    .order("start_date", { ascending: true });

  const activeEvent = events?.[0] || null;
  if (activeEvent) {
    console.log(`🗓️ Active event: ${activeEvent.name}`);
  } else {
    console.log("🕐 No active seasonal event.");
  }

  // 2️⃣ Shop mode + risk level
  const { data: shopInfo } = await supabase
    .from("shops")
    .select("autopilot_mode, risk_level")
    .eq("shop_domain", shop)
    .maybeSingle();

  const mode = shopInfo?.autopilot_mode || "manual";
  const riskLevel = shopInfo?.risk_level || "normal";
  console.log(`🧭 Mode: ${mode} (risk: ${riskLevel})`);

  // 3️⃣ Get products
  const { data: products, error } = await supabase
    .from("products")
    .select("*")
    .eq("shop_domain", shop);

  if (error) throw new Error(error.message);
  if (!products?.length) throw new Error("No products found.");

  let analyzed = 0;
  let priceSuggestions = 0;
  let applied = 0;
  let skippedByFeedback = 0;
  let marketingSuggestions = 0;

  // 4️⃣ Evaluate each product
  for (const p of products) {
    analyzed++;

    const oldPrice = parseFloat(p.price);

    // 🔎 Performance snapshot
    const { data: perf } = await supabase
      .from("product_performance")
      .select("*")
      .eq("shop_domain", shop)
      .eq("product_id", p.shopify_product_id)
      .maybeSingle();

    // 🧮 Base price from rules
    const baseNewPrice = calculateBasePrice(p, perf, activeEvent);
    const baseChanged = baseNewPrice !== oldPrice;

    // 🧠 Feedback trends for price changes
    const trend = await getFeedbackTrends(
      shop,
      p.shopify_product_id,
      "price_adjustment"
    );

    if (trend.rejected > trend.approved * 2) {
      console.log(
        `⚖️ Skipping price change for ${p.title} — user disagreed before`
      );
      skippedByFeedback++;

      await logAIAction(
        shop,
        p.shopify_product_id,
        "price_skipped_due_to_feedback",
        { old_price: p.price, mode, risk_level: riskLevel },
        "Skipped due to repeated user rejection",
        "skipped"
      );

      // Still can suggest marketing actions below
    } else if (baseChanged) {
      // 🎚️ Apply risk level to the base price
      const riskAdjustedPrice = applyRiskLevel(
        oldPrice,
        baseNewPrice,
        riskLevel
      );
      const priceChanged = riskAdjustedPrice !== oldPrice;

      if (priceChanged) {
        priceSuggestions++;
        const reason = generateReason(
          p,
          perf,
          riskAdjustedPrice,
          oldPrice,
          activeEvent,
          riskLevel
        );

        console.log(
          `💹 ${p.title}: £${oldPrice} → £${riskAdjustedPrice} (${mode} mode, risk: ${riskLevel})`
        );
        console.log(`🧠 Reason: ${reason}`);

        await logAIAction(
          shop,
          p.shopify_product_id,
          "price_adjustment",
          {
            old_price: oldPrice,
            base_price: baseNewPrice,
            new_price: riskAdjustedPrice,
            mode,
            risk_level: riskLevel,
          },
          reason
        );

        // 🚀 FULL mode → actually update Shopify
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
                  new_price: riskAdjustedPrice,
                }),
              }
            );

            if (!res.ok) throw new Error("Shopify update failed");

            await logAIAction(
              shop,
              p.shopify_product_id,
              "price_applied",
              { new_price: riskAdjustedPrice, mode, risk_level: riskLevel },
              "Applied automatically due to Full AI mode.",
              "completed"
            );

            applied++;
            console.log(`✅ Price updated on Shopify: ${p.title}`);
          } catch (err) {
            console.error(`❌ Shopify update error: ${err.message}`);
          }
        }
      }
    }

    // 📣 Marketing / Ad suggestions
    if (
      perf &&
      perf.conversion_rate >= 0.05 &&
      perf.profit_margin >= 0.3
    ) {
      marketingSuggestions++;
      await logAIAction(
        shop,
        p.shopify_product_id,
        "ad_boost_suggested",
        { mode, risk_level: riskLevel },
        "Strong performance — recommend increasing ad budget for this product."
      );
      console.log(
        `📣 Ad boost suggested for ${p.title} — strong performance detected`
      );
    }
  }

  console.log(
    `📊 Summary — analyzed: ${analyzed}, price_suggestions: ${priceSuggestions}, applied: ${applied}, skipped_due_to_feedback: ${skippedByFeedback}, marketing_suggestions: ${marketingSuggestions}`
  );

  console.log(`✅ Autopilot finished for ${shop}`);
  return {
    ok: true,
    analyzed,
    priceSuggestions,
    applied,
    skippedByFeedback,
    marketingSuggestions,
  };
}
