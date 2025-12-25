# 🎤 AI Voice Agent - Technical Presentation Guide

## 📌 Project Overview

This is a **Real-Time AI Voice Conversation System** that allows users to have voice conversations with an AI assistant. The system captures your voice, converts it to text, sends it to an AI (LLM), gets a response, and speaks it back to you.

---

## 🏗️ System Architecture
  
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (React Client)                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │   Microphone    │───►│  Audio Process  │───►│  WebRTC Data    │─────────┼──┐
│  │   (getUserMedia)│    │  (PCM 16kHz)    │    │  Channel        │         │  │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │  │ AUDIO
│                                                                              │  │ (WebRTC)
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │  │
│  │   Speaker       │◄───│  Web Speech API │◄───│   WebSocket     │◄────────┼──┤
│  │   (TTS Output)  │    │   (TTS)         │    │  (Text Only!)   │         │  │ TEXT
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │  │ (WebSocket)
└──────────────────────────────────────────────────────────────────────────────┘  │
                                                                                   │
         ╔═══════════════════════════════════════════════════════════════════╗    │
         ║  AUDIO  → WebRTC Data Channel (Binary, Low Latency)              ║    │
         ║  TEXT   → WebSocket (JSON: transcripts, LLM tokens, TTS text)    ║    │
         ╚═══════════════════════════════════════════════════════════════════╝    │
                                                                                   │
┌──────────────────────────────────────────────────────────────────────────────┐  │
│                              NODE.JS SERVER                                   │  │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │  │
│  │   WebRTC Server │◄───┤ Voice Agent     │───►│   WebSocket     │◄────────┼──┘
│  │   (Receives     │    │ Server          │    │   Server        │         │
│  │    Audio Only)  │    │                 │    │  (Sends Text)   │         │
│  └────────┬────────┘    └────────┬────────┘    └─────────────────┘         │
│           │                      │                                          │
│           ▼                      ▼                                          │
│  ┌─────────────────┐    ┌─────────────────┐                                │
│  │   Deepgram STT  │───►│   Groq LLM      │                                │
│  │   (Audio→Text)  │    │   (Text→Text)   │                                │
│  └─────────────────┘    └─────────────────┘                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 📡 Transport Summary

| What | Direction | Transport | Format |
|------|-----------|-----------|--------|
| **Voice Audio** | Client → Server | **WebRTC Data Channel** | Binary PCM16 |
| **Transcript** | Server → Client | **WebSocket** | JSON |
| **LLM Response** | Server → Client | **WebSocket** | JSON (streaming tokens) |
| **TTS Text** | Server → Client | **WebSocket** | JSON |
| **Signaling (SDP/ICE)** | Both | **WebSocket** | JSON |


---

## 🔌 Core Technologies Used

| Technology | Purpose | Library Used |
|------------|---------|--------------|
| **WebRTC** | Real-time audio streaming (low latency) | `werift` (server), native browser API (client) |
| **WebSocket** | Signaling, control messages, text transfer | `ws` (server), native browser API (client) |
| **Deepgram** | Speech-to-Text (STT) | `@deepgram/sdk` |
| **Groq** | LLM (AI response generation) | `groq-sdk` |
| **Web Speech API** | Text-to-Speech (TTS) | Browser native |

---

## 🔵 WEBSOCKET - Core Concepts & Code

### What is WebSocket?
- **Bi-directional** communication protocol
- **Persistent connection** between client and server
- Used for **control messages** and **text transfer** (not audio)
- Lower overhead than HTTP for real-time apps

### WebSocket Message Types in Our App

| Message Type | Direction | Purpose |
|--------------|-----------|---------|
| `session_ready` | Server → Client | Connection established |
| `start_conversation` | Client → Server | User clicks start |
| `conversation_started` | Server → Client | Deepgram ready |
| `stt_transcript` | Server → Client | Speech-to-text result |
| `llm_token` | Server → Client | Streaming LLM response |
| `llm_complete` | Server → Client | Full LLM response |
| `tts_text` | Server → Client | Text for TTS |
| `webrtc_offer` | Client → Server | WebRTC SDP offer |
| `webrtc_answer` | Server → Client | WebRTC SDP answer |
| `webrtc_ice_candidate` | Both ways | ICE candidates |

---

### 📄 WebSocket Server Code (server/voiceAgentServer.ts)

```typescript
// 1. Creating WebSocket Server Connection Handler
private setupWebSocketServer() {
  this.wss.on('connection', (ws: WebSocket) => {
    const sessionId = this.generateSessionId();
    console.log(`✅ Client connected: ${sessionId}`);

    // Create session for this client
    const session: ClientSession = {
      ws,
      sessionId,
      isActive: false,
      conversationHistory: []
    };

    this.sessions.set(sessionId, session);
    
    // Send session ready message
    this.sendMessage(ws, { type: 'session_ready', sessionId });

    // Handle incoming messages
    ws.on('message', async (data: Buffer) => {
      const message = JSON.parse(data.toString());
      await this.handleMessage(session, message);
    });

    ws.on('close', () => {
      this.cleanupSession(sessionId);
    });
  });
}

// 2. Handling Different Message Types
private async handleMessage(session: ClientSession, message: any) {
  switch (message.type) {
    case 'start_conversation':
      await this.startConversation(session);
      break;
    case 'stop_conversation':
      await this.stopConversation(session);
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

// 3. Sending Messages to Client
private sendMessage(ws: WebSocket, message: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}
```

---

### 📄 WebSocket Client Code (client/services/voiceAgentClient.ts)

```typescript
// 1. Creating WebSocket Connection
connect() {
  this.ws = new WebSocket(this.url);  // 'ws://localhost:3002/ws'

  this.ws.onopen = () => {
    this.reconnectAttempts = 0;
    this.emit('connected');
  };

  // 2. Handling Incoming Messages
  this.ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    this.handleMessage(message);
  };

  this.ws.onclose = () => {
    this.emit('disconnected');
    this.attemptReconnect();  // Auto-reconnect logic
  };
}

// 3. Message Router
private handleMessage(message: Message) {
  const { type, ...data } = message;

  switch (type) {
    case 'session_ready':
    case 'conversation_started':
    case 'stt_transcript':
    case 'llm_token':
    case 'llm_complete':
    case 'tts_text':
    case 'webrtc_answer':
    case 'webrtc_ice_candidate':
      this.emit(type, data);  // Emit event for React to handle
      break;
    case 'error':
      this.emit('error', data.error);
      break;
  }
}

// 4. Sending Messages to Server
sendMessage(message: Message) {
  if (this.ws?.readyState === WebSocket.OPEN) {
    this.ws.send(JSON.stringify(message));
  }
}

startConversation() {
  this.sendMessage({ type: 'start_conversation' });
}
```

---

## 🟢 WEBRTC - Core Concepts & Code

### What is WebRTC?
- **Peer-to-peer** real-time communication
- Used for **audio/video streaming** with ultra-low latency
- **Direct connection** after initial signaling (via WebSocket)
- Components: **ICE**, **STUN**, **SDP**, **Data Channels**

### WebRTC Terminology

| Term | Meaning |
|------|---------|
| **SDP (Session Description Protocol)** | Describes media capabilities (audio format, codecs) |
| **Offer** | Client's proposal for connection parameters |
| **Answer** | Server's response to the offer |
| **ICE (Interactive Connectivity Establishment)** | Finds the best path to connect |
| **ICE Candidate** | Possible connection route (IP, port, protocol) |
| **STUN Server** | Helps discover public IP address |
| **Data Channel** | Binary data transfer (we use this for audio) |

---

### WebRTC Connection Flow

```
   CLIENT                                    SERVER
     │                                         │
     │─────── 1. WebSocket Connect ───────────►│
     │◄────── 2. session_ready ───────────────│
     │                                         │
     │─────── 3. start_conversation ──────────►│
     │◄────── 4. conversation_started ────────│
     │                                         │
     │  [WebRTC Signaling via WebSocket]       │
     │                                         │
     │─────── 5. webrtc_offer (SDP) ──────────►│  ← Client creates offer
     │◄────── 6. webrtc_answer (SDP) ─────────│  ← Server creates answer
     │                                         │
     │─────── 7. ICE candidates ──────────────►│  ← Exchange connection
     │◄────── 7. ICE candidates ──────────────│    candidates
     │                                         │
     │═══════ 8. Direct P2P Audio ════════════│  ← Audio flows directly!
```

---

### 📄 WebRTC Client Code (App.tsx)

```typescript
// 1. SETUP WEBRTC - Called when conversation starts
const setupWebRTC = async () => {
  // Step 1: Get microphone access
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }
  });
  mediaStreamRef.current = stream;

  // Step 2: Create RTCPeerConnection with STUN servers
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });
  peerConnectionRef.current = pc;

  // Step 3: Add audio track to connection
  stream.getAudioTracks().forEach(track => pc.addTrack(track, stream));

  // Step 4: Handle ICE candidates (send to server via WebSocket)
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      clientRef.current.sendMessage({
        type: 'webrtc_ice_candidate',
        candidate: event.candidate.toJSON()
      });
    }
  };

  // Step 5: Create Data Channel for raw audio
  const dataChannel = pc.createDataChannel('audio', { ordered: true });
  audioDataChannelRef.current = dataChannel;

  dataChannel.onopen = () => {
    startWebRTCAudioCapture();  // Start sending audio when channel opens
  };

  // Step 6: Create and send SDP Offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  clientRef.current.sendMessage({
    type: 'webrtc_offer',
    offer: { type: offer.type, sdp: offer.sdp }
  });
};

// 2. AUDIO CAPTURE - Converts mic audio to PCM and sends via Data Channel
const startWebRTCAudioCapture = () => {
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(mediaStreamRef.current);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (e) => {
    const inputData = e.inputBuffer.getChannelData(0);
    
    // Resample to 16kHz (Deepgram requirement)
    const ratio = audioContext.sampleRate / 16000;
    const newLength = Math.round(inputData.length / ratio);
    const processedData = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      processedData[i] = inputData[Math.round(i * ratio)];
    }

    // Convert Float32 to Int16 (PCM format)
    const pcm16 = new Int16Array(processedData.length);
    for (let i = 0; i < processedData.length; i++) {
      pcm16[i] = Math.max(-32768, Math.min(32767, 
                 Math.round(processedData[i] * 32767)));
    }

    // Send via WebRTC Data Channel
    audioDataChannelRef.current?.send(pcm16.buffer);
  };

  source.connect(processor);
};

// 3. HANDLE WEBRTC ANSWER FROM SERVER
client.on('webrtc_answer', async (data) => {
  await peerConnectionRef.current.setRemoteDescription(
    new RTCSessionDescription(data.answer)
  );
});

// 4. ADD ICE CANDIDATES FROM SERVER
client.on('webrtc_ice_candidate', async (data) => {
  await peerConnectionRef.current.addIceCandidate(
    new RTCIceCandidate(data.candidate)
  );
});
```

---

### 📄 WebRTC Server Code (server/webrtcServer.ts)

```typescript
// 1. CREATE PEER CONNECTION
async createPeerConnection(sessionId: string): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });

  // Handle incoming audio from data channel
  pc.onDataChannel.subscribe((channel) => {
    if (channel.label === 'audio') {
      channel.onMessage.subscribe((data) => {
        const audioData = Buffer.from(data);
        // Emit audio to be sent to Deepgram STT
        this.emit('audioData', { sessionId, audioData });
      });
    }
  });

  // Handle ICE candidates (send back to client)
  pc.onIceCandidate.subscribe((candidate) => {
    if (candidate) {
      this.emit('iceCandidate', { sessionId, candidate: candidate.toJSON() });
    }
  });

  return pc;
}

// 2. HANDLE SDP OFFER FROM CLIENT
async handleOffer(sessionId: string, offer: any): Promise<any> {
  const pc = await this.createPeerConnection(sessionId);
  
  // Set client's offer as remote description
  await pc.setRemoteDescription(new RTCSessionDescription(offer.sdp, offer.type));
  
  // Create and return answer
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  
  return { type: answer.type, sdp: answer.sdp };
}

// 3. HANDLE ICE CANDIDATES FROM CLIENT
async handleIceCandidate(sessionId: string, candidate: any) {
  const session = this.sessions.get(sessionId);
  if (session && candidate?.candidate) {
    await session.peerConnection.addIceCandidate(candidate);
  }
}
```

---

## 🎙️ SPEECH-TO-TEXT (Deepgram)

### How it works:
1. Audio received from WebRTC Data Channel
2. Sent to Deepgram's live transcription API
3. Returns real-time transcripts (interim & final)

```typescript
// server/services/deepgramSTT.ts

async start() {
  // Create live transcription connection
  this.connection = this.deepgram.listen.live({
    model: 'nova-2',           // Best model for accuracy
    language: 'en-US',
    smart_format: true,        // Adds punctuation
    interim_results: true,     // Get partial results
    endpointing: 300,          // Silence detection (ms)
    utterance_end_ms: 1000,    // End of utterance detection
    encoding: 'linear16',      // PCM format
    sample_rate: 16000,        // 16kHz audio
    channels: 1,               // Mono
  });

  // Handle transcription results
  this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript || '';
    const isFinal = data.is_final || false;
    
    if (transcript.trim() && this.onTranscript) {
      this.onTranscript(transcript, isFinal);
    }
  });
}

// Send audio chunks to Deepgram
sendAudio(audioData: Buffer) {
  if (this.isConnectionReady) {
    this.connection.send(audioData);
  }
}
```

---

## 🤖 LLM INTEGRATION (Groq)

### How it works:
1. Receive final transcript from Deepgram
2. Add to conversation history
3. Call Groq API with streaming
4. Send tokens back to client as they arrive

```typescript
// server/services/groqLLM.ts

async streamCompletion(conversationHistory: Message[]) {
  // Create streaming completion request
  const stream = await this.groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: conversationHistory,
    stream: true,                    // Enable streaming
    temperature: 0.7,
    max_tokens: 150,                 // Short for voice
  });

  // Process stream tokens
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    
    if (content) {
      this.fullResponse += content;
      
      // Send each token to client immediately
      if (this.onToken) {
        this.onToken(content);
      }
    }
  }

  // Stream complete
  if (this.onComplete) {
    this.onComplete(this.fullResponse);
  }
}
```

---

## 🔊 TEXT-TO-SPEECH (Browser)

### How it works:
1. Server sends complete LLM response via WebSocket
2. Client uses Web Speech API to speak it

```typescript
// App.tsx - Browser TTS

client.on('tts_text', async (data: { text: string }) => {
  // Get available voices
  let voices = speechSynthesis.getVoices();
  
  // Create utterance
  const utterance = new SpeechSynthesisUtterance(data.text);
  utterance.lang = 'en-US';
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  
  // Find best voice (prioritize neural voices)
  let preferredVoice = 
    voices.find(v => v.name.includes('Google')) ||
    voices.find(v => v.lang === 'en-US');
  
  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }

  // Speak!
  speechSynthesis.speak(utterance);
});
```

---

## 🔄 Complete Data Flow

```
1. User clicks "Start Conversation"
   └── Client sends: { type: 'start_conversation' } via WebSocket

2. Server initializes Deepgram & Groq
   └── Server sends: { type: 'conversation_started' }

3. WebRTC handshake (SDP + ICE exchange)
   └── Establishes direct audio channel

4. User speaks into microphone
   └── Audio → ScriptProcessor → PCM16 → Data Channel → Server

5. Server receives audio
   └── Audio → Deepgram STT → Transcript

6. Deepgram sends transcript
   └── Server sends: { type: 'stt_transcript', transcript: "Hello AI" }

7. Final transcript triggers LLM
   └── Transcript → Groq LLM → Streaming response

8. LLM tokens streamed
   └── Server sends: { type: 'llm_token', token: "Hi" }
   └── Server sends: { type: 'llm_token', token: " there" }
   └── Server sends: { type: 'llm_token', token: "!" }

9. LLM complete
   └── Server sends: { type: 'tts_text', text: "Hi there!" }

10. Client speaks response
    └── Web Speech API speaks "Hi there!"
```

---

## ❓ Common Interview/Presentation Questions

### Q: Why use WebRTC for audio instead of just WebSocket?
**A:** WebRTC is designed for real-time audio/video with:
- **Lower latency** (~50-150ms vs ~200-500ms)
- **Built-in audio codecs** optimized for voice
- **ICE/STUN** for NAT traversal
- **Peer-to-peer** reduces server load

### Q: Why use WebSocket alongside WebRTC?
**A:** WebRTC needs a signaling mechanism to exchange SDP and ICE candidates. WebSocket is perfect for:
- **Initial handshake** (SDP offer/answer)
- **Control messages** (start, stop, interrupt)
- **Text data** (transcripts, LLM responses)

### Q: What is the audio format used?
**A:** 
- **Sample Rate:** 16kHz (optimal for speech recognition)
- **Bit Depth:** 16-bit (PCM16/Linear16)
- **Channels:** 1 (Mono)
- **Format:** Raw PCM (no compression)

### Q: How does real-time transcription work?
**A:** Deepgram's Nova-2 model uses:
- **Streaming input** - audio chunks sent continuously
- **Interim results** - partial transcripts as you speak
- **Endpointing** - detects when you stop speaking
- **Final results** - complete, accurate transcript

### Q: What LLM model is used and why?
**A:** Groq's Llama 3.3 70B because:
- **Extremely fast** inference (faster than OpenAI)
- **High quality** responses
- **Streaming support** for real-time output
- **Cost effective**

---

## 📊 Key Metrics

| Metric | Value |
|--------|-------|
| Audio Latency (WebRTC) | ~50-150ms |
| Transcription Latency | ~200-400ms |
| LLM Response Start | ~100-300ms |
| Total Round Trip | ~500ms-1.5s |

---

## 🎯 Key Takeaways for Presentation

1. **WebSocket** = Control plane (text, signaling)
2. **WebRTC** = Data plane (audio streaming)
3. **Deepgram** = Fast, accurate speech-to-text
4. **Groq** = Ultra-fast LLM inference
5. **Web Speech API** = Free browser TTS

The combination provides a **real-time voice AI experience** with sub-second response times! 🚀
