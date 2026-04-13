import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SessionProvider } from './context/SessionContext';
import QROverlay from './components/QROverlay';
import Home from './pages/Home';
import ScanReceipt from './pages/ScanReceipt';
import ReviewItems from './pages/ReviewItems';
import TipAndShare from './pages/TipAndShare';
import JoinSession from './pages/JoinSession';
import ClaimItems from './pages/ClaimItems';
import Summary from './pages/Summary';
import HostDashboard from './pages/HostDashboard';

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <QROverlay />
        <Routes>
          {/* Host flow */}
          <Route path="/" element={<Home />} />
          <Route path="/scan" element={<ScanReceipt />} />
          <Route path="/review" element={<ReviewItems />} />
          <Route path="/tip" element={<TipAndShare />} />
          <Route path="/host/:sessionId" element={<HostDashboard />} />

          {/* Guest flow */}
          <Route path="/session/:sessionId" element={<JoinSession />} />
          <Route path="/claim/:sessionId" element={<ClaimItems />} />

          {/* Shared */}
          <Route path="/summary/:sessionId" element={<Summary />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
