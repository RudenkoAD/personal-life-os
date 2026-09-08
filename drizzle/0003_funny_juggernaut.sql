CREATE TABLE `mutations` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`hash` text NOT NULL,
	`revision` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
