// routes/productsList.js
import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✅  GET /api/products/list?shop=yourshop.myshopify.com
router.get("/list", async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).json({ ok: false, error: "Missing ?shop parameter" });
    }

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("shop_domain", shop)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json({ ok: true, count: data.length, products: data });
  } catch (err) {
    console.error("❌ List error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
