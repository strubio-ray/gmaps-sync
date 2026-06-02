import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const places = sqliteTable("places", {
  googlePlaceId: text("google_place_id").primaryKey(),
  legacyId: text("legacy_id").unique(),
  name: text("name").notNull(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  address: text("address").notNull().default(""),
  comment: text("comment"),
  contentHash: text("content_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),

  // Enrichment fields (nullable until enriched)
  rating: real("rating"),
  userRatingCount: integer("user_rating_count"),
  priceLevel: integer("price_level"),
  primaryType: text("primary_type"),
  types: text("types"), // JSON array
  editorialSummary: text("editorial_summary"),
  reviewsText: text("reviews_text"),
  generativeSummary: text("generative_summary"),

  // Boolean service/amenity attributes (0/1)
  servesBreakfast: integer("serves_breakfast"),
  servesLunch: integer("serves_lunch"),
  servesDinner: integer("serves_dinner"),
  servesBrunch: integer("serves_brunch"),
  servesBeer: integer("serves_beer"),
  servesWine: integer("serves_wine"),
  servesCocktails: integer("serves_cocktails"),
  servesCoffee: integer("serves_coffee"),
  servesDessert: integer("serves_dessert"),
  servesVegetarianFood: integer("serves_vegetarian_food"),
  outdoorSeating: integer("outdoor_seating"),
  liveMusic: integer("live_music"),
  goodForChildren: integer("good_for_children"),
  goodForGroups: integer("good_for_groups"),
  allowsDogs: integer("allows_dogs"),
  dineIn: integer("dine_in"),
  delivery: integer("delivery"),
  takeout: integer("takeout"),

  // Other enrichment
  businessStatus: text("business_status"),
  websiteUri: text("website_uri"),
  phoneNumber: text("phone_number"),

  // Pipeline timestamps
  enrichedAt: text("enriched_at"),
  embeddedAt: text("embedded_at"),
});

export const lists = sqliteTable("lists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: integer("type").notNull(),
  lastSeenRemote: text("last_seen_remote"),
  removedRemote: integer("removed_remote").notNull().default(0),
});

export const placeLists = sqliteTable(
  "place_lists",
  {
    googlePlaceId: text("google_place_id")
      .notNull()
      .references(() => places.googlePlaceId),
    listId: text("list_id")
      .notNull()
      .references(() => lists.id),
  },
  (table) => [primaryKey({ columns: [table.googlePlaceId, table.listId] })],
);

export const syncMetadata = sqliteTable("sync_metadata", {
  googlePlaceId: text("google_place_id")
    .primaryKey()
    .references(() => places.googlePlaceId),
  source: text("source").notNull().default("pull"),
  firstSeen: text("first_seen").notNull(),
  lastSeenRemote: text("last_seen_remote"),
  removedRemote: integer("removed_remote").notNull().default(0),
});

export const discoveryMetadata = sqliteTable("discovery_metadata", {
  googlePlaceId: text("google_place_id")
    .primaryKey()
    .references(() => places.googlePlaceId),
  discoveredAt: text("discovered_at").notNull(),
  discoveryQuery: text("discovery_query"),
  discoveryLat: real("discovery_lat"),
  discoveryLng: real("discovery_lng"),
  discoveryRadius: integer("discovery_radius"),
});

export const syncState = sqliteTable("sync_state", {
  id: integer("id").primaryKey().default(1),
  lastPull: text("last_pull"),
  lastPullStatus: text("last_pull_status"),
  schemaVersion: integer("schema_version").notNull().default(1),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
});

export const pendingMutations = sqliteTable(
  "pending_mutations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(),
    status: text("status").notNull().default("pending"),
    placeId: text("place_id"),
    listId: text("list_id"),
    payload: text("payload").notNull().default("{}"),
    groupId: text("group_id"),
    seq: integer("seq").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(3),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    pushedAt: text("pushed_at"),
  },
  (table) => [
    index("idx_pending_mutations_place_status").on(table.placeId, table.status),
    index("idx_pending_mutations_status").on(table.status, table.createdAt),
    index("idx_pending_mutations_group").on(table.groupId, table.seq),
    index("idx_pending_mutations_list").on(table.listId, table.status),
  ],
);
