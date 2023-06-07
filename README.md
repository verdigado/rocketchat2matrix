# Rocket.Chat to Matrix Migration Script

Drafts and more. **This is a work in progress!**

## Exporting RC data

Currently manually via mongodb. Run the following on the server:

```shell
mongoexport --collection=rocketchat_message --db=rocketchat --out=rocketchat_message.json
mongoexport --collection=rocketchat_room --db=rocketchat --out=rocketchat_room.json
mongoexport --collection=users --db=rocketchat --out=users.json
```

Export them to `inputs/`

## Running the Matrix Dev Server

```shell
docker-compose run --rm -e SYNAPSE_SERVER_NAME=my.matrix.host -e SYNAPSE_REPORT_STATS=no synapse generate
docker-compose up -d
# Wait for the Server to boot, then register an admin user
docker-compose exec -it synapse register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml --admin --user verdiadmin --password verdiadmin
```

Then you can access the homeserver in [Element Web](https://app.element.io/#/login) or the [local admin interface](http://localhost:8080) as `http://localhost:8008` with the `verdiadmin` as username AND password.

Store an access token for that user:

```shell
curl --request POST \
  --url http://localhost:8008/_matrix/client/v3/login \
  --header 'Content-Type: application/json' \
  --data '{"type": "m.login.password","user": "verdiadmin","password": "verdiadmin","device_id": "DEV"}' \
> src/config/synapse_access_token.json
```

To finally run the script, execute it via `npm start`.

## Configuration

Copy over `.env.example` to `.env` and insert your values.

## Running Tests

`npm test`.

## Cleaning Up

To clean up the Synapse server and local storage database, run (while the containers are stopped)

```shell
sudo rm files/homeserver.db
rm db.sqlite
```

Then you can restart with an empty but quite equal server, following the instructions above, excluding the `generate` command.

## Design Decisions

- Getting data from Rocket.Chat via (currently) manual mongodb export
- Room to Channel conversion:
  - Read-only attributes of 2 verdigado channels not converted to power levels due to complexity
