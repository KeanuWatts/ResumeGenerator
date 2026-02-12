import { ThemeToggle } from "@/components/ThemeToggle";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex" style={{ minHeight: "100vh", flexDirection: "column" }}>
      <header className="nav" style={{ justifyContent: "flex-end" }}>
        <ThemeToggle />
      </header>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        {children}
      </div>
    </div>
  );
}
