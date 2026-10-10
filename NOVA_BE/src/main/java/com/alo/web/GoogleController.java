package com.alo.web;

import com.alo.google.GoogleOAuth;
import jakarta.servlet.http.HttpSession;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/google")
public class GoogleController {

    private static final Logger log = LoggerFactory.getLogger(GoogleController.class);
    private static final SecureRandom RANDOM = new SecureRandom();

    private static final String STATE_KEY = "oauthState";
    private static final String SERVICE_KEY = "oauthService";

    private final GoogleOAuth google;
    private final String publicUrl;

    public GoogleController(GoogleOAuth google, @Value("${app.public-url}") String publicUrl) {
        this.google = google;
        this.publicUrl = publicUrl;
    }

    /** Starts the OAuth flow: stores a random state + the requested service, redirects to Google. */
    @GetMapping("/connect")
    public ResponseEntity<Void> connect(@RequestParam String service, HttpSession session) {
        google.scopeFor(service); // validates the service name (400 if unknown)
        String state = newState();
        session.setAttribute(STATE_KEY, state);
        session.setAttribute(SERVICE_KEY, service);
        String url = google.authorizationUrl(service, state);
        return redirect(url);
    }

    /** Google calls this back with the code; we exchange it and bounce to the frontend. */
    @GetMapping("/callback")
    public ResponseEntity<Void> callback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String error,
            HttpSession session) {

        String expectedState = (String) session.getAttribute(STATE_KEY);
        String service = (String) session.getAttribute(SERVICE_KEY);
        session.removeAttribute(STATE_KEY);
        session.removeAttribute(SERVICE_KEY);

        log.info("OAuth: callback service={} error={} stateOk={}",
                service, error, expectedState != null && expectedState.equals(state));

        if (error != null) {
            return redirect(homeError(error));
        }
        if (expectedState == null || !expectedState.equals(state)) {
            return redirect(homeError("Invalid state"));
        }
        if (code == null || service == null) {
            return redirect(homeError("Missing code"));
        }

        try {
            Long userId = Sessions.requireUserId(session);
            google.handleCallback(userId, service, code);
            return redirect(publicUrl + "/home?connected=" + service);
        } catch (Exception e) {
            log.error("OAuth: callback handling failed", e);
            return redirect(homeError(e.getMessage()));
        }
    }

    /** Turns a service off. */
    @DeleteMapping("/{service}")
    public ResponseEntity<Void> disconnect(@PathVariable String service, HttpSession session) {
        google.disable(Sessions.requireUserId(session), service);
        return ResponseEntity.noContent().build();
    }

    private String homeError(String message) {
        String msg = message == null ? "unknown" : message;
        return publicUrl + "/home?error=" + URLEncoder.encode(msg, StandardCharsets.UTF_8);
    }

    private static ResponseEntity<Void> redirect(String url) {
        return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(url)).build();
    }

    private static String newState() {
        byte[] bytes = new byte[24];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
