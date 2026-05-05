import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ToolStatusBadge, type ToolStatus } from './ToolStatusBadge';

const ALL_STATUSES: ToolStatus[] = [
  'running',
  'completed',
  'error',
  'denied',
  'pending',
  'applied',
  'reverted',
  'failed',
];

describe('ToolStatusBadge', () => {
  it.each(ALL_STATUSES)('renders label for status "%s"', (status) => {
    render(<ToolStatusBadge status={status} />);
    const expected: Record<ToolStatus, string> = {
      running: 'Running',
      completed: 'Completed',
      error: 'Error',
      denied: 'Denied',
      pending: 'Pending',
      applied: 'Applied',
      reverted: 'Reverted',
      failed: 'Failed',
    };
    expect(screen.getByText(expected[status])).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <ToolStatusBadge status="completed" className="my-custom-class" />,
    );
    expect(container.firstChild).toHaveClass('my-custom-class');
  });

  it('renders as a span element', () => {
    const { container } = render(<ToolStatusBadge status="running" />);
    expect(container.firstChild?.nodeName).toBe('SPAN');
  });

  it('applies status-specific color classes', () => {
    const { container } = render(<ToolStatusBadge status="error" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-red');
  });
});
