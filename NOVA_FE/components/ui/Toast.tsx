"use client";

// Transient bottom toast, matching the prototype's #toast element.
export function Toast({ message }: { message: string | null }) {
  return (
    <div id="toast" className={message ? "show" : ""} role="status" aria-live="polite">
      {message}
    </div>
  );
}
