import { access_token } from './config/synapse_access_token.json'
import axios from 'axios'

axios.defaults.baseURL = 'http://localhost:8008'
axios.defaults.headers.common['Authorization'] = ` Bearer ${access_token}`
axios.defaults.headers.post['Content-Type'] = 'application/json'

const whoami = axios.get('/_matrix/client/v3/account/whoami')

whoami.then((response) => console.log(response.data))
