// Core domain types for SureWaka
import type { DeliveryStatus, PaymentStatus } from './validators';

export type UserRole = 'customer' | 'driver' | 'surewaka_admin' | 'carrier_driver' | 'carrier_admin' | 'support_agent';

export interface User {
  id: string;
  email: string;
  phone: string;
  name: string;
  role: UserRole;
  verified: boolean;
  createdAt: Date;
}

export interface DeliveryRequest {
  id: string;
  customerId: string;
  pickup: Location;
  dropoff: Location;
  packageDetails: PackageDetails;
  status: DeliveryStatus;
  paymentStatus?: PaymentStatus;
  price?: number;
  driverId?: string;
  carrierId?: string;
  createdAt: Date;
}

export interface Location {
  address: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

export interface PackageDetails {
  description: string;
  weight: number; // kg
  category: 'document' | 'parcel' | 'fragile' | 'heavy' | 'food';
}

export interface Carrier {
  id: string;
  name: string;
  verified: boolean;
  rating: number;
  deliveryCount: number;
}

export interface Driver {
  id: string;
  userId: string;
  vehicleType: 'motorcycle' | 'car' | 'van' | 'truck';
  verified: boolean;
  rating: number;
  available: boolean;
  currentLocation?: Location;
}

export type UserRoleRecord = {
  id: string;
  userId: string;
  role: UserRole;
  scopeType: 'carrier' | null;
  scopeId: string | null;
  assignedBy: string | null;
  assignedAt: Date | null;
  revokedAt: Date | null;
  isActive: boolean;
};

export type AppMetadata = {
  roles: string[];
  primary_role: string;
  carrier_id?: string;
};

export type ProfilePreferencesUpdate = {
  notificationEmail?: boolean;
  notificationSms?: boolean;
  notificationPush?: boolean;
};

export type NameChangeRequest = {
  requestedName: string;
  reason: string;
};

export type NotificationType =
  | 'new_user_signup'
  | 'delivery_issue'
  | 'carrier_verification_request'
  | 'carrier_verified'
  | 'dispute_opened'
  | 'driver_verification_request'
  | 'system_alert';

export type NotificationData = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  resourceLink: string | null;
  isRead: boolean;
  createdAt: string;
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type CarrierApplicationStatus = 'pending' | 'under_review' | 'approved' | 'rejected';

export type CarrierApplicationListItem = {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  fleetSize: number | null;
  serviceAreas: string[];
  status: CarrierApplicationStatus;
  createdAt: string;
  updatedAt: string;
};

export type CarrierApplicationEvent = {
  id: string;
  fromStatus: CarrierApplicationStatus | null;
  toStatus: CarrierApplicationStatus;
  performedBy: { id: string; name: string } | null;
  notes: string | null;
  createdAt: string;
};

export type CarrierApplicationDetail = CarrierApplicationListItem & {
  cacNumber: string | null;
  notes: string | null;
  reviewedBy: { id: string; name: string } | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
  events: CarrierApplicationEvent[];
};

export type CarrierListItem = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  isVerified: boolean;
  isActive: boolean;
  driverVettingEnabled: boolean;
  applicationId: string | null;
  createdAt: string;
};

// ─── Driver Listing Types ─────────────────────────────────────────────────────

export type DriverListItem = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  avatarUrl: string | null;
  vehicleType: 'motorcycle' | 'car' | 'van' | 'truck';
  licensePlate: string;
  vehicleModel: string;
  verified: boolean;
  available: boolean;
  rating: number;
  totalDeliveries: number;
  carrierName: string | null;
  carrierId: string | null;
  createdAt: string;
};

// ─── Driver Detail Types ──────────────────────────────────────────────────────

export type DriverDetailDelivery = {
  id: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  date: string; // ISO string of deliveries.createdAt
  price: number; // deliveries.price (0 if null)
};

export type DriverDetail = {
  id: string; // drivers.id
  name: string; // users.name
  phone: string; // users.phone
  email: string | null; // users.email
  avatarUrl: string | null; // users.avatarUrl
  vehicleType: 'motorcycle' | 'car' | 'van' | 'truck';
  vehicleModel: string; // drivers.vehicleModel
  licensePlate: string; // drivers.licensePlate
  verified: boolean; // drivers.verified
  available: boolean; // drivers.available
  rating: number; // drivers.rating
  totalDeliveries: number; // COUNT(deliveries) WHERE status='delivered'
  createdAt: string; // drivers.createdAt (ISO string)
  carrierName: string | null; // carriers.name via carrier_members
  carrierId: string | null; // carrier_members.carrierId
  carrierRole: string | null; // carrier_members.role
  carrierJoinedAt: string | null; // carrier_members.joinedAt (ISO string)
  recentDeliveries: DriverDetailDelivery[];
};

// ─── Customer Listing Types ──────────────────────────────────────────────────

export type CustomerTier = 'power' | 'regular' | 'new' | 'dormant';

export type CustomerListItem = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  avatarUrl: string | null;
  verified: boolean;
  tier: CustomerTier | null;
  totalDeliveries: number;
  totalSpent: number;
  lastDeliveryAt: string | null;
  primaryCity: string | null;
  healthScore: number;
  createdAt: string;
};

// ─── Push Notifications ──────────────────────────────────────────────────────

export type PushNotificationType =
  | 'delivery_status_change'
  | 'delivery_cancelled'
  | 'driver_arrived'
  | 'payment_received'
  | 'dispute_opened'
  | 'delivery_assigned'
  | 'carrier_verified'
  | 'broadcast';

export type PushTargetApp = 'customer' | 'driver';

export type PushNotificationPayload = {
  title: string;
  body: string;
  data: {
    type: PushNotificationType;
    resourceId: string;
    deepLink: string;
    metadata?: Record<string, unknown>;
  };
};

export type PushJobData = {
  userId: string;
  targetApp: PushTargetApp | 'all';
  payload: PushNotificationPayload;
  priority: 'high' | 'normal';
};

export type BroadcastChunkJobData = {
  userIds: string[];
  payload: PushNotificationPayload;
  segment: string;
};

export type PushTokenRecord = {
  id: string;
  userId: string;
  expoPushToken: string;
  deviceId: string;
  platform: 'ios' | 'android';
  app: PushTargetApp;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
