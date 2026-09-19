CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_login_unique` ON `users` (`login`);
--> statement-breakpoint
INSERT OR IGNORE INTO `users` (`id`, `login`, `name`) SELECT `owner_id`, 'legacy-' || `owner_id`, 'Я' FROM `workspaces`;
--> statement-breakpoint
ALTER TABLE `agent_tokens` ADD `user_id` text;
--> statement-breakpoint
UPDATE `agent_tokens` SET `user_id` = `owner_id` WHERE `user_id` IS NULL;
--> statement-breakpoint
CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `spaces` (`id`, `name`, `kind`, `created_by`) SELECT `id`, 'Личное', 'private', `id` FROM `users`;
--> statement-breakpoint
CREATE TABLE `space_members` (
	`space_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`space_id`, `user_id`)
);
--> statement-breakpoint
INSERT OR IGNORE INTO `space_members` (`space_id`, `user_id`, `role`) SELECT `id`, `id`, 'owner' FROM `users`;
--> statement-breakpoint
CREATE TABLE `space_invites` (
	`hash` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_by` text NOT NULL,
	`consumed` integer DEFAULT 0 NOT NULL,
	`consumed_by` text
);
