CREATE TABLE `caldav_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`url` text NOT NULL,
	`credentials` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_caldav_owner` ON `caldav_connections` (`owner_id`);