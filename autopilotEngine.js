// autopilotEngine.js
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import { getUpcomingEvents } from "./seasonalEvents.js";

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
    {
      shop_domain,
      product_id,
      action,
      details,
      reason,
      status,
    },
  ]);
  if (error) {
    console.error("❌ Failed to log AI action:", error.message);
  } else {
    console.log(`🧾 Logged AI action: ${action} for product ${product_id}`);
  }
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

  reason += `Risk profile: ${risk}. `;

  return reason.trim();
}

// 🧮 Calculate the optimal price, scaled by risk
function calculateOptimalPrice(product, performance, event, risk = "normal") {
  const price = parseFloat(product.price);
  let newPrice = price;

  // Base rule-driven price (before risk scaling)
  let basePrice = price;

  if (performance?.profit_margin > 0.25 && performance?.conversion_rate > 0.08) {
    basePrice = price * 1.08; // strong performer → +8%
  }
  if (performance?.conversion_rate < 0.02) {
    basePrice = price * 0.95; // almost no conversions → -5%
  }
  if (product.inventory_quantity < 5) {
    basePrice = price * 1.1; // low stock → +10%
  }
  if (
    event &&
    event.product_keywords?.some((k) =>
      product.title.toLowerCase().includes(k.toLowerCase())
    )
  ) {
    basePrice = price * 1.15; // seasonal relevance → +15%
  }

  // If no rule triggered, no change
  if (basePrice === price) {
    return price;
  }

  // 🎚️ Risk scaling
  const rawChangePct = (basePrice - price) / price; // e.g. +0.08 = +8%
  let scaledChangePct = rawChangePct;

  if (risk === "safe") {
    // Half the aggressiveness
    scaledChangePct = rawChangePct * 0.5;
  } else if (risk === "aggressive") {
    // 1.5x the aggressiveness
    scaledChangePct = rawChangePct * 1.5;
  }

  newPrice = price * (1 + scaledChangePct);

  // Round to 2 decimals
  return Math.round(newPrice * 100) / 100;
}

// 🧠 Main Autopilot Brain
export async function runAutopilot(shop) {
  console.log(`🤖 Running autopilot for ${shop}...`);

  // 1️⃣ Seasonal event
  const { data: events } = await supabase
    .from("seasonal_events")
    .select("*")
    .eq("active", true);

  const activeEvent = events?.[0] || null;
  if (activeEvent) {
    console.log(`🗓️ Active event: ${activeEvent.name}`);
  }

  // 2️⃣ Shop mode + risk level
  const { data: shopInfo, error: shopError } = await supabase
    .from("shops")
    .select("autopilot_mode, risk_level")
    .eq("shop_domain", shop)
    .single();

  if (shopError) {
    console.error("❌ Failed to load shop info:", shopError.message);
    throw new Error(shopError.message);
  }

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

  let analyzed = 0;
  let priceSuggestions = 0;
  let applied = 0;
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

    // 🧮 Price logic with risk
    const newPrice = calculateOptimalPrice(p, perf, activeEvent, risk);
    const priceChanged = newPrice !== parseFloat(p.price);

    if (priceChanged) {
      // 🧠 Check AI feedback first
      const trend = await getFeedbackTrends(
        shop,
        p.shopify_product_id,
        "price_adjustment"
      );

      let skipDueToFeedback = false;

      // 🧠 Respect user feedback more in SAFE/NORMAL, less in AGGRESSIVE
      if (trend.rejected > trend.approved * 2) {
        if (risk === "safe" || risk === "normal") {
          skipDueToFeedback = true;
        } else if (risk === "aggressive" && trend.rejected > trend.approved * 5) {
          skipDueToFeedback = true;
        }
      }

      if (skipDueToFeedback) {
        console.log(
          `⚖️ Skipping price change for ${p.title} — user disagreed before`
        );
        await logAIAction(
          shop,
          p.shopify_product_id,
          "price_skipped_due_to_feedback",
          { mode, risk },
          "User has repeatedly rejected similar price changes; respecting feedback.",
          "skipped"
        );
        skippedDueToFeedback++;
      } else {
        const reason = generateReason(
          p,
          perf,
          newPrice,
          parseFloat(p.price),
          activeEvent,
          risk
        );
        console.log(
          `💹 ${p.title}: £${p.price} → £${newPrice} (${mode} mode)`
        );
        console.log(`🧠 Reason: ${reason}`);

        await logAIAction(
          shop,
          p.shopify_product_id,
          "price_adjustment",
          {
            old_price: p.price,
            new_price: newPrice,
            mode,
            risk,
          },
          reason,
          "suggested"
        );
        priceSuggestions++;

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
            await logAIAction(
              shop,
              p.shopify_product_id,
              "price_applied",
              { new_price: newPrice, mode, risk },
              "Applied automatically due to Full AI mode.",
              "completed"
            );
            console.log(`✅ Price updated on Shopify: ${p.title}`);
            applied++;
          } catch (err) {
            console.error(`❌ Shopify update error: ${err.message}`);
          }
        }
      }
    }

    // 📣 Marketing / Ad suggestions (risk-aware)
    if (perf) {
      const conv = perf.conversion_rate || 0;
      const margin = perf.profit_margin || 0;

      // Baseline thresholds
      let convThreshold = 0.06;
      let marginThreshold = 0.2;

      if (risk === "safe") {
        convThreshold = 0.08; // only very strong performers
        marginThreshold = 0.25;
      } else if (risk === "aggressive") {
        convThreshold = 0.04; // more willing to push
        marginThreshold = 0.15;
      }

      if (conv >= convThreshold && margin >= marginThreshold) {
        await logAIAction(
          shop,
          p.shopify_product_id,
          "ad_boost_suggested",
          {
            conversion_rate: conv,
            profit_margin: margin,
            mode,
            risk,
          },
          "Strong performance — recommend increasing ad budget for this product.",
          "suggested"
        );
        console.log(
          `📣 Ad boost suggested for ${p.title} — strong performance detected`
        );
        marketingSuggestions++;
      }
    }
  }

  console.log(
    `📊 Summary — analyzed: ${analyzed}, price_suggestions: ${priceSuggestions}, applied: ${applied}, skipped_due_to_feedback: ${skippedDueToFeedback}, marketing_suggestions: ${marketingSuggestions}`
  );

  console.log(`✅ Autopilot finished for ${shop}`);
  return {
    ok: true,
    analyzed,
    price_suggestions: priceSuggestions,
    applied,
    skipped_due_to_feedback: skippedDueToFeedback,
    marketing_suggestions: marketingSuggestions,
  };
}
