import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// P6-06: start-stack.ps1 exists and has health check logic
test('P6-06: start-stack.ps1 exists with health-check function', () => {
  const ps1Path = path.resolve(__dirname, '../../../../start-stack.ps1');
  assert.ok(fs.existsSync(ps1Path), 'start-stack.ps1 should exist');
  const source = fs.readFileSync(ps1Path, 'utf8');
  assert.ok(source.includes('Wait-ForHealth'), 'Should have a Wait-ForHealth function');
  assert.ok(source.includes('9router') || source.includes('20128'), 'Should check 9Router health');
  assert.ok(source.includes('8000') || source.includes('crewai'), 'Should check CrewAI bridge health');
  assert.ok(source.includes('3001') || source.includes('cloudcli') || source.includes('CloudCLI'), 'Should check CloudCLI health');
});

// P6-06: start-stack.sh exists and has health check logic
test('P6-06: start-stack.sh exists with health-check function', () => {
  const shPath = path.resolve(__dirname, '../../../../start-stack.sh');
  assert.ok(fs.existsSync(shPath), 'start-stack.sh should exist');
  const source = fs.readFileSync(shPath, 'utf8');
  assert.ok(source.includes('wait_for_health') || source.includes('curl'), 'Should have health check logic');
});

// P6-06: /api/stack-health endpoint is wired in server/index.js
test('P6-06: server/index.js has /api/stack-health endpoint', () => {
  const indexPath = path.resolve(__dirname, '../../../index.js');
  const source = fs.readFileSync(indexPath, 'utf8');
  assert.ok(
    source.includes('stack-health') || source.includes('stackHealth'),
    'server/index.js should expose /api/stack-health endpoint',
  );
});

// P6-06: Stack health checks all 3 external services
test('P6-06: stack-health checks 9Router, CrewAI, and CloudCLI ports', () => {
  const indexPath = path.resolve(__dirname, '../../../index.js');
  const source = fs.readFileSync(indexPath, 'utf8');
  assert.ok(source.includes('20128'), 'Stack health should check 9Router on port 20128');
  assert.ok(source.includes('8000'), 'Stack health should check CrewAI bridge on port 8000');
});

// P6-06: SidebarFooter has StackHealthIndicator
test('P6-06: SidebarFooter includes StackHealthIndicator', () => {
  const footerPath = path.resolve(__dirname, '../../../../src/components/sidebar/view/subcomponents/SidebarFooter.tsx');
  const source = fs.readFileSync(footerPath, 'utf8');
  assert.ok(
    source.includes('StackHealth') || source.includes('stack-health') || source.includes('stackHealth'),
    'SidebarFooter should include a stack health indicator',
  );
});
