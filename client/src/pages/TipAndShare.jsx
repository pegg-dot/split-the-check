import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { socket } from '../context/socket';

const TIP_PRESETS = [15, 18, 20];

export default function TipAndShare() {
  const navigate = useNavigate();
  const { state, dispatch } = useSession();
  const [customTip, setCustomTip] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [dollarInput, setDollarInput] = useState(state.tipDollar > 0 ? state.tipDollar.toFixed(2) : '');

  const tipMode = state.tipMode || 'percent';

  // Calculate the actual tip amount for display (always based on subtotal, pre-tax)
  let tipAmount;
  if (state.tipIncluded) {
    tipAmount = state.tipAmount || 0;
  } else if (tipMode === 'dollar') {
    tipAmount = Math.max(0, state.tipDollar || 0);
  } else {
    tipAmount = state.subtotal * (Math.max(0, state.tipPercent) / 100);
  }
  const grandTotal = state.subtotal + state.tax + (state.adminFee || 0) + tipAmount;

  // Generate session ID if not set
  useEffect(() => {
    if (!state.sessionId) {
      const id = Math.random().toString(36).substring(2, 8);
      dispatch({ type: 'SET_SESSION_ID', sessionId: id });
    }
  }, [state.sessionId, dispatch]);

  const sessionId = state.sessionId;

  // Auto-create session on mount so QR overlay works immediately
  useEffect(() => {
    if (!sessionId) return;
    if (!socket.connected) {
      socket.connect();
    }
    // Create/update session on server whenever tip settings change
    socket.emit('create-session', {
      sessionId,
      hostName: state.hostName,
      venmoHandle: state.venmoHandle,
      items: state.items,
      subtotal: state.subtotal,
      tax: state.tax,
      tipPercent: state.tipPercent,
      tipMode: state.tipMode,
      tipDollar: state.tipDollar,
      tipIncluded: state.tipIncluded,
      tipAmount: state.tipAmount,
      adminFee: state.adminFee,
    });
  }, [sessionId, state.tipPercent, state.tipMode, state.tipDollar, state.tipIncluded]);

  function selectTip(percent) {
    setIsCustom(false);
    dispatch({ type: 'SET_TIP_PERCENT', percent });
  }

  function handleCustomTip(val) {
    setCustomTip(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed >= 0) {
      dispatch({ type: 'SET_TIP_PERCENT', percent: parsed });
    } else if (val === '' || val === '-') {
      dispatch({ type: 'SET_TIP_PERCENT', percent: 0 });
    }
  }

  function handleDollarTip(val) {
    setDollarInput(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed >= 0) {
      dispatch({ type: 'SET_TIP_DOLLAR', amount: parsed });
    } else if (val === '' || val === '-') {
      dispatch({ type: 'SET_TIP_DOLLAR', amount: 0 });
    }
  }

  function setTipMode(mode) {
    dispatch({ type: 'SET_TIP_MODE', mode });
  }

  function toggleTipIncluded() {
    const newValue = !state.tipIncluded;
    dispatch({ type: 'SET_TIP_INCLUDED', tipIncluded: newValue, tipAmount: state.tipAmount });
  }

  const formatPrice = (p) => `$${p.toFixed(2)}`;

  return (
    <div className="page">
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/review')} style={{ alignSelf: 'flex-start', marginBottom: '8px', padding: '6px 0' }}>← Back to Review</button>
      <div className="page-header">
        <h1>Tip & Share</h1>
        <p>Set the tip for the table</p>
      </div>

      {/* Tip included toggle */}
      <div
        onClick={toggleTipIncluded}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderRadius: 'var(--radius-lg)',
          border: '1.5px solid var(--color-border)',
          marginBottom: '16px',
          cursor: 'pointer',
          background: state.tipIncluded ? '#e8f5e9' : 'var(--color-surface)',
          transition: 'all 0.15s ease',
        }}
      >
        <div>
          <span style={{ fontWeight: 700, fontSize: '0.938rem' }}>Tip already on the bill?</span>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
            Toggle if gratuity was already added
          </p>
        </div>
        <div style={{
          width: '48px',
          height: '28px',
          borderRadius: '14px',
          background: state.tipIncluded ? 'var(--color-accent)' : 'var(--color-border)',
          position: 'relative',
          transition: 'background 0.2s ease',
          flexShrink: 0,
        }}>
          <div style={{
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            background: '#fff',
            position: 'absolute',
            top: '3px',
            left: state.tipIncluded ? '23px' : '3px',
            transition: 'left 0.2s ease',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }} />
        </div>
      </div>

      {/* Bill summary */}
      <div className="card mb-24">
        <div className="total-row">
          <span>Subtotal</span>
          <span className="fw-700">{formatPrice(state.subtotal)}</span>
        </div>
        {(state.adminFee > 0) && (
          <div className="total-row">
            <span>Admin Fee</span>
            <span className="fw-700">{formatPrice(state.adminFee)}</span>
          </div>
        )}
        <div className="total-row">
          <span>Tax</span>
          <span className="fw-700">{formatPrice(state.tax)}</span>
        </div>
        <div className="total-row">
          <span>
            {state.tipIncluded
              ? 'Tip (included)'
              : tipMode === 'dollar'
                ? 'Tip (flat)'
                : `Tip (${state.tipPercent}%)`
            }
          </span>
          <span className="fw-700">{formatPrice(tipAmount)}</span>
        </div>
        <div className="total-row total-row-final">
          <span>Total</span>
          <span>{formatPrice(grandTotal)}</span>
        </div>
      </div>

      {/* Tip selector — only show if tip is NOT already included */}
      {!state.tipIncluded && (
        <>
          {/* Mode toggle: % vs $ */}
          <div style={{
            display: 'flex',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            border: '1.5px solid var(--color-border)',
            marginBottom: '16px',
          }}>
            <button
              onClick={() => setTipMode('percent')}
              style={{
                flex: 1,
                padding: '10px',
                border: 'none',
                background: tipMode === 'percent' ? 'var(--color-accent)' : 'transparent',
                color: tipMode === 'percent' ? '#fff' : 'var(--color-text)',
                fontWeight: 700,
                fontSize: '0.938rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Percentage %
            </button>
            <button
              onClick={() => setTipMode('dollar')}
              style={{
                flex: 1,
                padding: '10px',
                border: 'none',
                borderLeft: '1.5px solid var(--color-border)',
                background: tipMode === 'dollar' ? 'var(--color-accent)' : 'transparent',
                color: tipMode === 'dollar' ? '#fff' : 'var(--color-text)',
                fontWeight: 700,
                fontSize: '0.938rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Dollar $
            </button>
          </div>

          <p className="text-sm text-muted mb-12">
            Based on {formatPrice(state.subtotal)} subtotal (pre-tax)
          </p>

          {tipMode === 'percent' && (
            <>
              <div className="tip-options mb-16">
                {TIP_PRESETS.map((pct) => (
                  <button
                    key={pct}
                    className={`tip-btn ${!isCustom && state.tipPercent === pct ? 'active' : ''}`}
                    onClick={() => selectTip(pct)}
                  >
                    <span>{pct}%</span>
                    <span style={{ display: 'block', fontSize: '0.688rem', fontWeight: 400, opacity: 0.7, marginTop: '2px' }}>
                      {formatPrice(state.subtotal * (pct / 100))}
                    </span>
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
                <div className="input-group">
                  <div style={{ position: 'relative' }}>
                    <input
                      className="input"
                      type="number"
                      step="1"
                      min="0"
                      value={customTip}
                      onChange={(e) => handleCustomTip(e.target.value)}
                      onBlur={() => { if (customTip === '' || parseFloat(customTip) < 0) setCustomTip('0'); }}
                      placeholder="Enter tip %"
                      autoFocus
                    />
                    <span style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontWeight: 600 }}>%</span>
                  </div>
                </div>
              )}
            </>
          )}

          {tipMode === 'dollar' && (
            <div className="input-group">
              <label className="input-label">Tip amount</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontWeight: 600 }}>$</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={dollarInput}
                  onChange={(e) => handleDollarTip(e.target.value)}
                  onBlur={() => { if (dollarInput === '' || parseFloat(dollarInput) < 0) setDollarInput('0'); }}
                  placeholder="0.00"
                  style={{ paddingLeft: '32px' }}
                  autoFocus
                />
              </div>
              {state.subtotal > 0 && tipAmount > 0 && (
                <p className="text-sm text-muted mt-8">
                  Tip: {((tipAmount / state.subtotal) * 100).toFixed(1)}%
                </p>
              )}
            </div>
          )}

        </>
      )}

      {state.tipIncluded && (
        <p className="text-sm text-muted text-center">
          Tip is already on the receipt — it will be split proportionally
        </p>
      )}

      <div className="spacer" />

      <div className="mt-24 flex-col gap-8">
        <button className="btn btn-primary" onClick={() => navigate(`/claim/${sessionId}`)}>
          Claim My Items
        </button>
        <button className="btn btn-secondary" onClick={() => navigate(`/host/${sessionId}`)}>
          View Dashboard
        </button>
      </div>
    </div>
  );
}
