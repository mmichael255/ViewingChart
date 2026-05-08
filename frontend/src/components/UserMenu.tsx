"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearAccessToken, getAccessToken } from "@/lib/auth";
import { fetchJson } from "@/lib/api";
import { AuthModal } from "@/components/AuthModal";

type Me = {
  id: number;
  username: string;
  email?: string | null;
  role?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
};

export function UserMenu() {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"closed" | "login" | "register">("closed");

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!token) {
      setMe(null);
      return;
    }
    (async () => {
      try {
        const data = await fetchJson<Me>("/me", { auth: true });
        setMe(data);
      } catch {
        clearAccessToken();
        setToken(null);
        setMe(null);
      }
    })();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [token]);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const label = useMemo(() => me?.display_name || me?.username || "Account", [me]);

  function logout() {
    clearAccessToken();
    setToken(null);
    setMe(null);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      {token ? (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 px-2 py-1 rounded-full hover:bg-gray-800/60 transition-colors"
            title="Account"
          >
            {me?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-200">
                👤
              </div>
            )}
            <span className="text-xs text-gray-200 max-w-[140px] truncate hidden sm:block">
              {label}
            </span>
            <span className="text-gray-400 text-xs">⌄</span>
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-[#1E222D] border border-gray-700 rounded-xl shadow-2xl overflow-hidden z-[70]">
              <div className="px-3 py-3 border-b border-gray-800">
                <div className="text-xs font-black tracking-wide text-white truncate">{label}</div>
                <div className="text-[11px] text-gray-400 truncate">
                  {me?.email || `User #${me?.id ?? ""}`}
                </div>
              </div>

              <div className="p-1">
                <Link
                  href="/account"
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 rounded-lg text-xs text-gray-200 hover:bg-gray-800/60 transition-colors"
                >
                  修改信息
                </Link>
                <button
                  onClick={logout}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs text-red-200 hover:bg-red-500/10 transition-colors"
                >
                  退出
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAuthMode("login")}
            className="text-xs font-black uppercase tracking-widest text-gray-300 hover:text-white bg-gray-800/40 hover:bg-gray-800 rounded-lg px-3 py-2 transition-colors"
          >
            登录
          </button>
          <button
            onClick={() => setAuthMode("register")}
            className="text-xs font-black uppercase tracking-widest text-white bg-[#2962FF] hover:bg-[#1f4fe0] rounded-lg px-3 py-2 transition-colors"
          >
            注册
          </button>
        </div>
      )}

      {authMode !== "closed" && (
        <AuthModal
          mode={authMode}
          onClose={() => setAuthMode("closed")}
          onAuthed={() => setToken(getAccessToken())}
        />
      )}
    </div>
  );
}

