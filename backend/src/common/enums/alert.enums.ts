export {
  AlertCondition,
  AlertMode,
  AlertStatus,
  DevicePlatform,
  DeliveryStatus,
  NotificationType,
} from '../../generated/prisma/enums.js';

export const OutboxEventTypes = {
  alertTriggered: 'ALERT_TRIGGERED',
} as const;
