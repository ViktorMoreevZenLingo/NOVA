package com.alo.repo;

import com.alo.model.GoogleConnection;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GoogleConnectionRepository extends JpaRepository<GoogleConnection, Long> {
    Optional<GoogleConnection> findByUserId(Long userId);
}
