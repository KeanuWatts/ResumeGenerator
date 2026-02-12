"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSent(true);
  }

  return (
    <div className="card card-lg container container-narrow">
      <h1>Forgot password</h1>
      {sent ? (
        <p className="text-muted">If an account exists for that email, we sent a reset link. Check your inbox.</p>
      ) : (
        <form onSubmit={handleSubmit} className="stack-lg" style={{ marginTop: "1.5rem" }}>
          <div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
            Send reset link
          </button>
        </form>
      )}
      <p className="text-muted" style={{ marginTop: "1.5rem", fontSize: "0.875rem" }}>
        <Link href="/login">Back to login</Link>
      </p>
    </div>
  );
}
