// performance.js
import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 📊 List performance metrics for a shop
router.get("/list", async (req, res) => {
  const shop = req.query.shop;

  if (!shop) {
    return res.status(400).json({ ok: false, error: "Missing shop query param" });
  }

  try {
    const { data, error } = await supabase
      .from("product_performance")
      .select("*")
      .eq("shop_domain", shop);

    if (error) throw error;

    res.json({
      ok: true,
      count: data?.length || 0,
      performance: data || [],
    });
  } catch (err) {
    console.error("❌ Performance error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
