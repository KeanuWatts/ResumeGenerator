"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getDocument, exportPdf } from "@/lib/api";

type Doc = {
  _id?: string;
  type?: string;
  resumeId?: string;
  jobDescriptionId?: string;
  content?: Record<string, unknown>;
  exports?: { format?: string; url?: string; expiresAt?: string }[];
  matchAnalysis?: { overallScore?: number; ksaMatches?: unknown[]; missingRequirements?: string[] };
  createdAt?: string;
  [key: string]: unknown;
};

export default function DocumentDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    getDocument(id)
      .then((r) => setDoc(r as Doc))
      .catch(() => setDoc(null))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleExportPdf() {
    setExporting(true);
    setExportError(null);
    setPdfUrl(null);
    try {
      const res = await exportPdf({ generatedDocumentId: id }) as { success?: boolean; data?: { url?: string; expiresAt?: string }; error?: string };
      const data = res?.data;
      if (data?.url) {
        setPdfUrl(data.url);
      } else if (res?.error) {
        setExportError(res.error);
      } else {
        setExportError("Export did not return a URL. Try again or check that Reactive Resume and PDF export are configured.");
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  const existingPdf = doc?.exports?.find((e) => e.format === "pdf" && e.url);

  if (loading) return <div className="container"><p className="text-muted">Loading…</p></div>;
  if (!doc) return <div className="container"><p className="text-muted">Document not found. <Link href="/documents">Back to list</Link></p></div>;

  const displayUrl = pdfUrl ?? existingPdf?.url;

  return (
    <div className="container stack-lg">
      <p><Link href="/documents" className="text-muted" style={{ fontSize: "0.875rem" }}>← Back to documents</Link></p>
      <div className="card card-lg">
        <h1>Generated document</h1>
        <p><strong>Type:</strong> {(doc.type === "cover_letter" ? "Cover letter" : doc.type) || "—"}</p>
        <p><strong>Created:</strong> {doc.createdAt ? new Date(doc.createdAt as string).toLocaleString() : "—"}</p>

        {doc.matchAnalysis && doc.type === "resume" && (
          <div className="stack" style={{ marginTop: "1rem" }}>
            <h3 style={{ fontSize: "1rem" }}>Match analysis</h3>
            {typeof doc.matchAnalysis.overallScore === "number" && (
              <p><strong>Score:</strong> {doc.matchAnalysis.overallScore}%</p>
            )}
            {Array.isArray(doc.matchAnalysis.missingRequirements) && doc.matchAnalysis.missingRequirements.length > 0 && (
              <div>
                <strong>Missing requirements:</strong>
                <ul className="page-list" style={{ fontSize: "0.875rem" }}>
                  {doc.matchAnalysis.missingRequirements.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="stack" style={{ marginTop: "1.5rem" }}>
          <h3 style={{ fontSize: "1rem" }}>PDF export</h3>
          {doc.type !== "resume" && (
            <p className="text-muted" style={{ fontSize: "0.875rem" }}>PDF export is only available for resume documents.</p>
          )}
          {doc.type === "resume" && (
            <>
              {exportError && <p className="error" style={{ fontSize: "0.875rem" }}>{exportError}</p>}
              {displayUrl ? (
                <p>
                  <a href={displayUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                    Download PDF
                  </a>
                  {existingPdf?.expiresAt && (
                    <span className="text-muted" style={{ fontSize: "0.875rem", marginLeft: "0.5rem" }}>
                      Link expires {new Date(existingPdf.expiresAt).toLocaleString()}
                    </span>
                  )}
                </p>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleExportPdf}
                  disabled={exporting}
                >
                  {exporting ? "Exporting…" : "Export PDF"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
