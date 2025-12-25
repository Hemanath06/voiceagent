import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { EventEmitter } from 'events';

export class DeepgramSTT extends EventEmitter {
  private deepgram: any;
  private connection: any;
  private apiKey: string;
  private isConnectionReady: boolean = false;
  private audioQueue: Buffer[] = [];
  public onTranscript?: (transcript: string, isFinal: boolean) => void;

  constructor() {
    super();
    this.apiKey = process.env.DEEPGRAM_API_KEY || '';
    
    if (!this.apiKey) {
      throw new Error('DEEPGRAM_API_KEY is not set');
    }

    this.deepgram = createClient(this.apiKey);
  }

  async start() {
    return new Promise<void>((resolve, reject) => {
      try {
        this.connection = this.deepgram.listen.live({
          model: 'nova-2',
          language: 'en-US',
          smart_format: true,
          interim_results: true,
          endpointing: 300,
          utterance_end_ms: 1000,
          vad_events: true,
          encoding: 'linear16',
          sample_rate: 16000,
          channels: 1,
        });

        this.connection.on(LiveTranscriptionEvents.Open, () => {
          console.log('✅ Deepgram connection opened and ready to receive audio');
          this.isConnectionReady = true;
          
          // Send any queued audio
          while (this.audioQueue.length > 0) {
            const chunk = this.audioQueue.shift();
            if (chunk) {
              this.connection.send(chunk);
            }
          }
          
          resolve();
        });

        this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
          try {
            const transcript = data.channel?.alternatives?.[0]?.transcript || '';
            const isFinal = data.is_final || false;
            const confidence = data.channel?.alternatives?.[0]?.confidence || 0;

            if (transcript && transcript.trim() && this.onTranscript) {
              console.log(`📝 Deepgram transcript (${isFinal ? 'final' : 'interim'}, confidence: ${confidence.toFixed(2)}):`, transcript);
              this.onTranscript(transcript, isFinal);
            } else if (data.is_final && !transcript) {
              // Sometimes Deepgram sends final with empty transcript - this is normal
              console.log('📝 Deepgram sent final result with no transcript (silence or noise)');
            }
          } catch (error) {
            console.error('❌ Error processing Deepgram results:', error);
          }
        });

        this.connection.on(LiveTranscriptionEvents.Error, (error: any) => {
          console.error('❌ Deepgram error:', error);
          this.isConnectionReady = false;
          this.emit('error', error);
          reject(error);
        });

        this.connection.on(LiveTranscriptionEvents.Close, () => {
          console.log('🔌 Deepgram connection closed');
          this.isConnectionReady = false;
        });

        this.connection.on(LiveTranscriptionEvents.Metadata, (data: any) => {
          console.log('📊 Deepgram metadata:', data);
        });

      } catch (error) {
        console.error('❌ Error starting Deepgram:', error);
        reject(error);
      }
    });
  }

  private audioChunkCount = 0;

  sendAudio(audioData: string | Buffer) {
    try {
      let buffer: Buffer;
      if (typeof audioData === 'string') {
        // Assume base64 encoded
        buffer = Buffer.from(audioData, 'base64');
      } else {
        buffer = audioData;
      }

      // Deepgram expects raw PCM audio (16-bit, 16kHz, mono)
      if (buffer.length === 0) {
        return;
      }

      // If connection is ready, send immediately
      if (this.isConnectionReady && this.connection) {
        try {
          this.connection.send(buffer);
          this.audioChunkCount++;
          
          if (this.audioChunkCount % 100 === 0) {
            console.log(`📤 Sent ${this.audioChunkCount} audio chunks to Deepgram (${buffer.length} bytes each)`);
          }
        } catch (error) {
          console.error('❌ Error sending audio to Deepgram:', error);
        }
      } else {
        // Queue audio until connection is ready
        this.audioQueue.push(buffer);
        if (this.audioQueue.length > 100) {
          // Prevent queue from growing too large
          this.audioQueue.shift();
        }
      }
    } catch (error) {
      console.error('❌ Error processing audio for Deepgram:', error);
    }
  }

  async stop() {
    if (this.connection) {
      try {
        this.connection.finish();
      } catch (error) {
        console.error('Error stopping Deepgram:', error);
      }
      this.connection = null;
    }
  }
}

