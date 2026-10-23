CREATE TABLE `access_policies` (
	`user_id` text PRIMARY KEY NOT NULL,
	`must_rotate` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `approval_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`draft_hash` text NOT NULL,
	`control_revision` integer NOT NULL,
	`settings_revision` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_challenges_token_hash_unique` ON `approval_challenges` (`token_hash`);--> statement-breakpoint
CREATE TABLE `approved_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submission_project_version` ON `approved_submissions` (`project_id`,`version`);--> statement-breakpoint
CREATE TABLE `care_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`minutes` integer NOT NULL,
	`description` text NOT NULL,
	`performed_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `care_project_time` ON `care_requests` (`project_id`,`performed_at`);--> statement-breakpoint
CREATE TABLE `credential_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`request_id` text,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`claim_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_id`) REFERENCES `reset_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credential_tokens_token_hash_unique` ON `credential_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `credential_token_user` ON `credential_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `inbox_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`visibility` text DEFAULT 'shared' NOT NULL,
	`section` text,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`classification` text,
	`size` text,
	`quote_php` integer,
	`affected_sections` text,
	`baseline_version` integer,
	`admin_read_at` integer,
	`client_read_at` integer,
	`approved_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inbox_project_updated` ON `inbox_items` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `inbox_status_kind` ON `inbox_items` (`status`,`kind`);--> statement-breakpoint
CREATE TABLE `inbox_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`author_id` text NOT NULL,
	`author_role` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inbox_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reply_item_time` ON `inbox_replies` (`item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `page_reviews` (
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`path` text NOT NULL,
	`status` text NOT NULL,
	`notes` text,
	`evidence_links` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `version`, `path`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `portal_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_controls` (
	`project_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`baseline_version` integer DEFAULT 0 NOT NULL,
	`editable_sections` text,
	`manual_scope` text,
	`launch_at` integer,
	`test_url` text,
	`approver_name` text,
	`approver_email` text,
	`approver_method` text,
	`approver_verified_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reset_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reset_company_status` ON `reset_requests` (`company_id`,`status`);--> statement-breakpoint
CREATE TABLE `scope_amendments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`previous` text NOT NULL,
	`next` text NOT NULL,
	`reason` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `amendment_project` ON `scope_amendments` (`project_id`);--> statement-breakpoint
CREATE TABLE `section_leases` (
	`project_id` text NOT NULL,
	`section` text NOT NULL,
	`session_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `section`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
