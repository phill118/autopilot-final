// products.js
import express from "express";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Helper: get token for shop
async function getToken(shop_domain) {
  const { data, error } = await supabase
    .from("shops")
    .select("access_token")
    .eq("shop_domain", shop_domain)
    .single();
  if (error) throw error;
  return data.access_token;
}

// ---- Sync products from Shopify into Supabase ----
router.get("/sync", async (req, res) => {
  const shop = req.query.shop || "all-sorts-dropped.myshopify.com";

  try {
    const token = await getToken(shop);
    if (!token) return res.status(401).json({ ok: false, error: "No token for this shop" });

    // Fetch products from Shopify
    const response = await fetch(
      `https://${shop}/admin/api/2025-10/products.json?limit=50`,
      {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      }
    );

    const { products } = await response.json();
    if (!products) return res.status(404).json({ ok: false, error: "No products returned" });

    // Upsert each product into Supabase
    for (const p of products) {
      const price = p.variants?.[0]?.price || null;
      const qty = p.variants?.[0]?.inventory_quantity || 0;
      const img = p.image?.src || null;

      const { error } = await supabase.rpc("upsert_product", {
  _shop_domain: shop,
  _shopify_product_id: p.id,
  _title: p.title,
  _status: p.status,
  _price: price,
  _inventory_quantity: qty,
  _image_url: img,
});

if (error) console.error("❌ Supabase error:", error.message);

    }

    res.json({ ok: true, count: products.length });

  } catch (err) {
    console.error("❌ Sync error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
