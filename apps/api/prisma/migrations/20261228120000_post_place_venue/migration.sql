-- Local do AskouT vinculado como rolê do post/evento (o nome leva à página do local).
ALTER TABLE "Post" ADD COLUMN "placeVenueId" UUID;
