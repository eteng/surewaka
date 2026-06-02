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
