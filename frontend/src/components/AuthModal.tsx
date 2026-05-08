"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { fetchJson } from "@/lib/api";
import { setAccessToken } from "@/lib/auth";

type Mode = "login" | "register";
type TokenResponse = { access_token: string; token_type: string };

export function AuthModal({
  mode,
  onClose,
  onAuthed,
  showClose = true,
}: {
  mode: Mode;
  onClose: () => void;
  onAuthed?: () => void;
  showClose?: boolean;
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const title = useMemo(() => (mode === "login" ? "Login" : "Register"), [mode]);

  function switchTo(next: Mode) {
    onClose();
    router.push(next === "login" ? "/login" : "/register");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data =
        mode === "login"
          ? await fetchJson<TokenResponse>("/auth/login", {
              method: "POST",
              body: JSON.stringify({ username, password }),
            })
          : await fetchJson<TokenResponse>("/auth/register", {
              method: "POST",
              body: JSON.stringify({
                username,
                password,
                email: email.trim() ? email.trim() : null,
              }),
            });

      setAccessToken(data.access_token);
      onAuthed?.();
      onClose();
      router.refresh();
    } catch (err) {
      setError((err as Error).message ?? (mode === "login" ? "Login failed" : "Register failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center backdrop-blur-sm p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-sm border border-gray-800 bg-[#1E222D] rounded-xl p-6 shadow-2xl text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xl font-black tracking-tight">{title}</div>
            <div className="text-xs text-gray-400 mt-1">
              {mode === "login" ? (
                <>
                  No account?{" "}
                  <button
                    type="button"
                    onClick={() => switchTo("register")}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    Register
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => switchTo("login")}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    Login
                  </button>
                </>
              )}
            </div>
          </div>
          {showClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors -mt-1 -mr-1 px-2 py-1 rounded hover:bg-gray-800/60"
              aria-label="Close"
            >
              ✕
            </button>
          )}
        </div>

        <form className="mt-5 space-y-3" onSubmit={onSubmit}>
          <div className="space-y-1">
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">
              Username
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-[#131722] border border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#2962FF]"
              placeholder="yourname"
              autoComplete="username"
            />
          </div>

          {mode === "register" && (
            <div className="space-y-1">
              <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">
                Email (optional)
              </label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#131722] border border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#2962FF]"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">
              Password
            </label>
            <div className="relative">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={showPassword ? "text" : "password"}
                className="w-full bg-[#131722] border border-gray-700 rounded-lg px-3 py-2 pr-10 text-sm outline-none focus:border-[#2962FF]"
                placeholder={mode === "login" ? "••••••••" : "min 8 chars"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800/80 transition-colors"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            disabled={loading}
            className="w-full bg-[#2962FF] hover:bg-[#1f4fe0] disabled:opacity-60 disabled:hover:bg-[#2962FF] transition-colors rounded-lg py-2 text-sm font-black tracking-wide"
          >
            {loading ? (mode === "login" ? "Signing in..." : "Creating...") : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}

