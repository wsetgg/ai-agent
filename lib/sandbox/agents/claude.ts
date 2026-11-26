import { Sandbox } from '@vercel/sandbox'
import { runCommandInSandbox, runInProject, PROJECT_DIR } from '../commands'
import { AgentExecutionResult } from '../types'
import { redactSensitiveInfo } from '@/lib/utils/logging'
import { TaskLogger } from '@/lib/utils/task-logger'
import { connectors, taskMessages } from '@/lib/db/schema'
import { db } from '@/lib/db/client'
import { eq } from 'drizzle-orm'
import { generateId } from '@/lib/utils/id'

type Connector = typeof connectors.$inferSelect

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

// Helper function to run command and collect logs in project directory
async function runAndLogCommand(sandbox: Sandbox, command: string, args: string[], logger: TaskLogger) {
  const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command
  const redactedCommand = redactSensitiveInfo(fullCommand)

  // Log to both local logs and database if logger is provided
  await logger.command(redactedCommand)
  if (logger) {
    await logger.command(redactedCommand)
  }

  const result = await runInProject(sandbox, command, args)

  // Only try to access properties if result is valid
  if (result && result.output && result.output.trim()) {
    const redactedOutput = redactSensitiveInfo(result.output.trim())
    await logger.info(redactedOutput)
    if (logger) {
      await logger.info(redactedOutput)
    }
  }

  if (result && !result.success && result.error) {
    const redactedError = redactSensitiveInfo(result.error)
    await logger.error(redactedError)
    if (logger) {
      await logger.error(redactedError)
    }
  }

  // If result is null/undefined, create a fallback result
  if (!result) {
    const errorResult = {
      success: false,
      error: 'Command execution failed - no result returned',
      exitCode: -1,
      output: '',
      command: redactedCommand,
    }
    await logger.error('Command execution failed - no result returned')
    if (logger) {
      await logger.error('Command execution failed - no result returned')
    }
    return errorResult
  }

  return result
}

export async function installClaudeCLI(
  sandbox: Sandbox,
  logger: TaskLogger,
  selectedModel?: string,
  mcpServers?: Connector[],
): Promise<{ success: boolean }> {
  // Check if Claude CLI is already installed (for resumed sandboxes)
  const existingCLICheck = await runCommandInSandbox(sandbox, 'which', ['claude'])

  let claudeInstall: { success: boolean; output?: string; error?: string } = { success: true }

  if (existingCLICheck.success && existingCLICheck.output?.includes('claude')) {
    // CLI already installed, skip installation
    await logger.info('Claude CLI already installed, skipping installation')
  } else {
    // Install Claude CLI
    await logger.info('Installing Claude CLI...')
    claudeInstall = await runCommandInSandbox(sandbox, 'sh', ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'])
  }

  if (claudeInstall.success) {
    await logger.info('Claude CLI installed successfully')

    // Claude Code reads ANTHROPIC_API_KEY directly and sends requests to api.anthropic.com.
    const apiKey = process.env.ANTHROPIC_API_KEY

    if (apiKey) {
      await logger.info('Claude CLI will use direct Anthropic API authentication')

      if (mcpServers && mcpServers.length > 0) {
        await logger.info('Adding MCP servers')

        for (const server of mcpServers) {
          const serverName = server.name.toLowerCase().replace(/[^a-z0-9]/g, '-')

          if (server.type === 'local') {
            // Local STDIO server - command string contains both executable and args
            const envPrefix = `ANTHROPIC_API_KEY=${shellQuote(apiKey)}`
            let addMcpCmd = `${envPrefix} claude mcp add "${serverName}" -- ${server.command}`

            // Add env vars if provided
            if (server.env && Object.keys(server.env).length > 0) {
              const envVars = Object.entries(server.env)
                .map(([key, value]) => `--env ${key}="${value}"`)
                .join(' ')
              addMcpCmd = addMcpCmd.replace(' --', ` ${envVars} --`)
            }

            const addResult = await runCommandInSandbox(sandbox, 'sh', ['-c', addMcpCmd])

            if (addResult.success) {
              await logger.info('Successfully added local MCP server')
            } else {
              const redactedError = redactSensitiveInfo(addResult.error || 'Unknown error')
              await logger.info('Failed to add MCP server')
            }
          } else {
            // Remote HTTP/SSE server
            const envPrefix = `ANTHROPIC_API_KEY=${shellQuote(apiKey)}`
            let addMcpCmd = `${envPrefix} claude mcp add --transport http "${serverName}" "${server.baseUrl}"`

            if (server.oauthClientSecret) {
              addMcpCmd += ` --header "Authorization: Bearer ${server.oauthClientSecret}"`
            }

            if (server.oauthClientId) {
              addMcpCmd += ` --header "X-Client-ID: ${server.oauthClientId}"`
            }

            const addResult = await runCommandInSandbox(sandbox, 'sh', ['-c', addMcpCmd])

            if (addResult.success) {
              await logger.info('Successfully added remote MCP server')
            } else {
              const redactedError = redactSensitiveInfo(addResult.error || 'Unknown error')
              await logger.info('Failed to add MCP server')
            }
          }
        }
      }

      // Remove the legacy gateway config written by older versions of this app.
      await runCommandInSandbox(sandbox, 'sh', ['-c', 'rm -f "$HOME/.config/claude/config.json"'])
      await logger.info('Claude CLI configured for direct Anthropic API access')
    } else {
      await logger.error('ANTHROPIC_API_KEY is not available to the Claude sandbox setup')
    }

    return { success: true }
  } else {
    await logger.info('Failed to install Claude CLI')
    return { success: false }
  }
}

export async function executeClaudeInSandbox(
  sandbox: Sandbox,
  instruction: string,
  logger: TaskLogger,
  selectedModel?: string,
  mcpServers?: Connector[],
  isResumed?: boolean,
  sessionId?: string,
  taskId?: string,
  agentMessageId?: string,
): Promise<AgentExecutionResult> {
  let extractedSessionId: string | undefined
  try {
    // Executing Claude CLI with instruction

    // Check if Claude CLI is available and get version info
    const cliCheck = await runAndLogCommand(sandbox, 'which', ['claude'], logger)

    if (cliCheck.success) {
      // Get Claude CLI version for debugging
      await runAndLogCommand(sandbox, 'claude', ['--version'], logger)
      // Also try to see what commands are available
      await runAndLogCommand(sandbox, 'claude', ['--help'], logger)
    }

    if (!cliCheck.success) {
      // Claude CLI not found, try to install it
      // Claude CLI not found, installing
      const installResult = await installClaudeCLI(sandbox, logger, selectedModel, mcpServers)

      if (!installResult.success) {
        return {
          success: false,
          error: 'Failed to install Claude CLI',
          cliName: 'claude',
          changesDetected: false,
        }
      }
      // Claude CLI installed successfully

      // Verify installation worked
      const verifyCheck = await runAndLogCommand(sandbox, 'which', ['claude'], logger)
      if (!verifyCheck.success) {
        return {
          success: false,
          error: 'Claude CLI installation completed but CLI still not found',
          cliName: 'claude',
          changesDetected: false,
        }
      }
    }

    // Require the direct Anthropic API key configured in Vercel.
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY
    if (!anthropicApiKey) {
      return {
        success: false,
        error: 'ANTHROPIC_API_KEY environment variable is required but not found',
        cliName: 'claude',
        changesDetected: false,
      }
    }

    // Log what we're trying to do
    const requestedModel = selectedModel?.trim()
    const modelToUse =
      requestedModel && (/^(sonnet|opus|haiku)$/i.test(requestedModel) || /^claude-/i.test(requestedModel))
        ? requestedModel
        : 'sonnet'
    if (logger) {
      await logger.info('Attempting to execute Claude CLI...')
    }

    // Check MCP configuration status
    const envPrefix = `ANTHROPIC_API_KEY=${shellQuote(anthropicApiKey)}`
    const mcpList = await runCommandInSandbox(sandbox, 'sh', ['-c', `${envPrefix} claude mcp list`])
    await logger.info('MCP servers list retrieved')
    if (mcpList.error) {
      await logger.info('MCP list error occurred')
    }

    // Create initial empty agent message in database if streaming
    if (taskId && agentMessageId) {
      await db.insert(taskMessages).values({
        id: agentMessageId,
        taskId,
        role: 'agent',
        content: '',
        createdAt: new Date(),
      })
    }

    // Build command with stream-json output format for streaming
    // Bound API spend and agentic loops for every task. The budget is a
    // Claude Code client-side estimate (not a hard billing guarantee); keep it
    // conservative and configurable without requiring a code change.
    const configuredBudget = Number(process.env.CLAUDE_MAX_BUDGET_USD || '0.10')
    const maxBudgetUsd = Number.isFinite(configuredBudget) && configuredBudget > 0 ? Math.min(configuredBudget, 1) : 0.1
    const maxTurns = 5
    await logger.info(`Claude cost guard enabled: max $ ${maxBudgetUsd.toFixed(2)} estimated spend, ${maxTurns} turns`)

    let fullCommand = `${envPrefix} claude -p --max-turns ${maxTurns} --max-budget-usd ${maxBudgetUsd.toFixed(2)} --model ${shellQuote(modelToUse)} --dangerously-skip-permissions --output-format stream-json --verbose`

    // Add --resume flag for follow-up messages in kept-alive sandboxes
    if (isResumed) {
      if (sessionId) {
        fullCommand += ` --resume ${shellQuote(sessionId)}`
        if (logger) {
          await logger.info('Resuming specific Claude chat session')
        }
      } else {
        fullCommand += ` --resume`
        if (logger) {
          await logger.info('Resuming previous Claude conversation')
        }
      }
    }

    fullCommand += ` ${shellQuote(instruction)}`

    if (logger) {
      await logger.info('Executing Claude CLI with --dangerously-skip-permissions for automated file changes...')
    }

    // Log the command we're about to execute (with redacted API key)
    const redactedCommand = fullCommand.replace(anthropicApiKey, '[REDACTED]')
    await logger.command(redactedCommand)

    // Capture output to files inside the sandbox. The SDK stdout() accessor has
    // intermittently returned an unavailable stream in production despite a zero
    // exit code. File capture prevents losing the completed Claude response.
    const captureId = agentMessageId || generateId()
    const outputPath = PROJECT_DIR + '/.claude-output-' + captureId + '.jsonl'
    const errorPath = PROJECT_DIR + '/.claude-error-' + captureId + '.log'
    const commandWithOutputFiles = fullCommand + ' > ' + shellQuote(outputPath) + ' 2> ' + shellQuote(errorPath)

    const commandResult = await sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', commandWithOutputFiles],
      sudo: false,
      cwd: PROJECT_DIR,
    })

    let capturedOutput = ''
    let capturedError = ''
    try {
      // Read captured files through the Sandbox file API instead of Command.stdout().
      // stdout()/stderr() depend on the command log stream, which can be unavailable
      // after a completed command ("Expected a stream of logs").
      const outputFile = await sandbox.readFileToBuffer({ path: outputPath })
      if (outputFile) capturedOutput = outputFile.toString('utf8')
      else await logger.error('Claude output file could not be read')
    } catch (readError) {
      await logger.error(
        'Unable to read Claude output file: ' + (readError instanceof Error ? readError.message : 'unknown error'),
      )
    }
    try {
      const errorFile = await sandbox.readFileToBuffer({ path: errorPath })
      if (errorFile) capturedError = errorFile.toString('utf8')
    } catch {
      // An empty stderr file may not be present on some sandbox images.
    }

    // Clean up captured output so it cannot be committed with the user's changes.
    await sandbox.runCommand({
      cmd: 'rm',
      args: ['-f', outputPath, errorPath],
      cwd: PROJECT_DIR,
    })

    if (commandResult.exitCode !== 0) {
      const detail =
        capturedError.trim() || capturedOutput.trim() || 'Claude CLI exited with code ' + commandResult.exitCode
      await logger.error(redactSensitiveInfo(detail))
      throw new Error(detail)
    }

    // Parse Claude's stream-json output, including the final result event.
    let accumulatedContent = ''
    let finalResult = ''
    if (agentMessageId && taskId) {
      for (const line of capturedOutput.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed)
          if (parsed.type === 'assistant' && parsed.message?.content) {
            for (const contentBlock of parsed.message.content) {
              if (contentBlock.type === 'text' && contentBlock.text) {
                accumulatedContent += contentBlock.text
              } else if (contentBlock.type === 'tool_use') {
                const input = contentBlock.input || {}
                let statusMsg = ''
                if (contentBlock.name === 'Write' || contentBlock.name === 'Edit' || contentBlock.name === 'Read') {
                  statusMsg =
                    (contentBlock.name === 'Read' ? 'Reading' : 'Editing') +
                    ' ' +
                    (input.path || input.file_path || 'file')
                } else if (contentBlock.name === 'Glob') {
                  statusMsg = 'Searching files: ' + (input.pattern || '*')
                } else if (contentBlock.name === 'Bash') {
                  const command = input.command || 'command'
                  statusMsg = 'Running: ' + (command.length > 50 ? command.substring(0, 50) + '...' : command)
                } else if (contentBlock.name === 'Grep') {
                  statusMsg = 'Grep: ' + (input.pattern || 'pattern')
                }
                if (statusMsg) accumulatedContent += '\n\n' + statusMsg + '\n\n'
              }
            }
          } else if (parsed.type === 'result') {
            if (parsed.session_id) extractedSessionId = parsed.session_id
            if (typeof parsed.result === 'string') finalResult = parsed.result
          }
        } catch {
          // Ignore non-JSON lines emitted by the CLI.
        }
      }

      const responseContent = accumulatedContent.trim() || finalResult.trim()
      await db
        .update(taskMessages)
        .set({
          content:
            responseContent ||
            'Claude finished without returning readable response text. This task is marked as failed so it can be retried safely.',
        })
        .where(eq(taskMessages.id, agentMessageId))

      if (!responseContent) {
        throw new Error('Claude exited without readable response text; refusing to mark the task successful.')
      }
    } else if (!capturedOutput.trim()) {
      throw new Error('Claude exited without producing output.')
    }
    await logger.info('Claude completed successfully')

    // Check if any files were modified
    const gitStatusCheck = await runAndLogCommand(sandbox, 'git', ['status', '--porcelain'], logger)

    const hasChanges = gitStatusCheck.success && gitStatusCheck.output?.trim()

    // Log additional debugging info if no changes were made
    if (!hasChanges) {
      await logger.info('No changes detected. Checking if files exist...')

      // Check if common files exist
      await runAndLogCommand(sandbox, 'find', ['.', '-name', 'README*', '-o', '-name', 'readme*'], logger)
      await runAndLogCommand(sandbox, 'ls', ['-la'], logger)
    }

    return {
      success: true,
      output: `Claude CLI executed successfully${hasChanges ? ' (Changes detected)' : ' (No changes made)'}`,
      // Don't include agentResponse when streaming to DB to prevent duplicate display
      agentResponse: agentMessageId ? undefined : capturedOutput || 'No detailed response available',
      cliName: 'claude',
      changesDetected: !!hasChanges,
      error: undefined,
      sessionId: extractedSessionId, // Include session ID for resumption
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to execute Claude CLI in sandbox'
    return {
      success: false,
      error: errorMessage,
      cliName: 'claude',
      changesDetected: false,
    }
  }
}
