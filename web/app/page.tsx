import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function HomePage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header className="nav" style={{ justifyContent: "space-between" }}>
        <span className="nav-brand" style={{ cursor: "default" }}>Resume Generator</span>
        <span className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/login">Log in</Link>
          <Link href="/register" className="btn btn-primary">Register</Link>
        </span>
      </header>
      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div className="container container-narrow text-muted stack-lg">
          <h1 style={{ color: "var(--text)", fontSize: "2rem", marginBottom: "0.5rem" }}>
            Tailored resumes and cover letters
          </h1>
          <p style={{ fontSize: "1.125rem" }}>
            Generate job-specific resumes and cover letters that match each role. One master resume, many applications.
          </p>
          <p className="flex gap-4" style={{ marginTop: "1.5rem" }}>
            <Link href="/login" className="btn btn-primary">Log in</Link>
            <Link href="/register" className="btn btn-ghost">Create an account</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
