const items = ['Overview', 'Orders', 'Customers', 'Products', 'Settings'];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="logo">Acme</div>
      <nav className="nav">
        {items.map((item) => (
          <a key={item} href="#" className={item === 'Orders' ? 'active' : undefined}>{item}</a>
        ))}
      </nav>
    </aside>
  );
}
