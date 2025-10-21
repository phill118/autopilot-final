import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const router = express.Router();

router.get("/auth", (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send("Missing ?shop parameter");

  const state = crypto.randomBytes(8).toString("hex");

  // ✅ Remove any trailing slash from base URL
  let baseUrl = process.env.SHOPIFY_APP_URL || "";
  baseUrl = baseUrl.replace(/\/+$/, "");

  const redirectUri = `${baseUrl}/api/shopify/callback`;
  console.log("🧭 Using redirectUri:", redirectUri);

  const scopes = process.env.SCOPES;
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${
    process.env.SHOPIFY_API_KEY
  }&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&state=${state}`;

  res.redirect(installUrl);
});

router.get("/callback", async (req, res) => {
  const { shop, hmac, code } = req.query;
  if (!shop || !hmac || !code)
    return res.status(400).send("Missing parameters");

  const message = Object.keys(req.query)
    .filter((k) => k !== "hmac")
    .sort()
    .map((k) => `${k}=${req.query[k]}`)
    .join("&");

  const generatedHmac = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");

  if (generatedHmac !== hmac)
    return res.status(400).send("Invalid HMAC signature");

  try {
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      }),
    });

    const data = await response.json();
    process.env.SHOPIFY_ACCESS_TOKEN = data.access_token;
    console.log("✅ Shopify store successfully connected!");
    res.send("✅ Shopify store successfully connected!");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error exchanging code for token.");
  }
});

export default router;
