import { useState } from 'react';
import { useSession } from '../context/SessionContext';
import { socket } from '../context/socket';
import { QRCodeSVG } from 'qrcode.react';

export default function QROverlay() {
  const { state } = useSession();
  const [open, setOpen] = useState(false);

  // Only show for hosts who have a session
  if (!state.sessionId || !state.currentUser?.isHost) return null;

  const sessionUrl = `${window.location.origin}/session/${state.sessionId}`;

  function handleOpen() {
    // Ensure socket is connected and session exists on server
    if (!socket.connected) socket.connect();
    socket.emit('create-session', {
      sessionId: state.sessionId,
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
    setOpen(true);
  }

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Split the Check',
          text: `${state.hostName} wants to split the bill with you!`,
          url: sessionUrl,
        });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(sessionUrl);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = sessionUrl;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      alert('Link copied!');
    } catch {}
  }

  return (
    <>
      {/* Floating QR button */}
      <button
        onClick={handleOpen}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'var(--color-accent)',
          color: '#fff',
          border: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.5rem',
          cursor: 'pointer',
          zIndex: 50,
          transition: 'transform 0.15s ease',
        }}
        aria-label="Show QR Code"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="3" height="3" />
          <line x1="21" y1="14" x2="21" y2="14.01" />
          <line x1="21" y1="21" x2="21" y2="21.01" />
          <line x1="17" y1="21" x2="17" y2="21.01" />
          <line x1="14" y1="18" x2="14" y2="18.01" />
          <line x1="18" y1="18" x2="18" y2="18.01" />
        </svg>
      </button>

      {/* Full-screen overlay */}
      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
            padding: '20px',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div style={{
            background: '#fff',
            borderRadius: '20px',
            padding: '32px 24px',
            width: '100%',
            maxWidth: '340px',
            textAlign: 'center',
          }}>
            <h2 style={{ marginBottom: '4px' }}>Scan to Join</h2>
            <p className="text-sm text-muted" style={{ marginBottom: '20px' }}>Anyone at the table can scan this</p>

            <div style={{
              display: 'inline-block',
              padding: '16px',
              background: '#fff',
              borderRadius: '12px',
              border: '1.5px solid var(--color-border)',
            }}>
              <QRCodeSVG
                value={sessionUrl}
                size={200}
                level="M"
                bgColor="transparent"
                fgColor="#1a1a1a"
              />
            </div>

            <p className="text-sm fw-700" style={{ marginTop: '12px', wordBreak: 'break-all', userSelect: 'all' }}>
              {sessionUrl}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '20px' }}>
              <button className="btn btn-primary" onClick={handleShare}>
                Send Link
              </button>
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
