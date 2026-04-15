"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { RitjesOrderFromApi } from "@/lib/ritjes-mapping";

// Browser SpeechRecognition type (niet in standaard TS lib)
type SpeechRecognitionResultListLike = {
  length: number;
  [index: number]: { isFinal: boolean; [key: number]: { transcript: string } };
};
type SpeechRecognitionResultEvent = {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
};
type SpeechRecognitionErrorEvent = { error: string };

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: (e: SpeechRecognitionResultEvent) => void;
  onerror: (e: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

type Message = { role: "user" | "assistant"; content: string };

export interface SparrenMetSientjeProps {
  /** Huidige orders uit Ritjes voor vandaag; de chat kan deze lezen en tijdsloten aanpassen. */
  ritjesOrders?: RitjesOrderFromApi[];
  /** Zelfde vertrektijd als rechtsboven bij Route genereren (HH:MM). */
  vertrektijd?: string;
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
  vertrektijd = "10:30",
  onSlotsUpdated,
}: SparrenMetSientjeProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [slotsUpdatedFeedback, setSlotsUpdatedFeedback] = useState(false);
  const [listening, setListening] = useState(false);
  const listEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  /** true = microfoon aan tot gebruiker opnieuw klikt (niet stoppen bij korte stilte) */
  const shouldListenRef = useRef(false);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const toggleVoice = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (listening) {
      shouldListenRef.current = false;
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
      setListening(false);
      return;
    }

    shouldListenRef.current = true;
    const rec = new SpeechRecognition();
    rec.lang = "nl-NL";
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = (e) => {
      let chunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const row = e.results[i];
        if (row.isFinal) {
          chunk += row[0]?.transcript ?? "";
        }
      }
      const t = chunk.trim();
      if (t) {
        setInput((prev) => (prev ? `${prev} ${t}` : t));
      }
    };

    /** Blijft luisteren: na stilte (onend / no-speech) opnieuw starten tot gebruiker microfoon uitzet. */
    const scheduleRestart = (instance: SpeechRecognitionInstance) => {
      window.setTimeout(() => {
        if (!shouldListenRef.current) return;
        try {
          instance.start();
        } catch {
          window.setTimeout(() => {
            if (!shouldListenRef.current) return;
            try {
              instance.start();
            } catch {
              shouldListenRef.current = false;
              setListening(false);
            }
          }, 200);
        }
      }, 50);
    };

    rec.onerror = (ev) => {
      const code = ev.error;
      if ((code === "no-speech" || code === "audio-capture") && shouldListenRef.current) {
        scheduleRestart(rec);
        return;
      }
      if (code === "aborted") return;
      if (code === "not-allowed" || code === "service-not-allowed") {
        shouldListenRef.current = false;
        setListening(false);
      }
    };

    rec.onend = () => {
      if (!shouldListenRef.current) {
        setListening(false);
        return;
      }
      scheduleRestart(rec);
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      shouldListenRef.current = false;
      setListening(false);
    }
  }, [listening]);

  useEffect(() => {
    return () => {
      shouldListenRef.current = false;
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

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
          ritjesContext: { orders: ritjesOrders, vertrektijd },
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

      {open && typeof document !== "undefined" && createPortal(
        <>
          <div
            className="fixed inset-0 z-40 bg-koopje-black/40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div className="fixed bottom-0 right-0 left-0 z-50 flex max-h-[85svh] flex-col rounded-t-2xl border border-koopje-black/10 bg-white pb-[env(safe-area-inset-bottom)] shadow-xl sm:bottom-4 sm:left-auto sm:right-4 sm:max-h-[calc(100svh-8rem)] sm:w-[420px] sm:rounded-2xl sm:pb-0">
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
                <div className="relative min-w-0 flex-1">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={listening ? "Luisteren…" : "Typ je bericht…"}
                    disabled={loading}
                    className={`w-full rounded-xl border bg-white py-2.5 pl-4 pr-10 text-sm text-koopje-black placeholder:text-koopje-black/40 focus:outline-none focus:ring-1 disabled:opacity-60 ${
                      listening
                        ? "border-red-400 focus:border-red-400 focus:ring-red-300"
                        : "border-koopje-black/20 focus:border-koopje-orange focus:ring-koopje-orange"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={toggleVoice}
                    disabled={loading}
                    title={listening ? "Stop opname" : "Inspreken"}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 transition disabled:opacity-40 ${
                      listening
                        ? "text-red-500 hover:bg-red-50"
                        : "text-koopje-black/40 hover:bg-koopje-black/5 hover:text-koopje-black"
                    }`}
                  >
                    {listening ? (
                      // Pulserende opname-indicator
                      <span className="relative flex h-5 w-5 items-center justify-center">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
                        <svg className="relative h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm6.364 5.636a.75.75 0 0 1 .736.912A7.002 7.002 0 0 1 12.75 15.93V18h2.25a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1 0-1.5H11.25v-2.07A7.002 7.002 0 0 1 4.9 9.548a.75.75 0 1 1 1.471-.297A5.502 5.502 0 0 0 17.5 11a5.502 5.502 0 0 0-.864-2.952.75.75 0 0 1 .728-.412z" />
                        </svg>
                      </span>
                    ) : (
                      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm6.364 5.636a.75.75 0 0 1 .736.912A7.002 7.002 0 0 1 12.75 15.93V18h2.25a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1 0-1.5H11.25v-2.07A7.002 7.002 0 0 1 4.9 9.548a.75.75 0 1 1 1.471-.297A5.502 5.502 0 0 0 17.5 11a5.502 5.502 0 0 0-.864-2.952.75.75 0 0 1 .728-.412z" />
                      </svg>
                    )}
                  </button>
                </div>
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
        </>,
        document.body
      )}
    </>
  );
}
