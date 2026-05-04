import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CSS_PATH = path.resolve('src/index.css');
const ONE_LINE_PATH = path.resolve('src/components/chat/tools/components/OneLineDisplay.tsx');
const CHAT_INTERFACE_PATH = path.resolve('src/components/chat/view/ChatInterface.tsx');

test('P5-08: Ctrl+L clear shortcut exists in ChatInterface', () => {
  const source = fs.readFileSync(CHAT_INTERFACE_PATH, 'utf8');
  assert.ok(
    source.includes("key === 'l'") || source.includes('Ctrl+L') || source.includes('ctrlKey'),
    'ChatInterface should have Ctrl+L clear shortcut',
  );
});

test('P5-10: Slash command palette toggle exists', () => {
  const composer = fs.readFileSync(
    path.resolve('src/components/chat/view/subcomponents/ChatComposer.tsx'),
    'utf8',
  );
  assert.ok(
    composer.includes('onToggleCommandMenu') && composer.includes('isCommandMenuOpen'),
    'ChatComposer should have slash command palette',
  );
});

test('P5-11: Card theme (non-CLI) still has border-l-2 styling', () => {
  const source = fs.readFileSync(ONE_LINE_PATH, 'utf8');
  assert.ok(
    source.includes('border-l-2'),
    'OneLineDisplay should still have border-l-2 for card theme',
  );
});

test('P5-12: CLI theme CSS exists and does not break base layout', () => {
  const source = fs.readFileSync(CSS_PATH, 'utf8');
  const cliIdx = source.indexOf('.cli-theme');
  assert.ok(cliIdx !== -1, 'CSS should contain .cli-theme section');
  const cliSection = source.slice(cliIdx);
  assert.ok(!cliSection.includes('position: fixed !important'), 'CLI theme should not force fixed positioning');
  assert.ok(!cliSection.includes('display: flex !important'), 'CLI theme should not force flex on layout elements');
});
