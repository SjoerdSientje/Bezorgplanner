import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

const ORANJE = "#F7941D";

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 10, padding: "2cm 2cm 2cm 2cm", color: "#222", textAlign: "center" },
  bedrijf: { fontSize: 9, marginBottom: 16, lineHeight: 1.45, textAlign: "left" },
  bedrijfNaam: { fontFamily: "Helvetica-Bold", fontSize: 10, textAlign: "left" },
  h1: { fontFamily: "Helvetica-Bold", fontSize: 15, textAlign: "center", marginBottom: 2 },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 12, textAlign: "center", color: ORANJE, marginBottom: 14 },
  intro: { marginBottom: 10, lineHeight: 1.45, textAlign: "center" },
  letOpLabel: { fontFamily: "Helvetica-Bold", marginBottom: 3, textAlign: "center" },
  letOpTekst: { marginBottom: 14, lineHeight: 1.45, textAlign: "center" },
  sectLabel: { fontFamily: "Helvetica-Bold", marginBottom: 6, textAlign: "center" },
  bullet: { marginBottom: 5, textAlign: "center", lineHeight: 1.4 },
  dataBlok: { marginTop: 30, lineHeight: 1.85, textAlign: "center" },
  dataRij: { marginBottom: 4, textAlign: "center", fontFamily: "Helvetica-Bold", fontSize: 11 },
});

export interface GarantiePdfData {
  naam: string;
  datum: string;
  fiets: string;
  prijs: string;
  serienummer: string;
}

function Doc({ d }: { d: GarantiePdfData }) {
  return (
    <Document title="Aankoopbewijs Koopjefatbike">
      <Page size="A4" style={s.page}>

        {/* Bedrijfsgegevens */}
        <View style={s.bedrijf}>
          <Text style={s.bedrijfNaam}>KOOPJEFATBIKE.NL</Text>
          <Text>Kapelweg 2</Text>
          <Text>3732 GS De Bilt</Text>
          <Text>Telefoon: (+31) 85 401 60 06</Text>
          <Text>Whatsapp: +31687139057</Text>
          <Text>Info@koopjefatbike.nl</Text>
        </View>

        {/* Titel */}
        <Text style={s.h1}>AANKOOPBEWIJS</Text>
        <Text style={s.h2}>1 jaar GARANTIE</Text>

        {/* Intro */}
        <Text style={s.intro}>
          Dit certificaat bevestigt dat u 1 jaar garantie heeft op uw Fatbike.
        </Text>

        {/* Let op */}
        <Text style={s.letOpLabel}>Let op:</Text>
        <Text style={s.letOpTekst}>
          Schade als gevolg van verkeerd gebruik, misbruik of ongelukken valt niet onder deze garantie. Onze garantie geldt – naast de fabrieksgarantie – uitsluitend voor fabricagefouten en materiaaldefecten binnen de garantieperiode van 1 jaar.
        </Text>

        {/* Wat houdt garantie in */}
        <Text style={s.sectLabel}>Wat houdt onze garantie in?</Text>
        <Text style={s.bullet}>● U kunt met uw Fatbike altijd langskomen bij onze winkel-werkplaats. Wij herstellen het probleem dan kosteloos voor u.</Text>
        <Text style={s.bullet}>● Woont u niet in de buurt? Dan kunnen wij de benodigde onderdelen naar u opsturen.</Text>
        <Text style={s.bullet}>● U kunt ook gebruikmaken van onze Haal & Breng-service of Reparatie aan Huis-service. Hieraan zijn uitsluitend de voorrijkosten verbonden.</Text>

        {/* Klantgegevens */}
        <View style={s.dataBlok}>
          <View style={s.dataRij}>
            <Text>Naam: {d.naam}</Text>
          </View>
          <View style={s.dataRij}>
            <Text>Datum: {d.datum}</Text>
          </View>
          <View style={s.dataRij}>
            <Text>Bestelde Fatbike(s): {d.fiets}</Text>
          </View>
          <View style={s.dataRij}>
            <Text>Totaalprijs: {d.prijs}</Text>
          </View>
          {d.serienummer ? (
            <View style={s.dataRij}>
              <Text>Serienummer: {d.serienummer}</Text>
            </View>
          ) : null}
        </View>

      </Page>
    </Document>
  );
}

export async function genereerGarantiePdf(data: GarantiePdfData): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buf = await renderToBuffer(React.createElement(Doc, { d: data }) as any);
  return Buffer.from(buf);
}
