import { admin, checked } from "../http.ts";
import type { Args, Task } from "./contracts.ts";
export type Step = { status: string; output: unknown; kind?: string };
export type Store = {
  claim(): Promise<Task | null>;
  get(id: string): Promise<Task | null>;
  save(task: Task, patch: Args): Promise<void>;
  begin(
    task: Task,
    key: string,
    kind: string,
  ): Promise<{ fresh: boolean; step: Step }>;
  finish(task: Task, key: string, output: unknown): Promise<void>;
  steps(task: Task): Promise<Record<string, Step>>;
  context(task: Task): Promise<{ profile: unknown; services: string[] }>;
};
export function createStore(db = admin()): Store {
  const rpc = async (name: string, args: Args = {}) =>
    checked(await db.rpc(name, args)).data;
  return {
    async claim() {
      return (await rpc("alo_task_claim"))?.[0] ?? null;
    },
    async get(id) {
      return checked(
        await db.from("alo_tasks").select("*").eq("id", id).maybeSingle(),
      ).data;
    },
    async save(t, patch) {
      if (
        !await rpc("alo_task_save", {
          p_id: t.id,
          p_lease: t.lease_id,
          p_patch: patch,
        })
      ) throw new Error("Lease expired");
    },
    async begin(t, key, kind) {
      return await rpc("alo_step_begin", {
        p_id: t.id,
        p_lease: t.lease_id,
        p_key: key,
        p_kind: kind,
      });
    },
    async finish(t, key, output) {
      if (
        !await rpc("alo_step_finish", {
          p_id: t.id,
          p_lease: t.lease_id,
          p_key: key,
          p_output: output,
        })
      ) throw new Error("Lease expired");
    },
    async steps(t) {
      const rows = checked(
        await db.from("alo_task_steps").select("step_key,status,output,kind")
          .eq("task_id", t.id),
      ).data ?? [];
      return Object.fromEntries(rows.map((r) => [r.step_key, r]));
    },
    async context(t) {
      const [p, c] = await Promise.all([
        db.from("profiles").select("name,notes").eq("id", t.user_id)
          .maybeSingle(),
        db.from("connections").select("service").eq("user_id", t.user_id),
      ]);
      checked(p);
      checked(c);
      return {
        profile: p.data
          ? { name: p.data.name, notes: p.data.notes.slice(0, 12000) }
          : null,
        services: (c.data ?? []).map((r) => r.service),
      };
    },
  };
}
