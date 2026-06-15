-- Add profile photo support for all users (drivers primarily, but available to all roles)

ALTER TABLE users
    ADD COLUMN avatar_path VARCHAR(500);
