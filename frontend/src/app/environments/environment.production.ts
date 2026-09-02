/**
 * src/app/environments/environment.production.ts
 */
export const environment = {
  production: true,
  apiBaseUrl: '',       // In production, Nginx proxies /api → FastAPI (same origin)
  wsBaseUrl: `ws://${typeof window !== 'undefined' ? window.location.host : 'localhost'}`,
};
