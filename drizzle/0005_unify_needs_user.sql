-- Collapse takeover park status into the existing ship-gate hold.
UPDATE work_items SET status = 'needs_user' WHERE status = 'needs_user_input';
