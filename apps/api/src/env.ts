import { z } from "zod";

// The only place that reads process.env. Everything downstream receives `Env`.

const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());
const optionalInt = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : Number(v)),
  z.number().int().positive().optional(),
);
const flag = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((v) => v === "true");

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    PORT: z.coerce.number().int().positive().default(3001),
    HOST: z.string().default("0.0.0.0"),
    DATABASE_URL: z.string().url(),
    WEB_ORIGIN: z.string().url(),
    BETTER_AUTH_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(1),
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    // Email (password resets, invitations, lead digests). Logged when unset.
    SMTP_URL: optionalString,
    SMTP_FROM: z.string().default("LeadSight <no-reply@localhost>"),
    // Pipeline
    REDDIT_CLIENT_ID: optionalString,
    REDDIT_CLIENT_SECRET: optionalString,
    REDDIT_USER_AGENT: z.string().default("leadsight/0.1"),
    // Google Programmable Search (primary discovery source). Free tier: 100 queries/day.
    GOOGLE_CSE_KEY: optionalString,
    GOOGLE_CSE_CX: optionalString,
    GOOGLE_CSE_DAILY_QUERIES: optionalInt,
    GROQ_API_KEY: optionalString,
    GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),
    GROQ_DAILY_TOKENS: optionalInt,
    GEMINI_API_KEY: optionalString,
    GEMINI_MODEL: z.string().default("gemini-2.5-flash-lite"),
    GEMINI_DAILY_TOKENS: optionalInt,
    SCHEDULER_ENABLED: flag("true"),
    SCHEDULER_CRON: z.string().default("*/5 * * * *"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.BETTER_AUTH_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_SECRET"],
        message: "must be at least 32 characters in production",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
