import { z } from 'zod';
import { PACKAGE_CATEGORIES, VEHICLE_TYPES } from './constants';

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

export const createDeliverySchema = z.object({
  pickup: locationSchema,
  dropoff: locationSchema,
  packageDetails: packageDetailsSchema,
  recipientDetails: recipientDetailsSchema,
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

export const assignRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['customer', 'driver', 'surewaka_admin', 'carrier_driver', 'carrier_admin', 'support_agent']),
  scopeType: z.enum(['carrier']).optional(),
  scopeId: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
});

export const revokeRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['customer', 'driver', 'surewaka_admin', 'carrier_driver', 'carrier_admin', 'support_agent']),
  scopeId: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
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
  userId: z.string().uuid(),
  type: z.enum(['new_user_signup', 'delivery_issue', 'carrier_verification_request', 'carrier_verified', 'dispute_opened', 'driver_verification_request', 'system_alert']),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  resourceLink: z.string().url().optional(),
});

export type NotificationQuery = z.infer<typeof notificationQuerySchema>;
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;

// ─── Waitlist Admin ──────────────────────────────────────────────────────────

export const waitlistQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
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
  'draft', 'pending', 'accepted', 'en_route_pickup', 'arrived_pickup',
  'picked_up', 'en_route_dropoff', 'arrived_dropoff', 'delivered',
  'cancelled', 'failed', 'returned',
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
  amount: z.number().int().positive(),  // kobo
});
export type BookingConfirm = z.infer<typeof bookingConfirmSchema>;

export const paystackWebhookSchema = z.object({
  event: z.string(),
  data: z.object({
    reference: z.string(),
    amount: z.number(),
    status: z.string(),
    customer: z.object({ email: z.string() }),
    metadata: z.record(z.unknown()).optional().default({}),
  }),
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
