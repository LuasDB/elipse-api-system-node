import express from 'express'
import Boom from '@hapi/boom'
import Sellers from './../services/sellers.service.js'
import { authenticate, authorize } from './../middlewares/authMiddleware.js'

const router = express.Router()
const sellers = new Sellers()

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
      if (req.user.role === 'vendedor' && req.user._id !== req.params.id) {
        throw Boom.forbidden('No tienes permiso para ver el perfil de otro vendedor')
      }
      const result = await sellers.getProfile(req.params.id)
      res.status(200).json({ success: true, message: 'Perfil obtenido', data: result })
    } catch (error) { next(error) }
  })

  return router
}

export default sellersRouter
