export * from './schema';
export { db } from './client';
export { classifyZone, invalidateZoneCache } from './zone-classifier';

// Backwards-compat aliases — generated schema dropped the "Enum" suffix
export {
  userRole as userRoleEnum,
  deliveryStatus as deliveryStatusEnum,
  vehicleType as vehicleTypeEnum,
  packageCategory as packageCategoryEnum,
  nameChangeStatus as nameChangeStatusEnum,
  notificationType as notificationTypeEnum,
  carrierMemberRole as carrierMemberRoleEnum,
  waitlistUserType as waitlistUserTypeEnum,
} from './schema';
