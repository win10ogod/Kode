/**
 * Codex Login Command
 *
 * Authenticates with ChatGPT Plus/Pro using OAuth
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import type { Command } from '@commands'
import { getCodexOAuthService, isCodexAuthenticated } from '@services/codexOAuth'
import { useExitOnCtrlCD } from '@hooks/useExitOnCtrlCD'
import { clearTerminal } from '@utils/terminal'
import { CODEX_AUTH_LABELS } from '@constants/codexOAuth'

type LoginState = 'idle' | 'waiting' | 'success' | 'error'

interface CodexLoginProps {
  onDone: () => void
}

function CodexLoginComponent({ onDone }: CodexLoginProps) {
  const [state, setState] = useState<LoginState>('idle')
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const exitState = useExitOnCtrlCD(onDone)

  useEffect(() => {
    const startLogin = async () => {
      setState('waiting')

      try {
        const service = getCodexOAuthService()
        const credentials = await service.startOAuthFlow((url) => {
          setAuthUrl(url)
        })

        if (credentials) {
          setState('success')
          setAccountId(credentials.accountId)
          // Auto-close after success
          setTimeout(onDone, 2000)
        } else {
          setState('error')
          setError('Authentication failed or was cancelled')
        }
      } catch (err) {
        setState('error')
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
    }

    startLogin()
  }, [onDone])

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ChatGPT Codex Authentication
        </Text>
      </Box>

      {/* Status */}
      {state === 'waiting' && (
        <Box flexDirection="column" gap={1}>
          <Box>
            <Text color="yellow">...</Text>
            <Text> {CODEX_AUTH_LABELS.INSTRUCTIONS}</Text>
          </Box>

          {authUrl && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>If browser doesn't open, visit:</Text>
              <Text color="blue" wrap="truncate-end">
                {authUrl}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {state === 'success' && (
        <Box flexDirection="column">
          <Box>
            <Text color="green">Successfully authenticated!</Text>
          </Box>
          {accountId && (
            <Box marginTop={1}>
              <Text dimColor>Account ID: {accountId.substring(0, 16)}...</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>You can now use GPT-5/Codex models with your ChatGPT subscription.</Text>
          </Box>
        </Box>
      )}

      {state === 'error' && (
        <Box flexDirection="column">
          <Box>
            <Text color="red">Authentication failed</Text>
          </Box>
          {error && (
            <Box marginTop={1}>
              <Text dimColor>{error}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Press any key to close...</Text>
          </Box>
        </Box>
      )}

      {/* Exit hint */}
      <Box marginTop={2}>
        <Text dimColor>
          {exitState.pending ? (
            <>Press {exitState.keyName} again to exit</>
          ) : (
            ''
          )}
        </Text>
      </Box>
    </Box>
  )
}

export default () =>
  ({
    type: 'local-jsx',
    name: 'codex-login',
    description: isCodexAuthenticated()
      ? 'Switch ChatGPT Codex accounts'
      : 'Sign in with your ChatGPT Plus/Pro account',
    isEnabled: true,
    isHidden: false,
    async call(onDone, context) {
      await clearTerminal()
      return <CodexLoginComponent onDone={onDone} />
    },
    userFacingName() {
      return 'codex-login'
    },
  }) satisfies Command
