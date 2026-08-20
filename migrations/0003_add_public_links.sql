ALTER TABLE maps ADD COLUMN public_token TEXT;

CREATE UNIQUE INDEX maps_public_token_unique
ON maps(public_token)
WHERE public_token IS NOT NULL;
