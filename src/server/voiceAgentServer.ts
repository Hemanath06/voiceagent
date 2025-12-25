import { WebSocketServer, WebSocket } from 'ws';
import { DeepgramSTT } from '../services/deepgramSTT';
import { GroqLLM } from '../services/groqLLM';
import { WebRTCServer } from './webrtcServer';

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ClientSession {
  ws: WebSocket;
  sessionId: string;
  deepgramSTT?: DeepgramSTT;
  groqLLM?: GroqLLM;
  isActive: boolean;
  conversationHistory: Message[];
  useWebRTC?: boolean;
}

export class VoiceAgentServer {
  private sessions: Map<string, ClientSession> = new Map();
  private wss: WebSocketServer;
  private webrtcServer: WebRTCServer;

  constructor(wss: WebSocketServer) {
    this.wss = wss;
    this.webrtcServer = new WebRTCServer();
    this.setupWebRTC();
    this.setupWebSocketServer();
  }

  private setupWebRTC() {
    this.webrtcServer.on('connectionStateChange', ({ sessionId, state }) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.useWebRTC = state === 'connected';
      }
    });

    this.webrtcServer.on('iceConnectionFailed', ({ sessionId }) => {
      const session = this.sessions.get(sessionId);
      if (session) session.useWebRTC = false;
    });

    this.webrtcServer.on('iceCandidate', ({ sessionId, candidate }) => {
      const session = this.sessions.get(sessionId);
      if (session?.ws.readyState === 1) {
        this.sendMessage(session.ws, { type: 'webrtc_ice_candidate', candidate });
      }
    });

    this.webrtcServer.on('audioData', ({ sessionId, audioData }) => {
      const session = this.sessions.get(sessionId);
      if (session?.deepgramSTT && session.isActive && session.useWebRTC !== false) {
        try {
          session.deepgramSTT.sendAudio(audioData);
          if (!session.useWebRTC) session.useWebRTC = true;
        } catch (error) {
          console.error('Error sending WebRTC audio to Deepgram:', error);
        }
      }
    });

    this.webrtcServer.on('dataChannelOpen', ({ sessionId }) => {
      const session = this.sessions.get(sessionId);
      if (session) session.useWebRTC = true;
    });

    this.webrtcServer.on('dataChannelClose', ({ sessionId }) => {
      const session = this.sessions.get(sessionId);
      if (session) session.useWebRTC = false;
    });
  }

  private setupWebSocketServer() {
    this.wss.on('connection', (ws: WebSocket) => {
      const sessionId = this.generateSessionId();
      console.log(`✅ Client connected: ${sessionId}`);

      const session: ClientSession = {
        ws,
        sessionId,
        isActive: false,
        conversationHistory: []
      };

      this.sessions.set(sessionId, session);
      this.sendMessage(ws, { type: 'session_ready', sessionId });

      ws.on('message', async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleMessage(session, message);
        } catch (error) {
          console.error('Error handling message:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });

      ws.on('close', () => {
        console.log(`🔌 Client disconnected: ${sessionId}`);
        this.cleanupSession(sessionId);
      });

      ws.on('error', () => this.cleanupSession(sessionId));
    });
  }

  private async handleMessage(session: ClientSession, message: any) {
    const { type } = message;

    switch (type) {
      case 'start_conversation':
        await this.startConversation(session);
        break;

      case 'stop_conversation':
        await this.stopConversation(session);
        break;

      case 'audio_chunk':
        if (session.isActive && session.deepgramSTT && session.useWebRTC !== true) {
          try {
            session.deepgramSTT.sendAudio(message.data);
          } catch (error) {
            console.error('Error sending audio to Deepgram:', error);
          }
        }
        break;

      case 'webrtc_offer':
        await this.handleWebRTCOffer(session, message.offer);
        break;

      case 'webrtc_ice_candidate':
        await this.handleWebRTCIceCandidate(session, message.candidate);
        break;

      case 'interrupt':
        await this.handleInterrupt(session);
        break;
    }
  }

  private async handleWebRTCOffer(session: ClientSession, offer: any) {
    try {
      session.useWebRTC = true;
      const answer = await this.webrtcServer.handleOffer(session.sessionId, offer);
      this.sendMessage(session.ws, { type: 'webrtc_answer', answer });
    } catch (error: any) {
      console.error('Error handling WebRTC offer:', error?.message);
      this.sendError(session.ws, `WebRTC setup error: ${error?.message}`);
    }
  }

  private async handleWebRTCIceCandidate(session: ClientSession, candidate: any) {
    if (!candidate?.candidate) return;
    try {
      await this.webrtcServer.handleIceCandidate(session.sessionId, candidate);
    } catch (error: any) {
      console.error('Error handling ICE candidate:', error?.message);
    }
  }

  private async startConversation(session: ClientSession) {
    if (session.isActive) return;

    console.log(`🎤 Starting conversation: ${session.sessionId}`);

    try {
      session.conversationHistory = [{
        role: 'system',
        content: 'You are a helpful, friendly, and concise AI assistant. Keep responses brief and conversational for voice interaction. Respond in 1-2 sentences.'
      }];

      session.deepgramSTT = new DeepgramSTT();
      session.groqLLM = new GroqLLM();

      session.deepgramSTT.onTranscript = (transcript: string, isFinal: boolean) => {
        this.sendMessage(session.ws, { type: 'stt_transcript', transcript, isFinal });
        if (isFinal && transcript.trim()) {
          this.processLLM(session, transcript);
        }
      };

      session.groqLLM.onToken = (token: string) => {
        this.sendMessage(session.ws, { type: 'llm_token', token });
      };

      session.groqLLM.onComplete = async (fullResponse: string) => {
        if (fullResponse.trim()) {
          session.conversationHistory.push({ role: 'assistant', content: fullResponse.trim() });
        }
        this.sendMessage(session.ws, { type: 'llm_complete', response: fullResponse });
        
        // Send text to browser for TTS (Web Speech API)
        if (fullResponse.trim()) {
          this.sendMessage(session.ws, { type: 'tts_text', text: fullResponse });
        }
      };

      await session.deepgramSTT.start();
      session.isActive = true;
      this.sendMessage(session.ws, { type: 'conversation_started' });
      console.log(`✅ Conversation started: ${session.sessionId}`);

    } catch (error) {
      console.error('Error starting conversation:', error);
      this.sendError(session.ws, 'Failed to start conversation');
      this.cleanupSession(session.sessionId);
    }
  }

  private async stopConversation(session: ClientSession) {
    if (!session.isActive) return;
    console.log(`🛑 Stopping conversation: ${session.sessionId}`);
    await this.cleanupSession(session.sessionId);
    this.sendMessage(session.ws, { type: 'conversation_stopped' });
  }

  private async handleInterrupt(session: ClientSession) {
    if (session.groqLLM) session.groqLLM.stop();
    this.sendMessage(session.ws, { type: 'interrupted' });
  }

  private async processLLM(session: ClientSession, transcript: string) {
    if (!session.groqLLM || !session.isActive || !transcript.trim()) return;

    try {
      session.conversationHistory.push({ role: 'user', content: transcript.trim() });
      await session.groqLLM.streamCompletion(session.conversationHistory);
    } catch (error: any) {
      console.error('Error processing LLM:', error?.message);
      if (session.conversationHistory[session.conversationHistory.length - 1]?.role === 'user') {
        session.conversationHistory.pop();
      }
      this.sendError(session.ws, error?.message || 'LLM processing failed');
    }
  }

  private async cleanupSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.isActive = false;
    this.webrtcServer.cleanup(sessionId);

    if (session.deepgramSTT) await session.deepgramSTT.stop();
    if (session.groqLLM) session.groqLLM.stop();

    this.sessions.delete(sessionId);
  }

  private sendMessage(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, error: string) {
    this.sendMessage(ws, { type: 'error', error });
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
