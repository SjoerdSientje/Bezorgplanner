import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_PRODUCT_RULES_V2,
  normalizeProductDefaultItemsRules,
  type ProductDefaultItemsRulesV2,
} from "@/lib/product-default-items-rules";

/**
 * Laadt actieve productregels uit Supabase; bij ontbreken/fout valt terug op code-default.
 * v1 in DB wordt automatisch naar v2 genormaliseerd.
 */
export async function loadProductDefaultItemsRules(
  supabase: SupabaseClient,
  ownerEmail: string
): Promise<ProductDefaultItemsRulesV2> {
  const { data, error } = await supabase
    .from("product_default_items_rules")
    .select("rules")
    .eq("owner_email", ownerEmail)
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    console.warn("[product-rules] load:", error.message);
    return DEFAULT_PRODUCT_RULES_V2;
  }
  if (data?.rules != null) {
    return normalizeProductDefaultItemsRules(data.rules);
  }
  return DEFAULT_PRODUCT_RULES_V2;
}
