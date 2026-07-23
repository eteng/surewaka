import { z } from 'zod';
import { NOTIFICATION_TYPES, PACKAGE_CATEGORIES, PUSH_NOTIFICATION_TYPES, PUSH_TARGET_APPS, VEHICLE_TYPES } from './constants';

export const locationSchema = z.object({
  address: z.string().min(5),
  city: z.string().min(2),
  state: z.string().min(2),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const packageDetailsSchema = z.object({
  description: z.string().min(3).max(500),
  weight: z.number().positive().max(500),
  category: z.enum(PACKAGE_CATEGORIES),
});

const NIGERIAN_PHONE_RE = /^(\+234|0)[789][01]\d{8}$/;

export const recipientDetailsSchema = z.object({
  recipientName: z.string().min(2).max(100),
  recipientPhone: z.string().regex(NIGERIAN_PHONE_RE, 'Enter a valid Nigerian mobile number'),
  deliveryNotes: z.string().max(200).optional(),
});

export type RecipientDetails = z.infer<typeof recipientDetailsSchema>;

// Leg definition for delivery creation — on-demand legs need vehicleType, carrier legs need carrierId
const deliveryOnDemandLegSchema = z.object({
  legType: z.enum(['first_mile', 'last_mile']),
  vehicleType: z.enum(VEHICLE_TYPES),
});

const deliveryCarrierLegSchema = z.object({
  legType: z.literal('intercity'),
  carrierId: z.string().uuid(),
});

const deliveryLegInputSchema = z.union([deliveryOnDemandLegSchema, deliveryCarrierLegSchema]);

export type DeliveryLegInput = z.infer<typeof deliveryLegInputSchema>;

export const createDeliverySchema = z.object({
  pickup: locationSchema,
  dropoff: locationSchema,
  packageDetails: packageDetailsSchema,
  recipientDetails: recipientDetailsSchema,
  legs: z.array(deliveryLegInputSchema).min(1).max(10).optional(),
  mode: z.enum(['on_demand', 'carrier_direct', 'surewaka_way']).optional(),
});

export const otpRegisterSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
});
export type OtpRegister = z.infer<typeof otpRegisterSchema>;

export const registerUserSchema = z.object({
  email: z.string().email(),
  phone: z.string().min(10).max(15),
  name: z.string().min(2).max(100),
  role: z.enum(['customer', 'driver', 'carrier']),
});

export const registerDriverSchema = z.object({
  vehicleType: z.enum(VEHICLE_TYPES),
  licensePlate: z.string().min(5),
  vehicleModel: z.string().min(2),
});

export const waitlistSignupSchema = z.object({
  fullName: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Please enter a valid email address'),
  userType: z.enum(['sender', 'business', 'driver']),
  source: z.string().optional().default('home'),
});

export type WaitlistSignup = z.infer<typeof waitlistSignupSchema>;

// ─── Mobile Auth Validators ──────────────────────────────────────────────────

export const phoneOtpSchema = z.object({
  phone: z.string().regex(/^\+234\d{10}$/, 'Enter a valid Nigerian phone number (e.g. +2348012345678)'),
});

export const otpVerifySchema = z.object({
  otp: z.string().length(6, 'OTP must be 6 digits').regex(/^\d{6}$/, 'OTP must contain only numbers'),
});

export type PhoneOtpInput = z.infer<typeof phoneOtpSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

// ─── Address Validators ──────────────────────────────────────────────────────

export const savedAddressSchema = z.object({
  id:           z.string().uuid(),
  label:        z.string().min(1).max(50),
  address_text: z.string().min(1),
  city:         z.string(),
  state:        z.string(),
  lat:          z.number(),
  lng:          z.number(),
  created_at:   z.string(),
});

export const createSavedAddressSchema = savedAddressSchema.omit({ id: true, created_at: true });
export const updateSavedAddressSchema = createSavedAddressSchema.partial();

export type SavedAddress = z.infer<typeof savedAddressSchema>;
export type CreateSavedAddress = z.infer<typeof createSavedAddressSchema>;
export type UpdateSavedAddress = z.infer<typeof updateSavedAddressSchema>;

export const recentLocationSchema = z.object({
  id:           z.string().uuid(),
  address_text: z.string().min(1),
  city:         z.string(),
  state:        z.string(),
  lat:          z.number(),
  lng:          z.number(),
  used_at:      z.string(),
});

export const upsertRecentLocationSchema = recentLocationSchema.omit({ id: true, used_at: true });

export type RecentLocation = z.infer<typeof recentLocationSchema>;
export type UpsertRecentLocation = z.infer<typeof upsertRecentLocationSchema>;

// ─── Carrier Driver Onboarding ───────────────────────────────────────────────

export const onboardCarrierDriverSchema = z.object({
  phone: z.string().regex(/^\+234\d{10}$/, 'Enter a valid Nigerian phone number'),
  fullName: z.string().min(2).max(100),
});

export type OnboardCarrierDriver = z.infer<typeof onboardCarrierDriverSchema>;

// ─── RBAC ────────────────────────────────────────────────────────────────────

const ORG_SCOPED_ROLES = ['carrier_admin', 'carrier_driver'] as const;

export const assignRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['customer', 'driver', 'surewaka_admin', 'carrier_driver', 'carrier_admin', 'support_agent']),
  scopeType: z.enum(['carrier']).nullish(),
  scopeId: z.string().uuid().nullish(),
  reason: z.string().max(500).optional(),
}).superRefine((data, ctx) => {
  if ((ORG_SCOPED_ROLES as readonly string[]).includes(data.role)) {
    if (!data.scopeType) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'scopeType is required for org-scoped roles', path: ['scopeType'] });
    }
    if (!data.scopeId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'scopeId is required for org-scoped roles', path: ['scopeId'] });
    }
  }
});

export const revokeRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['customer', 'driver', 'surewaka_admin', 'carrier_driver', 'carrier_admin', 'support_agent']),
  scopeId: z.string().uuid().optional(),
  reason: z.string().min(3).max(500),
});

export type AssignRole = z.infer<typeof assignRoleSchema>;
export type RevokeRole = z.infer<typeof revokeRoleSchema>;

// ─── Notifications ───────────────────────────────────────────────────────────

export const notificationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: z.string().optional(),
  isRead: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
});

export const createNotificationSchema = z.object({
  userId: z.union([z.string().uuid(), z.literal('all_admins')]),
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(500),
  resourceLink: z.string().startsWith('/').max(500).optional(),
});

export type NotificationQuery = z.infer<typeof notificationQuerySchema>;
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;

// ─── Waitlist Admin ──────────────────────────────────────────────────────────

export const waitlistQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).default(''),
  userType: z.enum(['sender', 'business', 'driver']).optional(),
  source: z.string().optional(),
  sortBy: z.enum(['createdAt', 'fullName', 'email', 'userType']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export type WaitlistQuery = z.infer<typeof waitlistQuerySchema>;

// ─── Customer Mobile Profile ─────────────────────────────────────────────────

export const GENDER_VALUES = ['woman', 'man', 'prefer_not_to_disclose'] as const;
export type Gender = (typeof GENDER_VALUES)[number];

export const GENDER_LABELS: Record<Gender, string> = {
  woman: 'Woman',
  man: 'Man',
  prefer_not_to_disclose: 'Prefer not to disclose',
};

export const customerProfileUpdateSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .refine((v) => v.trim().length > 0, 'Name cannot be whitespace only')
    .optional(),
  gender: z.enum(GENDER_VALUES).nullable().optional(),
});

export type CustomerProfileUpdate = z.infer<typeof customerProfileUpdateSchema>;

// ─── Profile ─────────────────────────────────────────────────────────────────

export const profilePreferencesUpdateSchema = z.object({
  notificationEmail: z.boolean().optional(),
  notificationSms: z.boolean().optional(),
  notificationPush: z.boolean().optional(),
});

export const avatarFileSchema = z.object({
  filename: z.string(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().max(5 * 1024 * 1024, 'File must be under 5 MB'),
});

export const nameChangeRequestSchema = z.object({
  requestedName: z.string().min(2).max(100),
  reason: z.string().min(5).max(500),
});

// ─── Employee Management ─────────────────────────────────────────────────────

export const inviteEmployeeSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(100),
  role: z.enum(['customer', 'driver', 'surewaka_admin', 'carrier_driver', 'carrier_admin', 'support_agent']),
  scopeType: z.enum(['carrier']).optional(),
  scopeId: z.string().uuid().optional(),
});

export const employeeListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  role: z.enum(['customer', 'driver', 'surewaka_admin', 'carrier_driver', 'carrier_admin', 'support_agent']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  sortBy: z.enum(['name', 'email', 'createdAt', 'updatedAt']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type InviteEmployee = z.infer<typeof inviteEmployeeSchema>;
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const updateEmployeeSchema = z.object({
  fullName: z.string().min(2).max(100).optional(),
  phone: z.string().regex(/^\+234\d{10}$/).optional(),
  email: z.string().email().optional(),
  role: z.enum(['customer', 'driver', 'surewaka_admin', 'carrier_driver', 'carrier_admin', 'support_agent']).optional(),
  scopeType: z.string().optional(),
  scopeId: z.string().uuid().optional(),
});

export type UpdateEmployee = z.infer<typeof updateEmployeeSchema>;

// ─── Name Change Requests ────────────────────────────────────────────────────

export const nameChangeReviewSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reviewNote: z.string().max(500).optional(),
});

export type NameChangeReview = z.infer<typeof nameChangeReviewSchema>;

// ─── Payment validators ───────────────────────────────────────────────────────

export const deliveryStatusSchema = z.enum([
  'pending_routing', 'routing_failed', 'draft', 'pending', 'accepted',
  'en_route_pickup', 'arrived_pickup', 'picked_up', 'en_route_dropoff',
  'arrived_dropoff', 'delivered', 'cancelled', 'failed', 'returned',
]);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

export const paymentStatusSchema = z.enum(['unpaid', 'escrowed', 'released', 'refunded']);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const initializeTopupSchema = z.object({
  amount: z.number().int().min(50000, 'Minimum top-up is ₦500'),  // kobo
  topup_type: z.enum(['manual', 'booking_shortfall']).default('manual'),
  delivery_id: z.string().uuid().optional(),
});
export type InitializeTopup = z.infer<typeof initializeTopupSchema>;

export const walletCheckSchema = z.object({
  amount: z.number().int().positive(),  // kobo
});
export type WalletCheck = z.infer<typeof walletCheckSchema>;

export const bookingConfirmSchema = z.object({
  delivery_id: z.string().uuid(),
  amount: z.number().int().positive().optional(),  // kobo — deprecated, server computes from quotes
});
export type BookingConfirm = z.infer<typeof bookingConfirmSchema>;

export const paystackWebhookSchema = z.object({
  event: z.string(),
  data: z.object({
    reference: z.string().optional(),
    amount: z.number().optional(),
    status: z.string().optional(),
    customer: z.object({ email: z.string() }).optional(),
    metadata: z.record(z.unknown()).optional().default({}),
    transfer_code: z.string().optional(),
    recipient: z.object({ recipient_code: z.string() }).optional(),
    reason: z.string().optional(),
    complete_message: z.string().optional(),
  }).passthrough(),
});
export type PaystackWebhook = z.infer<typeof paystackWebhookSchema>;

export const payoutRequestSchema = z.object({
  amount: z.number().int().min(100000, 'Minimum payout is ₦1,000'),  // kobo
  bank_code: z.string().min(3).max(10),
  account_number: z.string().length(10, 'Nigerian account numbers are 10 digits'),
  account_name: z.string().min(2).max(100),
});
export type PayoutRequest = z.infer<typeof payoutRequestSchema>;

export const cancelDeliverySchema = z.object({
  reason: z.string().min(5).max(200).optional(),
});
export type CancelDelivery = z.infer<typeof cancelDeliverySchema>;

// ── Carrier Application Validators ──────────────────────────────────────────

export const NIGERIAN_PHONE_REGEX = /^\+234\d{10}$/;

export const submitCarrierApplicationSchema = z.object({
  businessName: z.string().min(2, 'Business name must be at least 2 characters').max(200),
  contactName: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().regex(NIGERIAN_PHONE_REGEX, 'Must be a valid Nigerian number (+234XXXXXXXXXX)'),
  cacNumber: z.string().max(20).optional(),
  fleetSize: z.number().int().positive().optional(),
  serviceAreas: z.array(z.string().min(1)).min(1, 'Select at least one service area'),
  notes: z.string().max(1000).optional(),
});

export const approveCarrierApplicationSchema = z
  .object({
    carrierName: z.string().min(2).max(200),
    slug: z
      .string()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens only'),
    driverVettingEnabled: z.boolean().default(false),
    adminPhone: z.string().regex(NIGERIAN_PHONE_REGEX).optional(),
    adminEmail: z.string().email().optional(),
    notes: z.string().max(500).optional(),
  })
  .refine((d) => d.adminPhone != null || d.adminEmail != null, {
    message: 'Either adminPhone or adminEmail is required to invite the carrier admin',
  });

export const rejectCarrierApplicationSchema = z.object({
  reason: z.string().min(10, 'Provide at least 10 characters explaining the rejection').max(1000),
});

export const carrierApplicationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).default(''),
  status: z.enum(['pending', 'under_review', 'approved', 'rejected']).optional(),
  sortBy: z.enum(['createdAt', 'businessName', 'status']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const createStrategicCarrierSchema = z
  .object({
    carrierName: z.string().min(2).max(200),
    slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/),
    contactName: z.string().min(2).max(100),
    adminPhone: z.string().regex(NIGERIAN_PHONE_REGEX).optional(),
    adminEmail: z.string().email().optional(),
    driverVettingEnabled: z.boolean().default(false),
  })
  .refine((d) => d.adminPhone != null || d.adminEmail != null, {
    message: 'Either adminPhone or adminEmail is required',
  });

export const carrierListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).default(''),
  isActive: z.coerce.boolean().optional(),
});

export type SubmitCarrierApplicationInput = z.infer<typeof submitCarrierApplicationSchema>;
export type ApproveCarrierApplicationInput = z.infer<typeof approveCarrierApplicationSchema>;
export type RejectCarrierApplicationInput = z.infer<typeof rejectCarrierApplicationSchema>;
export type CarrierApplicationListQuery = z.infer<typeof carrierApplicationListQuerySchema>;
export type CreateStrategicCarrierInput = z.infer<typeof createStrategicCarrierSchema>;
export type CarrierListQuery = z.infer<typeof carrierListQuerySchema>;

// ─── Driver Listing (Admin) ───────────────────────────────────────────────────

export const driverListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).default(''),
  vehicleType: z.enum(['motorcycle', 'car', 'van', 'truck']).optional(),
  verified: z.enum(['true', 'false']).optional(),
  available: z.enum(['true', 'false']).optional(),
  carrierId: z.string().uuid().optional(),
  affiliation: z.enum(['independent', 'carrier']).optional(),
  sortBy: z.enum(['createdAt', 'rating', 'name', 'totalDeliveries']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export type DriverListQuery = z.infer<typeof driverListQuerySchema>;

// ─── Customer Listing (Admin) ────────────────────────────────────────────────

export const customerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).default(''),
  tier: z.enum(['power', 'regular', 'new', 'dormant']).optional(),
  verified: z.enum(['true', 'false']).optional(),
  city: z.string().max(100).optional(),
  joinedFrom: z.string().optional(), // ISO date string
  joinedTo: z.string().optional(), // ISO date string
  sortBy: z.enum(['createdAt', 'totalSpent', 'lastDeliveryAt', 'totalDeliveries', 'name']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

// ─── Customer Detail (Admin) ─────────────────────────────────────────────────

export const customerDetailDeliveryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).default(10).optional(),
});

export type CustomerDetailDeliveryQuery = z.infer<typeof customerDetailDeliveryQuerySchema>;

// ─── Delivery Listing (Admin) ────────────────────────────────────────────────

const deliveryTabValues = ['all', 'requests', 'active', 'completed'] as const;

// ─── Push Notification Validators ────────────────────────────────────────────

export const registerPushTokenSchema = z.object({
  expoPushToken: z.string().min(1).startsWith('ExponentPushToken['),
  deviceId: z.string().min(1),
  platform: z.enum(['ios', 'android']),
  app: z.enum(PUSH_TARGET_APPS),
});

export type RegisterPushToken = z.infer<typeof registerPushTokenSchema>;

export const pushNotificationPayloadSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(500),
  data: z.object({
    type: z.enum(PUSH_NOTIFICATION_TYPES),
    resourceId: z.string().min(1),
    deepLink: z.string().min(1),
    metadata: z.record(z.unknown()).optional(),
  }),
});

export type PushNotificationPayloadInput = z.infer<typeof pushNotificationPayloadSchema>;

export const broadcastSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(500),
  segment: z.enum(['all', 'customers', 'drivers']),
  city: z.string().optional(),
  deepLink: z.string().url().max(2048).optional(),
});

export type BroadcastInput = z.infer<typeof broadcastSchema>;

// ─── Delivery Model Validators ────────────────────────────────────────────────

export const createDeliveryLegSchema = z.object({
  deliveryId: z.string().uuid(),
  legNumber: z.number().int().min(1).max(10),
  legType: z.enum(['first_mile', 'intercity', 'last_mile']),
  actorType: z.enum(['driver', 'carrier']),
  actorId: z.string().uuid(),
  pickupAddress: z.string().min(1).max(500),
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  dropoffAddress: z.string().min(1).max(500),
  dropoffLat: z.number().min(-90).max(90),
  dropoffLng: z.number().min(-180).max(180),
  slaHours: z.number().positive().optional(),
});

export const updateDriverEtaSchema = z.object({
  driverEtaAt: z.string().datetime(),
});

export const recordDriverLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  deliveryId: z.string().uuid().optional(),
});

export const submitDeliveryRatingSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

export const overrideFailureCauseSchema = z.object({
  failureCause: z.enum(['driver', 'carrier', 'route_traffic', 'system']),
  failureNote: z.string().max(500).optional(),
});

// ─── Zone Validators ──────────────────────────────────────────────────────────

const zoneBaseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100),
  country: z.string().trim().min(1).max(100),
  keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
  swLat: z.number().min(-90).max(90).nullable().optional(),
  swLng: z.number().min(-180).max(180).nullable().optional(),
  neLat: z.number().min(-90).max(90).nullable().optional(),
  neLng: z.number().min(-180).max(180).nullable().optional(),
  isActive: z.boolean().default(true),
});

function bboxRefine(data: Record<string, unknown>, ctx: z.RefinementCtx) {
  const bbox = [data.swLat, data.swLng, data.neLat, data.neLng];
  const hasAny = bbox.some((v) => v != null);
  const hasAll = bbox.every((v) => v != null);
  if (hasAny && !hasAll) {
    ctx.addIssue({ code: 'custom', message: 'All four bounding box coordinates are required when any is provided' });
  }
  if (hasAll) {
    if ((data.swLat as number) >= (data.neLat as number)) ctx.addIssue({ code: 'custom', message: 'sw_lat must be less than ne_lat' });
    if ((data.swLng as number) >= (data.neLng as number)) ctx.addIssue({ code: 'custom', message: 'sw_lng must be less than ne_lng' });
  }
}

export const createZoneSchema = zoneBaseSchema.superRefine(bboxRefine);

export const updateZoneSchema = zoneBaseSchema.partial().superRefine(bboxRefine);

export type CreateZoneInput = z.infer<typeof createZoneSchema>;
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;

// ─── Carrier SLA Override ─────────────────────────────────────────────────────

export const createCarrierSlaOverrideSchema = z.object({
  carrierId: z.string().uuid(),
  originZoneId: z.string().uuid(),
  destinationZoneId: z.string().uuid(),
  slaHours: z.number().positive(),
});

// ─── Carrier Parks ────────────────────────────────────────────────────────────

export const createCarrierParkSchema = z.object({
  carrierId: z.string().uuid(),
  city: z.string().min(2).max(100),
  name: z.string().min(2).max(200),
  address: z.string().min(5).max(500),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type CreateCarrierPark = z.infer<typeof createCarrierParkSchema>;

export const updateCarrierParkSchema = createCarrierParkSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ─── Carrier Routes ───────────────────────────────────────────────────────────

export const createCarrierRouteSchema = z.object({
  carrierId: z.string().uuid(),
  originParkId: z.string().uuid(),
  destinationParkId: z.string().uuid(),
  basePriceKobo: z.number().int().positive(),
  estimatedTransitHrs: z.number().positive(),
  maxWeightKg: z.number().positive().optional(),
}).refine(d => d.originParkId !== d.destinationParkId, {
  message: 'Origin and destination parks must differ',
  path: ['destinationParkId'],
});
export type CreateCarrierRoute = z.infer<typeof createCarrierRouteSchema>;

export const updateCarrierRouteSchema = z.object({
  basePriceKobo: z.number().int().positive().optional(),
  estimatedTransitHrs: z.number().positive().optional(),
  maxWeightKg: z.number().positive().optional(),
  isActive: z.boolean().optional(),
});

// ─── Carrier Route Schedules ──────────────────────────────────────────────────

export const createCarrierRouteScheduleSchema = z.object({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59).default(0),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).default([]),
});
export type CreateCarrierRouteSchedule = z.infer<typeof createCarrierRouteScheduleSchema>;

export const updateCarrierRouteScheduleSchema = createCarrierRouteScheduleSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ─── Admin Deliveries ────────────────────────────────────────────────────────

export const adminDeliveryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  status: z.enum([
    'pending_routing', 'routing_failed',
    'draft', 'pending', 'accepted',
    'en_route_pickup', 'arrived_pickup', 'picked_up',
    'en_route_dropoff', 'arrived_dropoff',
    'delivered', 'cancelled', 'failed', 'returned',
  ]).optional(),
  tab: z.enum(['all', 'requests', 'active', 'completed']).default('all'),
  sortBy: z.enum(['createdAt', 'status', 'customerName', 'price']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

// ─── Ops Hub ──────────────────────────────────────────────────────────────────

export { escalationActionSchema } from './validators/ops-hub';

// ─── Fee Engine Validators ────────────────────────────────────────────────────

export const vehicleTypeSchema = z.enum(VEHICLE_TYPES);

const quoteOnDemandLegSchema = z.object({
  legType: z.enum(['first_mile', 'last_mile']),
  vehicleType: vehicleTypeSchema,
  pickup: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  dropoff: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
});

const quoteCarrierLegSchema = z.object({
  legType: z.literal('intercity'),
  carrierId: z.string().uuid(),
});

const quoteLegSchema = z.discriminatedUnion('legType', [
  quoteOnDemandLegSchema.extend({ legType: z.literal('first_mile') }),
  quoteOnDemandLegSchema.extend({ legType: z.literal('last_mile') }),
  quoteCarrierLegSchema,
]);

export const quoteRequestSchema = z.object({
  legs: z.array(quoteLegSchema).min(1).max(10),
  packageWeight: z.number().positive().max(500),
});

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

const lineItemSchema = z.object({
  label: z.string().min(1),
  amountKobo: z.number().int(),
});

const legQuoteResponseSchema = z.object({
  legType: z.string(),
  lineItems: z.array(lineItemSchema),
  totalKobo: z.number().int(),
});

export const quoteResponseSchema = z.object({
  legs: z.array(legQuoteResponseSchema),
  compositeTotalKobo: z.number().int(),
});

export type QuoteResponse = z.infer<typeof quoteResponseSchema>;

export const weightCorrectionRequestSchema = z.object({
  reportedWeightKg: z.number().positive().max(500),
});

export type WeightCorrectionRequest = z.infer<typeof weightCorrectionRequestSchema>;

export const weightCorrectionRespondSchema = z.object({
  decision: z.enum(['approved', 'declined']),
});

export type WeightCorrectionRespond = z.infer<typeof weightCorrectionRespondSchema>;

export const updateFeeSettingsSchema = z.object({
  baseRateKobo: z.number().int().min(0).optional(),
  perKgRateKobo: z.number().int().min(0).optional(),
  perKmRateKobo: z.number().int().min(0).optional(),
  carrierCommissionRatePct: z.number().min(0).max(100).optional(),
  taxRatePct: z.number().min(0).max(100).optional(),
  minPriceKobo: z.number().int().min(0).optional(),
  withdrawalFeeKobo: z.number().int().min(0).optional(),
  weightCorrectionApprovalWindowMin: z.number().int().min(1).max(60).optional(),
});

export type UpdateFeeSettings = z.infer<typeof updateFeeSettingsSchema>;

export const updateVehicleTypeRateSchema = z.object({
  vehicleType: vehicleTypeSchema,
  multiplier: z.number().positive(),
});

export type UpdateVehicleTypeRate = z.infer<typeof updateVehicleTypeRateSchema>;

// ─── Alert Settings ───────────────────────────────────────────────────────────

export const updateAlertSettingsSchema = z
  .object({
    driverSilentWarningMin: z.number().int().min(5).max(60).optional(),
    driverSilentCriticalMin: z.number().int().min(10).max(120).optional(),
    legOverdueWarningMin: z.number().int().min(10).max(120).optional(),
    legOverdueCriticalMin: z.number().int().min(20).max(240).optional(),
    customerUpdateGapWarningMin: z.number().int().min(15).max(120).optional(),
    customerUpdateGapCriticalMin: z.number().int().min(30).max(240).optional(),
    ontimeRateWarningPct: z.number().int().min(50).max(100).optional(),
    ontimeRateCriticalPct: z.number().int().min(30).max(90).optional(),
    pumbleWebhookUrl: z
      .string()
      .max(2048, 'Webhook URL must be at most 2048 characters')
      .startsWith('https://', 'Webhook URL must start with https://')
      .url('Webhook URL must be a valid URL')
      .nullable()
      .optional(),
    pushEnabled: z.boolean().optional(),
    pumbleEnabled: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    // Time-based pairs: warning must be strictly less than critical
    const minutePairs: [keyof typeof data, keyof typeof data, string][] = [
      ['driverSilentWarningMin', 'driverSilentCriticalMin', 'driverSilent'],
      ['legOverdueWarningMin', 'legOverdueCriticalMin', 'legOverdue'],
      ['customerUpdateGapWarningMin', 'customerUpdateGapCriticalMin', 'customerUpdateGap'],
    ];
    for (const [warnKey, critKey, label] of minutePairs) {
      const warn = data[warnKey] as number | undefined;
      const crit = data[critKey] as number | undefined;
      if (warn !== undefined && crit !== undefined && warn >= crit) {
        ctx.addIssue({ code: 'custom', path: [warnKey], message: `${label} warning must be less than critical` });
      }
    }
    // Pct: critical must be < warning (lower rate = worse)
    if (
      data.ontimeRateCriticalPct !== undefined &&
      data.ontimeRateWarningPct !== undefined &&
      data.ontimeRateCriticalPct >= data.ontimeRateWarningPct
    ) {
      ctx.addIssue({ code: 'custom', path: ['ontimeRateCriticalPct'], message: 'ontimeRate critical must be less than warning' });
    }
  });

export type UpdateAlertSettings = z.infer<typeof updateAlertSettingsSchema>;
