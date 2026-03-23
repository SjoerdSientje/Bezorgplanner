"use client";

import { useState } from "react";

export default function LogoutButton() {
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        redirect: "follow",
      });
    } catch {
      // Even when the request fails, force navigation to login.
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="rounded-lg border border-koopje-black/20 px-3 py-1.5 text-xs font-medium text-koopje-black/70 hover:bg-koopje-black/5 disabled:opacity-60"
    >
      {loading ? "Uitloggen..." : "Uitloggen"}
    </button>
  );
}
