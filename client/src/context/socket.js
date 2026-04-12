import { io } from 'socket.io-client';

// In development, Vite proxies /socket.io to the backend.
// Connect to the current page origin so it works from any device.
export const socket = io({
  autoConnect: false,
});
