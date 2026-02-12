"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { logout } from "@/lib/api";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, hydrated, clearTokens } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined" || !hydrated) return;
    if (!isAuthenticated) {
      router.replace("/login");
    }
  }, [hydrated, isAuthenticated, router]);

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // ignore
    }
    clearTokens();
    router.replace("/");
    router.refresh();
  }

  if (!hydrated) {
    return (
      <div className="page-main" style={{ padding: "2rem", textAlign: "center" }}>
        <p className="text-muted">Loading…</p>
      </div>
    );
  }
  if (!isAuthenticated) {
    return (
      <div className="page-main" style={{ padding: "2rem", textAlign: "center" }}>
        <p className="text-muted">Redirecting to login…</p>
      </div>
    );
  }

  return (
    <div>
      <nav className="nav">
        <Link href="/dashboard" className="nav-brand">
          Resume Generator
        </Link>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/resumes">Resumes</Link>
        <Link href="/jobs">Jobs</Link>
        <Link href="/generate">Generate</Link>
        <Link href="/documents">Documents</Link>
        <Link href="/settings">Settings</Link>
        <span className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <button type="button" className="btn btn-ghost" onClick={handleLogout} style={{ padding: "0.25rem 0.5rem" }}>
            Log out
          </button>
        </span>
      </nav>
      <main className="page-main">{children}</main>
    </div>
  );
}
