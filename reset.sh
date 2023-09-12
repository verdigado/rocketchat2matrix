#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

HOMESERVER="http://localhost:8008"

echo 'Resetting containers and databases'
docker-compose down
sudo rm -f files/homeserver.db
rm -f db.sqlite
docker-compose up -d

sleep 1.5
echo 'Creating admin user'
set +e
until docker-compose exec -it synapse register_new_matrix_user $HOMESERVER -c /data/homeserver.yaml --admin --user verdiadmin --password verdiadmin &> /dev/null
do
  echo 'Retrying creating admin...'
done
set -e

echo 'Saving admin access token'
curl --request POST \
  --url $HOMESERVER/_matrix/client/v3/login \
  --header 'Content-Type: application/json' \
  --data '{"type": "m.login.password","user": "verdiadmin","password": "verdiadmin","device_id": "DEV"}' \
> src/config/synapse_access_token.json 2> /dev/null

echo 'Done.'
