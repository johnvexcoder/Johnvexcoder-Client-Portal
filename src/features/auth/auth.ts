import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { twoFactor } from "better-auth/plugins/two-factor";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
export interface Env {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  APP_ENV: string;
}
export function createAuth(env: Env, privateProvisioning = false) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
    throw new Error("Run the local bootstrap to configure authentication.");
  return betterAuth({
    appName: "J0hnvexcoder Portal",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.DB, { schema }), {
      provider: "sqlite",
      schema,
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !privateProvisioning,
      minPasswordLength: 16,
      maxPasswordLength: 128,
    },
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "client", input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
      },
    },
    trustedOrigins: [
      env.BETTER_AUTH_URL,
      ...(env.APP_ENV === "local"
        ? [
            "http://127.0.0.1:" + new URL(env.BETTER_AUTH_URL).port,
            "http://localhost:" + new URL(env.BETTER_AUTH_URL).port,
          ]
        : []),
    ],
    advanced: {
      useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    plugins: [twoFactor({ issuer: "J0hnvexcoder Portal" })],
  });
}
