import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession, formatPrice as fmtPrice, currencySymbol, round2 } from '../context/SessionContext';
import { socket } from '../context/socket';

const TIP_PRESETS = [15, 18, 20];

export default function TipAndShare() {
  const navigate = useNavigate();
  const { state, dispatch } = useSession();
  const [customTip, setCustomTip] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [dollarInput, setDollarInput] = useState(state.tipDollar > 0 ? state.tipDollar.toFixed(2) : '');

  console.log('[TipAndShare] Mounted. state:', { subtotal: state.subtotal, tax: state.tax, tipPercent: state.tipPercent, tipIncluded: state.tipIncluded, tipAmount: state.tipAmount, sessionId: state.sessionId, items: state.items?.length });

  const tipMode = state.tipMode || 'percent';

  // The gratuity already printed on the receipt (never changes based on host selection)
  const includedGratuity = state.tipIncluded ? round2(Math.max(0, state.tipAmount || 0)) : 0;

  // The ADDITIONAL tip the host is choosing to add on top (or the only tip if no gratuity)
  let additionalTip;
  if (tipMode === 'dollar') {
    additionalTip = round2(Math.max(0, state.tipDollar || 0));
  } else {
    additionalTip = round2(Math.max(0, state.subtotal * (Math.max(0, state.tipPercent || 0) / 100)));
  }

  const grandTotal = round2(
    Math.max(0, state.subtotal) +
    Math.max(0, state.tax) +
    Math.max(0, state.adminFee || 0) +
    includedGratuity +
    additionalTip
  );

  console.log('[TipAndShare] Calculated:', { includedGratuity, additionalTip, grandTotal });

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
      currency: state.currency,
      exchangeRate: state.exchangeRate,
    });
  }, [sessionId, state.tipPercent, state.tipMode, state.tipDollar, state.tipIncluded]);

  function selectTip(percent) {
    setIsCustom(false);
    dispatch({ type: 'SET_TIP_PERCENT', percent });
  }

  function handleCustomTip(val) {
    setCustomTip(val);
    const parsed = parseFloat(val);
    const safe = isNaN(parsed) ? 0 : Math.max(0, parsed);
    dispatch({ type: 'SET_TIP_PERCENT', percent: safe });
  }

  function handleDollarTip(val) {
    setDollarInput(val);
    const parsed = parseFloat(val);
    const safe = isNaN(parsed) ? 0 : round2(Math.max(0, parsed));
    dispatch({ type: 'SET_TIP_DOLLAR', amount: safe });
  }

  function setTipMode(mode) {
    dispatch({ type: 'SET_TIP_MODE', mode });
  }

  function toggleTipIncluded() {
    const newValue = !state.tipIncluded;
    dispatch({ type: 'SET_TIP_INCLUDED', tipIncluded: newValue, tipAmount: state.tipAmount });
  }

  const formatPrice = (p) => fmtPrice(p, state.currency || 'USD');
  const curSym = currencySymbol(state.currency || 'USD');

  return (
    <div className="page">
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/review')} style={{ alignSelf: 'flex-start', marginBottom: '8px', padding: '6px 0' }}>← Back to Review</button>
      <div className="page-header">
        <h1>Tip & Share</h1>
        <p>Set the tip for the table</p>
      </div>

      {/* Gratuity-detected banner */}
      {state.tipIncluded && state.tipAmount > 0 && (
        <div style={{
          padding: '14px 16px',
          borderRadius: 'var(--radius-lg)',
          background: '#e3f2fd',
          border: '1.5px solid #90caf9',
          marginBottom: '16px',
        }}>
          <p style={{ fontWeight: 700, fontSize: '0.938rem', color: '#1565c0' }}>
            🔍 A gratuity of {formatPrice(state.tipAmount)} was detected on your receipt
          </p>
          <p style={{ fontSize: '0.813rem', color: '#1976d2', marginTop: '4px' }}>
            It's already included in the total. Would you like to add an additional tip?
          </p>
        </div>
      )}

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
        {includedGratuity > 0 && (
          <div className="total-row">
            <span>Gratuity (included)</span>
            <span className="fw-700">{formatPrice(includedGratuity)}</span>
          </div>
        )}
        {additionalTip > 0 && (
          <div className="total-row">
            <span>
              {state.tipIncluded
                ? tipMode === 'dollar' ? 'Additional tip (flat)' : `Additional tip (${state.tipPercent}%)`
                : tipMode === 'dollar' ? 'Tip (flat)' : `Tip (${state.tipPercent}%)`
              }
            </span>
            <span className="fw-700">{formatPrice(additionalTip)}</span>
          </div>
        )}
        <div className="total-row total-row-final">
          <span>Total</span>
          <span>{formatPrice(grandTotal)}</span>
        </div>
      </div>

      {/* Tip selector — always shown; if gratuity detected, framed as "additional tip" */}
      {(
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
              Flat {curSym}
            </button>
          </div>

          <p className="text-sm text-muted mb-12">
            Based on {formatPrice(state.subtotal)} subtotal (pre-tax)
          </p>

          {tipMode === 'percent' && (
            <>
              <div className="tip-options mb-16">
                <button
                  className={`tip-btn ${!isCustom && state.tipPercent === 0 ? 'active' : ''}`}
                  onClick={() => selectTip(0)}
                >
                  <span>No tip</span>
                </button>
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
                      onBlur={() => { const v = parseFloat(customTip); if (isNaN(v) || v < 0) { setCustomTip('0'); dispatch({ type: 'SET_TIP_PERCENT', percent: 0 }); } }}
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
                <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontWeight: 600 }}>{curSym}</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={dollarInput}
                  onChange={(e) => handleDollarTip(e.target.value)}
                  onBlur={() => { const v = parseFloat(dollarInput); if (isNaN(v) || v < 0) { setDollarInput('0.00'); dispatch({ type: 'SET_TIP_DOLLAR', amount: 0 }); } }}
                  placeholder="0.00"
                  style={{ paddingLeft: '32px' }}
                  autoFocus
                />
              </div>
              {state.subtotal > 0 && additionalTip > 0 && (
                <p className="text-sm text-muted mt-8">
                  Tip: {((additionalTip / state.subtotal) * 100).toFixed(1)}%
                </p>
              )}
            </div>
          )}

        </>
      )}

      {state.tipIncluded && (
        <p className="text-sm text-muted text-center">
          {state.tipPercent === 0 && !state.tipDollar
            ? 'No additional tip will be added.'
            : 'Additional tip will be added on top of the detected gratuity.'}
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
