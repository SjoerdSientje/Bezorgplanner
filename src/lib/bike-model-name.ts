/**
 * Haalt het korte modelnaam op uit een productnaam.
 * 'V20 PRO Fatbike 2026 + ringslot | Combi-Deal 🔥' → 'V20 PRO'
 */
export function extractModelnaamVanProduct(naam: string): string {
  const match = naam.match(/^(.+?)\s+fatbike/i);
  if (match) return match[1].trim();
  const words = naam.trim().split(/\s+/);
  return words.slice(0, 2).join(" ");
}
