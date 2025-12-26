/**
 * Codex API Adapter
 *
 * Transforms requests for OpenAI Codex backend (ChatGPT subscription)
 * Handles URL rewriting, request transformation, and response processing.
 */

import { OpenAI } from 'openai'
import {
  CODEX_BASE_URL,
  CODEX_HEADERS,
  CODEX_HEADER_VALUES,
  CODEX_URL_PATHS,
  CODEX_MODEL_MAP,
  CODEX_DEFAULT_CONFIG,
} from '@constants/codexOAuth'
import type {
  CodexRequestBody,
  CodexInputItem,
  CodexReasoningConfig,
  CodexConfigOptions,
  CodexTransformResult,
  CodexOAuthCredentials,
} from '@kode-types/codexOAuth'
import { getCodexCredentials, isTokenExpired, refreshAccessToken } from '../codexOAuth'
import { getGlobalConfig, saveGlobalConfig } from '@utils/config'
import { debug as debugLogger } from '@utils/debugLogger'

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Model family type for prompt selection
 */
type ModelFamily = 'gpt-5.2-codex' | 'codex-max' | 'codex' | 'gpt-5.2' | 'gpt-5.1'

/**
 * Prompt file mapping for each model family
 * Based on codex-rs/core/src/model_family.rs logic
 */
const PROMPT_FILES: Record<ModelFamily, string> = {
  'gpt-5.2-codex': 'gpt-5.2-codex_prompt.md',
  'codex-max': 'gpt-5.1-codex-max_prompt.md',
  'codex': 'gpt_5_codex_prompt.md',
  'gpt-5.2': 'gpt_5_2_prompt.md',
  'gpt-5.1': 'gpt_5_1_prompt.md',
}

/**
 * Cache directory for fetched instructions
 */
const CACHE_DIR = join(homedir(), '.kode', 'cache', 'codex-instructions')

/**
 * GitHub URLs for fetching instructions
 */
const GITHUB_API_RELEASES = 'https://api.github.com/repos/openai/codex/releases/latest'
const GITHUB_HTML_RELEASES = 'https://github.com/openai/codex/releases/latest'

/**
 * Cache metadata interface
 */
interface CacheMetadata {
  etag: string | null
  tag: string
  lastChecked: number
  url: string
}

/**
 * Determine the model family based on the normalized model name
 */
function getModelFamily(normalizedModel: string): ModelFamily {
  // Order matters - check more specific patterns first
  if (normalizedModel.includes('gpt-5.2-codex') || normalizedModel.includes('gpt 5.2 codex')) {
    return 'gpt-5.2-codex'
  }
  if (normalizedModel.includes('codex-max')) {
    return 'codex-max'
  }
  if (normalizedModel.includes('codex') || normalizedModel.startsWith('codex-')) {
    return 'codex'
  }
  if (normalizedModel.includes('gpt-5.2')) {
    return 'gpt-5.2'
  }
  return 'gpt-5.1'
}

/**
 * Bundled fallback instructions (minimal version)
 * Used when GitHub is unavailable and no cache exists
 */
const BUNDLED_FALLBACK_INSTRUCTIONS = `You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer.

## General
- When searching for text or files, prefer using \`rg\` or \`rg --files\` because \`rg\` is faster than \`grep\`.

## Editing constraints
- Default to ASCII when editing or creating files.
- You may be in a dirty git worktree. NEVER revert existing changes you did not make unless explicitly requested.
- Do not amend a commit unless explicitly requested to do so.
- **NEVER** use destructive commands like \`git reset --hard\` unless specifically requested.

## Presenting your work
- Default: be very concise; friendly coding teammate tone.
- For code changes, lead with a quick explanation, then details on where and why.
- Offer logical next steps briefly.`

/**
 * Fetch with timeout helper
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Get the latest release tag from GitHub (with timeout)
 */
async function getLatestReleaseTag(): Promise<string> {
  try {
    const response = await fetchWithTimeout(GITHUB_API_RELEASES, {}, 3000)
    if (response.ok) {
      const data = await response.json() as { tag_name?: string }
      if (data.tag_name) {
        return data.tag_name
      }
    }
  } catch {
    // Fall through to HTML parsing
  }

  try {
    const htmlResponse = await fetchWithTimeout(GITHUB_HTML_RELEASES, {}, 3000)
    if (!htmlResponse.ok) {
      throw new Error(`Failed to fetch latest release: ${htmlResponse.status}`)
    }

    const finalUrl = htmlResponse.url
    if (finalUrl) {
      const parts = finalUrl.split('/tag/')
      const last = parts[parts.length - 1]
      if (last && !last.includes('/')) {
        return last
      }
    }

    const html = await htmlResponse.text()
    const match = html.match(/\/openai\/codex\/releases\/tag\/([^"]+)/)
    if (match && match[1]) {
      return match[1]
    }
  } catch {
    // Timeout or network error
  }

  throw new Error('Failed to determine latest release tag from GitHub')
}

/**
 * Fetch Codex instructions from GitHub with caching
 * Uses ETag-based conditional requests to efficiently check for updates
 *
 * Rate limit protection: Only checks GitHub if cache is older than 15 minutes
 */
export async function getCodexInstructions(normalizedModel = 'gpt-5.1-codex'): Promise<string> {
  const modelFamily = getModelFamily(normalizedModel)
  const promptFile = PROMPT_FILES[modelFamily]
  const cacheFile = join(CACHE_DIR, `${modelFamily}-instructions.md`)
  const cacheMetaFile = join(CACHE_DIR, `${modelFamily}-instructions-meta.json`)

  try {
    // Load cached metadata
    let cachedETag: string | null = null
    let cachedTag: string | null = null
    let cachedTimestamp: number | null = null

    if (existsSync(cacheMetaFile)) {
      const metadata = JSON.parse(readFileSync(cacheMetaFile, 'utf8')) as CacheMetadata
      cachedETag = metadata.etag
      cachedTag = metadata.tag
      cachedTimestamp = metadata.lastChecked
    }

    // Rate limit protection: If cache is less than 15 minutes old, use it
    const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes
    if (cachedTimestamp && Date.now() - cachedTimestamp < CACHE_TTL_MS && existsSync(cacheFile)) {
      debugLogger.api('CODEX_INSTRUCTIONS_CACHE_HIT', { modelFamily, cacheAge: Date.now() - cachedTimestamp })
      return readFileSync(cacheFile, 'utf8')
    }

    // Get the latest release tag
    const latestTag = await getLatestReleaseTag()
    const CODEX_INSTRUCTIONS_URL = `https://raw.githubusercontent.com/openai/codex/${latestTag}/codex-rs/core/${promptFile}`

    debugLogger.api('CODEX_INSTRUCTIONS_FETCH', { modelFamily, latestTag, url: CODEX_INSTRUCTIONS_URL })

    // If tag changed, force re-fetch
    if (cachedTag !== latestTag) {
      cachedETag = null
    }

    // Make conditional request with If-None-Match header (with timeout)
    const headers: Record<string, string> = {}
    if (cachedETag) {
      headers['If-None-Match'] = cachedETag
    }

    const response = await fetchWithTimeout(CODEX_INSTRUCTIONS_URL, { headers }, 5000)

    // 304 Not Modified - cached version is still current
    if (response.status === 304 && existsSync(cacheFile)) {
      // Update lastChecked timestamp
      writeFileSync(cacheMetaFile, JSON.stringify({
        etag: cachedETag,
        tag: latestTag,
        lastChecked: Date.now(),
        url: CODEX_INSTRUCTIONS_URL,
      } satisfies CacheMetadata), 'utf8')
      return readFileSync(cacheFile, 'utf8')
    }

    // 200 OK - new content or first fetch
    if (response.ok) {
      const instructions = await response.text()
      const newETag = response.headers.get('etag')

      // Create cache directory if it doesn't exist
      if (!existsSync(CACHE_DIR)) {
        mkdirSync(CACHE_DIR, { recursive: true })
      }

      // Cache the instructions (verbatim from GitHub)
      writeFileSync(cacheFile, instructions, 'utf8')
      writeFileSync(cacheMetaFile, JSON.stringify({
        etag: newETag,
        tag: latestTag,
        lastChecked: Date.now(),
        url: CODEX_INSTRUCTIONS_URL,
      } satisfies CacheMetadata), 'utf8')

      debugLogger.api('CODEX_INSTRUCTIONS_FETCHED', { modelFamily, latestTag, instructionsLength: instructions.length })
      return instructions
    }

    throw new Error(`HTTP ${response.status}`)
  } catch (error) {
    const err = error as Error
    debugLogger.api('CODEX_INSTRUCTIONS_FETCH_ERROR', { modelFamily, error: err.message })

    // Try to use cached version even if stale
    if (existsSync(cacheFile)) {
      debugLogger.api('CODEX_INSTRUCTIONS_USING_CACHE', { modelFamily })
      return readFileSync(cacheFile, 'utf8')
    }

    // Fallback: Use bundled minimal instructions (never fail)
    debugLogger.api('CODEX_INSTRUCTIONS_USING_FALLBACK', { modelFamily })
    return BUNDLED_FALLBACK_INSTRUCTIONS
  }
}

/**
 * Kode-Codex Bridge Prompt
 * Maps Codex CLI tools to Kode tools to prevent tool confusion
 */
export const KODE_CODEX_BRIDGE = `# Codex Running in Kode

You are running Codex through Kode, a terminal coding assistant. Kode provides different tools but follows Codex operating principles.

## CRITICAL: Tool Replacements

<critical_rule priority="0">
❌ APPLY_PATCH DOES NOT EXIST → ✅ USE "Edit" INSTEAD
- NEVER use: apply_patch, applyPatch
- ALWAYS use: Edit tool for ALL file modifications
- Before modifying files: Verify you're using "Edit", NOT "apply_patch"
</critical_rule>

<critical_rule priority="0">
❌ UPDATE_PLAN DOES NOT EXIST → ✅ USE "TodoWrite" INSTEAD
- NEVER use: update_plan, updatePlan, read_plan, readPlan
- ALWAYS use: TodoWrite for task/plan updates, TodoRead to read plans
- Before plan operations: Verify you're using "TodoWrite", NOT "update_plan"
</critical_rule>

## Available Kode Tools

**File Operations:**
- \`Write\` - Create new files (requires prior Read for existing files)
- \`Edit\` - Modify existing files (REPLACES apply_patch)
- \`Read\` - Read file contents

**Search/Discovery:**
- \`Grep\` - Search file contents
- \`Glob\` - Find files by pattern
- \`LSP\` - Language Server Protocol operations

**Execution:**
- \`Bash\` - Run shell commands
  - Always include a short description for the command
  - Use absolute paths in commands
  - Quote paths containing spaces with double quotes

**Network:**
- \`WebFetch\` - Fetch web content
- \`WebSearch\` - Search the web

**Task Management:**
- \`TodoWrite\` - Manage tasks/plans (REPLACES update_plan)
- \`TodoRead\` - Read current plan
- \`Task\` - Launch sub-agents for complex tasks

## Substitution Rules

Base instruction says:    You MUST use instead:
apply_patch           →   Edit
update_plan           →   TodoWrite
read_plan             →   TodoRead

## Verification Checklist

Before file/plan modifications:
1. Am I using "Edit" NOT "apply_patch"?
2. Am I using "TodoWrite" NOT "update_plan"?
3. Is this tool in the approved list above?

If ANY answer is NO → STOP and correct before proceeding.`

/**
 * Add bridge message to input if tools are present
 */
function addKodeBridgeMessage(input: CodexInputItem[] | undefined, hasTools: boolean): CodexInputItem[] | undefined {
  if (!hasTools || !Array.isArray(input)) return input

  const bridgeMessage: CodexInputItem = {
    type: 'message',
    role: 'developer',
    content: [
      {
        type: 'input_text',
        text: KODE_CODEX_BRIDGE,
      },
    ],
  }

  return [bridgeMessage, ...input]
}

/**
 * Get default reasoning effort based on model
 * Based on opencode-openai-codex-auth logic
 */
export function getDefaultReasoningEffort(model: string): string {
  const normalized = model.toLowerCase()

  // GPT-5.2 Codex and Codex Max support xhigh, default to high
  if (normalized.includes('gpt-5.2-codex') || normalized.includes('codex-max')) {
    return 'high'
  }

  // Codex Mini only supports medium/high
  if (normalized.includes('codex-mini')) {
    return 'medium'
  }

  // Default for other models
  return 'medium'
}

/**
 * Validate and normalize reasoning effort for a model
 */
export function normalizeReasoningEffort(effort: string, model: string): string {
  const normalized = model.toLowerCase()
  let result = effort.toLowerCase()

  // GPT-5.2 Codex and Codex Max support xhigh
  const supportsXhigh = normalized.includes('gpt-5.2-codex') || normalized.includes('codex-max')

  // GPT-5.1 and GPT-5.2 general support "none"
  const supportsNone = (normalized.includes('gpt-5.1') || normalized.includes('gpt-5.2')) &&
                       !normalized.includes('codex')

  // Codex Mini only supports medium/high
  const isCodexMini = normalized.includes('codex-mini')

  // Normalize "minimal" to "low" for Codex families
  if (normalized.includes('codex') && result === 'minimal') {
    result = 'low'
  }

  // Codex Mini constraints
  if (isCodexMini) {
    if (result === 'minimal' || result === 'low' || result === 'none') {
      result = 'medium'
    }
    if (result === 'xhigh') {
      result = 'high'
    }
  }

  // Downgrade xhigh to high for models that don't support it
  if (!supportsXhigh && result === 'xhigh') {
    result = 'high'
  }

  // Upgrade none to low for models that don't support it
  if (!supportsNone && result === 'none') {
    result = 'low'
  }

  return result
}

/**
 * Normalize model name to Codex-supported variants
 */
export function normalizeCodexModel(model: string | undefined): string {
  if (!model) return 'gpt-5.1'

  // Strip provider prefix if present
  const modelId = model.includes('/') ? model.split('/').pop()! : model

  // Check explicit model map
  const mappedModel = CODEX_MODEL_MAP[modelId.toLowerCase()]
  if (mappedModel) return mappedModel

  // Pattern-based matching for unknown models
  const normalized = modelId.toLowerCase()

  if (normalized.includes('gpt-5.2-codex')) return 'gpt-5.2-codex'
  if (normalized.includes('gpt-5.2')) return 'gpt-5.2'
  if (normalized.includes('gpt-5.1-codex-max')) return 'gpt-5.1-codex-max'
  if (normalized.includes('gpt-5.1-codex-mini')) return 'gpt-5.1-codex-mini'
  if (normalized.includes('codex-mini')) return 'codex-mini-latest'
  if (normalized.includes('gpt-5.1-codex')) return 'gpt-5.1-codex'
  if (normalized.includes('gpt-5.1')) return 'gpt-5.1'
  if (normalized.includes('codex')) return 'gpt-5.1-codex'
  if (normalized.includes('gpt-5')) return 'gpt-5.1'

  return 'gpt-5.1'
}

/**
 * Get model family for Codex instructions
 */
export function getCodexModelFamily(model: string): 'codex-max' | 'codex' | 'gpt-5.1' {
  const normalized = model.toLowerCase()
  if (normalized.includes('codex-max')) return 'codex-max'
  if (normalized.includes('codex')) return 'codex'
  return 'gpt-5.1'
}

/**
 * Configure reasoning based on model variant
 */
export function getCodexReasoningConfig(
  modelName: string | undefined,
  userConfig: CodexConfigOptions = {}
): CodexReasoningConfig {
  const normalized = modelName?.toLowerCase() ?? ''

  const isGpt52Codex = normalized.includes('gpt-5.2-codex')
  const isGpt52General = normalized.includes('gpt-5.2') && !isGpt52Codex
  const isCodexMax = normalized.includes('codex-max')
  const isCodexMini = normalized.includes('codex-mini')
  const isCodex = normalized.includes('codex') && !isCodexMini
  const isGpt51General = normalized.includes('gpt-5.1') && !isCodex && !isCodexMax && !isCodexMini

  const supportsXhigh = isGpt52General || isGpt52Codex || isCodexMax
  const supportsNone = isGpt52General || isGpt51General

  // Default effort based on model type
  let defaultEffort: CodexReasoningConfig['effort'] = isCodexMini
    ? 'medium'
    : supportsXhigh
      ? 'high'
      : 'medium'

  let effort = userConfig.reasoningEffort || defaultEffort

  // Codex Mini constraints
  if (isCodexMini) {
    if (effort === 'minimal' || effort === 'low' || effort === 'none') effort = 'medium'
    if (effort === 'xhigh') effort = 'high'
  }

  // XHigh support
  if (!supportsXhigh && effort === 'xhigh') effort = 'high'

  // None support
  if (!supportsNone && effort === 'none') effort = 'low'

  // Normalize minimal for Codex
  if (isCodex && effort === 'minimal') effort = 'low'

  return {
    effort,
    summary: userConfig.reasoningSummary || 'auto',
  }
}

/**
 * Filter input array for stateless Codex API
 */
export function filterCodexInput(input: CodexInputItem[] | undefined): CodexInputItem[] | undefined {
  if (!Array.isArray(input)) return input

  return input
    .filter((item) => item.type !== 'item_reference')
    .map((item) => {
      if (item.id) {
        const { id, ...itemWithoutId } = item
        return itemWithoutId as CodexInputItem
      }
      return item
    })
}

/**
 * Rewrite URL for Codex backend
 */
export function rewriteCodexUrl(url: string): string {
  return url.replace(CODEX_URL_PATHS.RESPONSES, CODEX_URL_PATHS.CODEX_RESPONSES)
}

/**
 * Create headers for Codex API requests
 */
export function createCodexHeaders(
  accessToken: string,
  accountId: string,
  opts?: { model?: string; promptCacheKey?: string }
): Headers {
  const headers = new Headers()

  headers.set('Content-Type', 'application/json')
  headers.set('Authorization', `Bearer ${accessToken}`)
  headers.set(CODEX_HEADERS.ACCOUNT_ID, accountId)
  headers.set(CODEX_HEADERS.BETA, CODEX_HEADER_VALUES.BETA_RESPONSES)
  headers.set(CODEX_HEADERS.ORIGINATOR, CODEX_HEADER_VALUES.ORIGINATOR_CODEX)

  if (opts?.promptCacheKey) {
    headers.set(CODEX_HEADERS.CONVERSATION_ID, opts.promptCacheKey)
    headers.set(CODEX_HEADERS.SESSION_ID, opts.promptCacheKey)
  }

  headers.set('accept', 'text/event-stream')

  return headers
}

/**
 * Transform request body for Codex API
 */
export function transformCodexRequestBody(
  body: CodexRequestBody,
  codexInstructions: string,
  userConfig: CodexConfigOptions = {}
): CodexRequestBody {
  const normalizedModel = normalizeCodexModel(body.model)

  // Clone and transform
  const transformed: CodexRequestBody = { ...body }

  // Normalize model
  transformed.model = normalizedModel

  // Codex required fields
  transformed.store = false
  transformed.stream = true
  transformed.instructions = codexInstructions

  // Filter input
  if (transformed.input) {
    transformed.input = filterCodexInput(transformed.input)
  }

  // Configure reasoning
  const reasoningConfig = getCodexReasoningConfig(normalizedModel, userConfig)
  transformed.reasoning = {
    ...transformed.reasoning,
    ...reasoningConfig,
  }

  // Text verbosity
  transformed.text = {
    ...transformed.text,
    verbosity: userConfig.textVerbosity || CODEX_DEFAULT_CONFIG.textVerbosity,
  }

  // Include encrypted reasoning content
  transformed.include = userConfig.include || [...CODEX_DEFAULT_CONFIG.include]

  // Remove unsupported parameters
  delete transformed.max_output_tokens
  delete transformed.max_completion_tokens

  return transformed
}

/**
 * Parse SSE stream to extract final response
 */
function parseSseStream(sseText: string): unknown | null {
  const lines = sseText.split('\n')

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        const data = JSON.parse(line.substring(6))
        if (data.type === 'response.done' || data.type === 'response.completed') {
          return data.response
        }
      } catch {
        // Skip malformed JSON
      }
    }
  }

  return null
}

/**
 * Convert SSE stream to JSON response
 */
export async function convertSseToJson(
  response: Response
): Promise<Response> {
  if (!response.body) {
    throw new Error('[codex-adapter] Response has no body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      fullText += decoder.decode(value, { stream: true })
    }

    const finalResponse = parseSseStream(fullText)

    if (!finalResponse) {
      debugLogger.api('CODEX_SSE_NO_FINAL_RESPONSE', { textLength: fullText.length })
      return new Response(fullText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }

    const jsonHeaders = new Headers(response.headers)
    jsonHeaders.set('content-type', 'application/json; charset=utf-8')

    return new Response(JSON.stringify(finalResponse), {
      status: response.status,
      statusText: response.statusText,
      headers: jsonHeaders,
    })
  } catch (error) {
    debugLogger.api('CODEX_SSE_CONVERT_ERROR', { error: (error as Error).message })
    throw error
  }
}

/**
 * Handle error response from Codex API
 */
export async function handleCodexErrorResponse(response: Response): Promise<Response> {
  const raw = await response.text()
  let enriched = raw

  // Log raw error for debugging (only via debugLogger to avoid noise)
  debugLogger.api('CODEX_API_ERROR_RAW', { status: response.status, raw: raw.substring(0, 500) })

  try {
    const parsed = JSON.parse(raw)
    const err = parsed?.error ?? {}

    // Parse rate-limit headers
    const h = response.headers
    const primary = {
      used_percent: parseFloat(h.get('x-codex-primary-used-percent') || ''),
      window_minutes: parseInt(h.get('x-codex-primary-window-minutes') || ''),
      resets_at: parseInt(h.get('x-codex-primary-reset-at') || ''),
    }

    const code = (err.code ?? err.type ?? '').toString()
    const resetsAt = err.resets_at ?? primary.resets_at
    const mins = resetsAt
      ? Math.max(0, Math.round((resetsAt * 1000 - Date.now()) / 60000))
      : undefined

    let friendlyMessage: string | undefined
    if (/usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(code) || response.status === 429) {
      const plan = err.plan_type ? ` (${String(err.plan_type).toLowerCase()} plan)` : ''
      const when = mins !== undefined ? ` Try again in ~${mins} min.` : ''
      friendlyMessage = `You have hit your ChatGPT usage limit${plan}.${when}`.trim()
    }

    const enhanced = {
      error: {
        ...err,
        message: err.message ?? friendlyMessage ?? 'Usage limit reached.',
        friendly_message: friendlyMessage,
        status: response.status,
      },
    }
    enriched = JSON.stringify(enhanced)
  } catch {
    // Raw body not JSON; leave unchanged
  }

  debugLogger.api('CODEX_API_ERROR', { status: response.status, enriched })

  const headers = new Headers(response.headers)
  headers.set('content-type', 'application/json; charset=utf-8')

  return new Response(enriched, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Make a request to Codex API
 */
export async function makeCodexRequest(
  opts: OpenAI.ChatCompletionCreateParams,
  signal?: AbortSignal
): Promise<OpenAI.ChatCompletion | AsyncIterable<OpenAI.ChatCompletionChunk>> {
  // Get credentials
  const credentials = await getCodexCredentials()
  if (!credentials) {
    throw new Error('Not authenticated with Codex. Please run /codex-login first.')
  }

  // Default Codex instructions (can be customized)
  const codexInstructions = `You are a helpful coding assistant powered by ChatGPT Codex.
You help with programming tasks, debugging, code review, and technical discussions.
Always provide clear, well-documented code with proper error handling.`

  // Transform request body
  const body = transformCodexRequestBody(
    {
      model: opts.model,
      input: opts.messages?.map((m) => ({
        type: 'message',
        role: m.role,
        content: m.content,
      })),
      tools: opts.tools,
      stream: opts.stream,
    } as CodexRequestBody,
    codexInstructions
  )

  // Create headers
  const headers = createCodexHeaders(credentials.accessToken, credentials.accountId, {
    model: body.model,
  })

  // Build URL
  const url = `${CODEX_BASE_URL}${CODEX_URL_PATHS.CODEX_RESPONSES}`

  debugLogger.api('CODEX_API_REQUEST', {
    url,
    model: body.model,
    accountId: credentials.accountId,
    streaming: body.stream,
  })

  // Make request
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })

  // Handle error
  if (!response.ok) {
    const errorResponse = await handleCodexErrorResponse(response)
    const errorData = await errorResponse.json()
    throw new Error(errorData.error?.message || `Codex API error: ${response.status}`)
  }

  // Handle streaming
  if (opts.stream) {
    return createCodexStreamProcessor(response.body!)
  }

  // Non-streaming: convert SSE to JSON
  const jsonResponse = await convertSseToJson(response)
  const data = await jsonResponse.json()

  // Convert to OpenAI ChatCompletion format
  return convertCodexResponseToChatCompletion(data, opts.model)
}

/**
 * Create stream processor for Codex responses
 */
function createCodexStreamProcessor(
  stream: ReadableStream
): AsyncGenerator<OpenAI.ChatCompletionChunk, void, unknown> {
  return (async function* () {
    const reader = stream.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        let lineEnd = buffer.indexOf('\n')
        while (lineEnd !== -1) {
          const line = buffer.substring(0, lineEnd).trim()
          buffer = buffer.substring(lineEnd + 1)

          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            const data = line.slice(6).trim()
            if (!data) continue

            try {
              const parsed = JSON.parse(data)
              // Convert Codex SSE format to OpenAI chunk format
              const chunk = convertCodexSseToChunk(parsed)
              if (chunk) yield chunk
            } catch {
              // Skip malformed JSON
            }
          }

          lineEnd = buffer.indexOf('\n')
        }
      }
    } finally {
      reader.releaseLock()
    }
  })()
}

/**
 * Convert Codex SSE event to OpenAI ChatCompletionChunk
 */
function convertCodexSseToChunk(data: any): OpenAI.ChatCompletionChunk | null {
  // Handle different Codex event types
  if (data.type === 'response.output_item.added') {
    return null // Skip metadata events
  }

  if (data.type === 'response.content_part.delta' || data.delta?.content) {
    const content = data.delta?.content || data.text || ''
    return {
      id: data.response_id || `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: data.model || '',
      choices: [
        {
          index: 0,
          delta: { content },
          finish_reason: null,
        },
      ],
    }
  }

  if (data.type === 'response.done' || data.type === 'response.completed') {
    return {
      id: data.response?.id || `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: data.response?.model || '',
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
        },
      ],
    }
  }

  return null
}

/**
 * Convert Codex response to OpenAI ChatCompletion format
 */
function convertCodexResponseToChatCompletion(
  data: any,
  requestModel: string
): OpenAI.ChatCompletion {
  let outputText = data.output_text || ''

  // Extract from output array if present
  if (data.output && Array.isArray(data.output)) {
    const messageItems = data.output.filter((item: any) => item.type === 'message')
    outputText = messageItems
      .map((item: any) => item.content?.map((c: any) => c.text).join('\n'))
      .filter(Boolean)
      .join('\n\n')
  }

  return {
    id: data.id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: data.model || requestModel,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: outputText,
          refusal: null,
        },
        logprobs: null,
        finish_reason: data.status === 'completed' ? 'stop' : 'length',
      },
    ],
    usage: {
      prompt_tokens: data.usage?.input_tokens || 0,
      completion_tokens: data.usage?.output_tokens || 0,
      total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    },
  }
}

/**
 * Check if a model should use Codex adapter
 */
export function shouldUseCodexAdapter(model: string): boolean {
  const normalized = model.toLowerCase()
  return (
    normalized.includes('codex') ||
    normalized.includes('gpt-5') && !normalized.includes('chat')
  )
}

/**
 * Make a raw request to Codex API and return the Response object
 * This is used by the adapter system which handles parsing internally
 */
export async function makeCodexRawRequest(
  requestBody: any,
  signal?: AbortSignal,
  options?: {
    reasoningEffort?: string
    textVerbosity?: string
  }
): Promise<Response> {
  // Get credentials
  const credentials = await getCodexCredentials()
  if (!credentials) {
    throw new Error('Not authenticated with Codex. Please run /codex-login first.')
  }

  // Check if request is already in Responses API format (from adapter)
  const isPreFormatted = requestBody.input !== undefined

  let body: any

  if (isPreFormatted) {
    const normalizedModel = normalizeCodexModel(requestBody.model)

    // Request is already formatted by the adapter, just add Codex-specific fields
    body = {
      ...requestBody,
      model: normalizedModel,
      store: false, // Codex requires store: false
      stream: true, // Codex always uses streaming
      // Ensure include field for reasoning content
      include: requestBody.include || [...CODEX_DEFAULT_CONFIG.include],
    }

    // CRITICAL: The 'instructions' field must contain official Codex instructions
    // The Codex API is very strict - only accepts official instructions from OpenAI
    // Our system prompt should be moved to the input array as a developer message
    if (body.instructions && body.input) {
      // Move our custom system prompt to input as developer message
      const systemPromptMessage = {
        type: 'message',
        role: 'developer',
        content: [
          {
            type: 'input_text',
            text: body.instructions,
          },
        ],
      }
      // Prepend system prompt to input
      body.input = [systemPromptMessage, ...body.input]
    }

    // Set official Codex instructions - required by the API (fetched from GitHub)
    body.instructions = await getCodexInstructions(normalizedModel)

    // Configure reasoning from options or request body or defaults
    const rawEffort = options?.reasoningEffort ||
                     body.reasoning?.effort ||
                     getDefaultReasoningEffort(normalizedModel)
    // Normalize the effort to ensure it's valid for this model
    const reasoningEffort = normalizeReasoningEffort(rawEffort, normalizedModel)
    body.reasoning = {
      effort: reasoningEffort,
      summary: body.reasoning?.summary || 'auto',
    }

    // Configure text verbosity from options or defaults
    const textVerbosity = options?.textVerbosity ||
                         body.text?.verbosity ||
                         CODEX_DEFAULT_CONFIG.textVerbosity
    body.text = {
      verbosity: textVerbosity,
    }

    // Filter input for stateless API
    // NOTE: Keep content as array format [{type: "input_text", text: "..."}] - this is what Codex expects
    if (body.input) {
      body.input = filterCodexInput(body.input)
    }

    // Add Kode-Codex bridge message if tools are present
    // This tells Codex about our tool names (Edit instead of apply_patch, etc.)
    if (body.tools && body.input) {
      body.input = addKodeBridgeMessage(body.input, true)
    }

    // Remove unsupported parameters for Codex
    delete body.max_output_tokens
    delete body.max_completion_tokens
    delete body.temperature // Codex doesn't use temperature
    delete body.top_p
    delete body.frequency_penalty
    delete body.presence_penalty
    delete body.previous_response_id // Not needed for stateless API
    // Note: Keep tools, tool_choice, parallel_tool_calls - Codex supports them

    debugLogger.api('CODEX_RAW_REQUEST_PREFORMATTED', {
      originalModel: requestBody.model,
      normalizedModel: body.model,
      hasInput: !!body.input,
      inputLength: body.input?.length,
      hasInstructions: !!body.instructions,
      reasoning: body.reasoning,
      textVerbosity: body.text?.verbosity,
    })
  } else {
    // Request needs full transformation (e.g., from Chat Completions format)
    // Fetch official instructions from GitHub
    const normalizedModel = normalizeCodexModel(requestBody.model)
    const codexInstructions = await getCodexInstructions(normalizedModel)

    body = transformCodexRequestBody(
      requestBody as CodexRequestBody,
      codexInstructions
    )
  }

  // Create headers
  const headers = createCodexHeaders(credentials.accessToken, credentials.accountId, {
    model: body.model,
  })

  // Build URL
  const url = `${CODEX_BASE_URL}${CODEX_URL_PATHS.CODEX_RESPONSES}`

  debugLogger.api('CODEX_RAW_REQUEST', {
    url,
    model: body.model,
    accountId: credentials.accountId,
    streaming: body.stream,
    isPreFormatted,
  })

  // Debug logging (only log keys to avoid leaking sensitive data)
  debugLogger.api('CODEX_RAW_REQUEST_KEYS', Object.keys(body))

  // Make request with timeout (use provided signal or create timeout)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000) // 60 second timeout

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: signal || controller.signal,
    })
    clearTimeout(timeoutId)
  } catch (fetchError) {
    clearTimeout(timeoutId)
    throw fetchError
  }

  // Handle error
  if (!response.ok) {
    return handleCodexErrorResponse(response)
  }

  // For non-streaming, convert SSE to JSON format
  if (!body.stream) {
    return convertSseToJson(response)
  }

  // Return raw response for streaming
  return response
}
