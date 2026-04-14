# KnoYoo Cloud Backend

Cloud service layer for KnoYoo. Handles authentication, AI proxy, and subscription management.
User data remains 100% local — this backend only manages auth, billing, and AI API proxying.

## Architecture

```
Supabase Auth (Google/Apple/Email login)
    |
Supabase Edge Functions
    ├── ai-proxy: Forwards AI requests using KnoYoo's API keys
    ├── license-check: Validates subscription status
    └── webhooks: Handles LemonSqueezy payment events
    |
Supabase PostgreSQL
    ├── users: User profiles and device registration
    ├── subscriptions: Subscription status and usage tracking
    └── usage_logs: AI call metering per user
```

## Setup

1. Create a Supabase project at https://supabase.com
2. Copy `.env.example` to `.env` and fill in your keys
3. Run migrations: `supabase db push`
4. Deploy edge functions: `supabase functions deploy`
5. Set up LemonSqueezy webhook to point to your edge function URL

## Tech Stack

- **Auth**: Supabase Auth
- **Database**: Supabase PostgreSQL
- **Edge Functions**: Deno (TypeScript)
- **Payments**: LemonSqueezy
