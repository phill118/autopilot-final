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

export default router;
