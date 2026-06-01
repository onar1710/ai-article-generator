import dotenv from 'dotenv';
dotenv.config();

function parseBooleanEnv(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on';
}

function normalizeProvider(raw) {
  const rawProvider = String(raw || 'grok').trim().toLowerCase();
  const provider =
    rawProvider === 'grok' || rawProvider.startsWith('grok-') || rawProvider.startsWith('xai')
      ? 'grok'
      : rawProvider === 'kimi' || rawProvider.startsWith('kimi-') || rawProvider.startsWith('moonshot')
        ? 'kimi'
        : rawProvider === 'mimo' || rawProvider.startsWith('mimo')
          ? 'mimo'
          : rawProvider;
  return { rawProvider, provider };
}

function parseNumberEnv(value) {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

function applyPurposeOverrides(config, purpose) {
  const p = String(purpose ?? '').trim().toUpperCase();
  if (!p) return config;

  const providerOverrideRaw = process.env[`AI_PROVIDER_${p}`];
  const providerOverride = providerOverrideRaw ? normalizeProvider(providerOverrideRaw).provider : '';
  const provider = providerOverride || config.provider;

  const modelOverride = process.env[`AI_MODEL_${p}`];
  const temperatureOverride = parseNumberEnv(process.env[`AI_TEMPERATURE_${p}`]);
  const maxTokensOverride = parseNumberEnv(process.env[`AI_MAX_TOKENS_${p}`]);
  const timeoutMsOverride = parseNumberEnv(process.env[`AI_TIMEOUT_MS_${p}`]);

  const out = { ...config, provider };
  if (out[provider] && typeof out[provider] === 'object') {
    out[provider] = {
      ...out[provider],
      model: typeof modelOverride === 'string' && modelOverride.trim() ? String(modelOverride).trim() : out[provider].model,
      temperature: typeof temperatureOverride === 'number' ? temperatureOverride : out[provider].temperature,
      maxTokens: typeof maxTokensOverride === 'number' ? Math.trunc(maxTokensOverride) : out[provider].maxTokens,
      timeoutMs: typeof timeoutMsOverride === 'number' ? Math.trunc(timeoutMsOverride) : out[provider].timeoutMs
    };
  }

  return out;
}

export function getConfig({ purpose } = {}) {
  const { rawProvider, provider } = normalizeProvider(process.env.AI_PROVIDER || 'grok');
  const mimoModel = process.env.MIMO_MODEL || (provider === 'mimo' && rawProvider !== 'mimo' ? rawProvider : '') || 'MiMo-V2.5';
  const base = {
    provider,
    outputFormat: String(process.env.OUTPUT_FORMAT || 'mdx').trim().toLowerCase(),
    promptsDir: process.env.PROMPTS_DIR || './prompts',
    outputDir: process.env.OUTPUT_DIR || './outputs',
    analysisOutDir: process.env.ANALYSIS_OUT_DIR || './out',
    infoDir: process.env.INFO_DIR || './informacion-txt',
    formatterDir: process.env.FORMATTER_DIR || './ejemplo-fromater',
    blogContentDir: process.env.BLOG_CONTENT_DIR || './src/content/blog',
    useProjectFrontmatter: parseBooleanEnv(process.env.USE_PROJECT_FRONTMATTER ?? 'true'),

    grok: {
      apiKey: process.env.GROK_API_KEY,
      model: process.env.GROK_MODEL || 'grok-beta',
      temperature: parseFloat(process.env.GROK_TEMPERATURE) || 1.0,
      maxTokens: parseInt(process.env.GROK_MAX_TOKENS) || 50000,
      endpoint: 'https://api.x.ai/v1/chat/completions'
    },

    kimi: {
      apiKey: process.env.KIMI_API_KEY,
      model: process.env.KIMI_MODEL || 'kimi-k2.5',
      temperature: parseFloat(process.env.KIMI_TEMPERATURE) || 1.0,
      maxTokens: parseInt(process.env.KIMI_MAX_TOKENS) || 50000,
      endpoint: 'https://api.moonshot.ai/v1/chat/completions'
    },

    mimo: {
      apiKey: process.env.MIMO_API_KEY,
      model: mimoModel,
      temperature: parseFloat(process.env.MIMO_TEMPERATURE) || 1.0,
      maxTokens: parseInt(process.env.MIMO_MAX_TOKENS) || 50000,
      timeoutMs: parseInt(process.env.MIMO_TIMEOUT_MS) || parseInt(process.env.AI_TIMEOUT_MS) || 300000,
      endpoint: 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions'
    }
  };

  return applyPurposeOverrides(base, purpose);
}

// Backwards-compat: existing CLI imports `config` as a constant snapshot.
export const config = getConfig();
