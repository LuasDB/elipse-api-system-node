import express from 'express'
import Boom from '@hapi/boom'
import Commissions from './../services/commissions.service.js'
import { authenticate, authorize } from './../middlewares/authMiddleware.js'

const router = express.Router()
const commissions = new Commissions()

const commissionsRouter = (io) => {

  // Resumen global de comisiones pagadas/pendientes (dashboard)
  router.get('/summary', authenticate, authorize('admin', 'gerente', 'cobranza'), async (req, res, next) => {
    try {
      const result = await commissions.getTotalSummary()
      res.status(200).json({ success: true, message: 'Resumen de comisiones obtenido', data: result })
    } catch (error) { next(error) }
  })

  // Asignar / actualizar el % de comisión de un contrato (solo admin)
  router.patch('/contract/:contractId', authenticate, authorize('admin'), async (req, res, next) => {
    try {
      const result = await commissions.assign(req.params.contractId, {
        ...req.body,
        assignedBy: req.user?._id || req.user?.id || null
      })
      io.emit('commission_assigned', { contractId: req.params.contractId, message: 'Comisión asignada' })
      res.status(200).json({ success: true, message: 'Comisión asignada', data: result })
    } catch (error) { next(error) }
  })

  // Obtener la comisión de un contrato
  router.get('/contract/:contractId', authenticate, async (req, res, next) => {
    try {
      const result = await commissions.getByContract(req.params.contractId)
      res.status(200).json({ success: true, message: 'Comisión obtenida', data: result })
    } catch (error) { next(error) }
  })

  // Registrar un pago de comisión al vendedor (admin, gerente)
  router.post('/contract/:contractId/payments', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const result = await commissions.registerPayment(req.params.contractId, {
        ...req.body,
        registeredBy: req.user?.name || req.user?.email
      })
      io.emit('commission_payment_registered', { contractId: req.params.contractId, message: 'Pago de comisión registrado' })
      res.status(200).json({ success: true, message: 'Pago de comisión registrado', data: result })
    } catch (error) { next(error) }
  })

  // Subir comprobantes de un pago de comisión (admin, gerente)
  router.post('/contract/:contractId/payments/:movementId/vouchers', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const { contractId, movementId } = req.params
      const { default: uploadCommissionFiles } = await import('./../configurations/multer-commissions.js')
      const upload = uploadCommissionFiles(contractId)

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
          const result = await commissions.addVoucherToMovement(contractId, movementId, req.files)
          io.emit('commission_voucher_added', { contractId, message: 'Comprobante de comisión agregado' })
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

  // Eliminar un comprobante de un pago de comisión (admin, gerente)
  router.delete('/contract/:contractId/payments/:movementId/vouchers/:fileName', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const { contractId, movementId, fileName } = req.params
      const result = await commissions.removeVoucherFromMovement(contractId, movementId, fileName)
      res.status(200).json({ success: true, message: 'Comprobante eliminado', data: result })
    } catch (error) { next(error) }
  })

  // Listar comisiones de un vendedor
  router.get('/seller/:sellerId', authenticate, async (req, res, next) => {
    try {
      if (req.user.role === 'vendedor' && req.user._id !== req.params.sellerId) {
        throw Boom.forbidden('No tienes permiso para ver las comisiones de otro vendedor')
      }
      const result = await commissions.getBySeller(req.params.sellerId)
      res.status(200).json({ success: true, message: 'Comisiones obtenidas', data: result })
    } catch (error) { next(error) }
  })

  // Resumen de comisiones de un vendedor
  router.get('/seller/:sellerId/summary', authenticate, async (req, res, next) => {
    try {
      if (req.user.role === 'vendedor' && req.user._id !== req.params.sellerId) {
        throw Boom.forbidden('No tienes permiso para ver el resumen de otro vendedor')
      }
      const result = await commissions.getSellerSummary(req.params.sellerId)
      res.status(200).json({ success: true, message: 'Resumen obtenido', data: result })
    } catch (error) { next(error) }
  })

  return router
}

export default commissionsRouter
