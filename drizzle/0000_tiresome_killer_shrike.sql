CREATE TABLE "cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"suit" text NOT NULL,
	"rank" text NOT NULL,
	"is_wild" boolean DEFAULT false NOT NULL,
	"is_hidden_wild" boolean DEFAULT false NOT NULL,
	"owner_player_id" integer,
	"location" text DEFAULT 'deck' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"declared_group_id" text
);
--> statement-breakpoint
CREATE TABLE "game_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"player_id" integer,
	"event_type" text NOT NULL,
	"payload" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"game_type" text DEFAULT 'dummy_set' NOT NULL,
	"max_score" integer DEFAULT 200 NOT NULL,
	"game_amount" integer DEFAULT 0 NOT NULL,
	"current_turn_player_id" integer,
	"dealer_player_id" integer,
	"round_number" integer DEFAULT 1 NOT NULL,
	"wild_card_suit" text,
	"wild_card_rank" text,
	"winner_player_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "games_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "player_hands" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"has_declared" boolean DEFAULT false NOT NULL,
	"has_dropped" boolean DEFAULT false NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "player_hands_player_id_unique" UNIQUE("player_id")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"username" text NOT NULL,
	"turn_order" integer DEFAULT 0 NOT NULL,
	"is_online" boolean DEFAULT true NOT NULL,
	"net_score" integer DEFAULT 0 NOT NULL,
	"is_eliminated" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "round_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"round_number" integer NOT NULL,
	"player_id" integer NOT NULL,
	"current_points" integer DEFAULT 0 NOT NULL,
	"net_score_after" integer DEFAULT 0 NOT NULL,
	"is_winner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"uid" text PRIMARY KEY NOT NULL,
	"mobile" text NOT NULL,
	"display_name" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_mobile_unique" UNIQUE("mobile")
);
--> statement-breakpoint
CREATE TABLE "wild_card_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"verifier_player_id" integer NOT NULL,
	"approved" boolean NOT NULL,
	"logged_at" timestamp DEFAULT now() NOT NULL,
	"comments" text,
	CONSTRAINT "wild_card_approvals_claim_id_unique" UNIQUE("claim_id")
);
--> statement-breakpoint
CREATE TABLE "wild_card_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"claimant_player_id" integer NOT NULL,
	"verifier_player_id" integer NOT NULL,
	"card_rank" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" text NOT NULL,
	"card_ids" json NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_owner_player_id_players_id_fk" FOREIGN KEY ("owner_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_hands" ADD CONSTRAINT "player_hands_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_users_uid_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("uid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_scores" ADD CONSTRAINT "round_scores_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_scores" ADD CONSTRAINT "round_scores_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wild_card_approvals" ADD CONSTRAINT "wild_card_approvals_claim_id_wild_card_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."wild_card_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wild_card_approvals" ADD CONSTRAINT "wild_card_approvals_verifier_player_id_players_id_fk" FOREIGN KEY ("verifier_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wild_card_claims" ADD CONSTRAINT "wild_card_claims_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wild_card_claims" ADD CONSTRAINT "wild_card_claims_claimant_player_id_players_id_fk" FOREIGN KEY ("claimant_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wild_card_claims" ADD CONSTRAINT "wild_card_claims_verifier_player_id_players_id_fk" FOREIGN KEY ("verifier_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;