import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="container stack-lg">
      <h1>Dashboard</h1>
      <p className="text-muted">Overview and quick actions.</p>
      <ul className="page-list card" style={{ marginTop: "1.5rem" }}>
        <li><Link href="/resumes">Manage resumes</Link></li>
        <li><Link href="/jobs">Manage job descriptions</Link></li>
        <li><Link href="/generate">Generate resume or cover letter</Link></li>
        <li><Link href="/documents">View generated documents</Link></li>
      </ul>
    </div>
  );
}
