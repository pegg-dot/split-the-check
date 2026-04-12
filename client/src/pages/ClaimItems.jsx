import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession, calculatePersonTotal } from '../context/SessionContext';
import { socket } from '../context/socket';

export default function ClaimItems() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useSession();
  const [splitModalItem, setSplitModalItem] = useState(null);
  const [splitCount, setSplitCount] = useState(2);

  const myName = state.currentUser?.name;
  const formatPrice = (p) => `$${p.toFixed(2)}`;

  // Listen for real-time item updates
  useEffect(() => {
    function onItemClaimed({ items }) {
      dispatch({ type: 'SYNC_ITEMS', items });
    }
    function onItemUnclaimed({ items }) {
      dispatch({ type: 'SYNC_ITEMS', items });
    }
    function onGuestJoined({ guests }) {
      dispatch({ type: 'SYNC_GUESTS', guests });
    }

    socket.on('item-claimed', onItemClaimed);
    socket.on('item-unclaimed', onItemUnclaimed);
    socket.on('guest-joined', onGuestJoined);

    return () => {
      socket.off('item-claimed', onItemClaimed);
      socket.off('item-unclaimed', onItemUnclaimed);
      socket.off('guest-joined', onGuestJoined);
    };
  }, [dispatch]);

  function handleClaim(item) {
    const myClaim = item.claims.find(c => c.guestName === myName);
    if (myClaim) {
      // Unclaim
      socket.emit('unclaim-item', { sessionId, itemId: item.id, guestName: myName });
      dispatch({ type: 'UNCLAIM_ITEM', itemId: item.id, guestName: myName });
    } else {
      // Show split modal
      setSplitModalItem(item);
      setSplitCount(1);
    }
  }

  function confirmClaim() {
    if (!splitModalItem) return;
    socket.emit('claim-item', {
      sessionId,
      itemId: splitModalItem.id,
      guestName: myName,
      splitCount: splitCount,
    });
    dispatch({
      type: 'CLAIM_ITEM',
      itemId: splitModalItem.id,
      guestName: myName,
      splitCount: splitCount,
    });
    setSplitModalItem(null);
  }

  const isHost = state.currentUser?.isHost;

  function handleDone() {
    if (isHost) {
      navigate(`/host/${sessionId}`);
    } else {
      navigate(`/summary/${sessionId}`);
    }
  }

  const myTotal = calculatePersonTotal(state, myName);

  return (
    <div className="page">
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => navigate(-1)}
        style={{ alignSelf: 'flex-start', marginBottom: '8px', padding: '6px 0' }}
      >
        ← Back
      </button>
      <div className="page-header">
        <h2>Hey {myName} 👋</h2>
        <p>Tap the items you ordered</p>
      </div>

      <div className="card">
        {state.items.map((item) => {
          const myClaim = item.claims.find(c => c.guestName === myName);
          const otherClaims = item.claims.filter(c => c.guestName !== myName);
          const isClaimed = !!myClaim;

          return (
            <div
              key={item.id}
              className="item-row"
              onClick={() => handleClaim(item)}
              style={{ cursor: 'pointer' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '6px',
                    border: isClaimed ? 'none' : '2px solid var(--color-border)',
                    background: isClaimed ? 'var(--color-accent)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'all 0.15s ease',
                    color: '#fff',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                  }}>
                    {isClaimed && '✓'}
                  </span>
                  <span className="item-name">{item.name}</span>
                </div>
                {(otherClaims.length > 0 || (myClaim && myClaim.splitCount > 1)) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px', marginLeft: '30px' }}>
                    {myClaim && myClaim.splitCount > 1 && (
                      <span className="claim-badge">You (1/{myClaim.splitCount})</span>
                    )}
                    {myClaim && myClaim.splitCount === 1 && (
                      <span className="claim-badge">You</span>
                    )}
                    {otherClaims.map((c) => (
                      <span key={c.guestName} className="claim-badge">
                        {c.guestName} {c.splitCount > 1 ? `(1/${c.splitCount})` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="item-price">{formatPrice(item.price)}</span>
            </div>
          );
        })}
      </div>

      {/* Running total */}
      <div className="card card-surface mt-16">
        <div className="total-row">
          <span>Your items</span>
          <span className="fw-700">{formatPrice(myTotal.itemsTotal)}</span>
        </div>
        <div className="total-row">
          <span className="text-muted">+ Tax</span>
          <span>{formatPrice(myTotal.taxShare)}</span>
        </div>
        <div className="total-row total-row-final">
          <span>Before tip</span>
          <span>{formatPrice(myTotal.itemsTotal + myTotal.taxShare)}</span>
        </div>
        <p className="text-sm text-muted text-center mt-8">You'll choose your tip next</p>
      </div>

      <div className="spacer" />

      <button className="btn btn-primary mt-24" onClick={handleDone}>
        I'm Done Claiming
      </button>

      {/* Split modal */}
      {splitModalItem && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          zIndex: 100,
          padding: '20px',
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setSplitModalItem(null); }}
        >
          <div style={{
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-xl)',
            padding: '24px',
            width: '100%',
            maxWidth: '400px',
          }}>
            <h3 className="mb-8">Claim "{splitModalItem.name}"</h3>
            <p className="text-sm text-muted mb-16">
              {formatPrice(splitModalItem.price)} — did you share this item?
            </p>

            <label className="input-label">How many people shared this?</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
              <button
                className="btn btn-secondary btn-sm"
                style={{ width: '44px', padding: '10px' }}
                onClick={() => setSplitCount(Math.max(1, splitCount - 1))}
              >
                −
              </button>
              <span style={{ fontSize: '1.5rem', fontWeight: 800, minWidth: '30px', textAlign: 'center' }}>
                {splitCount}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                style={{ width: '44px', padding: '10px' }}
                onClick={() => setSplitCount(splitCount + 1)}
              >
                +
              </button>
              <span className="text-muted text-sm" style={{ flex: 1 }}>
                = {formatPrice(splitModalItem.price / splitCount)} each
              </span>
            </div>

            <div className="flex-col gap-8">
              <button className="btn btn-primary" onClick={confirmClaim}>
                {splitCount === 1 ? 'Claim — just me' : `Claim my share (${formatPrice(splitModalItem.price / splitCount)})`}
              </button>
              <button className="btn btn-ghost" onClick={() => setSplitModalItem(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
