import { relations } from "drizzle-orm/relations";
import { usersInAuth, userSavedAddresses, recentLocations, users, notifications, carriers, userRoles, carrierMembers, roleAuditLog, drivers, nameChangeRequests, wallets, walletTransactions, deliveries, escrowHolds, payoutRequests } from "./schema";

export const userSavedAddressesRelations = relations(userSavedAddresses, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [userSavedAddresses.userId],
		references: [usersInAuth.id]
	}),
}));

export const usersInAuthRelations = relations(usersInAuth, ({many}) => ({
	userSavedAddresses: many(userSavedAddresses),
	recentLocations: many(recentLocations),
	wallets: many(wallets),
}));

export const recentLocationsRelations = relations(recentLocations, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [recentLocations.userId],
		references: [usersInAuth.id]
	}),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	user: one(users, {
		fields: [notifications.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	notifications: many(notifications),
	carriers: many(carriers),
	userRoles_assignedBy: many(userRoles, {
		relationName: "userRoles_assignedBy_users_id"
	}),
	userRoles_userId: many(userRoles, {
		relationName: "userRoles_userId_users_id"
	}),
	carrierMembers_invitedBy: many(carrierMembers, {
		relationName: "carrierMembers_invitedBy_users_id"
	}),
	carrierMembers_userId: many(carrierMembers, {
		relationName: "carrierMembers_userId_users_id"
	}),
	roleAuditLogs_performedBy: many(roleAuditLog, {
		relationName: "roleAuditLog_performedBy_users_id"
	}),
	roleAuditLogs_userId: many(roleAuditLog, {
		relationName: "roleAuditLog_userId_users_id"
	}),
	drivers: many(drivers),
	nameChangeRequests_reviewedBy: many(nameChangeRequests, {
		relationName: "nameChangeRequests_reviewedBy_users_id"
	}),
	nameChangeRequests_userId: many(nameChangeRequests, {
		relationName: "nameChangeRequests_userId_users_id"
	}),
	deliveries: many(deliveries),
}));

export const carriersRelations = relations(carriers, ({one, many}) => ({
	user: one(users, {
		fields: [carriers.verifiedBy],
		references: [users.id]
	}),
	carrierMembers: many(carrierMembers),
	deliveries: many(deliveries),
}));

export const userRolesRelations = relations(userRoles, ({one}) => ({
	user_assignedBy: one(users, {
		fields: [userRoles.assignedBy],
		references: [users.id],
		relationName: "userRoles_assignedBy_users_id"
	}),
	user_userId: one(users, {
		fields: [userRoles.userId],
		references: [users.id],
		relationName: "userRoles_userId_users_id"
	}),
}));

export const carrierMembersRelations = relations(carrierMembers, ({one}) => ({
	carrier: one(carriers, {
		fields: [carrierMembers.carrierId],
		references: [carriers.id]
	}),
	user_invitedBy: one(users, {
		fields: [carrierMembers.invitedBy],
		references: [users.id],
		relationName: "carrierMembers_invitedBy_users_id"
	}),
	user_userId: one(users, {
		fields: [carrierMembers.userId],
		references: [users.id],
		relationName: "carrierMembers_userId_users_id"
	}),
}));

export const roleAuditLogRelations = relations(roleAuditLog, ({one}) => ({
	user_performedBy: one(users, {
		fields: [roleAuditLog.performedBy],
		references: [users.id],
		relationName: "roleAuditLog_performedBy_users_id"
	}),
	user_userId: one(users, {
		fields: [roleAuditLog.userId],
		references: [users.id],
		relationName: "roleAuditLog_userId_users_id"
	}),
}));

export const driversRelations = relations(drivers, ({one, many}) => ({
	user: one(users, {
		fields: [drivers.userId],
		references: [users.id]
	}),
	deliveries: many(deliveries),
}));

export const nameChangeRequestsRelations = relations(nameChangeRequests, ({one}) => ({
	user_reviewedBy: one(users, {
		fields: [nameChangeRequests.reviewedBy],
		references: [users.id],
		relationName: "nameChangeRequests_reviewedBy_users_id"
	}),
	user_userId: one(users, {
		fields: [nameChangeRequests.userId],
		references: [users.id],
		relationName: "nameChangeRequests_userId_users_id"
	}),
}));

export const walletsRelations = relations(wallets, ({one, many}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [wallets.userId],
		references: [usersInAuth.id]
	}),
	walletTransactions: many(walletTransactions),
	escrowHolds_driverWalletId: many(escrowHolds, {
		relationName: "escrowHolds_driverWalletId_wallets_id"
	}),
	escrowHolds_senderWalletId: many(escrowHolds, {
		relationName: "escrowHolds_senderWalletId_wallets_id"
	}),
	payoutRequests: many(payoutRequests),
}));

export const walletTransactionsRelations = relations(walletTransactions, ({one}) => ({
	wallet: one(wallets, {
		fields: [walletTransactions.walletId],
		references: [wallets.id]
	}),
}));

export const escrowHoldsRelations = relations(escrowHolds, ({one, many}) => ({
	delivery: one(deliveries, {
		fields: [escrowHolds.deliveryId],
		references: [deliveries.id],
		relationName: "escrowHolds_deliveryId_deliveries_id"
	}),
	wallet_driverWalletId: one(wallets, {
		fields: [escrowHolds.driverWalletId],
		references: [wallets.id],
		relationName: "escrowHolds_driverWalletId_wallets_id"
	}),
	wallet_senderWalletId: one(wallets, {
		fields: [escrowHolds.senderWalletId],
		references: [wallets.id],
		relationName: "escrowHolds_senderWalletId_wallets_id"
	}),
	deliveries: many(deliveries, {
		relationName: "deliveries_escrowHoldId_escrowHolds_id"
	}),
}));

export const deliveriesRelations = relations(deliveries, ({one, many}) => ({
	escrowHolds: many(escrowHolds, {
		relationName: "escrowHolds_deliveryId_deliveries_id"
	}),
	carrier: one(carriers, {
		fields: [deliveries.carrierId],
		references: [carriers.id]
	}),
	user: one(users, {
		fields: [deliveries.customerId],
		references: [users.id]
	}),
	driver: one(drivers, {
		fields: [deliveries.driverId],
		references: [drivers.id]
	}),
	escrowHold: one(escrowHolds, {
		fields: [deliveries.escrowHoldId],
		references: [escrowHolds.id],
		relationName: "deliveries_escrowHoldId_escrowHolds_id"
	}),
}));

export const payoutRequestsRelations = relations(payoutRequests, ({one}) => ({
	wallet: one(wallets, {
		fields: [payoutRequests.walletId],
		references: [wallets.id]
	}),
}));