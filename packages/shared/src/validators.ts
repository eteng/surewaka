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

export const createDeliverySchema = z.object({
  pickup: locationSchema,
  dropoff: locationSchema,
  packageDetails: packageDetailsSchema,
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
