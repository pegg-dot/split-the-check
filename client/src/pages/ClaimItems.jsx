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

  // Ensure socket is connected and in the room, then listen for updates
  useEffect(() => {
    if (!socket.connected) socket.connect();
    socket.emit('rejoin-room', { sessionId });

    // Fetch fresh session state to pick up any claims made while we were elsewhere
    fetch(`/api/session/${sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(session => {
        if (session) dispatch({ type: 'LOAD_SESSION', session });
      })
      .catch(() => {});

    function onSyncItems({ items }) {
      dispatch({ type: 'SYNC_ITEMS', items });
    }
    function onGuestJoined({ guests }) {
      dispatch({ type: 'SYNC_GUESTS', guests });
    }
    function onReconnect() {
      console.log('[ClaimItems] Socket reconnected, rejoining room');
      socket.emit('rejoin-room', { sessionId });
    }

    socket.on('item-claimed', onSyncItems);
    socket.on('item-unclaimed', onSyncItems);
    socket.on('item-disputed', onSyncItems);
    socket.on('dispute-cancelled', onSyncItems);
    socket.on('guest-joined', onGuestJoined);
    socket.on('connect', onReconnect);

    return () => {
      socket.off('item-claimed', onSyncItems);
      socket.off('item-unclaimed', onSyncItems);
      socket.off('item-disputed', onSyncItems);
      socket.off('dispute-cancelled', onSyncItems);
      socket.off('guest-joined', onGuestJoined);
      socket.off('connect', onReconnect);
    };
  }, [dispatch, sessionId, myName]);

  function handleClaim(item) {
    const myClaim = item.claims.find(c => c.guestName === myName);
    if (myClaim) {
      // Unclaim
      socket.emit('unclaim-item', { sessionId, itemId: item.id, guestName: myName });
      dispatch({ type: 'UNCLAIM_ITEM', itemId: item.id, guestName: myName });
    } else if (item.claims.length === 0) {
      // Unclaimed item — show split modal
      setSplitModalItem(item);
      setSplitCount(1);
    } else {
      // Item has claims — check if it's a shared item (splitCount > 1)
      const isShared = item.claims.some(c => c.splitCount > 1);
      if (isShared) {
        // Others can claim their share — use the same splitCount as existing claims
        const existingSplitCount = item.claims[0].splitCount;
        socket.emit('claim-item', { sessionId, itemId: item.id, guestName: myName, splitCount: existingSplitCount });
        dispatch({ type: 'CLAIM_ITEM', itemId: item.id, guestName: myName, splitCount: existingSplitCount });
      }
      // If splitCount === 1, it's locked — use dispute button instead
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

  function handleDispute(item, e) {
    e.stopPropagation();
    socket.emit('dispute-item', { sessionId, itemId: item.id, disputerName: myName });
    dispatch({ type: 'DISPUTE_ITEM', itemId: item.id, disputerName: myName });
  }

  function handleCancelDispute(item, e) {
    e.stopPropagation();
    socket.emit('cancel-dispute', { sessionId, itemId: item.id, disputerName: myName });
    dispatch({ type: 'CANCEL_DISPUTE', itemId: item.id });
  }

  function handleRelease(item, e) {
    e.stopPropagation();
    socket.emit('unclaim-item', { sessionId, itemId: item.id, guestName: myName });
    dispatch({ type: 'UNCLAIM_ITEM', itemId: item.id, guestName: myName });
  }

  const isHost = state.currentUser?.isHost;

  function handleDone() {
    socket.emit('done-claiming', { sessionId, guestName: myName });
    if (isHost) {
      navigate(`/host/${sessionId}`);
    } else {
      navigate(`/summary/${sessionId}`);
    }
  }

  const myTotal = calculatePersonTotal(state, myName);

  return (
    <div className="page">
      <div className="page-header">
        <h2>Hey {myName} 👋</h2>
        <p>Tap the items you ordered</p>
      </div>

      <div className="card">
        {state.items.map((item) => {
          const myClaim = item.claims.find(c => c.guestName === myName);
          const otherClaims = item.claims.filter(c => c.guestName !== myName);
          const isMine = !!myClaim;
          const isShared = item.claims.some(c => c.splitCount > 1);
          // Only locked if claimed by someone else AND it's not a shared item
          const isLocked = !isMine && item.claims.length > 0 && !isShared;
          const isClaimedByOther = !isMine && item.claims.length > 0;
          const hasDispute = !!item.dispute;
          const disputeIsFromMe = hasDispute && item.dispute.by === myName;
          const disputeIsAboutMe = hasDispute && isMine && item.dispute.by !== myName;

          return (
            <div
              key={item.id}
              className="item-row"
              onClick={() => handleClaim(item)}
              style={{
                cursor: isLocked ? 'default' : 'pointer',
                opacity: isLocked && !hasDispute ? 0.6 : 1,
                position: 'relative',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '6px',
                    border: isMine ? 'none' : isLocked ? 'none' : '2px solid var(--color-border)',
                    background: isMine ? 'var(--color-accent)' : isLocked ? 'var(--color-border)' : isShared && isClaimedByOther ? '#fff3e0' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'all 0.15s ease',
                    color: '#fff',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                  }}>
                    {isMine && '✓'}
                    {isLocked && '🔒'}
                  </span>
                  <span className="item-name">{item.name}</span>
                </div>

                {/* Show who claimed it */}
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

                {/* Dispute banner — someone disputes MY claim on this item */}
                {disputeIsAboutMe && (
                  <div style={{
                    marginTop: '8px',
                    marginLeft: '30px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: '#fff3e0',
                    border: '1px solid #ffb74d',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}>
                    <span style={{ fontSize: '0.813rem', fontWeight: 600, color: '#e65100' }}>
                      {item.dispute.by} says this is theirs
                    </span>
                    <button
                      className="btn btn-sm"
                      style={{
                        background: '#fff',
                        border: '1px solid #ffb74d',
                        color: '#e65100',
                        padding: '4px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                      }}
                      onClick={(e) => handleRelease(item, e)}
                    >
                      Release Item
                    </button>
                  </div>
                )}

                {/* Dispute sent confirmation — I flagged this item, with cancel option */}
                {disputeIsFromMe && isClaimedByOther && (
                  <div style={{
                    marginTop: '8px',
                    marginLeft: '30px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: '#e3f2fd',
                    border: '1px solid #90caf9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}>
                    <span style={{ fontSize: '0.813rem', fontWeight: 600, color: '#1565c0' }}>
                      Waiting for {otherClaims[0]?.guestName} to release
                    </span>
                    <button
                      className="btn btn-sm"
                      style={{
                        background: '#fff',
                        border: '1px solid #90caf9',
                        color: '#1565c0',
                        padding: '4px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                      }}
                      onClick={(e) => handleCancelDispute(item, e)}
                    >
                      Never Mind
                    </button>
                  </div>
                )}

                {/* "This is mine" button for LOCKED items claimed by others (no dispute yet, not shared, not mine) */}
                {isLocked && !hasDispute && !isMine && (
                  <button
                    style={{
                      marginTop: '8px',
                      marginLeft: '30px',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      background: 'transparent',
                      border: '1px dashed var(--color-accent)',
                      color: 'var(--color-accent)',
                      fontSize: '0.813rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-block',
                    }}
                    onClick={(e) => handleDispute(item, e)}
                  >
                    This is actually mine
                  </button>
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
        {myTotal.adminFeeShare > 0 && (
          <div className="total-row">
            <span className="text-muted">+ Admin Fee</span>
            <span>{formatPrice(myTotal.adminFeeShare)}</span>
          </div>
        )}
        <div className="total-row">
          <span className="text-muted">+ Tax</span>
          <span>{formatPrice(myTotal.taxShare)}</span>
        </div>
        <div className="total-row">
          <span className="text-muted">+ Tip {state.tipIncluded ? '(included)' : state.tipMode === 'dollar' ? '(flat)' : `(${state.tipPercent}%)`}</span>
          <span>{formatPrice(myTotal.tipShare)}</span>
        </div>
        <div className="total-row total-row-final">
          <span>Your total</span>
          <span>{formatPrice(myTotal.total)}</span>
        </div>
      </div>

      <div className="spacer" />

      <button className="btn btn-primary mt-24" onClick={handleDone}>
        I'm Done Claiming
      </button>
      {isHost && (
        <button
          className="btn btn-ghost mt-8"
          onClick={() => navigate('/review')}
          style={{ fontSize: '0.875rem' }}
        >
          Edit Receipt
        </button>
      )}

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
