create index oauth_states_user_service on public.oauth_states(user_id,service);
create index oauth_states_expiry on public.oauth_states(expires_at);
