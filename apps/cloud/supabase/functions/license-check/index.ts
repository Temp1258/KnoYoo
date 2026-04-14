/**
 * License Check Edge Function
 *
 * Desktop app calls this on startup to verify subscription status.
 * Returns the user's plan, usage stats, and expiry info.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Missing authorization" }, { status: 401 });
  }

  const jwt = authHeader.slice(7);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) {
    return Response.json({ error: "Invalid token" }, { status: 401 });
  }

  // Get profile
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  // Get active subscription
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "active")
    .single();

  const plan = subscription?.plan || profile?.plan || "free";
  const isProActive = plan === "pro" && subscription?.status === "active";

  return Response.json({
    user_id: user.id,
    plan,
    status: isProActive ? "pro" : "free",
    ai_calls_used: profile?.ai_calls_used ?? 0,
    ai_calls_limit: isProActive ? 999999 : 30,
    expires_at: subscription?.current_period_end || null,
    checked_at: new Date().toISOString(),
  }, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
});
