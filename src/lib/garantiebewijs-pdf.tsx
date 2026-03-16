import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

const ORANJE = "#F7941D";

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 10, padding: "2cm 2cm 2cm 2cm", color: "#222" },
  bedrijf: { fontSize: 9, marginBottom: 16, lineHeight: 1.45 },
  bedrijfNaam: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  h1: { fontFamily: "Helvetica-Bold", fontSize: 15, textAlign: "center", marginBottom: 2 },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 12, textAlign: "center", color: ORANJE, marginBottom: 14 },
  intro: { marginBottom: 10, lineHeight: 1.45 },
  letOpLabel: { fontFamily: "Helvetica-Bold", marginBottom: 3 },
  letOpTekst: { marginBottom: 14, lineHeight: 1.45 },
  sectLabel: { fontFamily: "Helvetica-Bold", marginBottom: 6 },
  bullet: { flexDirection: "row", marginBottom: 5, paddingLeft: 4 },
  bulletPunt: { width: 14 },
  bulletTekst: { flex: 1, lineHeight: 1.4 },
  dataBlok: { marginTop: 20, lineHeight: 1.7 },
  dataRij: { flexDirection: "row" },
  dataLabel: { width: 130 },
  dataWaarde: { flex: 1 },
  snummer: { marginTop: 2 },
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
        <View style={s.bullet}>
          <Text style={s.bulletPunt}>●</Text>
          <Text style={s.bulletTekst}>U kunt met uw Fatbike altijd langskomen bij onze winkel-werkplaats. Wij herstellen het probleem dan kosteloos voor u.</Text>
        </View>
        <View style={s.bullet}>
          <Text style={s.bulletPunt}>●</Text>
          <Text style={s.bulletTekst}>Woont u niet in de buurt? Dan kunnen wij de benodigde onderdelen naar u opsturen.</Text>
        </View>
        <View style={s.bullet}>
          <Text style={s.bulletPunt}>●</Text>
          <Text style={s.bulletTekst}>U kunt ook gebruikmaken van onze Haal & Breng-service of Reparatie aan Huis-service. Hieraan zijn uitsluitend de voorrijkosten verbonden.</Text>
        </View>

        {/* Klantgegevens */}
        <View style={s.dataBlok}>
          <View style={s.dataRij}>
            <Text style={s.dataLabel}>Naam:</Text>
            <Text style={s.dataWaarde}>{d.naam}</Text>
          </View>
          <View style={s.dataRij}>
            <Text style={s.dataLabel}>Datum:</Text>
            <Text style={s.dataWaarde}>{d.datum}</Text>
          </View>
          <View style={s.dataRij}>
            <Text style={s.dataLabel}>Bestelde Fatbike(s):</Text>
            <Text style={s.dataWaarde}>{d.fiets}</Text>
          </View>
          <View style={s.dataRij}>
            <Text style={s.dataLabel}>Totaalprijs:</Text>
            <Text style={s.dataWaarde}>{d.prijs}</Text>
          </View>
          {d.serienummer ? (
            <Text style={s.snummer}>{d.serienummer}</Text>
          ) : null}
        </View>

      </Page>
    </Document>
  );
}

export async function genereerGarantiePdf(data: GarantiePdfData): Promise<Buffer> {
  const buf = await renderToBuffer(React.createElement(Doc, { d: data }));
  return Buffer.from(buf);
}
