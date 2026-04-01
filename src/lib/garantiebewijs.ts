/**
 * Garantiebewijs: PDF genereren, opslaan in Supabase Storage, versturen per email (met PDF-bijlage).
 * Geen Google Drive meer – geen quota-probleem.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { genereerGarantiePdf } from "./garantiebewijs-pdf";

export interface GarantieData {
  order_id: string;
  order_nummer: string | null;
  naam: string | null;
  email: string | null;
  producten: string | null;
  serienummer: string | null;
  totaal_prijs: number | null;
  aantal_fietsen: number | null;
  datum: string;
}

export interface GarantiePdfOverrides {
  naam?: string | null;
  datum?: string | null;
  fiets?: string | null;
  prijs?: string | null;
  serienummer?: string | null;
}

function extractModelnaam(producten: string | null): string {
  if (!producten) return "";
  const match = producten.match(/^(.+?)\s+fatbike/i);
  return match ? match[1].trim() : producten.trim();
}

function formatDatum(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function getErrorMessage(err: unknown, prefix: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const g = err as { response?: { data?: { error?: { message?: string; code?: number } } }; code?: number };
  const apiMsg = g.response?.data?.error?.message;
  const code = g.response?.data?.error?.code ?? g.code;
  const part = apiMsg ? `${apiMsg}${code != null ? ` (code ${code})` : ""}` : raw;
  return `${prefix}: ${part}`;
}

const BUCKET = "garantiebewijzen";

/**
 * Genereer PDF, upload naar Supabase Storage, stuur email met link + PDF-bijlage.
 * Supabase client (service role) vereist voor upload.
 */
export async function verwerkGarantiebewijs(
  data: GarantieData,
  supabase: SupabaseClient,
  options?: { skipEmail?: boolean; pdfOverrides?: GarantiePdfOverrides }
): Promise<string> {
  const datumStr = formatDatum(new Date());
  const o = options?.pdfOverrides;
  const pdfData = {
    naam: String(o?.naam ?? data.naam ?? ""),
    datum: String(o?.datum ?? datumStr),
    fiets: String(o?.fiets ?? extractModelnaam(data.producten)),
    prijs: String(o?.prijs ?? (data.totaal_prijs != null ? `€ ${data.totaal_prijs.toFixed(2)}` : "")),
    serienummer: String(o?.serienummer ?? data.serienummer ?? ""),
  };

  const pdfBuffer = await genereerGarantiePdf(pdfData);
  const fileName = `garantiebewijs-${data.order_nummer ?? data.order_id}.pdf`;
  const path = `${data.order_id}.pdf`;

  // Zorg dat de bucket bestaat (negeer fout als hij al bestaat)
  await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => {});

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(getErrorMessage(uploadError, "PDF upload Supabase"));
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`;

  if (!options?.skipEmail) {
    await stuurGarantieEmail(data, publicUrl, pdfBuffer, fileName);
  }
  return publicUrl;
}

async function stuurGarantieEmail(
  data: GarantieData,
  garantieLink: string,
  pdfBuffer: Buffer,
  pdfFileName: string
): Promise<void> {
  const gmailUser = process.env.GMAIL_FROM;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPass) {
    throw new Error("GMAIL_FROM of GMAIL_APP_PASSWORD niet ingesteld.");
  }
  if (!data.email) {
    throw new Error("Klant heeft geen emailadres.");
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
  });

  const modelnaam = extractModelnaam(data.producten);
  const datumFormatted = formatDatum(new Date());
  const subject = `Garantiebewijs Koopjefatbike — ${modelnaam || "Fatbike"}`;
  const html = `
    <p>Beste ${data.naam ?? "klant"},</p>
    <p>Bedankt voor je aankoop bij Koopjefatbike!</p>
    <p>In de bijlage vind je jouw garantiebewijs (PDF).</p>
    <p><a href="${garantieLink}" style="color:#F7941D;font-weight:bold;">Bekijk je garantiebewijs online</a></p>
    <p>
      <strong>Product:</strong> ${modelnaam || data.producten || ""}<br>
      ${data.serienummer ? `<strong>Serienummer:</strong> ${data.serienummer}<br>` : ""}
      <strong>Datum:</strong> ${datumFormatted}
    </p>
    <p>Met vriendelijke groet,<br>Koopjefatbike</p>
  `;

  try {
    await transporter.sendMail({
      from: `Koopjefatbike <${gmailUser}>`,
      to: data.email,
      subject,
      html,
      attachments: [
        {
          filename: pdfFileName,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });
  } catch (err) {
    throw new Error(getErrorMessage(err, "Email versturen"));
  }
}
