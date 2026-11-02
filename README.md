# Rocket.Chat to Tuwunel Migration Script

Script to migrate users, channels and messages from Rocket.Chat to a Tuwunel Matrix homeserver.

This project is a fork of `verdigado/rocketchat2matrix`, adapted specifically for Tuwunel.

It currently has beta quality and comes with no warranty.

## Installation and Usage

This setup is intended for a one-time migration from Rocket.Chat to Tuwunel using MongoDB exports and preferably a fresh Tuwunel instance.

The documented setup uses the official Tuwunel Debian package with systemd and RocksDB. Docker is not required.

### Requirements

- Debian or another compatible `apt`-based distribution
- Node.js >= 19
- npm
- git
- curl
- jq
- openssl
- MongoDB database access to the Rocket.Chat server

### Installing Tuwunel

Install the required tools:

```shell
apt update
apt install -y curl ca-certificates git jq openssl
```

Add the official Tuwunel repository:

```shell
curl -fsSL \
  -o /usr/share/keyrings/tuwunel-archive-keyring.gpg \
  https://apt.f.dog/tuwunel-archive-keyring.gpg
```

Create `/etc/apt/sources.list.d/tuwunel.sources` with:

```text
Types: deb
URIs: https://apt.f.dog
Suites: stable
Components: main
Signed-By: /usr/share/keyrings/tuwunel-archive-keyring.gpg
```

Install Tuwunel:

```shell
apt update
apt install -y tuwunel
systemctl stop tuwunel
```

Do not start Tuwunel before choosing the final `server_name`.

### Installing the Migration Script

Clone the repository:

```shell
cd /opt
git clone https://github.com/9stannn/rocketchat2tuwunel.git
cd rocketchat2tuwunel
```

Install the Node.js dependencies:

```shell
npm ci
```

### Configuring Tuwunel

Edit:

```text
/etc/tuwunel/tuwunel.toml
```

A minimal configuration for a local migration server is:

```toml
[global]

server_name = "my.matrix.host"

database_path = "/var/lib/tuwunel"

address = ["127.0.0.1"]
port = 6167

allow_registration = false
allow_federation = false

registration_shared_secret_file = "/etc/tuwunel/.reg_shared_secret"

appservice_dir = "/etc/tuwunel/appservices"
```

Choose `server_name` carefully before the first start. It becomes part of all Matrix user IDs and should not be changed afterwards.

Generate the registration shared secret:

```shell
openssl rand -hex 32 > /etc/tuwunel/.reg_shared_secret
chown root:tuwunel /etc/tuwunel/.reg_shared_secret
chmod 640 /etc/tuwunel/.reg_shared_secret
```

Create the Application Service directory:

```shell
mkdir -p /etc/tuwunel/appservices
chown root:tuwunel /etc/tuwunel/appservices
chmod 750 /etc/tuwunel/appservices
```

Enable the service without starting it yet:

```shell
systemctl enable tuwunel
```

### Configuring the Application Service

Copy the example included in the repository:

```shell
cp app-service.example.yaml \
  /etc/tuwunel/appservices/rocketchat2tuwunel.yaml
```

Edit:

```text
/etc/tuwunel/appservices/rocketchat2tuwunel.yaml
```

The configuration should look like:

```yaml
id: 'rc2tuwunel migration'
url: null

as_token: 'CHANGE_ME_AS_TOKEN'
hs_token: 'CHANGE_ME_HS_TOKEN'

sender_localpart: '_rc_migration_bot'

namespaces:
  users:
    - exclusive: false
      regex: '@.*'
```

Generate two different random values:

```shell
openssl rand -hex 32
openssl rand -hex 32
```

Use one value for `as_token` and another value for `hs_token`.

The `as_token` value must also be configured as `AS_TOKEN` in `.env`.

Set the permissions:

```shell
chown root:tuwunel \
  /etc/tuwunel/appservices/rocketchat2tuwunel.yaml

chmod 640 \
  /etc/tuwunel/appservices/rocketchat2tuwunel.yaml
```

### Configuring the Migration Environment

Copy the example:

```shell
cp .env.example .env
```

Edit `.env` manually:

```env
HOMESERVER_URL='http://127.0.0.1:6167'
REGISTRATION_SHARED_SECRET='change-me'
AS_TOKEN='change-me'
EXCLUDED_USERS='rocket.cat'
ADMIN_USERNAME='admin'
ADMIN_PASSWORD='verySecretPassword'
```

`REGISTRATION_SHARED_SECRET` must contain the same value stored in:

```text
/etc/tuwunel/.reg_shared_secret
```

`AS_TOKEN` must contain the same value as `as_token` in:

```text
/etc/tuwunel/appservices/rocketchat2tuwunel.yaml
```

Use a strong password for `ADMIN_PASSWORD`.

### Exporting Rocket.Chat Data

Export the required MongoDB collections on the Rocket.Chat server:

```shell
mongoexport \
  --collection=rocketchat_message \
  --db=rocketchat \
  --out=rocketchat_message.json

mongoexport \
  --collection=rocketchat_room \
  --db=rocketchat \
  --out=rocketchat_room.json

mongoexport \
  --collection=users \
  --db=rocketchat \
  --out=users.json
```

If the Rocket.Chat MongoDB instance requires authentication, a replica set or a custom connection string, use `mongoexport --uri=...` instead.

Copy the three files into:

```text
inputs/
```

The directory must contain:

```text
inputs/
├── rocketchat_message.json
├── rocketchat_room.json
└── users.json
```

### Preparing a Fresh Tuwunel Instance

The repository includes `reset.sh` for preparing a fresh migration environment.

Run it from the repository directory:

```shell
sudo ./reset.sh
```

The script:

- stops the Tuwunel systemd service
- deletes the current RocksDB data in `/var/lib/tuwunel`
- removes the local migration database
- removes the previous migration admin access token
- starts Tuwunel
- waits for the homeserver to become available
- creates the configured Matrix migration administrator
- saves its access token to `src/config/tuwunel_access_token.json`
- removes old migration log files

> **Warning**
>
> `reset.sh` deletes the complete Tuwunel database stored in `/var/lib/tuwunel`.
> Only use it for a fresh installation, a test environment, or when you intentionally want to restart the migration from zero.
> Do not run it on a Tuwunel server containing data that must be kept.

After the script completes, Tuwunel is running through systemd and the migration admin token is ready.

### Running the Migration

Run:

```shell
npm start
```

The migration processes users, rooms and messages and then applies direct chats, pinned messages and final room memberships.

The migration can be restarted if it is interrupted. Existing mappings are stored in the local SQLite database so already migrated objects are not blindly recreated.

A completed migration ends with:

```text
info: Done.
```

### End-to-End Encrypted Migration (optional)

With `E2EE=true` in `.env`, the migrated history is end-to-end encrypted and Tuwunel never receives a migrated message in clear:

- every migrated room is created encrypted (`m.room.encryption` in its initial state);
- every message and reaction is encrypted by the device of its author before being sent, keeping the original author and timestamp;
- every migrated user (including the admin) gets a cross-signing identity, a server-side key backup holding the keys of the history of the rooms they were a member of in Rocket.Chat, and a secret storage protected by a personal **recovery key**;
- the migration then checks, with each recovery key, that every encrypted event of every room of each user can be decrypted from their backup, that no unencrypted message exists, and that nobody holds keys of rooms they were not a member of;
- if the check succeeds, the temporary migration devices are logged out and their keys (`e2ee-store/`) are deleted.

Requirements: Node.js >= 24 and the native crypto module installed by `npm ci` (`@matrix-org/matrix-sdk-crypto-nodejs`). The Application Service namespace must cover every migrated user (e.g. `regex: '@.*'`); this is checked right after the users are created. `io.element.msc4190` is not needed and should not be enabled. Users must not log into Matrix before the migration: an account that already has its own encryption setup is left untouched and does not receive the keys of the history, and the migration is then not finalized unless `E2EE_ALLOW_SKIPPED_USERS=true`.

The recovery keys are written to `recovery-keys.txt` (mode `0600`). Give each user their own key through a safe channel, then delete the file. On their first login (e.g. through SSO), Element or Tesseract asks to verify the new session: the user chooses the recovery key option, enters it once, and the whole migrated history becomes readable. A lost recovery key cannot be replaced: the history of that user can then no longer be decrypted.

The recovery key is a key escrow that outlives the migration. It unlocks the user's cross-signing identity and the key backup their clients keep using afterwards. Anyone who keeps a copy and can read the homeserver's data can decrypt the migrated history and the user's future messages, and can make a device of theirs appear verified. Confidentiality towards the server operators therefore requires that the migration operator keeps no copy (they had access to the plaintext Rocket.Chat export anyway). A user can cut this link once their whole history is loaded in Element Web/Desktop (which restores the full backup when the recovery key is entered) with "Reset cryptographic identity": new identity, new backup holding the keys already on the device, new recovery key known only to them. Do not do this from clients that download keys lazily (Element X, Tesseract): the history not yet viewed would be lost.

Notes:

- messages restored from a key backup are shown by Element with a grey shield ("the authenticity of this encrypted message can't be guaranteed on this device"), which is normal for history restored from a backup;
- as required by Matrix, room names, topics, memberships, timestamps and the relations of events (thread roots, the emoji of reactions) remain visible to the server;
- users joining a migrated room later do not receive the keys of the migrated history automatically (Element X shares the history it holds when inviting, as for any room with shared history);
- the encrypted history cannot be searched on the server; only Element Desktop can search it locally;
- the Rocket.Chat export files are in clear: delete them once the migration is validated.

Optional settings: `E2EE_RECOVERY_KEYS_FILE`, `E2EE_STORE_DIR`, `E2EE_STORE_PASSPHRASE`, `E2EE_FINALIZE` (set to `false` to keep the migration devices after a successful check; they are always kept when the check fails, so a fixed migration can be resumed) and `E2EE_ROTATION_MESSAGES` (messages per Megolm session, default 1000). See `.env.example`.

### Migrated User Passwords

Rocket.Chat passwords cannot be migrated.

Tuwunel requires a non-empty password when creating a user, so the migration generates a random password for every migrated Rocket.Chat user.

After migration, users therefore need a Matrix password reset or an external authentication method such as SSO.

The migration administrator keeps the password configured with `ADMIN_PASSWORD`.

### Testing

Run the test suite with:

```shell
npm test
```

You can also verify that Tuwunel is responding locally:

```shell
curl http://127.0.0.1:6167/_matrix/client/versions
```

For normal client access, configure an appropriate reverse proxy and TLS setup for your Matrix deployment.

### Cleaning Up After Migration

Before putting the migrated homeserver into production, remove migration-only credentials that are no longer required.

This can include:

- the registration shared secret
- the Application Service registration if the migration is completely finished
- `src/config/tuwunel_access_token.json`
- `.env`
- migration logs
- Rocket.Chat export files containing user or message data
- in E2EE mode: `recovery-keys.txt` once every key has been handed out, `db.sqlite`, and `e2ee-store/` and `e2ee-store.passphrase` if they still exist. Removing the Application Service is mandatory before going live: with a `@.*` namespace its token can act as any user.

Restart Tuwunel after removing or changing its Application Service configuration.

## Design Decisions

- Rocket.Chat data is imported from manual MongoDB exports.
- Rocket.Chat rooms are converted to Matrix rooms.
- Read-only channel attributes are not translated into Matrix power levels.
- Reaction and emoji mappings are handled by `src/emojis.json`.
- Discussions are not currently converted to Matrix threads.
- Historical state-change events are generally not recreated; the final room state is preferred instead.
- Membership changes are applied when required and finalized at the end of the migration.
- Historical room-name changes are not recreated when the previous state cannot be determined.
- Threads whose root message is missing or belongs to a deleted user may be skipped.
- The migration is designed so it can continue after an interruption by using its local mappings.
- A regular Rocket.Chat username that conflicts with the configured migration administrator can cause problems.

## Contributing

Contributions are welcome through issues and pull requests.

### Pre-commit

The repository includes pre-commit configuration for formatting and code-quality checks.

Install it with:

```shell
pip install pre-commit
pre-commit install
```

Run all hooks manually with:

```shell
pre-commit run --all-files
```

## License

Licensed under AGPL v3 or newer.

Original project Copyright 2023 verdigado eG
<support@verdigado.com>.

This fork contains modifications for Tuwunel support.

## Support

For issues related to this fork, use the GitHub issue tracker.

Original project:
https://github.com/verdigado/rocketchat2matrix
