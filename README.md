# Rocket.Chat to Matrix Migration Script

Drafts and more

## Exporting RC data

Currently manually via mongodb. Run the following on the server:

```shell
mongoexport --collection=rocketchat_message --db=rocketchat --out=rocketchat_message.json
mongoexport --collection=rocketchat_room --db=rocketchat --out=rocketchat_room.json
mongoexport --collection=users --db=rocketchat --out=users.json
```

## Running the Matrix Dev Server

```shell
docker-compose run --rm -e SYNAPSE_SERVER_NAME=my.matrix.host -e SYNAPSE_REPORT_STATS=no synapse generate
docker-compose up -d
# Register a admin user
docker-compose exec -it synapse register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml --admin --user verdiadmin --password verdiadmin
```

Then you can access the homeserver in [Element Web](https://app.element.io/#/login) or the [local admin interface](http://localhost:8080) as `http://localhost:8008` with the `verdiadmin` as username AND password.

## Design Decisions

- Getting data from Rocket.Chat via (currently) manual mongodb export
- Room to Channel conversion:
  - Read-only attributes of 2 verdigado channels not converted to power levels due to complexity
