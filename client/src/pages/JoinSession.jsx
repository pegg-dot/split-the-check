import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../context/SessionContext';

export default function JoinSession() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { dispatch } = useSession();
  const [name, setName] = useState('');

  function handleJoin(e) {
    e.preventDefault();
    if (!name.trim()) return;
    dispatch({ type: 'JOIN_SESSION', name: name.trim() });
    navigate(`/claim/${sessionId}`);
  }

  return (
    <div className="page" style={{ justifyContent: 'center' }}>
      <div className="text-center mb-24">
        <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>👋</div>
        <h1>Join the Split</h1>
        <p className="mt-8">Enter your name to claim your items</p>
      </div>

      <form onSubmit={handleJoin} className="flex-col gap-12">
        <div className="input-group">
          <label className="input-label">Your name</label>
          <input
            className="input"
            type="text"
            placeholder="e.g. Alex"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            autoComplete="given-name"
          />
        </div>

        <button type="submit" className="btn btn-primary mt-16" disabled={!name.trim()}>
          Join Session
        </button>
      </form>
    </div>
  );
}
