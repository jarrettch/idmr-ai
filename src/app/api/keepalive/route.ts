import { supabase } from "@/lib/supabase";

// Runs on a daily Vercel Cron (see vercel.json) to keep the free-tier Supabase
// project active. Supabase recommends a few user database requests per day,
// while Vercel Hobby permits only one cron invocation per day, so one
// invocation performs several lightweight reads.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Vercel Cron attaches `Authorization: Bearer <CRON_SECRET>` when the
  // CRON_SECRET env var is set. If it's set, require it so the endpoint can't
  // be hit by arbitrary traffic; if unset, stay open so the ping still works.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const probes = await Promise.all([
    supabase.from("documents").select("id").limit(1),
    supabase.from("chunks").select("id").limit(1),
    supabase
      .from("documents")
      .select("id")
      .order("id", { ascending: false })
      .limit(1),
  ]);
  const error = probes.find((probe) => probe.error)?.error;
  if (error) {
    return Response.json(
      { ok: false, probes: probes.length, error: error.message },
      { status: 500 }
    );
  }

  return Response.json({
    ok: true,
    probes: probes.length,
    ts: new Date().toISOString(),
  });
}
