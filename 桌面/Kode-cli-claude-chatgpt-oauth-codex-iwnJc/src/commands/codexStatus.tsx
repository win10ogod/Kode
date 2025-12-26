/**
 * Codex Status Command
 *
 * Shows ChatGPT Codex authentication status
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import type { Command } from '@commands'
import { getCodexOAuthService, isCodexAuthenticated } from '@services/codexOAuth'
import { clearTerminal } from '@utils/terminal'

interface CodexStatusProps {
  onDone: () => void
}

function CodexStatusComponent({ onDone }: CodexStatusProps) {
  const [status, setStatus] = useState<{
    authenticated: boolean
    accountId?: string
    expiresAt?: number
    lastRefresh?: number
  } | null>(null)

  useEffect(() => {
    const checkStatus = () => {
      const service = getCodexOAuthService()
      const authState = service.getAuthState()

      if (authState.isAuthenticated && authState.credentials) {
        setStatus({
          authenticated: true,
          accountId: authState.credentials.accountId,
          expiresAt: authState.credentials.expiresAt,
          lastRefresh: authState.credentials.lastRefresh,
        })
      } else {
        setStatus({ authenticated: false })
      }

      setTimeout(onDone, 3000)
    }

    checkStatus()
  }, [onDone])

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleString()
  }

  const formatRelativeTime = (timestamp: number) => {
    const diff = timestamp - Date.now()
    if (diff < 0) return 'Expired'

    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ${hours % 24}h`
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    return `${minutes}m`
  }

  if (!status) {
    return (
      <Box padding={1}>
        <Text dimColor>Loading...</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ChatGPT Codex Status
        </Text>
      </Box>

      <Box flexDirection="column" gap={1}>
        <Box>
          <Text>Status: </Text>
          {status.authenticated ? (
            <Text color="green">Authenticated</Text>
          ) : (
            <Text color="yellow">Not authenticated</Text>
          )}
        </Box>

        {status.authenticated && (
          <>
            <Box>
              <Text dimColor>Account ID: </Text>
              <Text>{status.accountId?.substring(0, 24)}...</Text>
            </Box>

            {status.expiresAt && (
              <Box>
                <Text dimColor>Token expires: </Text>
                <Text>
                  {formatRelativeTime(status.expiresAt)} ({formatTime(status.expiresAt)})
                </Text>
              </Box>
            )}

            {status.lastRefresh && (
              <Box>
                <Text dimColor>Last refreshed: </Text>
                <Text>{formatTime(status.lastRefresh)}</Text>
              </Box>
            )}
          </>
        )}

        {!status.authenticated && (
          <Box marginTop={1}>
            <Text dimColor>Run </Text>
            <Text color="cyan">/codex-login</Text>
            <Text dimColor> to authenticate with ChatGPT Plus/Pro.</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}

export default () =>
  ({
    type: 'local-jsx',
    name: 'codex-status',
    description: 'Show ChatGPT Codex authentication status',
    isEnabled: true,
    isHidden: false,
    async call(onDone, context) {
      await clearTerminal()
      return <CodexStatusComponent onDone={onDone} />
    },
    userFacingName() {
      return 'codex-status'
    },
  }) satisfies Command
