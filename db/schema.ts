import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const workspaces = sqliteTable('workspaces', {
  ownerId: text('owner_id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull(),
  commitId: text('commit_id'),
});
export const feeds = sqliteTable(
  'feeds',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    url: text('url').notNull(),
  },
  (t) => [index('idx_feeds_owner').on(t.ownerId)],
);
export const caldavConnections = sqliteTable(
  'caldav_connections',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    url: text('url').notNull(),
    credentials: text('credentials').notNull(),
  },
  (t) => [index('idx_caldav_owner').on(t.ownerId)],
);
export const tokens = sqliteTable(
  'agent_tokens',
  {
    hash: text('hash').primaryKey(),
    ownerId: text('owner_id').notNull(),
    name: text('name').notNull(),
    scope: text('scope').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_tokens_owner').on(t.ownerId)],
);
