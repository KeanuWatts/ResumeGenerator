"use client";

import { useState } from "react";
import Link from "next/link";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return;
    setDone(true);
  }

  return (
    <div className="card card-lg container container-narrow">
      <h1>Reset password</h1>
      {done ? (
        <p className="text-muted">Your password has been reset. <Link href="/login">Log in</Link>.</p>
      ) : (
        <form onSubmit={handleSubmit} className="stack-lg" style={{ marginTop: "1.5rem" }}>
          <div>
            <label htmlFor="password">New password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <div>
            <label htmlFor="confirm">Confirm password</label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
            Reset password
          </button>
        </form>
      )}
      <p className="text-muted" style={{ marginTop: "1.5rem", fontSize: "0.875rem" }}>
        <Link href="/login">Back to login</Link>
      </p>
    </div>
  );
}
