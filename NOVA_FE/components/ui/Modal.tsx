"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n-context";
import { Icon } from "./Icon";

interface ModalProps {
  title: string;
  /** Optional service logo shown left of the title. */
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

// Native <dialog> wrapper matching the prototype's showModal(): a header row
// with optional icon, title and close button, backdrop click-to-close.
export function Modal({ title, icon, onClose, children }: ModalProps) {
  const { lang } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [onClose]);

  const onBackdrop = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target !== ref.current) return;
    const r = ref.current.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      onClose();
  };

  return (
    <dialog ref={ref} onClick={onBackdrop}>
      <header className="modal-header">
        {icon && <div className="modal-icon">{icon}</div>}
        <h2 id="modal-title">{title}</h2>
        <button
          type="button"
          className="modal-close icon-button"
          aria-label={lang === "bg" ? "Затвори" : "Close"}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
