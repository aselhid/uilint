import { CustomerRow } from './CustomerRow';

const customers = [
  { name: 'Priya Ramanathan', email: 'priya.ramanathan.operations@northwind-logistics.com' },
  { name: 'Tomás Herrera', email: 'tomas@blueharbor.cafe' },
  { name: 'Ada Okafor', email: 'ada.okafor@juniperhealth.org' },
];

export function CustomersCard() {
  return (
    <div className="card">
      <h2 className="card-title">New customers</h2>
      {customers.map((c) => <CustomerRow key={c.email} {...c} />)}
    </div>
  );
}
