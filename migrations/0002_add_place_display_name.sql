ALTER TABLE map_places ADD COLUMN display_name TEXT;

CREATE INDEX map_places_by_map_display_name
ON map_places(map_id, display_name COLLATE NOCASE);
