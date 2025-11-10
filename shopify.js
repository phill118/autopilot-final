// shopify.js
import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

// ✅ Supabase client (backend-only, safe)
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

// 2️⃣ Handle Shopify OAuth callback
router.get("/callback", async (req, res) => {
  const shop = req.query.shop;
  const hmac = req.query.hmac;
  const code = req.query.code;

  if (!shop || !hmac || !code) {
    return res.status(400).send("Missing parameters");
  }

  // ✅ Verify HMAC
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

    const accessToken = data.access_token;

    console.log("✅ Shopify store successfully connected!");
    console.log("🔑 Access Token:", accessToken);

    // ✅ Store token in Supabase shops table
    const { error: upsertError } = await supabase.from("shops").upsert(
      {
        shop_domain: shop,
        access_token: accessToken,
      },
      { onConflict: "shop_domain" } // requires unique constraint on shop_domain
    );

    if (upsertError) {
      console.error("❌ Failed to upsert shop token:", upsertError.message);
    } else {
      console.log(`🗃️ Stored access token for shop: ${shop}`);
    }

    res.send("✅ Shopify store successfully connected!");
  } catch (err) {
    console.error("❌ Error exchanging code for token:", err);
    res.status(500).send("Error exchanging code for token.");
  }
});

// 3️⃣ Test Shopify API connection
router.get("/test", async (req, res) => {
  const shop = req.query.shop || "all-sorts-dropped.myshopify.com";

  try {
    // ✅ Fetch token from Supabase
    const { data: shopRow, error } = await supabase
      .from("shops")
      .select("access_token")
      .eq("shop_domain", shop)
      .single();

    if (error || !shopRow?.access_token) {
      return res.status(401).json({
        ok: false,
        error: "No access token stored for this shop",
      });
    }

    const token = shopRow.access_token;

    const response = await fetch(
      `https://${shop}/admin/api/2023-10/shop.json`,
      {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("❌ Shopify test failed:", data);
      return res.status(500).json({ ok: false, error: data });
    }

    res.json({ ok: true, shop: data.shop });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4️⃣ Update price on Shopify (used by Autopilot in FULL mode)
router.post("/update-price", async (req, res) => {
  const { shop, product_id, new_price } = req.body;

  if (!shop || !product_id || !new_price) {
    return res
      .status(400)
      .json({ ok: false, error: "shop, product_id, new_price are required" });
  }

  try {
    // ✅ Get access token from Supabase
    const { data: shopRow, error: shopError } = await supabase
      .from("shops")
      .select("access_token")
      .eq("shop_domain", shop)
      .single();

    if (shopError || !shopRow?.access_token) {
      console.error("❌ No access token for shop:", shopError?.message);
      return res
        .status(401)
        .json({ ok: false, error: "Missing access token for this shop" });
    }

    const token = shopRow.access_token;

    // 4a️⃣ Fetch product to get its first variant
    const prodRes = await fetch(
      `https://${shop}/admin/api/2023-10/products/${product_id}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      }
    );
    const prodJson = await prodRes.json();

    if (!prodRes.ok) {
      console.error("❌ Shopify product fetch failed:", prodJson);
      throw new Error("Failed to fetch product from Shopify");
    }

    const variant = prodJson?.product?.variants?.[0];
    if (!variant) {
      throw new Error("No variants found for this product");
    }

    const variantId = variant.id;

    // 4b️⃣ Update the variant price
    const updateRes = await fetch(
      `https://${shop}/admin/api/2023-10/variants/${variantId}.json`,
      {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          variant: {
            id: variantId,
            price: new_price,
          },
        }),
      }
    );

    const updateJson = await updateRes.json();

    if (!updateRes.ok) {
      console.error("❌ Shopify price update failed:", updateJson);
      throw new Error("Failed to update price on Shopify");
    }

    // 4c️⃣ Keep Supabase in sync
    const { error: dbError } = await supabase
      .from("products")
      .update({ price: new_price })
      .eq("shop_domain", shop)
      .eq("shopify_product_id", product_id);

    if (dbError) {
      console.error("⚠️ Supabase price update failed:", dbError.message);
    }

    console.log(
      `✅ Price updated on Shopify for product ${product_id} → £${new_price}`
    );
    res.json({ ok: true, variant: updateJson.variant || null });
  } catch (err) {
    console.error("❌ Shopify update error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
