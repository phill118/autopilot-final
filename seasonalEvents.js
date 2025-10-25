// seasonalEvents.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✅ Fetch upcoming active events
export async function getUpcomingEvents() {
  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("seasonal_events")
    .select("*")
    .eq("active", true)
    .gte("end_date", today)
    .order("start_date", { ascending: true });

  if (error) {
    console.error("❌ Error fetching events:", error.message);
    return [];
  }

  return data || [];
}
