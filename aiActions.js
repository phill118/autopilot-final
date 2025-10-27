// aiActions.js
import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✅ 1️⃣ Get all AI actions for a shop
router.get("/list", async (req, res) => {
  const { shop } = req.query;

  if (!shop) {
    return res.status(400).json({ ok: false, error: "Missing shop parameter" });
  }

  const { data, error } = await supabase
    .from("ai_actions")
    .select("*")
    .eq("shop_domain", shop)
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  res.json({ ok: true, count: data.length, actions: data });
});

// ✅ 2️⃣ Update AI action (approve/reject) — includes feedback
router.post("/update", async (req, res) => {
  const { id, status } = req.body;

  if (!id || !status) {
    return res.status(400).json({ ok: false, error: "Missing id or status" });
  }

  const { data: actionData, error: actionError } = await supabase
    .from("ai_actions")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (actionError) {
    return res.status(500).json({ ok: false, error: actionError.message });
  }

  const feedback = {
    shop_domain: actionData.shop_domain,
    product_id: actionData.product_id,
    action: actionData.action,
    feedback: status === "approved" ? "approved" : "rejected",
    reason: actionData.reason || "user feedback"
  };

  const { error: feedbackError } = await supabase
    .from("ai_feedback")
    .insert([feedback]);

  if (feedbackError) {
    console.error("⚠️ Failed to record feedback:", feedbackError.message);
  } else {
    console.log(`🧠 Feedback recorded: ${feedback.feedback} → ${feedback.action}`);
  }

  res.json({ ok: true, message: `Action ${id} marked as ${status}` });
});

export default router;
