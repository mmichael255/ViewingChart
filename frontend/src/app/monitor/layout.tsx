import type { ReactNode } from "react";

export default function MonitorLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto overflow-x-hidden bg-[#131722]">
      {children}
    </div>
  );
}
