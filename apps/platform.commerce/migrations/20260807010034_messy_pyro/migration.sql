CREATE TABLE `product_asset` (
	`id` text PRIMARY KEY,
	`product_id` text NOT NULL,
	`storage_key` text NOT NULL UNIQUE,
	`content_sha256` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_product_asset_product_id_product_id_fk` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE CASCADE,
	CONSTRAINT "product_asset_size_non_negative" CHECK(size_bytes >= 0)
);
--> statement-breakpoint
ALTER TABLE `product_image` RENAME COLUMN `id` TO `asset_id`;--> statement-breakpoint
-- HAND-ADDED, and the migration is wrong without it: `product_asset` is created
-- empty above, and the recreation below rebuilds `product_image` holding only
-- (asset_id, alt, position). Every existing photograph would be left naming an
-- asset row that does not exist.
--
-- The RENAME above is what makes this a copy rather than a remapping: an
-- image's id BECOMES its asset id, so `product_release_image.image_id` keeps
-- matching and no published release has to be rewritten. Ordering matters —
-- this runs while `product_image` still carries the byte columns, before the
-- recreation drops them (and drops `role` with them).
INSERT INTO `product_asset` (`id`, `product_id`, `storage_key`, `content_sha256`, `content_type`, `size_bytes`, `created_at`)
	SELECT `asset_id`, `product_id`, `storage_key`, `content_sha256`, `content_type`, `size_bytes`, `created_at` FROM `product_image`;--> statement-breakpoint
ALTER TABLE `product_draft` ADD `details_markdown` text;--> statement-breakpoint
ALTER TABLE `product_draft` ADD `size_guide_asset_id` text REFERENCES product_asset(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `product_draft` ADD `size_guide_alt` text;--> statement-breakpoint
ALTER TABLE `product_draft` ADD `size_guide_notes_markdown` text;--> statement-breakpoint
ALTER TABLE `product_release` ADD `details_markdown` text;--> statement-breakpoint
ALTER TABLE `product_release` ADD `size_guide_asset_id` text REFERENCES product_asset(id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `product_release` ADD `size_guide_alt` text;--> statement-breakpoint
ALTER TABLE `product_release` ADD `size_guide_notes_markdown` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_product_image` (
	`asset_id` text PRIMARY KEY,
	`alt` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_product_image_asset_id_product_asset_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `product_asset`(`id`) ON DELETE CASCADE,
	CONSTRAINT "product_image_position_non_negative" CHECK(position >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_product_image`(`asset_id`, `alt`, `position`) SELECT `asset_id`, `alt`, `position` FROM `product_image`;--> statement-breakpoint
DROP TABLE `product_image`;--> statement-breakpoint
ALTER TABLE `__new_product_image` RENAME TO `product_image`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_product_release_image` (
	`release_id` text NOT NULL,
	`image_id` text NOT NULL,
	`alt` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `product_release_image_pk` PRIMARY KEY(`release_id`, `image_id`),
	CONSTRAINT `fk_product_release_image_release_id_product_release_id_fk` FOREIGN KEY (`release_id`) REFERENCES `product_release`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_product_release_image_image_id_product_asset_id_fk` FOREIGN KEY (`image_id`) REFERENCES `product_asset`(`id`) ON DELETE CASCADE,
	CONSTRAINT "product_release_image_position_non_negative" CHECK(position >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_product_release_image`(`release_id`, `image_id`, `alt`, `position`) SELECT `release_id`, `image_id`, `alt`, `position` FROM `product_release_image`;--> statement-breakpoint
DROP TABLE `product_release_image`;--> statement-breakpoint
ALTER TABLE `__new_product_release_image` RENAME TO `product_release_image`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_product_image_product`;--> statement-breakpoint
CREATE INDEX `idx_product_image_position` ON `product_image` (`position`);--> statement-breakpoint
CREATE INDEX `idx_product_release_image_order` ON `product_release_image` (`release_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_product_asset_product` ON `product_asset` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_product_release_size_guide` ON `product_release` (`size_guide_asset_id`);