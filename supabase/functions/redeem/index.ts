// Pocket PEC activation function ("redeem").
//
// POST {app, code, device, label}: redeems an access code for one device and
// returns an offline license, base64url(payload JSON) + "." + base64url(Ed25519
// signature of the first part). The app verifies it with its built-in public
// key on every launch, so it never needs the internet again.
//
// GET (e.g. opening the function URL in a browser): a setup check that
// reports whether the signing key and the database are ready. It reveals
// nothing secret.
//
// Secret to add in Supabase (Edge Functions -> Secrets):
//   LICENSE_SIGNING_KEY  contents of LICENSE_SIGNING_KEY.txt (private key, base64)
// Supabase provides SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY automatically.

import { createClient } from "npm:@supabase/supabase-js@2";
import * as ed from "npm:@noble/ed25519@2.1.0";

// Public half of LICENSE_SIGNING_KEY. Must match lib/licensing/license.dart in the app.
const PUBLIC_KEY = "7EO7Az0xyQ++kFnGPJzzXCTinojYbzf58xQaZtYkvK0=";

const CODE_CHARS = /^[2-9A-HJKMNP-Z]{12}$/;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** "pec 7k3m-q9td xw4h" -> "PEC-7K3M-Q9TD-XW4H", or null. */
function normalizeCode(input: string): string | null {
  let s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("PEC")) s = s.slice(3);
  if (!CODE_CHARS.test(s)) return null;
  return `PEC-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const toBase64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The private key if it is set and belongs to the app's public key. */
async function signingKey(): Promise<{ seed: Uint8Array | null; state: "ok" | "missing" | "wrong" }> {
  const raw = (Deno.env.get("LICENSE_SIGNING_KEY") ?? "").trim();
  if (!raw) return { seed: null, state: "missing" };
  try {
    const seed = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    if (seed.length === 32 && toBase64(await ed.getPublicKeyAsync(seed)) === PUBLIC_KEY) {
      return { seed, state: "ok" };
    }
  } catch {
    // not base64
  }
  return { seed: null, state: "wrong" };
}

function database() {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false },
  });
}

async function signLicense(payload: Record<string, unknown>, seed: Uint8Array): Promise<string> {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await ed.signAsync(new TextEncoder().encode(body), seed);
  return `${body}.${toBase64Url(sig)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (req.method === "GET") {
    const key = await signingKey();
    let dbReady = false;
    try {
      const { error } = await database().from("access_codes").select("id", { count: "exact", head: true }).limit(1);
      dbReady = !error;
    } catch {
      dbReady = false;
    }
    return reply(200, { ok: key.state === "ok" && dbReady, service: "pocket-pec-redeem", signingKey: key.state, database: dbReady });
  }

  if (req.method !== "POST") return reply(405, { ok: false, error: "method" });

  let input: { code?: unknown; device?: unknown; label?: unknown; app?: unknown };
  try {
    input = await req.json();
  } catch {
    return reply(400, { ok: false, error: "bad_request" });
  }
  const device = String(input.device ?? "");
  if (input.app !== "pocket-pec" || !/^[0-9a-f]{64}$/.test(device)) {
    return reply(400, { ok: false, error: "bad_request" });
  }
  const code = normalizeCode(String(input.code ?? ""));
  if (!code) return reply(200, { ok: false, error: "invalid" });

  // Check the key before touching the code, so a setup mistake never uses one up.
  const key = await signingKey();
  if (!key.seed) {
    console.error(`LICENSE_SIGNING_KEY is ${key.state}; open the function URL in a browser to check the setup.`);
    return reply(500, { ok: false, error: "server" });
  }

  const { data, error } = await database().rpc("redeem_access_code", {
    p_code: code,
    p_device: device,
    p_label: String(input.label ?? "").slice(0, 80),
  });
  if (error) {
    console.error(error);
    return reply(500, { ok: false, error: "server" });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.status !== "ok") return reply(200, { ok: false, error: row?.status ?? "invalid" });

  const license = await signLicense(
    {
      v: 1,
      app: "pocket-pec",
      cid: row.code_id,
      code: `PEC-····-····-${code.slice(-4)}`,
      dev: device,
      iat: Math.floor(Date.now() / 1000),
    },
    key.seed,
  );
  return reply(200, { ok: true, license });
});
