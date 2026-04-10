import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSession, calculatePersonTotal, getAllParticipants } from '../context/SessionContext';

export default function HostDashboard() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useSession();

  const formatPrice = (p) => `$${p.toFixed(2)}`;

  const participants = useMemo(() => {
    const all = getAllParticipants(state);
    return all
      .filter(name => name !== state.hostName)
      .map(name => {
        const totals = calculatePersonTotal(state, name);
        const payment = state.payments.find(p => p.guestName === name);
        return {
          name,
          total: totals.total,
          paid: payment?.paid || false,
        };
      });
  }, [state]);

  const totalCollected = participants.filter(p => p.paid).reduce((sum, p) => sum + p.total, 0);
  const totalExpected = participants.reduce((sum, p) => sum + p.total, 0);

  function togglePaid(guestName) {
    const payment = state.payments.find(p => p.guestName === guestName);
    if (payment?.paid) return; // Can't un-mark

    // Ensure payment entry exists
    if (!payment) {
      dispatch({ type: 'SET_PAYMENTS', payments: [...state.payments, { guestName, amount: 0, paid: true }] });
    } else {
      dispatch({ type: 'MARK_PAID', guestName });
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Payment Tracker</h1>
        <p>Track who's paid their share</p>
      </div>

      {/* Summary bar */}
      <div className="card card-surface mb-24">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <p className="text-sm text-muted">Collected</p>
            <p style={{ fontSize: '1.5rem', fontWeight: 800 }}>{formatPrice(totalCollected)}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted">Expected</p>
            <p style={{ fontSize: '1.5rem', fontWeight: 800 }}>{formatPrice(totalExpected)}</p>
          </div>
        </div>
        {totalExpected > 0 && (
          <div style={{
            marginTop: '12px',
            height: '6px',
            borderRadius: '3px',
            background: 'var(--color-border)',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, (totalCollected / totalExpected) * 100)}%`,
              background: 'var(--color-success)',
              borderRadius: '3px',
              transition: 'width 0.3s ease',
            }} />
          </div>
        )}
      </div>

      {/* Guest list */}
      {participants.length === 0 ? (
        <div className="text-center" style={{ padding: '32px 0' }}>
          <p className="text-muted">No guests have joined yet.</p>
          <p className="text-sm text-muted mt-8">Share the QR code to get started</p>
        </div>
      ) : (
        <div className="card">
          {participants.map((person) => (
            <div key={person.name} className="item-row" onClick={() => togglePaid(person.name)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: person.paid ? 'var(--color-success-light)' : 'var(--color-surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.875rem',
                  fontWeight: 700,
                  color: person.paid ? 'var(--color-success)' : 'var(--color-text-muted)',
                  flexShrink: 0,
                }}>
                  {person.paid ? '✓' : person.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <span className="item-name">{person.name}</span>
                  <span className={`status-pill ${person.paid ? 'status-pill-paid' : 'status-pill-pending'}`} style={{ marginLeft: '8px' }}>
                    {person.paid ? 'Paid' : 'Pending'}
                  </span>
                </div>
              </div>
              <span className="item-price">{formatPrice(person.total)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-sm text-muted text-center mt-12">
        Tap a person to mark them as paid
      </p>

      <div className="spacer" />

      <button className="btn btn-primary mt-24" onClick={() => navigate(`/summary/${sessionId}`)}>
        View My Total
      </button>
    </div>
  );
}
