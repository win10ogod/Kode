/**
 * OpenAI Codex OAuth Configuration Constants
 *
 * Uses OpenAI's official OAuth authentication flow (same as OpenAI's official Codex CLI)
 * Enables users to use ChatGPT Plus/Pro subscription instead of OpenAI Platform API credits.
 *
 * @see https://github.com/openai/codex
 */

// OAuth endpoints (from OpenAI Codex CLI)
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
export const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
export const CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback'
export const CODEX_OAUTH_SCOPE = 'openid profile email offline_access'

// Codex API Configuration
export const CODEX_BASE_URL = 'https://chatgpt.com/backend-api'
export const CODEX_DUMMY_API_KEY = 'chatgpt-oauth'

// HTTP Headers for Codex API
export const CODEX_HEADERS = {
  BETA: 'OpenAI-Beta',
  ACCOUNT_ID: 'chatgpt-account-id',
  ORIGINATOR: 'originator',
  SESSION_ID: 'session_id',
  CONVERSATION_ID: 'conversation_id',
} as const

export const CODEX_HEADER_VALUES = {
  BETA_RESPONSES: 'responses=experimental',
  ORIGINATOR_CODEX: 'codex_cli_rs',
} as const

// URL Paths
export const CODEX_URL_PATHS = {
  RESPONSES: '/responses',
  CODEX_RESPONSES: '/codex/responses',
} as const

// JWT Claim Path for ChatGPT Account ID
export const CODEX_JWT_CLAIM_PATH = 'https://api.openai.com/auth'

// OAuth Server Configuration
export const CODEX_OAUTH_PORT = 1455 // Standard port used by Codex CLI

// Platform-specific browser opener commands
export const PLATFORM_OPENERS = {
  darwin: 'open',
  win32: 'start',
  linux: 'xdg-open',
} as const

// Error Messages
export const CODEX_ERROR_MESSAGES = {
  NO_ACCOUNT_ID: 'Failed to extract accountId from token',
  TOKEN_REFRESH_FAILED: 'Failed to refresh token, authentication required',
  REQUEST_PARSE_ERROR: 'Error parsing request',
  STATE_MISMATCH: 'OAuth state mismatch - possible CSRF attack',
  MISSING_CODE: 'Missing authorization code',
  PORT_IN_USE: 'OAuth callback port is already in use',
} as const

// Log Stages for debugging
export const CODEX_LOG_STAGES = {
  BEFORE_TRANSFORM: 'before-transform',
  AFTER_TRANSFORM: 'after-transform',
  RESPONSE: 'response',
  ERROR_RESPONSE: 'error-response',
} as const

// Auth Labels for UI
export const CODEX_AUTH_LABELS = {
  OAUTH: 'ChatGPT Plus/Pro (Codex Subscription)',
  API_KEY: 'Manually enter API Key',
  INSTRUCTIONS: 'A browser window should open. Complete login to finish.',
} as const

// Default Codex Mode Settings
export const CODEX_DEFAULT_CONFIG = {
  codexMode: true,
  reasoningEffort: 'medium' as const,
  reasoningSummary: 'auto' as const,
  textVerbosity: 'medium' as const,
  include: ['reasoning.encrypted_content'] as const,
}

// Model mapping for Codex backend (matching original opencode-openai-codex-auth)
export const CODEX_MODEL_MAP: Record<string, string> = {
  // GPT-5.2 Codex family
  'gpt-5.2-codex': 'gpt-5.2-codex',
  'gpt-5.2-codex-low': 'gpt-5.2-codex',
  'gpt-5.2-codex-medium': 'gpt-5.2-codex',
  'gpt-5.2-codex-high': 'gpt-5.2-codex',
  'gpt-5.2-codex-xhigh': 'gpt-5.2-codex',

  // GPT-5.2 General
  'gpt-5.2': 'gpt-5.2',
  'gpt-5.2-none': 'gpt-5.2',
  'gpt-5.2-low': 'gpt-5.2',
  'gpt-5.2-medium': 'gpt-5.2',
  'gpt-5.2-high': 'gpt-5.2',
  'gpt-5.2-xhigh': 'gpt-5.2',

  // GPT-5.1 Codex Max family
  'gpt-5.1-codex-max': 'gpt-5.1-codex-max',
  'gpt-5.1-codex-max-low': 'gpt-5.1-codex-max',
  'gpt-5.1-codex-max-medium': 'gpt-5.1-codex-max',
  'gpt-5.1-codex-max-high': 'gpt-5.1-codex-max',
  'gpt-5.1-codex-max-xhigh': 'gpt-5.1-codex-max',

  // GPT-5.1 Codex family
  'gpt-5.1-codex': 'gpt-5.1-codex',
  'gpt-5.1-codex-low': 'gpt-5.1-codex',
  'gpt-5.1-codex-medium': 'gpt-5.1-codex',
  'gpt-5.1-codex-high': 'gpt-5.1-codex',

  // GPT-5.1 Codex Mini family
  'gpt-5.1-codex-mini': 'gpt-5.1-codex-mini',
  'gpt-5.1-codex-mini-medium': 'gpt-5.1-codex-mini',
  'gpt-5.1-codex-mini-high': 'gpt-5.1-codex-mini',

  // GPT-5.1 General
  'gpt-5.1': 'gpt-5.1',
  'gpt-5.1-none': 'gpt-5.1',
  'gpt-5.1-low': 'gpt-5.1',
  'gpt-5.1-medium': 'gpt-5.1',
  'gpt-5.1-high': 'gpt-5.1',
  'gpt-5.1-chat-latest': 'gpt-5.1',

  // Legacy GPT-5 Codex (maps to gpt-5.1)
  'gpt-5-codex': 'gpt-5.1-codex',

  // Legacy Codex Mini (maps to gpt-5.1-codex-mini)
  'codex-mini-latest': 'gpt-5.1-codex-mini',
  'gpt-5-codex-mini': 'gpt-5.1-codex-mini',
  'gpt-5-codex-mini-medium': 'gpt-5.1-codex-mini',
  'gpt-5-codex-mini-high': 'gpt-5.1-codex-mini',

  // Legacy GPT-5 General (maps to gpt-5.1)
  'gpt-5': 'gpt-5.1',
  'gpt-5-mini': 'gpt-5.1',
  'gpt-5-nano': 'gpt-5.1',

  // Aliases
  'codex': 'gpt-5.1-codex',
  'codex-max': 'gpt-5.1-codex-max',
  'codex-mini': 'gpt-5.1-codex-mini',
}

// Supported Codex reasoning efforts
export const CODEX_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
export type CodexReasoningEffort = typeof CODEX_REASONING_EFFORTS[number]

// Supported text verbosity levels
export const CODEX_TEXT_VERBOSITIES = ['low', 'medium', 'high'] as const
export type CodexTextVerbosity = typeof CODEX_TEXT_VERBOSITIES[number]
