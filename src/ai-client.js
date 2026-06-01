import axios from 'axios';
import { getConfig } from './config.js';

export class AIClient {
  constructor({ purpose } = {}) {
    this.purpose = purpose ? String(purpose) : '';
    const config = getConfig({ purpose: this.purpose });
    this.provider = config.provider;
    this.providerConfig = config[this.provider];

    if (!this.providerConfig) {
      throw new Error(`Proveedor AI inválido: ${this.provider}. Usa: grok | kimi | mimo`);
    }
    
    if (!this.providerConfig.apiKey) {
      throw new Error(`API key no configurada para ${this.provider}`);
    }
  }

  normalizeMessages(input) {
    if (Array.isArray(input)) {
      return input;
    }
    if (typeof input === 'string') {
      return [{ role: 'user', content: input }];
    }
    throw new Error('El prompt debe ser un string o un arreglo de messages');
  }

  async generate(promptOrMessages) {
    const messages = this.normalizeMessages(promptOrMessages);
    const basePayload = {
      model: this.providerConfig.model,
      messages,
      temperature: this.providerConfig.temperature,
      max_tokens: this.providerConfig.maxTokens
    };

    const timeout = Number.isFinite(this.providerConfig.timeoutMs)
      ? this.providerConfig.timeoutMs
      : 120000;

    const post = async (payload) => {
      const response = await axios.post(
        this.providerConfig.endpoint,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.providerConfig.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout
        }
      );
      return response;
    };

    try {
      const response = await post(basePayload);

      return this.extractContent(response.data);
    } catch (error) {
      const message = String(error?.response?.data?.error?.message || error?.message || '');
      const looksLikeTempMustBeOne =
        this.provider === 'kimi' &&
        error?.response?.status === 400 &&
        /invalid\s+temperature/i.test(message) &&
        /only\s+1\s+is\s+allowed/i.test(message);

      if (looksLikeTempMustBeOne && basePayload.temperature !== 1) {
        try {
          const retryPayload = { ...basePayload, temperature: 1 };
          const retryResponse = await post(retryPayload);
          return this.extractContent(retryResponse.data);
        } catch (retryError) {
          error = retryError;
        }
      }

      let errorDetail = error.message;
      if (error.response?.status === 400) {
        errorDetail = `400 Bad Request - ${error.response?.data?.error?.message || JSON.stringify(error.response.data)}`;
      }
      throw new Error(`Error en ${this.provider}: ${errorDetail}`);
    }
  }

  extractContent(data) {
    if (data.choices && data.choices[0]?.message?.content) {
      return data.choices[0].message.content;
    }
    
    if (data.content) {
      return data.content;
    }
    
    throw new Error('Formato de respuesta no reconocido');
  }
}
