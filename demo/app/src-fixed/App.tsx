import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { StatTile } from './components/StatTile';
import { OrdersCard } from './components/OrdersCard';
import { CustomersCard } from './components/CustomersCard';

export function App() {
  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <header className="page-header">
          <div>
            <h1>Orders</h1>
            <p className="subtitle">Updated 2 minutes ago</p>
          </div>
          <Toolbar />
        </header>
        <section className="stats">
          <StatTile label="Revenue" value="$48,210" delta="+12.4% vs last week" />
          <StatTile label="Orders" value="1,284" delta="+3.1% vs last week" />
          <StatTile label="Average order" value="$37.55" delta="−1.2% vs last week" down />
        </section>
        <section className="grid">
          <OrdersCard />
          <CustomersCard />
        </section>
        <p className="footer">Showing 5 of 128 orders from the last 7 days</p>
      </main>
    </div>
  );
}
