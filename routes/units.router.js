import express from 'express'
import Units from './../services/units.service.js'
import { authenticate, authorize } from './../middlewares/authMiddleware.js'

const router = express.Router()
const units = new Units()

const unitsRouter = (io) => {

  // Obtener unidades de un proyecto
  router.get('/project/:projectId', authenticate, async (req, res, next) => {
    try {
      const { projectId } = req.params
      const filters = {
        status: req.query.status,
        type: req.query.type,
        search: req.query.search
      }
      const result = await units.getByProject(projectId, filters)

      res.status(200).json({
        success: true,
        message: 'Unidades obtenidas',
        data: result
      })
    } catch (error) {
      next(error)
    }
  })

  // Obtener una unidad por ID
  router.get('/:id', authenticate, async (req, res, next) => {
    try {
      const { id } = req.params
      const result = await units.getOneById(id)

      res.status(200).json({
        success: true,
        message: 'Unidad obtenida',
        data: result
      })
    } catch (error) {
      next(error)
    }
  })

  // Crear unidad
  router.post('/', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const result = await units.create(req.body)

      io.emit('unit_created', { message: 'Se creó una nueva unidad', data: result })

      res.status(201).json({
        success: true,
        message: 'Unidad creada',
        data: result
      })
    } catch (error) {
      next(error)
    }
  })

  // Actualizar unidad
  router.patch('/:id', authenticate, authorize('admin', 'gerente', 'vendedor'), async (req, res, next) => {
    try {
      const { id } = req.params
      const result = await units.updateOneById(id, req.body)

      io.emit('unit_updated', { message: 'Se actualizó una unidad' })

      res.status(200).json({
        success: true,
        message: 'Unidad actualizada',
        data: result
      })
    } catch (error) {
      next(error)
    }
  })

  // Eliminar unidad
  router.delete('/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const { id } = req.params
      const result = await units.deleteOneById(id)

      io.emit('unit_deleted', { message: 'Se eliminó una unidad' })

      res.status(200).json({
        success: true,
        message: 'Unidad eliminada',
        data: result
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}

export default unitsRouter
