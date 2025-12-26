/**
 * OpenAI Codex OAuth Service
 *
 * Implements OAuth 2.0 with PKCE for ChatGPT Plus/Pro authentication.
 * Uses the same authentication flow as OpenAI's official Codex CLI.
 *
 * @see https://github.com/openai/codex
 */

import * as http from 'http'
import { randomBytes } from 'crypto'
import { spawn } from 'child_process'
import { generatePKCE as generateOpenAuthPKCE } from '@openauthjs/openauth/pkce'
import {
  CODEX_CLIENT_ID,
  CODEX_AUTHORIZE_URL,
  CODEX_TOKEN_URL,
  CODEX_REDIRECT_URI,
  CODEX_OAUTH_SCOPE,
  CODEX_OAUTH_PORT,
  CODEX_JWT_CLAIM_PATH,
  PLATFORM_OPENERS,
  CODEX_ERROR_MESSAGES,
} from '@constants/codexOAuth'
import type {
  CodexPKCEPair,
  CodexAuthorizationFlow,
  CodexOAuthServerInfo,
  CodexTokenResult,
  CodexJWTPayload,
  CodexAuthState,
} from '@kode-types/codexOAuth'
import { getGlobalConfig, saveGlobalConfig, CodexOAuthCredentials } from '@utils/config'
import { logError } from '@utils/log'

// OAuth Success HTML page
const OAUTH_SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Kode - Authentication Successful</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    h1 { color: #10b981; margin-bottom: 16px; }
    p { color: #a0aec0; margin: 8px 0; }
    .checkmark {
      font-size: 64px;
      margin-bottom: 24px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">✓</div>
    <h1>Authentication Successful!</h1>
    <p>You can now close this window and return to Kode CLI.</p>
    <p style="font-size: 12px; margin-top: 24px;">Powered by ChatGPT Codex OAuth</p>
  </div>
</body>
</html>`

/**
 * Generate a cryptographically secure random state
 * Uses 32 bytes with base64url encoding (same as official Codex CLI)
 */
function generateState(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Generate PKCE verifier and challenge using @openauthjs/openauth
 * This ensures compatibility with OpenAI's OAuth implementation
 */
async function generatePKCE(): Promise<CodexPKCEPair> {
  const pkce = await generateOpenAuthPKCE()
  return {
    verifier: pkce.verifier,
    challenge: pkce.challenge,
  }
}

/**
 * Decode a JWT token to extract payload
 */
export function decodeJWT(token: string): CodexJWTPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1]
    const decoded = Buffer.from(payload, 'base64').toString('utf-8')
    return JSON.parse(decoded) as CodexJWTPayload
  } catch {
    return null
  }
}

/**
 * Extract ChatGPT account ID from access token
 */
export function extractAccountId(accessToken: string): string | null {
  const decoded = decodeJWT(accessToken)
  if (!decoded) return null
  return decoded[CODEX_JWT_CLAIM_PATH]?.chatgpt_account_id ?? null
}

/**
 * Check if token is expired or about to expire
 */
export function isTokenExpired(expiresAt: number, bufferMs: number = 60000): boolean {
  return Date.now() + bufferMs >= expiresAt
}

/**
 * Get platform-specific browser opener command
 */
function getBrowserOpener(): string {
  const platform = process.platform
  if (platform === 'darwin') return PLATFORM_OPENERS.darwin
  if (platform === 'win32') return PLATFORM_OPENERS.win32
  return PLATFORM_OPENERS.linux
}

/**
 * Open URL in default browser
 */
export function openBrowserUrl(url: string): void {
  try {
    const opener = getBrowserOpener()
    spawn(opener, [url], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
      detached: true,
    }).unref()
  } catch (error) {
    // Silently fail - user can manually open the URL
    logError(error as Error)
  }
}

/**
 * Create OAuth authorization flow with PKCE
 * Exact copy of opencode-openai-codex-auth-main implementation
 */
export async function createAuthorizationFlow(): Promise<CodexAuthorizationFlow> {
  const pkce = await generatePKCE()
  const state = generateState()

  // Use URL.searchParams.set() - exact same order as original opencode-openai-codex-auth project
  const url = new URL(CODEX_AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', CODEX_CLIENT_ID)
  url.searchParams.set('redirect_uri', CODEX_REDIRECT_URI)
  url.searchParams.set('scope', CODEX_OAUTH_SCOPE)
  url.searchParams.set('code_challenge', pkce.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('id_token_add_organizations', 'true')
  url.searchParams.set('codex_cli_simplified_flow', 'true')
  url.searchParams.set('originator', 'codex_cli_rs')

  const authUrl = url.toString()

  // Debug output
  console.log('[codex-oauth] Authorization URL:', authUrl)

  return { pkce, state, url: authUrl }
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  redirectUri: string = CODEX_REDIRECT_URI
): Promise<CodexTokenResult> {
  try {
    const response = await fetch(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CODEX_CLIENT_ID,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.error('[codex-oauth] code->token failed:', response.status, text)
      return { type: 'failed' }
    }

    const json = (await response.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }

    if (!json?.access_token || !json?.refresh_token || typeof json?.expires_in !== 'number') {
      console.error('[codex-oauth] token response missing fields:', json)
      return { type: 'failed' }
    }

    return {
      type: 'success',
      access: json.access_token,
      refresh: json.refresh_token,
      expires: Date.now() + json.expires_in * 1000,
    }
  } catch (error) {
    console.error('[codex-oauth] token exchange error:', error)
    return { type: 'failed' }
  }
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<CodexTokenResult> {
  try {
    const response = await fetch(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CODEX_CLIENT_ID,
      }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.error('[codex-oauth] Token refresh failed:', response.status, text)
      return { type: 'failed' }
    }

    const json = (await response.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }

    if (!json?.access_token || !json?.refresh_token || typeof json?.expires_in !== 'number') {
      console.error('[codex-oauth] Token refresh response missing fields:', json)
      return { type: 'failed' }
    }

    return {
      type: 'success',
      access: json.access_token,
      refresh: json.refresh_token,
      expires: Date.now() + json.expires_in * 1000,
    }
  } catch (error) {
    console.error('[codex-oauth] Token refresh error:', error)
    return { type: 'failed' }
  }
}

/**
 * Start local OAuth callback server
 */
export function startLocalOAuthServer(expectedState: string): Promise<CodexOAuthServerInfo> {
  let lastCode: string | null = null

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '', 'http://localhost')

      if (url.pathname !== '/auth/callback') {
        res.statusCode = 404
        res.end('Not found')
        return
      }

      const state = url.searchParams.get('state')
      if (state !== expectedState) {
        res.statusCode = 400
        res.end(CODEX_ERROR_MESSAGES.STATE_MISMATCH)
        return
      }

      const code = url.searchParams.get('code')
      if (!code) {
        res.statusCode = 400
        res.end(CODEX_ERROR_MESSAGES.MISSING_CODE)
        return
      }

      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(OAUTH_SUCCESS_HTML)
      lastCode = code
    } catch {
      res.statusCode = 500
      res.end('Internal error')
    }
  })

  return new Promise((resolve) => {
    server
      .listen(CODEX_OAUTH_PORT, '127.0.0.1', () => {
        resolve({
          port: CODEX_OAUTH_PORT,
          close: () => {
            try {
              server.close()
            } catch {}
          },
          waitForCode: async () => {
            const poll = () => new Promise<void>((r) => setTimeout(r, 100))
            // Wait up to 60 seconds for the code
            for (let i = 0; i < 600; i++) {
              if (lastCode) return { code: lastCode }
              await poll()
            }
            return null
          },
        })
      })
      .on('error', (err: NodeJS.ErrnoException) => {
        console.error('[codex-oauth] Failed to start server:', err?.code)
        resolve({
          port: CODEX_OAUTH_PORT,
          close: () => {
            try {
              server.close()
            } catch {}
          },
          waitForCode: async () => null,
        })
      })
  })
}

/**
 * Main Codex OAuth Service class
 */
export class CodexOAuthService {
  private serverInfo: CodexOAuthServerInfo | null = null

  /**
   * Start the OAuth flow
   */
  async startOAuthFlow(
    onAuthUrl?: (url: string) => void
  ): Promise<CodexOAuthCredentials | null> {
    try {
      // Create authorization flow
      const { pkce, state, url } = await createAuthorizationFlow()

      // Start local server to receive callback
      this.serverInfo = await startLocalOAuthServer(state)

      // Notify about auth URL
      if (onAuthUrl) {
        onAuthUrl(url)
      }

      // Open browser
      openBrowserUrl(url)

      // Wait for authorization code
      const result = await this.serverInfo.waitForCode(state)
      this.serverInfo.close()
      this.serverInfo = null

      if (!result) {
        console.error('[codex-oauth] Timeout waiting for authorization code')
        return null
      }

      // Exchange code for tokens
      const tokens = await exchangeAuthorizationCode(result.code, pkce.verifier)

      if (tokens.type === 'failed') {
        return null
      }

      // Extract account ID from token
      const accountId = extractAccountId(tokens.access)
      if (!accountId) {
        console.error('[codex-oauth] Failed to extract account ID from token')
        return null
      }

      // Create credentials object
      const credentials: CodexOAuthCredentials = {
        accessToken: tokens.access,
        refreshToken: tokens.refresh,
        expiresAt: tokens.expires,
        accountId,
        lastRefresh: Date.now(),
      }

      // Save to config
      console.log('[codex-oauth] Saving credentials for account:', accountId)
      this.saveCredentials(credentials)

      // Verify save
      const saved = this.loadCredentials()
      if (saved) {
        console.log('[codex-oauth] Credentials saved successfully')
      } else {
        console.error('[codex-oauth] WARNING: Credentials NOT saved!')
      }

      return credentials
    } catch (error) {
      console.error('[codex-oauth] OAuth flow error:', error)
      this.cleanup()
      return null
    }
  }

  /**
   * Get current credentials, refreshing if needed
   */
  async getCredentials(): Promise<CodexOAuthCredentials | null> {
    const credentials = this.loadCredentials()
    if (!credentials) return null

    // Check if token needs refresh
    if (isTokenExpired(credentials.expiresAt)) {
      const refreshResult = await refreshAccessToken(credentials.refreshToken)
      if (refreshResult.type === 'failed') {
        // Clear invalid credentials
        this.clearCredentials()
        return null
      }

      // Update credentials
      const newCredentials: CodexOAuthCredentials = {
        accessToken: refreshResult.access,
        refreshToken: refreshResult.refresh,
        expiresAt: refreshResult.expires,
        accountId: credentials.accountId,
        lastRefresh: Date.now(),
      }

      this.saveCredentials(newCredentials)
      return newCredentials
    }

    return credentials
  }

  /**
   * Get authentication state
   */
  getAuthState(): CodexAuthState {
    const credentials = this.loadCredentials()
    if (!credentials) {
      return { isAuthenticated: false }
    }

    return {
      isAuthenticated: true,
      credentials,
    }
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    const credentials = this.loadCredentials()
    return credentials !== null && !isTokenExpired(credentials.expiresAt)
  }

  /**
   * Logout - clear credentials
   */
  logout(): void {
    this.clearCredentials()
    this.cleanup()
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (this.serverInfo) {
      this.serverInfo.close()
      this.serverInfo = null
    }
  }

  /**
   * Save credentials to config
   */
  private saveCredentials(credentials: CodexOAuthCredentials): void {
    try {
      const config = getGlobalConfig()
      console.log('[codex-oauth] Current config keys:', Object.keys(config))
      config.codexOAuth = credentials
      console.log('[codex-oauth] Added codexOAuth to config')
      saveGlobalConfig(config)
      console.log('[codex-oauth] saveGlobalConfig called')
    } catch (error) {
      console.error('[codex-oauth] Error saving credentials:', error)
    }
  }

  /**
   * Load credentials from config
   */
  private loadCredentials(): CodexOAuthCredentials | null {
    const config = getGlobalConfig()
    return (config as any).codexOAuth ?? null
  }

  /**
   * Clear credentials from config
   */
  private clearCredentials(): void {
    const config = getGlobalConfig()
    delete (config as any).codexOAuth
    saveGlobalConfig(config)
  }
}

// Singleton instance
let codexOAuthServiceInstance: CodexOAuthService | null = null

/**
 * Get the Codex OAuth service singleton
 */
export function getCodexOAuthService(): CodexOAuthService {
  if (!codexOAuthServiceInstance) {
    codexOAuthServiceInstance = new CodexOAuthService()
  }
  return codexOAuthServiceInstance
}

/**
 * Check if Codex OAuth is authenticated
 */
export function isCodexAuthenticated(): boolean {
  return getCodexOAuthService().isAuthenticated()
}

/**
 * Get Codex OAuth credentials (refreshing if needed)
 */
export async function getCodexCredentials(): Promise<CodexOAuthCredentials | null> {
  return getCodexOAuthService().getCredentials()
}
