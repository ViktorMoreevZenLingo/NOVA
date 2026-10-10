package com.alo.agent;

import com.alo.web.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/** Thin wrapper over the OpenAI Chat Completions API (tool calling enabled). */
@Component
public class OpenAiClient {

    private static final Logger log = LoggerFactory.getLogger(OpenAiClient.class);

    private final RestClient http;
    private final String apiKey;
    private final String model;

    public OpenAiClient(@Value("${openai.api-key}") String apiKey,
            @Value("${openai.model}") String model,
            @Value("${openai.base-url}") String baseUrl) {
        this.apiKey = apiKey;
        this.model = model;
        this.http = RestClient.builder().baseUrl(baseUrl).build();
        if (apiKey == null || apiKey.isBlank()) {
            log.warn("OPENAI_API_KEY not set — the agent will not work until it is configured");
        }
    }

    /**
     * Sends the conversation plus tool definitions and returns the assistant
     * message node ({@code choices[0].message}), which may contain tool_calls.
     */
    public JsonNode chat(List<Map<String, Object>> messages, List<Map<String, Object>> tools) {
        if (apiKey == null || apiKey.isBlank()) {
            throw ApiException.badRequest("OPENAI_API_KEY is not configured");
        }
        Map<String, Object> body = Map.of(
                "model", model,
                "messages", messages,
                "tools", tools,
                "tool_choice", "auto",
                "parallel_tool_calls", false);

        JsonNode response = http.post()
                .uri("/chat/completions")
                .header("Authorization", "Bearer " + apiKey)
                .body(body)
                .retrieve()
                .onStatus(HttpStatusCode::isError, (req, res) -> {
                    String err = new String(res.getBody().readAllBytes());
                    log.error("OpenAI error {}: {}", res.getStatusCode(), err);
                    throw ApiException.badRequest("OpenAI error: " + err);
                })
                .body(JsonNode.class);

        return response.path("choices").path(0).path("message");
    }
}
