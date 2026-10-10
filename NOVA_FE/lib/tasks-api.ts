import { invoke } from "./supabase";
export interface DelegatedTask {
  id: string;
  instruction: string;
  status: string;
  revision: number;
  run_at: string | null;
  timezone: string;
  pending: {
    kind: string;
    question: string;
    tool?: string;
    args?: Record<string, unknown>;
  } | null;
  result: string | null;
  error?: string;
  deliveries?: { channel: string; status: string; error: string | null }[];
}
export async function taskRequest(
  action: string,
  task_id: string,
  fields: Record<string, unknown> = {},
) {
  return (
    await invoke<{ task: DelegatedTask }>("tasks", {
      action,
      task_id,
      ...fields,
    })
  ).task;
}
