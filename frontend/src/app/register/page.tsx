"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthModal } from "@/components/AuthModal";

export default function RegisterPage() {
    const router = useRouter();
    const [open, setOpen] = useState(true);

    return (
        <div className="min-h-screen bg-[#131722]">
            {open && (
                <AuthModal
                    mode="register"
                    onClose={() => {
                        setOpen(false);
                        router.push("/");
                    }}
                />
            )}
        </div>
    );
}

