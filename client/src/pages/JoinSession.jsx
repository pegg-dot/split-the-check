import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { socket } from '../context/socket';

export default function JoinSession() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useSession();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }

    function onSessionState(session) {
      dispatch({ type: 'LOAD_SESSION', session });
      setLoading(false);
      navigate(`/claim/${sessionId}`);
    }

    function onError(err) {
      setError(err.message || 'Session not found');
      setLoading(false);
    }

    socket.on('session-state', onSessionState);
    socket.on('error', onError);

    return () => {
      socket.off('session-state', onSessionState);
      socket.off('error', onError);
    };
  }, [sessionId, dispatch, navigate]);

  function handleJoin(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);

    dispatch({ type: 'JOIN_SESSION', name: name.trim() });
    socket.emit('join-session', { sessionId, guestName: name.trim() });
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

        {error && (
          <div className="card" style={{ borderColor: 'var(--color-accent)', background: 'var(--color-accent-light)' }}>
            <p style={{ color: 'var(--color-accent)', fontSize: '0.875rem', fontWeight: 500 }}>{error}</p>
          </div>
        )}

        <button type="submit" className="btn btn-primary mt-16" disabled={!name.trim() || loading}>
          {loading ? 'Joining...' : 'Join Session'}
        </button>
      </form>
    </div>
  );
}
