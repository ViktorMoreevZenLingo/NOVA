package com.alo.agent;

import com.alo.dto.Dtos.Services;
import com.alo.google.GoogleClients;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.api.client.util.DateTime;
import com.google.api.services.calendar.model.Event;
import com.google.api.services.calendar.model.EventAttendee;
import com.google.api.services.calendar.model.EventDateTime;
import com.google.api.services.gmail.model.Message;
import com.google.api.services.gmail.model.MessagePart;
import com.google.api.services.gmail.model.MessagePartHeader;
import com.google.api.services.people.v1.model.EmailAddress;
import com.google.api.services.people.v1.model.Name;
import com.google.api.services.people.v1.model.Person;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The agent's toolbox: JSON schemas advertised to OpenAI plus the code that runs
 * each tool against Gmail / Calendar / People. Read tools run freely; the two
 * write tools (send_email, create_calendar_event) are gated by {@link AgentService}.
 */
@Component
public class AgentTools {

    private static final Logger log = LoggerFactory.getLogger(AgentTools.class);

    private final GoogleClients clients;
    private final ObjectMapper mapper;
    private final ZoneId zone;

    public AgentTools(GoogleClients clients, ObjectMapper mapper,
            @Value("${app.timezone}") String timezone) {
        this.clients = clients;
        this.mapper = mapper;
        this.zone = ZoneId.of(timezone);
    }

    public boolean isWriteTool(String name) {
        return "send_email".equals(name) || "create_calendar_event".equals(name);
    }

    /** Advertises only the tools whose underlying service is connected. */
    public List<Map<String, Object>> definitions(Services connected) {
        List<Map<String, Object>> tools = new ArrayList<>();
        if (connected.gmail()) {
            tools.add(tool("list_recent_emails", "List the user's most recent emails (default last 24 hours).",
                    obj(prop("hours", "integer", "How far back to look, in hours. Default 24."),
                            prop("max", "integer", "Max emails to return. Default 15."))));
            tools.add(tool("search_emails", "Search the user's mailbox using Gmail search syntax or keywords.",
                    required(obj(prop("query", "string", "Gmail search query, e.g. 'from:boss invoice'."),
                            prop("max", "integer", "Max results. Default 15.")), "query")));
            tools.add(tool("get_email", "Get the full content of one email by its id.",
                    required(obj(prop("id", "string", "The email id from a list/search result.")), "id")));
            tools.add(tool("send_email", "Send an email on the user's behalf. Requires confirmation.",
                    required(obj(prop("to", "string", "Recipient email address."),
                            prop("subject", "string", "Email subject."),
                            prop("body", "string", "Email body (plain text)."),
                            prop("cc", "string", "Optional CC email address.")), "to", "subject", "body")));
        }
        if (connected.calendar()) {
            tools.add(tool("list_calendar_events", "List upcoming calendar events.",
                    obj(prop("days_ahead", "integer", "How many days ahead to look. Default 7."),
                            prop("max", "integer", "Max events. Default 15."))));
            tools.add(tool("create_calendar_event", "Create a calendar event. Requires confirmation.",
                    required(obj(prop("title", "string", "Event title."),
                            prop("start", "string", "Start, ISO local time e.g. 2026-10-11T14:00:00."),
                            prop("end", "string", "End, ISO local time e.g. 2026-10-11T15:00:00."),
                            prop("description", "string", "Optional description."),
                            prop("location", "string", "Optional location."),
                            arrayProp("attendees", "string", "Optional attendee email addresses.")),
                            "title", "start", "end")));
        }
        if (connected.contacts()) {
            tools.add(tool("search_contacts", "Find a contact's email address by name.",
                    required(obj(prop("query", "string", "Name or partial name to search for.")), "query")));
        }
        return tools;
    }

    /** A short human-readable description of a pending write action, for confirmation. */
    public String summarize(String name, JsonNode args) {
        if ("send_email".equals(name)) {
            return "Send email to " + args.path("to").asText("?")
                    + (args.hasNonNull("cc") ? " (cc " + args.path("cc").asText() + ")" : "")
                    + "\nSubject: " + args.path("subject").asText("")
                    + "\n\n" + args.path("body").asText("");
        }
        if ("create_calendar_event".equals(name)) {
            return "Create event \"" + args.path("title").asText("") + "\""
                    + "\nFrom: " + args.path("start").asText("")
                    + "\nTo: " + args.path("end").asText("")
                    + (args.hasNonNull("location") ? "\nLocation: " + args.path("location").asText() : "")
                    + (args.path("attendees").isArray() && args.path("attendees").size() > 0
                            ? "\nAttendees: " + join(args.path("attendees")) : "");
        }
        return name;
    }

    /** Runs a tool and returns a string result to feed back to the model. */
    public String execute(Long userId, String name, JsonNode args) throws Exception {
        log.info("Agent tool: {} args={}", name, args);
        return switch (name) {
            case "list_recent_emails" -> listRecentEmails(userId, args);
            case "search_emails" -> searchEmails(userId, args);
            case "get_email" -> getEmail(userId, args);
            case "send_email" -> sendEmail(userId, args);
            case "list_calendar_events" -> listEvents(userId, args);
            case "create_calendar_event" -> createEvent(userId, args);
            case "search_contacts" -> searchContacts(userId, args);
            default -> "Unknown tool: " + name;
        };
    }

    // --- Gmail ---

    private String listRecentEmails(Long userId, JsonNode args) throws Exception {
        int hours = args.path("hours").asInt(24);
        int max = args.path("max").asInt(15);
        long afterEpoch = Instant.now().minusSeconds(hours * 3600L).getEpochSecond();
        return listMessages(userId, "after:" + afterEpoch, max);
    }

    private String searchEmails(Long userId, JsonNode args) throws Exception {
        return listMessages(userId, args.path("query").asText(""), args.path("max").asInt(15));
    }

    private String listMessages(Long userId, String query, int max) throws Exception {
        var gmail = clients.gmail(userId);
        var list = gmail.users().messages().list("me").setQ(query).setMaxResults((long) max).execute();
        List<Map<String, Object>> out = new ArrayList<>();
        if (list.getMessages() != null) {
            for (Message ref : list.getMessages()) {
                Message m = gmail.users().messages().get("me", ref.getId()).setFormat("metadata")
                        .setMetadataHeaders(List.of("From", "Subject", "Date")).execute();
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("id", m.getId());
                row.put("from", header(m, "From"));
                row.put("subject", header(m, "Subject"));
                row.put("date", header(m, "Date"));
                row.put("snippet", m.getSnippet());
                out.add(row);
            }
        }
        return mapper.writeValueAsString(Map.of("count", out.size(), "emails", out));
    }

    private String getEmail(Long userId, JsonNode args) throws Exception {
        var gmail = clients.gmail(userId);
        Message m = gmail.users().messages().get("me", args.path("id").asText()).setFormat("full").execute();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("from", header(m, "From"));
        out.put("to", header(m, "To"));
        out.put("subject", header(m, "Subject"));
        out.put("date", header(m, "Date"));
        out.put("body", extractBody(m.getPayload()));
        return mapper.writeValueAsString(out);
    }

    private String sendEmail(Long userId, JsonNode args) throws Exception {
        String to = args.path("to").asText();
        String cc = args.path("cc").asText(null);
        String subject = args.path("subject").asText("");
        String body = args.path("body").asText("");

        StringBuilder mime = new StringBuilder();
        mime.append("To: ").append(to).append("\r\n");
        if (cc != null && !cc.isBlank()) {
            mime.append("Cc: ").append(cc).append("\r\n");
        }
        mime.append("Subject: =?UTF-8?B?")
                .append(Base64.getEncoder().encodeToString(subject.getBytes(StandardCharsets.UTF_8)))
                .append("?=\r\n");
        mime.append("MIME-Version: 1.0\r\n");
        mime.append("Content-Type: text/plain; charset=UTF-8\r\n");
        mime.append("Content-Transfer-Encoding: base64\r\n\r\n");
        mime.append(Base64.getMimeEncoder().encodeToString(body.getBytes(StandardCharsets.UTF_8)));

        Message msg = new Message();
        msg.setRaw(Base64.getUrlEncoder().encodeToString(mime.toString().getBytes(StandardCharsets.UTF_8)));
        Message sent = clients.gmail(userId).users().messages().send("me", msg).execute();
        return "Email sent (id " + sent.getId() + ").";
    }

    // --- Calendar ---

    private String listEvents(Long userId, JsonNode args) throws Exception {
        int days = args.path("days_ahead").asInt(7);
        int max = args.path("max").asInt(15);
        DateTime now = new DateTime(System.currentTimeMillis());
        DateTime until = new DateTime(System.currentTimeMillis() + days * 86400000L);
        var events = clients.calendar(userId).events().list("primary")
                .setTimeMin(now).setTimeMax(until)
                .setSingleEvents(true).setOrderBy("startTime").setMaxResults(max).execute();
        List<Map<String, Object>> out = new ArrayList<>();
        if (events.getItems() != null) {
            for (Event e : events.getItems()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("id", e.getId());
                row.put("summary", e.getSummary());
                row.put("start", e.getStart() == null ? null : String.valueOf(
                        e.getStart().getDateTime() != null ? e.getStart().getDateTime() : e.getStart().getDate()));
                row.put("end", e.getEnd() == null ? null : String.valueOf(
                        e.getEnd().getDateTime() != null ? e.getEnd().getDateTime() : e.getEnd().getDate()));
                row.put("location", e.getLocation());
                out.add(row);
            }
        }
        return mapper.writeValueAsString(Map.of("count", out.size(), "events", out));
    }

    private String createEvent(Long userId, JsonNode args) throws Exception {
        Event event = new Event()
                .setSummary(args.path("title").asText(""))
                .setDescription(args.path("description").asText(null))
                .setLocation(args.path("location").asText(null))
                .setStart(eventTime(args.path("start").asText()))
                .setEnd(eventTime(args.path("end").asText()));
        if (args.path("attendees").isArray()) {
            List<EventAttendee> attendees = new ArrayList<>();
            for (JsonNode a : args.path("attendees")) {
                attendees.add(new EventAttendee().setEmail(a.asText()));
            }
            if (!attendees.isEmpty()) {
                event.setAttendees(attendees);
            }
        }
        Event created = clients.calendar(userId).events().insert("primary", event).execute();
        return "Event created: " + created.getHtmlLink();
    }

    private EventDateTime eventTime(String value) {
        Instant instant;
        try {
            instant = OffsetDateTime.parse(value).toInstant();
        } catch (Exception e) {
            instant = LocalDateTime.parse(value).atZone(zone).toInstant();
        }
        return new EventDateTime().setDateTime(new DateTime(instant.toEpochMilli())).setTimeZone(zone.getId());
    }

    // --- Contacts ---

    private String searchContacts(Long userId, JsonNode args) throws Exception {
        String query = args.path("query").asText("").toLowerCase();
        var resp = clients.people(userId).people().connections().list("people/me")
                .setPersonFields("names,emailAddresses").setPageSize(1000).execute();
        List<Map<String, Object>> out = new ArrayList<>();
        if (resp.getConnections() != null) {
            for (Person p : resp.getConnections()) {
                String name = p.getNames() == null || p.getNames().isEmpty()
                        ? "" : p.getNames().get(0).getDisplayName();
                if (!query.isEmpty() && !name.toLowerCase().contains(query)) {
                    continue;
                }
                if (p.getEmailAddresses() != null) {
                    for (EmailAddress ea : p.getEmailAddresses()) {
                        out.add(Map.of("name", name, "email", ea.getValue()));
                    }
                }
                if (out.size() >= 10) {
                    break;
                }
            }
        }
        return mapper.writeValueAsString(Map.of("count", out.size(), "contacts", out));
    }

    // --- helpers ---

    private static String header(Message m, String name) {
        if (m.getPayload() == null || m.getPayload().getHeaders() == null) {
            return "";
        }
        for (MessagePartHeader h : m.getPayload().getHeaders()) {
            if (h.getName().equalsIgnoreCase(name)) {
                return h.getValue();
            }
        }
        return "";
    }

    private static String extractBody(MessagePart part) {
        if (part == null) {
            return "";
        }
        if ("text/plain".equals(part.getMimeType()) && part.getBody() != null && part.getBody().getData() != null) {
            return new String(Base64.getUrlDecoder().decode(part.getBody().getData()), StandardCharsets.UTF_8);
        }
        if (part.getParts() != null) {
            for (MessagePart sub : part.getParts()) {
                String text = extractBody(sub);
                if (!text.isBlank()) {
                    return text;
                }
            }
        }
        return "";
    }

    private static String join(JsonNode array) {
        List<String> values = new ArrayList<>();
        array.forEach(n -> values.add(n.asText()));
        return String.join(", ", values);
    }

    // --- tiny JSON-schema builders ---

    private static Map<String, Object> tool(String name, String description, Map<String, Object> parameters) {
        return Map.of("type", "function", "function",
                Map.of("name", name, "description", description, "parameters", parameters));
    }

    private static Map<String, Object> obj(Map.Entry<String, Object>... props) {
        Map<String, Object> properties = new LinkedHashMap<>();
        for (Map.Entry<String, Object> p : props) {
            properties.put(p.getKey(), p.getValue());
        }
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");
        schema.put("properties", properties);
        return schema;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> required(Map<String, Object> schema, String... names) {
        schema.put("required", List.of(names));
        return schema;
    }

    private static Map.Entry<String, Object> prop(String name, String type, String description) {
        return Map.entry(name, Map.of("type", type, "description", description));
    }

    private static Map.Entry<String, Object> arrayProp(String name, String itemType, String description) {
        return Map.entry(name, Map.of("type", "array", "description", description,
                "items", Map.of("type", itemType)));
    }
}
