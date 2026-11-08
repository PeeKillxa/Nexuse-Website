export const DEFAULT_UPSTASH_URL = "https://tender-kid-124407.upstash.io";
export const DEFAULT_UPSTASH_TOKEN =
  "gQAAAAAAAeX3AAIgcDIzMGVkZmVkZmE5YmM0MDZhOWEwNmUzMGE0OTA2MTAwNA";

export function getKvConfig(): { url: string; token: string } {
  // Use user's Upstash Redis (ignores any dead Vercel KV environment variables)
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    DEFAULT_UPSTASH_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    DEFAULT_UPSTASH_TOKEN;

  return {
    url: url.replace(/\/$/, ""),
    token,
  };
}

export function hasVercelKV(): boolean {
  return true;
}

export async function kvCommand<T = unknown>(
  command: (string | number | boolean | null | undefined)[]
): Promise<T | null> {
  const kv = getKvConfig();
  if (!kv.url || !kv.token) {
    throw new Error("Shared storage is not configured");
  }

  const res = await fetch(kv.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${kv.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!res.ok) {
    let errBody = "";
    try {
      errBody = await res.text();
    } catch {
      // ignore
    }
    console.error(
      `[KV Error] ${command[0]} -> HTTP ${res.status}: ${errBody.slice(0, 200)}`
    );
    throw new Error(`Shared storage returned HTTP ${res.status}: ${errBody.slice(0, 100)}`);
  }

  const data = (await res.json()) as { result?: T; error?: string };
  if (data.error) {
    console.error(`[KV Error] ${command[0]} -> Redis Error: ${data.error}`);
    throw new Error(`Shared storage: ${data.error}`);
  }

  return data.result ?? null;
}

export async function kvCommandSafe<T = unknown>(
  command: (string | number | boolean | null | undefined)[]
): Promise<T | null> {
  try {
    return await kvCommand<T>(command);
  } catch {
    return null;
  }
}
