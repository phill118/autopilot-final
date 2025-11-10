// shopify.js
import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

// 🔗 Supabase client (for updating product prices in our DB)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 1️⃣ Start Shopify OAuth
router.get("/auth", (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send("Missing ?shop parameter");
  }

  const state = crypto.randomBytes(8).toString("hex");
  const redirectUri = process.env.SHOPIFY_APP_URL + "/api/shopify/callback";
  const scopes =
    process.env.SCOPES ||
    "read_products,write_products,read_orders,write_orders,read_inventory,write_inventory";

  const installUrl =
    "https://" +
    shop +
    "/admin/oauth/authorize?client_id=" +
    process.env.SHOPIFY_API_KEY +
    "&scope=" +
    encodeURIComponent(scopes) +
    "&redirect_uri=" +
    encodeURIComponent(redirectUri) +
    "&state=" +
    state;

  console.log("🧭 Redirecting to:", installUrl);
  res.redirect(installUrl);
});

// 2️⃣ Handle Shopify callback
router.get("/callback", async (req, res) => {
  const shop = req.query.shop;
  const hmac = req.query.hmac;
  const code = req.query.code;

  if (!shop || !hmac || !code) {
    return res.status(400).send("Missing parameters");
  }

  // Verify HMAC
  const message = Object.keys(req.query)
    .filter((key) => key !== "hmac")
    .sort()
    .map((key) => key + "=" + req.query[key])
    .join("&");

  const generatedHmac = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");

  if (generatedHmac !== hmac) {
    return res.status(400).send("Invalid HMAC signature");
  }

  try {
    const response = await fetch(
      "https://" + shop + "/admin/oauth/access_token",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: process.env.SHOPIFY_API_KEY,
          client_secret: process.env.SHOPIFY_API_SECRET,
          code: code,
        }),
      }
    );

    const data = await response.json();

    if (!data.access_token) {
      console.error("⚠️ Missing access token in response:", data);
      return res.status(500).send("Failed to retrieve access token.");
    }

    // ⚠️ In production you should store this in Supabase, not in process.env
    process.env.SHOPIFY_ACCESS_TOKEN = data.access_token;
    console.log("✅ Shopify store successfully connected!");
    console.log("🔑 Access Token:", data.access_token);

    res.send("✅ Shopify store successfully connected!");
  } catch (err) {
    console.error("❌ Error exchanging code for token:", err);
    res.status(500).send("Error exchanging code for token.");
  }
});

// 3️⃣ Test Shopify API connection
router.get("/test", async (_req, res) => {
  try {
    if (!process.env.SHOPIFY_ACCESS_TOKEN) {
      return res
        .status(401)
        .json({ ok: false, error: "Missing Shopify access token" });
    }

    const response = await fetch(
      "https://all-sorts-dropped.myshopify.com/admin/api/2023-10/shop.json",
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();
    res.json({ ok: true, shop: data.shop });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4️⃣ Stub: Update price in Supabase (placeholder for real Shopify update)
router.post("/update-price", async (req, res) => {
  const { shop, product_id, new_price } = req.body;

  if (!shop || !product_id || new_price == null) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing shop, product_id, or new_price" });
  }

  try {
    const { data, error } = await supabase
      .from("products")
      .update({ price: String(new_price) })
      .eq("shop_domain", shop)
      .eq("shopify_product_id", product_id)
      .select()
      .maybeSingle();

    if (error) throw error;

    console.log(`💾 Supabase price updated for ${product_id}: £${new_price}`);

    // 🔮 Later: extend this to call Shopify Admin API to update the real store price.

    res.json({ ok: true, product: data });
  } catch (err) {
    console.error("❌ /api/shopify/update-price error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
