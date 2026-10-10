package com.alo.web;

import com.alo.dto.Dtos.MeResponse;
import com.alo.dto.Dtos.UpdateMeRequest;
import com.alo.google.GoogleOAuth;
import com.alo.model.User;
import com.alo.repo.UserRepository;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/me")
public class MeController {

    private final UserRepository users;
    private final GoogleOAuth google;

    public MeController(UserRepository users, GoogleOAuth google) {
        this.users = users;
        this.google = google;
    }

    @GetMapping
    public MeResponse me(HttpSession session) {
        return toResponse(currentUser(session));
    }

    @PutMapping
    public MeResponse update(@RequestBody UpdateMeRequest req, HttpSession session) {
        User user = currentUser(session);
        if (req.name() != null) {
            user.setName(req.name().trim());
        }
        user.setAbout(req.about() == null ? "" : req.about());
        users.save(user);
        return toResponse(user);
    }

    private User currentUser(HttpSession session) {
        Long userId = Sessions.requireUserId(session);
        return users.findById(userId)
                .orElseThrow(() -> ApiException.unauthorized("Not logged in"));
    }

    private MeResponse toResponse(User user) {
        return new MeResponse(user.getPhone(), user.getName(), user.getAbout(),
                google.servicesFor(user.getId()));
    }
}
