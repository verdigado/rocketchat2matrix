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

## Configuring the Matrix Dev Server

Generate a Synapse homeserver config with the following command (you might change `my.matrix.host` for the actual server name, as it can't be changed afterwards):

```shell
docker-compose run --rm -e SYNAPSE_SERVER_NAME=my.matrix.host -e SYNAPSE_REPORT_STATS=no synapse generate
```

To run the script without hitting rate limiting and activating an *Application Service* to send messages by different users with our desired timestamps, you MUST add the following options to the freshly generated `files/homeserver.yaml`. **Do not leave these in the production setup!**

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

Now edit `app-service.example.yaml` and save it at `files/app-service.yaml`, changing the tokens.

Copy over `.env.example` to `.env` and insert your values.

## Starting the Matrix Dev Server

Boot up the container and (for the first time starting the server or after resetting it manually) create an admin user:

```shell
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

## Installing and Running the Script

Install NodeJS and npm on your system, install the script's dependencies via `npm install`.

To finally run the script, execute it via `npm start`.

## Running Tests

`npm test`.

## Cleaning Up

To clean up the Synapse server and local storage database, run either the convenience script `./reset.sh` or start with:

```shell
docker-compose down
sudo rm files/homeserver.db
rm db.sqlite
```

Then you can restart with an empty but quite equal server, following the instructions above to start the dev server.

## Design Decisions

- Getting data from Rocket.Chat via (currently) manual mongodb export
- Room to Channel conversion:
  - Read-only attributes of 2 verdigado channels not converted to power levels due to complexity
