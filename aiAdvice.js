// aiAdvice.js
import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🧠 AI config advice based on feedback
router.get("/advice", async (req, res) => {
  const shop = req.query.shop;

  if (!shop) {
    return res.status(400).json({ ok: false, error: "Missing shop parameter" });
  }

  try {
    const { data, error } = await supabase
      .from("ai_feedback")
      .select("feedback")
      .eq("shop_domain", shop);

    if (error) throw error;

    const total = data.length;
    const approved = data.filter((r) => r.feedback === "approved").length;
    const rejected = data.filter((r) => r.feedback === "rejected").length;

    let recommended_mode = "assist";
    let recommended_risk = "normal";
    let reason = "";

    if (total < 10) {
      reason =
        "Not enough feedback yet — keep AI in Assist mode and Normal risk while you train it.";
    } else {
      const approvalRate = approved / total;

      if (approvalRate >= 0.7) {
        recommended_mode = "full";
        recommended_risk = "aggressive";
        reason =
          "You agree with most AI decisions — it's safe to let the AI run more aggressively.";
      } else if (approvalRate <= 0.3) {
        recommended_mode = "assist";
        recommended_risk = "safe";
        reason =
          "You reject most AI decisions — stay in Assist mode with Safe risk until the AI learns your style.";
      } else {
        recommended_mode = "assist";
        recommended_risk = "normal";
        reason =
          "Mixed feedback — keep Assist mode with Normal risk for a balanced approach.";
      }
    }

    res.json({
      ok: true,
      total,
      approved,
      rejected,
      recommended_mode,
      recommended_risk,
      reason,
    });
  } catch (err) {
    console.error("❌ AI advice error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
