// shopify.js
import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

// ✅ Supabase client (for saving + reading tokens)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 👉 Helper: save access token for a shop
async function saveShopToken(shop_domain, access_token) {
  try {
    const { error } = await supabase
      .from("shops")
      .upsert(
        { shop_domain, access_token },
        { onConflict: "shop_domain" }
      );

    if (error) {
      console.error("❌ Failed to save shop token:", error.message);
    } else {
      console.log(`💾 Saved token for shop: ${shop_domain}`);
    }
  } catch (err) {
    console.error("❌ Exception saving shop token:", err.message);
  }
}

// 👉 Helper: read access token for a shop
async function getShopToken(shop_domain) {
  try {
    const { data, error } = await supabase
      .from("shops")
      .select("access_token")
      .eq("shop_domain", shop_domain)
      .maybeSingle();

    if (error) {
      console.error("❌ Failed to get shop token:", error.message);
      return null;
    }

    return data?.access_token || null;
  } catch (err) {
    console.error("❌ Exception getting shop token:", err.message);
    return null;
  }
}

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

// 2️⃣ Handle Shopify callback (save token)
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
    const response = await fetch("https://" + shop + "/admin/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code: code,
      }),
    });

    const data = await response.json();

    if (!data.access_token) {
      console.error("⚠️ Missing access token in response:", data);
      return res.status(500).send("Failed to retrieve access token.");
    }

    // ✅ Save in env (runtime) AND Supabase (persistent)
    process.env.SHOPIFY_ACCESS_TOKEN = data.access_token;
    await saveShopToken(shop, data.access_token);

    console.log("✅ Shopify store successfully connected!");
    console.log("🔑 Access Token:", data.access_token);

    res.send('✅ Shopify store successfully connected!');
  } catch (err) {
    console.error("❌ Error exchanging code for token:", err);
    res.status(500).send("Error exchanging code for token.");
  }
});

// 3️⃣ Test Shopify API connection
router.get("/test", async (_req, res) => {
  try {
    const shop = "all-sorts-dropped.myshopify.com";

    // Prefer stored token
    let token = await getShopToken(shop);
    if (!token) token = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing Shopify access token" });
    }

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
    res.json({ ok: true, shop: data.shop });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4️⃣ Update product price (used by Autopilot FULL mode)
router.post("/update-price", async (req, res) => {
  const { shop, product_id, new_price } = req.body;

  if (!shop || !product_id || !new_price) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing shop, product_id, or new_price" });
  }

  try {
    // Get token from DB or env
    let token = await getShopToken(shop);
    if (!token) token = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "No Shopify access token available for this shop",
      });
    }

    // 1) Fetch product to get variant ID
    const prodRes = await fetch(
      `https://${shop}/admin/api/2023-10/products/${product_id}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      }
    );

    const prodData = await prodRes.json();

    if (!prodRes.ok) {
      console.error("❌ Failed to load product from Shopify:", prodData);
      return res.status(500).json({
        ok: false,
        error: "Failed to load product from Shopify",
        details: prodData,
      });
    }

    const product = prodData.product;
    if (!product?.variants?.length) {
      return res
        .status(500)
        .json({ ok: false, error: "Product has no variants to update" });
    }

    const primaryVariant = product.variants[0];

    // 2) Send price update
    const body = {
      product: {
        id: product.id,
        variants: [
          {
            id: primaryVariant.id,
            price: String(new_price),
          },
        ],
      },
    };

    const updateRes = await fetch(
      `https://${shop}/admin/api/2023-10/products/${product_id}.json`,
      {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const updateData = await updateRes.json();

    if (!updateRes.ok) {
      console.error("❌ Shopify update error:", updateData);
      return res.status(500).json({
        ok: false,
        error: "Failed to update price on Shopify",
        details: updateData,
      });
    }

    console.log(
      `💰 Shopify price updated for product ${product_id} → £${new_price}`
    );
    return res.json({ ok: true, product: updateData.product });
  } catch (err) {
    console.error("❌ Exception in /update-price:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
