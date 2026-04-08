import express from 'express'
import Contracts from './../services/contracts.service.js'
import { authenticate, authorize } from './../middlewares/authMiddleware.js'

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
        search: req.query.search
      }
      const result = await contracts.getAll(filters)
      res.status(200).json({ success: true, message: 'Contratos obtenidos', data: result })
    } catch (error) { next(error) }
  })

  router.get('/:id', authenticate, async (req, res, next) => {
    try {
      const result = await contracts.getOneById(req.params.id)
      res.status(200).json({ success: true, message: 'Contrato obtenido', data: result })
    } catch (error) { next(error) }
  })

  router.post('/', authenticate, authorize('admin', 'gerente', 'vendedor'), async (req, res, next) => {
    try {
      const result = await contracts.create(req.body)
      io.emit('contract_created', { message: 'Nuevo contrato registrado', data: result })
      res.status(201).json({ success: true, message: 'Contrato creado', data: result })
    } catch (error) { next(error) }
  })

  

  router.patch('/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
    try {
      const result = await contracts.updateOneById(req.params.id, req.body)
      io.emit('contract_updated', { message: 'Contrato actualizado' })
      res.status(200).json({ success: true, message: 'Contrato actualizado', data: result })
    } catch (error) { next(error) }
  })

  router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
    try {
      const result = await contracts.deleteOneById(req.params.id)
      io.emit('contract_deleted', { message: 'Contrato eliminado' })
      res.status(200).json({ success: true, message: 'Contrato eliminado', data: result })
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
        const result = await contracts.addFiles(id, req.files)
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
    const result = await contracts.removeFile(id, fileName)
    res.status(200).json({ success: true, message: 'Archivo eliminado', data: result })
  } catch (error) { next(error) }
})

  return router
}

export default contractsRouter
