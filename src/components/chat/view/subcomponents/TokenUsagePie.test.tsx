import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import TokenUsagePie from './TokenUsagePie';

describe('TokenUsagePie', () => {
  it('renders percentage for valid input', () => {
    render(<TokenUsagePie used={50000} total={100000} />);
    expect(screen.getByText('50.0%')).toBeInTheDocument();
  });

  it('returns null when total is 0', () => {
    const { container } = render(<TokenUsagePie used={0} total={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when total is negative', () => {
    const { container } = render(<TokenUsagePie used={10} total={-1} />);
    expect(container.firstChild).toBeNull();
  });

  it('caps percentage at 100%', () => {
    render(<TokenUsagePie used={200000} total={100000} />);
    expect(screen.getByText('100.0%')).toBeInTheDocument();
  });

  it('renders 0% when used is 0 and total is positive', () => {
    render(<TokenUsagePie used={0} total={160000} />);
    expect(screen.getByText('0.0%')).toBeInTheDocument();
  });

  it('shows token count in title attribute', () => {
    render(<TokenUsagePie used={80000} total={160000} />);
    const span = screen.getByText('50.0%');
    expect(span).toHaveAttribute('title', '80,000 / 160,000 tokens');
  });

  it('renders SVG with progress circle', () => {
    const { container } = render(<TokenUsagePie used={50000} total={100000} />);
    const circles = container.querySelectorAll('circle');
    expect(circles).toHaveLength(2);
  });

  it('uses blue stroke for low usage', () => {
    const { container } = render(<TokenUsagePie used={10000} total={100000} />);
    const progressCircle = container.querySelectorAll('circle')[1];
    expect(progressCircle.getAttribute('stroke')).toBe('#3b82f6');
  });

  it('uses orange stroke for moderate usage', () => {
    const { container } = render(<TokenUsagePie used={60000} total={100000} />);
    const progressCircle = container.querySelectorAll('circle')[1];
    expect(progressCircle.getAttribute('stroke')).toBe('#f59e0b');
  });

  it('uses red stroke for high usage', () => {
    const { container } = render(<TokenUsagePie used={80000} total={100000} />);
    const progressCircle = container.querySelectorAll('circle')[1];
    expect(progressCircle.getAttribute('stroke')).toBe('#ef4444');
  });
});
