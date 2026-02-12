"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listDocuments } from "@/lib/api";

type Doc = { _id: string; type?: string; createdAt?: string };

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listDocuments()
      .then((r: { data?: Doc[] }) => setDocs(r.data ?? []))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="container stack-lg">
      <h1>Generated documents</h1>
      <p className="text-muted">Resumes and cover letters you have generated. Download PDF when export is available.</p>
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : docs.length === 0 ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p className="text-muted">No documents yet. <Link href="/generate">Generate a resume or cover letter</Link>.</p>
        </div>
      ) : (
        <ul className="page-list card" style={{ marginTop: "1rem" }}>
          {docs.map((d) => (
            <li key={d._id}>
              <Link href={`/documents/${d._id}`}>
                {d.type || "document"} — {d.createdAt ? new Date(d.createdAt).toLocaleDateString() : d._id}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
