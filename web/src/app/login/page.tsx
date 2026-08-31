"use client";

import { useState } from "react";

/**
 * Built entirely out of classes that already exist in globals.css — `.app-bar`,
 * `.step-body.centred`, `.form-inner`, `.field`, `.error-note` — so the login
 * screen inherits the studio's look without this lane adding a single CSS rule
 * to a file it does not own.
 */
export default function LoginPage() {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        // Whatever the server says is already generic; the fallback keeps it
        // that way if the response was not JSON at all.
        setError(detail.error || "Não foi possível entrar.");
        return;
      }
      // A full navigation rather than a router push: the cookie has to be on
      // the next request for the middleware to let it through, and a hard load
      // is the only thing that guarantees the document request carries it.
      window.location.href = safeNext();
    } catch {
      setError("Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header className="app-bar">
        <h1>Email Studio</h1>
      </header>
      <div className="step-body centred">
        <form className="form-inner" onSubmit={submit}>
          <label className="field">
            <span>Usuário</span>
            <input value={user} onChange={e => setUser(e.target.value)} autoFocus autoComplete="username" />
          </label>
          <label className="field">
            <span>Senha</span>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && <p className="error-note">{error}</p>}
          <button className="primary big-btn" type="submit" disabled={busy || !user || !password}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
          <p className="hint">Acesso restrito. Use a credencial que você recebeu.</p>
        </form>
      </div>
    </main>
  );
}

/**
 * The middleware puts the page you were reaching for in `?next=`, and that is a
 * value an attacker can put anything into. Only a path on this same origin is
 * followed — `//evil.example` is a protocol-relative URL that a browser reads
 * as another host, which is why the second character is checked too.
 */
function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
