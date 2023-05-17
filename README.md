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
docker-compose up -d
# Register a admin user
docker-compose exec -it synapse register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml
```

## Design Decisions

- Getting data from Rocket.Chat via (currently) manual mongodb export
- Room to Channel conversion:
  - Read-only attributes of 2 verdigado channels not converted to power levels due to complexity
