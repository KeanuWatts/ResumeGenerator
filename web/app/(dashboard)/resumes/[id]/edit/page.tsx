"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getResume, updateResume } from "@/lib/api";

type Contact = {
  fullName?: string;
  email?: string;
  phone?: string;
  location?: { city?: string; state?: string; country?: string; address?: string };
  linkedin?: string;
  website?: string;
  github?: string;
  portfolio?: string;
};

type Skill = { _id?: string; category?: string; name?: string; items?: string[]; proficiency?: string; yearsOfExperience?: number };
type Experience = {
  _id?: string;
  employer?: string;
  title?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  description?: string;
  bullets?: string[];
};
type Education = {
  _id?: string;
  institution?: string;
  degree?: string;
  field?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  gpa?: string;
};

type Resume = {
  _id?: string;
  name?: string;
  contact?: Contact;
  summary?: { content?: string; keywords?: string[] };
  skills?: Skill[];
  experience?: Experience[];
  education?: Education[];
  [key: string]: unknown;
};

function toDateStr(d: Date | string | undefined): string {
  if (!d) return "";
  const x = typeof d === "string" ? d : (d as Date).toISOString?.() ?? "";
  return x.slice(0, 10);
}

export default function EditResumePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [resume, setResume] = useState<Resume | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getResume(id)
      .then((r) => setResume(r as Resume))
      .catch(() => setResume(null))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!resume) return;
    setSaving(true);
    try {
      await updateResume(id, resume);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function addSkill() {
    setResume((r) => r ? { ...r, skills: [...(r.skills || []), { name: "", items: [], proficiency: "intermediate" }] } : r);
  }
  function removeSkill(i: number) {
    setResume((r) => r ? { ...r, skills: r.skills?.filter((_, j) => j !== i) ?? [] } : r);
  }
  function addExperience() {
    setResume((r) => r ? { ...r, experience: [...(r.experience || []), { employer: "", title: "", bullets: [] }] } : r);
  }
  function removeExperience(i: number) {
    setResume((r) => r ? { ...r, experience: r.experience?.filter((_, j) => j !== i) ?? [] } : r);
  }
  function addEducation() {
    setResume((r) => r ? { ...r, education: [...(r.education || []), { institution: "", degree: "", field: "" }] } : r);
  }
  function removeEducation(i: number) {
    setResume((r) => r ? { ...r, education: r.education?.filter((_, j) => j !== i) ?? [] } : r);
  }

  if (loading) return <div className="container"><p className="text-muted">Loading…</p></div>;
  if (!resume) return <div className="container"><p className="text-muted">Resume not found. <Link href="/resumes">Back to list</Link></p></div>;

  const c = resume.contact ?? {};
  const loc = c.location ?? {};

  return (
    <div className="container stack-lg">
      <p><Link href="/resumes" className="text-muted" style={{ fontSize: "0.875rem" }}>← Back to resumes</Link></p>
      <div className="card card-lg">
        <h1>Edit resume</h1>
        <form onSubmit={handleSave} className="stack-lg" style={{ marginTop: "1rem" }}>
          <div>
            <label>Resume name</label>
            <input
              type="text"
              value={resume.name ?? ""}
              onChange={(e) => setResume((r) => r ? { ...r, name: e.target.value } : r)}
              required
            />
          </div>

          <section className="stack">
            <h2 style={{ fontSize: "1.125rem" }}>Contact</h2>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label>Full name</label>
                <input
                  value={c.fullName ?? ""}
                  onChange={(e) => setResume((r) => ({ ...r!, contact: { ...r?.contact, fullName: e.target.value } }))}
                />
              </div>
              <div>
                <label>Email</label>
                <input
                  type="email"
                  value={c.email ?? ""}
                  onChange={(e) => setResume((r) => ({ ...r!, contact: { ...r?.contact, email: e.target.value } }))}
                />
              </div>
              <div>
                <label>Phone</label>
                <input
                  value={c.phone ?? ""}
                  onChange={(e) => setResume((r) => ({ ...r!, contact: { ...r?.contact, phone: e.target.value } }))}
                />
              </div>
              <div>
                <label>City</label>
                <input
                  value={loc.city ?? ""}
                  onChange={(e) => setResume((r) => ({ ...r!, contact: { ...r?.contact, location: { ...r?.contact?.location, city: e.target.value } } }))}
                />
              </div>
              <div>
                <label>State / Region</label>
                <input
                  value={loc.state ?? ""}
                  onChange={(e) => setResume((r) => ({ ...r!, contact: { ...r?.contact, location: { ...r?.contact?.location, state: e.target.value } } }))}
                />
              </div>
              <div>
                <label>Country</label>
                <input
                  value={loc.country ?? ""}
                  onChange={(e) => setResume((r) => ({ ...r!, contact: { ...r?.contact, location: { ...r?.contact?.location, country: e.target.value } } }))}
                />
              </div>
            </div>
            <div>
              <label>LinkedIn</label>
              <input
                type="url"
                value={c.linkedin ?? ""}
                onChange={(e) => setResume((r) => ({ ...r!, contact: { ...r?.contact, linkedin: e.target.value } }))}
              />
            </div>
            <div>
              <label>Website</label>
              <input
                type="url"
                value={c.website ?? ""}
                onChange={(e) => setResume((r) => ({ ...r!, contact: { ...r?.contact, website: e.target.value } }))}
              />
            </div>
            <div>
              <label>GitHub</label>
              <input
                type="url"
                value={c.github ?? ""}
                onChange={(e) => setResume((r) => ({ ...r!, contact: { ...r?.contact, github: e.target.value } }))}
              />
            </div>
            <div>
              <label>Portfolio</label>
              <input
                type="url"
                value={c.portfolio ?? ""}
                onChange={(e) => setResume((r) => ({ ...r!, contact: { ...r?.contact, portfolio: e.target.value } }))}
              />
            </div>
          </section>

          <section className="stack">
            <h2 style={{ fontSize: "1.125rem" }}>Summary</h2>
            <textarea
              rows={4}
              value={resume.summary?.content ?? ""}
              onChange={(e) => setResume((r) => ({ ...r!, summary: { ...r?.summary, content: e.target.value } }))}
              placeholder="Professional summary (base version; AI will tailor per job)"
            />
          </section>

          <section className="stack">
            <div className="flex" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: "1.125rem" }}>Skills</h2>
              <button type="button" className="btn btn-ghost" onClick={addSkill}>+ Add</button>
            </div>
            {(resume.skills ?? []).map((sk, i) => (
              <div key={i} className="card stack" style={{ padding: "1rem" }}>
                <div className="flex" style={{ justifyContent: "space-between" }}>
                  <input
                    placeholder="Category (e.g. Programming)"
                    value={sk.name ?? sk.category ?? ""}
                    onChange={(e) => setResume((r) => {
                      const s = [...(r?.skills ?? [])];
                      s[i] = { ...s[i], name: e.target.value, category: e.target.value };
                      return r ? { ...r, skills: s } : r;
                    })}
                  />
                  <button type="button" className="btn btn-ghost" onClick={() => removeSkill(i)}>Remove</button>
                </div>
                <input
                  placeholder="Items (comma-separated)"
                  value={(sk.items ?? []).join(", ")}
                  onChange={(e) => setResume((r) => {
                    const s = [...(r?.skills ?? [])];
                    s[i] = { ...s[i], items: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) };
                    return r ? { ...r, skills: s } : r;
                  })}
                />
                <select
                  value={sk.proficiency ?? "intermediate"}
                  onChange={(e) => setResume((r) => {
                    const s = [...(r?.skills ?? [])];
                    s[i] = { ...s[i], proficiency: e.target.value };
                    return r ? { ...r, skills: s } : r;
                  })}
                >
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                  <option value="expert">Expert</option>
                </select>
              </div>
            ))}
          </section>

          <section className="stack">
            <div className="flex" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: "1.125rem" }}>Experience</h2>
              <button type="button" className="btn btn-ghost" onClick={addExperience}>+ Add</button>
            </div>
            {(resume.experience ?? []).map((exp, i) => (
              <div key={i} className="card stack" style={{ padding: "1rem" }}>
                <div className="flex" style={{ justifyContent: "space-between" }}>
                  <strong>Experience {i + 1}</strong>
                  <button type="button" className="btn btn-ghost" onClick={() => removeExperience(i)}>Remove</button>
                </div>
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div>
                    <label>Employer</label>
                    <input
                      value={exp.employer ?? ""}
                      onChange={(e) => setResume((r) => {
                        const ex = [...(r?.experience ?? [])];
                        ex[i] = { ...ex[i], employer: e.target.value };
                        return r ? { ...r, experience: ex } : r;
                      })}
                    />
                  </div>
                  <div>
                    <label>Job title</label>
                    <input
                      value={exp.title ?? ""}
                      onChange={(e) => setResume((r) => {
                        const ex = [...(r?.experience ?? [])];
                        ex[i] = { ...ex[i], title: e.target.value };
                        return r ? { ...r, experience: ex } : r;
                      })}
                    />
                  </div>
                </div>
                <div>
                  <label>Location</label>
                  <input
                    value={exp.location ?? ""}
                    onChange={(e) => setResume((r) => {
                      const ex = [...(r?.experience ?? [])];
                      ex[i] = { ...ex[i], location: e.target.value };
                      return r ? { ...r, experience: ex } : r;
                    })}
                  />
                </div>
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div>
                    <label>Start date</label>
                    <input
                      type="date"
                      value={toDateStr(exp.startDate)}
                      onChange={(e) => setResume((r) => {
                        const ex = [...(r?.experience ?? [])];
                        ex[i] = { ...ex[i], startDate: e.target.value || undefined };
                        return r ? { ...r, experience: ex } : r;
                      })}
                    />
                  </div>
                  <div>
                    <label>End date</label>
                    <input
                      type="date"
                      value={toDateStr(exp.endDate)}
                      onChange={(e) => setResume((r) => {
                        const ex = [...(r?.experience ?? [])];
                        ex[i] = { ...ex[i], endDate: e.target.value || undefined };
                        return r ? { ...r, experience: ex } : r;
                      })}
                    />
                  </div>
                </div>
                <div>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!exp.isCurrent}
                      onChange={(e) => setResume((r) => {
                        const ex = [...(r?.experience ?? [])];
                        ex[i] = { ...ex[i], isCurrent: e.target.checked };
                        return r ? { ...r, experience: ex } : r;
                      })}
                    /> Current role
                  </label>
                </div>
                <div>
                  <label>Description / bullets (one per line)</label>
                  <textarea
                    rows={4}
                    value={(exp.bullets ?? []).join("\n")}
                    onChange={(e) => setResume((r) => {
                      const ex = [...(r?.experience ?? [])];
                      ex[i] = { ...ex[i], bullets: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) };
                      return r ? { ...r, experience: ex } : r;
                    })}
                    placeholder="One bullet per line"
                  />
                </div>
              </div>
            ))}
          </section>

          <section className="stack">
            <div className="flex" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: "1.125rem" }}>Education</h2>
              <button type="button" className="btn btn-ghost" onClick={addEducation}>+ Add</button>
            </div>
            {(resume.education ?? []).map((ed, i) => (
              <div key={i} className="card stack" style={{ padding: "1rem" }}>
                <div className="flex" style={{ justifyContent: "space-between" }}>
                  <strong>Education {i + 1}</strong>
                  <button type="button" className="btn btn-ghost" onClick={() => removeEducation(i)}>Remove</button>
                </div>
                <div>
                  <label>Institution</label>
                  <input
                    value={ed.institution ?? ""}
                    onChange={(e) => setResume((r) => {
                      const edu = [...(r?.education ?? [])];
                      edu[i] = { ...edu[i], institution: e.target.value };
                      return r ? { ...r, education: edu } : r;
                    })}
                  />
                </div>
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div>
                    <label>Degree</label>
                    <input
                      value={ed.degree ?? ""}
                      onChange={(e) => setResume((r) => {
                        const edu = [...(r?.education ?? [])];
                        edu[i] = { ...edu[i], degree: e.target.value };
                        return r ? { ...r, education: edu } : r;
                      })}
                    />
                  </div>
                  <div>
                    <label>Field</label>
                    <input
                      value={ed.field ?? ""}
                      onChange={(e) => setResume((r) => {
                        const edu = [...(r?.education ?? [])];
                        edu[i] = { ...edu[i], field: e.target.value };
                        return r ? { ...r, education: edu } : r;
                      })}
                    />
                  </div>
                </div>
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div>
                    <label>Start date</label>
                    <input
                      type="date"
                      value={toDateStr(ed.startDate)}
                      onChange={(e) => setResume((r) => {
                        const edu = [...(r?.education ?? [])];
                        edu[i] = { ...edu[i], startDate: e.target.value || undefined };
                        return r ? { ...r, education: edu } : r;
                      })}
                    />
                  </div>
                  <div>
                    <label>End date</label>
                    <input
                      type="date"
                      value={toDateStr(ed.endDate)}
                      onChange={(e) => setResume((r) => {
                        const edu = [...(r?.education ?? [])];
                        edu[i] = { ...edu[i], endDate: e.target.value || undefined };
                        return r ? { ...r, education: edu } : r;
                      })}
                    />
                  </div>
                </div>
                <div>
                  <label>GPA (optional)</label>
                  <input
                    value={ed.gpa ?? ""}
                    onChange={(e) => setResume((r) => {
                      const edu = [...(r?.education ?? [])];
                      edu[i] = { ...edu[i], gpa: e.target.value || undefined };
                      return r ? { ...r, education: edu } : r;
                    })}
                  />
                </div>
              </div>
            ))}
          </section>

          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save resume"}
          </button>
        </form>
      </div>
    </div>
  );
}
