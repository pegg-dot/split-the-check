import { io } from 'socket.io-client';

// Dev:  frontend (Vite :5173) and backend (:3001) are separate processes.
//       Connect directly to :3001 to bypass Vite's unreliable WebSocket proxy.
// Prod: Express serves the React build on the same origin — no port needed.
export const BACKEND_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : window.location.origin;

export const socket = io(BACKEND_URL, {
  autoConnect: false,
});
