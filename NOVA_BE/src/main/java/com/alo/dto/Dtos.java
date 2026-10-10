package com.alo.dto;

import java.time.Instant;

/**
 * Request and response shapes for the API, grouped in one place so the whole
 * contract is easy to read. The frontend is already built against these.
 */
public final class Dtos {

    private Dtos() {}

    // --- Requests ---
    public record RegisterRequest(String phone, String name) {}

    public record LoginRequest(String phone) {}

    public record UpdateMeRequest(String name, String about) {}

    // --- Responses ---
    public record UserResponse(Long id, String phone, String name, String about, Instant createdAt) {}

    public record Services(boolean calendar, boolean contacts, boolean gmail) {}

    public record MeResponse(String phone, String name, String about, Services services) {}

    // --- Agent ---
    public record AgentChatRequest(String message) {}

    public record AgentConfirmRequest(boolean approved) {}

    /** A drafted write action awaiting the user's confirmation. */
    public record PendingAction(String type, String summary) {}

    public record AgentResponse(String reply, PendingAction pending) {}
}
