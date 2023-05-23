export type storage = {
  users: {
    rcId: string
    matrixId: string
  }[]
  rooms: {
    rcId: string
    matrixId: string
    members: string[]
  }[]
  messages: {
    rcId: string
    matrixId: string
  }[]
  exclusionsLists: {
    users: string[]
    rooms: string[]
    messages: string[]
  }
}

export const storage: storage = {
  users: [
    {
      rcId: '2ziHK8P748TeESitX',
      matrixId: '@herhde:locahlost',
    },
  ],
  rooms: [],
  messages: [],
  exclusionsLists: {
    users: [
      'rocket.cat',
      '5kdLWNTys3u2MhB2H', // verdiadmin
    ],
    rooms: [],
    messages: [],
  },
}
