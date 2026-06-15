-- Up to 3 food/menu photos per restaurant for the public gallery
-- (separate from per-menu-item images, and from the restaurant logo)

CREATE TABLE restaurant_photos (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID         NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    image_path    VARCHAR(500) NOT NULL,
    display_order SMALLINT     NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_restaurant_photos_restaurant ON restaurant_photos(restaurant_id);

-- Enforce a maximum of 3 photos per restaurant at the database level
-- as a safety net in addition to the application-level check.
CREATE OR REPLACE FUNCTION fn_check_restaurant_photo_limit()
RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT COUNT(*) FROM restaurant_photos WHERE restaurant_id = NEW.restaurant_id) >= 3 THEN
        RAISE EXCEPTION 'A restaurant may have at most 3 photos';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_restaurant_photo_limit
    BEFORE INSERT ON restaurant_photos
    FOR EACH ROW
    EXECUTE FUNCTION fn_check_restaurant_photo_limit();
