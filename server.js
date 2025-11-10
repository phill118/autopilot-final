// server.js
import express from "express";
import morgan from "morgan";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { runAutopilot } from "./autopilotEngine.js";

import shopify from "./shopify.js";
import products from "./products.js";
import productsList from "./productsList.js";
import aiActions from "./aiActions.js";
import aiFeedback from "./aiFeedback.js";
import performance from "./performance.js";
import eventsApi from "./seasonalEventsApi.js";

dotenv.config();

// ✅ Resolve __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const app = express();
app.use(morgan("dev"));
app.use(express.json());

// ✅ Enable CORS (for dashboard frontend)
app.use(
  cors({
    origin: "*", // later you can lock this to your Vercel domain
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ✅ Simple home page for testing
app.get("/", (_req, res) => {
  res.send(`
    <h1>🚀 Autopilot Final</h1>
    <p>Your app is installed and running!</p>
    <a href="/api/shopify/test">Run Shopify Test</a> |
    <a href="/api/products/sync?shop=all-sorts-dropped.myshopify.com">Sync Products</a> |
    <a href="/api/products/list?shop=all-sorts-dropped.myshopify.com">View Products</a>
  `);
});

// ✅ Health check route
app.get("/api/status", (_req, res) => res.json({ ok: true }));

// ✅ Shopify API routes
app.use("/api/shopify", shopify);

// 🧭 Update Autopilot Mode
app.post("/api/shopify/mode", async (req, res) => {
  const { shop, mode } = req.body;
  try {
    const { error } = await supabase
      .from("shops")
      .update({ autopilot_mode: mode })
      .eq("shop_domain", shop);

    if (error) throw error;
    console.log(`🧭 Mode for ${shop} updated to: ${mode}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Failed to update mode:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ⚖️ Update AI risk level
app.post("/api/shopify/risk", async (req, res) => {
  const { shop, risk } = req.body; // 👈 expects "risk" from frontend
  try {
    const { error } = await supabase
      .from("shops")
      .update({ risk_level: risk }) // 👈 writes into risk_level column
      .eq("shop_domain", shop);

    if (error) throw error;
    console.log(`⚖️ Risk level for ${shop} updated to: ${risk}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Failed to update risk level:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ Product API routes
app.use("/api/products", products);
app.use("/api/products", productsList);

// ✅ AI actions routes
app.use("/api/ai", aiActions);

// ✅ AI feedback routes
app.use("/api/feedback", aiFeedback);

// ✅ Performance routes
app.use("/api/performance", performance);

// ✅ Seasonal events
app.use("/api/events", eventsApi);

// ✅ Autopilot AI Route
app.get("/api/autopilot/run", async (req, res) => {
  const shop = req.query.shop || "all-sorts-dropped.myshopify.com";
  try {
    const result = await runAutopilot(shop);
    res.json({
      ok: true,
      message: "Autopilot completed successfully",
      ...result,
    });
  } catch (err) {
    console.error("❌ Autopilot error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ Start the server
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
  console.log(`🌍 App URL: ${process.env.SHOPIFY_APP_URL}`);
  console.log(
    `🧭 Using redirectUri: ${process.env.SHOPIFY_APP_URL}/api/shopify/callback`
  );
});
