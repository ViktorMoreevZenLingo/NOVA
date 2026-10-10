package com.alo.web;

import jakarta.servlet.http.HttpSession;

/** Tiny helper for the "phone number is the user ID" session model. */
public final class Sessions {

    public static final String USER_ID = "userId";

    private Sessions() {}

    public static void login(HttpSession session, Long userId) {
        session.setAttribute(USER_ID, userId);
    }

    public static Long currentUserId(HttpSession session) {
        return (Long) session.getAttribute(USER_ID);
    }

    /** Returns the logged-in user id or throws 401. */
    public static Long requireUserId(HttpSession session) {
        Long userId = currentUserId(session);
        if (userId == null) {
            throw ApiException.unauthorized("Not logged in");
        }
        return userId;
    }
}
