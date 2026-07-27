import {
  pgTable,
  uuid,
  timestamp,
  integer,
  real,
  index,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { deliveryOfferStatus } from './enums';
import { deliveries } from './deliveries';
import { drivers } from './drivers';

export const deliveryOffers = pgTable(
  'delivery_offers',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    driverId: uuid('driver_id').notNull(),
    tier: integer('tier').notNull(),
    score: real('score').notNull(),
    distanceKm: real('distance_km').notNull(),
    status: deliveryOfferStatus('status').default('pending').notNull(),
    offeredAt: timestamp('offered_at').defaultNow().notNull(),
    respondedAt: timestamp('responded_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_delivery_offers_delivery_id').using('btree', table.deliveryId),
    index('idx_delivery_offers_driver_id').using('btree', table.driverId),
    index('idx_delivery_offers_status').using('btree', table.status),
    foreignKey({
      columns: [table.deliveryId],
      foreignColumns: [deliveries.id],
      name: 'delivery_offers_delivery_id_fk',
    }),
    foreignKey({
      columns: [table.driverId],
      foreignColumns: [drivers.id],
      name: 'delivery_offers_driver_id_fk',
    }),
  ],
);
