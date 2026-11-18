"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import HandleidingButton from "@/components/HandleidingButton";
import LogoutButton from "@/components/LogoutButton";

type NavItem = { href: string; label: string; exact?: boolean };
type NavGroup = { id: string; label: string; items: NavItem[] };

function buildGroups(mpPaused: boolean): NavGroup[] {
  const groups: NavGroup[] = [
    {
      id: "bezorgplanner",
      label: "Bezorgplanner",
      items: [
        { href: "/bezorgplanner/ritjes-vandaag", label: "Ritjes voor vandaag" },
        { href: "/bezorgplanner/planning", label: "Planning" },
        {
          href: "/bezorgplanner/whatsapp-debug",
          label: "WhatsApp debug",
        },
      ],
    },
  ];

  if (!mpPaused) {
    groups.push({
      id: "marktplaats",
      label: "Marktplaats",
      items: [
        { href: "/marktplaats/nieuw?soort=afhaal", label: "Afgehaald" },
        { href: "/marktplaats/nieuw?soort=bezorging", label: "Bezorgen" },
        { href: "/marktplaats/gepland", label: "Geplande MP orders" },
      ],
    });
  }

  groups.push(
    {
      id: "reparaties",
      label: "Reparaties",
      items: [
        { href: "/reparaties/prijzenlijst", label: "Prijzenlijst" },
        { href: "/reparaties/nieuw", label: "Reparatie aanmaken" },
        { href: "/reparaties/gepland", label: "Geplande reparaties" },
      ],
    },
    {
      id: "paklijst",
      label: "Paklijst",
      items: [
        { href: "/paklijst", label: "Bezorging" },
        { href: "/paklijst/pakketjes", label: "Pakketjes" },
      ],
    },
    {
      id: "voorraad",
      label: "Voorraadbeheer",
      items: [
        { href: "/voorraadbeheer/voorraad", label: "Voorraad" },
        {
          href: "/voorraadbeheer/standaard-inbegrepen",
          label: "Standaard inbegrepen",
        },
      ],
    },
    {
      id: "afgerond",
      label: "Afgeronde orders",
      items: [
        { href: "/bezorgplanner/bezorgde-orders", label: "Bezorgde orders" },
        ...(!mpPaused
          ? [{ href: "/bezorgplanner/mp-orders", label: "MP orders" }]
          : []),
      ],
    },
    {
      id: "klanten",
      label: "Klanten",
      items: [{ href: "/klanten", label: "Klanten zoeken", exact: true }],
    }
  );

  return groups;
}

function pathOnly(href: string) {
  return href.split("?")[0] || href;
}

function isActive(
  pathname: string,
  searchParams: URLSearchParams | null,
  item: NavItem
) {
  const hrefPath = pathOnly(item.href);
  if (item.exact) return pathname === hrefPath;
  if (hrefPath === "/klanten") {
    return pathname === "/klanten" || pathname.startsWith("/klanten/");
  }
  if (hrefPath === "/marktplaats/nieuw") {
    const want = new URL(item.href, "http://local").searchParams.get("soort");
    const got = searchParams?.get("soort") ?? null;
    return pathname.startsWith("/marktplaats/nieuw") && want === got;
  }
  return pathname === hrefPath || pathname.startsWith(hrefPath + "/");
}

function groupHasActive(
  pathname: string,
  searchParams: URLSearchParams | null,
  group: NavGroup
) {
  return group.items.some((item) => isActive(pathname, searchParams, item));
}

function SidebarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [mpPaused, setMpPaused] = useState(false);

  useEffect(() => {
    fetch("/api/mp-pause", { cache: "no-store" })
      .then((r) => r.json().catch(() => ({})))
      .then((d) => setMpPaused(Boolean(d?.paused)))
      .catch(() => setMpPaused(false));
  }, []);

  const groups = useMemo(() => buildGroups(mpPaused), [mpPaused]);

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        if (groupHasActive(pathname, searchParams, g)) next[g.id] = true;
      }
      return next;
    });
    setMobileOpen(false);
  }, [pathname, searchParams, groups]);

  function toggleGroup(id: string) {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <>
      {(collapsed || !mobileOpen) && (
        <button
          type="button"
          className={`sidebar-expand-btn ${collapsed ? "desktop-visible" : ""} ${mobileOpen ? "hidden-when-open" : ""}`}
          onClick={() => {
            setCollapsed(false);
            if (
              typeof window !== "undefined" &&
              window.matchMedia("(max-width: 860px)").matches
            ) {
              setMobileOpen(true);
            }
          }}
          aria-label="Menu uitklappen"
        >
          <span className="sidebar-expand-icon" aria-hidden>
            ☰
          </span>
          <span>Menu</span>
        </button>
      )}

      {mobileOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Menu sluiten"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}
        aria-hidden={collapsed}
      >
        <div className="sidebar-top">
          <Link
            href="/"
            className="sidebar-brand"
            onClick={() => setMobileOpen(false)}
          >
            <Image
              src="/koopjefatbike-logo.png"
              alt="KoopjeFatbike"
              width={140}
              height={36}
              className="h-8 w-auto object-contain"
              priority
            />
          </Link>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={() => {
              setCollapsed(true);
              setMobileOpen(false);
            }}
            aria-label="Menu inklappen"
            title="Menu inklappen"
          >
            ←
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Hoofdnavigatie">
          {groups.map((group) => {
            const open = openGroups[group.id] ?? false;
            return (
              <div key={group.id} className="sidebar-group">
                <button
                  type="button"
                  className={`sidebar-group-btn ${groupHasActive(pathname, searchParams, group) ? "has-active" : ""}`}
                  onClick={() => toggleGroup(group.id)}
                >
                  <span>{group.label}</span>
                  <span className="sidebar-chevron">{open ? "▾" : "▸"}</span>
                </button>
                {open && (
                  <div className="sidebar-items">
                    {group.items.map((item) => (
                      <Link
                        key={`${item.href}-${item.label}`}
                        href={item.href}
                        className={`sidebar-link ${isActive(pathname, searchParams, item) ? "active" : ""}`}
                        onClick={() => setMobileOpen(false)}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <HandleidingButton />
          <LogoutButton />
        </div>
      </aside>
    </>
  );
}

export function Sidebar() {
  return (
    <Suspense fallback={null}>
      <SidebarInner />
    </Suspense>
  );
}
