package com.alo.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;
import java.time.Instant;

/** One Google connection per user, holding tokens and per-service flags. */
@Entity
@Table(name = "google_connections")
public class GoogleConnection {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private Long userId;

    @Lob
    @Column(columnDefinition = "TEXT")
    private String refreshToken;

    @Lob
    @Column(columnDefinition = "TEXT")
    private String accessToken;

    private Instant accessTokenExpiry;

    // Space-separated list of scopes Google has actually granted.
    @Lob
    @Column(columnDefinition = "TEXT")
    private String grantedScopes;

    @Column(nullable = false)
    private boolean calendarEnabled;

    @Column(nullable = false)
    private boolean contactsEnabled;

    @Column(nullable = false)
    private boolean gmailEnabled;

    public Long getId() {
        return id;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public String getRefreshToken() {
        return refreshToken;
    }

    public void setRefreshToken(String refreshToken) {
        this.refreshToken = refreshToken;
    }

    public String getAccessToken() {
        return accessToken;
    }

    public void setAccessToken(String accessToken) {
        this.accessToken = accessToken;
    }

    public Instant getAccessTokenExpiry() {
        return accessTokenExpiry;
    }

    public void setAccessTokenExpiry(Instant accessTokenExpiry) {
        this.accessTokenExpiry = accessTokenExpiry;
    }

    public String getGrantedScopes() {
        return grantedScopes;
    }

    public void setGrantedScopes(String grantedScopes) {
        this.grantedScopes = grantedScopes;
    }

    public boolean isCalendarEnabled() {
        return calendarEnabled;
    }

    public void setCalendarEnabled(boolean calendarEnabled) {
        this.calendarEnabled = calendarEnabled;
    }

    public boolean isContactsEnabled() {
        return contactsEnabled;
    }

    public void setContactsEnabled(boolean contactsEnabled) {
        this.contactsEnabled = contactsEnabled;
    }

    public boolean isGmailEnabled() {
        return gmailEnabled;
    }

    public void setGmailEnabled(boolean gmailEnabled) {
        this.gmailEnabled = gmailEnabled;
    }
}
