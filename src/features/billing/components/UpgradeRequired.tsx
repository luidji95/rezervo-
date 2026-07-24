export function UpgradeRequired({ message = "Ova funkcionalnost nije uključena u vaš trenutni paket." }: { message?: string }) {
  return <section className="statistics-error" role="status"><div><h2>Nadogradnja paketa je potrebna</h2><p>{message}</p></div></section>;
}

