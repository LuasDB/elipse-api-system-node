import express from 'express'
import authRouter from './auth.router.js'
import usersRouter from './users.router.js'
import projectsRouter from './projects.router.js'
import unitsRouter from './units.router.js'
import buyersRouter from './buyers.router.js'
import contractsRouter from './contracts.router.js'
import paymentsRouter from './payments.router.js'
import sellersRouter from './sellers.router.js'
import commissionsRouter from './commissions.router.js'
import reportsRouter from './reports.router.js'
import auditRouter from './audit.router.js'

const router = express.Router()

const AppRouter = (app,io) => {

  app.use('/api/v1', router)
  router.use('/auth', authRouter)
  router.use('/users', usersRouter(io))
  router.use('/projects', projectsRouter(io))
  router.use('/units', unitsRouter(io))
  router.use('/buyers', buyersRouter(io))
  router.use('/contracts', contractsRouter(io))
  router.use('/payments', paymentsRouter(io))
  router.use('/sellers', sellersRouter(io))
  router.use('/commissions', commissionsRouter(io))
  router.use('/reports', reportsRouter(io))
  router.use('/audit', auditRouter(io))

}

export default AppRouter
