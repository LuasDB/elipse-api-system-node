import express from 'express'
import Boom from '@hapi/boom'
import Sellers from './../services/sellers.service.js'
import uploadAttachments from './../configurations/multer-attachments.js'
import { authenticate, authorize } from './../middlewares/authMiddleware.js'

const router = express.Router()
const sellers = new Sellers()

// Lanza Boom.forbidden si un vendedor intenta ver los datos de otro vendedor
const assertOwnProfile = (req, sellerId) => {
  if (req.user.role === 'vendedor' && req.user._id !== sellerId) {
    throw Boom.forbidden('No tienes permiso para acceder a la información de otro vendedor')
  }
}

const sellersRouter = (io) => {

  // Listar vendedores con sus estadísticas (admin, gerente)
  router.get('/', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const result = await sellers.getAll()
      res.status(200).json({ success: true, message: 'Vendedores obtenidos', data: result })
    } catch (error) { next(error) }
  })

  // Perfil de un vendedor (admin/gerente ven cualquiera; el vendedor solo el suyo)
  router.get('/:id', authenticate, async (req, res, next) => {
    try {
      assertOwnProfile(req, req.params.id)
      const result = await sellers.getProfile(req.params.id)
      res.status(200).json({ success: true, message: 'Perfil obtenido', data: result })
    } catch (error) { next(error) }
  })

  // Adjuntos de un vendedor (identificación, contratos, etc.)
  router.get('/:id/attachments', authenticate, async (req, res, next) => {
    try {
      assertOwnProfile(req, req.params.id)
      const result = await sellers.getAttachments(req.params.id)
      res.status(200).json({ success: true, message: 'Adjuntos obtenidos', data: result })
    } catch (error) { next(error) }
  })

  // Subir adjuntos de un vendedor — solo admin/gerente
  router.post('/:id/attachments', authenticate, authorize('admin', 'gerente'), (req, res, next) => {
    uploadAttachments.array('files', 5)(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(Boom.badRequest('El archivo excede el límite de 5MB'))
        }
        return next(Boom.badRequest(err.message))
      }
      if (!req.files || req.files.length === 0) {
        return next(Boom.badRequest('No se recibieron archivos'))
      }
      try {
        const result = await sellers.addAttachments(req.params.id, req.files, req.audit)
        io.emit('seller_attachment_added', { sellerId: req.params.id })
        res.status(200).json({ success: true, message: `${result.length} archivo(s) subido(s)`, data: result })
      } catch (error) { next(error) }
    })
  })

  // Eliminar un adjunto de un vendedor — solo admin
  router.delete('/:id/attachments/:attachmentId', authenticate, authorize('admin'), async (req, res, next) => {
    try {
      const result = await sellers.deleteAttachment(req.params.id, req.params.attachmentId, req.audit)
      io.emit('seller_attachment_removed', { sellerId: req.params.id })
      res.status(200).json({ success: true, message: 'Adjunto eliminado', data: result })
    } catch (error) { next(error) }
  })

  // Historial de cambios de un vendedor (adjuntos, edición de datos) — solo admin
  router.get('/:id/audit', authenticate, authorize('admin'), async (req, res, next) => {
    try {
      const result = await sellers.getAuditLog(req.params.id)
      res.status(200).json({ success: true, message: 'Historial obtenido', data: result })
    } catch (error) { next(error) }
  })

  return router
}

export default sellersRouter
