CREATE TABLE IF NOT EXISTS "logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"deployment_id" uuid NOT NULL,
	"ts" timestamp DEFAULT now() NOT NULL,
	"stream" text NOT NULL,
	"line" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "logs" ADD CONSTRAINT "logs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_deployment_ts_idx" ON "logs" USING btree ("deployment_id","ts");