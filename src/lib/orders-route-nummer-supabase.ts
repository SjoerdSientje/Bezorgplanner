/**
 * Kolom `orders.route_nummer` bestaat pas na migratie 014.
 * Zonder die kolom falen PostgREST-updates/selects die route_nummer bevatten.
 */

type SupabaseLikeError = {
  message?: string;
  details?: string;
  code?: string;
} | null;

export function supabaseMissingOrdersRouteNummerColumn(err: SupabaseLikeError): boolean {
  if (!err) return false;
  const blob = `${err.message ?? ""} ${err.details ?? ""} ${err.code ?? ""}`.toLowerCase();
  if (blob.includes("route_nummer")) return true;
  if (blob.includes("42703")) return true;
  if (blob.includes("column") && blob.includes("does not exist")) return true;
  if (blob.includes("schema cache") && blob.includes("route_nummer")) return true;
  return false;
}
