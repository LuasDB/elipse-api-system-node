import express from 'express'
import AuditLog from './../services/auditLog.service.js'
import { authenticate, authorize } from './../middlewares/authMiddleware.js'

const router = express.Router()
const auditLog = new AuditLog()

// Toda la bitácora de auditoría es exclusiva del administrador.
const auditRouter = () => {
  router.use(authenticate, authorize('admin'))

  // Bitácora global con filtros: ?entity=&entityId=&actorId=&action=&from=&to=&search=&page=&limit=
  router.get('/', async (req, res, next) => {
    try {
      const result = await auditLog.getAll({
        entity: req.query.entity,
        entityId: req.query.entityId,
        actorId: req.query.actorId,
        action: req.query.action,
        from: req.query.from,
        to: req.query.to,
        search: req.query.search,
        page: req.query.page,
        limit: req.query.limit
      })
      res.status(200).json({ success: true, message: 'Bitácora de auditoría obtenida', data: result })
    } catch (error) { next(error) }
  })

  // Valores para poblar los filtros del panel.
  router.get('/options', async (req, res, next) => {
    try {
      const result = await auditLog.getFilterOptions()
      res.status(200).json({ success: true, message: 'Opciones de auditoría', data: result })
    } catch (error) { next(error) }
  })

  // Historial de un registro concreto: /audit/contract/:id, /audit/payment/:id, ...
  // ?limit= &skip=  (por defecto los 50 más recientes)
  router.get('/:entity/:id', async (req, res, next) => {
    try {
      const result = await auditLog.getByEntity(req.params.entity, req.params.id, {
        limit: req.query.limit,
        skip: req.query.skip
      })
      res.status(200).json({ success: true, message: 'Historial obtenido', data: result })
    } catch (error) { next(error) }
  })

  return router
}

export default auditRouter
