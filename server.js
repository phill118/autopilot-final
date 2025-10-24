// server.js
import express from "express";
import morgan from "morgan";
import dotenv from "dotenv";
import shopify from "./shopify.js";
import products from "./products.js"; 
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// ✅ Resolve __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Import the list route safely (works whether it's in /routes or root)
import productsList from "./productsList.js"; 
// 👉 If you keep the file inside a folder, change to:
// import productsList from "./routes/productsList.js";

const app = express();
app.use(morgan("dev"));
app.use(express.json());

// ✅ Home route
app.get("/", (_req, res) => {
  res.send(`
    <h1>🚀 Autopilot Final</h1>
    <p>Your app is installed and running!</p>
    <a href="/api/shopify/test">Run Shopify Test</a> |
    <a href="/api/products/sync?shop=all-sorts-dropped.myshopify.com">Sync Products</a> |
    <a href="/api/products/list?shop=all-sorts-dropped.myshopify.com">View Products</a>
  `);
});

// ✅ Health check
app.get("/api/status", (_req, res) => res.json({ ok: true }));

// ✅ Shopify routes
app.use("/api/shopify", shopify);

// ✅ Product routes
app.use("/api/products", products);
app.use("/api/products", productsList);

// ✅ Start server
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
  console.log(`🌍 App URL: ${process.env.SHOPIFY_APP_URL}`);
  console.log(`🧭 Using redirectUri: ${process.env.SHOPIFY_APP_URL}/api/shopify/callback`);
});
