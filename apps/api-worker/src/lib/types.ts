/** Request metadata captured for audit logging — port of apps/api's RequestContext. */
export interface RequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}
