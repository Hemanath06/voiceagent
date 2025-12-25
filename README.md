# AI Voice Agent

A real-time voice AI agent with WebRTC audio streaming, speech-to-text, LLM processing, and text-to-speech.

## Architecture

```
┌─────────────────┐     WebRTC      ┌─────────────────┐
│     Browser     │ ←── Audio ───→  │    Node.js      │
│                 │                 │     Server      │
│  - Microphone   │     WebSocket   │                 │
│  - TTS Output   │ ←── Control ──→ │  - Deepgram STT │
│  - UI           │                 │  - Groq LLM     │
└─────────────────┘                 └─────────────────┘
```

### Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Audio Transport** | WebRTC (werift) | Low-latency audio streaming |
| **Control Messages** | WebSocket | Signaling, transcripts, responses |
| **Speech-to-Text** | Deepgram | Real-time transcription |
| **LLM** | Groq (Llama 3.3) | AI response generation |
| **Text-to-Speech** | Browser Web Speech API | Voice output |

## Setup

### Prerequisites

- Node.js 18+
- npm

### Environment Variables

Create a `.env` file:

```env
DEEPGRAM_API_KEY=your_deepgram_api_key
GROQ_API_KEY=your_groq_api_key
```

### Installation

```bash
# Install all dependencies (server + client) in one command
npm run install:all
```

### Running

```bash
# Start both server and client
npm run dev
```

> **Note**: The project automatically uses IPv4 for API connections to avoid network timeout issues on some networks.


- **Client**: http://localhost:3000
- **Server**: http://localhost:3001
- **WebSocket**: ws://localhost:3002/ws

## Project Structure

```
├── src/
│   ├── server/
│   │   ├── index.ts           # Server entry point
│   │   ├── voiceAgentServer.ts # WebSocket & session management
│   │   ├── webrtcServer.ts    # WebRTC peer connections
│   │   └── audioPipeline.ts   # Audio processing
│   └── services/
│       ├── deepgramSTT.ts     # Speech-to-text
│       ├── groqLLM.ts         # LLM integration
│       └── murfTTS.ts         # Text-to-speech (optional)
├── client/
│   └── src/
│       ├── App.tsx            # Main React component
│       ├── App.css            # Styles
│       └── services/
│           └── voiceAgentClient.ts # WebSocket client
├── package.json
└── .env
```

## Usage

1. Open http://localhost:3000
2. Click **"Start Conversation"**
3. Speak into your microphone
4. AI responds in real-time

### Controls

- **Start Conversation**: Begin voice interaction
- **Stop**: End the conversation
- **Interrupt**: Stop AI mid-response

## How It Works

1. **Audio Capture**: Browser captures microphone audio
2. **WebRTC Transport**: Audio sent to server via WebRTC data channel (16kHz PCM)
3. **Transcription**: Deepgram converts speech to text in real-time
4. **LLM Processing**: Groq generates AI response with conversation context
5. **TTS Output**: Browser speaks the response using Web Speech API

## API Keys

| Service | Get API Key |
|---------|-------------|
| Deepgram | https://console.deepgram.com |
| Groq | https://console.groq.com |

## License

MIT
