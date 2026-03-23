import Link from "next/link";
import Image from "next/image";

export default function Header() {
  return (
    <header className="border-b border-koopje-black/10 bg-white">
      <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3 transition opacity-90 hover:opacity-100">
          <Image
            src="/koopjefatbike-logo.png"
            alt="KoopjeFatbike"
            width={180}
            height={48}
            className="h-10 w-auto object-contain sm:h-12"
            priority
          />
          <span className="hidden border-l border-koopje-black/20 pl-3 text-sm font-medium text-koopje-black sm:block">
            Bezorgplanner
          </span>
        </Link>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-koopje-black/20 px-3 py-1.5 text-xs font-medium text-koopje-black/70 hover:bg-koopje-black/5"
          >
            Uitloggen
          </button>
        </form>
      </div>
    </header>
  );
}
