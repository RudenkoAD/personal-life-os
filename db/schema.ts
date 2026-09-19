import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
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
    userId: text('user_id'),
    name: text('name').notNull(),
    scope: text('scope').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_tokens_owner').on(t.ownerId)],
);

export const mutations = sqliteTable(
  'mutations',
  {
    ownerId: text('owner_id').notNull(),
    id: text('id').notNull(),
    hash: text('hash').notNull(),
    revision: integer('revision').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.id] })],
);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  login: text('login').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash'),
});

export const spaces = sqliteTable('spaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  createdBy: text('created_by').notNull(),
});

export const spaceMembers = sqliteTable(
  'space_members',
  {
    spaceId: text('space_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.userId] })],
);

export const spaceInvites = sqliteTable('space_invites', {
  hash: text('hash').primaryKey(),
  spaceId: text('space_id').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdBy: text('created_by').notNull(),
  consumed: integer('consumed', { mode: 'boolean' }).notNull().default(false),
  consumedBy: text('consumed_by'),
});
