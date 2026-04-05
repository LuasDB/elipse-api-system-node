import { MongoClient } from 'mongodb'
import config from './../config.js'

const client = new MongoClient(config.mongoURI)
const db = client.db(config.database)

export {
  db, client
}
