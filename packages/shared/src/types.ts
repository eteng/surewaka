// Core domain types for SureWaka
// Note: DeliveryStatus is now defined as a Zod enum in validators.ts (source of truth)

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
  status: 'draft' | 'pending' | 'accepted' | 'en_route_pickup' | 'arrived_pickup' | 'picked_up' | 'en_route_dropoff' | 'arrived_dropoff' | 'delivered' | 'cancelled' | 'failed' | 'returned';
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
};

export type NameChangeRequest = {
  requestedName: string;
  reason: string;
};

export type NotificationData = {
  id: string;
  type: string;
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
