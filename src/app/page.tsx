import { redirect } from "next/navigation";

/** App opent standaard op ritjes voor vandaag. */
export default function Home() {
  redirect("/bezorgplanner/ritjes-vandaag");
}
