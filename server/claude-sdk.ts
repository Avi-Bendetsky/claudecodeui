import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Query, SDKMessage, Options as SDKOptions } from '@anthropic-ai/claude-agent-sdk';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { CLAUDE_MODELS } from '../shared/modelConstants.js';
import {
  createNotificationEvent,
  notifyRunFailed,
  notifyRunStopped,
  notifyUserIfEnabled
} from './services/notification-orchestrator.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { createNormalizedMessage } from './shared/utils.js';
import type { WebSocketWriter } from './modules/websocket/services/websocket-writer.service.js';

type ToolApprovalDecision = {
  allow?: boolean;
  cancelled?: boolean;
  message?: string;
  rememberEntry?: string;
  updatedInput?: unknown;
} | null;

type ToolApprovalResolver = {
  (decision: ToolApprovalDecision): void;
  _sessionId?: string | null;
  _toolName?: string;
  _input?: unknown;
  _context?: unknown;
  _receivedAt?: Date;
};

type WaitForApprovalOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  onCancel?: (reason: string) => void;
  onWarning?: (reason: string, meta: Record<string, unknown>) => void;
  metadata?: Record<string, unknown>;
};

type SessionEntry = {
  instance: Query;
  startTime: number;
  status: 'active' | 'aborted';
  tempImagePaths: string[];
  tempDir: string | null;
  writer: WebSocketWriter | null;
};

type QueryOptions = {
  sessionId?: string;
  sessionSummary?: string;
  cwd?: string;
  toolsSettings?: {
    allowedTools?: string[];
    disallowedTools?: string[];
    skipPermissions?: boolean;
    allowedShellCommands?: string[];
  };
  permissionMode?: string;
  model?: string;
  images?: Array<{ data: string }>;
};

type ImageResult = {
  modifiedCommand: string;
  tempImagePaths: string[];
  tempDir: string | null;
};

const activeSessions = new Map<string, SessionEntry>();
const pendingToolApprovals = new Map<string, ToolApprovalResolver>();

const TOOL_APPROVAL_TIMEOUT_MS = parseInt(process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS ?? '', 10) || 55000;

const TOOLS_REQUIRING_INTERACTION = new Set(['AskUserQuestion', 'ExitPlanMode']);

function createRequestId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function waitForToolApproval(requestId: string, options: WaitForApprovalOptions = {}): Promise<ToolApprovalDecision> {
  const { timeoutMs = TOOL_APPROVAL_TIMEOUT_MS, signal, onCancel, onWarning, metadata } = options;

  return new Promise<ToolApprovalDecision>(resolve => {
    let settled = false;

    const finalize = (decision: ToolApprovalDecision): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(decision);
    };

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let warningTimeout: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      pendingToolApprovals.delete(requestId);
      if (timeout) clearTimeout(timeout);
      if (warningTimeout) clearTimeout(warningTimeout);
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    };

    // timeoutMs 0 = wait indefinitely (interactive tools)
    if (timeoutMs > 0) {
      const warningLeadMs = 10000;
      if (timeoutMs > warningLeadMs) {
        warningTimeout = setTimeout(() => {
          onWarning?.('timeout_imminent', { remainingMs: warningLeadMs });
        }, timeoutMs - warningLeadMs);
      }
      timeout = setTimeout(() => {
        onCancel?.('timeout');
        finalize(null);
      }, timeoutMs);
    }

    const abortHandler = (): void => {
      onCancel?.('cancelled');
      finalize({ cancelled: true });
    };

    if (signal) {
      if (signal.aborted) {
        onCancel?.('cancelled');
        finalize({ cancelled: true });
        return;
      }
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    const resolver: ToolApprovalResolver = (decision: ToolApprovalDecision): void => {
      finalize(decision);
    };
    if (metadata) {
      Object.assign(resolver, metadata);
    }
    pendingToolApprovals.set(requestId, resolver);
  });
}

function resolveToolApproval(requestId: string, decision: ToolApprovalDecision): void {
  const resolver = pendingToolApprovals.get(requestId);
  if (resolver) {
    resolver(decision);
  }
}

function matchesToolPermission(entry: string, toolName: string, input: unknown): boolean {
  if (!entry || !toolName) {
    return false;
  }

  if (entry === toolName) {
    return true;
  }

  const bashMatch = entry.match(/^Bash\((.+):\*\)$/);
  if (toolName === 'Bash' && bashMatch) {
    const allowedPrefix = bashMatch[1];
    let command = '';

    if (typeof input === 'string') {
      command = input.trim();
    } else if (input && typeof input === 'object' && typeof (input as Record<string, unknown>).command === 'string') {
      command = ((input as Record<string, string>).command).trim();
    }

    if (!command) {
      return false;
    }

    return command.startsWith(allowedPrefix);
  }

  return false;
}

function mapCliOptionsToSDK(options: QueryOptions = {}): Record<string, unknown> & { allowedTools: string[]; disallowedTools: string[] } {
  const { sessionId, cwd, toolsSettings, permissionMode } = options;

  const sdkOptions: Record<string, unknown> = {};

  // Forward all host env vars (e.g. ANTHROPIC_BASE_URL) to the subprocess.
  // Since SDK 0.2.113, options.env replaces process.env instead of overlaying it.
  sdkOptions.env = { ...process.env };

  // Use CLAUDE_CLI_PATH if explicitly set, otherwise fall back to 'claude' on PATH.
  // The SDK 0.2.113+ looks for a bundled native binary optional dep by default;
  // this fallback ensures users who installed via the official installer still work
  // even when npm prune --production has removed those optional deps.
  sdkOptions.pathToClaudeCodeExecutable = process.env.CLAUDE_CLI_PATH || 'claude';

  // Map working directory
  if (cwd) {
    sdkOptions.cwd = cwd;
  }

  // Map permission mode
  if (permissionMode && permissionMode !== 'default') {
    sdkOptions.permissionMode = permissionMode;
  }

  // Map tool settings
  const settings = toolsSettings || {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false
  };

  // Handle tool permissions
  if (settings.skipPermissions && permissionMode !== 'plan') {
    // When skipping permissions, use bypassPermissions mode
    sdkOptions.permissionMode = 'bypassPermissions';
  }

  let allowedTools = [...(settings.allowedTools || [])];

  // Add plan mode default tools
  if (permissionMode === 'plan') {
    const planModeTools = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'];
    for (const tool of planModeTools) {
      if (!allowedTools.includes(tool)) {
        allowedTools.push(tool);
      }
    }
  }

  sdkOptions.allowedTools = allowedTools;

  // Use the tools preset to make all default built-in tools available (including AskUserQuestion).
  // This was introduced in SDK 0.1.57. Omitting this preserves existing behavior (all tools available),
  // but being explicit ensures forward compatibility and clarity.
  sdkOptions.tools = { type: 'preset', preset: 'claude_code' };

  sdkOptions.disallowedTools = settings.disallowedTools || [];

  // Map model (default to sonnet)
  // Valid models: sonnet, opus, haiku, opusplan, sonnet[1m]
  sdkOptions.model = options.model || CLAUDE_MODELS.DEFAULT;
  // Model logged at query start below

  // Map system prompt configuration
  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code'  // Required to use CLAUDE.md
  };

  // Map setting sources for CLAUDE.md loading
  // This loads CLAUDE.md from project, user (~/.config/claude/CLAUDE.md), and local directories
  sdkOptions.settingSources = ['project', 'user', 'local'];

  // Map resume session
  if (sessionId) {
    sdkOptions.resume = sessionId;
  }

  return sdkOptions as Record<string, unknown> & { allowedTools: string[]; disallowedTools: string[] };
}

function addSession(sessionId: string, queryInstance: Query, tempImagePaths: string[] = [], tempDir: string | null = null, writer: WebSocketWriter | null = null): void {
  activeSessions.set(sessionId, {
    instance: queryInstance,
    startTime: Date.now(),
    status: 'active',
    tempImagePaths,
    tempDir,
    writer
  });
}

function removeSession(sessionId: string): void {
  activeSessions.delete(sessionId);
}

function getSession(sessionId: string): SessionEntry | undefined {
  return activeSessions.get(sessionId);
}

function getAllSessions(): string[] {
  return Array.from(activeSessions.keys());
}

function transformMessage(sdkMessage: SDKMessage): SDKMessage & { parentToolUseId?: string } {
  const msg = sdkMessage as SDKMessage & { parent_tool_use_id?: string | null };
  if (msg.parent_tool_use_id) {
    return {
      ...sdkMessage,
      parentToolUseId: msg.parent_tool_use_id
    };
  }
  return sdkMessage;
}

function extractTokenBudget(resultMessage: SDKMessage): { used: number; total: number } | null {
  const msg = resultMessage as Record<string, unknown>;
  if (msg.type !== 'result' || !msg.modelUsage) {
    return null;
  }

  const modelUsage = msg.modelUsage as Record<string, Record<string, number>>;
  const modelKey = Object.keys(modelUsage)[0];
  const modelData = modelUsage[modelKey];

  if (!modelData) {
    return null;
  }

  // Use cumulative tokens if available (tracks total for the session)
  // Otherwise fall back to per-request tokens
  const inputTokens = modelData.cumulativeInputTokens || modelData.inputTokens || 0;
  const outputTokens = modelData.cumulativeOutputTokens || modelData.outputTokens || 0;
  const cacheReadTokens = modelData.cumulativeCacheReadInputTokens || modelData.cacheReadInputTokens || 0;
  const cacheCreationTokens = modelData.cumulativeCacheCreationInputTokens || modelData.cacheCreationInputTokens || 0;

  // Total used = input + output + cache tokens
  const totalUsed = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;

  // Use configured context window budget from environment (default 160000)
  // This is the user's budget limit, not the model's context window
  const contextWindow = parseInt(process.env.CONTEXT_WINDOW ?? '', 10) || 160000;

  // Token calc logged via token-budget WS event

  return {
    used: totalUsed,
    total: contextWindow
  };
}

async function handleImages(command: string, images: Array<{ data: string }> | undefined, cwd?: string): Promise<ImageResult> {
  const tempImagePaths: string[] = [];
  let tempDir: string | null = null;

  if (!images || images.length === 0) {
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }

  try {
    // Create temp directory in the project directory
    const workingDir = cwd || process.cwd();
    tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    // Save each image to a temp file
    for (const [index, image] of images.entries()) {
      // Extract base64 data and mime type
      const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        console.error('Invalid image data format');
        continue;
      }

      const [, mimeType, base64Data] = matches;
      const extension = mimeType.split('/')[1] || 'png';
      const filename = `image_${index}.${extension}`;
      const filepath = path.join(tempDir, filename);

      // Write base64 data to file
      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempImagePaths.push(filepath);
    }

    // Include the full image paths in the prompt
    let modifiedCommand = command;
    if (tempImagePaths.length > 0 && command && command.trim()) {
      const imageNote = `\n\n[Images provided at the following paths:]\n${tempImagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
      modifiedCommand = command + imageNote;
    }

    // Images processed
    return { modifiedCommand, tempImagePaths, tempDir };
  } catch (error) {
    console.error('Error processing images for SDK:', error);
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }
}

async function cleanupTempFiles(tempImagePaths: string[], tempDir: string | null): Promise<void> {
  if (!tempImagePaths || tempImagePaths.length === 0) {
    return;
  }

  try {
    // Delete individual temp files
    for (const imagePath of tempImagePaths) {
      await fs.unlink(imagePath).catch(err =>
        console.error(`Failed to delete temp image ${imagePath}:`, err)
      );
    }

    // Delete temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(err =>
        console.error(`Failed to delete temp directory ${tempDir}:`, err)
      );
    }

    // Temp files cleaned
  } catch (error) {
    console.error('Error during temp file cleanup:', error);
  }
}

async function loadMcpConfig(cwd?: string): Promise<Record<string, unknown> | null> {
  try {
    const claudeConfigPath = path.join(os.homedir(), '.claude.json');

    // Check if config file exists
    try {
      await fs.access(claudeConfigPath);
    } catch {
      return null;
    }

    let claudeConfig: Record<string, unknown>;
    try {
      const configContent = await fs.readFile(claudeConfigPath, 'utf8');
      claudeConfig = JSON.parse(configContent);
    } catch (error: unknown) {
      console.error('Failed to parse ~/.claude.json:', (error as Error).message);
      return null;
    }

    let mcpServers: Record<string, unknown> = {};

    // Add global MCP servers
    if (claudeConfig.mcpServers && typeof claudeConfig.mcpServers === 'object') {
      mcpServers = { ...claudeConfig.mcpServers };
      // Global MCP servers loaded
    }

    // Add/override with project-specific MCP servers
    if (claudeConfig.claudeProjects && cwd) {
      const projectConfig = (claudeConfig.claudeProjects as Record<string, Record<string, unknown>>)[cwd];
      if (projectConfig && projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object') {
        mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
        // Project MCP servers merged
      }
    }

    // Return null if no servers found
    if (Object.keys(mcpServers).length === 0) {
      return null;
    }
    return mcpServers;
  } catch (error: unknown) {
    console.error('Error loading MCP config:', (error as Error).message);
    return null;
  }
}

async function queryClaudeSDK(command: string, options: QueryOptions = {}, ws: WebSocketWriter): Promise<void> {
  const { sessionId, sessionSummary } = options;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let tempImagePaths: string[] = [];
  let tempDir: string | null = null;

  const emitNotification = (event: Record<string, unknown>): void => {
    notifyUserIfEnabled({
      userId: ws?.userId || null,
      writer: ws,
      event
    });
  };

  try {
    // Map CLI options to SDK format
    const sdkOptions = mapCliOptionsToSDK(options);

    // Load MCP configuration
    const mcpServers = await loadMcpConfig(options.cwd);
    if (mcpServers) {
      (sdkOptions as Record<string, unknown>).mcpServers = mcpServers;
    }

    // Handle images - save to temp files and modify prompt
    const imageResult = await handleImages(command, options.images, options.cwd);
    const finalCommand = imageResult.modifiedCommand;
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;

    sdkOptions.hooks = {
      Notification: [{
        matcher: '',
        hooks: [async (input: Record<string, unknown>) => {
          const message = typeof input?.message === 'string' ? input.message : 'Claude requires your attention.';
          emitNotification(createNotificationEvent({
            provider: 'claude',
            sessionId: capturedSessionId || sessionId || null,
            kind: 'action_required',
            code: 'agent.notification',
            meta: { message, sessionName: sessionSummary },
            severity: 'warning',
            requiresUserAction: true,
            dedupeKey: `claude:hook:notification:${capturedSessionId || sessionId || 'none'}:${message}`
          }));
          return {};
        }]
      }]
    };

    (sdkOptions as Record<string, unknown>).canUseTool = async (toolName: string, input: unknown, context?: { signal?: AbortSignal }) => {
      const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);

      if (!requiresInteraction) {
        if (sdkOptions.permissionMode === 'bypassPermissions') {
          return { behavior: 'allow', updatedInput: input };
        }

        const isDisallowed = (sdkOptions.disallowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isDisallowed) {
          return { behavior: 'deny', message: 'Tool disallowed by settings' };
        }

        const isAllowed = (sdkOptions.allowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isAllowed) {
          return { behavior: 'allow', updatedInput: input };
        }
      }

      const requestId = createRequestId();
      ws.send(createNormalizedMessage({ kind: 'permission_request', requestId, toolName, input, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
      emitNotification(createNotificationEvent({
        provider: 'claude',
        sessionId: capturedSessionId || sessionId || null,
        kind: 'action_required',
        code: 'permission.required',
        meta: { toolName, sessionName: sessionSummary },
        severity: 'warning',
        requiresUserAction: true,
        dedupeKey: `claude:permission:${capturedSessionId || sessionId || 'none'}:${requestId}`
      }));

      const decision = await waitForToolApproval(requestId, {
        timeoutMs: requiresInteraction ? 0 : undefined,
        signal: context?.signal,
        metadata: {
          _sessionId: capturedSessionId || sessionId || null,
          _toolName: toolName,
          _input: input,
          _receivedAt: new Date(),
        },
        onCancel: (reason) => {
          ws.send(createNormalizedMessage({ kind: 'permission_cancelled', requestId, reason, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        },
        onWarning: (reason, meta) => {
          ws.send(createNormalizedMessage({ kind: 'permission_warning', requestId, reason, meta, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        }
      });
      if (!decision) {
        return { behavior: 'deny', message: 'Permission request timed out' };
      }

      if (decision.cancelled) {
        return { behavior: 'deny', message: 'Permission request cancelled' };
      }

      if (decision.allow) {
        if (decision.rememberEntry && typeof decision.rememberEntry === 'string') {
          if (!sdkOptions.allowedTools.includes(decision.rememberEntry)) {
            sdkOptions.allowedTools.push(decision.rememberEntry);
          }
          if (Array.isArray(sdkOptions.disallowedTools)) {
            sdkOptions.disallowedTools = sdkOptions.disallowedTools.filter(entry => entry !== decision.rememberEntry);
          }
        }
        return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
      }

      return { behavior: 'deny', message: decision.message ?? 'User denied tool use' };
    };

    // Set stream-close timeout for interactive tools (Query constructor reads it synchronously). Claude Agent SDK has a default of 5s and this overrides it
    const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';

    let queryInstance: Query;
    try {
      queryInstance = query({
        prompt: finalCommand,
        options: sdkOptions as SDKOptions
      });
    } catch (hookError: unknown) {
      console.warn('Failed to initialize Claude query with hooks, retrying without hooks:', (hookError as Error)?.message || hookError);
      delete sdkOptions.hooks;
      queryInstance = query({
        prompt: finalCommand,
        options: sdkOptions as SDKOptions
      });
    }

    // Restore immediately — Query constructor already captured the value
    if (prevStreamTimeout !== undefined) {
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
    } else {
      delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    }

    // Track the query instance for abort capability
    if (capturedSessionId) {
      addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir, ws);
    }

    // Process streaming messages
    console.log('Starting async generator loop for session:', capturedSessionId || 'NEW');
    for await (const message of queryInstance) {
      // Capture session ID from first message
      if (message.session_id && !capturedSessionId) {

        capturedSessionId = message.session_id;
        addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir, ws);

        // Set session ID on writer
        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(capturedSessionId);
        }

        // Send session-created event only once for new sessions
        if (!sessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
          ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'claude' }));
        }
      } else {
        // session_id already captured
      }

      // Transform and normalize message via adapter
      const transformedMessage = transformMessage(message);
      const sid = capturedSessionId || sessionId || null;

      // Use adapter to normalize SDK events into NormalizedMessage[]
      const normalized = sessionsService.normalizeMessage('claude', transformedMessage, sid);
      for (const msg of normalized) {
        // Preserve parentToolUseId from SDK wrapper for subagent tool grouping
        if (transformedMessage.parentToolUseId && !msg.parentToolUseId) {
          msg.parentToolUseId = transformedMessage.parentToolUseId;
        }
        ws.send(msg);
      }

      // Extract and send token budget updates from result messages
      if (message.type === 'result') {
        const models = Object.keys(message.modelUsage || {});
        if (models.length > 0) {
          // Model info available in result message
        }
        const tokenBudgetData = extractTokenBudget(message);
        if (tokenBudgetData) {
          ws.send(createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: tokenBudgetData, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        }
      }
    }

    // Clean up session on completion
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Clean up temporary image files
    await cleanupTempFiles(tempImagePaths, tempDir);

    // Send completion event
    ws.send(createNormalizedMessage({ kind: 'complete', exitCode: 0, isNewSession: !sessionId && !!command, sessionId: capturedSessionId, provider: 'claude' }));
    notifyRunStopped({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || sessionId || null,
      sessionName: sessionSummary,
      stopReason: 'completed'
    });
    // Complete

  } catch (error: unknown) {
    console.error('SDK query error:', error);

    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    await cleanupTempFiles(tempImagePaths, tempDir);

    const installed = await providerAuthService.isProviderInstalled('claude');
    const errorContent = !installed
      ? 'Claude Code is not installed. Please install it first: https://docs.anthropic.com/en/docs/claude-code'
      : (error as Error).message;

    // Send error to WebSocket
    ws.send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
    notifyRunFailed({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || sessionId || null,
      sessionName: sessionSummary,
      error
    });
  }
}

async function abortClaudeSDKSession(sessionId: string): Promise<boolean> {
  const session = getSession(sessionId);

  if (!session) {
    console.log(`Session ${sessionId} not found`);
    return false;
  }

  try {
    console.log(`Aborting SDK session: ${sessionId}`);

    // Call interrupt() on the query instance
    await session.instance.interrupt();

    // Update session status
    session.status = 'aborted';

    // Clean up temporary image files
    await cleanupTempFiles(session.tempImagePaths, session.tempDir);

    // Clean up session
    removeSession(sessionId);

    return true;
  } catch (error) {
    console.error(`Error aborting session ${sessionId}:`, error);
    return false;
  }
}

function isClaudeSDKSessionActive(sessionId: string): boolean {
  const session = getSession(sessionId);
  return !!session && session.status === 'active';
}

function getActiveClaudeSDKSessions(): string[] {
  return getAllSessions();
}

function getPendingApprovalsForSession(sessionId: string) {
  const pending: Array<{
    requestId: string;
    toolName: string;
    input: unknown;
    context: unknown;
    sessionId: string;
    receivedAt: Date;
  }> = [];
  for (const [requestId, resolver] of pendingToolApprovals.entries()) {
    if (resolver._sessionId === sessionId) {
      pending.push({
        requestId,
        toolName: resolver._toolName || 'UnknownTool',
        input: resolver._input,
        context: resolver._context,
        sessionId,
        receivedAt: resolver._receivedAt || new Date(),
      });
    }
  }
  return pending;
}

function reconnectSessionWriter(sessionId: string, newRawWs: import('./shared/types.js').RealtimeClientConnection): boolean {
  const session = getSession(sessionId);
  if (!session?.writer?.updateWebSocket) return false;
  session.writer.updateWebSocket(newRawWs);
  console.log(`[RECONNECT] Writer swapped for session ${sessionId}`);
  return true;
}

export {
  queryClaudeSDK,
  abortClaudeSDKSession,
  isClaudeSDKSessionActive,
  getActiveClaudeSDKSessions,
  resolveToolApproval,
  getPendingApprovalsForSession,
  reconnectSessionWriter
};
