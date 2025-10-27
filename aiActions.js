// aiActions.js
import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✅ Fetch AI actions for a shop
router.get("/list", async (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).json({ ok: false, error: "Missing shop" });

  const { data, error } = await supabase
    .from("ai_actions")
    .select("*")
    .eq("shop_domain", shop)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true, count: data.length, actions: data });
});

// ✅ Update action status (approve or reject) + record feedback
router.post("/update", async (req, res) => {
  const { id, status } = req.body;

  if (!id || !status) {
    return res.status(400).json({ ok: false, error: "Missing id or status" });
  }

  // 1️⃣ Update ai_actions table
  const { data: actionData, error: actionError } = await supabase
    .from("ai_actions")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (actionError) {
    return res.status(500).json({ ok: false, error: actionError.message });
  }

  // 2️⃣ Record feedback in ai_feedback for long-term learning
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
