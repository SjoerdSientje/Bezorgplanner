"use client";

import { useState, useRef, useEffect } from "react";
import type { RitjesOrderFromApi } from "@/lib/ritjes-mapping";

type Message = { role: "user" | "assistant"; content: string };

export interface SparrenMetSientjeProps {
  /** Huidige orders uit Ritjes voor vandaag; de chat kan deze lezen en tijdsloten aanpassen. */
  ritjesOrders?: RitjesOrderFromApi[];
  /** Wordt aangeroepen nadat de chat tijdsloten heeft doorgevoerd, zodat de tabel ververst. */
  onSlotsUpdated?: () => void;
}

function SientjeAvatar({ className }: { className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center ${className ?? ""}`}>
      <img
        src="/sientje-avatar.png"
        alt="Sientje"
        className="h-16 w-16 rounded-full object-cover object-top sm:h-20 sm:w-20"
        onError={(e) => {
          const target = e.currentTarget;
          target.style.display = "none";
          const fallback = target.nextElementSibling as HTMLElement;
          if (fallback) fallback.classList.remove("hidden");
        }}
      />
      <div
        className="hidden h-16 w-16 shrink-0 rounded-full bg-koopje-orange-light flex items-center justify-center text-2xl sm:h-20 sm:w-20"
        aria-hidden
      >
        <span className="text-koopje-orange">🚴</span>
      </div>
    </div>
  );
}

export default function SparrenMetSientje({
  ritjesOrders = [],
  onSlotsUpdated,
}: SparrenMetSientjeProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [slotsUpdatedFeedback, setSlotsUpdatedFeedback] = useState(false);
  const listEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setSlotsUpdatedFeedback(false);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          ritjesContext: { orders: ritjesOrders },
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.error ?? "Er ging iets mis. Probeer het opnieuw.",
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.content ?? "" },
      ]);

      if (data.slotsUpdated && onSlotsUpdated) {
        onSlotsUpdated();
        setSlotsUpdatedFeedback(true);
        setTimeout(() => setSlotsUpdatedFeedback(false), 4000);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Er ging iets mis. Probeer het opnieuw." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-koopje-orange bg-koopje-orange-light px-4 py-2 text-sm font-medium text-koopje-black transition hover:bg-koopje-orange/20 focus:outline-none focus:ring-2 focus:ring-koopje-orange"
        >
          <span className="text-lg" aria-hidden>💬</span>
          Sparren met Sientje
        </button>
      </div>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-koopje-black/40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div className="fixed bottom-0 right-0 left-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border border-koopje-black/10 bg-white shadow-xl sm:left-auto sm:right-4 sm:bottom-4 sm:max-h-[calc(100vh-8rem)] sm:w-[420px] sm:rounded-2xl">
            <div className="flex items-center gap-3 border-b border-koopje-black/10 px-4 py-3">
              <SientjeAvatar />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-koopje-black">Sientje</h2>
                <p className="text-xs text-koopje-black/60">
                  Planning-assistent · Spar over je route
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-koopje-black/60 transition hover:bg-koopje-black/5 hover:text-koopje-black"
                aria-label="Chat sluiten"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {messages.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <SientjeAvatar className="opacity-90" />
                  <p className="text-sm text-koopje-black/70">
                    Hoi! Ik ben Sientje. Ik zie de huidige Ritjes voor vandaag. Spar met mij over je planning of vraag om tijdsloten door te voeren.
                  </p>
                </div>
              )}
              <div className="space-y-4">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}
                  >
                    {m.role === "assistant" && <SientjeAvatar />}
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                        m.role === "user"
                          ? "bg-koopje-orange text-white"
                          : "bg-koopje-black/5 text-koopje-black"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    </div>
                    {m.role === "user" && (
                      <div className="h-8 w-8 shrink-0 rounded-full bg-koopje-black/10" aria-hidden />
                    )}
                  </div>
                ))}
                {loading && (
                  <div className="flex gap-3">
                    <SientjeAvatar />
                    <div className="rounded-2xl bg-koopje-black/5 px-4 py-3">
                      <span className="inline-flex gap-1">
                        <span className="h-2 w-2 animate-bounce rounded-full bg-koopje-orange [animation-delay:-0.3s]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-koopje-orange [animation-delay:-0.15s]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-koopje-orange" />
                      </span>
                    </div>
                  </div>
                )}
                <div ref={listEndRef} />
              </div>
            </div>

            {slotsUpdatedFeedback && (
              <p className="border-t border-koopje-black/10 bg-green-50 px-4 py-2 text-sm text-green-800">
                Tijdsloten bijgewerkt in de tabel.
              </p>
            )}
            <form onSubmit={handleSubmit} className="border-t border-koopje-black/10 p-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Typ je bericht…"
                  disabled={loading}
                  className="min-w-0 flex-1 rounded-xl border border-koopje-black/20 bg-white px-4 py-2.5 text-sm text-koopje-black placeholder:text-koopje-black/40 focus:border-koopje-orange focus:outline-none focus:ring-1 focus:ring-koopje-orange disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="shrink-0 rounded-xl bg-koopje-orange px-4 py-2.5 text-sm font-medium text-white transition hover:bg-koopje-orange-dark disabled:opacity-50"
                >
                  Verstuur
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </>
  );
}
