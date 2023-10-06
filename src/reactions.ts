import reactionsCbg from './reactions_cbg.json'
import reactionsVdg from './reactions_verdigado.json'
import * as emoji from 'node-emoji'

const reactions = { ...reactionsVdg, ...reactionsCbg }
interface Mapping {
  [key: string]: string | undefined
}
const mapping: Mapping = {}
let undefinedOnes = 0
Object.keys(reactions).map((key) => {
  let foundEmoji = emoji.get(key)
  if (!foundEmoji) {
    undefinedOnes++
    foundEmoji = ''
  }
  console.log(`"${key}": "${foundEmoji}",`)
  mapping[key.replaceAll(':', '')] = foundEmoji
})

console.log('Undefined reactions:', undefinedOnes)
