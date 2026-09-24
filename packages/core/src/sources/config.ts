import { ValidationError } from "../errors.js";
import { type SourceConfig, type SourceKind, sourceConfigSchema } from "../types.js";

export type SourceConfigFor<K extends SourceKind> = Extract<SourceConfig, { kind: K }>["config"];

/** Validate a bare config object against the `sourceConfigSchema` branch for `kind`. */
export function validateSourceConfig<K extends SourceKind>(kind: K, config: unknown): SourceConfigFor<K> {
  const result = sourceConfigSchema.safeParse({ kind, config });
  if (!result.success) {
    throw new ValidationError(
      `invalid ${kind} config`,
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  // The discriminant is `kind`, so the parsed branch is the one for K.
  return result.data.config as unknown as SourceConfigFor<K>;
}
