package com.alo.web;

import com.alo.dto.Dtos.LoginRequest;
import com.alo.dto.Dtos.RegisterRequest;
import com.alo.dto.Dtos.UserResponse;
import com.alo.model.User;
import com.alo.repo.UserRepository;
import jakarta.servlet.http.HttpSession;
import java.time.Instant;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    // +359 followed by exactly 9 digits.
    private static final Pattern PHONE = Pattern.compile("\\+359\\d{9}");

    private final UserRepository users;

    public AuthController(UserRepository users) {
        this.users = users;
    }

    @PostMapping("/register")
    public ResponseEntity<UserResponse> register(@RequestBody RegisterRequest req, HttpSession session) {
        String phone = req.phone() == null ? "" : req.phone().trim();
        String name = req.name() == null ? "" : req.name().trim();
        if (!PHONE.matcher(phone).matches()) {
            throw ApiException.badRequest("Phone must be +359 followed by 9 digits");
        }
        if (name.isEmpty()) {
            throw ApiException.badRequest("Name is required");
        }
        if (users.existsByPhone(phone)) {
            throw ApiException.conflict("Phone already registered");
        }

        User user = new User();
        user.setPhone(phone);
        user.setName(name);
        user.setAbout("");
        user.setCreatedAt(Instant.now());
        users.save(user);

        Sessions.login(session, user.getId());
        return ResponseEntity.status(HttpStatus.CREATED).body(toResponse(user));
    }

    @PostMapping("/login")
    public ResponseEntity<UserResponse> login(@RequestBody LoginRequest req, HttpSession session) {
        String phone = req.phone() == null ? "" : req.phone().trim();
        User user = users.findByPhone(phone)
                .orElseThrow(() -> ApiException.notFound("No user with that phone"));
        Sessions.login(session, user.getId());
        return ResponseEntity.ok(toResponse(user));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpSession session) {
        session.invalidate();
        return ResponseEntity.noContent().build();
    }

    private static UserResponse toResponse(User user) {
        return new UserResponse(user.getId(), user.getPhone(), user.getName(),
                user.getAbout(), user.getCreatedAt());
    }
}
