import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useSession, calculatePersonTotal } from '../context/SessionContext';
import { socket } from '../context/socket';

const TIP_PRESETS = [15, 18, 20];

export default function Summary() {
  const { sessionId } = useParams();
  const { state, dispatch } = useSession();

  const myName = state.currentUser?.name;
  const isHost = state.currentUser?.isHost;
  const savedTip = state.tipPercents[myName];
  const [tipPercent, setTipPercent] = useState(savedTip ?? 18);
  const [customTip, setCustomTip] = useState('');
  const [isCustom, setIsCustom] = useState(false);

  const myTotal = calculatePersonTotal(state, myName, tipPercent);
  const formatPrice = (p) => `$${p.toFixed(2)}`;

  // Listen for real-time updates
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

  function selectTip(pct) {
    setIsCustom(false);
    setTipPercent(pct);
    dispatch({ type: 'SET_TIP_PERCENT', name: myName, percent: pct });
    socket.emit('set-tip', { sessionId, name: myName, percent: pct });
  }

  function handleCustomTip(val) {
    setCustomTip(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed >= 0) {
      setTipPercent(parsed);
      dispatch({ type: 'SET_TIP_PERCENT', name: myName, percent: parsed });
      socket.emit('set-tip', { sessionId, name: myName, percent: parsed });
    }
  }

  // Build Venmo deep link
  function getVenmoLink() {
    const amount = myTotal.total.toFixed(2);
    const note = encodeURIComponent(`Split the Check — my share`);
    const handle = state.venmoHandle;

    const txn = 'pay';
    let recipientParam = '';
    if (handle.startsWith('@')) {
      recipientParam = handle.substring(1);
    } else {
      recipientParam = handle;
    }

    return `venmo://paycharge?txn=${txn}&recipients=${encodeURIComponent(recipientParam)}&amount=${amount}&note=${note}`;
  }

  return (
    <div className="page">
      <div className="page-header text-center">
        <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🧾</div>
        <h1>Your Share{myName ? `, ${myName}` : ''}</h1>
      </div>

      {/* Claimed items breakdown */}
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

      {/* Unclaimed items warning */}
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

      {/* Tip selector */}
      <div className="card mb-16">
        <label className="input-label mb-8">Choose your tip</label>
        <div className="tip-options mb-8">
          {TIP_PRESETS.map((pct) => (
            <button
              key={pct}
              className={`tip-btn ${!isCustom && tipPercent === pct ? 'active' : ''}`}
              onClick={() => selectTip(pct)}
            >
              {pct}%
            </button>
          ))}
          <button
            className={`tip-btn ${isCustom ? 'active' : ''}`}
            onClick={() => setIsCustom(true)}
          >
            Custom
          </button>
        </div>
        {isCustom && (
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              type="number"
              step="1"
              min="0"
              value={customTip}
              onChange={(e) => handleCustomTip(e.target.value)}
              placeholder="Enter tip %"
              autoFocus
            />
            <span style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontWeight: 600 }}>%</span>
          </div>
        )}
      </div>

      {/* Totals */}
      <div className="card card-surface mb-24">
        <div className="total-row">
          <span>Items</span>
          <span className="fw-700">{formatPrice(myTotal.itemsTotal)}</span>
        </div>
        <div className="total-row">
          <span>Tax</span>
          <span>{formatPrice(myTotal.taxShare)}</span>
        </div>
        <div className="total-row">
          <span>Tip ({tipPercent}%)</span>
          <span>{formatPrice(myTotal.tipShare)}</span>
        </div>
        <div className="total-row total-row-final">
          <span>Your total</span>
          <span>{formatPrice(myTotal.total)}</span>
        </div>
      </div>

      {/* Venmo button — only for non-hosts */}
      {!isHost && (
        <a href={getVenmoLink()} className="btn btn-venmo">
          Pay {state.hostName} {formatPrice(myTotal.total)} on Venmo
        </a>
      )}

      {isHost && (
        <div className="text-center">
          <p className="text-muted">You're the host — you'll collect payments from everyone else.</p>
        </div>
      )}

      <button
        className="btn btn-ghost mt-12"
        onClick={() => navigate(`/claim/${sessionId}`)}
      >
        Edit My Items
      </button>
    </div>
  );
}
