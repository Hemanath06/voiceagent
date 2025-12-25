import { useState, useEffect, useRef } from 'react';
import { VoiceAgentClient } from './services/voiceAgentClient';
import './App.css';

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [llmResponse, setLlmResponse] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);

  const clientRef = useRef<VoiceAgentClient | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const shouldSendAudioRef = useRef(false);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const useWebRTCRef = useRef(false);
  const webrtcAudioContextRef = useRef<AudioContext | null>(null);
  const audioDataChannelRef = useRef<RTCDataChannel | null>(null);
  const voiceBars = [0.45, 0.8, 0.65, 0.9, 0.5, 0.7, 0.6, 0.85, 0.75, 0.55, 0.95, 0.68, 0.52, 0.83, 0.72, 0.6];

  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 16000
    });

    const client = new VoiceAgentClient('ws://localhost:3002/ws');
    clientRef.current = client;

    client.on('connected', () => {
      setIsConnected(true);
      setStatus('Connected');
      setError(null);
    });

    client.on('disconnected', () => {
      setIsConnected(false);
      setIsListening(false);
      setStatus('Disconnected');
    });

    client.on('error', (err: string) => {
      setError(err);
      setStatus(`Error: ${err}`);
    });

    client.on('conversation_started', async () => {
      setIsListening(true);
      shouldSendAudioRef.current = true;
      setStatus('Setting up WebRTC...');
      setTranscript('');
      setLlmResponse('');

      try {
        await setupWebRTC();
        setStatus('WebRTC connecting...');

        const connected = await waitForWebRTCConnection(10000);

        if (connected) {
          setStatus('Listening... (WebRTC)');
          useWebRTCRef.current = true;
        } else {
          setError('WebRTC failed to connect');
          setStatus('WebRTC FAILED');
          useWebRTCRef.current = false;
        }
      } catch (error: any) {
        setError(`WebRTC failed: ${error?.message || 'Unknown error'}`);
        setStatus('WebRTC FAILED');
        useWebRTCRef.current = false;
      }
    });

    client.on('conversation_stopped', () => {
      setIsListening(false);
      shouldSendAudioRef.current = false;
      setStatus('Stopped');
    });

    client.on('stt_transcript', (data: { transcript: string; isFinal: boolean }) => {
      if (data.transcript?.trim()) {
        setTranscript(data.transcript);
        setStatus(data.isFinal ? 'Processing...' : 'Listening...');
      }
    });

    client.on('llm_token', (data: { token: string }) => {
      setLlmResponse(prev => prev + data.token);
    });

    client.on('llm_complete', (data: { response: string }) => {
      setLlmResponse(data.response);
    });

    client.on('tts_complete', () => {
      setStatus('Ready');
    });

    client.on('webrtc_ice_candidate', async (data: { candidate: RTCIceCandidateInit }) => {
      if (peerConnectionRef.current && data.candidate) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (error) {
          console.error('Error adding ICE candidate:', error);
        }
      }
    });

    client.on('webrtc_answer', async (data: { answer: RTCSessionDescriptionInit }) => {
      if (!peerConnectionRef.current || !data.answer?.type || !data.answer?.sdp) return;

      try {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
      } catch (error) {
        console.error('Error setting WebRTC answer:', error);
        useWebRTCRef.current = false;
      }
    });

    client.on('tts_text', async (data: { text: string }) => {
      if (!('speechSynthesis' in window)) {
        setError('Web Speech API not supported');
        return;
      }

      try {
        speechSynthesis.cancel();

        let voices = speechSynthesis.getVoices();
        if (voices.length === 0) {
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 500);
            speechSynthesis.onvoiceschanged = () => {
              clearTimeout(timeout);
              resolve();
            };
          });
          voices = speechSynthesis.getVoices();
        }

        if (voices.length === 0) {
          setError('No TTS voices available');
          return;
        }

        const utterance = new SpeechSynthesisUtterance(data.text);
        utterance.lang = 'en-US';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        // Find best English voice (prioritize natural/neural voices)
        let preferredVoice =
          // First: Neural/Natural voices (highest quality)
          voices.find(v => v.lang.startsWith('en-US') &&
            (v.name.toLowerCase().includes('neural') || v.name.toLowerCase().includes('natural'))) ||
          // Second: Google voices (good quality)
          voices.find(v => v.lang.startsWith('en-US') && v.name.includes('Google')) ||
          // Third: Microsoft voices
          voices.find(v => v.lang.startsWith('en-US') &&
            (v.name.includes('Microsoft') || v.name.includes('Zira') || v.name.includes('David'))) ||
          // Fourth: Any US English
          voices.find(v => v.lang === 'en-US') ||
          // Fifth: UK English
          voices.find(v => v.lang.startsWith('en-GB')) ||
          // Last: Any English
          voices.find(v => v.lang.startsWith('en'));

        if (preferredVoice) {
          utterance.voice = preferredVoice;
          utterance.lang = preferredVoice.lang;
          console.log('Using voice:', preferredVoice.name);
        }

        utterance.onstart = () => setStatus('Speaking...');
        utterance.onend = () => setStatus('Listening... (WebRTC)');
        utterance.onerror = () => setStatus('Listening... (WebRTC)');

        speechSynthesis.speak(utterance);
      } catch (error) {
        console.error('TTS error:', error);
        setStatus('Ready');
      }
    });

    client.on('interrupted', () => {
      setStatus('Interrupted');
      setTranscript('');
      setLlmResponse('');
    });

    client.connect();

    return () => {
      client.disconnect();
      audioContextRef.current?.close();
    };
  }, []);

  const waitForWebRTCConnection = (timeoutMs: \): Promise<boolean> => {
    return new Promise((resolve) => {
      const pc = peerConnectionRef.current;
      const dc = audioDataChannelRef.current;

      if (!pc) {
        resolve(false);
        return;
      }

      if (pc.connectionState === 'connected' && dc?.readyState === 'open') {
        resolve(true);
        return;
      }

      let timeoutId: NodeJS.Timeout;
      let checkInterval: NodeJS.Timeout;
      let resolved = false;

      const cleanup = () => {
        clearInterval(checkInterval);
        clearTimeout(timeoutId);
      };

      const checkConnection = () => {
        if (resolved) return;

        const currentPc = peerConnectionRef.current;
        const currentDc = audioDataChannelRef.current;

        if (!currentPc) {
          resolved = true;
          cleanup();
          resolve(false);
          return;
        }

        if (currentPc.connectionState === 'connected' && currentDc?.readyState === 'open') {
          resolved = true;
          cleanup();
          resolve(true);
          return;
        }

        if (currentPc.connectionState === 'failed' || currentPc.iceConnectionState === 'failed') {
          resolved = true;
          cleanup();
          resolve(false);
        }
      };

      checkInterval = setInterval(checkConnection, 500);
      checkConnection();

      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(false);
        }
      }, timeoutMs);
    });
  };

  const setupWebRTC = async () => {
    if (!clientRef.current) throw new Error('Client not initialized');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    });

    mediaStreamRef.current = stream;

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    peerConnectionRef.current = pc;

    stream.getAudioTracks().forEach(track => pc.addTrack(track, stream));

    pc.onicecandidate = (event) => {
      if (event.candidate && clientRef.current) {
        clientRef.current.sendMessage({
          type: 'webrtc_ice_candidate',
          candidate: event.candidate.toJSON()
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' && audioDataChannelRef.current?.readyState === 'open') {
        setStatus('Listening... (WebRTC)');
        useWebRTCRef.current = true;
      } else if (pc.connectionState === 'failed') {
        useWebRTCRef.current = false;
      }
    };

    // Audio level monitoring
    webrtcAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = webrtcAudioContextRef.current.createMediaStreamSource(stream);
    const analyser = webrtcAudioContextRef.current.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const updateAudioLevel = () => {
      if (useWebRTCRef.current && shouldSendAudioRef.current) {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setAudioLevel(average / 255 * 100);
        requestAnimationFrame(updateAudioLevel);
      }
    };
    updateAudioLevel();

    // Create data channel
    const dataChannel = pc.createDataChannel('audio', { ordered: true });
    audioDataChannelRef.current = dataChannel;

    dataChannel.onopen = () => {
      startWebRTCAudioCapture();
      if (pc.connectionState === 'connected') {
        setStatus('Listening... (WebRTC)');
        useWebRTCRef.current = true;
      }
    };

    dataChannel.onclose = () => {
      audioDataChannelRef.current = null;
      useWebRTCRef.current = false;
    };

    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    clientRef.current.sendMessage({
      type: 'webrtc_offer',
      offer: { type: offer.type, sdp: offer.sdp }
    });

    useWebRTCRef.current = true;
  };

  const startWebRTCAudioCapture = () => {
    if (!mediaStreamRef.current || !audioDataChannelRef.current) return;

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(mediaStreamRef.current);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const targetSampleRate = 16000;

    processor.onaudioprocess = (e) => {
      if (!shouldSendAudioRef.current || audioDataChannelRef.current?.readyState !== 'open') return;

      const inputData = e.inputBuffer.getChannelData(0);
      const sourceSampleRate = audioContext.sampleRate;

      // Audio level
      const avgLevel = inputData.reduce((sum, val) => sum + Math.abs(val), 0) / inputData.length;
      setAudioLevel(avgLevel * 100);

      // Resample to 16kHz
      let processedData = inputData;
      if (sourceSampleRate !== targetSampleRate) {
        const ratio = sourceSampleRate / targetSampleRate;
        const newLength = Math.round(inputData.length / ratio);
        processedData = new Float32Array(newLength);
        for (let i = 0; i < newLength; i++) {
          processedData[i] = inputData[Math.min(Math.round(i * ratio), inputData.length - 1)];
        }
      }

      // Convert to PCM16
      const pcm16 = new Int16Array(processedData.length);
      for (let i = 0; i < processedData.length; i++) {
        pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(processedData[i] * 32767)));
      }

      try {
        audioDataChannelRef.current?.send(Buffer.from(pcm16.buffer));
      } catch {
        useWebRTCRef.current = false;
      }
    };

    source.connect(processor);

    // Connect to a silent gain node (NOT speakers) to prevent echo
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);

    audioProcessorRef.current = processor;
  };

  const handleStart = () => {
    clientRef.current?.startConversation();
  };

  const handleStop = () => {
    shouldSendAudioRef.current = false;

    audioDataChannelRef.current?.close();
    audioDataChannelRef.current = null;

    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    useWebRTCRef.current = false;

    audioProcessorRef.current?.disconnect();
    audioProcessorRef.current = null;

    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;

    webrtcAudioContextRef.current?.close();
    webrtcAudioContextRef.current = null;

    clientRef.current?.stopConversation();
  };

  const handleInterrupt = () => {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    clientRef.current?.interrupt();
  };

  return (
    <div className="app">
      {/* Sidebar */}
      <div className={`sidebar ${!showSidebar ? 'collapsed' : ''}`}>
        <button
          className="sidebar-collapse-btn"
          onClick={() => setShowSidebar(!showSidebar)}
          aria-label={showSidebar ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {showSidebar ? '‹' : '›'}
        </button>

        <div className="sidebar-inner">
          {/* Two Scrollable Sections */}
          <div className="sidebar-sections">
            {/* Section 1: Live Transcript */}
            <div className="sidebar-section">
              <div className="sidebar-section-header">
                <span className="section-icon">📝</span>
                <span className="section-title">Live Transcript from your mic</span>
              </div>
              <div className="sidebar-content-box">
                {transcript || <span className="content-placeholder">Waiting for speech...</span>}
              </div>
            </div>

            {/* Section 2: LLM Response */}
            <div className="sidebar-section">
              <div className="sidebar-section-header">
                <span className="section-icon">🤖</span>
                <span className="section-title">LLM Response</span>
              </div>
              <div className="sidebar-content-box">
                {llmResponse || <span className="content-placeholder">Waiting for response...</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        {/* Mesh Wave Background */}
        <div className="mesh-wave"></div>

        <div className="container">
          {/* Status Bar */}
          <div className="status-bar">
            <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}></div>
            <span className="status-text">{status}</span>
          </div>

          {/* Hero Section with Voice Waves */}
          <div className="hero">
            {/* Left Voice Wave */}
            <div className="voice-wave">
              {voiceBars.slice(0, 10).map((v, i) => {
                const height = 20 + Math.min(audioLevel * 1.5, 80) * v;
                return (
                  <span
                    key={i}
                    className="bar"
                    style={{ height: `${height}px`, animationDelay: `${i * 80}ms` }}
                  />
                );
              })}
            </div>

            {/* Left Decorative Dots */}
            <div className="wave-dots">
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </div>

            {/* AI Logo Badge */}
            <div className="logo-badge">
              <div className="logo-text">AI</div>
              <div className="logo-stars">✦</div>
            </div>

            {/* Right Decorative Dots */}
            <div className="wave-dots">
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </div>

            {/* Right Voice Wave */}
            <div className="voice-wave">
              {voiceBars.slice(0, 10).map((v, i) => {
                const height = 20 + Math.min(audioLevel * 1.5, 80) * v;
                return (
                  <span
                    key={`r-${i}`}
                    className="bar"
                    style={{ height: `${height}px`, animationDelay: `${i * 80}ms` }}
                  />
                );
              })}
            </div>
          </div>

          {/* Title Section */}
          <div className="title-section">
            <h1 className="main-title">AI Voice Agent</h1>
          </div>

          {/* Error Message */}
          {error && <div className="error-message">⚠️ {error}</div>}

          {/* Controls */}
          <div className="controls">
            {!isListening ? (
              <button className="btn btn-primary" onClick={handleStart} disabled={!isConnected}>
                Start Conversation
              </button>
            ) : (
              <>
                <button className="btn btn-danger" onClick={handleStop}>🛑 Stop</button>
                <button className="btn btn-warning" onClick={handleInterrupt}>⚡ Interrupt</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;