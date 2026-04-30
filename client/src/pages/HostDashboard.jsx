import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSession, calculateAllPersonTotals, getAllParticipants, formatPrice as fmtPrice, round2 } from '../context/SessionContext';
import { socket, BACKEND_URL } from '../context/socket';

export default function HostDashboard() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useSession();
  const [doneClaiming, setDoneClaiming] = useState([]);

  const formatPrice = (p) => fmtPrice(p, state.currency || 'USD');

  // Fetch latest session state on mount + listen for real-time updates
  useEffect(() => {
    if (!socket.connected) socket.connect();
    socket.emit('rejoin-room', { sessionId });

    // Fetch fresh state via REST in case we missed socket events
    fetch(`${BACKEND_URL}/api/session/${sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(session => {
        if (session) {
          dispatch({ type: 'LOAD_SESSION', session });
          if (session.doneClaiming) setDoneClaiming(session.doneClaiming);
          // Ensure currentUser is set as host (important on fresh mobile load)
          dispatch({ type: 'SET_HOST', name: session.hostName, venmoHandle: session.venmoHandle });
        }
      })
      .catch(() => {});

    function onSyncItems({ items }) {
      dispatch({ type: 'SYNC_ITEMS', items });
    }
    function onGuestJoined({ guests }) {
      dispatch({ type: 'SYNC_GUESTS', guests });
    }
    function onPaymentUpdated({ payments }) {
      dispatch({ type: 'SYNC_PAYMENTS', payments });
    }
    function onClaimingUpdate({ doneClaiming: done }) {
      setDoneClaiming(done);
    }

    socket.on('item-claimed', onSyncItems);
    socket.on('item-unclaimed', onSyncItems);
    socket.on('item-disputed', onSyncItems);
    socket.on('dispute-cancelled', onSyncItems);
    socket.on('guest-joined', onGuestJoined);
    socket.on('payment-updated', onPaymentUpdated);
    socket.on('claiming-update', onClaimingUpdate);

    return () => {
      socket.off('item-claimed', onSyncItems);
      socket.off('item-unclaimed', onSyncItems);
      socket.off('item-disputed', onSyncItems);
      socket.off('dispute-cancelled', onSyncItems);
      socket.off('guest-joined', onGuestJoined);
      socket.off('payment-updated', onPaymentUpdated);
      socket.off('claiming-update', onClaimingUpdate);
    };
  }, [dispatch, sessionId]);

  // Build data for all participants using exact cent distribution (no rounding drift)
  const everyone = useMemo(() => {
    const allTotals = calculateAllPersonTotals(state);
    return getAllParticipants(state).map(name => {
      const totals  = allTotals[name] || {};
      const payment = state.payments.find(p => p.guestName === name);
      return {
        name,
        isHost:       name === state.hostName,
        total:        totals.total        || 0,
        itemsTotal:   totals.itemsTotal   || 0,
        taxShare:     totals.taxShare     || 0,
        tipShare:     totals.tipShare     || 0,
        adminFeeShare: totals.adminFeeShare || 0,
        paid:         name === state.hostName ? true : (payment?.paid || false),
        claimedItems: (totals.claimedItems || []).map(item => ({
          name:       item.name,
          price:      item.price,
          myShare:    item.myShare,
          splitCount: item.claims?.find(c => c.guestName === name)?.splitCount || 1,
        })),
      };
    });
  }, [state]);

  const guests = everyone.filter(p => !p.isHost);
  const hostData = everyone.find(p => p.isHost);
  const totalCollected = round2(guests.filter(p => p.paid).reduce((sum, p) => round2(sum + p.total), 0));
  const totalExpected = round2(guests.reduce((sum, p) => round2(sum + p.total), 0));
  const fullyUnclaimed = state.items.filter(item => item.claims.length === 0);
  const partiallyClaimed = state.items.filter(item => {
    if (item.claims.length === 0) return false;
    const splitCount = item.claims[0]?.splitCount || 1;
    return splitCount > 1 && item.claims.length < splitCount;
  });
  const unclaimedItems = [...fullyUnclaimed, ...partiallyClaimed];
  const unclaimedCount = unclaimedItems.length;

  // Guests who joined but haven't finished claiming yet
  const stillClaiming = state.guests
    .map(g => g.name)
    .filter(name => name !== state.hostName && !doneClaiming.includes(name));

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

  return (
    <div className="page">
      {/* Receipt header */}
      <div style={{
        textAlign: 'center',
        padding: '20px 0 12px',
        borderBottom: '2px dashed var(--color-border)',
        marginBottom: '16px',
      }}>
        <h1 style={{ fontSize: '1.5rem', letterSpacing: '0.05em' }}>SPLIT THE CHECK</h1>
        <p className="text-sm text-muted" style={{ marginTop: '4px' }}>Payment Tracker</p>
      </div>

      {/* Progress bar */}
      <div style={{ padding: '0 0 16px', borderBottom: '1px dashed var(--color-border)', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span className="text-sm text-muted">Collected</span>
          <span className="text-sm" style={{ fontWeight: 700 }}>{formatPrice(totalCollected)} / {formatPrice(totalExpected)}</span>
        </div>
        {totalExpected > 0 && (
          <div style={{
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

      {/* Unclaimed warning with item names */}
      {unclaimedCount > 0 && (
        <div style={{
          padding: '10px 16px',
          borderRadius: '8px',
          background: '#fff3e0',
          border: '1px solid #ffb74d',
          marginBottom: '16px',
          textAlign: 'center',
        }}>
          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#e65100' }}>
            {unclaimedCount} item{unclaimedCount > 1 ? 's' : ''} not fully claimed
          </p>
          <p style={{ fontSize: '0.75rem', color: '#bf360c', marginTop: '4px' }}>
            {unclaimedItems.map(i => {
              const isPartial = i.claims.length > 0 && i.claims.length < (i.claims[0]?.splitCount || 1);
              return isPartial ? `${i.name} (${i.claims.length}/${i.claims[0].splitCount} claimed)` : i.name;
            }).join(', ')}
          </p>
        </div>
      )}

      {/* Still claiming */}
      {stillClaiming.length > 0 && (
        <div style={{
          padding: '8px 16px',
          borderRadius: '8px',
          background: '#e3f2fd',
          border: '1px solid #90caf9',
          marginBottom: '16px',
          textAlign: 'center',
        }}>
          <p style={{ fontSize: '0.813rem', fontWeight: 600, color: '#1565c0' }}>
            Still claiming: {stillClaiming.join(', ')}
          </p>
        </div>
      )}

      {/* Receipt body — each person is a line item */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
        {everyone.map((person, idx) => (
          <div key={person.name} style={{
            padding: '14px 0',
            borderBottom: idx < everyone.length - 1 ? '1px solid var(--color-border-light)' : 'none',
          }}>
            {/* Name + total row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>
                  {person.name}
                  {person.isHost && <span className="text-muted" style={{ fontWeight: 400, fontSize: '0.75rem', marginLeft: '6px' }}>(you)</span>}
                </span>
                {!person.isHost && (
                  <span style={{
                    fontSize: '0.688rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '10px',
                    background: person.paid ? 'var(--color-success-light, #e8f5e9)' : '#fff3e0',
                    color: person.paid ? 'var(--color-success, #2e7d32)' : '#e65100',
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                  }}>
                    {person.paid ? 'Paid' : 'Pending'}
                  </span>
                )}
              </div>
              <span style={{ fontWeight: 800, fontSize: '1.05rem', fontFamily: 'monospace' }}>
                {formatPrice(person.total)}
              </span>
            </div>

            {/* Claimed items as sub-lines */}
            {person.claimedItems.length > 0 ? (
              <div style={{ marginTop: '6px', paddingLeft: '2px' }}>
                {person.claimedItems.map((item, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.813rem',
                    color: 'var(--color-text-muted)',
                    padding: '2px 0',
                  }}>
                    <span>
                      {item.name}
                      {item.splitCount > 1 && <span style={{ opacity: 0.7 }}> (1/{item.splitCount})</span>}
                    </span>
                    <span style={{ fontFamily: 'monospace' }}>{formatPrice(item.myShare)}</span>
                  </div>
                ))}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.75rem',
                  color: 'var(--color-text-muted)',
                  padding: '2px 0',
                  opacity: 0.7,
                }}>
                  <span>Tax{person.adminFeeShare > 0 ? ' + Fee' : ''} + Tip {state.tipIncluded ? '(incl.)' : state.tipMode === 'dollar' ? '(flat)' : `(${state.tipPercent}%)`}</span>
                  <span style={{ fontFamily: 'monospace' }}>{formatPrice(round2(person.taxShare + person.tipShare + (person.adminFeeShare || 0)))}</span>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: '0.813rem', color: 'var(--color-text-muted)', marginTop: '4px', fontStyle: 'italic' }}>
                No items claimed yet
              </p>
            )}

            {/* Mark as Paid button for guests */}
            {!person.isHost && !person.paid && person.claimedItems.length > 0 && (
              <button
                style={{
                  marginTop: '8px',
                  padding: '6px 14px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'var(--color-success-light, #e8f5e9)',
                  color: 'var(--color-success, #2e7d32)',
                  fontSize: '0.813rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                onClick={() => togglePaid(person.name)}
              >
                Mark as Paid
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Receipt footer with total */}
      <div style={{
        borderTop: '2px dashed var(--color-border)',
        marginTop: '16px',
        paddingTop: '16px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 800, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Bill Total
          </span>
          <span style={{ fontWeight: 800, fontSize: '1.25rem', fontFamily: 'monospace' }}>
            {formatPrice(round2(everyone.reduce((sum, p) => round2(sum + p.total), 0)))}
          </span>
        </div>
        {hostData && hostData.total > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
            <span className="text-sm text-muted">Your share</span>
            <span className="text-sm" style={{ fontWeight: 700, fontFamily: 'monospace' }}>{formatPrice(hostData.total)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
          <span className="text-sm text-muted">Owed to you</span>
          <span className="text-sm" style={{ fontWeight: 700, fontFamily: 'monospace' }}>{formatPrice(totalExpected)}</span>
        </div>
      </div>

      {/* No guests message */}
      {guests.length === 0 && (
        <div className="text-center" style={{ padding: '24px 0' }}>
          <p className="text-muted">No guests have joined yet.</p>
          <p className="text-sm text-muted mt-8">Share the QR code to get started</p>
        </div>
      )}

      {/* All paid celebration */}
      {guests.length > 0 && guests.every(p => p.paid) && (
        <div style={{
          textAlign: 'center',
          padding: '20px 0',
          marginTop: '16px',
        }}>
          <p style={{ fontSize: '1.5rem', marginBottom: '4px' }}>All settled up!</p>
          <p className="text-sm text-muted">Everyone has paid their share</p>
        </div>
      )}

      <div className="spacer" />

      <div className="mt-24 flex-col gap-8">
        <button className="btn btn-primary" onClick={() => navigate(`/claim/${sessionId}`)}>
          Edit My Items
        </button>
        {guests.length > 0 && guests.every(p => p.paid) && (
          <button
            className="btn btn-secondary"
            style={{ background: 'var(--color-success-light, #e8f5e9)', color: 'var(--color-success, #2e7d32)', border: 'none' }}
            onClick={() => navigate('/')}
          >
            Done — Close Session
          </button>
        )}
      </div>
    </div>
  );
}
