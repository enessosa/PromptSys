-- Claude Code mode: the permission mode of a session (how much the agent may do without asking), changeable at any time.
ALTER TABLE code_sessions ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'default'
  CHECK (permission_mode IN ('default','acceptEdits','plan','auto'));
