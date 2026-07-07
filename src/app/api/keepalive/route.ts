import { supabase } from "@/lib/supabase";

// Runs on a daily Vercel Cron (see vercel.json) to keep the free-tier Supabase
// project from pausing after 7 days of inactivity. Any request resets that
// timer, so a trivial read is enough.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Vercel Cron attaches `Authorization: Bearer <CRON_SECRET>` when the
  // CRON_SECRET env var is set. If it's set, require it so the endpoint can't
  // be hit by arbitrary traffic; if unset, stay open so the ping still works.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { error } = await supabase.from("documents").select("id").limit(1);
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, ts: new Date().toISOString() });
}
