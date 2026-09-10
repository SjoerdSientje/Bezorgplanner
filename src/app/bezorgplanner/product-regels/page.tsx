import { redirect } from "next/navigation";

/** Oude URL → nieuwe plek onder Voorraadbeheer. */
export default function ProductRegelsRedirect() {
  redirect("/voorraadbeheer/standaard-inbegrepen");
}
