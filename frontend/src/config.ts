/**
 * Application-wide configuration constants.
 * Override the defaults via NEXT_PUBLIC_* environment variables (prefer root .env).
 * For Docker + nginx (single public port), set NEXT_PUBLIC_API_URL=/api/v1 and omit
 * NEXT_PUBLIC_WS_URL so WebSockets use the browser host (see websocketApiBase).
 */

export const API_URL =
    process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';

/** WebSocket API base (absolute URL). Honors NEXT_PUBLIC_WS_URL; otherwise derives from NEXT_PUBLIC_API_URL or same host for path-only API (nginx). */
export function websocketApiBase(): string {
    const envWs = process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, '');
    if (envWs) return envWs;

    const envApi = process.env.NEXT_PUBLIC_API_URL;

    if (typeof window !== 'undefined') {
        if (envApi?.startsWith('/')) {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            return `${protocol}//${window.location.host}/api/v1`;
        }
        const apiForParse = envApi ?? 'http://localhost:8000/api/v1';
        try {
            const u = new URL(apiForParse, window.location.origin);
            const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
            return `${wsProto}//${u.host}/api/v1`;
        } catch {
            /* fall through */
        }
    }

    return 'ws://127.0.0.1:8000/api/v1';
}
