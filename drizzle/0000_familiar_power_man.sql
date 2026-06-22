CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`suit` text NOT NULL,
	`rank` text NOT NULL,
	`is_wild` integer DEFAULT false NOT NULL,
	`is_hidden_wild` integer DEFAULT false NOT NULL,
	`owner_player_id` integer,
	`location` text DEFAULT 'deck' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`declared_group_id` text,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `game_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`player_id` integer,
	`event_type` text NOT NULL,
	`payload` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`max_score` integer DEFAULT 200 NOT NULL,
	`current_turn_player_id` integer,
	`dealer_player_id` integer,
	`round_number` integer DEFAULT 1 NOT NULL,
	`wild_card_suit` text,
	`wild_card_rank` text,
	`winner_player_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_code_unique` ON `games` (`code`);--> statement-breakpoint
CREATE TABLE `player_hands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` integer NOT NULL,
	`has_declared` integer DEFAULT false NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_hands_player_id_unique` ON `player_hands` (`player_id`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`turn_order` integer DEFAULT 0 NOT NULL,
	`is_online` integer DEFAULT true NOT NULL,
	`net_score` integer DEFAULT 0 NOT NULL,
	`is_eliminated` integer DEFAULT false NOT NULL,
	`joined_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`uid`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `round_scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`round_number` integer NOT NULL,
	`player_id` integer NOT NULL,
	`current_points` integer DEFAULT 0 NOT NULL,
	`net_score_after` integer DEFAULT 0 NOT NULL,
	`is_winner` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`uid` text PRIMARY KEY NOT NULL,
	`mobile` text NOT NULL,
	`display_name` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_mobile_unique` ON `users` (`mobile`);--> statement-breakpoint
CREATE TABLE `wild_card_approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`claim_id` integer NOT NULL,
	`verifier_player_id` integer NOT NULL,
	`approved` integer NOT NULL,
	`logged_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`comments` text,
	FOREIGN KEY (`claim_id`) REFERENCES `wild_card_claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`verifier_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wild_card_approvals_claim_id_unique` ON `wild_card_approvals` (`claim_id`);--> statement-breakpoint
CREATE TABLE `wild_card_claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`claimant_player_id` integer NOT NULL,
	`verifier_player_id` integer NOT NULL,
	`card_rank` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`card_ids` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claimant_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`verifier_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
