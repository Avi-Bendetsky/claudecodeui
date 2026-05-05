type NotificationEventInput = {
  provider: string;
  sessionId?: string | null;
  kind?: string;
  code?: string;
  meta?: Record<string, unknown>;
  severity?: string;
  dedupeKey?: string | null;
  requiresUserAction?: boolean;
};

type NotifyInput = {
  userId?: string | number | null;
  provider?: string;
  sessionId?: string | null;
  sessionName?: string;
  stopReason?: string;
  error?: unknown;
  writer?: unknown;
  event?: unknown;
};

export function createNotificationEvent(input: NotificationEventInput): Record<string, unknown>;
export function notifyRunFailed(input: NotifyInput): void;
export function notifyRunStopped(input: NotifyInput): void;
export function notifyUserIfEnabled(input: NotifyInput): void;
