# The database (Neon Postgres, free plan)

The site keeps almost everything in JSON files in git, and that is fine for the directory. What visitors give us (today: the founding-member list; later: member profiles, projects, posts and introductions) must **survive Render restarts and redeploys**, and Render's free disk does not. So that data goes to a Postgres database on **Neon's free plan**. No paid plan, no Render upgrade, no persistent disk, no card.

## What uses it today

| | Where it lives |
|---|---|
| The founding-member list (`POST /api/founding-members`, owner reads it at `GET /api/admin/network/founding`) | **Postgres**, table `founding_members`, when `DATABASE_URL` is set. With no database it falls back to a small file (fine on a developer's computer; lost on Render's free disk, and the sign-up page says so). |
| Accounts, profiles, projects, posts, introductions | still the JSON store, and still **closed** on Render (`/api/network/status` says `available: false`). Nothing about the database opens them. |

The founding list **never falls back to the file when a database is set but down**: it answers `503` ("cannot take sign-ups right now") rather than say "saved" to somewhere a restart erases.

## How it is built

- `backend/src/db/database.js`: opens the connection from `DATABASE_URL` and nothing else. TLS is required (`?sslmode=require`) for every host but the developer's own computer; the pooled address (Neon's `-pooler` host) is refused (see below); an idle connection Neon drops is caught, not fatal; a query whose connection was dropped runs once more. The address (it holds the password) is never logged, returned or shown: problems are described in words, driver errors are logged by their short code only.
- `backend/src/db/migrate.js` + `backend/db/migrations/`: numbered SQL files (`0001_founding_members.sql`), each run once in its own transaction under an advisory lock and recorded in `schema_migrations` with a checksum. A file that was changed after it ran is refused: the fix for a mistake is the next file. The server runs them by itself when it starts (`[db] ready` in the log), and `npm run db:migrate` does the same by hand.
- `founding_members`: `email` is stored lower case and is **unique**, enforced by the database (so two sign-ups at the same instant cannot make two rows, and a repeat of the same address updates the earlier row and keeps its id, `created_at` and `consented_at`). Rows also keep what the person chose to say (name, city, intents, skills, what they are building and looking for, an https link). The email is never part of any public response.
- `backend/src/db/foundingImport.js`, `backend/scripts/db.mjs`: `npm run db:status`, `npm run db:migrate`, `npm run founding:import`. They read `DATABASE_URL` from the environment or from `backend/.env` (git ignores it) and print counts, never addresses or emails.

## The next tables (designed, not used)

`backend/db/planned/community_schema.sql` is the design for the members' side, one table for each record the JSON store keeps today: `members`, `sessions`, `posts`, `replies`, `post_likes`, `projects`, `project_interests`, `introductions`, `reports`, `audit_log`. **Nothing runs it**: the migration runner reads only `db/migrations/`. `tests/database.test.js` applies it to a throwaway Postgres to prove it is valid and holds its rules in the database itself: one account per lower-case email; a post, project, interest, introduction or report goes when its member leaves; one live introduction (asked or accepted) between two people whichever way round; nobody asks themselves; four moderation words only; contact details are one private column on `members`, shown only by the introductions logic after both agreed.

Porting is not free, and it is not done: the JSON store hands the code *all* the data to read (`store.read()`), and the members, feed, projects and introductions modules are written that way. Moving them to Postgres means rewriting their reads and writes as queries, one module at a time, then moving the planned schema into `db/migrations/` as the next number and turning the community on. Until then the community stays closed, and the founding list is the only thing here.

## Limits of Neon's free plan (from Neon's own pages)

- No credit card; 1 GB storage per project; 100 compute-hours a month per project; 5 GB transfer a month. The founding list is kilobytes. If the compute hours or transfer are used up, the database **suspends until the next month** (nothing is charged and nothing is deleted); sign-ups then answer 503 honestly.
- The database **sleeps after five idle minutes** and wakes on the next query in a few hundred milliseconds. Do not add a "keep awake" ping: it would burn the free compute hours.
- Free projects are not paused or deleted for inactivity. History for restore is **6 hours** and **there are no scheduled backups**: so take your own copy (below).
- Neon requires TLS; encryption at rest is not stated on the pages I could read, so do not promise members more than "kept in a Neon Postgres database over TLS".

## Setting it up: exact steps

### 1. Create the Neon account and project (you do this; I cannot)

1. Go to **https://neon.com** and sign up (the Sign up link leads to https://neon.com/signup). Use the sign-in method you prefer. **Do not add a card and do not upgrade**: the Free plan needs neither.
2. In the console (https://console.neon.tech) click **New Project**.
3. **Project name**: `still-early`. **Region**: `AWS Asia Pacific (Sydney)` (`aws-ap-southeast-2`) keeps members' data in Australia; Render's region matters little here (a sign-up is two small queries). The region **cannot be changed later**. Leave the Postgres version at the default.
4. Click **Create project**.
5. Click **Connect** in the console's navigation. In the "Connect to your branch" dialog leave Branch `production`, Database `neondb`, Role `neondb_owner`, and **turn "Connection pooling" OFF**. The address then has no `-pooler` in its host: the server needs this direct address (the migrations take a session-level advisory lock, which the pooler does not support).
6. Copy the connection string. It looks like `postgresql://neondb_owner:...@ep-....ap-southeast-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`. **It contains the password: treat it like one.** Never paste it into chat, an issue, a commit, a document or the frontend. (If a client ever complains about `channel_binding`, delete `&channel_binding=require` from the end; the server needs only `sslmode=require`.)

### 2. Check it from your computer

Run these in a copy of the project that has this code (until the pull request is merged: a second checkout of its branch, `git worktree add ..\au-founding-neon feature/founding-disk`, then `npm install --prefix backend` once, which adds the `pg` driver), from that folder. Create the file `backend/.env` with an editor (git ignores it; it is not typed into a command, so the password stays out of your shell history):

```powershell
notepad backend\.env
```

with one line, your copied address after the equals sign:

```
DATABASE_URL=postgresql://...
```

Then, from the project folder:

```powershell
git check-ignore backend/.env
npm run db:status --prefix backend
npm run db:migrate --prefix backend
```

The first must print the path (it is ignored). `db:status` must say "Connected" and `db:migrate` "Applied: 0001_founding_members.sql".

### 3. Save the registrations that already exist (before the deploy)

They are on Render's free disk, which a deploy, a restart, or the free service going to sleep after 15 idle minutes all erase, so there are few or none. Read them with your admin key (the `ADMIN_KEY` variable on the Render service, shown in its Environment tab) using the script, which asks for the key in a hidden prompt so it never appears in a command line:

```powershell
powershell -ExecutionPolicy Bypass -File backend\scripts\export-founding.ps1
```

**If the service has no `ADMIN_KEY` at all** (the live site then answers a plain 500), the list cannot be read, and setting one restarts the service, which erases the file. Treat anything signed up so far as lost, skip this step, and ask anyone you know signed up to do it again once the database is live. (`ADMIN_KEY` is needed anyway, to read the list from Postgres: step 4 adds it.)

(The first call can take ~15 seconds while the free server wakes.) The file holds email addresses: it stays in your user folder, **outside the repository**, and you delete it after the import. If the reply says `count: 0`, skip to step 4. Otherwise count first, then import:

```powershell
npm run founding:import --prefix backend -- "$env:USERPROFILE\founding-export.json"
npm run founding:import --prefix backend -- "$env:USERPROFILE\founding-export.json" --apply
```

The first is a dry run that only counts (rows in the file, duplicates, invalid, to add). Importing is safe to run again: the same email is one person, and a row only changes a stored one when it is newer. If anyone could have signed up since, run the export and the import **once more right before step 4**.

### 4. Give Render the address

In the Render dashboard open the service (`Atlas-Startup`), **Environment**, **Add variable**, and add two:

- `DATABASE_URL`: the direct Neon address (step 1, pooling off).
- `ADMIN_KEY`, if there is none: a long random secret you make (for example 48 random letters and digits). It lets only you read the founding list and moderate; keep it in a password manager, or read it again from this tab.

Save. (Render keeps them encrypted; neither is in the repository, `render.yaml` only names the key, and the frontend never sees them.) The service stays on its **Free** plan. Saving redeploys the *current* code, which ignores `DATABASE_URL`: that is why step 3 comes first.

### 5. Merge and deploy (only when you approve)

Merge the pull request. Render deploys; at start the log says `[db] ready`. Then check:

- `https://atlas-startup.onrender.com/api/network/status` shows `"available": false` (the members' side is still closed) and `"founding": {"open": true, "durable": true}`.
- The sign-up page no longer says a restart can lose the list.
- The same admin read as in step 3 now says `"durable": true, "store": "postgres"` and lists the people you imported.

### 6. Prove it survives (do this once, with an address you own)

1. Sign up on the Community page with an address of yours (`you+test@...`).
2. Read the list (step 3's first command, printing instead of saving: remove the `| ... Set-Content` part) and see it there.
3. In Render use **Manual Deploy → Deploy latest commit** (a redeploy), and also let the free service sleep (15 idle minutes) and wake it with a visit: both erase the server's own disk.
4. Read the list again: your test entry (and every other) is still there.
5. Remove the test entry: in the Neon console open **SQL Editor** and run `delete from founding_members where email = 'you+test@...';`.

`npm run db:status --prefix backend` also shows the count at any time.

## Looking after it

- **Backups.** Neon's free plan keeps six hours of history and has no scheduled backup, so save the list yourself now and then (step 3's export). The file is the owner's, private, never committed (the repo's `.gitignore` ignores `founding-export*.json`).
- **Removing someone** (they ask): Neon console, SQL Editor: `delete from founding_members where email = lower('their@address');`.
- **Rotating the password** (it leaked, or someone left): Neon console, Roles, reset the password on `neondb_owner`, copy the new address, update `DATABASE_URL` in Render (and `backend/.env`).
- **If the database is down**, sign-ups answer 503 with a plain message and nothing is saved elsewhere; the log says `[db] ... (code)`.
- **Optional hardening**, if the list grows: create a second Neon role for the site that can only read and write `founding_members`, and use its address in Render; keep `neondb_owner` for the migrations from your own computer.

## What was not tested here, and the check that covers it

The tests (`backend/tests/database.test.js`) run the real `pg` driver against a real Postgres (PGlite, Postgres compiled to WebAssembly) in a folder on disk, and stop and start the whole server and database to show a registration survives. They cannot reach Neon, so they do not show TLS, the suspend-and-wake behaviour, the advisory lock between two real connections, or Render itself. Step 6 is the check that does, and I have not run it: it needs your Neon address and a deploy you have not approved yet.
