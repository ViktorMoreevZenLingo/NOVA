// Shared by the advertised tool schemas and delegated argument validation.
export const queryLimit = (tool: string, key: string) =>
  key === "hours"
    ? 720
    : key === "days_ahead"
    ? 365
    : tool === "list_calendar_events"
    ? 50
    : 25;

export const queryLimitSchema = (tool: string, key: string) => ({
  type: "integer",
  minimum: 1,
  maximum: queryLimit(tool, key),
});
