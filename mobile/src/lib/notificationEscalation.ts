import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { ApiError, api } from './api';
import { isWeb } from './platform';
import { getItem, removeItem, setItem } from './storage';

const TASK_NAME = 'medicare-dose-no-response';
const PENDING_KEY = 'medicare.pending_escalations';

export const GUARDIAN_ESCALATION_KIND = 'guardian-escalation';

interface PendingEscalation {
  slotId: number;
  dueAt: string;
}

interface NoResponseResult {
  push: {
    status: 'SENT' | 'PENDING';
  };
}

type NotificationData = Record<string, unknown>;

const inFlight = new Set<number>();

async function loadPending(): Promise<PendingEscalation[]> {
  const raw = await getItem(PENDING_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PendingEscalation =>
        typeof item?.slotId === 'number' && typeof item?.dueAt === 'string',
    );
  } catch {
    return [];
  }
}

async function savePending(items: PendingEscalation[]): Promise<void> {
  if (items.length === 0) {
    await removeItem(PENDING_KEY);
    return;
  }
  await setItem(PENDING_KEY, JSON.stringify(items));
}

export async function rememberGuardianEscalation(slotId: number, dueAt: Date): Promise<void> {
  const pending = (await loadPending()).filter((item) => item.slotId !== slotId);
  pending.push({ slotId, dueAt: dueAt.toISOString() });
  await savePending(pending);
}

export async function forgetGuardianEscalation(slotId: number): Promise<void> {
  const pending = await loadPending();
  await savePending(pending.filter((item) => item.slotId !== slotId));
}

async function reportNoResponse(slotId: number): Promise<boolean> {
  if (inFlight.has(slotId)) return false;
  inFlight.add(slotId);
  try {
    const result = await api.post<NoResponseResult>(
      `/patients/me/dose-slots/${slotId}/no-response`,
    );
    // 보호자 토큰이 아직 없거나 Expo 전송이 실패했다면 다음 실행 때 다시 시도합니다.
    if (result.push.status !== 'SENT') return false;
    await forgetGuardianEscalation(slotId);
    return true;
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404 || error.status === 409)
    ) {
      // 이미 복용했거나 더 이상 유효하지 않은 회차는 재시도하지 않습니다.
      await forgetGuardianEscalation(slotId);
      return true;
    }
    return false;
  } finally {
    inFlight.delete(slotId);
  }
}

export async function flushDueGuardianEscalations(now = new Date()): Promise<void> {
  if (isWeb) return;
  const pending = await loadPending();
  const due = pending.filter((item) => new Date(item.dueAt).getTime() <= now.getTime());
  await Promise.all(due.map((item) => reportNoResponse(item.slotId)));
}

function notificationDataFromTask(payload: Notifications.NotificationTaskPayload): NotificationData {
  if ('actionIdentifier' in payload) {
    return payload.notification.request.content.data ?? {};
  }

  if (typeof payload.data?.dataString === 'string') {
    try {
      const parsed = JSON.parse(payload.data.dataString) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as NotificationData) : {};
    } catch {
      return {};
    }
  }

  const notification = payload.notification as
    | { request?: { content?: { data?: NotificationData } } }
    | null;
  return notification?.request?.content?.data ?? payload.data ?? {};
}

export async function handleGuardianEscalationData(data: NotificationData): Promise<boolean> {
  if (data.medicareKind !== GUARDIAN_ESCALATION_KIND) return false;
  const slotId = Number(data.medicareSlotId);
  if (!Number.isInteger(slotId) || slotId <= 0) return false;
  return reportNoResponse(slotId);
}

if (!isWeb && !TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(TASK_NAME, async ({ data, error }) => {
    if (error) return Notifications.BackgroundNotificationTaskResult.Failed;
    const handled = await handleGuardianEscalationData(notificationDataFromTask(data));
    return handled
      ? Notifications.BackgroundNotificationTaskResult.NewData
      : Notifications.BackgroundNotificationTaskResult.NoData;
  });
}

export async function registerGuardianEscalationTask(): Promise<void> {
  if (isWeb) return;
  try {
    if (!(await TaskManager.isTaskRegisteredAsync(TASK_NAME))) {
      await Notifications.registerTaskAsync(TASK_NAME);
    }
  } catch {
    // Expo Go나 지원하지 않는 환경에서는 foreground/restart 재처리만 사용합니다.
  }
}
