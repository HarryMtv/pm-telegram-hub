import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Original raw request bytes. Populated by the JSON content-type parser in
     * `buildServer` so HMAC webhook signatures can be verified over the exact
     * bytes the provider sent (never re-serialized JSON).
     */
    rawBody?: Buffer;
  }
}
