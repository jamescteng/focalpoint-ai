export function getExternalDomain(req: any): string {
  // In development, REPLIT_DEV_DOMAIN is always correct
  // Prioritize it over headers which may be rewritten by proxies
  if (process.env.REPLIT_DEV_DOMAIN) {
    return process.env.REPLIT_DEV_DOMAIN;
  }
  // In production, check x-forwarded-host (set by load balancers)
  const forwardedHost = req.get('x-forwarded-host');
  if (forwardedHost) {
    return forwardedHost.split(',')[0].trim();
  }
  // Fall back to original host header (without port)
  const host = req.get('host');
  if (host) {
    return host.split(':')[0];
  }
  // Last resort: use req.hostname
  return req.hostname;
}
