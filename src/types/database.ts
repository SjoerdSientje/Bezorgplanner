/**
 * Database types – kolommen zoals in de sheets
 */

export type OrderSource = 'shopify' | 'mp';
export type OrderType =
  | 'verkoop'
  | 'reparatie_ophalen'
  | 'reparatie_terugbrengen'
  | 'reparatie_deur'
  | 'mp_winkel';
export type OrderStatus = 'ritjes_vandaag' | 'gepland' | 'bezorgd' | 'mp_orders';
export type SlotStatus = 'gepland' | 'onderweg' | 'afgerond';

/** Orders-tabel (basis voor alle sheets) */
export interface Order {
  id: string;
  source: OrderSource;
  type: OrderType;
  status: OrderStatus;

  order_nummer: string | null;
  naam: string | null;
  adres_url: string | null;
  bel_link: string | null;
  aankomsttijd_slot: string | null;
  bezorgtijd_voorkeur: string | null;
  meenemen_in_planning: boolean;
  nieuw_appje_sturen: boolean | null;
  datum_opmerking: string | null;
  opmerkingen_klant: string | null;
  producten: string | null;
  bestelling_totaal_prijs: number | null;
  betaald: boolean | null;
  volledig_adres: string | null;
  telefoon_nummer: string | null;
  order_id: string | null;
  datum: string | null;
  aantal_fietsen: number | null;
  email: string | null;
  telefoon_e164: string | null;
  model: string | null;
  serienummer: string | null;
  mp_tags: string | null;
  link_aankoopbewijs: string | null;

  bezorger_naam: string | null;
  betaalmethode: string | null;
  betaald_bedrag: number | null;
  afgerond_at: string | null;

  created_at: string;
  updated_at: string;
}

/** Planning slot (één stop in de bezorgplanner) */
export interface PlanningSlot {
  id: string;
  datum: string;
  order_id: string;
  volgorde: number;
  aankomsttijd: string | null;
  tijd_opmerking: string | null;
  status: SlotStatus;
  created_at: string;
}

/** Eén rij uit bezorgplanner_view (slot + order) */
export interface BezorgplannerRow {
  slot_id: string;
  order_nummer: string | null;
  naam: string | null;
  aankomsttijd: string | null;
  tijd_opmerking: string | null;
  adres_url: string | null;
  bel_link: string | null;
  bestelling_totaal_prijs: number | null;
  betaald: boolean | null;
  aantal_fietsen: number | null;
  producten: string | null;
  opmerking_klant: string | null;
  volledig_adres: string | null;
  telefoon_nummer: string | null;
  email: string | null;
  link_aankoopbewijs: string | null;
  datum: string;
  volgorde: number;
  slot_status: SlotStatus;
  order_id: string;
}

export interface Setting {
  key: string;
  value: string | null;
  updated_at: string;
}

export type OrderInsert = Omit<Order, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type PlanningSlotInsert = Omit<PlanningSlot, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};
