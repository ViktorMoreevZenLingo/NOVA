type Model = Record<string, any>;
const marker = "ALO CLOUD TASK EXECUTION";
const marked = (previous: string | undefined, instructions: string) =>
  `${(previous ?? "").split(marker)[0].trim()}\n\n${marker}\n${instructions}`
    .trim();

// GPT-Live ignores classic system messages when explicit speaker instructions exist.
// Keep the model, voice-related fields, custom guidance and tuning owned by Vapi.
export function configureAssistantModel(
  existing: Model | undefined,
  template: Model,
  toolIds: string[],
  liveSpeakerInstructions: string,
) {
  const model = structuredClone(existing ?? template);
  model.toolIds = [...new Set([...(existing?.toolIds ?? []), ...toolIds])];
  const instructions = template.messages[0].content;
  model.messages = [
    ...(existing?.messages ?? []).filter((
      m: { role: string; content?: string },
    ) => !(m.role === "system" && m.content?.startsWith(marker))),
    { role: "system", content: `${marker}\n${instructions}` },
  ];
  if (model.model === "gpt-live-1") {
    model.speaker = {
      ...model.speaker,
      instructions: marked(
        model.speaker?.instructions,
        liveSpeakerInstructions,
      ),
    };
    model.reasoner = {
      ...model.reasoner,
      instructions: marked(
        model.reasoner?.instructions,
        `These Alo task procedures govern the tools configured on this assistant.\n${instructions}\nReturn only the concise result or exact missing detail to the speaker. Do not narrate internal reasoning.`,
      ),
    };
  }
  return model;
}
