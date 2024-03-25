const axios = require('axios')
const fs = require('fs')

async function login() {
  let loggedIn = false
  while (!loggedIn) {
    await new Promise((resolve) => setTimeout(resolve, 1000)) // Wait for 1 second before retrying
    try {
      const response = await axios.post(
        'http://synapse:8008/_matrix/client/v3/login',
        {
          type: 'm.login.password',
          user: 'admin',
          password: 'admin',
          device_id: 'DEV',
        }
      )
      if (response.status === 200) {
        fs.writeFileSync(
          'src/config/synapse_access_token.json',
          JSON.stringify(response.data)
        )
        loggedIn = true
      } else {
        console.log(
          `Login failed with status ${response.status}: ${response.data}`
        )
      }
    } catch (error) {
      console.error('Error during login:', error.message)
    }
  }
}

login()
