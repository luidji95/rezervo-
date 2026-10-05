"use client";

import { useEntitlements } from "../hooks/useEntitlements";
import { getEntitlementActionState } from "../services/entitlementLoadState";

export function EntitlementStatus() {
  const state = useEntitlements();
  const actions = getEntitlementActionState(state);
  if (state.loading) return <p role="status">Učitavanje prava pristupa…</p>;
  if (actions.loadFailed) return <div role="alert"><p>Prava pristupa nisu učitana. Izmene su privremeno onemogućene.</p><button type="button" onClick={() => void state.refetchEntitlements()}>Pokušaj ponovo</button></div>;
  if (actions.readOnly) return <p role="status">Vaš nalog trenutno ima pristup samo za pregled. Status i dostupne opcije pogledajte u podešavanjima paketa.</p>;
  return null;
}
