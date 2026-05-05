import { promises as fsPromises } from 'fs';

import express from 'express';
import rateLimit from 'express-rate-limit';

import {
  fetchCrewList,
  fetchAgentList,
  checkCrewAIHealth,
} from '../crewai-bridge-client.js';

export function createHealthRoutes({ installMode }) {
  const router = express.Router();

  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      installMode
    });
  });

  router.get('/api/stack-health', async (req, res) => {
    const checks = {};
    checks.cloudcli = { status: 'ok', port: process.env.SERVER_PORT || 3001 };

    try {
      const routerResp = await fetch('http://localhost:20128', { signal: AbortSignal.timeout(2000) });
      checks.router = { status: routerResp.ok ? 'ok' : 'error', port: 20128 };
    } catch { checks.router = { status: 'offline', port: 20128 }; }

    try {
      const bridgeUrl = process.env.CREWAI_BRIDGE_URL || 'http://localhost:8000';
      const bridgeResp = await fetch(`${bridgeUrl}/health`, { signal: AbortSignal.timeout(2000) });
      checks.crewai_bridge = { status: bridgeResp.ok ? 'ok' : 'error', port: 8000 };
    } catch { checks.crewai_bridge = { status: 'offline', port: 8000 }; }

    const allOk = Object.values(checks).every(c => c.status === 'ok');
    res.json({ status: allOk ? 'ok' : 'degraded', services: checks });
  });

  const openClaudeAgentsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.get('/api/openclaude/agents', openClaudeAgentsLimiter, async (req, res) => {
    const agentsPath = process.env.OCC_AGENTS_PATH;
    if (!agentsPath) return res.json([]);
    try {
      const data = await fsPromises.readFile(agentsPath, 'utf8');
      res.json(JSON.parse(data));
    } catch { res.json([]); }
  });

  router.get('/api/crewai/crews', async (_req, res) => {
    try {
      const crews = await fetchCrewList();
      res.json(crews);
    } catch { res.json([]); }
  });

  router.get('/api/crewai/agents', async (_req, res) => {
    try {
      const agents = await fetchAgentList();
      res.json(agents);
    } catch { res.json([]); }
  });

  router.get('/api/crewai/health', async (_req, res) => {
    const health = await checkCrewAIHealth();
    res.json(health);
  });

  return router;
}
