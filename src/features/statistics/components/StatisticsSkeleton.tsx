export function StatisticsSkeleton() {
  return <div className="statistics-skeleton" aria-label="Učitavanje statistike"><div className="statistics-skeleton__kpis">{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</div><i className="statistics-skeleton__chart" /><div className="statistics-skeleton__grid"><i /><i /></div></div>;
}
