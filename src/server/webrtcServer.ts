import { RTCPeerConnection, RTCSessionDescription } from 'werift';
import { EventEmitter } from 'events';

interface WebRTCSession {
  peerConnection: RTCPeerConnection;
  audioDataChannel?: any;
}

export class WebRTCServer extends EventEmitter {
  private sessions: Map<string, WebRTCSession> = new Map();

  async createPeerConnection(sessionId: string): Promise<RTCPeerConnection> {
    console.log(`🔧 Creating peer connection for ${sessionId}...`);
    
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ],
    });
    
    console.log(`✅ Peer connection created for ${sessionId}`);

    const session: WebRTCSession = {
      peerConnection: pc,
    };

    // Handle incoming audio track from client
    pc.onTrack.subscribe((track) => {
      console.log(`🎤 Received audio track from client: ${sessionId}`);
      console.log(`   Track kind: ${track.kind}`);
      
      this.emit('audioTrack', { sessionId, track });
    });

    // Handle WebRTC data channel for audio chunks (PCM format)
    pc.onDataChannel.subscribe((channel) => {
      console.log(`📡 Data channel received: ${channel.label} for ${sessionId}`);
      
      if (channel.label === 'audio') {
        session.audioDataChannel = channel;
        
        channel.onMessage.subscribe((data) => {
          // Receive PCM audio data from client
          let audioData: Buffer;
          if (data instanceof Buffer) {
            audioData = data;
          } else if (data instanceof ArrayBuffer) {
            audioData = Buffer.from(data);
          } else if (typeof data === 'string') {
            // Base64 encoded data
            audioData = Buffer.from(data, 'base64');
          } else {
            audioData = Buffer.from(data as any);
          }
          
          this.emit('audioData', { sessionId, audioData });
        });
        
        channel.stateChanged.subscribe((state) => {
          console.log(`📡 Data channel state changed for ${sessionId}: ${state}`);
          if (state === 'open') {
            console.log(`✅ Audio data channel opened for ${sessionId}`);
            this.emit('dataChannelOpen', { sessionId, channel });
          } else if (state === 'closed') {
            console.log(`🔌 Audio data channel closed for ${sessionId}`);
            session.audioDataChannel = undefined;
            this.emit('dataChannelClose', { sessionId });
          }
        });
      }
    });

    // Handle ICE candidates
    pc.onIceCandidate.subscribe((candidate) => {
      if (candidate) {
        console.log(`🧊 ICE candidate generated for ${sessionId}`);
        this.emit('iceCandidate', {
          sessionId,
          candidate: candidate.toJSON(),
        });
      }
    });

    // Handle connection state changes
    pc.connectionStateChange.subscribe(() => {
      const state = pc.connectionState;
      console.log(`📡 WebRTC connection state for ${sessionId}: ${state}`);
      
      if (state === 'failed' || state === 'closed' || state === 'disconnected') {
        console.warn(`⚠️ WebRTC connection ${state} for ${sessionId}`);
        this.emit('connectionStateChange', { sessionId, state });
      } else if (state === 'connected') {
        console.log(`✅ WebRTC connected for ${sessionId}`);
        this.emit('connectionStateChange', { sessionId, state: 'connected' });
      }
    });

    // Handle ICE connection state
    pc.iceConnectionStateChange.subscribe(() => {
      const state = pc.iceConnectionState;
      console.log(`🧊 ICE connection state for ${sessionId}: ${state}`);
      
      if (state === 'failed') {
        console.error(`❌ ICE connection failed for ${sessionId}`);
        this.emit('iceConnectionFailed', { sessionId });
      }
    });

    this.sessions.set(sessionId, session);
    return pc;
  }

  async handleOffer(sessionId: string, offer: any): Promise<any> {
    console.log(`📥 Handling WebRTC offer for ${sessionId}`);
    console.log(`   Offer type: ${offer.type}`);
    console.log(`   SDP length: ${offer.sdp?.length || 0} chars`);
    
    let pc: RTCPeerConnection;
    const existingSession = this.sessions.get(sessionId);
    
    if (existingSession) {
      pc = existingSession.peerConnection;
    } else {
      pc = await this.createPeerConnection(sessionId);
    }
    
    try {
      // Set remote description (client's offer)
      await pc.setRemoteDescription(new RTCSessionDescription(offer.sdp, offer.type));
      console.log(`✅ Remote description set for ${sessionId}`);
      
      // Create answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log(`✅ Local description (answer) created for ${sessionId}`);
      
      return {
        type: answer.type,
        sdp: answer.sdp,
      };
    } catch (error) {
      console.error(`❌ Error handling WebRTC offer for ${sessionId}:`, error);
      throw error;
    }
  }

  async handleIceCandidate(sessionId: string, candidate: any) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`⚠️ No session found for ICE candidate: ${sessionId}`);
      return;
    }

    try {
      if (candidate && candidate.candidate) {
        await session.peerConnection.addIceCandidate(candidate);
        console.log(`✅ Added ICE candidate for ${sessionId}`);
      }
    } catch (error) {
      console.error(`❌ Error adding ICE candidate for ${sessionId}:`, error);
    }
  }

  isConnected(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    return session.peerConnection.connectionState === 'connected';
  }

  cleanup(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      console.log(`🧹 Cleaning up WebRTC session: ${sessionId}`);
      
      if (session.peerConnection) {
        session.peerConnection.close();
      }
      
      this.sessions.delete(sessionId);
    }
  }

  getAllSessions(): string[] {
    return Array.from(this.sessions.keys());
  }
}
