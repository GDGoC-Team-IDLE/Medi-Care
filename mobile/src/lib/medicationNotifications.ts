import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import {
  GUARDIAN_ESCALATION_KIND,
  forgetGuardianEscalation,
  rememberGuardianEscalation,
  registerGuardianEscalationTask,
} from './notificationEscalation';
import { isAndroid, isWeb } from './platform';

const CHANNELS = {
  initial: 'medication-initial',
  reminder: 'medication-reminder',
  urgent: 'medication-urgent',
} as const;

export interface DoseNotificationInput {
  slotId: number;
  scheduledAt: string | Date;
  slot: 'MORNING' | 'LUNCH' | 'DINNER' | 'BEDTIME';
  expectedCount: number;
}

const SLOT_LABELS: Record<DoseNotificationInput['slot'], string> = {
  MORNING: '아침',
  LUNCH: '점심',
  DINNER: '저녁',
  BEDTIME: '취침 전',
};

const slotLabel = (dose: DoseNotificationInput) => SLOT_LABELS[dose.slot];

interface Stage {
  minutes: number;
  channelId: string;
  title: (dose: DoseNotificationInput) => string;
  body: string;
  guardianEscalation?: boolean;
}

const STAGES: Stage[] = [
  {
    minutes: 0,
    channelId: CHANNELS.initial,
    title: (dose) => `${slotLabel(dose)} 약 ${dose.expectedCount}알 드실 시간이에요`,
    body: '드시기 전에 사진을 찍어 주세요.',
  },
  {
    minutes: 5,
    channelId: CHANNELS.reminder,
    title: (dose) => `${slotLabel(dose)} 약을 확인해 주세요`,
    body: '5분이 지났어요. 약을 드셨다면 사진으로 알려 주세요.',
  },
  {
    minutes: 10,
    channelId: CHANNELS.urgent,
    title: (dose) => `${slotLabel(dose)} 약 알림에 반응이 없어요`,
    body: '10분이 지났어요. 지금 약과 약봉투를 확인해 주세요.',
  },
  {
    minutes: 15,
    channelId: CHANNELS.urgent,
    title: (dose) => `${slotLabel(dose)} 약 복용 확인이 필요해요`,
    body: '15분 동안 반응이 없어 보호자에게 알려요.',
    guardianEscalation: true,
  },
];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

export async function initializeMedicationNotifications(): Promise<void> {
  if (isWeb) return;
  if (isAndroid) {
    await Promise.all([
      Notifications.setNotificationChannelAsync(CHANNELS.initial, {
        name: '복용 시간 알림',
        importance: AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 150, 250],
      }),
      Notifications.setNotificationChannelAsync(CHANNELS.reminder, {
        name: '복용 재알림',
        importance: AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 400, 150, 400],
      }),
      Notifications.setNotificationChannelAsync(CHANNELS.urgent, {
        name: '긴급 복용 알림',
        importance: AndroidImportance.MAX,
        sound: 'default',
        vibrationPattern: [0, 600, 150, 600, 150, 600],
        bypassDnd: false,
      }),
    ]);
  }
  await registerGuardianEscalationTask();
}

export async function requestMedicationNotificationPermissions(): Promise<boolean> {
  if (isWeb) return false;
  await initializeMedicationNotifications();

  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (permission.status !== 'granted') return false;

  if (isAndroid) {
    const exact = await Notifications.getExactAlarmPermissionsAsync();
    if (exact.status !== 'granted' && exact.canAskAgain) {
      await Notifications.requestExactAlarmPermissionsAsync();
    }
  }
  return true;
}

function notificationData(request: Notifications.NotificationRequest): Record<string, unknown> {
  return request.content.data ?? {};
}

export async function cancelDoseNotifications(slotId: number): Promise<void> {
  if (isWeb) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const matching = scheduled.filter(
    (request) => Number(notificationData(request).medicareSlotId) === slotId,
  );
  await Promise.all(
    matching.map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
  );
  await forgetGuardianEscalation(slotId);
}

/** 인증 결과가 OK/DONE일 때 호출해 남은 단계와 서버 전송 예약을 모두 없앱니다. */
export const completeDoseNotifications = cancelDoseNotifications;

/**
 * 회차 하나에 대해 예정 시각, +5분, +10분, +15분 알림을 예약합니다.
 * +15분 알림이 도착하면 서버 통신을 시도하고, 실패하면 다음 앱 실행 때 재시도합니다.
 */
export async function scheduleDoseNotifications(
  dose: DoseNotificationInput,
): Promise<string[]> {
  if (isWeb) return [];
  if (!(await requestMedicationNotificationPermissions())) return [];

  const scheduledAt = new Date(dose.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) throw new Error('scheduledAt이 올바른 날짜가 아닙니다.');

  await cancelDoseNotifications(dose.slotId);
  const now = Date.now();
  const identifiers: string[] = [];

  for (const stage of STAGES) {
    const fireAt = new Date(scheduledAt.getTime() + stage.minutes * 60_000);
    if (fireAt.getTime() <= now) continue;

    const data = {
      medicareKind: stage.guardianEscalation ? GUARDIAN_ESCALATION_KIND : 'dose-reminder',
      medicareSlotId: dose.slotId,
      medicareStageMinutes: stage.minutes,
      route: '/patient/p06-shoot',
    };
    const trigger: Notifications.DateTriggerInput = {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
      ...(Platform.OS === 'android'
        ? { channelId: stage.channelId, delivery: 'alarmClock' as const }
        : {}),
    };
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: stage.title(dose),
        body: stage.body,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
        data,
      },
      trigger,
    });
    identifiers.push(identifier);

    if (stage.guardianEscalation) {
      await rememberGuardianEscalation(dose.slotId, fireAt);
    }
  }
  return identifiers;
}
