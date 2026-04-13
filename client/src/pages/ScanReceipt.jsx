import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function ScanReceipt() {
  const navigate = useNavigate();
  const { dispatch } = useSession();
  const fileInputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    setError(null);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result);
    reader.readAsDataURL(file);
  }

  async function handleScan() {
    if (!preview) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/scan-receipt`, {
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

      dispatch({ type: 'SET_ITEMS', items: data.items });
      if (data.tax) {
        dispatch({ type: 'SET_TAX', tax: data.tax });
      }
      if (data.adminFee) {
        dispatch({ type: 'SET_ADMIN_FEE', adminFee: data.adminFee });
      }
      if (data.tipIncluded) {
        dispatch({ type: 'SET_TIP_INCLUDED', tipIncluded: true, tipAmount: data.tipAmount || 0 });
      }
      navigate('/review');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')} style={{ alignSelf: 'flex-start', marginBottom: '8px', padding: '6px 0' }}>← Back to Home</button>
      <div className="page-header">
        <h1>Scan Receipt</h1>
        <p>Take a photo or upload an image of your receipt</p>
      </div>

      {!preview ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: '2px dashed var(--color-border)',
            borderRadius: 'var(--radius-xl)',
            padding: '48px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            background: 'var(--color-surface)',
            transition: 'border-color 0.15s ease',
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📷</div>
          <p className="fw-700" style={{ color: 'var(--color-text)' }}>Tap to photograph receipt</p>
          <p className="text-sm text-muted mt-8">JPG, PNG, or HEIC</p>
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

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
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
              Retake Photo
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
    </div>
  );
}
