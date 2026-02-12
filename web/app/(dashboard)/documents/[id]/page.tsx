"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getDocument } from "@/lib/api";

export default function DocumentDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDocument(id)
      .then((r) => setDoc(r as Record<string, unknown>))
      .catch(() => setDoc(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="container"><p className="text-muted">Loading…</p></div>;
  if (!doc) return <div className="container"><p className="text-muted">Document not found. <Link href="/documents">Back to list</Link></p></div>;

  return (
    <div className="container stack-lg">
      <p><Link href="/documents" className="text-muted" style={{ fontSize: "0.875rem" }}>← Back to documents</Link></p>
      <div className="card card-lg">
        <h1>Generated document</h1>
        <p><strong>Type:</strong> {(doc.type as string) || "—"}</p>
        <p><strong>Created:</strong> {doc.createdAt ? new Date(doc.createdAt as string).toLocaleString() : "—"}</p>
        <p className="text-muted" style={{ fontSize: "0.875rem" }}>PDF download will be available when export is implemented.</p>
      </div>
    </div>
  );
}
