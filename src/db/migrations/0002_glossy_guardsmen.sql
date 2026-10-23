CREATE TABLE `transaction_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`allowed` integer NOT NULL,
	CONSTRAINT "transaction_precondition" CHECK("transaction_guards"."allowed"=1)
);
