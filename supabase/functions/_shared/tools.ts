import { accessToken } from "./providers.ts";
import { env, HttpError } from "./http.ts";

type Args = Record<string, unknown>;
const str = (a: Args, key: string) =>
  typeof a[key] === "string" ? a[key] as string : "";
const num = (a: Args, key: string, fallback: number, max: number) =>
  Math.max(1, Math.min(max, Number(a[key]) || fallback));
const fields = (keys: string[]) =>
  Object.fromEntries(keys.map((key) => [key, { type: "string" }]));
const definition = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  },
});
export const writeTools = new Set(["send_email", "create_calendar_event"]);
export const serviceFor: Record<string, string> = {
  list_recent_emails: "gmail",
  search_emails: "gmail",
  get_email: "gmail",
  send_email: "gmail",
  list_calendar_events: "calendar",
  create_calendar_event: "calendar",
  search_contacts: "contacts",
  search_places: "places",
  read_outlook_mail: "outlook",
  read_outlook_calendar: "outlook",
  search_outlook_contacts: "outlook",
};
export function definitions(connected: Set<string>) {
  const all = [
    definition("list_recent_emails", "List recent email.", {
      hours: { type: "integer" },
      max: { type: "integer" },
    }),
    definition("search_emails", "Search Gmail.", {
      ...fields(["query"]),
      max: { type: "integer" },
    }, ["query"]),
    definition("get_email", "Read an email by its ID.", fields(["id"]), ["id"]),
    definition(
      "send_email",
      "Draft an email for explicit user approval. Never sends automatically.",
      fields(["to", "subject", "body", "cc"]),
      ["to", "subject", "body"],
    ),
    definition("list_calendar_events", "List upcoming events.", {
      days_ahead: { type: "integer" },
      max: { type: "integer" },
    }),
    definition(
      "create_calendar_event",
      "Draft a calendar event for explicit user approval. Start and end must include a timezone offset.",
      {
        ...fields(["title", "start", "end", "description", "location"]),
        attendees: { type: "array", items: { type: "string" } },
      },
      ["title", "start", "end"],
    ),
    definition(
      "search_contacts",
      "Find names, emails and phone numbers.",
      fields(["query"]),
      ["query"],
    ),
    definition(
      "search_places",
      "Find places by text, including city/location in the query.",
      fields(["query"]),
      ["query"],
    ),
    definition("read_outlook_mail", "Read recent Outlook mail.", {}),
    definition(
      "read_outlook_calendar",
      "Read upcoming Outlook calendar events.",
      {},
    ),
    definition(
      "search_outlook_contacts",
      "Search Outlook contacts by name.",
      fields(["query"]),
      ["query"],
    ),
  ];
  return all.filter((t) => connected.has(serviceFor[t.function.name]));
}
export function summarize(name: string, a: Args) {
  if (name === "send_email") {
    return `To: ${str(a, "to")}\nCc: ${str(a, "cc")}\nSubject: ${
      str(a, "subject")
    }\n\n${str(a, "body")}`;
  }
  return `${str(a, "title")}\n${str(a, "start")} → ${str(a, "end")}\n${
    str(a, "location")
  }\n${str(a, "description")}\nAttendees: ${
    Array.isArray(a.attendees) ? a.attendees.join(", ") : ""
  }`;
}
const b64 = (value: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(value)));
const decode = (value: string) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0)),
  );
function textPart(part: any): string {
  if (part?.mimeType === "text/plain" && part.body?.data) {
    return decode(part.body.data);
  }
  return (part?.parts || []).map(textPart).find(Boolean) || "";
}
export async function execute(userId: string, name: string, a: Args) {
  const service = serviceFor[name];
  if (!service) throw new HttpError(400, "Unknown tool");
  if (service === "places") {
    const res = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": env("GOOGLE_PLACES_API_KEY"),
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.googleMapsUri,places.nationalPhoneNumber",
        },
        body: JSON.stringify({ textQuery: str(a, "query"), pageSize: 5 }),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!res.ok) throw new HttpError(502, "Places search failed.");
    return res.json();
  }
  const token = await accessToken(userId, service);
  const request = async (url: string, body?: unknown) => {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      throw new HttpError(
        502,
        "The service could not complete this request. Reconnect if the problem persists.",
      );
    }
    return response.json();
  };
  const gmail = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
  const calendar =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  if (name === "list_recent_emails" || name === "search_emails") {
    const query = name === "search_emails"
      ? str(a, "query")
      : `after:${
        Math.floor(Date.now() / 1000 - num(a, "hours", 24, 720) * 3600)
      }`;
    const data = await request(
      `${gmail}?${new URLSearchParams({
        q: query,
        maxResults: String(num(a, "max", 15, 25)),
      })}`,
    );
    return Promise.all((data.messages || []).map(async (m: { id: string }) => {
      const item = await request(
        `${gmail}/${
          encodeURIComponent(m.id)
        }?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      );
      return {
        id: item.id,
        snippet: item.snippet,
        headers: item.payload?.headers,
      };
    }));
  }
  if (name === "get_email") {
    const data = await request(
      `${gmail}/${encodeURIComponent(str(a, "id"))}?format=full`,
    );
    return {
      id: data.id,
      headers: data.payload?.headers,
      body: textPart(data.payload).slice(0, 20000),
    };
  }
  if (name === "send_email") {
    for (const key of ["to", "cc"]) {
      if (/[\r\n]/.test(str(a, key))) {
        throw new HttpError(400, "Invalid recipient");
      }
    }
    if (!str(a, "to").includes("@")) {
      throw new HttpError(400, "A recipient email address is required.");
    }
    const mime = `To: ${str(a, "to")}\r\n${
      str(a, "cc") ? `Cc: ${str(a, "cc")}\r\n` : ""
    }Subject: =?UTF-8?B?${
      b64(str(a, "subject"))
    }?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${
      b64(str(a, "body")).match(/.{1,76}/g)?.join("\r\n") || ""
    }`;
    return request(`${gmail}/send`, {
      raw: b64(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    });
  }
  if (name === "list_calendar_events") {
    return request(`${calendar}?${new URLSearchParams({
      timeMin: new Date().toISOString(),
      timeMax: new Date(Date.now() + num(a, "days_ahead", 7, 365) * 86400000)
        .toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(num(a, "max", 15, 50)),
    })}`);
  }
  if (name === "create_calendar_event") {
    const start = str(a, "start"), end = str(a, "end");
    if (
      ![start, end].every((t) =>
        /(Z|[+-]\d\d:\d\d)$/.test(t) && Number.isFinite(Date.parse(t))
      ) || Date.parse(end) <= Date.parse(start)
    ) {
      throw new HttpError(
        400,
        "Use a valid start and end with timezone offsets.",
      );
    }
    return request(calendar, {
      summary: str(a, "title"),
      description: str(a, "description"),
      location: str(a, "location"),
      start: { dateTime: start },
      end: { dateTime: end },
      attendees: Array.isArray(a.attendees)
        ? a.attendees.map((email) => ({ email }))
        : [],
    });
  }
  if (name === "search_contacts") {
    return request(
      `https://people.googleapis.com/v1/people:searchContacts?${new URLSearchParams(
        {
          query: str(a, "query"),
          readMask: "names,emailAddresses,phoneNumbers",
          pageSize: "20",
        },
      )}`,
    );
  }
  const graph = "https://graph.microsoft.com/v1.0/me";
  if (name === "read_outlook_mail") {
    return request(
      `${graph}/messages?$top=15&$select=id,subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime%20desc`,
    );
  }
  if (name === "read_outlook_calendar") {
    return request(
      `${graph}/calendarView?${new URLSearchParams({
        startDateTime: new Date().toISOString(),
        endDateTime: new Date(Date.now() + 7 * 86400000).toISOString(),
        "$top": "25",
        "$select": "subject,start,end,location",
      })}`,
    );
  }
  if (name === "search_outlook_contacts") {
    return request(
      `${graph}/contacts?${new URLSearchParams({
        "$filter": `startswith(displayName,'${
          str(a, "query").replace(/'/g, "''")
        }')`,
        "$top": "20",
        "$select": "displayName,emailAddresses,mobilePhone,businessPhones",
      })}`,
    );
  }
  throw new HttpError(400, "Unknown tool");
}
