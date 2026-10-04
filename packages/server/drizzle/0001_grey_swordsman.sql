CREATE TABLE IF NOT EXISTS "state_kv" (
	"agent_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "state_kv_agent_id_key_pk" PRIMARY KEY("agent_id","key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "state_kv" ADD CONSTRAINT "state_kv_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
