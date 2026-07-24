import { LockedFeatureState } from "./LockedFeatureState";

export function UpgradeRequired({ message = "Ova funkcionalnost nije uključena u vaš trenutni paket." }: { message?: string }) {
  return <LockedFeatureState feature="premium-feature" title="Nadogradnja paketa je potrebna" description={message} />;
}
