# Rocket.Chat to Matrix Migration Script

Script to migrate users, channels and messages from Rocket.Chat communication platform to a Matrix Synapse server.
It currently has beta quality and comes with no warranty.

## Installation and Usage

This setup is intended to migrate from Rocket.Chat to Synapse once, using mongo database dumps and a fresh Synapse instance. After the migration and some clean up, the Synapse might be used by users.

### Exporting RC data

Currently manually via mongodb. Run the following on the server:

```shell
mongoexport --collection=rocketchat_message --db=rocketchat --out=rocketchat_message.json
mongoexport --collection=rocketchat_room --db=rocketchat --out=rocketchat_room.json
mongoexport --collection=users --db=rocketchat --out=users.json
```

Export them to `inputs/`

### Configuring the Matrix Dev Server

Generate a Synapse homeserver config with the following command (you might change `my.matrix.host` for the actual server name, as it can't be changed afterwards):

```shell
docker-compose run --rm -e SYNAPSE_SERVER_NAME=my.matrix.host -e SYNAPSE_REPORT_STATS=no synapse generate
```

To run the script without hitting rate limiting and activating an _Application Service_ to send messages by different users with our desired timestamps, you MUST add the following options to the freshly generated `files/homeserver.yaml`. **Do not leave these in the production setup!**

```yaml
rc_joins:
  local:
    per_second: 1024
    burst_count: 2048
rc_joins_per_room:
  per_second: 1024
  burst_count: 2048
rc_message:
  per_second: 1024
  burst_count: 2048
rc_invites:
  per_room:
    per_second: 1024
    burst_count: 2048
  per_user:
    per_second: 1024
    burst_count: 2048
  per_issuer:
    per_second: 1024
    burst_count: 2048
app_service_config_files:
  - /data/app-service.yaml
```

Now edit `app-service.example.yaml` and save it at `files/app-service.yaml`, changing the tokens manually.

Copy over `.env.example` to `.env` and insert your values. Also export the variables with `source .env`.

### Starting the Matrix Dev Server

Boot up the container and (for the first time starting the server or after resetting it manually) create an admin user:

```shell
docker-compose up -d
# Wait for the Server to boot, then register an admin user
docker-compose exec -it synapse register_new_matrix_user http://localhost:8008 --config /data/homeserver.yaml --admin --user $ADMIN_USERNAME --password $ADMIN_PASSWORD
```

Then you can access the homeserver in [Element Web](https://app.element.io/#/login) or the [local admin interface](http://localhost:8080) as `http://localhost:8008` with your `$ADMIN_USERNAME`/`$ADMIN_PASSWORD` as username/password.

Store an access token for that user:

```shell
curl --request POST \
  --url http://localhost:8008/_matrix/client/v3/login \
  --header 'Content-Type: application/json' \
  --data "{\"type\": \"m.login.password\",\"user\": \"$ADMIN_USERNAME\",\"password\": \"$ADMIN_PASSWORD\",\"device_id\": \"DEV\"}" \
> src/config/synapse_access_token.json
```

### Installing and Running the Script

Install NodeJS >= v19 and npm on your system, install the script's dependencies via `npm install`.

To finally run the script, execute it via `npm start`.

### Running Tests

`npm test`.

### Cleaning Up

To clean up the Synapse server and local storage database, run either the convenience script `./reset.sh` or start with:

```shell
docker-compose down
sudo rm files/homeserver.db
rm db.sqlite
```

Then you can restart with an empty but quite equal server, following the instructions above to start the dev server.

## Design Decisions

- Getting data from Rocket.Chat via manual mongodb export
- Room to Channel conversion:
  - Read-only attributes of channels not converted to power levels due to complexity
- Reactions:
  - So far only reactions used in our chats have been translated
  - Individual logos of _netzbegruenung_ and _verdigado_ have been replaced by a generic sunflower
  - Skin colour tones and genders have been ignored in the manual translation, using the neutral versions
- Discussions are not translated, yet, as they have a channel-like data structure which probably should be translated to threads
- Several state change events are not translated, as the previous state is unknown, but the final state should be equal
- If the root message of a thread is deleted or of a deleted user, the thread will be skipped
- The script follows a design to easily continue a migration if the script crashed by restarting it

## Contributing

This FOSS project is open for contributions. Just open an issue or a pull request.

### Hint: pre-commit

To keep the code clean and properly formatted, install and use [`pre-commit`](https://pre-commit.com/).

- Install it via `pip install pre-commit`
- Install the repo's pre-commit hooks for yourself: `pre-commit install`.

  Now it will run whenever you commit something

- Run pre-commit against all files: `pre-commit run --all-files`

## License

Licensed under AGPL v3 or newer.
Copyright 2023 verdigado eG <support@verdigado.com>.

## Support

Contact <support@verdigado.com> to get an offer for personal or commercial support. Community support might be provided through the issue tracker.
