import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession, currencySymbol } from '../context/SessionContext';
import { BACKEND_URL } from '../context/socket';

export default function ScanReceipt() {
  const navigate = useNavigate();
  const { state, dispatch } = useSession();
  const cameraInputRef = useRef(null);
  const uploadInputRef = useRef(null);
  const [preview, setPreview]           = useState(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  // Holds raw scan data when we're waiting for the host to confirm a currency switch
  const [pendingScanData, setPendingScanData] = useState(null);

  // Downscale/compress image to stay under Claude's 5 MB base64 limit
  async function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          // Max dimension 1800px keeps receipts readable while shrinking the payload
          const MAX_DIM = 1800;
          let { width, height } = img;
          if (width > MAX_DIM || height > MAX_DIM) {
            const scale = MAX_DIM / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          // Try quality steps until base64 fits under ~4.5 MB (safe margin)
          let quality = 0.9;
          let dataUrl = canvas.toDataURL('image/jpeg', quality);
          while (dataUrl.length > 4_500_000 && quality > 0.3) {
            quality -= 0.1;
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }
          resolve(dataUrl);
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    setError(null);
    try {
      const compressed = await compressImage(file);
      setPreview(compressed);
    } catch {
      setError('Could not read that image. Try another photo.');
    }
  }

  async function handleScan() {
    if (!preview) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/scan-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: preview }),
      });

      if (!response.ok) {
        throw new Error('Failed to scan receipt. Please try again.');
      }

      const data = await response.json();

      if (!data.items || data.items.length === 0) {
        throw new Error('No items found on the receipt. Try a clearer photo.');
      }

      const detectedCurrency = (data.currency || 'USD').toUpperCase();
      const sessionCurrency  = (state.currency || 'USD').toUpperCase();

      // If the receipt currency differs from what the host chose, pause and ask.
      // Never silently switch — always require explicit confirmation.
      if (detectedCurrency !== sessionCurrency) {
        console.log(`[ScanReceipt] Currency mismatch: session=${sessionCurrency}, receipt=${detectedCurrency}`);
        setPendingScanData(data);
        return; // hold — do not dispatch or navigate yet
      }

      // Currencies match — commit immediately
      applyAndNavigate(data, detectedCurrency);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Commit scan data to state and move to review.
  // `useCurrency` is the currency the host chose to use (may differ from what was detected).
  function applyAndNavigate(data, useCurrency) {
    dispatch({ type: 'SET_ITEMS', items: data.items });
    dispatch({ type: 'SET_TAX', tax: data.tax || 0, taxNote: data.taxNote || '' });
    if (data.adminFee) dispatch({ type: 'SET_ADMIN_FEE', adminFee: data.adminFee });
    if (data.tipIncluded) dispatch({ type: 'SET_TIP_INCLUDED', tipIncluded: true, tipAmount: data.tipAmount || 0 });
    dispatch({ type: 'SET_CURRENCY', currency: useCurrency, exchangeRate: useCurrency === data.currency ? (data.exchangeRate || 1) : 1 });
    navigate('/review');
  }

  // Host confirmed: switch to the detected currency
  function handleConfirmSwitch() {
    const data = pendingScanData;
    setPendingScanData(null);
    applyAndNavigate(data, (data.currency || 'USD').toUpperCase());
  }

  // Host declined: keep the originally selected currency, use scan data as-is
  function handleKeepCurrency() {
    const data      = pendingScanData;
    const keepCurr  = (state.currency || 'USD').toUpperCase();
    setPendingScanData(null);
    applyAndNavigate(data, keepCurr);
  }

  return (
    <div className="page">
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')} style={{ alignSelf: 'flex-start', marginBottom: '8px', padding: '6px 0' }}>← Back to Home</button>
      <div className="page-header">
        <h1>Scan Receipt</h1>
        <p>Take a photo or upload an image of your receipt</p>
      </div>

      {!preview ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button
            className="btn btn-primary"
            onClick={() => cameraInputRef.current?.click()}
            style={{ fontSize: '1rem', padding: '18px', gap: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span style={{ fontSize: '1.4rem' }}>📷</span> Use Camera
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => uploadInputRef.current?.click()}
            style={{ fontSize: '1rem', padding: '18px', gap: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span style={{ fontSize: '1.4rem' }}>🖼️</span> Upload from Photos
          </button>
        </div>
      ) : (
        <div style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1.5px solid var(--color-border)' }}>
          <img
            src={preview}
            alt="Receipt preview"
            style={{ width: '100%', display: 'block' }}
          />
        </div>
      )}

      {/* Camera input — opens camera directly on mobile */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />
      {/* Upload input — opens photo library / file picker */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />

      {error && (
        <div className="card mt-16" style={{ borderColor: 'var(--color-accent)', background: 'var(--color-accent-light)' }}>
          <p style={{ color: 'var(--color-accent)', fontSize: '0.875rem', fontWeight: 500 }}>{error}</p>
        </div>
      )}

      <div className="spacer" />

      <div className="mt-24 flex-col gap-8">
        {preview && !loading && (
          <>
            <button className="btn btn-primary" onClick={handleScan}>
              Scan with AI
            </button>
            <button className="btn btn-ghost" onClick={() => { setPreview(null); setError(null); }}>
              Use Different Photo
            </button>
          </>
        )}

        {loading && (
          <div className="loading-state">
            <div className="spinner spinner-lg" />
            <p className="fw-700">Reading your receipt...</p>
            <p className="text-sm text-muted">Claude is extracting every item</p>
          </div>
        )}

        {!preview && (
          <button className="btn btn-secondary" onClick={() => navigate('/review')}>
            Enter items manually
          </button>
        )}
      </div>

      {/* ── Currency mismatch confirmation modal ── */}
      {pendingScanData && (() => {
        const detected = (pendingScanData.currency || 'USD').toUpperCase();
        const current  = (state.currency || 'USD').toUpperCase();
        const detectedSym = currencySymbol(detected);
        const currentSym  = currencySymbol(current);
        return (
          <div style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 200, padding: '24px',
          }}>
            <div style={{
              background: 'var(--color-bg)',
              borderRadius: 'var(--radius-xl)',
              padding: '28px 24px',
              width: '100%', maxWidth: '380px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '2.2rem', marginBottom: '12px' }}>💱</div>
              <h2 style={{ fontSize: '1.15rem', marginBottom: '10px' }}>Currency Mismatch</h2>
              <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginBottom: '20px', lineHeight: 1.5 }}>
                Your session is set to <strong>{current} ({currentSym})</strong>, but this receipt appears to be in{' '}
                <strong>{detected} ({detectedSym})</strong>.<br /><br />
                Would you like to switch the session to <strong>{detected}</strong>?
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  className="btn btn-primary"
                  onClick={handleConfirmSwitch}
                  style={{ fontSize: '0.95rem' }}
                >
                  Yes, switch to {detected} ({detectedSym})
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleKeepCurrency}
                  style={{ fontSize: '0.95rem' }}
                >
                  No, keep {current} ({currentSym})
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
