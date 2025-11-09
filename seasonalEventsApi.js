// seasonalEventsApi.js
import express from "express";
import { getUpcomingEvents } from "./seasonalEvents.js";

const router = express.Router();

// GET /api/events/next
router.get("/next", async (req, res) => {
  try {
    const events = await getUpcomingEvents();
    res.json({ ok: true, events });
  } catch (err) {
    console.error("❌ /api/events/next error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
