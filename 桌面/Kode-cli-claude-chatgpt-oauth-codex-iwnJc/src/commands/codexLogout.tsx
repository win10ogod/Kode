/**
 * Codex Logout Command
 *
 * Logs out from ChatGPT Plus/Pro OAuth
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import type { Command } from '@commands'
import { getCodexOAuthService, isCodexAuthenticated } from '@services/codexOAuth'
import { clearTerminal } from '@utils/terminal'

interface CodexLogoutProps {
  onDone: () => void
}

function CodexLogoutComponent({ onDone }: CodexLogoutProps) {
  const [done, setDone] = useState(false)
  const [wasAuthenticated, setWasAuthenticated] = useState(false)

  useEffect(() => {
    const performLogout = () => {
      const service = getCodexOAuthService()
      const wasAuth = isCodexAuthenticated()
      setWasAuthenticated(wasAuth)

      if (wasAuth) {
        service.logout()
      }

      setDone(true)
      setTimeout(onDone, 1500)
    }

    performLogout()
  }, [onDone])

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ChatGPT Codex Logout
        </Text>
      </Box>

      {done && (
        <Box flexDirection="column">
          {wasAuthenticated ? (
            <>
              <Box>
                <Text color="green">Successfully logged out from ChatGPT Codex.</Text>
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Your OAuth tokens have been cleared.</Text>
              </Box>
            </>
          ) : (
            <Box>
              <Text dimColor>You were not logged in to ChatGPT Codex.</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

export default () =>
  ({
    type: 'local-jsx',
    name: 'codex-logout',
    description: 'Sign out from ChatGPT Codex',
    isEnabled: true,
    isHidden: !isCodexAuthenticated(), // Hide if not logged in
    async call(onDone, context) {
      await clearTerminal()
      return <CodexLogoutComponent onDone={onDone} />
    },
    userFacingName() {
      return 'codex-logout'
    },
  }) satisfies Command
