/**
 * Type definitions for OpenAI Codex OAuth
 */

/**
 * PKCE challenge and verifier pair
 */
export interface CodexPKCEPair {
  challenge: string
  verifier: string
}

/**
 * Authorization flow result
 */
export interface CodexAuthorizationFlow {
  pkce: CodexPKCEPair
  state: string
  url: string
}

/**
 * OAuth server information
 */
export interface CodexOAuthServerInfo {
  port: number
  close: () => void
  waitForCode: (state: string) => Promise<{ code: string } | null>
}

/**
 * Token exchange success result
 */
export interface CodexTokenSuccess {
  type: 'success'
  access: string
  refresh: string
  expires: number
}

/**
 * Token exchange failure result
 */
export interface CodexTokenFailure {
  type: 'failed'
}

/**
 * Token exchange result
 */
export type CodexTokenResult = CodexTokenSuccess | CodexTokenFailure

/**
 * Parsed authorization input
 */
export interface CodexParsedAuthInput {
  code?: string
  state?: string
}

/**
 * JWT payload with ChatGPT account info
 */
export interface CodexJWTPayload {
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
  }
  exp?: number
  iat?: number
  [key: string]: unknown
}

/**
 * Codex OAuth credentials stored in config
 */
export interface CodexOAuthCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: number // Unix timestamp in ms
  accountId: string
  lastRefresh?: number
}

/**
 * Codex Plugin configuration
 */
export interface CodexPluginConfig {
  /**
   * Enable CODEX_MODE (Codex-OpenCode bridge prompt instead of tool remap)
   * @default true
   */
  codexMode?: boolean
}

/**
 * User-level Codex configuration
 */
export interface CodexUserConfig {
  global: CodexConfigOptions
  models: {
    [modelName: string]: {
      options?: CodexConfigOptions
    }
  }
}

/**
 * Configuration options for reasoning and text settings
 */
export interface CodexConfigOptions {
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  reasoningSummary?: 'auto' | 'concise' | 'detailed' | 'off' | 'on'
  textVerbosity?: 'low' | 'medium' | 'high'
  include?: string[]
}

/**
 * Reasoning configuration for requests
 */
export interface CodexReasoningConfig {
  effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  summary: 'auto' | 'concise' | 'detailed' | 'off' | 'on'
}

/**
 * Message input item for Codex API
 */
export interface CodexInputItem {
  id?: string
  type: string
  role: string
  content?: unknown
  call_id?: string
  [key: string]: unknown
}

/**
 * Request body structure for Codex API
 */
export interface CodexRequestBody {
  model: string
  store?: boolean
  stream?: boolean
  instructions?: string
  input?: CodexInputItem[]
  tools?: unknown
  reasoning?: Partial<CodexReasoningConfig>
  text?: {
    verbosity?: 'low' | 'medium' | 'high'
  }
  include?: string[]
  prompt_cache_key?: string
  max_output_tokens?: number
  max_completion_tokens?: number
  [key: string]: unknown
}

/**
 * SSE event data structure
 */
export interface CodexSSEEventData {
  type: string
  response?: unknown
  [key: string]: unknown
}

/**
 * Response transformation result
 */
export interface CodexTransformResult {
  body: CodexRequestBody
  updatedInit: RequestInit
}

/**
 * Codex Auth State
 */
export interface CodexAuthState {
  isAuthenticated: boolean
  credentials?: CodexOAuthCredentials
  error?: string
}
