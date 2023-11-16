#!/bin/bash
set -eo pipefail
IFS=$'\n\t'

HOMESERVER="http://localhost:8008"
set -a # automatically export all variables
source .env
set +a

if [ -z "$ADMIN_USERNAME" ]
then
  # shellcheck disable=SC2016
  echo 'Variable $ADMIN_USERNAME is not set in .env. Exiting.'
  exit 1
fi
set -u

echo 'Resetting containers and databases'
docker-compose down
sudo rm -f files/homeserver.db
rm -f db.sqlite
docker-compose up -d

sleep 1.5
echo 'Creating admin user'
set +e
until docker-compose exec -it synapse register_new_matrix_user $HOMESERVER -c /data/homeserver.yaml --admin --user $ADMIN_USERNAME --password $ADMIN_USERNAME &> /dev/null
do
  echo 'Retrying creating admin...'
done
set -e

echo 'Saving admin access token'
curl --request POST \
  --url $HOMESERVER/_matrix/client/v3/login \
  --header 'Content-Type: application/json' \
  --data "{\"type\": \"m.login.password\",\"user\": \"$ADMIN_USERNAME\",\"password\": \"$ADMIN_USERNAME\",\"device_id\": \"DEV\"}" \
> src/config/synapse_access_token.json 2> /dev/null

echo 'Removing log files'
rm ./*.log

echo 'Done.'
