import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSession, calculateAllPersonTotals, formatPrice as fmtPrice, toUSD } from '../context/SessionContext';
import { socket, BACKEND_URL } from '../context/socket';

export default function Summary() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useSession();

  const myName  = state.currentUser?.name;
  const isHost  = state.currentUser?.isHost;
  const currency = state.currency || 'USD';
  const formatPrice = (p) => fmtPrice(p, currency);
  const isForeign = currency !== 'USD';

  // Track what our total was the last time the guest was ready to pay.
  // When a socket update arrives we compare against this to detect changes.
  const allTotals  = useMemo(() => calculateAllPersonTotals(state), [state]);
  const myTotal    = allTotals[myName] || { itemsTotal: 0, taxShare: 0, tipShare: 0, adminFeeShare: 0, total: 0, claimedItems: [], unclaimedItems: [] };
  const myTotalUSD = toUSD(myTotal.total, state.exchangeRate);

  // Change-notification state
  const [changeAlert, setChangeAlert] = useState(null);
  // { prevTotal, newTotal, changedBy, itemName }
  const prevTotalRef = useRef(myTotal.total);

  // ── Socket: listen for real-time item changes ──────────────────────
  useEffect(() => {
    if (!socket.connected) socket.connect();
    socket.emit('rejoin-room', { sessionId });

    function onItemsSync({ items }) {
      // Capture who/what changed before dispatching
      const prevItems = state.items;
      dispatch({ type: 'SYNC_ITEMS', items });

      // Detect new claims that involve the current guest
      if (!myName) return;
      for (const newItem of items) {
        const oldItem = prevItems.find(i => i.id === newItem.id);
        if (!oldItem) continue;
        const hadClaim = oldItem.claims.some(c => c.guestName === myName);
        const hasClaim = newItem.claims.some(c => c.guestName === myName);
        if (!hadClaim && hasClaim) {
          // Someone else just added this guest to an item (shouldn't usually happen on summary)
          continue;
        }
        // Did someone NEW join a claim on an item this guest already has?
        if (hadClaim && hasClaim) {
          const oldClaimers = oldItem.claims.length;
          const newClaimers = newItem.claims.length;
          if (newClaimers > oldClaimers) {
            const newClaimer = newItem.claims.find(c => !oldItem.claims.some(o => o.guestName === c.guestName));
            if (newClaimer) {
              // Compute new total after state update (done via SYNC_ITEMS above, but React
              // won't re-render until next tick — use the items directly)
              const fakeState = { ...state, items };
              const newTotals = calculateAllPersonTotals(fakeState);
              const newTotal  = newTotals[myName]?.total ?? myTotal.total;
              if (Math.abs(newTotal - prevTotalRef.current) >= 0.01) {
                setChangeAlert({
                  prevTotal: prevTotalRef.current,
                  newTotal,
                  changedBy: newClaimer.guestName,
                  itemName:  newItem.name,
                });
              }
            }
          }
        }
      }
    }

    function onGuestJoined({ guests }) {
      dispatch({ type: 'SYNC_GUESTS', guests });
    }
    function onReconnect() {
      socket.emit('rejoin-room', { sessionId });
    }

    socket.on('item-claimed',      onItemsSync);
    socket.on('item-unclaimed',    onItemsSync);
    socket.on('item-disputed',     onItemsSync);
    socket.on('dispute-cancelled', onItemsSync);
    socket.on('guest-joined',      onGuestJoined);
    socket.on('connect',           onReconnect);

    return () => {
      socket.off('item-claimed',      onItemsSync);
      socket.off('item-unclaimed',    onItemsSync);
      socket.off('item-disputed',     onItemsSync);
      socket.off('dispute-cancelled', onItemsSync);
      socket.off('guest-joined',      onGuestJoined);
      socket.off('connect',           onReconnect);
    };
  }, [dispatch, sessionId, state, myName]);

  // Keep prevTotalRef in sync when the guest explicitly acknowledges the change
  function dismissAlert() {
    prevTotalRef.current = myTotal.total;
    setChangeAlert(null);
  }

  // ── Venmo deep link ────────────────────────────────────────────────
  function getVenmoLink() {
    const amount = myTotalUSD.toFixed(2);
    const noteText = isForeign
      ? `Split the Check — my share (${formatPrice(myTotal.total)} → USD)`
      : `Split the Check — my share`;
    const note      = encodeURIComponent(noteText);
    const handle    = state.venmoHandle || '';
    const recipient = handle.startsWith('@') ? handle.substring(1) : handle;
    return `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(recipient)}&amount=${amount}&note=${note}`;
  }

  function handleVenmoTap() {
    if (!myName || isHost) return;
    // Block payment if there's an unacknowledged change
    if (changeAlert) return;
    socket.emit('mark-paid', { sessionId, guestName: myName });
    dispatch({ type: 'MARK_PAID', guestName: myName });
    window.location.href = getVenmoLink();
  }

  return (
    <div className="page">
      <div className="page-header text-center">
        <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🧾</div>
        <h1>Your Share{myName ? `, ${myName}` : ''}</h1>
      </div>

      {/* ── Change alert banner ─────────────────────────────────── */}
      {changeAlert && (
        <div style={{
          padding: '16px',
          borderRadius: 'var(--radius-lg)',
          background: '#fff3e0',
          border: '2px solid #ffb74d',
          marginBottom: '16px',
        }}>
          <p style={{ fontWeight: 700, fontSize: '0.938rem', color: '#e65100', marginBottom: '6px' }}>
            ⚠️ Your total changed
          </p>
          <p style={{ fontSize: '0.875rem', color: '#bf360c', marginBottom: '12px', lineHeight: 1.5 }}>
            <strong>{changeAlert.changedBy}</strong> just claimed a share of <strong>{changeAlert.itemName}</strong>.
            Your total updated from <strong>{formatPrice(changeAlert.prevTotal)}</strong> to{' '}
            <strong>{formatPrice(changeAlert.newTotal)}</strong>.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-sm"
              style={{ flex: 1, background: '#fff', border: '1.5px solid #ffb74d', color: '#e65100', fontWeight: 700 }}
              onClick={() => { dismissAlert(); navigate(`/claim/${sessionId}`); }}
            >
              Review changes
            </button>
            <button
              className="btn btn-sm"
              style={{ flex: 1, background: '#fff3e0', border: '1.5px solid #ffb74d', color: '#e65100', fontWeight: 700 }}
              onClick={dismissAlert}
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* ── Claimed items breakdown ─────────────────────────────── */}
      <div className="card mb-16">
        <h3 className="mb-8" style={{ fontSize: '0.813rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>
          Your items
        </h3>
        {myTotal.claimedItems.length === 0 && (
          <p className="text-muted text-sm" style={{ padding: '12px 0' }}>You haven't claimed any items yet.</p>
        )}
        {myTotal.claimedItems.map((item, i) => (
          <div key={i} className="item-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="item-name">{item.name}</span>
            </div>
            <span className="item-price">{formatPrice(item.myShare)}</span>
          </div>
        ))}
      </div>

      {/* ── Unclaimed items warning ─────────────────────────────── */}
      {myTotal.unclaimedItems.length > 0 && (
        <div className="card mb-16" style={{ borderColor: 'var(--color-warning)', background: 'var(--color-warning-light)' }}>
          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-warning)' }}>
            {myTotal.unclaimedItems.length} item{myTotal.unclaimedItems.length > 1 ? 's' : ''} still unclaimed
          </p>
          <p className="text-sm text-muted mt-8">
            {myTotal.unclaimedItems.map(i => i.name).join(', ')}
          </p>
        </div>
      )}

      {/* ── Totals ─────────────────────────────────────────────── */}
      <div className="card card-surface mb-24">
        <div className="total-row">
          <span>Items</span>
          <span className="fw-700">{formatPrice(myTotal.itemsTotal)}</span>
        </div>
        {myTotal.adminFeeShare > 0 && (
          <div className="total-row">
            <span>Admin Fee</span>
            <span>{formatPrice(myTotal.adminFeeShare)}</span>
          </div>
        )}
        <div className="total-row">
          <span>Tax</span>
          <span>{formatPrice(myTotal.taxShare)}</span>
        </div>
        <div className="total-row">
          <span>Tip {state.tipIncluded ? '(included)' : state.tipMode === 'dollar' ? '(flat)' : `(${state.tipPercent}%)`}</span>
          <span>{formatPrice(myTotal.tipShare)}</span>
        </div>
        <div className="total-row total-row-final">
          <span>Your total</span>
          <span>{formatPrice(myTotal.total)}</span>
        </div>
        {isForeign && (
          <div className="total-row" style={{ marginTop: '4px', paddingTop: '8px', borderTop: '1px dashed var(--color-border)' }}>
            <span className="text-muted text-sm">≈ USD</span>
            <span className="text-sm fw-700">${myTotalUSD.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* ── Venmo button ────────────────────────────────────────── */}
      {!isHost && (
        <>
          {isForeign && (
            <div className="card mb-12" style={{ background: '#e8f5e9', borderColor: '#81c784' }}>
              <p className="text-sm" style={{ fontWeight: 600, color: '#1b5e20' }}>
                Receipt is in {currency} — Venmo will charge in USD
              </p>
              <p className="text-sm" style={{ color: '#2e7d32', marginTop: '4px' }}>
                {formatPrice(myTotal.total)} ≈ ${myTotalUSD.toFixed(2)} USD
                <span style={{ opacity: 0.7, marginLeft: '6px' }}>
                  (rate: 1 {currency} = ${Number(state.exchangeRate).toFixed(4)})
                </span>
              </p>
            </div>
          )}

          {changeAlert ? (
            // Blocked state — can't pay until change is acknowledged
            <button className="btn btn-venmo" disabled style={{ opacity: 0.45, cursor: 'not-allowed' }}>
              Pay {state.hostName} ${myTotalUSD.toFixed(2)} on Venmo
            </button>
          ) : (
            <button className="btn btn-venmo" onClick={handleVenmoTap}>
              Pay {state.hostName} ${myTotalUSD.toFixed(2)} on Venmo
            </button>
          )}

          <p className="text-sm text-muted text-center mt-8">
            {changeAlert
              ? 'Acknowledge the change above before paying'
              : 'Tapping pays and marks you as paid on the host\'s dashboard'}
          </p>
        </>
      )}

      {isHost && (
        <div className="text-center">
          <p className="text-muted">You're the host — you'll collect payments from everyone else.</p>
        </div>
      )}

      <button className="btn btn-ghost mt-12" onClick={() => navigate(`/claim/${sessionId}`)}>
        Edit My Items
      </button>
    </div>
  );
}
