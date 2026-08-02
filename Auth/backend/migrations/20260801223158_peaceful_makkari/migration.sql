CREATE TABLE `apikey` (
	`id` text PRIMARY KEY,
	`configId` text DEFAULT 'default' NOT NULL,
	`name` text,
	`start` text,
	`referenceId` text NOT NULL,
	`prefix` text,
	`key` text NOT NULL,
	`refillInterval` integer,
	`refillAmount` integer,
	`lastRefillAt` integer,
	`enabled` integer DEFAULT true,
	`rateLimitEnabled` integer DEFAULT true,
	`rateLimitTimeWindow` integer DEFAULT 86400000,
	`rateLimitMax` integer DEFAULT 10,
	`requestCount` integer DEFAULT 0,
	`remaining` integer,
	`lastRequest` integer,
	`expiresAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`permissions` text,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `deviceCode` (
	`id` text PRIMARY KEY,
	`deviceCode` text NOT NULL,
	`userCode` text NOT NULL,
	`userId` text,
	`expiresAt` integer NOT NULL,
	`status` text NOT NULL,
	`lastPolledAt` integer,
	`pollingInterval` integer,
	`clientId` text,
	`scope` text
);
--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY,
	`organizationId` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`inviterId` text NOT NULL,
	CONSTRAINT `fk_invitation_organizationId_organization_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_invitation_inviterId_user_id_fk` FOREIGN KEY (`inviterId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `jwks` (
	`id` text PRIMARY KEY,
	`publicKey` text NOT NULL,
	`privateKey` text NOT NULL,
	`createdAt` integer NOT NULL,
	`expiresAt` integer
);
--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY,
	`organizationId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`createdAt` integer NOT NULL,
	CONSTRAINT `fk_member_organizationId_organization_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_member_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauthAccessToken` (
	`id` text PRIMARY KEY,
	`token` text NOT NULL UNIQUE,
	`clientId` text NOT NULL,
	`sessionId` text,
	`userId` text,
	`referenceId` text,
	`refreshId` text,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`scopes` text NOT NULL,
	CONSTRAINT `fk_oauthAccessToken_clientId_oauthClient_clientId_fk` FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauthAccessToken_sessionId_session_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `session`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_oauthAccessToken_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauthAccessToken_refreshId_oauthRefreshToken_id_fk` FOREIGN KEY (`refreshId`) REFERENCES `oauthRefreshToken`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauthClient` (
	`id` text PRIMARY KEY,
	`clientId` text NOT NULL UNIQUE,
	`clientSecret` text,
	`disabled` integer DEFAULT false,
	`skipConsent` integer,
	`enableEndSession` integer,
	`subjectType` text,
	`scopes` text,
	`userId` text,
	`createdAt` integer,
	`updatedAt` integer,
	`name` text,
	`uri` text,
	`icon` text,
	`contacts` text,
	`tos` text,
	`policy` text,
	`softwareId` text,
	`softwareVersion` text,
	`softwareStatement` text,
	`redirectUris` text NOT NULL,
	`postLogoutRedirectUris` text,
	`tokenEndpointAuthMethod` text,
	`grantTypes` text,
	`responseTypes` text,
	`public` integer,
	`type` text,
	`requirePKCE` integer,
	`referenceId` text,
	`metadata` text,
	CONSTRAINT `fk_oauthClient_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauthConsent` (
	`id` text PRIMARY KEY,
	`clientId` text NOT NULL,
	`userId` text,
	`referenceId` text,
	`scopes` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	CONSTRAINT `fk_oauthConsent_clientId_oauthClient_clientId_fk` FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauthConsent_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauthRefreshToken` (
	`id` text PRIMARY KEY,
	`token` text NOT NULL UNIQUE,
	`clientId` text NOT NULL,
	`sessionId` text,
	`userId` text NOT NULL,
	`referenceId` text,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`revoked` integer,
	`authTime` integer,
	`scopes` text NOT NULL,
	CONSTRAINT `fk_oauthRefreshToken_clientId_oauthClient_clientId_fk` FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauthRefreshToken_sessionId_session_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `session`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_oauthRefreshToken_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`logo` text,
	`createdAt` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY,
	`name` text,
	`publicKey` text NOT NULL,
	`userId` text NOT NULL,
	`credentialID` text NOT NULL,
	`counter` integer NOT NULL,
	`deviceType` text NOT NULL,
	`backedUp` integer NOT NULL,
	`transports` text,
	`createdAt` integer,
	`aaguid` text,
	CONSTRAINT `fk_passkey_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `twoFactor` (
	`id` text PRIMARY KEY,
	`secret` text NOT NULL,
	`backupCodes` text NOT NULL,
	`userId` text NOT NULL,
	`verified` integer DEFAULT true,
	`failedVerificationCount` integer DEFAULT 0,
	`lockedUntil` integer,
	CONSTRAINT `fk_twoFactor_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `session` ADD `impersonatedBy` text;--> statement-breakpoint
ALTER TABLE `session` ADD `activeOrganizationId` text;--> statement-breakpoint
ALTER TABLE `user` ADD `username` text;--> statement-breakpoint
ALTER TABLE `user` ADD `displayUsername` text;--> statement-breakpoint
ALTER TABLE `user` ADD `role` text;--> statement-breakpoint
ALTER TABLE `user` ADD `banned` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `user` ADD `banReason` text;--> statement-breakpoint
ALTER TABLE `user` ADD `banExpires` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `twoFactorEnabled` integer DEFAULT false;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`username` text UNIQUE,
	`displayUsername` text,
	`role` text,
	`banned` integer DEFAULT false,
	`banReason` text,
	`banExpires` integer,
	`twoFactorEnabled` integer DEFAULT false
);
--> statement-breakpoint
INSERT INTO `__new_user`(`id`, `name`, `email`, `emailVerified`, `image`, `createdAt`, `updatedAt`) SELECT `id`, `name`, `email`, `emailVerified`, `image`, `createdAt`, `updatedAt` FROM `user`;--> statement-breakpoint
DROP TABLE `user`;--> statement-breakpoint
ALTER TABLE `__new_user` RENAME TO `user`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `apikey_configId_idx` ON `apikey` (`configId`);--> statement-breakpoint
CREATE INDEX `apikey_referenceId_idx` ON `apikey` (`referenceId`);--> statement-breakpoint
CREATE INDEX `apikey_key_idx` ON `apikey` (`key`);--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organizationId`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE INDEX `member_organizationId_idx` ON `member` (`organizationId`);--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`userId`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_clientId_idx` ON `oauthAccessToken` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_sessionId_idx` ON `oauthAccessToken` (`sessionId`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_userId_idx` ON `oauthAccessToken` (`userId`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_refreshId_idx` ON `oauthAccessToken` (`refreshId`);--> statement-breakpoint
CREATE INDEX `oauthClient_userId_idx` ON `oauthClient` (`userId`);--> statement-breakpoint
CREATE INDEX `oauthConsent_clientId_idx` ON `oauthConsent` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauthConsent_userId_idx` ON `oauthConsent` (`userId`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_clientId_idx` ON `oauthRefreshToken` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_sessionId_idx` ON `oauthRefreshToken` (`sessionId`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_userId_idx` ON `oauthRefreshToken` (`userId`);--> statement-breakpoint
CREATE INDEX `passkey_userId_idx` ON `passkey` (`userId`);--> statement-breakpoint
CREATE INDEX `passkey_credentialID_idx` ON `passkey` (`credentialID`);--> statement-breakpoint
CREATE INDEX `twoFactor_secret_idx` ON `twoFactor` (`secret`);--> statement-breakpoint
CREATE INDEX `twoFactor_userId_idx` ON `twoFactor` (`userId`);