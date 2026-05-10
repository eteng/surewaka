// Core domain types for SureWaka

export type DeliveryStatus =
  | 'pending'
  | 'matched'
  | 'picked_up'
  | 'in_transit'
  | 'delivered'
  | 'cancelled';

export type UserRole = 'customer' | 'driver' | 'carrier' | 'admin';

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
