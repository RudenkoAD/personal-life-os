CREATE TABLE `feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`url` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_feeds_owner` ON `feeds` (`owner_id`);--> statement-breakpoint
CREATE TABLE `agent_tokens` (
	`hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tokens_owner` ON `agent_tokens` (`owner_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);
