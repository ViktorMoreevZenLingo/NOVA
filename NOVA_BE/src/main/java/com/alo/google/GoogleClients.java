package com.alo.google;

import com.google.api.services.calendar.Calendar;
import com.google.api.services.gmail.Gmail;
import com.google.api.services.people.v1.PeopleService;
import com.google.auth.http.HttpCredentialsAdapter;
import com.google.auth.oauth2.AccessToken;
import com.google.auth.oauth2.GoogleCredentials;
import org.springframework.stereotype.Component;

/**
 * Builds authenticated Calendar / Gmail / People clients for a user, using a
 * fresh access token from {@link GoogleOAuth} (auto-refreshed when expired).
 */
@Component
public class GoogleClients {

    private static final String APP_NAME = "NOVA AI";

    private final GoogleOAuth oauth;

    public GoogleClients(GoogleOAuth oauth) {
        this.oauth = oauth;
    }

    public Calendar calendar(Long userId) {
        return new Calendar.Builder(GoogleOAuth.httpTransport(), GoogleOAuth.jsonFactory(), init(userId))
                .setApplicationName(APP_NAME)
                .build();
    }

    public Gmail gmail(Long userId) {
        return new Gmail.Builder(GoogleOAuth.httpTransport(), GoogleOAuth.jsonFactory(), init(userId))
                .setApplicationName(APP_NAME)
                .build();
    }

    public PeopleService people(Long userId) {
        return new PeopleService.Builder(GoogleOAuth.httpTransport(), GoogleOAuth.jsonFactory(), init(userId))
                .setApplicationName(APP_NAME)
                .build();
    }

    private HttpCredentialsAdapter init(Long userId) {
        String token = oauth.getValidAccessToken(userId);
        GoogleCredentials creds = GoogleCredentials.create(new AccessToken(token, null));
        return new HttpCredentialsAdapter(creds);
    }
}
