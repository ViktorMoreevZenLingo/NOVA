package com.alo.web;

import com.alo.agent.AgentService;
import com.alo.dto.Dtos.AgentChatRequest;
import com.alo.dto.Dtos.AgentConfirmRequest;
import com.alo.dto.Dtos.AgentResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/agent")
public class AgentController {

    private final AgentService agent;

    public AgentController(AgentService agent) {
        this.agent = agent;
    }

    /** Send a message to the assistant. May return a pending write action to confirm. */
    @PostMapping("/chat")
    public AgentResponse chat(@RequestBody AgentChatRequest req, HttpSession session) {
        Long userId = Sessions.requireUserId(session);
        return agent.chat(userId, session, req.message());
    }

    /** Approve or reject the pending write action (send email / create event). */
    @PostMapping("/confirm")
    public AgentResponse confirm(@RequestBody AgentConfirmRequest req, HttpSession session) {
        Long userId = Sessions.requireUserId(session);
        return agent.confirm(userId, session, req.approved());
    }

    /** Clear the conversation. */
    @PostMapping("/reset")
    public ResponseEntity<Void> reset(HttpSession session) {
        Sessions.requireUserId(session);
        agent.reset(session);
        return ResponseEntity.noContent().build();
    }
}
