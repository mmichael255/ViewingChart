/**
 * Application-wide configuration constants.
 * Override the defaults via NEXT_PUBLIC_* environment variables (prefer root .env).
 */

export const API_URL =
    process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';

export const WS_URL =
    process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8000/api/v1';
