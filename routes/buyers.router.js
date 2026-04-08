import express from 'express'
import Buyers from './../services/buyers.service.js'
import { authenticate, authorize } from './../middlewares/authMiddleware.js'

const router = express.Router()
const buyers = new Buyers()

const buyersRouter = (io) => {

  router.get('/', authenticate, async (req, res, next) => {
    try {
      const filters = { search: req.query.search }
      const result = await buyers.getAll(filters)
      res.status(200).json({ success: true, message: 'Compradores obtenidos', data: result })
    } catch (error) { next(error) }
  })

  router.get('/:id', authenticate, async (req, res, next) => {
    try {
      const result = await buyers.getOneById(req.params.id)
      res.status(200).json({ success: true, message: 'Comprador obtenido', data: result })
    } catch (error) { next(error) }
  })

  router.post('/', authenticate, authorize('admin', 'gerente', 'vendedor'), async (req, res, next) => {
    try {
      const result = await buyers.create(req.body)
      io.emit('buyer_created', { message: 'Nuevo comprador registrado' })
      res.status(201).json({ success: true, message: 'Comprador creado', data: result })
    } catch (error) { next(error) }
  })

  router.patch('/:id', authenticate, authorize('admin', 'gerente', 'vendedor'), async (req, res, next) => {
    try {
      const result = await buyers.updateOneById(req.params.id, req.body)
      res.status(200).json({ success: true, message: 'Comprador actualizado', data: result })
    } catch (error) { next(error) }
  })

  router.delete('/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const result = await buyers.deleteOneById(req.params.id)
      res.status(200).json({ success: true, message: 'Comprador eliminado', data: result })
    } catch (error) { next(error) }
  })

  return router
}

export default buyersRouter
