import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { BACKEND_URL } from '../context/socket';

export default function Home() {
  const navigate = useNavigate();
  const { dispatch } = useSession();
  const [name, setName] = useState('');
  const [venmo, setVenmo] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [verifying, setVerifying] = useState(false);
  const [venmoStatus, setVenmoStatus] = useState(null); // { valid, displayName, note, error }

  const CURRENCIES = [
    { code: 'USD', label: 'USD — US Dollar ($)' },
    { code: 'EUR', label: 'EUR — Euro (€)' },
    { code: 'GBP', label: 'GBP — British Pound (£)' },
    { code: 'MXN', label: 'MXN — Mexican Peso (MX$)' },
    { code: 'CAD', label: 'CAD — Canadian Dollar (C$)' },
    { code: 'AUD', label: 'AUD — Australian Dollar (A$)' },
    { code: 'JPY', label: 'JPY — Japanese Yen (¥)' },
    { code: 'CHF', label: 'CHF — Swiss Franc (CHF)' },
  ];

  const canStart = name.trim() && venmo.trim() && venmoStatus?.valid;

  async function verifyVenmo(handle) {
    if (!handle.trim()) {
      setVenmoStatus(null);
      return;
    }
    setVerifying(true);
    setVenmoStatus(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/verify-venmo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: handle.trim() }),
      });
      const data = await res.json();
      setVenmoStatus(data);
    } catch {
      setVenmoStatus({ valid: true, note: 'Could not verify — please double-check your Venmo info' });
    } finally {
      setVerifying(false);
    }
  }

  function handleVenmoChange(e) {
    const val = e.target.value;
    setVenmo(val);
    setVenmoStatus(null);
  }

  function handleVenmoBlur() {
    if (venmo.trim()) {
      verifyVenmo(venmo);
    }
  }

  function handleStart(e) {
    e.preventDefault();
    if (!canStart) return;
    dispatch({ type: 'SET_HOST', name: name.trim(), venmoHandle: venmo.trim() });
    dispatch({ type: 'SET_CURRENCY', currency, exchangeRate: 1 }); // rate fetched after scan
    navigate('/scan');
  }

  return (
    <div className="page" style={{ justifyContent: 'center' }}>
      <div className="text-center mb-24">
        <div style={{ fontSize: '3rem', marginBottom: '8px' }}>🧾</div>
        <h1>Split the Check</h1>
        <p className="mt-8">Scan. Claim. Pay. Done.</p>
      </div>

      <form onSubmit={handleStart} className="flex-col gap-12">
        <div className="input-group">
          <label className="input-label">Your name</label>
          <input
            className="input"
            type="text"
            placeholder="e.g. Sarah"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="given-name"
          />
        </div>

        <div className="input-group">
          <label className="input-label">Venmo username, phone, or email</label>
          <input
            className="input"
            type="text"
            placeholder="e.g. @sarah-jones or (555) 123-4567"
            value={venmo}
            onChange={handleVenmoChange}
            onBlur={handleVenmoBlur}
            style={{
              borderColor: venmoStatus
                ? venmoStatus.valid
                  ? 'var(--color-success)'
                  : 'var(--color-accent)'
                : undefined,
            }}
          />

          {/* Verification status */}
          {verifying && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
              <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
              <span className="text-sm text-muted">Checking Venmo...</span>
            </div>
          )}

          {venmoStatus && !verifying && venmoStatus.valid && (
            <div style={{ marginTop: '8px' }}>
              {venmoStatus.displayName ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: 'var(--color-success)', fontWeight: 700, fontSize: '1rem' }}>✓</span>
                  <span className="text-sm" style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                    {venmoStatus.displayName}
                  </span>
                </div>
              ) : venmoStatus.note ? (
                <p className="text-sm" style={{ color: 'var(--color-warning)', fontWeight: 500 }}>
                  ⚠ {venmoStatus.note}
                </p>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: 'var(--color-success)', fontWeight: 700, fontSize: '1rem' }}>✓</span>
                  <span className="text-sm" style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                    Venmo account found
                  </span>
                </div>
              )}
            </div>
          )}

          {venmoStatus && !verifying && !venmoStatus.valid && (
            <div style={{ marginTop: '8px' }}>
              <p className="text-sm" style={{ color: 'var(--color-accent)', fontWeight: 500 }}>
                {venmoStatus.error || 'Venmo account not found'}
              </p>
            </div>
          )}

          {!venmoStatus && !verifying && (
            <p className="text-sm text-muted mt-8">
              This is where your friends will send payment
            </p>
          )}
        </div>

        <div className="input-group">
          <label className="input-label">Receipt currency</label>
          <select
            className="input"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            style={{ appearance: 'auto' }}
          >
            {CURRENCIES.map(c => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
          <p className="text-sm text-muted mt-8">
            The AI will auto-detect this from your receipt too
          </p>
        </div>

        <button type="submit" className="btn btn-primary mt-16" disabled={!canStart || verifying}>
          {verifying ? 'Verifying...' : 'Start Splitting'}
        </button>
      </form>
    </div>
  );
}
