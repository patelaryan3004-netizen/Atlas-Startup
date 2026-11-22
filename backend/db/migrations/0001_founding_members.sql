-- The founding-member list: people who asked to be told when the Community opens. A waiting list and nothing more: no account is made.
-- This is the only table the site uses in Postgres today (see docs/database.md). It holds an email address, so it is never part of the public data.

create table founding_members (
  id            text primary key,
  email         text        not null,
  name          text        not null,
  city          text        not null default '',
  intents       text[]      not null default '{}',   -- what they would like to do (closed list: network/taxonomy.js)
  skills        text[]      not null default '{}',   -- skills they bring (closed list)
  building      text        not null default '',
  looking_for   text        not null default '',
  link          text        not null default '',     -- an https link they chose to share
  consented_at  timestamptz not null,                -- when they ticked "we may keep these details to invite you"; never changed by a later sign-up
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  -- One person once: the email is stored in lower case and is unique, so the same address again replaces the earlier entry (people change their minds).
  constraint founding_members_email_key   unique (email),
  constraint founding_members_email_lower check (email = lower(email)),
  constraint founding_members_email_shape check (length(email) <= 254 and position('@' in email) > 1)
);

create index founding_members_created_idx on founding_members (created_at, id);
