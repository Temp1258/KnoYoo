/**
 * AI Proxy Edge Function
 *
 * Receives AI chat requests from KnoYoo desktop,
 * validates JWT + subscription, then forwards to AI provider
 * using KnoYoo's own API keys.
 *
 * This way users never need to configure their own API keys.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY")!;

const FREE_MONTHLY_LIMIT = 30;
const PRO_MONTHLY_LIMIT = 999999; // effectively unlimited

Deno.serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Extract and verify JWT
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

  // Check user profile and usage
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("plan, ai_calls_used, ai_calls_limit, billing_cycle_start")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // Auto-create profile for new users
    await supabase.from("user_profiles").insert({ id: user.id, plan: "free" });
  }

  const limit = profile?.plan === "pro" ? PRO_MONTHLY_LIMIT : FREE_MONTHLY_LIMIT;
  const used = profile?.ai_calls_used ?? 0;

  if (used >= limit) {
    return Response.json(
      { error: "AI 调用次数已达上限，请升级到 Pro 版本" },
      { status: 402 }
    );
  }

  // Forward request to AI provider
  const body = await req.json();

  const aiResp = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: body.model || "deepseek-chat",
      messages: body.messages,
      temperature: body.temperature ?? 0.3,
      max_tokens: body.max_tokens,
    }),
  });

  if (!aiResp.ok) {
    const errText = await aiResp.text();
    return Response.json(
      { error: `AI provider error: ${aiResp.status}` },
      { status: aiResp.status }
    );
  }

  // Increment usage counter
  await supabase.rpc("increment_ai_usage", { p_user_id: user.id });

  // Log usage
  await supabase.from("usage_logs").insert({
    user_id: user.id,
    action: body.action || "chat",
    tokens_used: 0, // TODO: extract from AI response
  });

  const aiData = await aiResp.json();
  return Response.json(aiData, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
});
