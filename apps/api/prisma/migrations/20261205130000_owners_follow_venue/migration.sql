-- Quem já administra um local passa a segui-lo.
INSERT INTO "VenueFollow" ("userId", "venueId", "createdAt")
SELECT "ownerId", "id", NOW() FROM "Venue" WHERE "ownerId" IS NOT NULL
ON CONFLICT DO NOTHING;
