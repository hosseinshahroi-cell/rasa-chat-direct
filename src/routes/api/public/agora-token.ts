import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Public endpoint for the standalone Rasa app to fetch Agora call tokens.
// The caller must send its Supabase access token as `Authorization: Bearer <token>`.
export const Route = createFileRoute("/api/public/agora-token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") || "";
        const jwt = auth.replace(/^Bearer\s+/i, "").trim();
        if (!jwt) {
          return Response.json({ error: "missing access token" }, { status: 401 });
        }

        const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          { auth: { persistSession: false } },
        );
        const { data: userData, error } = await supabase.auth.getUser(jwt);
        if (error || !userData.user) {
          return Response.json({ error: "invalid access token" }, { status: 401 });
        }

        let body: { channel?: unknown; uid?: unknown };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid json" }, { status: 400 });
        }
        const { channel, uid } = body;
        if (typeof channel !== "string" || channel.length === 0 || channel.length > 64) {
          return Response.json({ error: "invalid channel" }, { status: 400 });
        }
        if (typeof uid !== "number" || !Number.isInteger(uid) || uid < 1) {
          return Response.json({ error: "invalid uid" }, { status: 400 });
        }

        const { buildAgoraToken } = await import("@/lib/agora.server");
        return Response.json(buildAgoraToken(channel, uid));
      },
    },
  },
});
