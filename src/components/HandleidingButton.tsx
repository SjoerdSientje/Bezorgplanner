"use client";

import { useState } from "react";
import HandleidingModal from "@/components/HandleidingModal";

function BookIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M8 7h8M8 11h6" />
    </svg>
  );
}

export default function HandleidingButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-koopje-black/20 px-2.5 py-1.5 text-xs font-medium text-koopje-black/70 hover:bg-koopje-black/5"
        title="Handleiding"
        aria-label="Handleiding openen"
      >
        <BookIcon className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">Handleiding</span>
      </button>
      <HandleidingModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
