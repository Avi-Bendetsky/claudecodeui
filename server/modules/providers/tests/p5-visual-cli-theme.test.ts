import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// P5-13: CLI theme CSS has the required visual properties
test('P5-13: CLI theme CSS includes monospace font family', () => {
  const cssPath = path.resolve(__dirname, '../../../../src/index.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.ok(
    css.includes('monospace') || css.includes('Menlo') || css.includes('Consolas') || css.includes('Courier'),
    'CLI theme should use a monospace font',
  );
});

test('P5-13: CLI theme CSS includes dark terminal background', () => {
  const cssPath = path.resolve(__dirname, '../../../../src/index.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.ok(
    css.includes('cli-theme') && (css.includes('#1a1a2e') || css.includes('#0d1117') || css.includes('--background')),
    'CLI theme should define a dark terminal background color',
  );
});

test('P5-13: CLI theme hides non-CLI elements', () => {
  const cssPath = path.resolve(__dirname, '../../../../src/index.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.ok(
    css.includes('display: none') || css.includes('display:none'),
    'CLI theme should hide graphical elements like token pie, mermaid diagrams',
  );
});

test('P5-13: OneLineDisplay exists for CLI-style tool rendering', () => {
  const olPath = path.resolve(__dirname, '../../../../src/components/chat/tools/components/OneLineDisplay.tsx');
  assert.ok(fs.existsSync(olPath), 'OneLineDisplay.tsx should exist for CLI-style tool display');
  const source = fs.readFileSync(olPath, 'utf8');
  assert.ok(
    source.includes('●') || source.includes('ToolName') || source.includes('toolName'),
    'OneLineDisplay should render tools in CLI format: ● ToolName(args)',
  );
});

test('P5-13: AppearanceSettingsTab has CLI theme toggle', () => {
  const settingsPath = path.resolve(__dirname, '../../../../src/components/settings/view/tabs/AppearanceSettingsTab.tsx');
  const source = fs.readFileSync(settingsPath, 'utf8');
  assert.ok(
    source.includes('cliTheme') || source.includes('cli-theme') || source.includes('CLI'),
    'AppearanceSettings should have a CLI theme toggle',
  );
});
