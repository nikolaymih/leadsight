// Typed errors thrown by core. The API maps them to oRPC errors in one place
// (apps/api/src/orpc/error-map.ts); nothing else catches them by message.

export class NotFoundError extends Error {
  constructor(
    readonly entity: string,
    readonly id: string,
  ) {
    super(`${entity} ${id} not found`);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[] = [],
  ) {
    super(issues.length > 0 ? `${message}: ${issues.join("; ")}` : message);
    this.name = "ValidationError";
  }
}

export class ProviderError extends Error {
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(
    readonly provider: string,
    message: string,
    opts: { status?: number; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(`${provider}: ${message}`, { cause: opts.cause });
    this.name = "ProviderError";
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
  }
}
