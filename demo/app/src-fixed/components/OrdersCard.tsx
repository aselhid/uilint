const orders = [
  { id: '#1042', customer: 'Northwind Logistics', amount: '$1,240.00' },
  { id: '#1041', customer: 'Blue Harbor Cafe', amount: '$86.40' },
  { id: '#1040', customer: 'Kestrel Design Co.', amount: '$412.75' },
  { id: '#1039', customer: 'Juniper Health', amount: '$2,018.10' },
  { id: '#1038', customer: 'Oakline Studio', amount: '$59.00' },
];

export function OrdersCard() {
  return (
    <div className="card">
      <h2 className="card-title">Recent orders</h2>
      {orders.map((o) => (
        <div key={o.id} className="order-row">
          <span><span className="order-id">{o.id}</span>{o.customer}</span>
          <span className="amount">{o.amount}</span>
        </div>
      ))}
    </div>
  );
}
