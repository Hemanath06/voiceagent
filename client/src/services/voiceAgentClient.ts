import { EventEmitter } from 'events';

interface Message {
  type: string;
  [key: string]: any;
}

export class VoiceAgentClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(url: string) {
    super();
    this.url = url;
  }

  connect() {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.emit('connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const message: Message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Error parsing message:', error);
        }
      };

      this.ws.onerror = () => {
        this.emit('error', 'WebSocket connection error');
      };

      this.ws.onclose = () => {
        this.emit('disconnected');
        this.attemptReconnect();
      };

    } catch (error) {
      this.emit('error', 'Failed to connect');
    }
  }

  private handleMessage(message: Message) {
    const { type, ...data } = message;

    switch (type) {
      case 'session_ready':
      case 'conversation_started':
      case 'conversation_stopped':
      case 'stt_transcript':
      case 'llm_token':
      case 'llm_complete':
      case 'tts_text':
      case 'interrupted':
      case 'webrtc_answer':
      case 'webrtc_ice_candidate':
        this.emit(type, data);
        break;
      case 'error':
        this.emit('error', data.error || 'Unknown error');
        break;
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        this.connect();
      }, this.reconnectDelay * this.reconnectAttempts);
    }
  }

  sendMessage(message: Message) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  startConversation() {
    this.sendMessage({ type: 'start_conversation' });
  }

  stopConversation() {
    this.sendMessage({ type: 'stop_conversation' });
  }

  sendAudioChunk(audioData: string) {
    this.sendMessage({ type: 'audio_chunk', data: audioData });
  }

  interrupt() {
    this.sendMessage({ type: 'interrupt' });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
