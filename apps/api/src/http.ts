import type { IncomingHttpHeaders } from "node:http";
import type { FastifyRequest } from "fastify";

// Node ⇄ WHATWG conversions. Better Auth speaks web `Request`/`Response`;
// Fastify speaks Node. Nothing else in the API should need these.

export function toWebHeaders(headers: IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) out.append(key, v);
    } else {
      out.append(key, value);
    }
  }
  return out;
}

export function toWebRequest(request: FastifyRequest): Request {
  const url = new URL(request.url, `${request.protocol}://${request.host}`);
  return new Request(url, {
    method: request.method,
    headers: toWebHeaders(request.headers),
    body: requestBody(request),
  });
}

function requestBody(request: FastifyRequest): string | undefined {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  if (request.body == null) return undefined;
  // The auth plugin registers a raw-string parser, so this is the wire body verbatim.
  return typeof request.body === "string" ? request.body : JSON.stringify(request.body);
}
