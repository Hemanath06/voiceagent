import Groq from 'groq-sdk';

export class GroqLLM {
  private groq: Groq;
  private currentStream: any = null;
  private fullResponse: string = '';
  public onToken?: (token: string) => void;
  public onComplete?: (fullResponse: string) => void;

  constructor() {
    const apiKey = process.env.GROQ_API_KEY || '';
    
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not set');
    }

    this.groq = new Groq({
      apiKey: apiKey,
    });
  }

  async streamCompletion(conversationHistory: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) {
    // Stop any existing stream
    this.stop();

    this.fullResponse = '';

    if (!conversationHistory || conversationHistory.length === 0) {
      console.warn('⚠️ Empty conversation history, skipping LLM call');
      return;
    }

    // Ensure we have at least a system message
    const messages = conversationHistory.length > 0 
      ? conversationHistory 
      : [{
          role: 'system' as const,
          content: 'You are a helpful, friendly, and concise AI assistant. Keep responses brief and conversational for voice interaction. Respond in 1-2 sentences.'
        }];

    try {
      const lastUserMessage = messages.filter(m => m.role === 'user').pop();
      console.log('🔄 Calling Groq LLM with conversation history:', {
        totalMessages: messages.length,
        lastUserMessage: lastUserMessage?.content.substring(0, 50) + '...'
      });
      
      const stream = await this.groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile', // Updated to current model
        messages: messages, // Use full conversation history
        stream: true,
        temperature: 0.7,
        max_tokens: 150, // Reduced for voice responses
      });

      this.currentStream = stream;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        
        if (content) {
          this.fullResponse += content;
          
          if (this.onToken) {
            this.onToken(content);
          }
        }
      }

      // Stream completed
      if (this.onComplete && this.fullResponse.trim()) {
        this.onComplete(this.fullResponse);
      }

      this.currentStream = null;

    } catch (error: any) {
      console.error('❌ Error in Groq LLM stream:', error);
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      console.error('Error details:', {
        message: errorMessage,
        status: error?.status,
        code: error?.code
      });
      throw new Error(`Groq LLM error: ${errorMessage}`);
    }
  }

  stop() {
    if (this.currentStream) {
      // Note: Groq SDK doesn't have explicit stream cancellation
      // We'll just mark it as stopped
      this.currentStream = null;
      this.fullResponse = '';
    }
  }
}

