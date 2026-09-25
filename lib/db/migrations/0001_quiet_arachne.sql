CREATE TABLE IF NOT EXISTS "Project" (
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"targetUrl" text NOT NULL,
	"environment" varchar DEFAULT 'staging' NOT NULL,
	"authConfig" json,
	"githubRepo" varchar(256),
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"userId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TestSession" (
	"browserSessionId" text,
	"chatId" uuid NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"liveUrl" text,
	"projectId" uuid,
	"status" varchar DEFAULT 'initializing' NOT NULL,
	"targetUrl" text NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "QAFinding" (
	"actualResult" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"evidence" json NOT NULL,
	"expectedResult" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"likelyCause" text,
	"recordingUrl" text,
	"reproductionSteps" json NOT NULL,
	"severity" varchar NOT NULL,
	"suggestedFix" text,
	"testSessionId" uuid NOT NULL,
	"title" text NOT NULL,
	"verdict" varchar NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "TestSession" ADD CONSTRAINT "TestSession_chatId_Chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."Chat"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "TestSession" ADD CONSTRAINT "TestSession_projectId_Project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "QAFinding" ADD CONSTRAINT "QAFinding_testSessionId_TestSession_id_fk" FOREIGN KEY ("testSessionId") REFERENCES "public"."TestSession"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
