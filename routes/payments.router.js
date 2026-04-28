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

  // Cobranza por periodo (dashboard)
  router.get('/collections-by-period', authenticate, async (req, res, next) => {
    try {
      const { startDate, endDate } = req.query
      const result = await payments.getCollectionsByPeriod(startDate, endDate)
      res.status(200).json({ success: true, message: 'Cobranza obtenida', data: result })
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

  // [LÍNEA 2] Marcar hito como completado
  router.patch('/:id/milestone/complete', authenticate, async (req, res, next) => {
    try {
      const result = await payments.completeMilestone(req.params.id, {
        ...req.body,
        completedBy: req.user?.id || req.user?._id || null
      })
      io.emit('milestone_completed', { paymentId: req.params.id, ...result })
      res.status(200).json({ success: true, message: 'Hito marcado como completado', data: result })
    } catch (error) { next(error) }
  })

  // [LÍNEA 2] Revertir hito (sólo si no tiene pagos)
  router.patch('/:id/milestone/uncomplete', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const result = await payments.uncompleteMilestone(req.params.id)
      io.emit('milestone_uncompleted', { paymentId: req.params.id, ...result })
      res.status(200).json({ success: true, message: 'Hito revertido a pendiente', data: result })
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

  // Subir comprobantes de pago
router.post('/:id/vouchers', authenticate, authorize('admin', 'gerente', 'cobranza'), async (req, res, next) => {
  try {
    const { id } = req.params
    const { default: uploadPaymentFiles } = await import('./../configurations/multer-payments.js')
    const upload = uploadPaymentFiles(id)

    upload.array('vouchers', 5)(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(Boom.badRequest('El archivo excede el límite de 10MB'))
        }
        return next(Boom.badRequest(err.message))
      }

      if (!req.files || req.files.length === 0) {
        return next(Boom.badRequest('No se recibieron archivos'))
      }

      try {
        const result = await payments.addVouchers(id, req.files)
        io.emit('payment_voucher_added', { message: 'Comprobante agregado' })
        res.status(200).json({
          success: true,
          message: `${req.files.length} comprobante(s) subido(s)`,
          data: result
        })
      } catch (error) {
        next(error)
      }
    })
  } catch (error) {
    next(error)
  }
})

// Eliminar un comprobante
router.delete('/:id/vouchers/:fileName', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const { id, fileName } = req.params
    const result = await payments.removeVoucher(id, fileName)
    res.status(200).json({ success: true, message: 'Comprobante eliminado', data: result })
  } catch (error) { next(error) }
})

  return router
}

export default paymentsRouter