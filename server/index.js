#!/usr/bin/env node
// Load environment variables before other imports execute
import './load-env.js';
import fs from 'fs';
import path from 'path';
import http from 'http';

import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import helmet from 'helmet';

import { AppError } from '@/shared/utils.js';
import { closeSessionsWatcher, initializeSessionsWatcher } from '@/modules/providers/index.js';
import { createWebSocketServer } from '@/modules/websocket/index.js';

import { getConnectableHost } from '../shared/networkHosts.js';

import { findAppRoot, getModuleDir } from './utils/runtime-paths.js';
import {
    queryClaudeSDK,
    abortClaudeSDKSession,
    isClaudeSDKSessionActive,
    getActiveClaudeSDKSessions,
    resolveToolApproval,
    getPendingApprovalsForSession,
    reconnectSessionWriter,
} from './claude-sdk.js';
import {
    spawnCursor,
    abortCursorSession,
    isCursorSessionActive,
    getActiveCursorSessions,
} from './cursor-cli.js';
import {
    queryCodex,
    abortCodexSession,
    isCodexSessionActive,
    getActiveCodexSessions,
} from './openai-codex.js';
import {
    spawnGemini,
    abortGeminiSession,
    isGeminiSessionActive,
    getActiveGeminiSessions,
} from './gemini-cli.js';
import {
    spawnOpenClaude,
    abortOpenClaudeSession,
    isOpenClaudeSessionActive,
    getActiveOpenClaudeSessions,
} from './openclaude-cli.js';
import {
    queryCrewAI,
    abortCrewAISession,
    isCrewAISessionActive,
    getActiveCrewAISessions,
} from './crewai-bridge-client.js';
import sessionManager from './sessionManager.js';
import {
    stripAnsiSequences,
    normalizeDetectedUrl,
    extractUrlsFromText,
    shouldAutoOpenUrlFromOutput,
} from './utils/url-detection.js';
import gitRoutes from './routes/git.js';
import authRoutes from './routes/auth.js';
import cursorRoutes from './routes/cursor.js';
import taskmasterRoutes from './routes/taskmaster.js';
import mcpUtilsRoutes from './routes/mcp-utils.js';
import commandsRoutes from './routes/commands.js';
import settingsRoutes from './routes/settings.js';
import agentRoutes from './routes/agent.js';
import projectModuleRoutes from './modules/projects/projects.routes.js';
import userRoutes from './routes/user.js';
import geminiRoutes from './routes/gemini.js';
import pluginsRoutes from './routes/plugins.js';
import providerRoutes from './modules/providers/provider.routes.js';
import { createHealthRoutes } from './routes/health.js';
import { createSystemRoutes } from './routes/system.js';
import fileRoutes from './routes/files.js';
import { startEnabledPluginServers, stopAllPlugins, getPluginPort } from './utils/plugin-process-manager.js';
import { initializeDatabase } from './modules/database/index.js';
import { configureWebPush } from './services/vapid-keys.js';
import { validateApiKey, authenticateToken, authenticateWebSocket } from './middleware/auth.js';
import { IS_PLATFORM } from './constants/config.js';
import { c } from './utils/colors.js';

const __dirname = getModuleDir(import.meta.url);
// The server source runs from /server, while the compiled output runs from /dist-server/server.
// Resolving the app root once keeps every repo-level lookup below aligned across both layouts.
const APP_ROOT = findAppRoot(__dirname);
const installMode = fs.existsSync(path.join(APP_ROOT, '.git')) ? 'git' : 'npm';

const SERVER_PORT = process.env.SERVER_PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const DISPLAY_HOST = getConnectableHost(HOST);
const VITE_PORT = process.env.VITE_PORT || 5173;

const app = express();
const server = http.createServer(app);

// Single WebSocket server that handles chat, shell, and plugin proxy paths.
const wss = createWebSocketServer(server, {
    verifyClient: {
        isPlatform: IS_PLATFORM,
        authenticateWebSocket,
    },
    chat: {
        queryClaudeSDK,
        spawnCursor,
        queryCodex,
        spawnGemini,
        spawnOpenClaude,
        queryCrewAI,
        abortClaudeSDKSession,
        abortCursorSession,
        abortCodexSession,
        abortGeminiSession,
        abortOpenClaudeSession,
        abortCrewAISession,
        resolveToolApproval,
        isClaudeSDKSessionActive,
        isCursorSessionActive,
        isCodexSessionActive,
        isGeminiSessionActive,
        isOpenClaudeSessionActive,
        isCrewAISessionActive,
        reconnectSessionWriter,
        getPendingApprovalsForSession,
        getActiveClaudeSDKSessions,
        getActiveCursorSessions,
        getActiveCodexSessions,
        getActiveGeminiSessions,
        getActiveOpenClaudeSessions,
        getActiveCrewAISessions,
    },
    shell: {
        getSessionById: (sessionId) => sessionManager.getSession(sessionId),
        stripAnsiSequences,
        normalizeDetectedUrl,
        extractUrlsFromText,
        shouldAutoOpenUrlFromOutput,
    },
    getPluginPort,
});

// Make WebSocket server available to routes
app.locals.wss = wss;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
    origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
        : [
            `http://localhost:${process.env.VITE_PORT || 5173}`,
            `http://localhost:${process.env.SERVER_PORT || 3001}`,
            `http://127.0.0.1:${process.env.VITE_PORT || 5173}`,
            `http://127.0.0.1:${process.env.SERVER_PORT || 3001}`,
        ],
    exposedHeaders: ['X-Refreshed-Token'],
}));
app.use(express.json({
    limit: '50mb',
    type: (req) => {
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
            return false;
        }
        return contentType.includes('json');
    }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

if (process.env.REQUEST_LOGGING !== 'false') {
    app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            const ms = Date.now() - start;
            if (req.path.startsWith('/api/')) {
                console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
            }
        });
        next();
    });
}

// Public routes (no authentication required)
app.use(createHealthRoutes({ installMode }));

// Optional API key validation (if configured)
app.use('/api', validateApiKey);

// Authentication routes (public)
app.use('/api/auth', authRoutes);

// Protected route modules
app.use('/api/projects', authenticateToken, projectModuleRoutes);
app.use('/api/git', authenticateToken, gitRoutes);
app.use('/api/cursor', authenticateToken, cursorRoutes);
app.use('/api/taskmaster', authenticateToken, taskmasterRoutes);
app.use('/api/mcp-utils', authenticateToken, mcpUtilsRoutes);
app.use('/api/commands', authenticateToken, commandsRoutes);
app.use('/api/settings', authenticateToken, settingsRoutes);
app.use('/api/user', authenticateToken, userRoutes);
app.use('/api/gemini', authenticateToken, geminiRoutes);
app.use('/api/plugins', authenticateToken, pluginsRoutes);
app.use('/api/providers', authenticateToken, providerRoutes);
app.use('/api/agent', agentRoutes);

// File operations, uploads, token usage (routes include their own auth)
app.use(fileRoutes);

// System management (routes include their own auth)
app.use(createSystemRoutes({ appRoot: APP_ROOT, installMode }));

// Serve public files (like api-docs.html)
app.use(express.static(path.join(APP_ROOT, 'public')));

// Static files served after API routes
app.use(express.static(path.join(APP_ROOT, 'dist'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else if (filePath.match(/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$/)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
}));

// Serve React app for all other routes (excluding static files)
app.get('*', (req, res) => {
    if (path.extname(req.path)) {
        return res.status(404).send('Not found');
    }

    const indexPath = path.join(APP_ROOT, 'dist', 'index.html');

    if (fs.existsSync(indexPath)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(indexPath);
    } else {
        res.redirect(`${req.protocol}://${DISPLAY_HOST}:${VITE_PORT}`);
    }
});

// Global error middleware must be last
app.use((err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }

  console.error('[ERROR]', err.message || 'Unknown error');
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
});

// Initialize database and start server
async function startServer() {
    try {
        await initializeDatabase();

        configureWebPush();

        const distIndexPath = path.join(APP_ROOT, 'dist', 'index.html');
        const isProduction = fs.existsSync(distIndexPath);

        console.log(`${c.info('[INFO]')} Using Claude Agents SDK for Claude integration`);
        console.log('');

        if (isProduction) {
            console.log(`${c.info('[INFO]')} To run in production mode, go to http://${DISPLAY_HOST}:${SERVER_PORT}`);
        }

        console.log(`${c.info('[INFO]')} To run in development mode with hot-module replacement, go to http://${DISPLAY_HOST}:${VITE_PORT}`);

        server.listen(SERVER_PORT, HOST, async () => {
            const appInstallPath = APP_ROOT;

            console.log('');
            console.log(c.dim('═'.repeat(63)));
            console.log(`  ${c.bright('CloudCLI Server - Ready')}`);
            console.log(c.dim('═'.repeat(63)));
            console.log('');
            console.log(`${c.info('[INFO]')} Server URL:  ${c.bright('http://' + DISPLAY_HOST + ':' + SERVER_PORT)}`);
            console.log(`${c.info('[INFO]')} Installed at: ${c.dim(appInstallPath)}`);
            console.log(`${c.tip('[TIP]')}  Run "cloudcli status" for full configuration details`);
            console.log('');

            await initializeSessionsWatcher();

            startEnabledPluginServers().catch(err => {
                console.error('[Plugins] Error during startup:', err.message);
            });
        });

        await closeSessionsWatcher();

        const gracefulShutdown = async (signal) => {
            console.log(`\n${c.info('[INFO]')} ${signal} received — shutting down…`);
            server.close(() => {
                console.log(`${c.info('[INFO]')} HTTP server closed`);
            });
            wss.clients.forEach((ws) => ws.close(1001, 'Server shutting down'));
            await stopAllPlugins();
            setTimeout(() => process.exit(0), 5000).unref();
        };
        process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
        process.on('unhandledRejection', (reason) => {
            console.error(`${c.error?.('[ERROR]') ?? '[ERROR]'} Unhandled rejection:`, reason);
        });
    } catch (error) {
        console.error('[ERROR] Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
