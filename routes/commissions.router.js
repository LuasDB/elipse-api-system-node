import express from 'express'
import Boom from '@hapi/boom'
import Commissions from './../services/commissions.service.js'
import { authenticate, authorize } from './../middlewares/authMiddleware.js'
import { requirePassword } from './../middlewares/stepUpAuth.js'

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

  // Obtener las comisiones (uno o más vendedores) de un contrato
  router.get('/contract/:contractId', authenticate, async (req, res, next) => {
    try {
      const result = await commissions.getByContract(req.params.contractId)
      res.status(200).json({ success: true, message: 'Comisiones obtenidas', data: result })
    } catch (error) { next(error) }
  })

  // Agregar un vendedor con su comisión a un contrato (solo admin)
  router.post('/contract/:contractId/sellers', authenticate, authorize('admin'), async (req, res, next) => {
    try {
      const result = await commissions.addSeller(req.params.contractId, req.body, req.audit)
      io.emit('commission_assigned', { contractId: req.params.contractId, message: 'Comisión asignada' })
      res.status(201).json({ success: true, message: 'Vendedor agregado al contrato', data: result })
    } catch (error) { next(error) }
  })

  // Actualizar el monto/descripción de la comisión de un vendedor en un contrato (solo admin)
  router.patch('/contract/:contractId/sellers/:sellerId', authenticate, authorize('admin'), async (req, res, next) => {
    try {
      const result = await commissions.updateSeller(req.params.contractId, req.params.sellerId, req.body, req.audit)
      io.emit('commission_assigned', { contractId: req.params.contractId, message: 'Comisión actualizada' })
      res.status(200).json({ success: true, message: 'Comisión actualizada', data: result })
    } catch (error) { next(error) }
  })

  // Quitar a un vendedor de un contrato. Con contraseña de admin (requirePassword)
  // se permite incluso si ya tiene pagos de comisión registrados (context.override).
  router.delete('/contract/:contractId/sellers/:sellerId', authenticate, authorize('admin'), requirePassword, async (req, res, next) => {
    try {
      const result = await commissions.removeSeller(req.params.contractId, req.params.sellerId, req.audit)
      io.emit('commission_assigned', { contractId: req.params.contractId, message: 'Vendedor quitado del contrato' })
      res.status(200).json({ success: true, message: 'Vendedor quitado del contrato', data: result })
    } catch (error) { next(error) }
  })

  // Registrar un pago de comisión a un vendedor de un contrato (admin, gerente)
  router.post('/contract/:contractId/sellers/:sellerId/payments', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const result = await commissions.registerPayment(req.params.contractId, req.params.sellerId, {
        ...req.body,
        registeredBy: req.user?.name || req.user?.email
      }, req.audit)
      io.emit('commission_payment_registered', { contractId: req.params.contractId, sellerId: req.params.sellerId, message: 'Pago de comisión registrado' })
      res.status(200).json({ success: true, message: 'Pago de comisión registrado', data: result })
    } catch (error) { next(error) }
  })

  // Subir comprobantes de un pago de comisión (admin, gerente)
  router.post('/contract/:contractId/sellers/:sellerId/payments/:movementId/vouchers', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const { contractId, sellerId, movementId } = req.params
      const { default: uploadCommissionFiles } = await import('./../configurations/multer-commissions.js')
      const upload = uploadCommissionFiles(contractId, sellerId)

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
          const result = await commissions.addVoucherToMovement(contractId, sellerId, movementId, req.files, req.audit)
          io.emit('commission_voucher_added', { contractId, sellerId, message: 'Comprobante de comisión agregado' })
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
  router.delete('/contract/:contractId/sellers/:sellerId/payments/:movementId/vouchers/:fileName', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const { contractId, sellerId, movementId, fileName } = req.params
      const result = await commissions.removeVoucherFromMovement(contractId, sellerId, movementId, fileName, req.audit)
      res.status(200).json({ success: true, message: 'Comprobante eliminado', data: result })
    } catch (error) { next(error) }
  })

  // Modificar un pago de comisión ya registrado (solo admin)
  router.patch('/contract/:contractId/sellers/:sellerId/payments/:movementId', authenticate, authorize('admin'), async (req, res, next) => {
    try {
      const { contractId, sellerId, movementId } = req.params
      const result = await commissions.updateMovement(contractId, sellerId, movementId, req.body, req.audit)
      io.emit('commission_payment_registered', { contractId, sellerId, message: 'Pago de comisión actualizado' })
      res.status(200).json({ success: true, message: 'Pago de comisión actualizado', data: result })
    } catch (error) { next(error) }
  })

  // Eliminar un pago de comisión ya registrado (solo admin, exige contraseña)
  router.delete('/contract/:contractId/sellers/:sellerId/payments/:movementId', authenticate, authorize('admin'), requirePassword, async (req, res, next) => {
    try {
      const { contractId, sellerId, movementId } = req.params
      const result = await commissions.removeMovement(contractId, sellerId, movementId, req.audit)
      io.emit('commission_payment_registered', { contractId, sellerId, message: 'Pago de comisión eliminado' })
      res.status(200).json({ success: true, message: 'Pago de comisión eliminado', data: result })
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
