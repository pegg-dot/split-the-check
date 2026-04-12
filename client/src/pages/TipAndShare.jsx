import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { socket } from '../context/socket';
import { QRCodeSVG } from 'qrcode.react';

export default function TipAndShare() {
  const navigate = useNavigate();
  const { state, dispatch } = useSession();
  const [showQR, setShowQR] = useState(false);

  const sessionId = useMemo(() => {
    if (state.sessionId) return state.sessionId;
    const id = Math.random().toString(36).substring(2, 8);
    dispatch({ type: 'SET_SESSION_ID', sessionId: id });
    return id;
  }, [state.sessionId]);

  const sessionUrl = `${window.location.origin}/session/${sessionId}`;

  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }
  }, []);

  function handleShare() {
    // Create session on server
    socket.emit('create-session', {
      sessionId,
      hostName: state.hostName,
      venmoHandle: state.venmoHandle,
      items: state.items,
      subtotal: state.subtotal,
      tax: state.tax,
    });
    setShowQR(true);
  }

  const [copied, setCopied] = useState(false);

  async function handleCopyLink() {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(sessionUrl);
      } else {
        // Fallback for non-HTTPS (LAN IP)
        const textArea = document.createElement('textarea');
        textArea.value = sessionUrl;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Last resort — select the URL text so user can manually copy
      const urlEl = document.querySelector('.session-url');
      if (urlEl) {
        const range = document.createRange();
        range.selectNodeContents(urlEl);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
      }
    }
  }

  const formatPrice = (p) => `$${p.toFixed(2)}`;

  if (showQR) {
    return (
      <div className="page" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <h2 className="mb-8">Share with your table</h2>
        <p className="text-muted mb-24">Everyone scans this to join</p>

        <div className="qr-container">
          <QRCodeSVG
            value={sessionUrl}
            size={220}
            level="M"
            bgColor="transparent"
            fgColor="#1a1a1a"
          />
          <p className="text-sm fw-700 session-url" style={{ wordBreak: 'break-all', userSelect: 'all' }}>{sessionUrl}</p>
        </div>

        <div className="mt-24 flex-col gap-8" style={{ width: '100%' }}>
          <button className="btn btn-secondary" onClick={handleCopyLink}>
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
          <button className="btn btn-primary" onClick={() => navigate(`/host/${sessionId}`)}>
            View Host Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Bill Summary</h1>
        <p>Review the totals, then share with your table</p>
      </div>

      <div className="card mb-24">
        <div className="total-row">
          <span>Subtotal</span>
          <span className="fw-700">{formatPrice(state.subtotal)}</span>
        </div>
        <div className="total-row">
          <span>Tax</span>
          <span className="fw-700">{formatPrice(state.tax)}</span>
        </div>
        <div className="total-row total-row-final">
          <span>Bill Total</span>
          <span>{formatPrice(state.subtotal + state.tax)}</span>
        </div>
      </div>

      <p className="text-sm text-muted text-center mb-24">
        Each person will choose their own tip when they see their total
      </p>

      <div className="spacer" />

      <button className="btn btn-primary" onClick={handleShare}>
        Generate QR Code
      </button>
    </div>
  );
}
