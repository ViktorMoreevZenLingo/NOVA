package com.alo.agent;

import com.alo.dto.Dtos.AgentResponse;
import com.alo.dto.Dtos.PendingAction;
import com.alo.dto.Dtos.Services;
import com.alo.google.GoogleOAuth;
import com.alo.model.User;
import com.alo.repo.UserRepository;
import com.alo.web.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpSession;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Runs the tool-calling loop against OpenAI. Conversation state lives in the
 * HttpSession so the frontend only sends plain text. Write tools are never
 * executed inside {@link #chat}; they pause for {@link #confirm}.
 */
@Service
public class AgentService {

    private static final Logger log = LoggerFactory.getLogger(AgentService.class);
    private static final int MAX_STEPS = 6;
    private static final String MESSAGES = "agentMessages";
    private static final String PENDING = "agentPending";

    private final OpenAiClient openai;
    private final AgentTools tools;
    private final GoogleOAuth google;
    private final UserRepository users;
    private final ObjectMapper mapper;
    private final ZoneId zone;

    public AgentService(OpenAiClient openai, AgentTools tools, GoogleOAuth google,
            UserRepository users, ObjectMapper mapper, @Value("${app.timezone}") String timezone) {
        this.openai = openai;
        this.tools = tools;
        this.google = google;
        this.users = users;
        this.mapper = mapper;
        this.zone = ZoneId.of(timezone);
    }

    public AgentResponse chat(Long userId, HttpSession session, String userMessage) {
        if (userMessage == null || userMessage.isBlank()) {
            throw ApiException.badRequest("Message is required");
        }
        List<Map<String, Object>> messages = messages(session);
        // If a previous turn left a write action unconfirmed, cancel it so the
        // conversation stays valid before adding the new user turn.
        resolvePendingAsCancelled(session, messages);
        messages.add(Map.of("role", "user", "content", userMessage));
        return runLoop(userId, session, messages);
    }

    public AgentResponse confirm(Long userId, HttpSession session, boolean approved) {
        @SuppressWarnings("unchecked")
        Map<String, String> pending = (Map<String, String>) session.getAttribute(PENDING);
        if (pending == null) {
            throw ApiException.badRequest("Nothing to confirm");
        }
        List<Map<String, Object>> messages = messages(session);
        String content;
        if (approved) {
            content = runTool(userId, pending.get("name"), pending.get("args"));
        } else {
            content = "User declined to perform this action.";
        }
        messages.add(toolResult(pending.get("id"), content));
        session.removeAttribute(PENDING);
        return runLoop(userId, session, messages);
    }

    public void reset(HttpSession session) {
        session.removeAttribute(MESSAGES);
        session.removeAttribute(PENDING);
    }

    // --- core loop ---

    private AgentResponse runLoop(Long userId, HttpSession session, List<Map<String, Object>> messages) {
        Services connected = google.servicesFor(userId);
        List<Map<String, Object>> toolDefs = tools.definitions(connected);

        for (int step = 0; step < MAX_STEPS; step++) {
            List<Map<String, Object>> payload = new ArrayList<>();
            payload.add(systemMessage(userId, connected));
            payload.addAll(messages);

            JsonNode assistant = openai.chat(payload, toolDefs);
            messages.add(assistantMessage(assistant));

            JsonNode toolCalls = assistant.path("tool_calls");
            if (!toolCalls.isArray() || toolCalls.isEmpty()) {
                save(session, messages);
                return new AgentResponse(assistant.path("content").asText(""), null);
            }

            JsonNode call = toolCalls.get(0); // parallel tool calls disabled
            String id = call.path("id").asText();
            String name = call.path("function").path("name").asText();
            String argsJson = call.path("function").path("arguments").asText("{}");

            if (tools.isWriteTool(name)) {
                String summary = tools.summarize(name, parse(argsJson));
                Map<String, String> pending = new LinkedHashMap<>();
                pending.put("id", id);
                pending.put("name", name);
                pending.put("args", argsJson);
                session.setAttribute(PENDING, pending);
                save(session, messages);
                return new AgentResponse(summary, new PendingAction(name, summary));
            }

            String result = runTool(userId, name, argsJson);
            messages.add(toolResult(id, result));
        }

        save(session, messages);
        return new AgentResponse("Sorry, that took too many steps. Please try rephrasing.", null);
    }

    private String runTool(Long userId, String name, String argsJson) {
        try {
            return tools.execute(userId, name, parse(argsJson));
        } catch (Exception e) {
            log.error("Agent tool {} failed", name, e);
            return "Error running " + name + ": " + e.getMessage();
        }
    }

    // --- message helpers ---

    private Map<String, Object> systemMessage(Long userId, Services s) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.unauthorized("Not logged in"));
        String now = ZonedDateTime.now(zone).format(DateTimeFormatter.ofPattern("EEEE, yyyy-MM-dd HH:mm"));
        String about = user.getAbout() == null || user.getAbout().isBlank() ? "(none)" : user.getAbout();
        String prompt = """
                You are Ало (Alo), a helpful voice assistant for %s.
                About the user: %s
                Current date/time: %s (%s).
                Connected services — Gmail: %s, Calendar: %s, Contacts: %s.

                Use the available tools to read email, manage the calendar, send email,
                and look up contacts. Only use tools for connected services.
                When sending an email or creating an event, call the tool with complete,
                correct details; the system will pause and ask the user to confirm before
                it actually happens, so make sure everything is right.
                For calendar questions about a specific day (today, tomorrow, a weekday, or a
                date), work out that calendar date from the current date/time above and call
                list_calendar_events with from and to set to that exact YYYY-MM-DD date, so you
                return only that day's events and label them with the correct day.
                To email someone by name, look them up with search_contacts first.
                Reply in the same language the user writes in (Bulgarian or English).
                Be concise and friendly — your replies may be read aloud.
                """.formatted(user.getName(), about, now, zone.getId(),
                yesNo(s.gmail()), yesNo(s.calendar()), yesNo(s.contacts()));
        return Map.of("role", "system", "content", prompt);
    }

    private Map<String, Object> assistantMessage(JsonNode assistant) {
        Map<String, Object> msg = new LinkedHashMap<>();
        msg.put("role", "assistant");
        JsonNode content = assistant.path("content");
        msg.put("content", content.isNull() || content.isMissingNode() ? null : content.asText());
        JsonNode toolCalls = assistant.path("tool_calls");
        if (toolCalls.isArray() && !toolCalls.isEmpty()) {
            List<Map<String, Object>> cleaned = new ArrayList<>();
            for (JsonNode tc : toolCalls) {
                cleaned.add(Map.of(
                        "id", tc.path("id").asText(),
                        "type", "function",
                        "function", Map.of(
                                "name", tc.path("function").path("name").asText(),
                                "arguments", tc.path("function").path("arguments").asText("{}"))));
            }
            msg.put("tool_calls", cleaned);
        }
        return msg;
    }

    private Map<String, Object> toolResult(String toolCallId, String content) {
        return Map.of("role", "tool", "tool_call_id", toolCallId, "content", content);
    }

    /** Appends a cancellation result for any assistant tool_call still unanswered. */
    private void resolvePendingAsCancelled(HttpSession session, List<Map<String, Object>> messages) {
        Object pending = session.getAttribute(PENDING);
        if (pending == null) {
            return;
        }
        @SuppressWarnings("unchecked")
        Map<String, String> p = (Map<String, String>) pending;
        messages.add(toolResult(p.get("id"), "User moved on without confirming; action cancelled."));
        session.removeAttribute(PENDING);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> messages(HttpSession session) {
        List<Map<String, Object>> messages = (List<Map<String, Object>>) session.getAttribute(MESSAGES);
        if (messages == null) {
            messages = new ArrayList<>();
            session.setAttribute(MESSAGES, messages);
        }
        return messages;
    }

    private void save(HttpSession session, List<Map<String, Object>> messages) {
        session.setAttribute(MESSAGES, messages);
    }

    private JsonNode parse(String json) {
        try {
            return mapper.readTree(json == null || json.isBlank() ? "{}" : json);
        } catch (Exception e) {
            throw ApiException.badRequest("Bad tool arguments: " + e.getMessage());
        }
    }

    private static String yesNo(boolean value) {
        return value ? "yes" : "no";
    }
}
