import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_PRODUCT_RULES_V1,
  isProductDefaultItemsRulesV1,
  type ProductDefaultItemsRulesV1,
} from "@/lib/product-default-items-rules";

/**
 * Laadt actieve productregels uit Supabase; bij ontbreken/fout valt terug op code-default.
 */
export async function loadProductDefaultItemsRules(
  supabase: SupabaseClient
): Promise<ProductDefaultItemsRulesV1> {
  const { data, error } = await supabase
    .from("product_default_items_rules")
    .select("rules")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    console.warn("[product-rules] load:", error.message);
    return DEFAULT_PRODUCT_RULES_V1;
  }
  if (data?.rules != null && isProductDefaultItemsRulesV1(data.rules)) {
    return data.rules;
  }
  return DEFAULT_PRODUCT_RULES_V1;
}
