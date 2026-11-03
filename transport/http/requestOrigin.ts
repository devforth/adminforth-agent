function getHeaderValue(headers: Record<string, unknown>, name: string) {
  const value = headers[name] ?? headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === "string" ? value : undefined;
}

/** The public origin a request reached the admin panel on, e.g. https://example.com, behind a proxy too. */
export function getRequestOrigin(headers: Record<string, unknown>) {
  const forwardedProto = getHeaderValue(headers, "x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = getHeaderValue(headers, "x-forwarded-host")?.split(",")[0]?.trim();
  // Node rejects HTTP/1.1 requests without a Host header.
  const host: string = forwardedHost ?? getHeaderValue(headers, "host");
  const proto = forwardedProto
    ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  return `${proto}://${host}`;
}
