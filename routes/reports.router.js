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

  // Excel con todos los contratos registrados
  router.get('/contracts/export', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const workbook = await reports.exportContractsExcel()
      const fileName = `contratos-${new Date().toISOString().slice(0, 10)}.xlsx`

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)

      await workbook.xlsx.write(res)
      res.end()
    } catch (error) { next(error) }
  })

  return router
}

export default reportsRouter
