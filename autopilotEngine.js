// autopilotEngine.js
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import { getUpcomingEvents } from "./seasonalEvents.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🧠 Learn from past AI feedback (shared for pricing + ads)
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
  if (error) console.error("❌ Failed to log AI action:", error.message);
  else console.log(`🧾 Logged AI action: ${action} for product ${product_id}`);
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

// 🧮 Calculate the optimal price
function calculateOptimalPrice(product, performance, event, riskLevel) {
  let price = parseFloat(product.price);
  let newPrice = price;

  const conv = performance?.conversion_rate ?? 0;
  const margin = performance?.profit_margin ?? 0;

  // Base logic
  if (margin > 0.25 && conv > 0.08) {
    // winning product
    newPrice = price * (riskLevel === "aggressive" ? 1.12 : 1.08);
  }

  if (conv < 0.02) {
    // underperformer
    newPrice = price * (riskLevel === "aggressive" ? 0.9 : 0.95);
  }

  if (product.inventory_quantity < 5) {
    // protect margin on low stock
    newPrice = price * (riskLevel === "safe" ? 1.05 : 1.1);
  }

  if (
    event &&
    event.product_keywords?.some((k) =>
      product.title.toLowerCase().includes(k.toLowerCase())
    )
  ) {
    // seasonal bump
    newPrice = newPrice * (riskLevel === "aggressive" ? 1.2 : 1.15);
  }

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

    // 🧮 Price decision
    const currentPrice = parseFloat(p.price);
    const newPrice = calculateOptimalPrice(p, perf, activeEvent, risk);
    const priceChanged = newPrice !== currentPrice;

    // 🔁 4a. PRICE FEEDBACK — has user rejected these often?
    const priceTrend = await getFeedbackTrends(
      shop,
      p.shopify_product_id,
      "price_adjustment"
    );

    if (priceTrend.rejected > priceTrend.approved * 2) {
      console.log(
        `⚖️ Skipping price change for ${p.title} — user disagreed before`
      );
      skippedDueToFeedback++;

      await logAIAction(
        shop,
        p.shopify_product_id,
        "price_skipped_due_to_feedback",
        { old_price: p.price, suggested_price: newPrice },
        "Skipped due to repeated user rejection.",
        "skipped"
      );

      // ⛔ Do NOT change price, but still consider marketing below
    } else if (priceChanged) {
      const reason = generateReason(
        p,
        perf,
        newPrice,
        currentPrice,
        activeEvent
      );
      console.log(`💹 ${p.title}: £${p.price} → £${newPrice} (${mode} mode)`);
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
          risk,
        },
        reason,
        mode === "full" && risk !== "safe" ? "pending_apply" : "suggested"
      );

      // Apply automatically in FULL mode (except safe risk)
      if (mode === "full" && risk !== "safe") {
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
          applied++;
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

    // 🔍 4b. MARKETING / AD BOOST — only if performance is strong
    const conv = perf?.conversion_rate ?? 0;
    const margin = perf?.profit_margin ?? 0;

    let isWinner =
      conv > 0.05 && margin > 0.25; // baseline "winner" rule

    if (
      activeEvent &&
      activeEvent.product_keywords?.some((k) =>
        p.title.toLowerCase().includes(k.toLowerCase())
      )
    ) {
      // seasonal alignment makes it more winner-like
      isWinner = true;
    }

    if (isWinner) {
      // 🔁 Check marketing feedback
      const adTrend = await getFeedbackTrends(
        shop,
        p.shopify_product_id,
        "ad_boost_suggested"
      );

      if (adTrend.rejected > adTrend.approved * 2) {
        console.log(
          `📉 Not suggesting ads for ${p.title} — user repeatedly rejected ad boosts`
        );
        skippedDueToFeedback++;

        await logAIAction(
          shop,
          p.shopify_product_id,
          "ad_boost_skipped_due_to_feedback",
          { conv, margin, risk },
          "Skipped ad boost due to repeated user rejection.",
          "skipped"
        );
      } else {
        let reason = "Strong performance — recommend increasing ad budget ";
        reason += `for this product (conv=${Math.round(
          conv * 100
        )}%, margin=${Math.round(margin * 100)}%). `;

        if (activeEvent) {
          reason += `Also relevant for ${activeEvent.name}, good candidate for seasonal campaigns. `;
        }

        if (adTrend.approved >= 2 && risk === "aggressive") {
          reason +=
            "User has approved similar ad boosts before — treating as high-confidence winner.";
        }

        await logAIAction(
          shop,
          p.shopify_product_id,
          "ad_boost_suggested",
          { conv, margin, risk, event: activeEvent?.name || null },
          reason,
          "suggested"
        );
        marketingSuggestions++;
        console.log(
          `📣 Ad boost suggested for ${p.title} — strong performance detected`
        );
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
