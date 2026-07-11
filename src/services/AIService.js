const { z } = require('zod');

// Pricing per token
const PRICING = {
  gemini: {
    input: 0.075 / 1000000,   // $0.075 per 1M tokens
    output: 0.30 / 1000000,   // $0.30 per 1M tokens
  },
  groq: {
    input: 0.05 / 1000000,    // $0.05 per 1M tokens (e.g. Llama 3 8B)
    output: 0.08 / 1000000,   // $0.08 per 1M tokens
  },
  ollama: {
    input: 0.0,
    output: 0.0
  }
};

class AIService {
  constructor() {
    this.provider = process.env.AI_PROVIDER || 'gemini';
    this.model = process.env.AI_MODEL || 'gemini-1.5-flash';
    this.apiKey = process.env.AI_API_KEY || '';
    
    // Set default model based on provider if not explicitly defined
    if (!process.env.AI_MODEL) {
      if (this.provider === 'groq') this.model = 'llama3-8b-8192';
      else if (this.provider === 'ollama') this.model = 'llama3';
      else this.model = 'gemini-1.5-flash';
    }

    // In-memory cache for prompts (Stretch goal)
    this.cache = new Map();
  }

  /**
   * Performs the API completion request with timeouts and retries
   * @param {string} systemPrompt 
   * @param {string} userPrompt 
   * @param {number} timeoutMs 
   * @returns {Promise<{text: string, tokens: {input: number, output: number}}>}
   */
  async _requestWithRetry(systemPrompt, userPrompt, timeoutMs = 10000) {
    const maxRetries = 2;
    let attempt = 0;
    let delay = 1000; // start with 1s backoff

    while (attempt <= maxRetries) {
      try {
        let url = '';
        let headers = { 'Content-Type': 'application/json' };
        let body = {};

        if (this.provider === 'gemini') {
          url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
          body = {
            systemInstruction: {
              parts: [{ text: systemPrompt }]
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: userPrompt }]
              }
            ],
            generationConfig: {
              responseMimeType: 'application/json'
            }
          };
        } else if (this.provider === 'groq') {
          url = 'https://api.groq.com/openai/v1/chat/completions';
          headers['Authorization'] = `Bearer ${this.apiKey}`;
          body = {
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            response_format: { type: 'json_object' }
          };
        } else if (this.provider === 'ollama') {
          url = 'http://localhost:11434/api/chat';
          body = {
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            format: 'json',
            stream: false
          };
        } else {
          throw new Error(`Unsupported AI Provider: ${this.provider}`);
        }

        // Fetch with timeout (supported natively in Node.js 18+ via AbortSignal.timeout)
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs)
        });

        if (!response.ok) {
          const errorText = await response.text();
          const status = response.status;
          
          // Do not retry 400 (Bad Request) or other non-retriable codes
          if (status === 400 || (status >= 401 && status < 429)) {
            throw new Error(`AI API Bad Request (${status}): ${errorText}`);
          }
          
          throw new Error(`AI API Temp Failure (${status}): ${errorText}`);
        }

        const data = await response.json();
        return this._parseResponse(data);

      } catch (err) {
        attempt++;
        const isTimeout = err.name === 'TimeoutError' || err.message.includes('timeout') || err.message.includes('Timeout');
        const isTempFailure = err.message.includes('Temp Failure') || isTimeout;

        if (attempt > maxRetries || !isTempFailure) {
          throw err;
        }

        console.warn(`[AI Warning] Attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms...`);
        await new Promise(res => setTimeout(res, delay));
        delay *= 2; // exponential backoff
      }
    }
  }

  /**
   * Parses the raw provider response into a standard format
   */
  _parseResponse(data) {
    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;

    if (this.provider === 'gemini') {
      if (!data.candidates || data.candidates.length === 0) {
        throw new Error('Empty response from Gemini API');
      }
      text = data.candidates[0].content.parts[0].text;
      if (data.usageMetadata) {
        inputTokens = data.usageMetadata.promptTokenCount || 0;
        outputTokens = data.usageMetadata.candidatesTokenCount || 0;
      }
    } else if (this.provider === 'groq') {
      if (!data.choices || data.choices.length === 0) {
        throw new Error('Empty response from Groq API');
      }
      text = data.choices[0].message.content;
      if (data.usage) {
        inputTokens = data.usage.prompt_tokens || 0;
        outputTokens = data.usage.completion_tokens || 0;
      }
    } else if (this.provider === 'ollama') {
      if (!data.message) {
        throw new Error('Empty response from Ollama API');
      }
      text = data.message.content;
      inputTokens = data.prompt_eval_count || 0;
      outputTokens = data.eval_count || 0;
    }

    return {
      text,
      tokens: { input: inputTokens, output: outputTokens }
    };
  }

  /**
   * Logs usage metrics and cost estimation for the call
   */
  _logCost(featureName, tokens) {
    const providerPricing = PRICING[this.provider] || { input: 0, output: 0 };
    const cost = (tokens.input * providerPricing.input) + (tokens.output * providerPricing.output);
    console.log(
      `[AI Cost Log] Feature: "${featureName}" | Provider: ${this.provider} | Model: ${this.model} | ` +
      `Tokens: { in: ${tokens.input}, out: ${tokens.output} } | ` +
      `Estimated Cost: $${cost.toFixed(8)}`
    );
  }

  /**
   * Calls the model and validates the output against a Zod schema, with a single self-correcting retry.
   * @param {string} systemPrompt 
   * @param {string} userPrompt 
   * @param {z.ZodSchema} schema 
   * @param {string} featureName 
   * @returns {Promise<any>}
   */
  async generateStructured(systemPrompt, userPrompt, schema, featureName) {
    // Check in-memory cache first (Stretch goal)
    const cacheKey = `${this.provider}::${this.model}::${systemPrompt}::${userPrompt}`;
    if (this.cache.has(cacheKey)) {
      console.log(`[AI Cache HIT] Feature: "${featureName}" | Returning cached result instantly (0ms, $0.00000000)`);
      return this.cache.get(cacheKey);
    }

    let result;
    try {
      result = await this._requestWithRetry(systemPrompt, userPrompt);
    } catch (err) {
      throw new Error(`AI API failed: ${err.message}`);
    }

    this._logCost(featureName, result.tokens);

    try {
      const parsedJson = JSON.parse(result.text.trim());
      const validated = schema.parse(parsedJson);
      
      // Save to cache
      this.cache.set(cacheKey, validated);
      return validated;
    } catch (validationErr) {
      console.warn(`[AI Validation Warning] Validation failed for generated output. Retrying once with error feedback...`, validationErr.message);
      
      // Retry once by feeding the error back to the model for self-correction
      const correctionUserPrompt = `${userPrompt}\n\nNOTE: Your previous response was invalid. Error: ${validationErr.message}. Ensure you output STRICT JSON matching the schema directly.`;
      
      const retryResult = await this._requestWithRetry(systemPrompt, correctionUserPrompt);
      this._logCost(`${featureName}_correction_retry`, retryResult.tokens);

      const parsedJson = JSON.parse(retryResult.text.trim());
      const validated = schema.parse(parsedJson);
      
      // Save to cache
      this.cache.set(cacheKey, validated);
      return validated;
    }
  }

  /**
   * Message classification feature
   * @param {string} messageText 
   * @returns {Promise<{type: string, summary: string, priority: string, reasoning: string}>}
   */
  async classifyFeedback(messageText) {
    const systemPrompt = `You are a feedback classifier. Classify the user's feedback into one of: 'bug', 'question', or 'feedback'.
You must output a raw, valid JSON object matching this schema:
{
  "type": "bug" | "question" | "feedback",
  "summary": "a brief 5-10 word summary of the user's message",
  "priority": "low" | "medium" | "high",
  "reasoning": "a short 1-sentence reason for this classification"
}
Do not write markdown formatting, only valid JSON.`;

    const userPrompt = `Classify this message: "${messageText}"`;

    const schema = z.object({
      type: z.enum(['bug', 'question', 'feedback']),
      summary: z.string().max(100),
      priority: z.enum(['low', 'medium', 'high']),
      reasoning: z.string().max(250)
    });

    return this.generateStructured(systemPrompt, userPrompt, schema, 'classifyFeedback');
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = new AIService();
