import { relations } from "drizzle-orm/relations";
import { users, drivers, carriers, nameChangeRequests, usersInAuth, userSavedAddresses, recentLocations, notifications, deliveries, carrierMembers, userRoles, roleAuditLog } from "./schema";

export const driversRelations = relations(drivers, ({one, many}) => ({
	user: one(users, {
		fields: [drivers.userId],
		references: [users.id]
	}),
	deliveries: many(deliveries),
}));

export const usersRelations = relations(users, ({many}) => ({
	drivers: many(drivers),
	carriers: many(carriers),
	nameChangeRequests_reviewedBy: many(nameChangeRequests, {
		relationName: "nameChangeRequests_reviewedBy_users_id"
	}),
	nameChangeRequests_userId: many(nameChangeRequests, {
		relationName: "nameChangeRequests_userId_users_id"
	}),
	notifications: many(notifications),
	deliveries: many(deliveries),
	carrierMembers_invitedBy: many(carrierMembers, {
		relationName: "carrierMembers_invitedBy_users_id"
	}),
	carrierMembers_userId: many(carrierMembers, {
		relationName: "carrierMembers_userId_users_id"
	}),
	userRoles_assignedBy: many(userRoles, {
		relationName: "userRoles_assignedBy_users_id"
	}),
	userRoles_userId: many(userRoles, {
		relationName: "userRoles_userId_users_id"
	}),
	roleAuditLogs_performedBy: many(roleAuditLog, {
		relationName: "roleAuditLog_performedBy_users_id"
	}),
	roleAuditLogs_userId: many(roleAuditLog, {
		relationName: "roleAuditLog_userId_users_id"
	}),
}));

export const carriersRelations = relations(carriers, ({one, many}) => ({
	user: one(users, {
		fields: [carriers.verifiedBy],
		references: [users.id]
	}),
	deliveries: many(deliveries),
	carrierMembers: many(carrierMembers),
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

export const userSavedAddressesRelations = relations(userSavedAddresses, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [userSavedAddresses.userId],
		references: [usersInAuth.id]
	}),
}));

export const usersInAuthRelations = relations(usersInAuth, ({many}) => ({
	userSavedAddresses: many(userSavedAddresses),
	recentLocations: many(recentLocations),
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

export const deliveriesRelations = relations(deliveries, ({one}) => ({
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