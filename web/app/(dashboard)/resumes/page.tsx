"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listResumes, createResume } from "@/lib/api";

type Resume = { _id: string; name: string; isDefault?: boolean };

export default function ResumesPage() {
  const [resumes, setResumes] = useState<{ data?: Resume[] }>({});
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listResumes()
      .then((r: { data?: Resume[] }) => setResumes(r))
      .catch(() => setResumes({}))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createResume({ name: newName.trim() });
      const r = await listResumes() as { data?: Resume[] };
      setResumes(r);
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  const list = resumes.data || [];

  return (
    <div className="container stack-lg">
      <h1>Resumes</h1>
      <p className="text-muted">Manage your master resumes.</p>
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          <ul className="page-list card" style={{ marginTop: "1rem" }}>
            {list.map((r) => (
              <li key={r._id}>
                <Link href={`/resumes/${r._id}/edit`}>{r.name}</Link>
                {r.isDefault && <span className="text-muted" style={{ fontSize: "0.875rem" }}> (default)</span>}
              </li>
            ))}
          </ul>
          <form onSubmit={handleCreate} className="card stack" style={{ marginTop: "1rem" }}>
            <div>
              <label htmlFor="new-name">New resume name</label>
              <input
                id="new-name"
                type="text"
                placeholder="e.g. Master Resume"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={creating}>Add resume</button>
          </form>
        </>
      )}
    </div>
  );
}
