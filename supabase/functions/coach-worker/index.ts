import { requireEnv } from "../_shared/env.ts";
import { vapiDialerFromEnv } from "../_shared/coach/outbound.ts";
import { createCoachStore } from "../_shared/coach/store.ts";
import { employeeNameLookup } from "../_shared/coach/wiring.ts";
import { coachWorkerHandler } from "./handler.ts";

Deno.serve(coachWorkerHandler(
  { store: createCoachStore(), dial: vapiDialerFromEnv(), employeeName: employeeNameLookup() },
  { cronSecret: requireEnv("CRON_SECRET") },
));
