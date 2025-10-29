// aiFeedback.js
import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🧩 Add feedback (approve/reject)
router.post("/add", async (req, res) => {
  const { shop_domain, product_id, action, feedback } = req.body;

  try {
    const { error } = await supabase.from("ai_feedback").insert([
      { shop_domain, product_id, action, feedback },
    ]);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Feedback insert failed:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;