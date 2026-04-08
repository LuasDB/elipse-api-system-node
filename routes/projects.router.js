import express from 'express'
import Projects from './../services/projects.service.js'
import { authenticate, authorize } from './../middlewares/authMiddleware.js'

const router = express.Router()
const projects = new Projects()

const projectsRouter = (io) => {

  // Obtener todos los proyectos
  router.get('/', authenticate, async (req, res, next) => {
    try {
      const filters = {
        status: req.query.status,
        type: req.query.type,
        search: req.query.search
      }
      const result = await projects.getAll(filters)

      res.status(200).json({
        success: true,
        message: 'Proyectos obtenidos',
        data: result
      })
    } catch (error) {
      next(error)
    }
  })

  // Obtener un proyecto por ID
  router.get('/:id', authenticate, async (req, res, next) => {
    try {
      const { id } = req.params
      const result = await projects.getOneById(id)

      res.status(200).json({
        success: true,
        message: 'Proyecto obtenido',
        data: result
      })
    } catch (error) {
      next(error)
    }
  })

  // Crear proyecto
  router.post('/', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const result = await projects.create(req.body)

      io.emit('project_created', { message: 'Se creó un nuevo proyecto', data: result })

      res.status(201).json({
        success: true,
        message: 'Proyecto creado',
        data: result
      })
    } catch (error) {
      next(error)
    }
  })

  // Actualizar proyecto
  router.patch('/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const { id } = req.params
      const result = await projects.updateOneById(id, req.body)

      io.emit('project_updated', { message: 'Se actualizó un proyecto' })

      res.status(200).json({
        success: true,
        message: 'Proyecto actualizado',
        data: result
      })
    } catch (error) {
      next(error)
    }
  })

  // Eliminar proyecto
  router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
    try {
      const { id } = req.params
      const result = await projects.deleteOneById(id)

      io.emit('project_deleted', { message: 'Se eliminó un proyecto' })

      res.status(200).json({
        success: true,
        message: 'Proyecto eliminado',
        data: result
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}

export default projectsRouter
