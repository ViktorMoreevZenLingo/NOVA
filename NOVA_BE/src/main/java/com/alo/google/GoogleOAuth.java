package com.alo.google;

import com.alo.dto.Dtos;
import com.alo.model.GoogleConnection;
import com.alo.repo.GoogleConnectionRepository;
import com.alo.web.ApiException;
import com.google.api.client.googleapis.auth.oauth2.GoogleAuthorizationCodeRequestUrl;
import com.google.api.client.googleapis.auth.oauth2.GoogleAuthorizationCodeTokenRequest;
import com.google.api.client.googleapis.auth.oauth2.GoogleRefreshTokenRequest;
import com.google.api.client.googleapis.auth.oauth2.GoogleTokenResponse;
import com.google.api.client.googleapis.javanet.GoogleNetHttpTransport;
import com.google.api.client.http.HttpTransport;
import com.google.api.client.json.JsonFactory;
import com.google.api.client.json.gson.GsonFactory;
import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Everything Google-related in one place: building consent URLs, exchanging and
 * refreshing tokens, persisting the per-user connection, and handing out a valid
 * access token for the voice tools to use.
 */
@Service
public class GoogleOAuth {

    private static final Logger log = LoggerFactory.getLogger(GoogleOAuth.class);

    // Scopes, one per service. Calendar and Gmail are read+write so the agent
    // can create events and send mail; contacts stays read-only (name -> email).
    public static final String CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
    public static final String CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";
    public static final String GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

    private static final HttpTransport HTTP_TRANSPORT;
    private static final JsonFactory JSON_FACTORY = GsonFactory.getDefaultInstance();

    static {
        try {
            HTTP_TRANSPORT = GoogleNetHttpTransport.newTrustedTransport();
        } catch (Exception e) {
            throw new IllegalStateException("Cannot init Google HTTP transport", e);
        }
    }

    private final GoogleConnectionRepository connections;
    private final String clientId;
    private final String clientSecret;
    private final String publicUrl;

    public GoogleOAuth(GoogleConnectionRepository connections,
            @Value("${google.client-id}") String clientId,
            @Value("${google.client-secret}") String clientSecret,
            @Value("${app.public-url}") String publicUrl) {
        this.connections = connections;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.publicUrl = publicUrl;
        if (clientId == null || clientId.isBlank() || clientSecret == null || clientSecret.isBlank()) {
            log.warn("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — Google OAuth will not work until they are configured");
        }
    }

    /** The redirect URI Google calls back; it goes through the Next.js proxy. */
    public String redirectUri() {
        return publicUrl + "/api/google/callback";
    }

    /** Scope for a service name, or 400 for an unknown service. */
    public String scopeFor(String service) {
        return switch (service) {
            case "calendar" -> CALENDAR_SCOPE;
            case "contacts" -> CONTACTS_SCOPE;
            case "gmail" -> GMAIL_SCOPE;
            default -> throw ApiException.badRequest("Unknown service: " + service);
        };
    }

    /** Builds the Google consent URL for one service, using incremental auth. */
    public String authorizationUrl(String service, String state) {
        GoogleAuthorizationCodeRequestUrl url = new GoogleAuthorizationCodeRequestUrl(
                clientId, redirectUri(), List.of(scopeFor(service)))
                .setAccessType("offline")
                .setState(state);
        url.set("include_granted_scopes", true);
        url.set("prompt", "consent");
        String built = url.build();
        log.info("OAuth: built consent URL for service={} redirectUri={}", service, redirectUri());
        return built;
    }

    /**
     * Exchanges the authorization code and persists the result: stores/updates
     * tokens and granted scopes, and flips the requested service's flag on.
     */
    public void handleCallback(Long userId, String service, String code) {
        log.info("OAuth: exchanging code for userId={} service={}", userId, service);
        GoogleTokenResponse token;
        try {
            token = new GoogleAuthorizationCodeTokenRequest(
                    HTTP_TRANSPORT, JSON_FACTORY, clientId, clientSecret, code, redirectUri())
                    .execute();
        } catch (Exception e) {
            log.error("OAuth: code exchange failed", e);
            throw ApiException.badRequest("Token exchange failed: " + e.getMessage());
        }

        GoogleConnection conn = connections.findByUserId(userId).orElseGet(() -> {
            GoogleConnection c = new GoogleConnection();
            c.setUserId(userId);
            return c;
        });

        if (token.getRefreshToken() != null) {
            conn.setRefreshToken(token.getRefreshToken());
        }
        conn.setAccessToken(token.getAccessToken());
        conn.setAccessTokenExpiry(expiryFrom(token.getExpiresInSeconds()));
        conn.setGrantedScopes(mergeScopes(conn.getGrantedScopes(), token.getScope()));
        enableFlag(conn, service, true);

        connections.save(conn);
        log.info("OAuth: stored tokens for userId={} grantedScopes=[{}]", userId, conn.getGrantedScopes());
    }

    /**
     * Returns a valid access token for the user, refreshing it when expired.
     * The voice tools (Calendar, Gmail, Contacts) will use this.
     */
    public String getValidAccessToken(Long userId) {
        GoogleConnection conn = connections.findByUserId(userId)
                .orElseThrow(() -> ApiException.badRequest("No Google connection for user"));

        boolean valid = conn.getAccessToken() != null
                && conn.getAccessTokenExpiry() != null
                && Instant.now().isBefore(conn.getAccessTokenExpiry().minusSeconds(60));
        if (valid) {
            return conn.getAccessToken();
        }

        if (conn.getRefreshToken() == null) {
            throw ApiException.badRequest("No refresh token; user must reconnect Google");
        }
        log.info("OAuth: refreshing access token for userId={}", userId);
        try {
            GoogleTokenResponse token = new GoogleRefreshTokenRequest(
                    HTTP_TRANSPORT, JSON_FACTORY, conn.getRefreshToken(), clientId, clientSecret)
                    .execute();
            conn.setAccessToken(token.getAccessToken());
            conn.setAccessTokenExpiry(expiryFrom(token.getExpiresInSeconds()));
            connections.save(conn);
            return conn.getAccessToken();
        } catch (Exception e) {
            log.error("OAuth: token refresh failed", e);
            throw ApiException.badRequest("Token refresh failed: " + e.getMessage());
        }
    }

    /** Disables a service flag (DELETE /api/google/{service}). */
    public void disable(Long userId, String service) {
        scopeFor(service); // validates the service name
        connections.findByUserId(userId).ifPresent(conn -> {
            enableFlag(conn, service, false);
            connections.save(conn);
        });
    }

    /**
     * Computes which services count as connected: the flag must be on AND the
     * scope must actually be granted. Returns all-false if there's no connection.
     */
    public Dtos.Services servicesFor(Long userId) {
        GoogleConnection conn = connections.findByUserId(userId).orElse(null);
        if (conn == null) {
            return new Dtos.Services(false, false, false);
        }
        Set<String> granted = scopeSet(conn.getGrantedScopes());
        return new Dtos.Services(
                conn.isCalendarEnabled() && granted.contains(CALENDAR_SCOPE),
                conn.isContactsEnabled() && granted.contains(CONTACTS_SCOPE),
                conn.isGmailEnabled() && granted.contains(GMAIL_SCOPE));
    }

    // Shared transport/factory so the API-service clients can reuse them.
    public static HttpTransport httpTransport() {
        return HTTP_TRANSPORT;
    }

    public static JsonFactory jsonFactory() {
        return JSON_FACTORY;
    }

    // --- helpers ---

    private static Instant expiryFrom(Long expiresInSeconds) {
        long seconds = expiresInSeconds == null ? 3600 : expiresInSeconds;
        return Instant.now().plusSeconds(seconds);
    }

    private static void enableFlag(GoogleConnection conn, String service, boolean value) {
        switch (service) {
            case "calendar" -> conn.setCalendarEnabled(value);
            case "contacts" -> conn.setContactsEnabled(value);
            case "gmail" -> conn.setGmailEnabled(value);
            default -> throw ApiException.badRequest("Unknown service: " + service);
        }
    }

    private static String mergeScopes(String existing, String incoming) {
        Set<String> all = new LinkedHashSet<>(scopeSet(existing));
        all.addAll(scopeSet(incoming));
        return String.join(" ", all);
    }

    private static Set<String> scopeSet(String scopes) {
        if (scopes == null || scopes.isBlank()) {
            return Set.of();
        }
        return new LinkedHashSet<>(Arrays.asList(scopes.trim().split("\\s+")));
    }
}
