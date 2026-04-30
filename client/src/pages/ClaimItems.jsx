import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession, calculatePersonTotal, formatPrice as fmtPrice } from '../context/SessionContext';
import { socket, BACKEND_URL } from '../context/socket';

export default function ClaimItems() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useSession();

  // Modals for regular items
  const [splitModalItem, setSplitModalItem]   = useState(null);
  const [splitCount, setSplitCount]           = useState(2);
  const [shareModalItem, setShareModalItem]   = useState(null);
  const [shareCount, setShareCount]           = useState(2);

  // Modal for quantity items
  const [unitsModalItem, setUnitsModalItem]   = useState(null);
  const [unitsCount, setUnitsCount]           = useState(1);

  const myName     = state.currentUser?.name;
  const formatPrice = (p) => fmtPrice(p, state.currency || 'USD');

  // ── Socket setup ──────────────────────────────────────────────────
  useEffect(() => {
    if (!socket.connected) socket.connect();
    socket.emit('rejoin-room', { sessionId });

    fetch(`${BACKEND_URL}/api/session/${sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(session => { if (session) dispatch({ type: 'LOAD_SESSION', session }); })
      .catch(() => {});

    function onSyncItems({ items }) { dispatch({ type: 'SYNC_ITEMS', items }); }
    function onGuestJoined({ guests }) { dispatch({ type: 'SYNC_GUESTS', guests }); }
    function onReconnect() { socket.emit('rejoin-room', { sessionId }); }

    socket.on('item-claimed',      onSyncItems);
    socket.on('item-unclaimed',    onSyncItems);
    socket.on('item-disputed',     onSyncItems);
    socket.on('dispute-cancelled', onSyncItems);
    socket.on('guest-joined',      onGuestJoined);
    socket.on('connect',           onReconnect);

    return () => {
      socket.off('item-claimed',      onSyncItems);
      socket.off('item-unclaimed',    onSyncItems);
      socket.off('item-disputed',     onSyncItems);
      socket.off('dispute-cancelled', onSyncItems);
      socket.off('guest-joined',      onGuestJoined);
      socket.off('connect',           onReconnect);
    };
  }, [dispatch, sessionId]);

  // ── Regular item handlers ──────────────────────────────────────────
  function handleClaim(item) {
    const myClaim = item.claims.find(c => c.guestName === myName);
    if (myClaim) {
      socket.emit('unclaim-item', { sessionId, itemId: item.id, guestName: myName });
      dispatch({ type: 'UNCLAIM_ITEM', itemId: item.id, guestName: myName });
    } else if (item.claims.length === 0) {
      setSplitModalItem(item);
      setSplitCount(1);
    } else {
      const isShared = item.claims.some(c => c.splitCount > 1);
      if (isShared) {
        const existingSplitCount = item.claims[0].splitCount;
        socket.emit('claim-item', { sessionId, itemId: item.id, guestName: myName, splitCount: existingSplitCount });
        dispatch({ type: 'CLAIM_ITEM', itemId: item.id, guestName: myName, splitCount: existingSplitCount });
      }
    }
  }

  function confirmClaim() {
    if (!splitModalItem) return;
    socket.emit('claim-item', { sessionId, itemId: splitModalItem.id, guestName: myName, splitCount });
    dispatch({ type: 'CLAIM_ITEM', itemId: splitModalItem.id, guestName: myName, splitCount });
    setSplitModalItem(null);
  }

  function handleShare(item, e) {
    e.stopPropagation();
    setShareModalItem(item);
    setShareCount(item.claims.length + 1);
  }

  function confirmShare() {
    if (!shareModalItem) return;
    const minCount  = shareModalItem.claims.length + 1;
    const finalCount = Math.max(minCount, shareCount);
    socket.emit('share-item', { sessionId, itemId: shareModalItem.id, guestName: myName, splitCount: finalCount });
    dispatch({ type: 'SHARE_ITEM', itemId: shareModalItem.id, guestName: myName, splitCount: finalCount });
    setShareModalItem(null);
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

  // ── Quantity item handlers ─────────────────────────────────────────
  function openUnitsModal(item, e) {
    e.stopPropagation();
    const totalClaimed = item.claims.reduce((s, c) => s + (c.units || 0), 0);
    const myClaim      = item.claims.find(c => c.guestName === myName);
    const remaining    = item.quantity - totalClaimed;
    if (myClaim) {
      // Already have units — unclaim
      socket.emit('unclaim-units', { sessionId, itemId: item.id, guestName: myName });
      dispatch({ type: 'UNCLAIM_UNITS', itemId: item.id, guestName: myName });
    } else if (remaining > 0) {
      setUnitsModalItem(item);
      setUnitsCount(1);
    }
  }

  function confirmUnits() {
    if (!unitsModalItem) return;
    socket.emit('claim-units', { sessionId, itemId: unitsModalItem.id, guestName: myName, units: unitsCount });
    dispatch({ type: 'CLAIM_UNITS', itemId: unitsModalItem.id, guestName: myName, units: unitsCount });
    setUnitsModalItem(null);
  }

  // ── Done ───────────────────────────────────────────────────────────
  const isHost = state.currentUser?.isHost;
  function handleDone() {
    socket.emit('done-claiming', { sessionId, guestName: myName });
    navigate(isHost ? `/host/${sessionId}` : `/summary/${sessionId}`);
  }

  const myTotal = calculatePersonTotal(state, myName);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="page">
      <div className="page-header">
        <h2>Hey {myName} 👋</h2>
        <p>Tap the items you ordered</p>
      </div>

      <div className="card">
        {state.items.map((item) => {
          const isQuantity = (item.quantity || 1) > 1;
          return isQuantity
            ? <QuantityItemRow key={item.id} item={item} myName={myName} formatPrice={formatPrice} openUnitsModal={openUnitsModal} />
            : <RegularItemRow  key={item.id} item={item} myName={myName} formatPrice={formatPrice}
                handleClaim={handleClaim} handleShare={handleShare} handleDispute={handleDispute}
                handleCancelDispute={handleCancelDispute} handleRelease={handleRelease} />;
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
      <button className="btn btn-primary mt-24" onClick={handleDone}>I'm Done Claiming</button>
      {isHost && (
        <button className="btn btn-ghost mt-8" onClick={() => navigate('/review')} style={{ fontSize: '0.875rem' }}>
          Edit Receipt
        </button>
      )}

      {/* ── Units modal (quantity items) ── */}
      {unitsModalItem && (() => {
        const totalClaimed = unitsModalItem.claims.reduce((s, c) => s + (c.units || 0), 0);
        const remaining    = unitsModalItem.quantity - totalClaimed;
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100, padding: '20px' }}
            onClick={(e) => { if (e.target === e.currentTarget) setUnitsModalItem(null); }}>
            <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-xl)', padding: '24px', width: '100%', maxWidth: '400px' }}>
              <h3 className="mb-4">How many {unitsModalItem.name}?</h3>
              <p className="text-sm text-muted mb-16">
                {formatPrice(unitsModalItem.unitPrice || unitsModalItem.price / unitsModalItem.quantity)} each · {remaining} of {unitsModalItem.quantity} remaining
              </p>

              {/* Quick-select buttons */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                {Array.from({ length: remaining }, (_, i) => i + 1).map(n => (
                  <button key={n} onClick={() => setUnitsCount(n)}
                    style={{
                      flex: '1 1 56px', padding: '12px 8px', borderRadius: '10px', border: 'none',
                      background: unitsCount === n ? 'var(--color-accent)' : 'var(--color-surface)',
                      color: unitsCount === n ? '#fff' : 'var(--color-text)',
                      fontWeight: 700, fontSize: '1rem', cursor: 'pointer',
                    }}>
                    {n === unitsModalItem.quantity ? 'All' : n}
                    <span style={{ display: 'block', fontSize: '0.688rem', fontWeight: 400, opacity: 0.75, marginTop: '2px' }}>
                      {formatPrice((unitsModalItem.unitPrice || unitsModalItem.price / unitsModalItem.quantity) * n)}
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex-col gap-8">
                <button className="btn btn-primary" onClick={confirmUnits}>
                  Claim {unitsCount === 1 ? '1 unit' : `${unitsCount} units`} — {formatPrice((unitsModalItem.unitPrice || unitsModalItem.price / unitsModalItem.quantity) * unitsCount)}
                </button>
                <button className="btn btn-ghost" onClick={() => setUnitsModalItem(null)}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Share modal (regular items) ── */}
      {shareModalItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100, padding: '20px' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShareModalItem(null); }}>
          <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-xl)', padding: '24px', width: '100%', maxWidth: '400px' }}>
            <h3 className="mb-8">🤝 I shared this</h3>
            <p className="text-sm text-muted mb-4">"{shareModalItem.name}" — {formatPrice(shareModalItem.price)}</p>
            <p className="text-sm text-muted mb-16">
              {shareModalItem.claims.length} person{shareModalItem.claims.length > 1 ? 's have' : ' has'} already claimed this.
              How many people shared it <strong>including you</strong>?
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
              <button className="btn btn-secondary btn-sm" style={{ width: '44px', padding: '10px' }}
                onClick={() => setShareCount(Math.max(shareModalItem.claims.length + 1, shareCount - 1))}>−</button>
              <span style={{ fontSize: '1.5rem', fontWeight: 800, minWidth: '30px', textAlign: 'center' }}>{shareCount}</span>
              <button className="btn btn-secondary btn-sm" style={{ width: '44px', padding: '10px' }}
                onClick={() => setShareCount(shareCount + 1)}>+</button>
            </div>
            <p className="text-sm text-muted mb-16" style={{ textAlign: 'center' }}>= {formatPrice(shareModalItem.price / shareCount)} each</p>
            <div style={{ background: '#f5f5f5', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px' }}>
              <p className="text-sm" style={{ fontWeight: 600, marginBottom: '4px' }}>Who pays what:</p>
              {shareModalItem.claims.map(c => (
                <p key={c.guestName} className="text-sm text-muted">{c.guestName}: {formatPrice(shareModalItem.price / shareCount)}</p>
              ))}
              <p className="text-sm" style={{ color: 'var(--color-accent)', fontWeight: 600 }}>You: {formatPrice(shareModalItem.price / shareCount)}</p>
            </div>
            <div className="flex-col gap-8">
              <button className="btn btn-primary" onClick={confirmShare}>Add my share ({formatPrice(shareModalItem.price / shareCount)})</button>
              <button className="btn btn-ghost" onClick={() => setShareModalItem(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Split modal (regular items, no previous claims) ── */}
      {splitModalItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100, padding: '20px' }}
          onClick={(e) => { if (e.target === e.currentTarget) setSplitModalItem(null); }}>
          <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-xl)', padding: '24px', width: '100%', maxWidth: '400px' }}>
            <h3 className="mb-8">Claim "{splitModalItem.name}"</h3>
            <p className="text-sm text-muted mb-16">{formatPrice(splitModalItem.price)} — did you share this item?</p>
            <label className="input-label">How many people shared this?</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
              <button className="btn btn-secondary btn-sm" style={{ width: '44px', padding: '10px' }}
                onClick={() => setSplitCount(Math.max(1, splitCount - 1))}>−</button>
              <span style={{ fontSize: '1.5rem', fontWeight: 800, minWidth: '30px', textAlign: 'center' }}>{splitCount}</span>
              <button className="btn btn-secondary btn-sm" style={{ width: '44px', padding: '10px' }}
                onClick={() => setSplitCount(splitCount + 1)}>+</button>
              <span className="text-muted text-sm" style={{ flex: 1 }}>= {formatPrice(splitModalItem.price / splitCount)} each</span>
            </div>
            <div className="flex-col gap-8">
              <button className="btn btn-primary" onClick={confirmClaim}>
                {splitCount === 1 ? 'Claim — just me' : `Claim my share (${formatPrice(splitModalItem.price / splitCount)})`}
              </button>
              <button className="btn btn-ghost" onClick={() => setSplitModalItem(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-component: quantity item row ──────────────────────────────────
function QuantityItemRow({ item, myName, formatPrice, openUnitsModal }) {
  const totalClaimed = item.claims.reduce((s, c) => s + (c.units || 0), 0);
  const remaining    = item.quantity - totalClaimed;
  const myClaim      = item.claims.find(c => c.guestName === myName);
  const myUnits      = myClaim?.units || 0;
  const unitPrice    = item.unitPrice || (item.price / item.quantity);

  const allClaimed   = remaining === 0;
  const iMineOnly    = myUnits > 0;

  return (
    <div className="item-row" style={{ cursor: 'pointer' }} onClick={(e) => openUnitsModal(item, e)}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            width: '22px', height: '22px', borderRadius: '6px', flexShrink: 0,
            background: myUnits > 0 ? 'var(--color-accent)' : allClaimed ? 'var(--color-border)' : '#fff3e0',
            border: myUnits > 0 ? 'none' : allClaimed ? 'none' : '2px solid #ffb74d',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: '0.75rem', fontWeight: 700, transition: 'all 0.15s',
          }}>
            {myUnits > 0 ? myUnits : allClaimed ? '🔒' : ''}
          </span>
          <span className="item-name">
            {item.name}
            <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: '4px' }}>×{item.quantity}</span>
          </span>
        </div>

        {/* Subtitle: unit price + remaining */}
        <div style={{ marginTop: '4px', marginLeft: '30px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
          <span className="text-sm text-muted">{formatPrice(unitPrice)} each</span>
          {remaining > 0 && !myUnits && (
            <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 7px', borderRadius: '8px', background: '#fff3e0', color: '#e65100' }}>
              {remaining} left
            </span>
          )}
          {remaining === 0 && !myUnits && (
            <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 7px', borderRadius: '8px', background: 'var(--color-border)', color: 'var(--color-text-muted)' }}>
              All claimed
            </span>
          )}
        </div>

        {/* Per-person claim badges */}
        {item.claims.length > 0 && (
          <div style={{ marginTop: '6px', marginLeft: '30px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {item.claims.map(c => (
              <span key={c.guestName} className="claim-badge"
                style={{ background: c.guestName === myName ? 'var(--color-accent)' : undefined, color: c.guestName === myName ? '#fff' : undefined }}>
                {c.guestName === myName ? 'You' : c.guestName} ×{c.units}
              </span>
            ))}
          </div>
        )}

        {/* Unclaim button if I have units */}
        {myUnits > 0 && (
          <div style={{ marginTop: '6px', marginLeft: '30px' }}>
            <button
              style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: '0.75rem', cursor: 'pointer' }}
              onClick={(e) => openUnitsModal(item, e)}
            >
              Remove my {myUnits === 1 ? 'unit' : `${myUnits} units`}
            </button>
          </div>
        )}
      </div>

      <span className="item-price">{formatPrice(item.price)}</span>
    </div>
  );
}

// ── Sub-component: regular (non-quantity) item row ────────────────────
function RegularItemRow({ item, myName, formatPrice, handleClaim, handleShare, handleDispute, handleCancelDispute, handleRelease }) {
  const myClaim         = item.claims.find(c => c.guestName === myName);
  const otherClaims     = item.claims.filter(c => c.guestName !== myName);
  const isMine          = !!myClaim;
  const isShared        = item.claims.some(c => c.splitCount > 1);
  const isLocked        = !isMine && item.claims.length > 0 && !isShared;
  const isClaimedByOther = !isMine && item.claims.length > 0;
  const hasDispute      = !!item.dispute;
  const disputeIsFromMe = hasDispute && item.dispute.by === myName;
  const disputeIsAboutMe = hasDispute && isMine && item.dispute.by !== myName;

  return (
    <div className="item-row" onClick={() => handleClaim(item)}
      style={{ cursor: isLocked ? 'default' : 'pointer', opacity: isLocked && !hasDispute ? 0.6 : 1, position: 'relative' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            width: '22px', height: '22px', borderRadius: '6px', flexShrink: 0, transition: 'all 0.15s ease',
            border: isMine ? 'none' : isLocked ? 'none' : '2px solid var(--color-border)',
            background: isMine ? 'var(--color-accent)' : isLocked ? 'var(--color-border)' : isShared && isClaimedByOther ? '#fff3e0' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: '0.75rem', fontWeight: 700,
          }}>
            {isMine && '✓'}
            {isLocked && '🔒'}
          </span>
          <span className="item-name">{item.name}</span>
        </div>

        {item.claims.length > 0 && (
          <div style={{ marginTop: '6px', marginLeft: '30px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {item.claims.map(c => (
                <span key={c.guestName} className="claim-badge"
                  style={{ background: c.guestName === myName ? 'var(--color-accent)' : undefined, color: c.guestName === myName ? '#fff' : undefined }}>
                  {c.guestName === myName ? 'You' : c.guestName}
                </span>
              ))}
            </div>
            {item.claims[0]?.splitCount > 1 && (
              <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: '3px' }}>
                Split {item.claims[0].splitCount} ways — {formatPrice(item.price / item.claims[0].splitCount)} each
              </p>
            )}
          </div>
        )}

        {disputeIsAboutMe && (
          <div style={{ marginTop: '8px', marginLeft: '30px', padding: '8px 12px', borderRadius: '8px', background: '#fff3e0', border: '1px solid #ffb74d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span style={{ fontSize: '0.813rem', fontWeight: 600, color: '#e65100' }}>{item.dispute.by} says this is theirs</span>
            <button className="btn btn-sm" style={{ background: '#fff', border: '1px solid #ffb74d', color: '#e65100', padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}
              onClick={(e) => handleRelease(item, e)}>Release Item</button>
          </div>
        )}

        {disputeIsFromMe && isClaimedByOther && (
          <div style={{ marginTop: '8px', marginLeft: '30px', padding: '8px 12px', borderRadius: '8px', background: '#e3f2fd', border: '1px solid #90caf9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span style={{ fontSize: '0.813rem', fontWeight: 600, color: '#1565c0' }}>Waiting for {otherClaims[0]?.guestName} to release</span>
            <button className="btn btn-sm" style={{ background: '#fff', border: '1px solid #90caf9', color: '#1565c0', padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}
              onClick={(e) => handleCancelDispute(item, e)}>Never Mind</button>
          </div>
        )}

        {isClaimedByOther && !isMine && !hasDispute && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px', marginLeft: '30px' }}>
            <button style={{ padding: '6px 12px', borderRadius: '8px', background: '#e8f5e9', border: '1px solid #81c784', color: '#2e7d32', fontSize: '0.813rem', fontWeight: 600, cursor: 'pointer' }}
              onClick={(e) => handleShare(item, e)}>🤝 I shared this</button>
            <button style={{ padding: '6px 12px', borderRadius: '8px', background: 'transparent', border: '1px dashed var(--color-accent)', color: 'var(--color-accent)', fontSize: '0.813rem', fontWeight: 600, cursor: 'pointer' }}
              onClick={(e) => handleDispute(item, e)}>This is actually mine</button>
          </div>
        )}
      </div>
      <span className="item-price">{formatPrice(item.price)}</span>
    </div>
  );
}
