import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';

export default function Home() {
  const navigate = useNavigate();
  const { dispatch } = useSession();
  const [name, setName] = useState('');
  const [venmo, setVenmo] = useState('');

  const canStart = name.trim() && venmo.trim();

  function handleStart(e) {
    e.preventDefault();
    dispatch({ type: 'SET_HOST', name: name.trim(), venmoHandle: venmo.trim() });
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
            onChange={(e) => setVenmo(e.target.value)}
          />
          <p className="text-sm text-muted mt-8">
            This is where your friends will send payment
          </p>
        </div>

        <button type="submit" className="btn btn-primary mt-16" disabled={!canStart}>
          Start Splitting
        </button>
      </form>
    </div>
  );
}
