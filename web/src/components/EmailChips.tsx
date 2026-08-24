"use client";

import { useState } from "react";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  emails: string[];
  onChange: (emails: string[]) => void;
  placeholder?: string;
}

/**
 * Test recipients as chips, the way Braze's own recipient box works: anything
 * separated by line breaks, commas or semicolons becomes a chip with its own
 * remove button. An address that does not look like one still becomes a chip,
 * marked — silently dropping a typo would be worse than showing it.
 */
export function EmailChips({ emails, onChange, placeholder }: Props) {
  const [draft, setDraft] = useState("");

  const commit = (text: string) => {
    const parts = text
      .split(/[\s,;]+/)
      .map(p => p.trim().replace(/^["'<]+|["'>]+$/g, ""))
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...emails];
    for (const part of parts) {
      const email = part.toLowerCase();
      if (!next.includes(email)) next.push(email);
    }
    onChange(next);
    setDraft("");
  };

  return (
    <div
      className="chips"
      onClick={e => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}
    >
      {emails.map(email => (
        <span key={email} className={`chip${EMAIL_REGEX.test(email) ? "" : " bad"}`}>
          {email}
          <button
            type="button"
            aria-label={`Remover ${email}`}
            onClick={e => {
              e.stopPropagation();
              onChange(emails.filter(x => x !== email));
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={emails.length === 0 ? placeholder : ""}
        onChange={e => {
          // A separator typed mid-flow commits what came before it.
          if (/[\s,;]/.test(e.target.value)) commit(e.target.value);
          else setDraft(e.target.value);
        }}
        onKeyDown={e => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && draft === "" && emails.length > 0) {
            onChange(emails.slice(0, -1));
          }
        }}
        onPaste={e => {
          e.preventDefault();
          commit(e.clipboardData.getData("text"));
        }}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}
