interface Props { name: string; email: string }

export function CustomerRow({ name, email }: Props) {
  const initials = name.split(' ').map((part) => part[0]).join('');
  return (
    <div className="customer-row">
      <span className="avatar">{initials}</span>
      <div className="customer-text">
        <span>{name}</span>
        <span className="email" style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>{email}</span>
      </div>
    </div>
  );
}
