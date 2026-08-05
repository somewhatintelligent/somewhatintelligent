CREATE TABLE `product_draft_market` (
	`product_id` text NOT NULL,
	`market` text NOT NULL,
	`price_cents` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	CONSTRAINT `product_draft_market_pk` PRIMARY KEY(`product_id`, `market`),
	CONSTRAINT `fk_product_draft_market_product_id_product_id_fk` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE CASCADE,
	CONSTRAINT "product_draft_market_price_non_negative" CHECK(price_cents >= 0)
);
--> statement-breakpoint
CREATE TABLE `product_release_market` (
	`release_id` text NOT NULL,
	`market` text NOT NULL,
	`price_cents` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	CONSTRAINT `product_release_market_pk` PRIMARY KEY(`release_id`, `market`),
	CONSTRAINT `fk_product_release_market_release_id_product_release_id_fk` FOREIGN KEY (`release_id`) REFERENCES `product_release`(`id`) ON DELETE CASCADE,
	CONSTRAINT "product_release_market_price_non_negative" CHECK(price_cents >= 0)
);
--> statement-breakpoint
-- HAND-ADDED, before the recreations below drop the price columns: every
-- existing single price becomes that product's CANADIAN price, active, so a
-- catalogue published before markets existed keeps selling at home. US rows
-- are deliberately NOT invented — a US price is a pricing decision.
INSERT INTO `product_draft_market` (`product_id`, `market`, `price_cents`, `active`)
	SELECT `product_id`, 'CA', `price_cents`, 1 FROM `product_draft`;--> statement-breakpoint
INSERT INTO `product_release_market` (`release_id`, `market`, `price_cents`, `active`)
	SELECT `id`, 'CA', `price_cents`, 1 FROM `product_release`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_product_draft` (
	`product_id` text PRIMARY KEY,
	`revision` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`description_markdown` text,
	`updated_by_sub` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_product_draft_product_id_product_id_fk` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE CASCADE,
	CONSTRAINT "product_draft_revision_min" CHECK(revision >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_product_draft`(`product_id`, `revision`, `title`, `description_markdown`, `updated_by_sub`, `updated_at`) SELECT `product_id`, `revision`, `title`, `description_markdown`, `updated_by_sub`, `updated_at` FROM `product_draft`;--> statement-breakpoint
DROP TABLE `product_draft`;--> statement-breakpoint
ALTER TABLE `__new_product_draft` RENAME TO `product_draft`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_product_release` (
	`id` text PRIMARY KEY,
	`product_id` text NOT NULL,
	`version` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description_markdown` text,
	`published_by_sub` text NOT NULL,
	`published_at` integer NOT NULL,
	CONSTRAINT `fk_product_release_product_id_product_id_fk` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_product_release`(`id`, `product_id`, `version`, `slug`, `title`, `description_markdown`, `published_by_sub`, `published_at`) SELECT `id`, `product_id`, `version`, `slug`, `title`, `description_markdown`, `published_by_sub`, `published_at` FROM `product_release`;--> statement-breakpoint
DROP TABLE `product_release`;--> statement-breakpoint
ALTER TABLE `__new_product_release` RENAME TO `product_release`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `product_release_product_version_unique` ON `product_release` (`product_id`,`version`);