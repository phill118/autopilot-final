// autopilotRuns.js
import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/autopilot/runs?shop=all-sorts-dropped.myshopify.com
router.get("/runs", async (req, res) => {
  const shop = req.query.shop;

  if (!shop) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing ?shop= parameter" });
  }

  try {
    const { data, error } = await supabase
      .from("autopilot_runs")
      .select("*")
      .eq("shop_domain", shop)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;

    res.json({
      ok: true,
      runs: data || [],
    });
  } catch (err) {
    console.error("❌ Failed to fetch autopilot runs:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
