import { invoke } from "./supabase";
export interface PendingAction {
  id: string;
  type: string;
  summary: string;
}
export interface AgentResponse {
  reply: string;
  pending: PendingAction | null;
}
export const sendChat = (message: string) =>
  invoke<AgentResponse>("agent", { action: "chat", message });
export const confirmAction = (approved: boolean, pendingId: string) =>
  invoke<AgentResponse>("agent", { action: "confirm", approved, pendingId });
export const resetChat = () => invoke<void>("agent", { action: "reset" });
export const appendChat = (turns: { role: "user" | "alo"; text: string }[]) =>
  invoke<void>("agent", { action: "append", turns });
export const loadChat = () =>
  invoke<{
    messages: { role: "user" | "alo"; text: string }[];
    pending: PendingAction | null;
  }>("agent", { action: "load" });
