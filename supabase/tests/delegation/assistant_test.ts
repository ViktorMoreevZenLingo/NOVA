import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { configureAssistantModel } from "../../../NOVA_VOICE/scripts/assistant-model.ts";

Deno.test("Vapi setup: active GPT-Live prompts receive procedures without changing tuning", () => {
  const template = {
    messages: [{ content: "Use the verified account. No PIN." }],
  };
  const original = {
    model: "gpt-live-1",
    toolIds: ["custom"],
    speaker: { instructions: "Speak Bulgarian.", personalityPacks: ["bouncy"] },
    reasoner: {
      instructions: "Custom rule.",
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
    },
  };
  const configured = configureAssistantModel(
    original,
    template,
    ["task"],
    "Current local date. Answer directly.",
  );
  assertStringIncludes(configured.speaker.instructions, "Current local date");
  assertStringIncludes(configured.reasoner.instructions, "No PIN");
  assertStringIncludes(configured.reasoner.instructions, "Custom rule");
  assertEquals(configured.reasoner.model, original.reasoner.model);
  assertEquals(configured.speaker.personalityPacks, ["bouncy"]);
  assertEquals(configured.toolIds, ["custom", "task"]);
  assertEquals(configured.messages, undefined);
  assertEquals(
    configureAssistantModel(
      configured,
      template,
      ["task"],
      "Current local date. Answer directly.",
    ),
    configured,
  );
  assertEquals(original.speaker.instructions, "Speak Bulgarian.");
  const classic = configureAssistantModel({ model: "gpt-4o" }, template, [
    "task",
  ], "Speaker");
  assertEquals(classic.speaker, undefined);
  assertStringIncludes(classic.messages[0].content, "No PIN");
});
