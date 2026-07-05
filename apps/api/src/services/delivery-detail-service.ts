import { db } from '@surewaka/db';
import { deliveries, users, drivers, carriers } from '@surewaka/db';
import { eq } from 'drizzle-orm';
import type { DeliveryDetail } from '@surewaka/shared';

export async function getDeliveryDetail(id: string): Promise<DeliveryDetail | null> {
  const [row] = await db
    .select({
      id: deliveries.id,
      status: deliveries.status,
      pickupAddress: deliveries.pickupAddress,
      pickupCity: deliveries.pickupCity,
      pickupLat: deliveries.pickupLat,
      pickupLng: deliveries.pickupLng,
      dropoffAddress: deliveries.dropoffAddress,
      dropoffCity: deliveries.dropoffCity,
      dropoffLat: deliveries.dropoffLat,
      dropoffLng: deliveries.dropoffLng,
      packageDescription: deliveries.packageDescription,
      packageWeight: deliveries.packageWeight,
      packageCategory: deliveries.packageCategory,
      deliveryNotes: deliveries.deliveryNotes,
      price: deliveries.price,
      amountPaid: deliveries.amountPaid,
      paymentStatus: deliveries.paymentStatus,
      createdAt: deliveries.createdAt,
      updatedAt: deliveries.updatedAt,
      recipientName: deliveries.recipientName,
      recipientPhone: deliveries.recipientPhone,
      senderPhone: deliveries.senderPhone,
      // Customer fields
      customerId: deliveries.customerId,
      customerName: users.name,
      customerPhone: users.phone,
      // Driver fields
      driverId: deliveries.driverId,
      driverTableId: drivers.id,
      driverUserId: drivers.userId,
      driverVehicleType: drivers.vehicleType,
      driverLicensePlate: drivers.licensePlate,
      // Carrier fields
      carrierId: deliveries.carrierId,
      carrierTableId: carriers.id,
      carrierName: carriers.name,
      carrierSlug: carriers.slug,
    })
    .from(deliveries)
    .innerJoin(users, eq(users.id, deliveries.customerId))
    .leftJoin(drivers, eq(drivers.id, deliveries.driverId))
    .leftJoin(carriers, eq(carriers.id, deliveries.carrierId))
    .where(eq(deliveries.id, id))
    .limit(1);

  if (!row) return null;

  // Resolve driver name via a separate lookup on users table (driver -> user)
  let driverName: string | null = null;
  if (row.driverUserId) {
    const [driverUser] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, row.driverUserId))
      .limit(1);
    driverName = driverUser?.name ?? null;
  }

  return {
    id: row.id,
    status: row.status,
    pickupAddress: row.pickupAddress,
    pickupCity: row.pickupCity,
    pickupLat: row.pickupLat,
    pickupLng: row.pickupLng,
    dropoffAddress: row.dropoffAddress,
    dropoffCity: row.dropoffCity,
    dropoffLat: row.dropoffLat,
    dropoffLng: row.dropoffLng,
    packageDescription: row.packageDescription,
    packageWeight: row.packageWeight,
    packageCategory: row.packageCategory,
    deliveryNotes: row.deliveryNotes,
    price: row.price,
    amountPaid: row.amountPaid,
    paymentStatus: row.paymentStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    recipientName: row.recipientName,
    recipientPhone: row.recipientPhone,
    senderPhone: row.senderPhone,
    customer: {
      id: row.customerId,
      name: row.customerName,
      phone: row.customerPhone,
    },
    driver: row.driverTableId
      ? {
          id: row.driverTableId,
          userId: row.driverUserId!,
          name: driverName ?? '',
          vehicleType: row.driverVehicleType!,
          licensePlate: row.driverLicensePlate!,
        }
      : null,
    carrier: row.carrierTableId
      ? {
          id: row.carrierTableId,
          name: row.carrierName!,
          slug: row.carrierSlug!,
        }
      : null,
  };
}
