import { z } from "zod";

// The only env the web app reads. NEXT_PUBLIC_* is inlined at build time.
const schema = z.object({ NEXT_PUBLIC_API_URL: z.string().url() });

export const env = schema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
});
