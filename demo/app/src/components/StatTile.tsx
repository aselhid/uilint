interface Props { label: string; value: string; delta: string; down?: boolean }

export function StatTile({ label, value, delta, down }: Props) {
  return (
    <div className="card">
      <p className="stat-label" style={{ marginLeft: 3 }}>{label}</p>
      <p className="stat-value">{value}</p>
      <p className={down ? 'stat-delta down' : 'stat-delta'}>{delta}</p>
    </div>
  );
}
