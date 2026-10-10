export type Args = Record<string, unknown>;
export type Grant = {
  tool: string;
  constraints: Args;
  generated_fields: string[];
};
export type Decision = {
  kind: "read" | "action" | "done" | "question";
  tool: string;
  args: string;
  text: string;
};
export type State = {
  phase: "create" | "poll" | "tools" | "reply";
  round: number;
  sequence?: number;
  decision?: Decision;
  reply?: string;
  consumed_event?: string;
};
export type Task = {
  id: string;
  user_id: string;
  instruction: string;
  status: string;
  call_id: string | null;
  start_mode: string;
  run_at: string | null;
  timezone: string;
  grants: Grant[];
  delivery_channels: string[];
  state: State;
  pending: Args | null;
  revision: number;
  manus_task_id: string | null;
  manus_task_url: string | null;
  result: string | null;
  lease_id: string;
  cancel_requested: boolean;
  failures: number;
  created_at: string;
};
export type ManusTaskInput = { content: string; connectors: string[] };
export const decisionSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["read", "action", "done", "question"] },
    tool: { type: "string" },
    args: {
      type: "string",
      description: "JSON object of arguments; empty object for done/question",
    },
    text: {
      type: "string",
      description:
        "Final result or clarification question; never claim a proposed action has executed.",
    },
  },
  required: ["kind", "tool", "args", "text"],
  additionalProperties: false,
};
