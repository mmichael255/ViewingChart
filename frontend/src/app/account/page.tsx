"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearAccessToken } from "@/lib/auth";
import { fetchJson } from "@/lib/api";

type Me = {
    id: number;
    username: string;
    email?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
};

export default function AccountPage() {
    const router = useRouter();
    const [me, setMe] = useState<Me | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");

    useEffect(() => {
        (async () => {
            try {
                const data = await fetchJson<Me>("/me", { auth: true });
                setMe(data);
            } catch {
                clearAccessToken();
                router.push("/login");
            }
        })();
    }, [router]);

    async function saveProfile() {
        if (!me) return;
        setError(null);
        setSaving(true);
        try {
            const updated = await fetchJson<Me>("/me", {
                method: "PATCH",
                auth: true,
                body: JSON.stringify({
                    username: me.username,
                    email: me.email ?? null,
                    display_name: me.display_name ?? null,
                    avatar_url: me.avatar_url ?? null,
                }),
            });
            setMe(updated);
        } catch (e) {
            setError((e as Error).message ?? "Save failed");
        } finally {
            setSaving(false);
        }
    }

    async function changePassword() {
        setError(null);
        setSaving(true);
        try {
            await fetchJson<void>("/me/change-password", {
                method: "POST",
                auth: true,
                body: JSON.stringify({
                    current_password: currentPassword,
                    new_password: newPassword,
                }),
            });
            setCurrentPassword("");
            setNewPassword("");
        } catch (e) {
            setError((e as Error).message ?? "Change password failed");
        } finally {
            setSaving(false);
        }
    }

    function logout() {
        clearAccessToken();
        router.push("/login");
    }

    if (!me) {
        return (
            <div className="min-h-screen bg-[#131722] text-white flex items-center justify-center">
                <div className="text-sm text-gray-400">Loading...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#131722] text-white p-6">
            <div className="max-w-2xl mx-auto space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-xl font-black tracking-tight">Account</div>
                        <div className="text-xs text-gray-500">User #{me.id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => router.back()}
                            className="text-xs font-black uppercase tracking-widest text-gray-300 hover:text-white bg-gray-800/40 hover:bg-gray-800 rounded-lg px-3 py-2 transition-colors"
                        >
                            返回
                        </button>
                        <button
                            onClick={logout}
                            className="text-xs font-black uppercase tracking-widest text-gray-300 hover:text-white bg-gray-800/40 hover:bg-gray-800 rounded-lg px-3 py-2 transition-colors"
                        >
                            Logout
                        </button>
                    </div>
                </div>

                <div className="border border-gray-800 bg-[#1E222D] rounded-xl p-5 space-y-3">
                    <div className="text-[11px] font-black text-gray-400 uppercase tracking-widest">
                        Profile
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Field label="Username">
                            <input
                                value={me.username}
                                onChange={(e) => setMe({ ...me, username: e.target.value })}
                                className="w-full bg-[#131722] border border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#D1D5DB]"
                            />
                        </Field>
                        <Field label="Email">
                            <input
                                value={me.email ?? ""}
                                onChange={(e) => setMe({ ...me, email: e.target.value })}
                                className="w-full bg-[#131722] border border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#D1D5DB]"
                            />
                        </Field>
                        <Field label="Display name">
                            <input
                                value={me.display_name ?? ""}
                                onChange={(e) => setMe({ ...me, display_name: e.target.value })}
                                className="w-full bg-[#131722] border border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#D1D5DB]"
                            />
                        </Field>
                        <Field label="Avatar URL">
                            <input
                                value={me.avatar_url ?? ""}
                                onChange={(e) => setMe({ ...me, avatar_url: e.target.value })}
                                className="w-full bg-[#131722] border border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#D1D5DB]"
                            />
                        </Field>
                    </div>
                    <button
                        disabled={saving}
                        onClick={saveProfile}
                        className="bg-[#D1D5DB] hover:bg-[#9CA3AF] disabled:opacity-60 disabled:hover:bg-[#D1D5DB] transition-colors rounded-lg px-4 py-2 text-sm font-black tracking-wide"
                    >
                        {saving ? "Saving..." : "Save profile"}
                    </button>
                </div>

                <div className="border border-gray-800 bg-[#1E222D] rounded-xl p-5 space-y-3">
                    <div className="text-[11px] font-black text-gray-400 uppercase tracking-widest">
                        Change password
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Field label="Current password">
                            <input
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                type="password"
                                className="w-full bg-[#131722] border border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#D1D5DB]"
                            />
                        </Field>
                        <Field label="New password">
                            <input
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                type="password"
                                className="w-full bg-[#131722] border border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#D1D5DB]"
                            />
                        </Field>
                    </div>
                    <button
                        disabled={saving}
                        onClick={changePassword}
                        className="bg-gray-800/60 hover:bg-gray-800 disabled:opacity-60 transition-colors rounded-lg px-4 py-2 text-sm font-black tracking-wide"
                    >
                        {saving ? "Updating..." : "Update password"}
                    </button>
                </div>

                {error && (
                    <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <div className="text-[11px] font-black text-gray-400 uppercase tracking-widest">
                {label}
            </div>
            {children}
        </div>
    );
}

