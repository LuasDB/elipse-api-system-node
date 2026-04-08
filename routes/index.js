import express from 'express'
import collectionsRouter from './collections.router.js'
import authRouter from './auth.router.js'
import usersRouter from './users.router.js'
import projectsRouter from './projects.router.js'
import unitsRouter from './units.router.js'
import buyersRouter from './buyers.router.js'
import contractsRouter from './contracts.router.js'
const router = express.Router()

const AppRouter = (app,io) => {

  app.use('/api/v1', router)
  router.use('/collections', collectionsRouter(io))
  router.use('/auth', authRouter)
  router.use('/users', usersRouter(io))
  router.use('/projects', projectsRouter(io))
  router.use('/units', unitsRouter(io))
  router.use('/buyers', buyersRouter(io))
  router.use('/contracts', contractsRouter(io))

}

export default AppRouter
