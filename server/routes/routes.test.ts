import { describe, it, expect } from 'vitest';

describe('extracted route modules', () => {
  it('health routes factory returns Express router', async () => {
    const { createHealthRoutes } = await import('./health.js');
    const router = createHealthRoutes({ installMode: 'git' });
    expect(router).toBeDefined();
    expect(typeof router).toBe('function');
  });

  it('system routes factory returns Express router', async () => {
    const { createSystemRoutes } = await import('./system.js');
    const router = createSystemRoutes({ appRoot: '/tmp', installMode: 'git' });
    expect(router).toBeDefined();
    expect(typeof router).toBe('function');
  });

  it('files routes exports default router', async () => {
    const fileRoutes = await import('./files.js');
    expect(fileRoutes.default).toBeDefined();
    expect(typeof fileRoutes.default).toBe('function');
  });
});

describe('health route stack includes expected paths', () => {
  it('registers /health endpoint', async () => {
    const { createHealthRoutes } = await import('./health.js');
    const router = createHealthRoutes({ installMode: 'git' });
    const routes = (router as any).stack
      ?.map((layer: any) => layer.route?.path)
      .filter(Boolean) || [];
    expect(routes).toContain('/health');
  });

  it('registers /api/stack-health endpoint', async () => {
    const { createHealthRoutes } = await import('./health.js');
    const router = createHealthRoutes({ installMode: 'git' });
    const routes = (router as any).stack
      ?.map((layer: any) => layer.route?.path)
      .filter(Boolean) || [];
    expect(routes).toContain('/api/stack-health');
  });

  it('registers crewai health endpoints', async () => {
    const { createHealthRoutes } = await import('./health.js');
    const router = createHealthRoutes({ installMode: 'git' });
    const routes = (router as any).stack
      ?.map((layer: any) => layer.route?.path)
      .filter(Boolean) || [];
    expect(routes).toContain('/api/crewai/health');
    expect(routes).toContain('/api/crewai/crews');
    expect(routes).toContain('/api/crewai/agents');
  });
});
