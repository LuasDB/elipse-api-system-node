import express from 'express'
import Payments from './../services/payments.service.js'
import { authenticate, authorize } from './../middlewares/authMiddleware.js'

const router = express.Router()
const payments = new Payments()

const paymentsRouter = (io) => {

  // Alertas globales (dashboard)
  router.get('/alerts', authenticate, async (req, res, next) => {
    try {
      const result = await payments.getAlerts()
      res.status(200).json({ success: true, message: 'Alertas obtenidas', data: result })
    } catch (error) { next(error) }
  })

  // Resumen financiero de un contrato
  router.get('/summary/:contractId', authenticate, async (req, res, next) => {
    try {
      const result = await payments.getContractSummary(req.params.contractId)
      res.status(200).json({ success: true, message: 'Resumen obtenido', data: result })
    } catch (error) { next(error) }
  })

  // Obtener pagos de un contrato
  router.get('/contract/:contractId', authenticate, async (req, res, next) => {
    try {
      const result = await payments.getByContract(req.params.contractId)
      res.status(200).json({ success: true, message: 'Pagos obtenidos', data: result })
    } catch (error) { next(error) }
  })

  // Generar calendario de pagos para un contrato
  router.post('/generate/:contractId', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const result = await payments.generateSchedule(req.params.contractId)
      io.emit('payments_generated', { message: 'Calendario de pagos generado' })
      res.status(201).json({ success: true, message: `${result.generated} pagos programados`, data: result })
    } catch (error) { next(error) }
  })

  // Registrar un pago
  router.post('/register/:id', authenticate, authorize('admin', 'gerente', 'cobranza'), async (req, res, next) => {
    try {
      const result = await payments.registerPayment(req.params.id, {
        ...req.body,
        registeredBy: req.user?.name || req.user?.email
      })
      io.emit('payment_registered', { message: 'Pago registrado' })
      res.status(200).json({ success: true, message: 'Pago registrado', data: result })
    } catch (error) { next(error) }
  })

  // Eliminar un pago
  router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
    try {
      const result = await payments.deleteOneById(req.params.id)
      res.status(200).json({ success: true, message: 'Pago eliminado', data: result })
    } catch (error) { next(error) }
  })

  // Eliminar todos los pagos de un contrato (regenerar)
  router.delete('/contract/:contractId', authenticate, authorize('admin'), async (req, res, next) => {
    try {
      const result = await payments.deleteByContract(req.params.contractId)
      res.status(200).json({ success: true, message: 'Pagos eliminados', data: result })
    } catch (error) { next(error) }
  })

  return router
}

export default paymentsRouter