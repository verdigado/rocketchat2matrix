postToMatrix (endpoint, payload) {}
mapUserId (id) {}
mapChannelId (id) {}
mapMessageId (id) {}
generateHmac(user) {}

mapRoom (rcRoom) {
  const room = {
    creation_content: {
      'm.federate': false
    },
    name: rcRoom.name,
    room_alias_name: rcRoom.name,
    topic: rcRoom.description,
    // TODO: Invite users (Rate Limit?)
      // POST /_matrix/client/v3/rooms/{roomId}/invite
      // {
      //   "reason": "Welcome to the team!",
      //   "user_id": "@cheeky_monkey:matrix.org"
      // }
  }

  switch (rcRoom.t) {
    case 'd':
      room.is_direct = true
      break;

    case 'c':
      room.preset = 'public_chat'
      break;
      
      case 'p':
      room.preset = 'private_chat'
      break;

    default:
      // log; 'l' for livechat, anything else is undefined
      break;
  }
  // POST /_matrix/client/v3/createRoom
}

mapUser (rcUser) {
  return {
    'nonce': '',
    'username': rcUser.username,
    'displayname': rcUser.name,
    'password': '',
    'admin': rcUser.roles.includes('admin'),
    'mac': '',
   }
}

getUserRegisterNonce () {} // GET /_synapse/admin/v1/register

createUser (rcUser) {
  const user = mapUser(rcUser)
  user.nonce = getUserRegisterNonce()
  user.mac = generateHmac(user)
  const mUser = postToMatrix('/_synapse/admin/v1/register', user) // POST /_synapse/admin/v1/register

  // rcUser.__rooms.map(mapChannelId)
  return mUser
}

mapMessage (rcMessage) {
  const message = {
    'content': {
      'body': rc.msg,
      // 'format': 'org.matrix.custom.html',
      // 'formatted_body': '<b>This is an example text message</b>',
      'msgtype': 'm.text',
    },
    'event_id': '$143273582443PhrSn:example.org', // TODO: ??
    'origin_server_ts': new Date(rc.t.$date).valueOf(),
    'room_id': mapChannelId(rcMessage.rid),
    'sender': mapUserId(rc.u._id),
    'type': 'm.room.message',
    'unsigned': {
      'age': 1234, // TODO: ??
    },
  }
  // TODO: Other media types

  if (rc.tmid) { // If it is a thread reply
    message.content['m.relates_to'] = {
      rel_type: 'm.thread',
      event_id: mapMessageId(rc.tmid),
    }
  }

  return message
}
