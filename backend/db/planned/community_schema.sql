-- PLANNED, NOT APPLIED. The tables the members' side of the Community will need once it moves from its JSON file (src/network/store.js) to Postgres.
-- Nothing reads or writes them yet and the migration runner (src/db/migrate.js) does not run this file: the site applies only db/migrations/. It is here so the design
-- can be reviewed now, and checked to be valid SQL (tests/database.test.js applies it to a throwaway Postgres). When the store is ported, this file moves into
-- db/migrations/ as the next numbered migration (changing it after it has been applied is not allowed: add a new migration instead).
--
-- It follows the records the JSON store keeps today, one table for each kind, so the port is a change of storage and not of behaviour. Rules it holds in the database
-- itself, so a bug in the code cannot break them:
--   * one account per email (lower case); a session names a member and is removed with them
--   * a post, reply, project, introduction or report belongs to a member and goes when the member leaves (the "delete my account" promise)
--   * moderation status is one of four words; one live introduction (asked or accepted) between two people, whichever way round; nobody asks themselves
--   * contact details are one private column on members: they are shown only by the introductions logic, and only after both people agreed (never selected into a public view)

create table members (
  id             text primary key,
  email          text        not null unique check (email = lower(email)),
  email_verified boolean     not null default false,
  password_hash  text        not null,
  name           text        not null,
  role           text        not null default '',
  city           text        not null default '',
  intro          text        not null default '',
  building       jsonb       not null default '[]',
  past           jsonb       not null default '[]',   -- previous projects and contributions
  links          jsonb       not null default '{}',   -- website, professional profile, github, portfolio (https only: checked in code)
  open_to        text[]      not null default '{}',
  skills         text[]      not null default '{}',   -- closed list (network/taxonomy.js)
  interests      text[]      not null default '{}',
  looking_for    text[]      not null default '{}',
  remote         boolean     not null default false,
  listed         boolean     not null default false,  -- chose to be suggested to others
  contact        text        not null default '',     -- PRIVATE: shared only through an accepted introduction
  suspended      boolean     not null default false,
  created_at     timestamptz not null,
  updated_at     timestamptz not null
);
create index members_listed_idx on members (listed) where listed and not suspended;
create index members_skills_idx on members using gin (skills);
create index members_interests_idx on members using gin (interests);

create table sessions (
  id           text primary key,
  member_id    text        not null references members (id) on delete cascade,
  token_sha256 text        not null unique,           -- only the hash of the token is kept
  created_at   timestamptz not null,
  expires_at   timestamptz not null
);
create index sessions_member_idx on sessions (member_id);
create index sessions_expires_idx on sessions (expires_at);

create table posts (
  id            text primary key,
  author_id     text        not null references members (id) on delete cascade,
  topic         text        not null,
  body          text        not null,
  status        text        not null default 'visible' check (status in ('visible', 'hidden', 'removed', 'deleted')),
  hidden_reason text,
  created_at    timestamptz not null,
  edited_at     timestamptz
);
create index posts_feed_idx on posts (created_at desc, id) where status = 'visible';

create table replies (
  id         text primary key,
  post_id    text        not null references posts (id) on delete cascade,
  author_id  text        not null references members (id) on delete cascade,
  body       text        not null,
  status     text        not null default 'visible' check (status in ('visible', 'hidden', 'removed', 'deleted')),
  created_at timestamptz not null,
  edited_at  timestamptz
);
create index replies_post_idx on replies (post_id, created_at);

create table post_likes (
  post_id    text        not null references posts (id) on delete cascade,
  member_id  text        not null references members (id) on delete cascade,
  created_at timestamptz not null,
  primary key (post_id, member_id)
);

create table projects (
  id            text primary key,
  author_id     text        not null references members (id) on delete cascade,
  name          text        not null,
  summary       text        not null,
  problem       text        not null default '',
  stage         text        not null,
  skills_needed text[]      not null default '{}',
  collaboration text[]      not null default '{}',
  interests     text[]      not null default '{}',
  city          text        not null default '',
  remote        boolean     not null default false,
  open          boolean     not null default true,
  status        text        not null default 'visible' check (status in ('visible', 'hidden', 'removed', 'deleted')),
  hidden_reason text,
  created_at    timestamptz not null,
  updated_at    timestamptz not null
);
create index projects_open_idx on projects (created_at desc, id) where status = 'visible' and open;
create index projects_skills_idx on projects using gin (skills_needed);

-- "I'm interested": tells the author someone would like to talk, and shares no contact detail.
create table project_interests (
  project_id text        not null references projects (id) on delete cascade,
  member_id  text        not null references members (id) on delete cascade,
  created_at timestamptz not null,
  primary key (project_id, member_id)
);
create index project_interests_member_idx on project_interests (member_id);

-- A request to meet. Contact details are never copied here: they stay on members.contact and are shown only while status = 'accepted' (both people agreed).
create table introductions (
  id           text primary key,
  from_member  text        not null references members (id) on delete cascade,
  to_member    text        not null references members (id) on delete cascade,
  note         text        not null,
  why          text[]      not null default '{}',     -- the reasons the pair was suggested, in words
  status       text        not null default 'requested' check (status in ('requested', 'accepted', 'declined', 'withdrawn')),
  created_at   timestamptz not null,
  decided_at   timestamptz,
  constraint introductions_not_self check (from_member <> to_member)
);
-- One live record (asked or accepted) per pair, whichever way round.
create unique index introductions_one_live_pair on introductions (least(from_member, to_member), greatest(from_member, to_member)) where status in ('requested', 'accepted');
create index introductions_to_idx on introductions (to_member, status);
create index introductions_from_idx on introductions (from_member, status, created_at);

create table reports (
  id          text primary key,
  target_kind text        not null check (target_kind in ('post', 'reply', 'project')),
  target_id   text        not null,
  reporter_id text        not null references members (id) on delete cascade,
  reason      text        not null,
  note        text        not null default '',
  status      text        not null default 'open' check (status in ('open', 'closed')),
  resolution  text,
  created_at  timestamptz not null,
  resolved_at timestamptz
);
-- A person reports a thing once while it is open.
create unique index reports_one_open_per_reporter on reports (target_kind, target_id, reporter_id) where status = 'open';

create table audit_log (
  id     bigint generated always as identity primary key,
  at     timestamptz not null,
  actor  text        not null,
  action text        not null,
  target text        not null,
  note   text        not null default ''
);
