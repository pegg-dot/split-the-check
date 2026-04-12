import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSession, calculatePersonTotal, getAllParticipants } from '../context/SessionContext';
import { socket } from '../context/socket';

export default function HostDashboard() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useSession();
  const [expandedPerson, setExpandedPerson] = useState(null);

  const formatPrice = (p) => `$${p.toFixed(2)}`;

  // Fetch latest session state on mount + listen for real-time updates
  useEffect(() => {
    if (!socket.connected) socket.connect();
    socket.emit('create-session', {
      sessionId,
      hostName: state.hostName,
      venmoHandle: state.venmoHandle,
      items: state.items,
      subtotal: state.subtotal,
      tax: state.tax,
    });

    // Fetch fresh state via REST in case we missed socket events
    fetch(`/api/session/${sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(session => {
        if (session) dispatch({ type: 'LOAD_SESSION', session });
      })
      .catch(() => {});

    function onItemClaimed({ items }) {
      dispatch({ type: 'SYNC_ITEMS', items });
    }
    function onItemUnclaimed({ items }) {
      dispatch({ type: 'SYNC_ITEMS', items });
    }
    function onGuestJoined({ guests }) {
      dispatch({ type: 'SYNC_GUESTS', guests });
    }
    function onTipUpdated({ tipPercents }) {
      dispatch({ type: 'SYNC_TIP_PERCENTS', tipPercents });
    }
    function onPaymentUpdated({ payments }) {
      dispatch({ type: 'SYNC_PAYMENTS', payments });
    }

    socket.on('item-claimed', onItemClaimed);
    socket.on('item-unclaimed', onItemUnclaimed);
    socket.on('guest-joined', onGuestJoined);
    socket.on('tip-updated', onTipUpdated);
    socket.on('payment-updated', onPaymentUpdated);

    return () => {
      socket.off('item-claimed', onItemClaimed);
      socket.off('item-unclaimed', onItemUnclaimed);
      socket.off('guest-joined', onGuestJoined);
      socket.off('tip-updated', onTipUpdated);
      socket.off('payment-updated', onPaymentUpdated);
    };
  }, [dispatch, sessionId]);

  const participants = useMemo(() => {
    const all = getAllParticipants(state);
    return all
      .filter(name => name !== state.hostName)
      .map(name => {
        const totals = calculatePersonTotal(state, name);
        const payment = state.payments.find(p => p.guestName === name);
        // Get items this person claimed
        const claimedItems = state.items
          .filter(item => item.claims.some(c => c.guestName === name))
          .map(item => {
            const claim = item.claims.find(c => c.guestName === name);
            return {
              name: item.name,
              price: item.price,
              myShare: item.price / claim.splitCount,
              splitCount: claim.splitCount,
            };
          });
        return {
          name,
          total: totals.total,
          itemsTotal: totals.itemsTotal,
          taxShare: totals.taxShare,
          tipShare: totals.tipShare,
          tipPercent: totals.tipPercent,
          paid: payment?.paid || false,
          claimedItems,
          claimedCount: claimedItems.length,
        };
      });
  }, [state]);

  const totalCollected = participants.filter(p => p.paid).reduce((sum, p) => sum + p.total, 0);
  const totalExpected = participants.reduce((sum, p) => sum + p.total, 0);

  // Count unclaimed items
  const unclaimedCount = state.items.filter(item => item.claims.length === 0).length;

  function togglePaid(guestName) {
    const payment = state.payments.find(p => p.guestName === guestName);
    if (payment?.paid) return;

    socket.emit('mark-paid', { sessionId, guestName });
    if (!payment) {
      dispatch({ type: 'SET_PAYMENTS', payments: [...state.payments, { guestName, amount: 0, paid: true }] });
    } else {
      dispatch({ type: 'MARK_PAID', guestName });
    }
  }

  function toggleExpand(name) {
    setExpandedPerson(expandedPerson === name ? null : name);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Payment Tracker</h1>
        <p>Track who's paid their share</p>
      </div>

      {/* Summary bar */}
      <div className="card card-surface mb-16">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <p className="text-sm text-muted">Collected</p>
            <p style={{ fontSize: '1.5rem', fontWeight: 800 }}>{formatPrice(totalCollected)}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
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

      {/* Unclaimed items warning */}
      {unclaimedCount > 0 && (
        <div className="card mb-16" style={{ borderColor: 'var(--color-warning)', background: 'var(--color-warning-light)' }}>
          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-warning)' }}>
            {unclaimedCount} item{unclaimedCount > 1 ? 's' : ''} still unclaimed
          </p>
        </div>
      )}

      {/* Guest list */}
      {participants.length === 0 ? (
        <div className="text-center" style={{ padding: '32px 0' }}>
          <p className="text-muted">No guests have joined yet.</p>
          <p className="text-sm text-muted mt-8">Share the QR code to get started</p>
        </div>
      ) : (
        <div className="flex-col gap-8">
          {participants.map((person) => (
            <div key={person.name} className="card" style={{ padding: '0' }}>
              {/* Person header row */}
              <div
                style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', cursor: 'pointer', gap: '12px' }}
                onClick={() => toggleExpand(person.name)}
              >
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
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="item-name" style={{ fontWeight: 600 }}>{person.name}</span>
                    <span className={`status-pill ${person.paid ? 'status-pill-paid' : 'status-pill-pending'}`}>
                      {person.paid ? 'Paid' : 'Pending'}
                    </span>
                  </div>
                  <span className="text-sm text-muted">
                    {person.claimedCount === 0
                      ? 'No items claimed yet'
                      : `${person.claimedCount} item${person.claimedCount > 1 ? 's' : ''} claimed`}
                  </span>
                </div>
                <span className="item-price" style={{ fontSize: '1.125rem' }}>{formatPrice(person.total)}</span>
              </div>

              {/* Expanded detail */}
              {expandedPerson === person.name && (
                <div style={{ borderTop: '1px solid var(--color-border-light)', padding: '12px 16px' }}>
                  {person.claimedItems.length === 0 ? (
                    <p className="text-sm text-muted">Waiting for items to be claimed...</p>
                  ) : (
                    <>
                      {person.claimedItems.map((item, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '0.875rem' }}>
                          <span style={{ color: 'var(--color-text-secondary)' }}>
                            {item.name}
                            {item.splitCount > 1 && <span className="text-muted"> (1/{item.splitCount})</span>}
                          </span>
                          <span className="fw-700">{formatPrice(item.myShare)}</span>
                        </div>
                      ))}
                      <div style={{ borderTop: '1px solid var(--color-border-light)', marginTop: '8px', paddingTop: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.813rem', color: 'var(--color-text-muted)' }}>
                          <span>Tax</span><span>{formatPrice(person.taxShare)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.813rem', color: 'var(--color-text-muted)' }}>
                          <span>Tip ({person.tipPercent}%)</span><span>{formatPrice(person.tipShare)}</span>
                        </div>
                      </div>
                    </>
                  )}

                  {!person.paid && (
                    <button
                      className="btn btn-sm mt-12"
                      style={{ background: 'var(--color-success-light)', color: 'var(--color-success)' }}
                      onClick={(e) => { e.stopPropagation(); togglePaid(person.name); }}
                    >
                      Mark as Paid
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="spacer" />

      <div className="mt-24 flex-col gap-8">
        <button className="btn btn-primary" onClick={() => navigate(`/claim/${sessionId}`)}>
          Claim My Items
        </button>
        <button className="btn btn-secondary" onClick={() => navigate('/tip')}>
          Show QR Code
        </button>
      </div>
    </div>
  );
}
