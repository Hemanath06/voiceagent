import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { VoiceAgentServer } from './voiceAgentServer';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const WS_PORT = process.env.WS_PORT || 3002;

// Health check endpoint
app.get('/health', (req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create HTTP server
const httpServer = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ 
  server: httpServer,
  path: '/ws'
});

// Initialize Voice Agent Server
const voiceAgentServer = new VoiceAgentServer(wss);

httpServer.listen(WS_PORT, () => {
  console.log(` Voice Agent Server running on port ${WS_PORT}`);
  console.log(` WebSocket endpoint: ws://localhost:${WS_PORT}/ws`);
});

app.listen(PORT, () => {
  console.log(`🌐 HTTP Server running on port ${PORT}`);
});

