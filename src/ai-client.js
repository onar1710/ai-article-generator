import axios from 'axios';
import { getConfig } from './config.js';

export class AIClient {
  constructor() {
    const config = getConfig();
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
    const payload = {
      model: this.providerConfig.model,
      messages,
      temperature: this.providerConfig.temperature,
      max_tokens: this.providerConfig.maxTokens
    };

    const timeout = Number.isFinite(this.providerConfig.timeoutMs)
      ? this.providerConfig.timeoutMs
      : 120000;

    try {
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

      return this.extractContent(response.data);
    } catch (error) {
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
