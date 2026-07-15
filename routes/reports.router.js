import express from 'express'
import Reports from './../services/reports.service.js'
import { authenticate, authorize } from './../middlewares/authMiddleware.js'

const router = express.Router()
const reports = new Reports()

const reportsRouter = (io) => {

  // Vendido vs cobrado por periodo (mes / semana / día)
  router.get('/sales-vs-collections', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const { startDate, endDate, groupBy } = req.query
      const result = await reports.getSalesVsCollections(startDate, endDate, groupBy)
      res.status(200).json({ success: true, message: 'Reporte obtenido', data: result })
    } catch (error) { next(error) }
  })

  return router
}

export default reportsRouter
