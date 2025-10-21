import express from "express";
import morgan from "morgan";
import dotenv from "dotenv";
import shopify from "./shopify.js";
import products from "./products.js"; // 👈 NEW import

dotenv.config();

const app = express();
app.use(morgan("dev"));
app.use(express.json());

// ✅ Add a simple home route (so Shopify has something to show)
app.get("/", (_req, res) => {
  res.send(`
    <h1>🚀 Autopilot Final</h1>
    <p>Your app is installed and running!</p>
    <a href="/api/shopify/test">Run Shopify Test</a> |
    <a href="/api/products/sync?shop=all-sorts-dropped.myshopify.com">Sync Products</a>
  `);
});

// ✅ Health/status
app.get("/api/status", (_req, res) => res.json({ ok: true }));

// ✅ Shopify routes
app.use("/api/shopify", shopify);

// ✅ Product routes
app.use("/api/products", products); // 👈 NEW line

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
  console.log(`🌍 App URL: ${process.env.SHOPIFY_APP_URL}`);
  console.log(`🧭 Using redirectUri: ${process.env.SHOPIFY_APP_URL}/api/shopify/callback`);
});
