"use client";

import { API_URL } from "@/config";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const POLL_MS = 3000;

function apiOrigin(): string {
  return API_URL.replace(/\/api\/v1\/?$/, "");
}

type HealthPayload = {
  status?: string;
  environment?: string;
  uptime_seconds?: number;
  checks?: Record<string, string>;
  binance_ws?: Record<string, unknown>;
};

type WsStatusPayload = Record<string, unknown>;

function formatTickerStreamCounts(ws: WsStatusPayload | null): string {
  const raw = ws?.ticker_stream_counts;
  if (!raw || typeof raw !== "object") return "—";
  const o = raw as Record<string, unknown>;
  const spot = o.spot;
  const futures = o.futures;
  if (typeof spot !== "number" || typeof futures !== "number") return "—";
  return `${spot} / ${futures}`;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${ok ? "bg-emerald-400" : "bg-red-400"}`}
      title={ok ? "ok" : "not ok"}
    />
  );
}

export default function MonitorPage() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [wsStatus, setWsStatus] = useState<WsStatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [hRes, wRes] = await Promise.all([
        fetch(`${API_URL}/health`),
        fetch(`${API_URL}/ws/status`),
      ]);
      if (!hRes.ok) throw new Error(`health HTTP ${hRes.status}`);
      if (!wRes.ok) throw new Error(`ws/status HTTP ${wRes.status}`);
      const h = (await hRes.json()) as HealthPayload;
      const w = (await wRes.json()) as WsStatusPayload;
      setHealth(h);
      setWsStatus(w);
      setError(null);
      setLastUpdated(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void fetchAll();
    const id = setInterval(() => void fetchAll(), POLL_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  const redisOk = health?.checks?.redis === "ok";
  const spotOk = health?.checks?.binance_spot_ws === "ok";
  const futOk = health?.checks?.binance_futures_ws === "ok";
  const channels = (wsStatus?.redis_pubsub_channels as string[] | undefined) ?? [];
  const stockMetrics = (wsStatus?.stock_quote_metrics as Record<string, unknown> | undefined) ?? {};

  return (
    <div className="min-h-screen bg-[#131722] text-gray-100 p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-gray-800 pb-4">
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">Connection monitor</h1>
            <p className="text-sm text-gray-500 mt-1">
              Upstream Binance feeder, Redis pub/sub, and browser WebSocket fan-out.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 text-sm">
            <Link href="/" className="text-[#2962FF] hover:underline">
              ← Back to chart
            </Link>
            <span className="text-gray-500 text-xs font-mono">
              {lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}` : "—"}
            </span>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="rounded-lg border border-gray-800 bg-[#1E222D] p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Upstream (Binance)
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between gap-2 border-b border-gray-800/80 pb-2">
              <dt className="text-gray-500">Spot WS</dt>
              <dd className="font-mono flex items-center gap-2">
                <StatusDot ok={spotOk} />
                {health?.checks?.binance_spot_ws ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-2 border-b border-gray-800/80 pb-2">
              <dt className="text-gray-500">Futures WS</dt>
              <dd className="font-mono flex items-center gap-2">
                <StatusDot ok={futOk} />
                {health?.checks?.binance_futures_ws ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">Last message age (s)</dt>
              <dd className="font-mono tabular-nums">
                {wsStatus?.last_message_age_s != null
                  ? String(wsStatus.last_message_age_s)
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">Reconnects (spot / futures)</dt>
              <dd className="font-mono tabular-nums">
                {typeof wsStatus?.spot_reconnect_count === "number"
                  ? wsStatus.spot_reconnect_count
                  : "—"}{" "}
                /{" "}
                {typeof wsStatus?.futures_reconnect_count === "number"
                  ? wsStatus.futures_reconnect_count
                  : "—"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-gray-800 bg-[#1E222D] p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Stock quote quality
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between gap-2 border-b border-gray-800/80 pb-2">
              <dt className="text-gray-500">Cache hit rate</dt>
              <dd className="font-mono tabular-nums">
                {typeof stockMetrics.cache_hit_rate === "number"
                  ? `${(Number(stockMetrics.cache_hit_rate) * 100).toFixed(1)}%`
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-2 border-b border-gray-800/80 pb-2">
              <dt className="text-gray-500">Upstream failure rate</dt>
              <dd className="font-mono tabular-nums">
                {(() => {
                  const succ = Number(stockMetrics.upstream_success ?? 0);
                  const fail = Number(stockMetrics.upstream_failure ?? 0);
                  const total = succ + fail;
                  return total > 0 ? `${((fail / total) * 100).toFixed(1)}%` : "—";
                })()}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">Latency avg / P95 (ms)</dt>
              <dd className="font-mono tabular-nums">
                {typeof stockMetrics.upstream_latency_samples === "number" &&
                Number(stockMetrics.upstream_latency_samples) > 0
                  ? `${(Number(stockMetrics.upstream_latency_ms_total ?? 0) / Number(stockMetrics.upstream_latency_samples)).toFixed(0)} / ${Number(stockMetrics.upstream_latency_p95_ms ?? 0).toFixed(0)}`
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">Pre/Post coverage</dt>
              <dd className="font-mono tabular-nums">
                {typeof stockMetrics.pre_market_coverage_rate === "number" &&
                typeof stockMetrics.post_market_coverage_rate === "number"
                  ? `${(Number(stockMetrics.pre_market_coverage_rate) * 100).toFixed(1)}% / ${(Number(stockMetrics.post_market_coverage_rate) * 100).toFixed(1)}%`
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">Regular-only mode</dt>
              <dd className="font-mono tabular-nums">
                {wsStatus?.stock_regular_only_mode ? "ON" : "OFF"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-gray-800 bg-[#1E222D] p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Redis / pub-sub
          </h2>
          <div className="flex justify-between gap-2 text-sm border-b border-gray-800/80 pb-2">
            <span className="text-gray-500">Ping</span>
            <span className="font-mono flex items-center gap-2">
              <StatusDot ok={redisOk} />
              {health?.checks?.redis ?? "—"}
            </span>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-2">Channels (listener)</p>
            <ul className="flex flex-wrap gap-2">
              {channels.length > 0 ? (
                channels.map((ch) => (
                  <li
                    key={ch}
                    className="text-xs font-mono px-2 py-1 rounded bg-[#131722] border border-gray-700 text-gray-300"
                  >
                    {ch}
                  </li>
                ))
              ) : (
                <li className="text-gray-500 text-sm">—</li>
              )}
            </ul>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm pt-2">
            <div className="flex justify-between gap-2">
              <span className="text-gray-500">Watchlist symbols</span>
              <span className="font-mono tabular-nums">{String(wsStatus?.global_watchlist_size ?? "—")}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-gray-500">Ticker streams (spot / fut)</span>
              <span className="font-mono tabular-nums">{formatTickerStreamCounts(wsStatus)}</span>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-gray-800 bg-[#1E222D] p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Transport (browser WebSockets)
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between gap-2 border-b border-gray-800/80 pb-2">
              <dt className="text-gray-500">Kline clients</dt>
              <dd className="font-mono tabular-nums">{String(wsStatus?.kline_client_count ?? "—")}</dd>
            </div>
            <div className="flex justify-between gap-2 border-b border-gray-800/80 pb-2">
              <dt className="text-gray-500">Ticker clients</dt>
              <dd className="font-mono tabular-nums">{String(wsStatus?.ticker_client_count ?? "—")}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">Kline rooms</dt>
              <dd className="font-mono tabular-nums">{String(wsStatus?.kline_room_count ?? "—")}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">Active kline streams (upstream)</dt>
              <dd className="font-mono tabular-nums">{String(wsStatus?.active_streams ?? "—")}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-gray-800 bg-[#1E222D] p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Prometheus</h2>
            <a
              href={`${apiOrigin()}/metrics`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#2962FF] hover:underline font-mono"
            >
              GET /metrics
            </a>
          </div>
          <p className="text-xs text-gray-500">
            Scrape endpoint for Grafana. Restrict to internal networks in production.
          </p>
        </section>

        <section className="rounded-lg border border-gray-800 bg-[#1E222D] p-4">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="text-sm text-[#2962FF] hover:underline mb-2"
          >
            {showRaw ? "Hide" : "Show"} raw JSON
          </button>
          {showRaw && (
            <pre className="text-xs font-mono text-gray-400 overflow-x-auto whitespace-pre-wrap break-words bg-[#131722] p-3 rounded border border-gray-800">
              {JSON.stringify({ health, wsStatus }, null, 2)}
            </pre>
          )}
        </section>
      </div>
    </div>
  );
}
