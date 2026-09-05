import express from 'express'
import Boom from '@hapi/boom'
import Contracts from './../services/contracts.service.js'
import { authenticate, authorize } from './../middlewares/authMiddleware.js'
import { requirePassword } from './../middlewares/stepUpAuth.js'

const router = express.Router()
const contracts = new Contracts()

const contractsRouter = (io) => {

  router.get('/', authenticate, async (req, res, next) => {
    try {
      const filters = {
        projectId: req.query.projectId,
        status: req.query.status,
        buyerId: req.query.buyerId,
        sellerId: req.query.sellerId,
        search: req.query.search,
        includeCancelled: req.query.includeCancelled === 'true'
      }
      if (req.user.role === 'vendedor') {
        filters.sellerId = req.user._id
      }
      const result = await contracts.getAll(filters)
      res.status(200).json({ success: true, message: 'Contratos obtenidos', data: result })
    } catch (error) { next(error) }
  })

  router.get('/:id', authenticate, async (req, res, next) => {
    try {
      const result = await contracts.getOneById(req.params.id)
      if (req.user.role === 'vendedor' && String(result.sellerId) !== String(req.user._id)) {
        throw Boom.forbidden('No tienes permiso para ver este contrato')
      }
      res.status(200).json({ success: true, message: 'Contrato obtenido', data: result })
    } catch (error) { next(error) }
  })

  router.post('/', authenticate, authorize('admin', 'gerente', 'vendedor'), async (req, res, next) => {
    try {
      const result = await contracts.create(req.body, req.audit)
      io.emit('contract_created', { message: 'Nuevo contrato registrado', data: result })
      res.status(201).json({ success: true, message: 'Contrato creado', data: result })
    } catch (error) { next(error) }
  })

  router.patch('/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const result = await contracts.updateOneById(req.params.id, req.body, req.audit)
      io.emit('contract_updated', { message: 'Contrato actualizado' })
      res.status(200).json({ success: true, message: 'Contrato actualizado', data: result })
    } catch (error) { next(error) }
  })

  // Cambia la unidad de un contrato: libera la unidad anterior y reserva la nueva.
  router.patch('/:id/unit', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const result = await contracts.changeUnit(req.params.id, req.body.unitId, req.audit)
      io.emit('contract_updated', { message: 'Contrato actualizado' })
      io.emit('unit_updated', { message: 'Se actualizó una unidad' })
      res.status(200).json({ success: true, message: 'Unidad del contrato actualizada', data: result })
    } catch (error) { next(error) }
  })

  // Cancela un contrato (no lo elimina): libera la unidad y conserva pagos/comisiones
  // como histórico. `requirePassword` exige la contraseña del admin (header X-Confirm-Password).
  router.post('/:id/cancel', authenticate, authorize('admin'), requirePassword, async (req, res, next) => {
    try {
      const result = await contracts.cancelContract(req.params.id, req.body.reason, req.audit)
      io.emit('contract_updated', { message: 'Contrato cancelado', data: result })
      io.emit('unit_updated', { message: 'Se actualizó una unidad' })
      res.status(200).json({ success: true, message: 'Contrato cancelado', data: result })
    } catch (error) { next(error) }
  })

  //Para manejo de archivos

  // Subir archivos a un contrato
router.post('/:id/files', authenticate, authorize('admin', 'gerente', 'vendedor'), async (req, res, next) => {
  try {
    const { id } = req.params
    const { default: uploadContractFiles } = await import('./../configurations/multer-contracts.js')
    const upload = uploadContractFiles(id)

    upload.array('files', 10)(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(Boom.badRequest('El archivo excede el límite de 10MB'))
        }
        return next(Boom.badRequest(err.message))
      }

      try {
        const result = await contracts.addFiles(id, req.files, req.audit)
        io.emit('contract_files_added', { message: 'Archivos agregados al contrato' })
        res.status(200).json({
          success: true,
          message: `${req.files.length} archivo(s) subido(s)`,
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

// Eliminar un archivo de un contrato
router.delete('/:id/files/:fileName', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const { id, fileName } = req.params
    const result = await contracts.removeFile(id, fileName, req.audit)
    res.status(200).json({ success: true, message: 'Archivo eliminado', data: result })
  } catch (error) { next(error) }
})

  return router
}

export default contractsRouter
