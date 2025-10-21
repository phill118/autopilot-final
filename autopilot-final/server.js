import express from "express";
import morgan from "morgan";
import dotenv from "dotenv";
import shopify from "./shopify.js";

dotenv.config();

const app = express();
app.use(morgan("dev"));
app.use(express.json());

app.get("/api/status", (_req, res) => res.json({ ok: true }));

app.use("/api/shopify", shopify);

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
  console.log(`🌍 App URL: ${process.env.SHOPIFY_APP_URL}`);
});
