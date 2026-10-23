import { getPlatformProxy } from "wrangler";
import { createAuth, type Env } from "../src/features/auth/auth";
export async function localPlatform() {
  const proxy = await getPlatformProxy<Env>({
    configPath: "wrangler.jsonc",
    persist: { path: ".wrangler/state/v3" },
  });
  return { proxy, auth: createAuth(proxy.env), env: proxy.env };
}
