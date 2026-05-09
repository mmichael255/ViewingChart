import { API_URL } from "@/config";
import { getAccessToken } from "./auth";

export type FetchJsonOptions = Omit<RequestInit, "headers"> & {
    auth?: boolean;
    headers?: Record<string, string>;
};

export async function fetchJson<T>(path: string, options: FetchJsonOptions = {}): Promise<T> {
    const { auth, headers, ...rest } = options;
    const url = path.startsWith("http") ? path : `${API_URL}${path.startsWith("/") ? "" : "/"}${path}`;

    const finalHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        ...(headers ?? {}),
    };

    if (auth) {
        const token = getAccessToken();
        if (token) finalHeaders.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(url, {
        ...rest,
        headers: finalHeaders,
    });

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
        const msg = data?.detail ?? data?.error?.message ?? `HTTP ${res.status}`;
        throw new Error(typeof msg === "string" ? msg : `HTTP ${res.status}`);
    }

    return data as T;
}

