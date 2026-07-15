// Core domain types for SureWaka
import type { DeliveryStatus, PaymentStatus } from './validators';
import type { LEG_TYPES, LEG_ACTOR_TYPES, FAILURE_CAUSES, ALERT_RULES } from './constants';
import type { AlertSeverity } from './types/ops-hub';

export type { DeliveryStatus, PaymentStatus };

export type PackageCategory = 'document' | 'parcel' | 'fragile' | 'heavy' | 'food';

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
  slug: string;
  verified: boolean;
  isVerified: boolean;
  rating: number | null;
  deliveryCount: number | null;
  logoUrl: string | null;
  basePrice: number | null;
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
  price: number; // deliveries.price_kobo (0 if null)
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

// ─── Customer Detail Types ────────────────────────────────────────────────────

export type CustomerDetail = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  avatarUrl: string | null;
  gender: string | null;
  verified: boolean;
  createdAt: string;
  notificationEmail: boolean;
  notificationSms: boolean;
  tier: CustomerTier | null;
  totalDeliveries: number;
  totalSpent: number;
  lastDeliveryAt: string | null;
  primaryCity: string | null;
  healthScore: number;
};

export type CustomerDeliveryItem = {
  id: string;
  status: string;
  pickupAddress: string;
  pickupCity: string;
  dropoffAddress: string;
  dropoffCity: string;
  packageDescription: string;
  packageCategory: string;
  price: number | null;
  amountPaid: number | null;
  paymentStatus: string;
  recipientName: string;
  recipientPhone: string;
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
  | 'weight_correction'
  | 'broadcast'
  | 'system_alert'
  | 'wallet_withdrawal';

export type PushTargetApp = 'customer' | 'driver' | 'admin';

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

// ─── Admin Delivery Types ─────────────────────────────────────────────────────

export type DeliveryListItem = {
  id: string;
  status: DeliveryStatus;
  pickupAddress: string;
  pickupCity: string;
  dropoffAddress: string;
  dropoffCity: string;
  packageCategory: PackageCategory;
  price: number | null;
  createdAt: string;
  updatedAt: string;
  customerName: string;
  customerPhone: string;
  driverName: string | null;
  carrierName: string | null;
  recipientName: string;
  recipientPhone: string;
};

export type DeliveryDetail = {
  id: string;
  status: DeliveryStatus;
  pickupAddress: string;
  pickupCity: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffCity: string;
  dropoffLat: number;
  dropoffLng: number;
  packageDescription: string;
  packageWeight: number;
  packageCategory: PackageCategory;
  deliveryNotes: string | null;
  price: number | null;
  amountPaid: number | null;
  paymentStatus: string;
  createdAt: string;
  updatedAt: string;
  recipientName: string;
  recipientPhone: string;
  senderPhone: string | null;
  customer: {
    id: string;
    name: string;
    phone: string;
  };
  driver: {
    id: string;
    userId: string;
    name: string;
    vehicleType: string;
    licensePlate: string;
  } | null;
  carrier: {
    id: string;
    name: string;
    slug: string;
  } | null;
};

export type TabCounts = {
  all: number;
  requests: number;
  active: number;
  completed: number;
};

export type StatusUpdatePayload = {
  deliveryId: string;
  previousStatus: DeliveryStatus;
  newStatus: DeliveryStatus;
  timestamp: string;
};

export type LocationUpdatePayload = {
  driverId: string;
  lat: number;
  lng: number;
  heading: number;
  timestamp: string;
};

// ─── Zone Types ───────────────────────────────────────────────────────────────

export type Zone = {
  id: string;
  name: string;
  city: string;
  country: string;
  isActive: boolean;
};

export type ZoneName = string;

// ─── Multi-Leg Delivery Model Types ──────────────────────────────────────────

export type LegType = (typeof LEG_TYPES)[number];
export type LegActorType = (typeof LEG_ACTOR_TYPES)[number];
export type FailureCause = (typeof FAILURE_CAUSES)[number];

export type DeliveryLeg = {
  id: string;
  deliveryId: string;
  legNumber: number;
  legType: LegType;
  actorType: LegActorType;
  actorId: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  pickupZoneId: string | null;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffZoneId: string | null;
  status: DeliveryStatus;
  systemEtaAt: string | null;   // ISO 8601
  driverEtaAt: string | null;   // ISO 8601
  slaHours: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type DeliveryEvent = {
  id: string;
  deliveryId: string;
  legId: string | null;
  fromStatus: DeliveryStatus | null;
  toStatus: DeliveryStatus;
  triggeredBy: string | null;   // user id or null for system
  failureCause: FailureCause | null;
  failureNote: string | null;
  createdAt: string;
};

export type DriverLocation = {
  id: string;
  driverId: string;
  deliveryId: string | null;
  lat: number;
  lng: number;
  recordedAt: string;
};

export type DeliveryRating = {
  id: string;
  deliveryId: string;
  driverId: string | null;
  customerId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
};

export type CarrierSlaOverride = {
  id: string;
  carrierId: string;
  originZoneId: string;
  destinationZoneId: string;
  slaHours: number;
};

// ─── Ops Hub ──────────────────────────────────────────────────────────────────

export type { OpsHubStats, AtRiskDelivery, AlertItem, AlertSeverity, RiskReason, EscalationAction } from './types/ops-hub';

// ─── Analytics Suite Types ────────────────────────────────────────────────────

export type SparkPoint = { date: string; value: number };

export type OverviewKpis = {
  onTimeRate: number;
  onTimeRateSparkline: SparkPoint[];
  fulfillmentRate: number;
  fulfillmentRateSparkline: SparkPoint[];
  avgDeliveryMinutes: number;
  avgDeliveryMinutesSparkline: SparkPoint[];
  disputeRate: number;
  disputeRateSparkline: SparkPoint[];
  customerUpdateFrequency: number;
  customerUpdateFrequencySparkline: SparkPoint[];
  driverCompletionRate: number;
  driverCompletionRateSparkline: SparkPoint[];
};

export type DailyOnTimePoint = { date: string; rate: number; isAnomaly: boolean };
export type OutcomeBar = { status: string; count: number };
export type PhaseBar = { legType: string; avgMinutes: number; slaHours: number };
export type LateDistBar = { bucket: string; count: number };

export type DeliveryPerformanceData = {
  dailyOnTimeRate: DailyOnTimePoint[];
  volumeByOutcome: OutcomeBar[];
  phaseBreakdown: PhaseBar[];
  lateDistribution: LateDistBar[];
};

export type DriverPerformanceRow = {
  driverId: string;
  name: string;
  totalLegs: number;
  onTimePct: number;
  completionPct: number;
  ghostRate: number;
  avgRating: number;
  reliabilityScore: number;
};

export type CarrierSlaRow = {
  carrierId: string;
  name: string;
  avgActualHours: number;
  slaHours: number;
  adherencePct: number;
  fulfillmentPct: number;
};

export type CarrierPerformanceData = {
  rows: CarrierSlaRow[];
  overrideCoverage: { configured: number; total: number };
};

export type CustomerExperienceData = {
  updateFrequencyTrend: SparkPoint[];
  avgUpdateFrequency: number;
  disputeRateTrend: SparkPoint[];
  avgDisputeRate: number;
  avgResolutionHours: number;
  repeatRate30d: number;
  repeatRate60d: number;
};

export type FailureShare = { cause: string; count: number; pct: number };
export type TopContributor = {
  actorType: 'driver' | 'carrier';
  actorId: string;
  name: string;
  lateCount: number;
  avgMinutesLate: number;
  topZone: string;
  topTimeOfDay: string;
};
export type HeatCell = { zone: string; timeOfDay: string; avgDelayMinutes: number };

export type HeatmapResponse = {
  metro: string;
  zones: string[];
  cells: HeatCell[];
};

export type RootCauseData = {
  failureDecomposition: FailureShare[];
  topContributors: TopContributor[];
  heatmap: HeatmapResponse;
};

// ─── Fee Engine Types ─────────────────────────────────────────────────────────

export type VehicleType = 'motorcycle' | 'car' | 'van' | 'truck';

export type LineItem = { label: string; amountKobo: number };

export type LegQuote = { lineItems: LineItem[]; totalKobo: number };

export type FeeSettings = {
  baseRateKobo: number;
  perKgRateKobo: number;
  perKmRateKobo: number;
  carrierCommissionRatePct: number;
  taxRatePct: number;
  minPriceKobo: number;
  withdrawalFeeKobo: number;
  weightCorrectionApprovalWindowMin: number;
};

export type VehicleTypeRates = Record<VehicleType, { multiplier: number }>;

export type CompositeQuote = {
  legs: { legType: LegType; legLabel: string; quote: LegQuote }[];
  compositeTotalKobo: number;
};

// ─── Alert System Types ───────────────────────────────────────────────────────

export type AlertRule = (typeof ALERT_RULES)[number];

export type Alert = {
  id: string;
  deliveryId: string | null;
  legId: string | null;
  rule: AlertRule;
  severity: AlertSeverity;
  originalSeverity: AlertSeverity | null;
  context: Record<string, unknown>;
  firedAt: string;
  escalatedAt: string | null;
  resolvedAt: string | null;
  ackBy: string | null;
};

export type AlertSettings = {
  driverSilentWarningMin: number;
  driverSilentCriticalMin: number;
  legOverdueWarningMin: number;
  legOverdueCriticalMin: number;
  customerUpdateGapWarningMin: number;
  customerUpdateGapCriticalMin: number;
  ontimeRateWarningPct: number;
  ontimeRateCriticalPct: number;
  pumbleWebhookUrl: string | null;
  pushEnabled: boolean;
  pumbleEnabled: boolean;
};
