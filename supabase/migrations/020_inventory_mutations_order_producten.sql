-- Snapshot van de producten die in de order stonden op het moment van de
-- automatische voorraadmutatie, zodat "mutaties vandaag" kan laten zien wat
-- er besteld was naast wat er werkelijk aan voorraad is gemuteerd.
alter table inventory_mutations
  add column if not exists order_producten text;
